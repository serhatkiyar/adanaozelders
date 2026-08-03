"""İP-2b — sipariş iptalinin teslimat turu/durağı/outbox üzerindeki etkileri
(GERÇEK PostgreSQL, gerçek servis katmanı).

Sözleşme: docs/ip2b-siparis-iptal-telafi-sozlesme.md §7

Mevcut yeşil kapsamla (test_delivery_invariants_pg: iptal açık durağı kapatır,
kaçak durak turu bloklamaz) ÇAKIŞMAZ; buradaki testler o dosyada ölçülmeyen
boşlukları hedefler: kaçak durakta OTP/verify, iptal sonrası bayat outbox
SMS'i, iptal ↔ tura-ekleme yarışı ve hazırlama damgasının iptalde asılı kalması.
"""
from __future__ import annotations

import asyncio
import contextlib
import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core import outbox
from core.database import AsyncSessionLocal
from services import delivery_service, order_service

pytestmark = pytest.mark.asyncio


async def _iptal(oid: int):
    async with AsyncSessionLocal() as s:
        order = await order_service._load_full(s, oid)
        return await order_service.cancel_by_client(s, order)


async def _bekleyen_durak(oid: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM delivery_stops "
                    "WHERE order_id = :o AND status = 'PENDING'"
                ),
                {"o": oid},
            )
        ).scalar_one()


# ── Hazırlama durumu ────────────────────────────────────────────────────────────


async def test_kirmizi_hazirlanmis_siparis_iptali_damgayi_sokmeli(fab, provider):
    """[IP2B-R13] Hazırlanmış (toplanmış+etiketlenmiş) PAID siparişin iptali
    fiziksel geri almayı İZLEMELİ: asgari ölçülebilir sözleşme, `prepared_at`
    damgasının temizlenmesidir (başarısız teslim yolunun yaptığı gibi —
    `roll_promise_after_failed_attempt` damgayı sıfırlar).

    Bugün damga asılı kalır: paket masada, defter kitabı rafta sayar
    (SALE_CANCEL yazıldı), hiçbir kuyruk/iş emri paketi sökmeyi söylemez.
    Not: F30/OrderPackage üretimde YOKTUR — test mevcut `prepared_at` modeline
    göre ölçer; paket sökme iş emri tasarımı ürün kararıdır (sözleşme §8.4)."""
    pid = await fab.urun(stock=5)
    oid, _ = await fab.siparis(
        items=[(pid, 2, "PHYSICAL", "100.00")], prepared=True
    )

    await _iptal(oid)
    assert (await fab.siparis_durumu(oid))[0] == "CANCELLED"
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 2)]

    async with AsyncSessionLocal() as s:
        hazir = (
            await s.execute(
                text("SELECT prepared_at FROM orders WHERE id = :o"), {"o": oid}
            )
        ).scalar_one()
    assert hazir is None, (
        "iptal edilen siparişin hazırlama damgası asılı kaldı — paketlenmiş "
        "kitap fiziksel olarak rafta DEĞİLKEN defter rafta sayıyor ve hiçbir "
        "operasyonel sinyal üretilmedi"
    )


# ── Kaçak durakta teslim aksiyonları ────────────────────────────────────────────


async def test_yesil_cancelled_siparisin_duragi_teslim_edilemez(fab, provider):
    """Eski QR/OTP ile teslim engellenir: CANCELLED siparişin (kaçak) PENDING
    durağında `verify_delivery` FSM duvarına çarpar — durak DELIVERED olmaz,
    sipariş CANCELLED kalır. (Son savunma hattının nöbetçisi.)"""
    pid = await fab.urun(stock=4)
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], prepared=True)
    await _iptal(oid)
    run_id = await fab.run(status="ACTIVE")
    stop_id = await fab.durak(run_id=run_id, order_id=oid, otp_code="123456")

    with pytest.raises(HTTPException) as exc:
        async with AsyncSessionLocal() as s:
            await delivery_service.verify_delivery(s, stop_id, code="123456")
    assert exc.value.status_code == 409

    async with AsyncSessionLocal() as s:
        st = (
            await s.execute(
                text("SELECT status FROM delivery_stops WHERE id = :s"),
                {"s": stop_id},
            )
        ).scalar_one()
    assert st != "DELIVERED"
    assert (await fab.siparis_durumu(oid))[0] == "CANCELLED"


async def test_kirmizi_cancelled_siparise_teslim_otp_smsi_gitmez(fab, provider, sms_kayit):
    """[IP2B-R14] Kaçak PENDING durakta `send_otp` sipariş durumuna hiç bakmaz:
    iptal edilmiş siparişin müşterisine 'teslimat kodun' SMS'i gider, kurye
    kapıya yönlendirilir, 409 ancak kod doğrulanırken görülür.

    Sözleşme: teslim aksiyon zinciri kapının EN BAŞINDA (send_otp/scan) sipariş
    yaşam döngüsünü doğrulamalı — 409 dönmeli, SMS atılmamalı."""
    pid = await fab.urun(stock=4)
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], prepared=True)
    await _iptal(oid)
    run_id = await fab.run(status="ACTIVE")
    stop_id = await fab.durak(run_id=run_id, order_id=oid)

    kod_409 = False
    try:
        async with AsyncSessionLocal() as s:
            await delivery_service.send_otp(s, stop_id)
    except HTTPException as exc:
        kod_409 = exc.status_code == 409

    assert kod_409, "iptal edilmiş siparişin durağına OTP akışı kabul edildi"
    assert sms_kayit.mesajlar == [], (
        f"iptal edilmiş siparişin müşterisine {len(sms_kayit.mesajlar)} SMS gitti: "
        f"{[m[1][:40] for m in sms_kayit.mesajlar]}"
    )


# ── Bayat outbox olayları ───────────────────────────────────────────────────────


async def test_kirmizi_iptal_bekleyen_takip_smsini_iptal_eder(fab, provider, sms_kayit):
    """[IP2B-R15] Tur başladı → 'kuryen yola çıktı' SMS'i outbox'a yazıldı ama
    henüz GÖNDERİLMEDİ (worker gecikmesi / sessiz saat ertelemesi). Sipariş bu
    arada iade edildi ve durağı kapatıldı. Sözleşme: iade/iptal, siparişin
    kuyruktaki teslimat SMS'lerini de geçersiz kılmalı — müşteriye 'kuryen
    yolda' SMS'i GİTMEMELİ.

    Bugün outbox olayı iptal edilmez; dispatch olayı aynen gönderir."""
    pid = await fab.urun(stock=4)
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], prepared=True)
    run_id = await fab.run(status="PLANNED")
    await fab.durak(run_id=run_id, order_id=oid)

    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run_id)  # SHIPPED + sms:tracking_link
    assert ("sms:tracking_link", "PENDING") in await fab.outbox_olaylari(oid)

    async with AsyncSessionLocal() as s:
        # Gerekçe ZORUNLU (İP-2b R3).
        await order_service.refund_order(
            s, oid, reason="Kuyruktaki SMS nöbetçisi: iade"
        )  # REFUNDED + durak CANCELLED
    assert (await fab.siparis_durumu(oid)) == ("REFUNDED", "REFUNDED")

    async with AsyncSessionLocal() as s:
        await outbox.dispatch_pending(s)

    takip_smsleri = [m for m in sms_kayit.mesajlar if "takip" in m[1] or "dağıtıma" in m[1]]
    assert takip_smsleri == [], (
        "iade edilmiş siparişin müşterisine kuyruktaki 'kuryen yola çıktı' "
        f"SMS'i gönderildi: {takip_smsleri[0][1][:60]!r}"
    )


# ── İptal ↔ tura ekleme yarışı ──────────────────────────────────────────────────
#
# TABAN KAYMASI NOTU (merge 45c95b8 — F30 zemini alındıktan sonra)
# ─────────────────────────────────────────────────────────────────
# Bu nöbetçinin eski hâli [IP2B-R16] `add_stops`'un siparişi KİLİTSİZ okuduğu
# (`db.get`) üretim kusurunu ölçüyordu ve kurgusu doğrudan o kusura yaslanıyordu:
# `_has_open_stop` monkeypatch'lenip kapıda bekletiliyor, "add_stops kilit
# tutmadığından iptal bloklanmaz" varsayımıyla iptal aynı anda koşturuluyordu.
#
# F30 (`delivery_service.add_stops` → `_lock_orders_ascending`) bu kusuru
# KAPATTI: sipariş satırları artan `order_id` sırasında `FOR UPDATE` ile
# kilitlenir, uygunluk kontrolü kilit ALTINDA taze durumla yapılır. Eski kurgu
# bu sözleşmede dairesel bekleme üretiyordu — add_stops kilidi kapıda tutarken
# testin `_iptal` çağrısı aynı satırı istiyor, `statement_timeout` doluyor,
# askıda kalan task + açık transaction teardown'ı da düşürüyor ve her koşumda
# order/product/stock_movement/delivery_run satırı sızdırıyordu.
#
# Nöbetçi bu yüzden İŞ INVARIANT'ına göre yeniden yazıldı; assertion
# GEVŞETİLMEDİ, tersine güçlendirildi (aşağıdaki yasak bileşim iki başlatma
# yönünde de ölçülür). Ayrıntı: docs/ip2b-siparis-iptal-telafi-sozlesme.md §7.

KILIT_ZAMAN_ASIMI = "4s"
YARIS_TURLARI = 3


def _beklenen_ret(exc: BaseException) -> bool:
    return isinstance(exc, HTTPException) and exc.status_code in (400, 404, 409, 422)


def _kilit_hatasi_yok(sonuclar) -> None:
    """Deadlock / kilit / ifade zaman aşımı KUSURDUR — 'başarı' sayılamaz.

    Eski R16 tam da buraya düşmüştü: zaman aşımı testi askıda bırakıp teardown'ı
    düşürüyordu. Artık üç SQLSTATE de açık mesajla testi KIRAR."""
    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        kod = getattr(getattr(r, "orig", None), "sqlstate", None) or ""
        if kod == "40P01":
            pytest.fail(f"DEADLOCK (40P01) — kilit sırası bozuk: {r}")
        if kod in ("55P03", "57014"):
            pytest.fail(
                f"KİLİT/İFADE ZAMAN AŞIMI ({kod}) — dairesel bekleme: {r}"
            )
        if not _beklenen_ret(r):
            raise r


class _Kayit:
    """Görevin backend PID'ini taşıyan kutu (kilit gözlemi için)."""

    pid: int | None = None


async def _yaris_gorevi(kayit: _Kayit, fn):
    """Görevi KENDİ session'ında, sonlu `lock_timeout` ile koşturur.

    `finally` rollback+close: test başarısız olsa bile açık transaction ya da
    kilitli bağlantı havuza dönmez."""
    s = AsyncSessionLocal()
    try:
        await s.execute(text(f"SET LOCAL lock_timeout = '{KILIT_ZAMAN_ASIMI}'"))
        kayit.pid = (await s.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        return await fn(s)
    finally:
        await s.rollback()
        await s.close()


async def _bitene_ya_da_kilide_takilana_dek(kayit: _Kayit, gorev, etiket: str) -> str:
    """Görev BİTENE ya da backend'i SATIR KİLİDİNDE bekler duruma gelene dek bekler.

    Sabit bir `sleep` ile "herhâlde bloklanmıştır" demek tesadüfe yaslanırdı;
    burada beklenen şey gerçek bir DURUM (`pg_stat_activity.wait_event_type`),
    tavan ise yalnız sonsuz döngü emniyetidir. Dönen: 'bitti' | 'kilitte'."""
    son = None
    for _ in range(500):                      # 500 × 20 ms = 10 sn tavan
        if gorev.done():
            return "bitti"
        if kayit.pid is not None:
            async with AsyncSessionLocal() as s:
                son = (
                    await s.execute(
                        text(
                            "SELECT wait_event_type FROM pg_stat_activity "
                            "WHERE pid = :p"
                        ),
                        {"p": kayit.pid},
                    )
                ).scalar_one_or_none()
            if son == "Lock":
                return "kilitte"
        await asyncio.sleep(0.02)
    pytest.fail(f"{etiket}: ne bitti ne kilide takıldı (wait_event_type={son})")


async def _durak_durumlari(oid: int) -> list[str]:
    """Siparişin duraklarının durumları — TAZE, bağımsız session'dan."""
    async with AsyncSessionLocal() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT status FROM delivery_stops WHERE order_id = :o "
                    "ORDER BY id"
                ),
                {"o": oid},
            )
        ).all()
    return [r[0] for r in rows]


def _basarili(x) -> bool:
    return not isinstance(x, BaseException)


@pytest.mark.parametrize("ters", [False, True], ids=["ekleme_once", "iptal_once"])
async def test_yesil_iptal_ile_tura_ekleme_yarisi_acik_durak_birakmaz(
    fab, provider, monkeypatch, ters
):
    """İptal ↔ tura ekleme yarışının HER sıralamasında yasak bileşim doğmamalı:

        order = CANCELLED  ve  delivery_stop = PENDING

    Böyle bir durak sahada OTP/teslim zincirine girer (IP2B-R14 ile birleşince
    müşteriye SMS de gider) ve `_has_open_stop` yüzünden sipariş bir daha hiçbir
    tura giremez.

    ## Neden iki yön AYRI kurgu ister

    Yalnız `asyncio.gather` ile başlatmak yetmez: ölçüldü, `add_stops`'un Order
    kilidi KALDIRILDIĞINDA bile doğal serpiştirme tehlikeli pencereyi
    açmıyordu, yani test mutasyonu görmüyordu. Bu yüzden her yön kendi
    DETERMİNİSTİK bariyerini kurar (`sleep` ile tahmin YOK — beklenen şey her
    zaman gerçek bir durum):

    * **ekleme_once** — kapı `_has_open_stop`'ta, yani `add_stops` sipariş
      kilidini ALDIKTAN sonra. İptal bu pencerede başlatılır ve *bitene ya da
      satır kilidinde bekler duruma gelene* dek gözlenir. Kilit varsa iptal
      bekler (kapı açılınca durak yazılır, iptal onu kapatır); kilit YOKSA
      iptal pencerenin içinde tamamlanır ve `add_stops` ölü siparişe PENDING
      durak yazar → yasak bileşim.
    * **iptal_once** — kapı `_lock_orders_ascending`'in ÖNÜNDE, yani sipariş
      kilidi alınmadan. İptal bu pencerede TAMAMEN biter (commit'li). Kapı
      açılınca `add_stops` kilidi alır ve durumu KİLİT ALTINDA yeniden okumak
      zorundadır; bayat okumaya güvenirse ölü siparişe durak yazar.

    Kim kazandığı SONUÇTAN okunur, sonra o gözleme karşılık gelen TEK son durum
    iddia edilir ("şu veya bu" biçimli iddia, iki işlem de sessizce no-op'a
    düşse yine geçerdi):

    * **ekleme kazanır** → durak yazılır, ardından iptal onu kanonik kapanışa
      (`CANCELLED`, `FAILED` değil — kurye metriğine sayılmaz) alır;
    * **iptal kazanır** → `add_stops` taze durumu görür ve 409 ile reddeder;
      hiç durak yazılmaz.
    """
    for tur in range(YARIS_TURLARI):
        pid = await fab.urun(stock=4)
        oid, _ = await fab.siparis(
            items=[(pid, 1, "PHYSICAL", "100.00")], prepared=True
        )
        run_id = await fab.run(
            status="PLANNED",
            run_date=datetime.date.today() + datetime.timedelta(days=tur),
        )

        async def _ekle(s, _oid=oid, _run_id=run_id):
            return await delivery_service.add_stops(s, _run_id, [_oid])

        async def _iptal_et(s, _oid=oid):
            order = await order_service._load_full(s, _oid)
            return await order_service.cancel_by_client(s, order)

        kapida, devam = asyncio.Event(), asyncio.Event()
        ek_kayit, ip_kayit = _Kayit(), _Kayit()

        if ters:
            # iptal_once: kapı sipariş kilidinin ÖNÜNDE.
            gercek = delivery_service._lock_orders_ascending

            async def _kapili(db, order_ids, _g=gercek):
                kapida.set()
                await devam.wait()
                return await _g(db, order_ids)

            monkeypatch.setattr(
                delivery_service, "_lock_orders_ascending", _kapili
            )
        else:
            # ekleme_once: kapı sipariş kilidi ALINDIKTAN sonra.
            gercek = delivery_service._has_open_stop

            async def _kapili(db, order_id, _g=gercek):
                r = await _g(db, order_id)
                kapida.set()
                await devam.wait()
                return r

            monkeypatch.setattr(delivery_service, "_has_open_stop", _kapili)

        ekleme = asyncio.create_task(_yaris_gorevi(ek_kayit, _ekle))
        gozlem = "-"
        try:
            # Kapı hiç açılmazsa (mutasyonda ilgili çağrı yoksa) senaryo yine
            # geçerlidir: aşağıdaki iddialar son duruma bakar, kapıya değil.
            with contextlib.suppress(TimeoutError, asyncio.TimeoutError):
                await asyncio.wait_for(kapida.wait(), timeout=5)
            if ters:
                iptal_sonuc = await _yaris_gorevi(ip_kayit, _iptal_et)
                iptal_gorev = None
            else:
                iptal_gorev = asyncio.create_task(
                    _yaris_gorevi(ip_kayit, _iptal_et)
                )
                gozlem = await _bitene_ya_da_kilide_takilana_dek(
                    ip_kayit, iptal_gorev, "iptal"
                )
        finally:
            devam.set()
            if ters:
                ekleme_sonuc = (
                    await asyncio.gather(ekleme, return_exceptions=True)
                )[0]
            else:
                ekleme_sonuc, iptal_sonuc = await asyncio.gather(
                    ekleme, iptal_gorev, return_exceptions=True
                )
        monkeypatch.undo()

        sonuc = {"ekleme": ekleme_sonuc, "iptal": iptal_sonuc}
        _kilit_hatasi_yok(sonuc.values())

        durum, _odeme = await fab.siparis_durumu(oid)
        duraklar = await _durak_durumlari(oid)
        acik = [d for d in duraklar if d == "PENDING"]

        # ── Yasak bileşim: her iki yönde de ──
        assert not (durum == "CANCELLED" and acik), (
            f"tur {tur} ({'iptal_once' if ters else 'ekleme_once'}, "
            f"gözlem={gozlem}): CANCELLED siparişe BEKLEYEN durak kaldı — "
            f"duraklar={duraklar}, sonuç={sonuc}"
        )

        # İptal bu yarışta her zaman kazanabilmeli (add_stops PLANNED turda
        # sipariş durumunu değiştirmez, yani iptali kapatan bir hâl doğmaz).
        assert _basarili(sonuc["iptal"]), (
            f"tur {tur}: müşteri iptali beklenmedik şekilde reddedildi: "
            f"{sonuc['iptal']!r}"
        )
        assert durum == "CANCELLED", (durum, sonuc)

        if _basarili(sonuc["ekleme"]):
            assert duraklar == ["CANCELLED"], (
                f"tur {tur}: durak eklendi ama iptal onu kanonik kapanışa "
                f"almadı: {duraklar}"
            )
        else:
            assert _beklenen_ret(sonuc["ekleme"]), sonuc["ekleme"]
            assert sonuc["ekleme"].status_code == 409, sonuc["ekleme"]
            assert duraklar == [], (
                f"tur {tur}: add_stops reddedildi ama yine de durak yazıldı: "
                f"{duraklar}"
            )
