"""F30 HTTP katmanının commit 4'e ÖZGÜ iddiaları — GERÇEK HTTP + GERÇEK PG.

`test_f30_packing_http_pg.py` commit 1'in kırmızı matrisidir ve yetki
kademelerini/temel akışı ölçer. Bu dosya onun üstüne, **uçlar açıldığı için
yeni doğan** riskleri koyar:

* QR token'ın gerçekten kimlik yerine geçmesi (çıplak `package_id` kapıyı
  açmamalı),
* duruma bağlı yetki yükseltmesi (`void`: `OPEN` → pack, kapanmış → manage),
* zimmetin HTTP üzerinden **atomik** ve **tekrar-güvenli** olması,
* manifestin kurye sahipliğine saygı duyması,
* istek şemalarının sunucuya ait alanları reddetmesi,
* sayfalamanın sayfalar arası kayıt tekrarı/kayması üretmemesi.

Hepsi gerçek `Authorization` başlığıyla ve gerçek dependency zinciriyle koşar;
"servis çağırdım, çalıştı" kabul edilmez (kök `CLAUDE.md` §B).
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.security import create_access_token
from models.admin import Admin
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service, delivery_service
from tests.integration.f30_factory import PaketFabrikasi

VIEW, PACK, MANAGE = "packing.view", "packing.pack", "packing.manage"


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Kurulum:
    """Gerçek admin + gerçek rol + gerçek izin ataması (mock yok)."""

    def __init__(self) -> None:
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []

    async def admin(self, *, izinler: list[str]) -> tuple[int, str]:
        ek = uuid.uuid4().hex[:10]
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"pak4-{ek}@test.local",
                hashed_password="test-only",
                first_name="Paket",
                last_name="API",
                username=f"pk4{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"PK4_{ek.upper()}",
                    name="Paketleme API Testi",
                    permission_codes=izinler,
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            self.admin_ids.append(a.id)
            self.role_ids.append(rol.id)
            return a.id, create_access_token(subject=a.id, role="ADMIN", role_id=1)

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:i)"
                    ),
                    {"i": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"),
                    {"i": self.role_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_id = ANY(:i) AND actor_role = 1"
                    ),
                    {"i": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:i)"), {"i": self.admin_ids}
                )
            await s.commit()


@pytest.fixture
async def kur(pg):
    k = Kurulum()
    try:
        yield k
    finally:
        await k.temizle()


@pytest.fixture
async def fab(pg):
    f = PaketFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


def _bas(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _packed_paket(client, token: str, fab: PaketFabrikasi, *, adet: int = 1):
    """HTTP üzerinden tam doğrulanmış paket. (order_id, paket_govdesi)"""
    pid, _sku, ean = await fab.barkodlu_urun(stock=10 + adet)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, adet)])
    r = await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    assert r.status_code == 200, r.text
    paket = r.json()
    for _ in range(adet):
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


# ══════════════════ QR token gerçekten kimlik mi ════════════════════════════


@pytest.mark.asyncio
async def test_CIPLAK_PAKET_ID_zimmet_kapisini_ACMAZ(client, kur, fab):
    """Zimmet **token** ister; tahmin edilebilir `package_id` yetmez.

    Etiket kalıcı olduğu için (sözleşme §3.3) tek koruma token'ın entropisidir
    (`secrets.token_urlsafe(24)` ≈ 192 bit). Sorgudan `qr_token` koşulu
    düşerse sıralı bir kimlikle bütün paketler zimmetlenebilirdi.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    kurye = await fab.kurye()
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])

    for sahte in (
        f"PKG1:{paket['id']}:yanlistoken",
        f"PKG1:{paket['id']}:",
        f"PKG1:{paket['id']}",
        str(paket["id"]),
    ):
        r = await client.post(
            "/api/v1/delivery/handover/scan",
            json={"payload": sahte},
            headers=_bas(kurye_token),
        )
        assert r.status_code == 404, f"{sahte!r} → {r.status_code} ({r.text})"

    # Paket hâlâ depoda: hiçbiri yan etki üretmedi.
    r = await client.get(
        f"/api/v1/packing/packages/{paket['id']}", headers=_bas(token)
    )
    assert r.json()["status"] == "PACKED"
    assert (await fab.siparis_durumu(oid))[0] == "PAID"


@pytest.mark.asyncio
async def test_ZIMMET_YABANCI_KURYEYE_404_ve_YAN_ETKISIZ(client, kur, fab):
    """IDOR: başka kuryenin paketi 403 değil **404** (varlık sızmaz) ve
    hiçbir kısmi yazma bırakmaz."""
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    kurye_a = await fab.kurye()
    kurye_b = await fab.kurye()
    _hid, token_b = await fab.kurye_hesabi(kurye_b)
    run_a = await fab.tur(courier_id=kurye_a)
    await fab.tur(courier_id=kurye_b)
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run_a, [oid])

    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(token_b),
    )
    assert r.status_code == 404, r.text

    r = await client.get(f"/api/v1/packing/packages/{paket['id']}", headers=_bas(token))
    govde = r.json()
    assert govde["status"] == "PACKED"
    assert govde["handed_over_at"] is None
    durum, _odeme = await fab.siparis_durumu(oid)
    assert durum == "PAID", "yabancı zimmet siparişi dağıtıma çıkarmış"


@pytest.mark.asyncio
async def test_KAPI_TARAMASI_YABANCI_PAKETIN_DURUMUNU_SIZDIRMAZ(client, kur, fab):
    """Yabancı etiket kapıda **404**'tür — paketin durumunu söyleyen 409 değil.

    Sıra bilinçlidir (`_paket_sahipligi` durum kontrolünden ÖNCE): sahiplik
    süzgeci kalkarsa, henüz zimmetlenmemiş yabancı bir paketi okutan kişi
    "durum PACKED" bilgisini 409 gövdesinden öğrenirdi. Kalıcı QR'ın bedeli
    (§7 S4) tam da budur: etiket çalınabilir, o yüzden yanıt bile bilgi
    vermemelidir.

    Bu düğüm mutasyon provasında bulundu: sahiplik kontrolünü kaldırmak
    `test_BASKA_KURYENIN_paketi_kapida_404`'ü KIRMIYORDU, çünkü o senaryoda
    durak sorgusu da kuryeye göre süzülüyor ve ikisi de 404 veriyordu. Ayırt
    edici senaryo, paketin ZİMMETLENMEMİŞ olduğu hâldir.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    kurye_a = await fab.kurye()
    kurye_b = await fab.kurye()
    _hid, token_b = await fab.kurye_hesabi(kurye_b)
    run_a = await fab.tur(courier_id=kurye_a)
    await fab.tur(courier_id=kurye_b)
    oid, paket = await _packed_paket(client, token, fab)   # PACKED, zimmetsiz
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run_a, [oid])

    r = await client.post(
        "/api/v1/delivery/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(token_b),
    )
    assert r.status_code == 404, f"yabancı pakette durum sızdı: {r.status_code} {r.text}"
    assert "PACKED" not in r.text

    # Sahibi okutunca 409 alır ve SEBEBİ öğrenir (zimmetsiz paket).
    _hid_a, token_a = await fab.kurye_hesabi(kurye_a)
    r = await client.post(
        "/api/v1/delivery/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(token_a),
    )
    assert r.status_code == 409, r.text
    assert "PACKED" in r.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bicim",
    ["yanlis_token", "bos_token", "eksik_parca", "ciplak_id", "durak_bicimi", "onek_yok"],
)
async def test_KAPI_TARAMASI_TOKEN_MATRISI(client, kur, fab, bicim):
    """Kapı taramasında da token KİMLİKTİR — matris hâlinde.

    Zimmet ucu için ayrıca ölçülüyordu; kapı ucu (`/delivery/scan`) aynı
    korumayı taşımalı, çünkü teslim akışını açan uç odur. Altı bozuk biçimin
    hepsi **aynı 404** ve **aynı gövde** ile reddedilmeli: gövde farkı, elinde
    yalnız paket kimliği olan birine "bu paket var" bilgisini verirdi.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    kurye = await fab.kurye()
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
        await delivery_service.handover_scan(
            s, paket["qr_payload"], courier_id=kurye, actor=f"courier:{kurye}"
        )
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
        durak_token = (
            await s.execute(
                text("SELECT qr_token FROM delivery_stops WHERE order_id = :o"),
                {"o": oid},
            )
        ).scalar_one()

    gercek = paket["qr_payload"].split(":")[2]
    yukler = {
        "yanlis_token": f"PKG1:{paket['id']}:{gercek[:-1]}x",
        "bos_token": f"PKG1:{paket['id']}:",
        "eksik_parca": f"PKG1:{paket['id']}",
        "ciplak_id": str(paket["id"]),
        # Paket token'ı DURAK biçiminde: iki uzay karışmamalı.
        "durak_bicimi": f"1:{gercek}",
        "onek_yok": f"{paket['id']}:{gercek}",
    }
    r = await client.post(
        "/api/v1/delivery/scan",
        json={"payload": yukler[bicim]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 404, f"{bicim}: {r.status_code} {r.text}"
    # Gövde de AYNI olmalı: metin farkı "bu paket var / yok" ayrımını sızdırır.
    # Karşılaştırma yabancı bir kuryenin GERÇEK etikete verdiği yanıtla yapılır.
    yabanci = await fab.kurye()
    _hid2, yabanci_token = await fab.kurye_hesabi(yabanci)
    await fab.tur(courier_id=yabanci)
    ref = await client.post(
        "/api/v1/delivery/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(yabanci_token),
    )
    assert ref.status_code == 404
    assert r.json()["detail"] == ref.json()["detail"], (
        f"{bicim}: 404 gövdesi yabancı-paket gövdesinden farklı — bilgi sızıyor"
    )

    # Gerçek etiket AYNI kurye ile çalışıyor (ters prova: uç ölü değil).
    r = await client.post(
        "/api/v1/delivery/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["stop"]["order_id"] == oid
    assert durak_token  # kurulum bağlayıcısı


@pytest.mark.asyncio
async def test_ESKI_TURUN_KURYESI_GUNCEL_DURUMU_OGRENEMEZ(client, kur, fab):
    """"Bir zamanlar taşıdım" bir yetki değildir.

    Sahiplik GÜNCEL turlarla (`PLANNED`/`ACTIVE`) sınırlıdır. Dünkü turun
    kuryesi bugün aynı etiketi okutursa **404** almalı; sınır kalksaydı 409
    gövdesinden paketin bugünkü durumunu öğrenirdi (commit 4 denetimi).
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, MANAGE])
    eski_kurye = await fab.kurye()
    _hid, eski_token = await fab.kurye_hesabi(eski_kurye)
    run1 = await fab.tur(courier_id=eski_kurye)
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run1, [oid])
        await delivery_service.handover_scan(
            s, paket["qr_payload"], courier_id=eski_kurye, actor=f"courier:{eski_kurye}"
        )
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run1)
        stop_id = (
            await s.execute(
                text("SELECT id FROM delivery_stops WHERE order_id = :o"), {"o": oid}
            )
        ).scalar_one()
    async with AsyncSessionLocal() as s:
        await delivery_service.fail_stop(
            s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
        )
    # Tur kapandı: eski kuryenin GÜNCEL turu kalmadı.
    async with AsyncSessionLocal() as s:
        await delivery_service.complete_run(s, run1)

    for yol in ("/api/v1/delivery/scan", "/api/v1/delivery/handover/scan"):
        r = await client.post(
            yol, json={"payload": paket["qr_payload"]}, headers=_bas(eski_token)
        )
        assert r.status_code == 404, f"{yol}: {r.status_code} {r.text}"
        assert "RETURN_PENDING" not in r.text, "eski kuryeye güncel durum sızdı"


@pytest.mark.asyncio
async def test_ZIMMET_TEKRARI_HTTP_TEK_YAN_ETKI(client, kur, fab):
    """Aynı etiketin üç kez okutulması: tek `SHIPPED`, tek takip numarası,
    tek bildirim, tek `HANDOVER` olayı, değişmeyen damga.

    Ağ tekrarı ve çift dokunma gerçek senaryodur; ikinci bir "kuryen yola
    çıktı" bildirimi müşteriye iki kez SMS/bildirim gitmesi demektir.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    kurye = await fab.kurye()
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    run = await fab.tur(courier_id=kurye)
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])

    damgalar = set()
    for _ in range(3):
        r = await client.post(
            "/api/v1/delivery/handover/scan",
            json={"payload": paket["qr_payload"]},
            headers=_bas(kurye_token),
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "HANDED_OVER"
        damgalar.add(r.json()["handed_over_at"])
    assert len(damgalar) == 1, "tekrar zimmet damgasını tazeledi"

    async with AsyncSessionLocal() as s:
        gecis = (
            await s.execute(
                text(
                    "SELECT count(*) FROM order_status_history "
                    "WHERE order_id = :o AND new_status = 'SHIPPED'"
                ),
                {"o": oid},
            )
        ).scalar_one()
        olay = (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events "
                    "WHERE package_id = :p AND event_type = 'HANDOVER'"
                ),
                {"p": paket["id"]},
            )
        ).scalar_one()
        bildirim = (
            await s.execute(
                text(
                    "SELECT count(*) FROM notifications WHERE user_id = "
                    "(SELECT client_id FROM orders WHERE id = :o) AND role_id = 3 "
                    "AND message LIKE '%dağıtımda%'"
                ),
                {"o": oid},
            )
        ).scalar_one()
    assert (gecis, olay, bildirim) == (1, 1, 1), (gecis, olay, bildirim)


@pytest.mark.asyncio
async def test_ZIMMET_ATOMIK_kismi_yazma_birakmaz(client, kur, fab):
    """Başarısız zimmet (409) hiçbir ayağı yarım bırakmaz.

    Paket `OPEN` (eksik) iken zimmet reddedilir; ardından ne paket
    `HANDED_OVER` olur, ne sipariş `SHIPPED`, ne takip numarası doğar, ne de
    `HANDOVER` olayı yazılır. Üçü aynı transaction'da olduğu için "biri oldu,
    öbürü olmadı" hâli imkânsız olmalıdır.

    Kurulum "durak varken paket bozulup yeniden açıldı" senaryosudur: F30
    commit 5'ten sonra `add_stops` yalnız tamamlanmış paketi kabul ettiği için
    eksik paketli bir durak ancak böyle doğar (kutu son anda ezilir, operatör
    `void` edip yeni paket açar).
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, MANAGE])
    kurye = await fab.kurye()
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    run = await fab.tur(courier_id=kurye)
    oid, ilk = await _packed_paket(client, token, fab, adet=2)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [oid])
    r = await client.post(
        f"/api/v1/packing/packages/{ilk['id']}/void",
        json={"reason": "Kutu ezildi"},
        headers=_bas(token),
    )
    assert r.status_code == 200, r.text
    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    ).json()
    assert paket["status"] == "OPEN"

    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(kurye_token),
    )
    assert r.status_code == 409, r.text

    async with AsyncSessionLocal() as s:
        satir = (
            await s.execute(
                text(
                    "SELECT o.status, o.tracking_no, p.status AS paket, p.handed_over_at "
                    "FROM orders o JOIN order_packages p ON p.id = :p "
                    "WHERE o.id = :o"
                ),
                {"o": oid, "p": paket["id"]},
            )
        ).one()
        olay = (
            await s.execute(
                text(
                    "SELECT count(*) FROM package_scan_events "
                    "WHERE package_id = :p AND event_type = 'HANDOVER'"
                ),
                {"p": paket["id"]},
            )
        ).scalar_one()
    assert satir.status == "PAID"
    assert satir.tracking_no is None
    assert satir.paket == "OPEN"
    assert satir.handed_over_at is None
    assert olay == 0


# ══════════════════ Duruma bağlı yetki yükseltmesi ══════════════════════════


@pytest.mark.asyncio
async def test_VOID_ACIK_PAKETTE_pack_yeter_KAPANMIS_PAKETTE_manage_ister(
    client, kur, fab
):
    """Görev ayrılığı veriye bağlıdır (sözleşme §6).

    `OPEN` paket henüz kimsenin güvendiği bir şey değildir; onu paketleyen
    kişi vazgeçebilir. `PACKED` paketi çözmek ise **başka birinin kararını
    iptal etmektir** ve `packing.manage` ister. Tek bir izne bağlamak bu
    ayrımı yok ederdi.
    """
    _aid, pack_token = await kur.admin(izinler=[VIEW, PACK])

    # (a) OPEN paket → packing.pack yeter
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(pack_token))
    ).json()
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/void",
        json={"reason": "Yanlış sipariş açıldı"},
        headers=_bas(pack_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "VOID"

    # (b) PACKED paket → packing.pack YETMEZ
    oid2, paket2 = await _packed_paket(client, pack_token, fab)
    r = await client.post(
        f"/api/v1/packing/packages/{paket2['id']}/void",
        json={"reason": "Kutu ezildi"},
        headers=_bas(pack_token),
    )
    assert r.status_code == 403, r.text

    # Paket dokunulmadı: 403 gerçekten ENGELLEDİ.
    r = await client.get(
        f"/api/v1/packing/packages/{paket2['id']}", headers=_bas(pack_token)
    )
    assert r.json()["status"] == "PACKED"

    # (c) packing.manage ile aynı istek geçer.
    _aid2, manage_token = await kur.admin(izinler=[VIEW, PACK, MANAGE])
    r = await client.post(
        f"/api/v1/packing/packages/{paket2['id']}/void",
        json={"reason": "Kutu ezildi"},
        headers=_bas(manage_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "VOID"
    assert await fab.prepared_at(oid2) is None, "çözülen paketten sonra hazır kalmış"
    assert ean  # kurulum bağlayıcısı


@pytest.mark.asyncio
async def test_VOID_GEREKCESIZ_422(client, kur, fab):
    """Boş/whitespace gerekçe HTTP'de de 422 — ham DB hatası sızmaz."""
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    ).json()
    for govde in ({"reason": ""}, {"reason": "   "}, {}):
        r = await client.post(
            f"/api/v1/packing/packages/{paket['id']}/void",
            json=govde,
            headers=_bas(token),
        )
        assert r.status_code == 422, f"{govde} → {r.status_code} ({r.text})"
    r = await client.get(f"/api/v1/packing/packages/{paket['id']}", headers=_bas(token))
    assert r.json()["status"] == "OPEN"


# ══════════════════ İstek şeması: sunucuya ait alanlar ══════════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "yol,govde",
    [
        ("scan", {"code": "X", "status": "PACKED"}),
        ("scan", {"code": "X", "scanned_qty": 5}),
        ("undo-scan", {"order_item_id": 1, "reason": "x", "qty_delta": -5}),
        ("void", {"reason": "x", "void_at": "2026-01-01T00:00:00Z"}),
    ],
)
async def test_ISTEMCI_SUNUCU_ALANI_GONDEREMEZ_422(client, kur, fab, yol, govde):
    """`extra="forbid"`: paket durumunu/adedini/damgasını istemci yazamaz.

    Bu alanların istemciden kabul edilmesi bütün FSM'i ve tarama sayacını
    anlamsız kılardı — "eksik kalem kabul edilmez" kuralı tek bir JSON alanıyla
    atlatılabilirdi.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK, MANAGE])
    pid, _sku, _ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    ).json()
    r = await client.post(
        f"/api/v1/packing/packages/{paket['id']}/{yol}",
        json=govde,
        headers=_bas(token),
    )
    assert r.status_code == 422, f"{yol} {govde} → {r.status_code}"


# ══════════════════ undo-scan idempotency (HTTP) ════════════════════════════


@pytest.mark.asyncio
async def test_HTTP_undo_scan_ANAHTARLI_TEKRAR_BIR_KEZ_AZALTIR(client, kur, fab):
    """P2-D'nin HTTP karşılığı: el terminali isteği yeniden gönderirse adet
    bir kez düşer ve yanıt `replayed=True` ile dürüstçe söyler."""
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    pid, _sku, ean = await fab.barkodlu_urun(stock=10)
    oid = await fab.fiziksel_siparis(kalemler=[(pid, 3)])
    paket = (
        await client.post(f"/api/v1/packing/orders/{oid}/open", headers=_bas(token))
    ).json()
    for _ in range(3):
        await client.post(
            f"/api/v1/packing/packages/{paket['id']}/scan",
            json={"code": ean, "idempotency_key": uuid.uuid4().hex},
            headers=_bas(token),
        )
    kalem = paket["items"][0]["order_item_id"]
    govde = {
        "order_item_id": kalem,
        "reason": "Kutuya yanlış kondu",
        "idempotency_key": "geri-al-http",
    }
    tekrarlar = []
    for _ in range(3):
        r = await client.post(
            f"/api/v1/packing/packages/{paket['id']}/undo-scan",
            json=govde,
            headers=_bas(token),
        )
        assert r.status_code == 200, r.text
        tekrarlar.append(r.json()["replayed"])
    assert tekrarlar == [False, True, True]
    assert r.json()["items"][0]["scanned_qty"] == 2


# ══════════════════ Zimmet manifesti ════════════════════════════════════════


@pytest.mark.asyncio
async def test_MANIFEST_eksik_paketi_GOSTERIR_ve_SAHIPLIGE_saygi_duyar(
    client, kur, fab
):
    """Kurye kaç paket aldığını/kaç paket olduğunu depoda görür; yabancı tur 404."""
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    kurye = await fab.kurye()
    _hid, kurye_token = await fab.kurye_hesabi(kurye)
    kurye_b = await fab.kurye()
    _hid2, kurye_b_token = await fab.kurye_hesabi(kurye_b)
    run = await fab.tur(courier_id=kurye)
    o1, p1 = await _packed_paket(client, token, fab)
    o2, _p2 = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run, [o1, o2])

    r = await client.get(
        f"/api/v1/delivery/handover/manifest/{run}", headers=_bas(kurye_token)
    )
    assert r.status_code == 200, r.text
    m = r.json()
    assert (m["total"], m["handed_over"]) == (2, 0)
    assert {x["order_id"] for x in m["rows"]} == {o1, o2}
    assert all(x["package_code"].startswith("PKT-") for x in m["rows"])

    await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": p1["qr_payload"]},
        headers=_bas(kurye_token),
    )
    m = (
        await client.get(
            f"/api/v1/delivery/handover/manifest/{run}", headers=_bas(kurye_token)
        )
    ).json()
    assert (m["total"], m["handed_over"]) == (2, 1)
    eksik = [x for x in m["rows"] if not x["handed_over"]]
    assert [x["order_id"] for x in eksik] == [o2]

    # IDOR: başka kuryenin turu 404.
    r = await client.get(
        f"/api/v1/delivery/handover/manifest/{run}", headers=_bas(kurye_b_token)
    )
    assert r.status_code == 404, r.text


# ══════════════════ Sayfalama determinizmi ══════════════════════════════════


@pytest.mark.asyncio
async def test_SAYFALAMA_SAYFALAR_ARASI_TEKRAR_URETMEZ(client, kur, fab):
    """Aynı saniyede açılan paketler sayfalar arasında kaymamalı.

    Yalnız `created_at DESC` ile sıralamak eşit damgalarda BELİRSİZ sıra
    üretir; ikinci sayfa birinci sayfanın bir kaydını tekrar gösterebilir ve
    bir kaydı hiç göstermeyebilir. Bağlayıcı `id DESC`'tir.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    beklenen = set()
    for _ in range(5):
        pid, _sku, _ean = await fab.barkodlu_urun(stock=5)
        oid = await fab.fiziksel_siparis(kalemler=[(pid, 1)])
        r = await client.post(
            f"/api/v1/packing/orders/{oid}/open", headers=_bas(token)
        )
        beklenen.add(r.json()["id"])

    gorulen: list[int] = []
    for offset in (0, 2, 4):
        r = await client.get(
            f"/api/v1/packing/packages?limit=2&offset={offset}", headers=_bas(token)
        )
        assert r.status_code == 200, r.text
        gorulen.extend(x["id"] for x in r.json()["items"])
    bizimkiler = [i for i in gorulen if i in beklenen]
    assert len(bizimkiler) == len(set(bizimkiler)), f"sayfalar kayıt tekrarladı: {gorulen}"


# ══════════════════ Zimmet 404 gövde nöbetçisi ══════════════════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bicim", ["yabanci_kurye", "olmayan_paket", "yanlis_token", "paket_qr_degil"]
)
async def test_ZIMMET_404_GOVDELERI_AYNIDIR(client, kur, fab, bicim):
    """Zimmet yolundaki BÜTÜN 404'ler aynı gövdeyi döner.

    Commit 5 denetiminin taşıdığı borç: dört ayrı 404 yolu (paket QR'ı değil ·
    paket yok · token yanlış · senin turunda değil) aynı `_ETIKET_YOK` metnini
    kullanıyor ama bunu koruyan **davranış testi yoktu**. Metinler ayrışırsa
    404 kodu aynı kalsa bile gövde farkı "bu paket var/yok" bilgisini sızdırır —
    kalıcı QR + çalınabilir etiket (sözleşme §7 S4) bunu gerçek bir risk yapar.

    Ölçüm: dört bozuk girdinin gövdesi, **yabancı kuryenin geçerli etikete
    aldığı** gövdeyle birebir aynı olmalı.
    """
    _aid, token = await kur.admin(izinler=[VIEW, PACK])
    kurye_a = await fab.kurye()
    kurye_b = await fab.kurye()
    _hid, token_b = await fab.kurye_hesabi(kurye_b)
    run_a = await fab.tur(courier_id=kurye_a)
    await fab.tur(courier_id=kurye_b)
    oid, paket = await _packed_paket(client, token, fab)
    async with AsyncSessionLocal() as s:
        await delivery_service.add_stops(s, run_a, [oid])

    gercek = paket["qr_payload"].split(":")[2]
    yukler = {
        "yabanci_kurye": paket["qr_payload"],
        "olmayan_paket": f"PKG1:99999999:{gercek}",
        "yanlis_token": f"PKG1:{paket['id']}:{gercek[:-1]}x",
        "paket_qr_degil": "7:duraktoken",
    }
    r = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": yukler[bicim]},
        headers=_bas(token_b),
    )
    assert r.status_code == 404, f"{bicim}: {r.status_code} {r.text}"

    ref = await client.post(
        "/api/v1/delivery/handover/scan",
        json={"payload": paket["qr_payload"]},
        headers=_bas(token_b),
    )
    assert ref.status_code == 404
    assert r.json()["detail"] == ref.json()["detail"], (
        f"{bicim}: zimmet 404 gövdesi ayrışmış — bilgi sızıyor"
    )
    # Paketin durumu HİÇBİR gövdede geçmemeli.
    assert "PACKED" not in r.text and "PKT-" not in r.text
