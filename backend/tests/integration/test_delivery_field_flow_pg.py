"""Saha teslim zinciri uçtan uca — GERÇEK Postgres.

Mevcut testler bu akışın PARÇALARINI kapsıyordu (watchdog, ETA kayması,
invariant'lar, yarışlar) ama kuryenin fiilen yaptığı sıra hiç baştan sona
koşulmamıştı: turu başlat → paket QR'ını okut → müşteriye OTP gönder →
kapıda kodu doğrula → sipariş DELIVERED. Ve karşı akış: teslim edilemedi →
sipariş PAID'e döner, söz ertesi güne kayar, sipariş yeniden kuyruğa girer.

Ayrıca burada **kapıda ödeme YOKTUR** ve olmadığı doğrulanır: dağıtımın her
yolu `payment_status == "PAID"` (online/escrow) şartına bağlıdır. Kapıdaki OTP
bir ödeme aracı değil, ALICI KİMLİĞİ kanıtıdır. Bu ayrımın testle sabitlenmesi
önemli: ileride "kapıda ödeme" eklenirse bu testin bilinçli olarak değişmesi
gerekir, sessizce kayması değil.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from core import sms
from core.database import AsyncSessionLocal
from models.client import Client
from models.store import Order
from schemas.delivery import DeliveryRunCreate
from services import delivery_service
from tests.integration.filo_yardim import arac_id

pytestmark = pytest.mark.asyncio


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class FieldFactory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []
        self.order_ids: list[int] = []
        self.run_ids: list[int] = []

    async def order(self, *, payment_status: str = "PAID", prepared: bool = True) -> int:
        async with AsyncSessionLocal() as s:
            u = _uniq()
            client = Client(
                email=f"c-{u}@field.test", hashed_password="x", first_name="Saha",
                last_name="Musteri", username=f"c{u}", role_id=3,
            )
            s.add(client)
            await s.flush()
            order = Order(
                client_id=client.id, status="PAID", payment_status=payment_status,
                subtotal=Decimal("100.00"), total=Decimal("100.00"), has_physical=True,
                ship_recipient="Saha Musteri", ship_address="Test adres",
                ship_phone="+905551112233", ship_in_zone=True,
                ship_lat=Decimal("37.0025"), ship_lng=Decimal("35.3210"),
                prepared_at=_now() if prepared else None,
                promised_delivery_date=datetime.date.today(),
            )
            s.add(order)
            await s.flush()
            self.client_ids.append(client.id)
            self.order_ids.append(order.id)
            await s.commit()
            return order.id

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            p = {
                "o": self.order_ids or [0],
                "r": self.run_ids or [0],
                "c": self.client_ids or [0],
            }
            for q in (
                "DELETE FROM outbox_events WHERE payload->>'order_id' = ANY("
                "SELECT unnest(:o)::text)",
                "DELETE FROM delivery_stops WHERE order_id = ANY(:o)",
                "DELETE FROM delivery_runs WHERE id = ANY(:r)",
                "DELETE FROM notifications WHERE user_id = ANY(:c) AND role_id = 3",
                "DELETE FROM order_status_history WHERE order_id = ANY(:o)",
                "DELETE FROM orders WHERE id = ANY(:o)",
                "DELETE FROM clients WHERE id = ANY(:c)",
            ):
                try:
                    await s.execute(text(q), p)
                except Exception:
                    await s.rollback()
            await s.commit()


@pytest.fixture
async def ff(pg):
    f = FieldFactory()
    yield f
    await f.cleanup()


@pytest.fixture
def otp_yakala(monkeypatch):
    """Teslim OTP'si yalnız SMS ile gider (DB'de hash'i durur). Kapıdaki kodu
    test edebilmek için gönderimi yakalıyoruz — üretimde bu kod hiçbir yanıtta
    dönmez."""
    kutu: dict[str, str] = {}

    async def _sahte(*, to: str, code: str, order_id: int) -> bool:
        kutu["code"] = code
        kutu["to"] = to
        return True

    monkeypatch.setattr(sms, "send_delivery_otp_sms", _sahte)
    monkeypatch.setattr(delivery_service.sms, "send_delivery_otp_sms", _sahte)
    return kutu


async def _tur_kur(ff: FieldFactory, order_ids: list[int]) -> int:
    async with AsyncSessionLocal() as s:
        run = await delivery_service.create_run(
            s,
            DeliveryRunCreate(
                run_date=datetime.date.today() + datetime.timedelta(days=600),
                vehicle_id=await arac_id(),
            ),
        )
        ff.run_ids.append(run.id)
        await delivery_service.add_stops(s, run.id, order_ids)
        await delivery_service.start_run(s, run.id)
        return run.id


async def test_teslim_edildi_zinciri(ff, otp_yakala):
    """Turu başlat → QR okut → OTP gönder → kapıda doğrula → DELIVERED."""
    order_id = await ff.order()
    run_id = await _tur_kur(ff, [order_id])

    async with AsyncSessionLocal() as s:
        run = await delivery_service.get_run(s, run_id)
        stop = run.stops[0]
        # Tur başlayınca sipariş dağıtımda + kendi-filo takip numarası verilir.
        assert run.status == "ACTIVE"
        assert stop.qr_payload.startswith(f"{stop.id}:")

        # 1) Paket etiketinin QR'ı doğru durağı bulmalı (yanlış paket kontrolü).
        tarama, tur_durumu = await delivery_service.scan(s, stop.qr_payload)
        assert tarama.id == stop.id and tur_durumu == "ACTIVE"

        # 2) OTP müşteriye gider; yanıt maskeli numara döner, KOD DÖNMEZ.
        maskeli, gonderildi = await delivery_service.send_otp(s, stop.id)
        assert gonderildi is True
        assert "***" in maskeli and otp_yakala["code"] not in maskeli
        kod = otp_yakala["code"]
        assert len(kod) == 6 and kod.isdigit()

        # 3) Yanlış kod teslim etmez, deneme sayacını artırır.
        with pytest.raises(HTTPException) as exc:
            await delivery_service.verify_delivery(s, stop.id, code="000000" if kod != "000000" else "111111")
        assert exc.value.status_code == 400

        # 4) Doğru kod: durak + sipariş DELIVERED, kanıt OTP.
        sonuc = await delivery_service.verify_delivery(
            s, stop.id, code=kod, lat=37.0025, lng=35.3210
        )
        assert sonuc.status == "DELIVERED" and sonuc.proof == "OTP"

    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, order_id)
        await s.refresh(siparis)
        assert siparis.status == "DELIVERED"
        assert siparis.delivered_at is not None
        # Teslim edilen sipariş artık uygunluk kuyruğunda olmamalı.
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
        assert order_id not in uygun


async def test_teslim_edilemedi_zinciri(ff):
    """Teslim edilemedi → durak FAILED, sipariş PAID'e döner, söz ertesi güne
    kayar, deneme sayacı artar.

    ÖNEMLİ ayrım: sipariş doğrudan tura hazır kuyruğuna DÖNMEZ. Paket fiilen
    depoya geri gelmiştir, bu yüzden `prepared_at` düşer ve sipariş HAZIRLAMA
    kuyruğuna girer. Yeniden tura ancak depo görevlisi paketi tekrar toplayıp
    etiketledikten sonra girer — fiziksel gerçeklik ile kayıt böyle hizalanır."""
    order_id = await ff.order()
    run_id = await _tur_kur(ff, [order_id])

    async with AsyncSessionLocal() as s:
        run = await delivery_service.get_run(s, run_id)
        stop_id = run.stops[0].id
        sonuc = await delivery_service.fail_stop(
            s, stop_id, reason="Zil çalmadı, kapı açılmadı", reason_code="EVDE_YOK"
        )
        assert sonuc.status == "FAILED" and sonuc.fail_reason == "EVDE_YOK"

    async with AsyncSessionLocal() as s:
        siparis = await s.get(Order, order_id)
        await s.refresh(siparis)
        assert siparis.status == "PAID", "sipariş yeniden planlanabilir olmalı"
        assert siparis.tracking_no is None
        assert siparis.failed_delivery_count == 1
        assert siparis.promised_delivery_date > datetime.date.today()
        assert siparis.prepared_at is None, "paket depoya döndü, hazırlık düşmeli"

        # Hazırlama kuyruğunda; tura hazır kuyruğunda DEĞİL.
        hazirlanacak = {o.order_id for o in await delivery_service.prep_queue(s)}
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
        assert order_id in hazirlanacak
        assert order_id not in uygun

    # F30 commit 5: "depo paketi yeniden hazırlar" adımı artık elle bir
    # damgayla DEĞİL, paketleme akışıyla olur (`open_package` → `scan` →
    # `complete`); `mark_prepared` kaldırıldı (sözleşme §3.5, boşluk G1).
    # Bu dosyanın konusu saha akışıdır, paketleme değil — o yolun kuyruğa
    # geri soktuğu `test_delivery_prep_pg.py::test_PAKET_TAMAMLANINCA_eligible_olur`
    # ve `test_f30_return_lifecycle_pg.py` ile ölçülür. Burada yalnız
    # başarısız denemenin siparişi HAZIRLAMA kuyruğuna düşürdüğü sabitlenir
    # (yukarıdaki iddialar), çünkü bu testin ayırt ettiği şey odur.


async def test_kapida_odeme_yok_odenmemis_siparis_dagitima_giremez(ff):
    """Bu sistemde KAPIDA ÖDEME YOKTUR: dağıtım yalnız online ödenmiş siparişi
    taşır. Ödenmemiş sipariş ne uygunluk kuyruğuna girer ne de tura eklenebilir.

    Kapıdaki OTP bir tahsilat aracı değil, alıcı kimliği kanıtıdır. Bu test o
    sınırı sabitler — kapıda ödeme eklenirse bilinçli olarak değişmelidir."""
    odenmemis = await ff.order(payment_status="PENDING")

    async with AsyncSessionLocal() as s:
        uygun = {o.order_id for o in await delivery_service.eligible_orders(s)}
        assert odenmemis not in uygun

        run = await delivery_service.create_run(
            s,
            DeliveryRunCreate(
                run_date=datetime.date.today() + datetime.timedelta(days=601),
                vehicle_id=await arac_id(),
            ),
        )
        ff.run_ids.append(run.id)
        with pytest.raises(HTTPException) as exc:
            await delivery_service.add_stops(s, run.id, [odenmemis])
        assert exc.value.status_code == 409
        assert "dağıtıma uygun değil" in str(exc.value.detail)


async def test_sonuclanmis_durak_ikinci_kez_teslim_edilemez(ff, otp_yakala):
    """Kurye ekranı yenilenip aynı butona iki kez basarsa ikinci teslim
    reddedilmeli (para/stok değil ama sipariş durumu geri sarılmamalı)."""
    order_id = await ff.order()
    run_id = await _tur_kur(ff, [order_id])

    async with AsyncSessionLocal() as s:
        run = await delivery_service.get_run(s, run_id)
        stop_id = run.stops[0].id
        await delivery_service.send_otp(s, stop_id)
        await delivery_service.verify_delivery(s, stop_id, code=otp_yakala["code"])

        with pytest.raises(HTTPException) as exc:
            await delivery_service.send_otp(s, stop_id)
        assert exc.value.status_code == 409
        assert "sonuçlanmış" in str(exc.value.detail)
