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


def _yalniz_beklenenler(
    sonuclar, *, izinli_http=(409, 502), ip2a18_tolere=False
) -> list:
    """Kilit hatalarını açık mesajla düşür, beklenmeyen istisnayı yükselt.

    ``ip2a18_tolere=True``: AYIPLI onayın başarılı yolu bugün üretimde
    MissingGreenlet/500 verir (sözleşme İP2A-18, kırmızısı R-18). Approve
    içeren yarış testleri, ölçtükleri iddia (claim tekliği, durum bütünlüğü)
    bu bilinen hatadan bağımsız olduğu için onu AÇIKÇA tolere eder — başka
    hiçbir istisna yutulmaz.
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
        if isinstance(r, HTTPException) and r.status_code in izinli_http:
            temiz.append(r)
            continue
        if ip2a18_tolere and isinstance(r, MissingGreenlet):
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

    kapi = asyncio.Event()
    orijinal_kilit = order_service._lock_order

    async def kapili_kilit(db, order):
        await kapi.wait()
        return await orijinal_kilit(db, order)

    monkeypatch.setattr(order_service, "_lock_order", kapili_kilit)

    async def onayla(not_metni: str):
        async with AsyncSessionLocal() as db:
            return await order_service.approve_return(
                db, talep.id, admin_note=not_metni
            )

    g1 = asyncio.create_task(onayla("admin-1"))
    g2 = asyncio.create_task(onayla("admin-2"))
    await asyncio.sleep(0.1)  # her iki task _load_return'ü PENDING okudu
    kapi.set()
    sonuclar = await asyncio.gather(g1, g2, return_exceptions=True)

    # Kazanan taraf bugün İP2A-18 (AYIPLI onayında MissingGreenlet/500) yüzünden
    # restock'ta düşer — o kusurun kırmızısı R-18'dir. Bu testin iddiası ondan
    # bağımsızdır: claim (NONE→REFUNDING) TEK kazanan seçer → kaybeden 409 alır
    # ve para tam bir kez çıkar.
    temiz = _yalniz_beklenenler(sonuclar, ip2a18_tolere=True)
    hatalar = [r for r in temiz if isinstance(r, HTTPException)]
    assert len(hatalar) == 1 and hatalar[0].status_code == 409, (
        "iki eşzamanlı onaydan tam biri 409 ile kaybetmeli"
    )
    assert len(provider.refund_calls) == 1, "para tam bir kez çıkmalı"
    assert len(await fab.hareketler(pid, "RETURN")) <= 1, (
        "claim tekliği stokta da ikinci seti engellemeli "
        "(bugün İP2A-18 yüzünden 0 set yazılıyor — o eksik R-18'in konusu)"
    )


# ── KIRMIZI KABUL TESTLERİ ───────────────────────────────────────────────────


async def test_r04a_es_zamanli_iki_cayma_toplam_tavani_asamaz(fab, provider):
    """R-04a · KNOWN-RED(İP2A-04): aynı siparişe eşzamanlı iki CAYMA talebi
    birlikte, fiilen ödenenden fazlasını iade ettiremez.

    Bugün: `uq_order_returns_open` yalnız PENDING satırları kapsar (CAYMA
    APPROVED doğar), `request_return` tavanı kilitsiz okur → ilk talep
    sağlayıcıda beklerken açılan ikinci talep de tavanı 0 sanıp tam tutarı
    ister; 100 TL'lik sipariş sağlayıcıya 200 TL iade emri üretir.
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 1)])  # total 100
    provider.refund_gate = asyncio.Event()

    t1 = asyncio.create_task(_cayma(sip.order_id))
    await _bekle(
        lambda: _hazir(provider, 1),
        mesaj="ilk talep sağlayıcı çağrısına ulaşmalı",
    )
    # İlk talep REFUNDING'de asılıyken ikinci talep kapıdan girer.
    t2 = asyncio.create_task(_cayma(sip.order_id))

    async def _iki_talep_var() -> bool:
        return len(await fab.iade_satirlari(sip.order_id)) >= 2

    await _bekle(_iki_talep_var, mesaj="ikinci talep de kabul edilmeli (kusurun kendisi)")
    provider.refund_gate.set()
    sonuclar = await asyncio.gather(t1, t2, return_exceptions=True)
    _yalniz_beklenenler(sonuclar)

    toplam = sum(a for _, a in provider.refund_calls)
    assert toplam <= sip.total, (
        f"KNOWN-RED(İP2A-04): sağlayıcıya giden iade toplamı {toplam} TL — "
        f"ödenen {sip.total} TL; eşzamanlı CAYMA talepleri kümülatif tavanı "
        "deldi (PENDING-only unique + kilitsiz tavan okuması)"
    )


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

    kapi = asyncio.Event()
    orijinal_kilit = order_service._lock_order

    async def kapili_kilit(db, order):
        await kapi.wait()
        return await orijinal_kilit(db, order)

    monkeypatch.setattr(order_service, "_lock_order", kapili_kilit)

    async def onayla():
        async with AsyncSessionLocal() as db:
            return await order_service.approve_return(db, talep.id, admin_note="onay")

    t1 = asyncio.create_task(onayla())
    await asyncio.sleep(0.1)  # approve guard'ı PENDING okudu, kilit kapısında

    # Reject _lock_order kullanmaz (kusurun parçası) → kapıdan etkilenmez.
    async with AsyncSessionLocal() as db:
        await order_service.reject_return(db, talep.id, admin_note="kanıt yetersiz")
    assert (await fab.iade_satirlari(sip.order_id))[0]["status"] == "REJECTED"

    kapi.set()
    sonuclar = await asyncio.gather(t1, return_exceptions=True)
    # Approve tarafı bugün ayrıca İP2A-18 (restock'ta MissingGreenlet) ile
    # düşer — bu testin iddiası ondan önce gerçekleşen durum ezmesi ve para
    # çıkışıdır; İP2A-18'in kırmızısı R-18'dir.
    _yalniz_beklenenler(sonuclar, ip2a18_tolere=True)

    satir = (await fab.iade_satirlari(sip.order_id))[0]
    assert satir["status"] == "REJECTED", (
        "KNOWN-RED(İP2A-07): REJECTED kararın üstüne approve akışı "
        f"'{satir['status']}' yazdı — talep durumu için atomik claim yok, "
        "_settle_return koşulsuz APPROVED atıyor"
    )
    assert provider.refund_calls == [], (
        "KNOWN-RED(İP2A-07): reddedilmiş talep için sağlayıcıya para emri gitti"
    )
