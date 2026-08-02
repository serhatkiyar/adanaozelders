"""F30 — YÖNETİCİ teslim/sevkiyat uçları zimmet kapısından geçer (gerçek PG + HTTP).

## Kapatılan açık

`POST /store/admin/orders/{id}/deliver` → `order_service.mark_delivered`,
`delivery_service._finalize_delivered` hunisinden geçmiyordu; yani commit 7'nin
ilk turunda saha uçlarına konan zimmet guard'ını **miras almıyordu**. Sonuç,
kutu hâlâ raftayken siparişin `DELIVERED` olmasıydı ve zarar tek bir yanlış
statüyle kalmıyordu:

* müşteriye "teslim edildi" e-postası (outbox olayı) gidiyor,
* durak `PENDING` kalıyor — kurye hâlâ o adrese gidecek,
* paket `PACKED` kaldığı için bir daha **zimmetlenemiyor**
  (`handover` yalnız `PACKED`→`HANDED_OVER`, ama sipariş artık `DELIVERED`),
* `uq_order_packages_live` yüzünden yeni paket de açılamıyor.

Kardeşi `POST /store/admin/orders/{id}/ship` de aynı sınıftandı: paketi olan
sipariş elle "kargolandı" işaretlenip elle takip numarası yazılabiliyordu —
oysa kendi-filo teslimatında `tracking_no` zimmet anında doğar.

## Ne ölçülüyor

Ret hâlinde **hiçbir yan etki kalmamalı**. Bu yüzden testler tek tek sayar:
sipariş durumu · durak durumu · paket durumu ve damgaları · `tracking_no` ·
`order_status_history` · `outbox_events` · `notifications` · `audit_logs`.
Toplu bir "değişmedi" iddiası, biri yazılırken bir diğeri yazılmadığında da
doğru görünürdü.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import delivery_service
from tests.integration.f30_factory import PaketFabrikasi

VIEW, PACK = "packing.view", "packing.pack"
ORDERS_MANAGE = "orders.manage"


def _bas(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


@pytest.fixture
async def kur(pg):
    from tests.integration.test_f30_packing_api_pg import Kurulum

    k = Kurulum()
    try:
        yield k
    finally:
        await k.temizle()


# ══════════════════════ Kurulum ══════════════════════════════════════════════


async def _packed_paket(client, token: str, fab: PaketFabrikasi):
    """Gerçek uçlardan geçmiş (`open` → `scan` → `complete`) PACKED paket."""
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    ).json()
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/scan",
        json={"code": ean, "idempotency_key": uuid.uuid4().hex},
        headers=_bas(token),
    )
    assert r.json()["result"] == "OK", r.text
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/complete", headers=_bas(token)
    )
    assert r.status_code == 200, r.text
    return oid, r.json()


async def _durak_id(order_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text("SELECT id FROM delivery_stops WHERE order_id = :o"), {"o": order_id}
            )
        ).scalar_one()


async def _tura_ekle(fab: PaketFabrikasi, oid: int):
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
    return kurye, run, await _durak_id(oid)


async def _durum(order_id: int, stop_id: int, package_id: int) -> dict:
    """Yan etkilerin TAMAMI — her biri ayrı ayrı sayılır."""
    async with AsyncSessionLocal() as s:
        siparis = (
            await s.execute(
                text("SELECT status, tracking_no, delivered_at FROM orders WHERE id = :o"),
                {"o": order_id},
            )
        ).one()
        paket = (
            await s.execute(
                text(
                    "SELECT status, handed_over_at, handed_to_courier_id "
                    "FROM order_packages WHERE id = :p"
                ),
                {"p": package_id},
            )
        ).one()
        return {
            "siparis_durumu": siparis[0],
            "tracking_no": siparis[1],
            "delivered_at": siparis[2],
            "paket_durumu": paket[0],
            "handed_over_at": paket[1],
            "handed_to_courier_id": paket[2],
            "durak_durumu": (
                await s.execute(
                    text("SELECT status FROM delivery_stops WHERE id = :i"), {"i": stop_id}
                )
            ).scalar_one(),
            "delivered_gecisi": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM order_status_history "
                        "WHERE order_id = :o AND new_status = 'DELIVERED'"
                    ),
                    {"o": order_id},
                )
            ).scalar_one(),
            "shipped_gecisi": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM order_status_history "
                        "WHERE order_id = :o AND new_status = 'SHIPPED'"
                    ),
                    {"o": order_id},
                )
            ).scalar_one(),
            "outbox": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM outbox_events "
                        "WHERE payload ->> 'order_id' = :o"
                    ),
                    {"o": str(order_id)},
                )
            ).scalar_one(),
            "bildirim": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM notifications "
                        "WHERE link = '/siparislerim' AND message LIKE :m"
                    ),
                    {"m": f"%#{order_id}%"},
                )
            ).scalar_one(),
            "audit": (
                await s.execute(
                    text(
                        "SELECT count(*) FROM audit_logs "
                        "WHERE target_type = 'order' AND target_id = :o"
                    ),
                    {"o": order_id},
                )
            ).scalar_one(),
        }


async def _zimmetle(client, fab, oid, kurye, paket) -> None:
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 200, r.text


# ══════════════════════ 1. Zimmetlenmemiş paket ══════════════════════════════


async def test_ADMIN_TESLIM_ZIMMETSIZ_PAKETI_REDDEDER_VE_YAN_ETKI_BIRAKMAZ(
    client, kur, fab
):
    """409 — ve transaction tamamen temiz kalır.

    Başlangıç: sipariş `SHIPPED` (dış kargo alışkanlığıyla elle işaretlenmiş
    gibi), paket `PACKED`, durak `PENDING`, `handed_to_courier_id` boş.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, ORDERS_MANAGE])
    oid, paket = await _packed_paket(client, token, fab)
    kurye, _run, stop_id = await _tura_ekle(fab, oid)
    assert kurye is not None

    # Siparişi elle SHIPPED'e taşımak artık yasak (aşağıda ayrı test), o yüzden
    # başlangıç durumu doğrudan FSM ile kurulur — ölçülen şey TESLİM kapısı.
    async with AsyncSessionLocal() as s:
        from services import order_fsm

        order = (
            await s.execute(text("SELECT id FROM orders WHERE id = :o"), {"o": oid})
        ).scalar_one()
        from models.store import Order

        nesne = await s.get(Order, order)
        await order_fsm.transition_order(s, nesne, "SHIPPED", changed_by="admin")
        await s.commit()

    once = await _durum(oid, stop_id, paket["id"])

    r = await client.post(
        f"/api/v1/store/admin/orders/{oid}/deliver", headers=_bas(token)
    )
    assert r.status_code == 409, r.text
    assert "zimmetlenmemiş" in r.json()["detail"], r.text

    sonra = await _durum(oid, stop_id, paket["id"])
    assert sonra["siparis_durumu"] == "SHIPPED", sonra
    assert sonra["paket_durumu"] == "PACKED", sonra
    assert sonra["durak_durumu"] == "PENDING", sonra
    assert sonra["handed_over_at"] is None, sonra
    assert sonra["handed_to_courier_id"] is None, sonra
    assert sonra["delivered_at"] is None, sonra
    assert sonra["delivered_gecisi"] == 0, sonra
    # Yan etkilerin HİÇBİRİ artmamalı — tek tek karşılaştırılır ki biri
    # yazılırken bir diğeri yazılmadığında da yakalansın.
    for alan in ("tracking_no", "outbox", "bildirim", "audit", "shipped_gecisi"):
        assert sonra[alan] == once[alan], f"{alan}: {once[alan]} → {sonra[alan]}"


async def test_ADMIN_TESLIM_REDDEDINCE_PAKET_HALA_ZIMMETLENEBILIR(client, kur, fab):
    """Açığın en pahalı sonucu: paket bir daha zimmetlenemez hâle geliyordu.

    Sipariş `DELIVERED` olunca `handover_scan` 409 verirdi (sipariş dağıtıma
    uygun değil) ve `uq_order_packages_live` yüzünden yeni paket de açılamazdı —
    yani kutu kalıcı olarak sıkışırdı. Guard'ın gerçek kazancı budur.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, ORDERS_MANAGE])
    oid, paket = await _packed_paket(client, token, fab)
    kurye, _run, _stop = await _tura_ekle(fab, oid)

    r = await client.post(
        f"/api/v1/store/admin/orders/{oid}/deliver", headers=_bas(token)
    )
    assert r.status_code == 409, r.text

    await _zimmetle(client, fab, oid, kurye, paket)
    async with AsyncSessionLocal() as s:
        assert (
            await s.execute(
                text("SELECT status FROM order_packages WHERE id = :p"), {"p": paket["id"]}
            )
        ).scalar_one() == "HANDED_OVER"


# ══════════════════════ 2. Zimmetli paket — TERS PROVA ═══════════════════════


async def test_ADMIN_TESLIM_ZIMMETLI_PAKETI_TESLIM_EDER(client, kur, fab):
    """TERS PROVA: guard "her teslimi reddet"e dönüşmedi.

    Bu düğüm olmadan yukarıdaki iddialar, teslimi tamamen kıran bir mutasyonda
    da yeşil kalırdı.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, ORDERS_MANAGE])
    oid, paket = await _packed_paket(client, token, fab)
    kurye, _run, stop_id = await _tura_ekle(fab, oid)
    await _zimmetle(client, fab, oid, kurye, paket)

    r = await client.post(
        f"/api/v1/store/admin/orders/{oid}/deliver", headers=_bas(token)
    )
    assert r.status_code == 200, r.text

    sonra = await _durum(oid, stop_id, paket["id"])
    assert sonra["siparis_durumu"] == "DELIVERED", sonra
    assert sonra["delivered_gecisi"] == 1, sonra
    assert sonra["delivered_at"] is not None, sonra
    # Zimmet çıkışı yazdığı için takip numarası ELDEN-* olmalı; yönetici ucu
    # onu değiştirmez.
    assert str(sonra["tracking_no"]).startswith("ELDEN-"), sonra
    assert sonra["handed_to_courier_id"] == kurye, sonra


async def test_PAKETI_HIC_OLMAYAN_SIPARIS_ADMIN_UCUNDAN_TESLIM_EDILEBILIR(
    client, kur, fab
):
    """F30 ÖNCESİ sipariş kilitlenmez — bilinçli fail-open.

    Guard'ın "paket yok" ile "paket var ama kuryede değil" arasındaki farkı
    gerçekten ayırt ettiğini kanıtlar; aksi hâlde dış kargoyla giden ve eski
    siparişler teslim EDİLEMEZ hâle gelirdi.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, ORDERS_MANAGE])
    pid, _sku, _ean = await fab.barkodlu_urun(stock=5)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])

    r = await client.post(
        f"/api/v1/store/admin/orders/{oid}/ship",
        json={"tracking_no": "KARGO-123"},
        headers=_bas(token),
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/api/v1/store/admin/orders/{oid}/deliver", headers=_bas(token)
    )
    assert r.status_code == 200, r.text
    async with AsyncSessionLocal() as s:
        assert (
            await s.execute(text("SELECT status FROM orders WHERE id = :o"), {"o": oid})
        ).scalar_one() == "DELIVERED"


# ══════════════════════ 3. Yanlış kurye / bozuk defter ═══════════════════════


async def test_BASKA_TURUN_KURYESINE_ZIMMETLI_PAKET_TESLIM_EDILEMEZ(client, kur, fab):
    """Defterdeki kurye bu siparişin turuyla uyuşmuyorsa teslim reddedilir.

    Gerçek hâli: kurye kaydı elle düzeltilmiş ya da tur devredilmişken paket
    hâlâ eski kuryede görünüyor. "Kimde olduğu belirsiz" bir kutuyu teslim
    edilmiş saymak, geri dönüş kuyruğunun cevaplayamayacağı bir soru bırakır
    (TB-7). Yönetici ucu bunu gevşetmez.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, ORDERS_MANAGE])
    oid, paket = await _packed_paket(client, token, fab)
    kurye, _run, stop_id = await _tura_ekle(fab, oid)
    await _zimmetle(client, fab, oid, kurye, paket)

    yabanci = await fab.kurye()
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE order_packages SET handed_to_courier_id = :k WHERE id = :p"),
            {"k": yabanci, "p": paket["id"]},
        )
        await s.commit()

    r = await client.post(
        f"/api/v1/store/admin/orders/{oid}/deliver", headers=_bas(token)
    )
    assert r.status_code == 409, r.text
    assert "turuyla uyuşmuyor" in r.json()["detail"], r.text
    sonra = await _durum(oid, stop_id, paket["id"])
    assert sonra["siparis_durumu"] != "DELIVERED", sonra
    assert sonra["delivered_gecisi"] == 0, sonra


async def test_KURYESI_KAYITSIZ_ZIMMET_TESLIM_EDILEMEZ(client, kur, fab):
    """`handed_to_courier_id` boşsa teslim reddedilir.

    "Zimmetli görünüyor ama kimde olduğu yazmıyor" hâli bir defter hatasıdır;
    üstüne teslim yazmak onu kalıcı olarak gizler.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, ORDERS_MANAGE])
    oid, paket = await _packed_paket(client, token, fab)
    kurye, _run, _stop = await _tura_ekle(fab, oid)
    await _zimmetle(client, fab, oid, kurye, paket)

    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE order_packages SET handed_to_courier_id = NULL WHERE id = :p"),
            {"p": paket["id"]},
        )
        await s.commit()

    r = await client.post(
        f"/api/v1/store/admin/orders/{oid}/deliver", headers=_bas(token)
    )
    assert r.status_code == 409, r.text
    assert "kayıtlı" in r.json()["detail"], r.text


# ══════════════════════ 4. Elle sevkiyat (mark_shipped) ══════════════════════


async def test_PAKETLI_SIPARIS_ELLE_KARGOLANDI_ISARETLENEMEZ(client, kur, fab):
    """Kendi filomuzla giden sipariş elle `SHIPPED` yapılamaz (denetim P2).

    Kutu raftayken "kargoya verildi" demek, fiziksel kanıtı sıfır olan bir
    çıkış iddiasıdır (boşluk G4) — üstelik elle yazılan takip numarası,
    zimmetin üreteceği `ELDEN-*` numarasının yerini alırdı.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, ORDERS_MANAGE])
    # Sipariş bilinçli olarak TURA EKLENMEZ: elle sevkiyat, durak olmadan da
    # denenebilen bir yönetici kısayoluydu.
    oid, paket = await _packed_paket(client, token, fab)

    r = await client.post(
        f"/api/v1/store/admin/orders/{oid}/ship",
        json={"tracking_no": "ELLE-YAZILDI-999"},
        headers=_bas(token),
    )
    assert r.status_code == 409, r.text
    assert "elle" in r.json()["detail"], r.text

    async with AsyncSessionLocal() as s:
        durum, takip = (
            await s.execute(
                text("SELECT status, tracking_no FROM orders WHERE id = :o"), {"o": oid}
            )
        ).one()
        assert durum == "PAID", durum
        assert takip is None, takip
        assert (
            await s.execute(
                text("SELECT status FROM order_packages WHERE id = :p"),
                {"p": paket["id"]},
            )
        ).scalar_one() == "PACKED"


async def test_ZIMMET_CIKISI_YAZAR_ELLE_UC_GEREKMEZ(client, kur, fab):
    """TERS PROVA: sevkiyat kapısı akışı kırmıyor — çıkışı zimmet yazıyor."""
    _aid, token = await kur.admin(izinler=[VIEW, PACK, ORDERS_MANAGE])
    oid, paket = await _packed_paket(client, token, fab)
    kurye, run, _stop = await _tura_ekle(fab, oid)
    await _zimmetle(client, fab, oid, kurye, paket)

    async with AsyncSessionLocal() as s:
        durum, takip = (
            await s.execute(
                text("SELECT status, tracking_no FROM orders WHERE id = :o"), {"o": oid}
            )
        ).one()
    assert durum == "SHIPPED", durum
    assert takip.startswith(f"ELDEN-R{run}-S"), takip
