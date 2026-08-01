"""F30 (paketleme + QR) testleri için gerçek veri fabrikası.

`inventory_factory.Fabrika`'yı genişletir: kendi-filo teslimatı için gereken
`ship_*` alanları, ÇOK KALEMLİ sipariş, barkodlu ürün, kurye ve dağıtım turu.

İki kural (denetçi notu 9):

* Sipariş ve kalemler **gerçek** `orders` / `order_items` satırlarıdır; SALE
  hareketi gerçek `stock_ledger` üzerinden yazılır — yani ürün fiziksel olarak
  işletmede, satılabilir stoktan düşmüş durumdadır (`PHYSICAL_EFFECT["SALE"]`).
* **Durum geçişleri fabrikada YAPILMAZ.** Testler `order_fsm.transition_order`,
  `order_service.cancel_by_client`, `delivery_service.fail_stop` gibi gerçek
  servis yollarını çağırır; fabrika yalnız başlangıç durumunu kurar. Ham SQL ile
  durum yazmak, F30'un tam da ölçmek istediği geçiş mantığını atlardı.

Teardown **yalnız bu fabrikanın ürettiği satırları** siler ve kapsamı her zaman
üretilen kimlik listelerinden (sipariş / paket / durak / tur / kurye / müşteri)
türetir. Tabloların tamamını boşaltmak (`DELETE FROM package_scan_events`) daha
kolay olurdu ama aynı anda koşan başka bir testin izini de silerdi; o test kendi
verisini bulamadığında hata "flaky" görünür ve sebebi aylarca bulunamaz.

`package_scan_events` append-only'dir (UPDATE/DELETE trigger'la reddedilir) ve
`package_id` FK'si `RESTRICT`'tir; bu yüzden paket temizliği doğrudan değil
`db_guard.purge_packages` üzerinden yapılır — trigger YALNIZ test
veritabanında, yalnız o işlem için geçici kapatılır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.store import Order, OrderItem
from services import stock_ledger
from tests.integration.db_guard import purge_packages
from tests.integration.inventory_factory import Fabrika, now, uniq

__all__ = ["PaketFabrikasi", "now", "uniq"]


class PaketFabrikasi(Fabrika):
    def __init__(self) -> None:
        super().__init__()
        self.run_ids: list[int] = []
        self.courier_ids: list[int] = []
        self.courier_account_ids: list[int] = []

    # ── Ürün ────────────────────────────────────────────────────────────────

    async def barkodlu_urun(self, *, stock: int = 10, barcode: str | None = None) -> tuple[int, str, str]:
        """(product_id, sku, barcode) döner.

        `sku` DB trigger'ı tarafından üretilir (`FZK-000042`) — taklit edilemez,
        bu yüzden okunarak döndürülür. `barcode` yalnız insan girdisiyle dolar
        (`models/store.py:254-261`); testte açıkça verilir.
        """
        ean = barcode or f"869{uniq()[:10]}"
        pid = await self.urun(stock=stock)
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE products SET barcode = :b WHERE id = :i"),
                {"b": ean, "i": pid},
            )
            await s.commit()
            sku = (
                await s.execute(
                    text("SELECT sku FROM products WHERE id = :i"), {"i": pid}
                )
            ).scalar_one()
        return pid, sku, ean

    # ── Sipariş ─────────────────────────────────────────────────────────────

    async def fiziksel_siparis(
        self,
        *,
        kalemler: list[tuple[int, int]],
        status: str = "PAID",
        payment_status: str = "PAID",
        prepared: bool = False,
        in_zone: bool = True,
        client_id: int | None = None,
        sale_yaz: bool = True,
    ) -> int:
        """Kendi-filo teslimatına uygun, çok kalemli ödenmiş sipariş.

        `kalemler`: `[(product_id, quantity), ...]`. Kendi-filo kuyruklarının
        aradığı alanların hepsi doldurulur: `has_physical`, `ship_in_zone`,
        `ship_lat/lng`, `ship_recipient/phone/address`
        (`delivery_service.prep_queue` / `eligible_orders`).
        """
        cid = client_id if client_id is not None else await self.musteri()
        u = uniq()
        async with AsyncSessionLocal() as s:
            o = Order(
                client_id=cid,
                subtotal=Decimal("100.00"),
                total=Decimal("100.00"),
                status=status,
                payment_status=payment_status,
                track_token=uniq() + uniq(),
                has_physical=True,
                ship_recipient=f"Paket Testi {u}",
                ship_phone="05000000000",
                ship_address="Test mahallesi 1. sokak",
                ship_city="Adana",
                ship_district="Seyhan",
                ship_in_zone=in_zone,
                ship_lat=Decimal("37.000000"),
                ship_lng=Decimal("35.320000"),
                promised_delivery_date=datetime.date.today(),
                prepared_at=now() if prepared else None,
                prepared_by="fixture" if prepared else None,
            )
            s.add(o)
            await s.flush()
            for pid, qty in kalemler:
                s.add(
                    OrderItem(
                        order_id=o.id,
                        product_id=pid,
                        title=f"Paket Kalemi {pid}",
                        unit_price=Decimal("100.00"),
                        quantity=qty,
                        kind="PHYSICAL",
                        seller_type="PLATFORM",
                    )
                )
            await s.flush()
            oid = o.id
            satirlar = (
                await s.execute(
                    text(
                        "SELECT id, product_id, quantity FROM order_items "
                        "WHERE order_id = :o ORDER BY id"
                    ),
                    {"o": oid},
                )
            ).all()
            await s.commit()
        self.order_ids.append(oid)
        if sale_yaz and payment_status == "PAID":
            async with AsyncSessionLocal() as s:
                for satir in satirlar:
                    await stock_ledger.apply_movement(
                        s,
                        satir.product_id,
                        qty_delta=-satir.quantity,
                        bucket=stock_ledger.StockBucket.SALEABLE,
                        movement_type=stock_ledger.StockMovementType.SALE,
                        reason_code="ORDER_PAID",
                        ref_type="order",
                        ref_id=oid,
                        ref_line_id=satir.id,
                        idempotency_key=stock_ledger.idempotency_key_for(
                            stock_ledger.StockMovementType.SALE,
                            order_item_id=satir.id,
                        ),
                    )
                await s.commit()
        return oid

    async def kalem_idleri(self, order_id: int) -> list[int]:
        async with AsyncSessionLocal() as s:
            return list(
                (
                    await s.execute(
                        text(
                            "SELECT id FROM order_items WHERE order_id = :o ORDER BY id"
                        ),
                        {"o": order_id},
                    )
                ).scalars()
            )

    async def siparis_durumu(self, order_id: int) -> tuple[str, str]:
        async with AsyncSessionLocal() as s:
            satir = (
                await s.execute(
                    text("SELECT status, payment_status FROM orders WHERE id = :i"),
                    {"i": order_id},
                )
            ).one()
        return satir.status, satir.payment_status

    async def prepared_at(self, order_id: int):
        async with AsyncSessionLocal() as s:
            return (
                await s.execute(
                    text("SELECT prepared_at FROM orders WHERE id = :i"),
                    {"i": order_id},
                )
            ).scalar_one()

    # ── Kurye + tur ─────────────────────────────────────────────────────────

    async def kurye(self) -> int:
        from models.courier import Courier

        async with AsyncSessionLocal() as s:
            c = Courier(
                name=f"Paket Kurye {uniq()}",
                phone="05001112233",
                vehicle_plate=f"01{uniq()[:5].upper()}",
                is_active=True,
            )
            s.add(c)
            await s.flush()
            kid = c.id
            await s.commit()
        self.courier_ids.append(kid)
        return kid

    async def kurye_hesabi(self, courier_id: int) -> tuple[int, str]:
        """Kurye giriş hesabı + geçerli access token. (account_id, token)

        `auth_version` token'a `auth_ver` claim'i olarak basılır ve her istekte
        DB ile karşılaştırılır (`api/deps.py:65-68`); uyuşmazsa token anında ölür.
        """
        from core.security import create_access_token
        from models.courier_account import CourierAccount

        u = uniq()
        async with AsyncSessionLocal() as s:
            hesap = CourierAccount(
                email=f"kurye-{u}@paket.test",
                hashed_password="test-only",
                first_name="Paket",
                last_name="Kurye",
                username=f"pk{u}",
                role_id=5,
                courier_id=courier_id,
                is_active=True,
                auth_version=1,
            )
            s.add(hesap)
            await s.flush()
            hid = hesap.id
            await s.commit()
        self.courier_account_ids.append(hid)
        return hid, create_access_token(
            subject=hid, role="COURIER", role_id=5, auth_version=1
        )

    async def tur(self, *, courier_id: int | None = None, status: str = "PLANNED") -> int:
        from models.delivery import DeliveryRun

        async with AsyncSessionLocal() as s:
            r = DeliveryRun(
                run_date=datetime.date.today(),
                status=status,
                courier_id=courier_id,
                vehicle="LADA",
            )
            s.add(r)
            await s.flush()
            rid = r.id
            await s.commit()
        self.run_ids.append(rid)
        return rid

    # ── Temizlik ────────────────────────────────────────────────────────────

    async def temizle(self) -> None:
        """Üretilen HER satırı geri alır — ve **yalnız** onları.

        Kapsam kimlik listelerinden türetilir: paketler bu fabrikanın
        siparişlerinden, audit satırları o paket/durak/tur/sipariş kimliklerinden,
        outbox satırları o sipariş kimliklerinden, bildirimler bu fabrikanın
        müşterilerinden. Hiçbir adım "tabloyu boşalt" demez.

        Sıra önemlidir: paketleme audit'i paket kimliğine dayandığı için
        paketler silinmeden ÖNCE temizlenir. Kurye aktörlü audit satırları
        `Fabrika.temizle()` tarafından kapsanmaz (o yalnız `actor_role = 1`
        siler) — zimmet kurye adına audit yazdığı için burada ayrıca silinir.
        """
        async with AsyncSessionLocal() as s:
            paket_ids: list[int] = []
            stop_ids: list[int] = []
            if self.order_ids:
                paket_ids = list(
                    (
                        await s.execute(
                            text(
                                "SELECT id FROM order_packages WHERE order_id = ANY(:i)"
                            ),
                            {"i": self.order_ids},
                        )
                    ).scalars()
                )
                stop_ids = list(
                    (
                        await s.execute(
                            text(
                                "SELECT id FROM delivery_stops WHERE order_id = ANY(:i)"
                                " OR run_id = ANY(:r)"
                            ),
                            {"i": self.order_ids, "r": self.run_ids or [0]},
                        )
                    ).scalars()
                )
                # Paketleme audit'i — HEDEF kimliğine göre; `action LIKE
                # 'package.%'` süzgeci tek başına kullanılırsa başka testin
                # (ve gerçek verinin) satırları da silinirdi.
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE action LIKE 'package.%' AND ("
                        "  (target_type = 'order_package' AND target_id = ANY(:p))"
                        "  OR (target_type = 'order' AND target_id = ANY(:i))"
                        "  OR (target_type = 'delivery_stop' AND target_id = ANY(:s))"
                        "  OR (target_type = 'delivery_run' AND target_id = ANY(:r))"
                        ")"
                    ),
                    {
                        "p": paket_ids or [0],
                        "i": self.order_ids,
                        "s": stop_ids or [0],
                        "r": self.run_ids or [0],
                    },
                )
                await s.commit()
            # `package_scan_events` append-only + FK RESTRICT → ortak, test
            # veritabanıyla sınırlı yardımcı üzerinden (kendi commit'ini atar).
            await purge_packages(s, paket_ids)
            if self.order_ids:
                await s.execute(
                    text("DELETE FROM delivery_stops WHERE order_id = ANY(:i)"),
                    {"i": self.order_ids},
                )
                # Zimmet/teslim akışı bildirim ve SMS outbox satırı üretir.
                # Tablo adı `outbox_events`'tir (`models/outbox.py:33`);
                # `outbox_messages` diye bir tablo YOKTUR. Karşılaştırma metin
                # üzerinden yapılır — `::int` cast'i sayısal olmayan bir
                # payload'da bütün teardown'ı düşürürdü.
                await s.execute(
                    text(
                        "DELETE FROM outbox_events "
                        "WHERE payload ->> 'order_id' = ANY(:i)"
                    ),
                    {"i": [str(o) for o in self.order_ids]},
                )
                await s.execute(
                    text(
                        "DELETE FROM notifications WHERE user_id = ANY(:c) "
                        "AND role_id = 3"
                    ),
                    {"c": self.client_ids or [0]},
                )
            if self.run_ids:
                await s.execute(
                    text("DELETE FROM delivery_stops WHERE run_id = ANY(:i)"),
                    {"i": self.run_ids},
                )
                await s.execute(
                    text("DELETE FROM delivery_runs WHERE id = ANY(:i)"),
                    {"i": self.run_ids},
                )
            if self.courier_account_ids:
                # Kurye aktörlü audit (zimmet) — `Fabrika.temizle()` yalnız
                # actor_role = 1 siler, bu satırlar orada kapsanmaz.
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_id = ANY(:i) "
                        "AND actor_role = 5"
                    ),
                    {"i": self.courier_account_ids},
                )
                await s.execute(
                    text("DELETE FROM courier_accounts WHERE id = ANY(:i)"),
                    {"i": self.courier_account_ids},
                )
            if self.courier_ids:
                await s.execute(
                    text("DELETE FROM couriers WHERE id = ANY(:i)"),
                    {"i": self.courier_ids},
                )
            await s.commit()
        await super().temizle()
