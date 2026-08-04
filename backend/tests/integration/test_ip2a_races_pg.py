"""İP-2a · İade/refund yarışları — GERÇEK PG, deterministik pencereler.

Sözleşme: docs/ip2a-magaza-iade-sozlesme.md (§2 M1/M3/Y1; §3 İP2A-04/06/07).

Determinizm araçları:
- ``provider.refund_gate`` (StubProvider): sağlayıcı çağrısı event set edilene
  dek bekler — "intent commit'lendi, sonuç yazılmadı" penceresi istenildiği
  kadar tutulur.
- ``order_service._lock_order``'a monkeypatch ile takılan sıralama kapısı:
  davranışı değiştirmez, yalnız iki transaction'ın buluşma anını sabitler.
- DB durumu SQL poll ile beklenir (uyku tabanlı tahmin yok).

Beklenmeyen istisnalar yeniden yükseltilir; 40P01 (deadlock) ve 55P03
(lock timeout) ayrı ve açık mesajla raporlanır.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import MissingGreenlet

from core.database import AsyncSessionLocal
from schemas.store import OrderReturnItemIn
from services import escrow_reconciler, order_service
from tests.integration.ip2a_factory import IadeFabrikasi

DEADLOCK = "40P01"
LOCK_TIMEOUT = "55P03"


@pytest.fixture
async def fab(pg):
    f = IadeFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


def _pg_code(exc: BaseException) -> str | None:
    for cand in (exc, getattr(exc, "orig", None), getattr(exc, "__cause__", None)):
        code = getattr(cand, "sqlstate", None) or getattr(cand, "pgcode", None)
        if code:
            return code
    return None


def _yalniz_beklenenler(sonuclar, *, izinli_http=(409, 502)) -> list:
    """Kilit hatalarını açık mesajla düşür, beklenmeyen istisnayı yükselt.

    ⚠️ Buradaki ``ip2a18_tolere`` anahtarı KALDIRILDI. İP2A-18 (AYIPLI onayında
    `MissingGreenlet`/500) kapatıldığı için o istisnayı tolere eden bir kapı
    artık gerçek bir regresyonu sessizce yutardı: yarış testleri, para emri
    verildikten sonraki çökmeyi de KIRMIZI görmek zorundadır.
    """
    temiz = []
    for r in sonuclar:
        if not isinstance(r, BaseException):
            temiz.append(r)
            continue
        kod = _pg_code(r)
        if kod == DEADLOCK:
            pytest.fail(f"DEADLOCK (40P01) — kilit sırası ihlali: {r}", pytrace=False)
        if kod == LOCK_TIMEOUT:
            pytest.fail(f"KİLİT ZAMAN AŞIMI (55P03): {r}", pytrace=False)
        if isinstance(r, MissingGreenlet):
            pytest.fail(
                f"MissingGreenlet — para emri sonrası async lazy-load (İP2A-18 "
                f"regresyonu): {r}",
                pytrace=False,
            )
        if isinstance(r, HTTPException) and r.status_code in izinli_http:
            temiz.append(r)
            continue
        raise r
    return temiz


async def _bekle(kosul, *, mesaj: str, saniye: float = 5.0) -> None:
    """SQL/durum koşulunu deterministik bekler; süre dolarsa test FAIL."""
    kalan = saniye
    while kalan > 0:
        if await kosul():
            return
        await asyncio.sleep(0.02)
        kalan -= 0.02
    pytest.fail(f"beklenen ara durum oluşmadı: {mesaj}", pytrace=False)


class SiralamaKapisi:
    """İki transaction'ın buluşma anını ÖLÇEREK sabitler (tahmin etmeden).

    ``_lock_order``'a takılır: davranışı değiştirmez, yalnız çağıranı kapıda
    tutar ve "kaç taraf kapıya geldi" bilgisini test tarafına bildirir.

    ## Neden `asyncio.sleep(0.1)` yetmiyordu (bağımsız denetimin P2-1 borcu)

    Eski kurulum "0,1 sn'de her iki task da guard'ı okumuştur" diye BAHİS
    oynuyordu. Bağımsız denetim, mutasyon provasında 5 turda 1 kez kaçırıldığını
    ölçtü: yavaş bir turda ikinci task kapıya HİÇ gelmeden birinci tamamlanıyor,
    yarış hiç kurulmuyor ve nöbetçi yanlış yeşil veriyordu. Artık ardışıklık
    ölçülür — kapı, beklenen sayıda taraf gelene kadar AÇILMAZ ve gelmezse
    test SÜRE AŞIMIYLA kırmızıya döner (sessiz atlama yok).
    """

    def __init__(self, beklenen: int) -> None:
        self.beklenen = beklenen
        self.gelen = 0
        self._hepsi_geldi = asyncio.Event()
        self._ac = asyncio.Event()

    async def gecis(self) -> None:
        self.gelen += 1
        if self.gelen >= self.beklenen:
            self._hepsi_geldi.set()
        await self._ac.wait()

    async def hepsini_bekle(self, *, saniye: float = 5.0) -> None:
        try:
            await asyncio.wait_for(self._hepsi_geldi.wait(), timeout=saniye)
        except TimeoutError:
            pytest.fail(
                f"yarış kurulamadı: kapıya {self.gelen}/{self.beklenen} taraf "
                "geldi — ardışıklık sağlanmadan ölçüm anlamsızdır",
                pytrace=False,
            )

    def ac(self) -> None:
        self._ac.set()


def _kapiyi_tak(monkeypatch, kapi: SiralamaKapisi):
    """``order_service._lock_order``'ı kapının arkasına alır."""
    orijinal = order_service._lock_order

    async def kapili_kilit(db, order):
        await kapi.gecis()
        return await orijinal(db, order)

    monkeypatch.setattr(order_service, "_lock_order", kapili_kilit)
    return orijinal


async def _cayma(order_id: int):
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, order_id)
        return await order_service.request_return(
            db, order, "", return_type="CAYMA", items=None
        )


async def _refund_status(return_id: int) -> str:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text("SELECT refund_status FROM order_returns WHERE id = :i"),
                {"i": return_id},
            )
        ).scalar_one()


# ── YEŞİL NÖBETÇİ ────────────────────────────────────────────────────────────


async def test_g09_iki_admin_ayni_talebi_onaylarsa_tek_kazanan(
    fab, provider, monkeypatch
):
    """G-09: Aynı talebe iki eşzamanlı approve → escrow.claim (NONE→REFUNDING)
    tek kazanan seçer: bir provider çağrısı, bir stok seti, kaybeden 409.

    İki transaction'ın da talebi PENDING gördüğü an sıralama kapısıyla
    sabitlenir — ardışıklaşma şansa bırakılmaz.
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 2)])
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, sip.order_id)
        talep = await order_service.request_return(
            db, order, "kusurlu", return_type="AYIPLI", items=None
        )

    kapi = SiralamaKapisi(2)
    _kapiyi_tak(monkeypatch, kapi)

    async def onayla(not_metni: str):
        async with AsyncSessionLocal() as db:
            return await order_service.approve_return(
                db, talep.id, admin_note=not_metni
            )

    g1 = asyncio.create_task(onayla("admin-1"))
    g2 = asyncio.create_task(onayla("admin-2"))
    # Her iki task da `_load_return`'ü PENDING okuyup kilit kapısına GELDİ —
    # ölçüldü, tahmin edilmedi (bkz. SiralamaKapisi docstring'i, P2-1).
    await kapi.hepsini_bekle()
    kapi.ac()
    sonuclar = await asyncio.gather(g1, g2, return_exceptions=True)

    # Claim (talep durumu PENDING→APPROVED + para NONE→REFUNDING) TEK kazanan
    # seçer → kaybeden 409 alır ve para tam bir kez çıkar.
    temiz = _yalniz_beklenenler(sonuclar)
    hatalar = [r for r in temiz if isinstance(r, HTTPException)]
    assert len(hatalar) == 1 and hatalar[0].status_code == 409, (
        f"iki eşzamanlı onaydan tam biri 409 ile kaybetmeli: {sonuclar}"
    )
    assert len(provider.refund_calls) == 1, "para tam bir kez çıkmalı"
    o = await fab.siparis_satiri(sip.order_id)
    assert o["refunded_amount"] == sip.total, "kayıp/çift güncelleme olmamalı"
    # PK-α: para yolu stok üretmez. Kabul TEK set üretir; claim tekliği
    # sayesinde kaybeden taraf ikinci seti yazamaz.
    assert await fab.hareketler(pid, "RETURN") == []
    await fab.teslim_al(talep.id)
    assert len(await fab.hareketler(pid, "RETURN")) == 1, (
        "claim tekliği stokta da ikinci seti engellemeli"
    )
    assert await fab.audit_sayisi(
        action="return.approve", target_type="order_return", target_id=talep.id
    ) == 1, "kaybeden onay da audit satırı yazdı"


# ── KIRMIZI KABUL TESTLERİ ───────────────────────────────────────────────────


async def test_r04a_es_zamanli_iki_cayma_toplam_tavani_asamaz(fab, provider):
    """R-04a · İP2A-04: aynı siparişe eşzamanlı iki CAYMA talebi birlikte,
    fiilen ödenenden fazlasını iade ettiremez.

    Kusur şuydu: `uq_order_returns_open` yalnız PENDING satırları kapsar (CAYMA
    APPROVED doğuyordu), `request_return` tavanı kilitsiz ve `refunded_amount`
    üzerinden okuyordu → ilk talep sağlayıcıda beklerken açılan ikinci talep de
    tavanı 0 sanıp tam tutarı istiyor, 100 TL'lik sipariş sağlayıcıya 200 TL
    iade emri üretiyordu.

    ## Ara adım neden değişti (assertion gevşetmesi DEĞİL)

    Tarihsel kurulum, ikinci talebin kabul edilmesini bir ÖN KOŞUL olarak
    bekliyordu (`"ikinci talep de kabul edilmeli (kusurun kendisi)"`). Kusur
    kapandığında bu bekleme artık gerçekleşemez: tavan `refund_reserved`
    üzerinden ve sipariş kilidi altında okunduğu için ikinci talep DAHA
    AÇILMADAN 409 alır. Ölçülen iddia (M1: toplam ≤ ödenen) değişmedi; test
    ayrıca "kaybeden hiçbir yan etki üretmez" iddiasıyla GÜÇLENDİ.
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 1)])  # total 100
    cid = sip.client_id
    provider.refund_gate = asyncio.Event()

    t1 = asyncio.create_task(_cayma(sip.order_id))
    await _bekle(
        lambda: _hazir(provider, 1),
        mesaj="ilk talep sağlayıcı çağrısına ulaşmalı",
    )
    # İlk talep REFUNDING'de asılıyken ikinci talep kapıdan girmeye çalışır.
    t2 = asyncio.create_task(_cayma(sip.order_id))

    async def _ikinci_sonuclandi() -> bool:
        return t2.done()

    await _bekle(_ikinci_sonuclandi, mesaj="ikinci talep sonuçlanmalı")
    provider.refund_gate.set()
    sonuclar = await asyncio.gather(t1, t2, return_exceptions=True)
    temiz = _yalniz_beklenenler(sonuclar)

    toplam = sum(a for _, a in provider.refund_calls)
    assert toplam <= sip.total, (
        f"İP2A-04: sağlayıcıya giden iade toplamı {toplam} TL — ödenen "
        f"{sip.total} TL; eşzamanlı CAYMA talepleri kümülatif tavanı deldi"
    )
    # Tam bir kazanan: biri parayı alır, diğeri 409 ile hiçbir iz bırakmaz.
    hatalar = [r for r in temiz if isinstance(r, HTTPException)]
    assert len(hatalar) == 1 and hatalar[0].status_code == 409, (
        f"iki eşzamanlı CAYMA'dan tam biri kaybetmeli, görülen: {sonuclar}"
    )
    assert len(provider.refund_calls) == 1, "sağlayıcıya tam bir çağrı gitmeli"
    o = await fab.siparis_satiri(sip.order_id)
    assert o["refunded_amount"] == sip.total
    assert await fab.bildirim_sayisi(cid, icinde="iade edildi") == 1, (
        "kaybeden taraf da müşteriye 'ödemen iade edildi' dedi (A2 ihlali)"
    )
    parali = [
        t for t in await fab.iade_satirlari(sip.order_id)
        if t["refund_status"] == "REFUNDED"
    ]
    assert len(parali) == 1, f"tek talep para almalı, görülen: {parali}"


def _hazir(provider, n: int):
    async def _ic() -> bool:
        return len(provider.refund_calls) >= n

    return _ic()


async def test_r04b_es_zamanli_iki_kismi_iade_kayip_guncelleme_uretmemeli(
    fab, provider
):
    """R-04b · KNOWN-RED(İP2A-04): iki kısmi iadenin eşzamanlı settle'ı
    `orders.refunded_amount`'ta kayıp güncelleme üretmemelidir.

    Bugün: `_settle_return` Order kilidini intent commit'inde (1837) bırakır;
    1878'deki `refunded_amount += amount` kilitsiz read-modify-write'tır. İki
    işlem de 0 okur, ikisi de kendi 100'ünü yazar → 200 yerine 100 kalır ve
    tavan sayacı sessizce 100 TL kaybeder.
    """
    p1 = await fab.urun(stock=10)
    p2 = await fab.urun(stock=10)
    cid, _ = await fab.musteri()
    sip = await fab.siparis(items=[(p1, 1), (p2, 1)], client_id=cid)  # total 200
    provider.refund_gate = asyncio.Event()

    async def kismi_cayma(item_id: int):
        async with AsyncSessionLocal() as db:
            order = await order_service._load_full(db, sip.order_id)
            return await order_service.request_return(
                db,
                order,
                "",
                return_type="CAYMA",
                items=[OrderReturnItemIn(order_item_id=item_id, quantity=1)],
            )

    t1 = asyncio.create_task(kismi_cayma(sip.item_ids[0]))
    await _bekle(
        lambda: _hazir(provider, 1), mesaj="ilk settle sağlayıcıya ulaşmalı"
    )
    t2 = asyncio.create_task(kismi_cayma(sip.item_ids[1]))

    async def _b_claimed() -> bool:
        satirlar = await fab.iade_satirlari(sip.order_id)
        return len(satirlar) >= 2 and satirlar[1]["refund_status"] == "REFUNDING"

    await _bekle(_b_claimed, mesaj="ikinci talep intent'ini commit'lemeli")
    provider.refund_gate.set()
    sonuclar = await asyncio.gather(t1, t2, return_exceptions=True)
    _yalniz_beklenenler(sonuclar)

    satirlar = await fab.iade_satirlari(sip.order_id)
    assert [s["refund_status"] for s in satirlar] == ["REFUNDED", "REFUNDED"]
    assert sum(a for _, a in provider.refund_calls) == Decimal("200.00")
    o = await fab.siparis_satiri(sip.order_id)
    assert o["refunded_amount"] == Decimal("200.00"), (
        f"KNOWN-RED(İP2A-04): iki 100 TL'lik iade sonrası refunded_amount="
        f"{o['refunded_amount']} — kilitsiz read-modify-write bir artışı ezdi; "
        "kümülatif tavan 100 TL açık verdi (sipariş üzerinden yeniden iade "
        "açılabilir)"
    )


async def test_r06_reconciler_canli_iadeyle_yarisirsa_cift_provider_cagrisi_olmamali(
    fab, provider, monkeypatch
):
    """R-06 · KNOWN-RED(İP2A-06): sağlayıcı çağrısı sürerken reconciler aynı
    talebi RETRY'layamamalı — provider'a tek çağrı gitmelidir.

    Bugün: reconciler'ın RETRY claim'i REFUNDING→REFUNDING'dir (durum
    değişmez → WHERE ikinci yazana da uyar) ve karantina yalnız zamana dayanır;
    uzun süren canlı bir sağlayıcı çağrısı sırasında reconciler ikinci gerçek
    iade emri verir. Sağlayıcı 'aşırı-iade reddi' kısmi tutarları ayırt
    edemediğinden bu gerçek çifte ödemedir.
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 1)])
    provider.refund_gate = asyncio.Event()

    t1 = asyncio.create_task(_cayma(sip.order_id))
    await _bekle(
        lambda: _hazir(provider, 1), mesaj="canlı iade sağlayıcıda asılı olmalı"
    )
    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_status"] == "REFUNDING"
    # Karantina penceresi doldu (canlı çağrı hâlâ sürüyor).
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE order_returns SET refund_requested_at = "
                "now() - interval '2 hours' WHERE id = :i"
            ),
            {"i": talep["id"]},
        )
        await s.commit()

    async def reconciler():
        async with AsyncSessionLocal() as s:
            return await escrow_reconciler.reconcile_refunding(s)

    t2 = asyncio.create_task(reconciler())
    # Kusur penceresi: reconciler da sağlayıcıya ulaşırsa çağrı sayısı 2 olur.
    # Ulaşmazsa (doğru davranış) kapı açılınca canlı istek tek başına biter.
    try:
        await _bekle(
            lambda: _hazir(provider, 2),
            mesaj="(kusur oluşmadıysa bu bekleme boşa düşer)",
            saniye=2.0,
        )
    except BaseException:
        pass
    finally:
        provider.refund_gate.set()
    sonuclar = await asyncio.gather(t1, t2, return_exceptions=True)
    _yalniz_beklenenler(sonuclar)

    assert len(provider.refund_calls) == 1, (
        f"KNOWN-RED(İP2A-06): aynı iade talebi için sağlayıcıya "
        f"{len(provider.refund_calls)} çağrı gitti — reconciler RETRY claim'i "
        "exclusive değil (REFUNDING→REFUNDING), canlı istekle yarışıp ikinci "
        "gerçek iade emri verdi"
    )


async def test_r07_reject_uzerine_approve_yazamaz(fab, provider, monkeypatch):
    """R-07 · KNOWN-RED(İP2A-07): REJECTED bir talebin üstüne approve akışı
    APPROVED yazamaz ve para çıkaramaz.

    Bugün: `reject_return` kilitsizdir; `_settle_return` talep durumunu
    KOŞULSUZ `APPROVED` yazar. Approve, guard'ı (PENDING okuması) geçtikten
    sonra reject araya girerse — sıralama kapısıyla deterministik kurulur —
    REJECTED karar sessizce ezilir ve müşteriye para gider.
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 2)])
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, sip.order_id)
        talep = await order_service.request_return(
            db, order, "kusurlu", return_type="AYIPLI", items=None
        )

    kapi = SiralamaKapisi(1)
    _kapiyi_tak(monkeypatch, kapi)

    async def onayla():
        async with AsyncSessionLocal() as db:
            return await order_service.approve_return(db, talep.id, admin_note="onay")

    t1 = asyncio.create_task(onayla())
    # Approve guard'ı talebi PENDING okudu ve kilit kapısına GELDİ — ölçüldü,
    # `sleep(0.1)` ile tahmin edilmedi (P2-1).
    await kapi.hepsini_bekle()

    # Reject `_lock_order` kullanmaz → kapıdan etkilenmez ve araya girer.
    async with AsyncSessionLocal() as db:
        await order_service.reject_return(db, talep.id, admin_note="kanıt yetersiz")
    assert (await fab.iade_satirlari(sip.order_id))[0]["status"] == "REJECTED"

    kapi.ac()
    sonuclar = await asyncio.gather(t1, return_exceptions=True)
    _yalniz_beklenenler(sonuclar)

    satir = (await fab.iade_satirlari(sip.order_id))[0]
    assert satir["status"] == "REJECTED", (
        "KNOWN-RED(İP2A-07): REJECTED kararın üstüne approve akışı "
        f"'{satir['status']}' yazdı — talep durumu için atomik claim yok, "
        "_settle_return koşulsuz APPROVED atıyor"
    )
    assert satir["refund_status"] == "NONE", "reddedilen talep para claim'i almamalı"
    assert provider.refund_calls == [], (
        "KNOWN-RED(İP2A-07): reddedilmiş talep için sağlayıcıya para emri gitti"
    )
    o = await fab.siparis_satiri(sip.order_id)
    assert o["refunded_amount"] == Decimal("0.00")
    assert await fab.hareketler(pid, "RETURN") == []
    # Kaybeden approve, karar audit'i de yazmamalı (izde iki karar görünemez).
    assert await fab.audit_sayisi(
        action="return.approve", target_type="order_return", target_id=talep.id
    ) == 0
    assert await fab.audit_sayisi(
        action="return.reject", target_type="order_return", target_id=talep.id
    ) == 1


# ── İP-2a üretim uygulaması: ek yarış/sıralama nöbetçileri ───────────────────


async def test_kismi_ve_tam_iade_iki_siralamada_da_tavani_korur(fab, provider):
    """Kısmi ↔ tam iade, HANGİ SIRAYLA gelirse gelsin ödenenden fazlasını
    iade ettiremez (M1).

    Tek sıralamayı ölçmek yeterli değildir: tavan `refund_reserved` üzerinden
    tutuluyorsa iki sıralama da aynı sonucu vermek zorundadır. "Önce tam sonra
    kısmi" yolunda ikinci talep hiç açılamaz; "önce kısmi sonra tam" yolunda
    ikincisi yalnız KALANI ister.
    """
    # (a) önce kısmi, sonra tam
    pid = await fab.urun(stock=10)
    a = await fab.siparis(items=[(pid, 3)], status="SHIPPED")  # total 300
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, a.order_id)
        await order_service.request_return(
            db, order, "", return_type="CAYMA",
            items=[OrderReturnItemIn(order_item_id=a.item_ids[0], quantity=1)],
        )
    async with AsyncSessionLocal() as db:
        await order_service.refund_order(db, a.order_id, reason="kalan iade")
    assert sum(t for _, t in provider.refund_calls) == a.total
    assert (await fab.siparis_satiri(a.order_id))["refunded_amount"] == a.total

    # (b) önce tam, sonra kısmi
    provider.refund_calls.clear()
    pid2 = await fab.urun(stock=10)
    b = await fab.siparis(items=[(pid2, 3)], status="SHIPPED")
    async with AsyncSessionLocal() as db:
        await order_service.refund_order(db, b.order_id, reason="tam iade")
    with pytest.raises(HTTPException) as exc:
        async with AsyncSessionLocal() as db:
            order = await order_service._load_full(db, b.order_id)
            await order_service.request_return(
                db, order, "", return_type="CAYMA",
                items=[OrderReturnItemIn(order_item_id=b.item_ids[0], quantity=1)],
            )
    assert exc.value.status_code == 409
    assert sum(t for _, t in provider.refund_calls) == b.total, (
        "tam iadeden sonra açılan kısmi talep ikinci para emri üretti"
    )


async def test_ardisik_iki_kismi_iade_kalem_adedi_ve_tavani_asamaz(fab, provider):
    """Ardışık kısmi iadeler kümülatif kalem-adedini ve para tavanını korur.

    R-04b eşzamanlı yolu ölçer; bu nöbetçi ARDIŞIK yolu ölçer — kayıp
    güncelleme olmasa bile kümülatif hesap bayat okunursa aynı kitap iki kez
    iade edilebilirdi (İP2A-11).
    """
    pid = await fab.urun(stock=10, price="100.00")
    sip = await fab.siparis(items=[(pid, 2)])  # total 200
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, sip.order_id)
        await order_service.request_return(
            db, order, "", return_type="CAYMA",
            items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
        )
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, sip.order_id)
        await order_service.request_return(
            db, order, "", return_type="CAYMA",
            items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
        )
    assert sum(t for _, t in provider.refund_calls) == Decimal("200.00")
    assert (await fab.siparis_satiri(sip.order_id))["refunded_amount"] == Decimal("200.00")

    # Üçüncü talep: kalemde iade hakkı kalmadı.
    with pytest.raises(HTTPException) as exc:
        async with AsyncSessionLocal() as db:
            order = await order_service._load_full(db, sip.order_id)
            await order_service.request_return(
                db, order, "", return_type="CAYMA",
                items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
            )
    assert exc.value.status_code == 409
    assert len(provider.refund_calls) == 2


async def test_reconciler_bir_kaydin_hatasinda_partiyi_dusurmez(
    fab, provider, monkeypatch
):
    """Reconciler kayıt-başı izole çalışır: bir kaydın hatası diğerlerini
    engellemez (R1).

    Döngü korumasızken TEK bir kaydın beklenmeyen hatası partinin kalanını o
    turda hiç işletmiyordu — sorunlu kayıt durdukça gerçek müşterilerin parası
    hiçbir turda tamamlanmıyordu.
    """
    saglam, bozuk = [], None
    for _ in range(3):
        pid = await fab.urun(stock=5)
        sip = await fab.siparis(items=[(pid, 1)])
        provider.refund_result = False
        with pytest.raises(HTTPException):
            await _cayma(sip.order_id)
        rid = (await fab.iade_satirlari(sip.order_id))[0]["id"]
        saglam.append((sip, rid))
    bozuk = saglam.pop(1)  # ortadaki kayıt patlatılacak

    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE order_returns SET refund_requested_at = "
                "now() - interval '2 hours'"
            )
        )
        await s.commit()

    provider.refund_result = True
    gercek_refund = provider.refund

    async def patlayan_refund(*, provider_ref, amount):
        satirlar = await fab.iade_satirlari(bozuk[0].order_id)
        if satirlar and provider_ref == satirlar[0]["provider_ref"]:
            raise RuntimeError("sağlayıcı patladı (test)")
        return await gercek_refund(provider_ref=provider_ref, amount=amount)

    monkeypatch.setattr(provider, "refund", patlayan_refund)
    async with AsyncSessionLocal() as s:
        await escrow_reconciler.reconcile_refunding(s)

    for sip, rid in saglam:
        satir = (await fab.iade_satirlari(sip.order_id))[0]
        assert satir["refund_status"] == "REFUNDED", (
            f"sağlam kayıt #{rid} bozuk kayıt yüzünden işlenmedi"
        )
        assert (await fab.siparis_satiri(sip.order_id))["refunded_amount"] > 0
    bozuk_satir = (await fab.iade_satirlari(bozuk[0].order_id))[0]
    assert bozuk_satir["refund_status"] == "REFUNDING", (
        "hatalı kayıt yanlışlıkla REFUNDED yazıldı"
    )
