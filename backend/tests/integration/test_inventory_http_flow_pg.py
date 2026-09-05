"""F29 envanter uçları — GERÇEK FastAPI HTTP + GERÇEK PostgreSQL (commit 7).

`test_inventory_endpoints_pg.py` yetki matrisini ölçer; bu dosya **iş akışının
HTTP üzerinden** doğru çalıştığını ölçer. Servisi doğrudan çağıran bir test bu
katmanın yerine geçmez: yetki çözümü, gövde doğrulaması, transaction sınırı ve
hata eşlemesi yalnız gerçek istekle görünür.

Taşıyıcı `httpx.ASGITransport` — uygulama **testin event loop'unda** koşar
(asyncpg bağlantıları loop'a bağlıdır).
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
from services import admin_access_service
from tests.integration.inventory_factory import Fabrika

VIEW, COUNT, APPLY = "inventory.view", "inventory.count", "inventory.apply"
TAM = [VIEW, COUNT, APPLY]
KOK = "/api/v1/inventory"


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Kurulum:
    """Gerçek admin + gerçek rol + gerçek izin; token gerçek imzayla üretilir."""

    def __init__(self) -> None:
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []

    async def admin(self, *, izinler: list[str]) -> tuple[int, dict]:
        ek = _uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"env7-{ek}@test.local",
                hashed_password="test-only",
                first_name="Envanter",
                last_name="Yedi",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"E7_{ek.upper()}", name="Envanter 7",
                    permission_codes=izinler,
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            self.admin_ids.append(a.id)
            self.role_ids.append(rol.id)
            token = create_access_token(subject=a.id, role="ADMIN", role_id=1, auth_version=a.auth_version)
            return a.id, {"Authorization": f"Bearer {token}"}

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.admin_ids:
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_id = ANY(:i) "
                        "AND actor_role = 1"
                    ),
                    {"i": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_permissions "
                        "WHERE admin_role_id = ANY(:i)"
                    ),
                    {"i": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"),
                    {"i": self.role_ids},
                )
            if self.admin_ids:
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
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


# ── HTTP yardımcıları (hepsi gerçek istek) ──


async def _oturum_ac(client, h, pid: int) -> int:
    r = await client.post(
        f"{KOK}/count-sessions",
        json={"scope": "MANUAL", "product_ids": [pid]},
        headers=h,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def _say(client, h, sid: int, satilabilir: int, hasarli: int = 0) -> None:
    r = await client.get(f"{KOK}/count-sessions/{sid}", headers=h)
    assert r.status_code == 200, r.text
    for satir in r.json()["lines"]:
        adet = satilabilir if satir["bucket"] == "SALEABLE" else hasarli
        rr = await client.post(
            f"{KOK}/count-sessions/{sid}/lines/{satir['id']}/count",
            json={"counted_qty": adet},
            headers=h,
        )
        assert rr.status_code == 200, rr.text


async def _kovalar(pid: int) -> tuple[int, int]:
    async with AsyncSessionLocal() as db:
        r = (
            await db.execute(
                text("SELECT stock, damaged_stock FROM products WHERE id = :i"),
                {"i": pid},
            )
        ).one()
    return int(r.stock), int(r.damaged_stock)


async def _hareket_sayisi(pid: int, tur: str | None = None) -> int:
    sql = "SELECT count(*) FROM stock_movements WHERE product_id = :i"
    if tur:
        sql += " AND movement_type = :t"
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(text(sql), {"i": pid, "t": tur} if tur else {"i": pid})
        ).scalar_one()


async def _olay_sayisi(pid: int) -> int:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text("SELECT count(*) FROM stock_damage_events WHERE product_id = :i"),
                {"i": pid},
            )
        ).scalar_one()


# ══════════ 1. Tam akış ══════════

async def test_TAM_AKIS_olustur_baslat_say_gonder_uygula(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    sid = await _oturum_ac(client, h, pid)

    r = await client.get(f"{KOK}/count-sessions/{sid}", headers=h)
    assert r.json()["status"] == "DRAFT"
    assert len(r.json()["lines"]) == 2, "ürün başına iki kova satırı"

    assert (
        await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    ).json()["status"] == "IN_PROGRESS"

    await _say(client, h, sid, 8)

    r = await client.post(f"{KOK}/count-sessions/{sid}/submit", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "REVIEW"
    satilabilir = [s for s in r.json()["lines"] if s["bucket"] == "SALEABLE"][0]
    assert satilabilir["difference"] == -2, "fark yanıtta TÜRETİLMİŞ olmalı"

    r = await client.post(
        f"{KOK}/count-sessions/{sid}/apply",
        json={"idempotency_key": f"http-{_uniq()}"},
        headers=h,
    )
    assert r.status_code == 200 and r.json()["status"] == "APPLIED"
    assert await _kovalar(pid) == (8, 0)
    assert await _hareket_sayisi(pid, "COUNT_ADJUSTMENT") == 1


# ══════════ 2-3. STALE ve yeniden sayım ══════════

async def _belirsizlestir(pid: int) -> None:
    from services import stock_ledger

    async with AsyncSessionLocal() as db:
        await stock_ledger.apply_movement(
            db, pid, qty_delta=+1, bucket=stock_ledger.StockBucket.SALEABLE,
            movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="HATALI_GIRIS", actor_type="ADMIN", actor_id=1,
        )
        await db.commit()


async def test_STALE_satir_varken_APPLY_409(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    sid = await _oturum_ac(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    await _say(client, h, sid, 9)
    await _belirsizlestir(pid)                       # stok 11, satır belirsiz
    r = await client.post(f"{KOK}/count-sessions/{sid}/submit", headers=h)
    assert [s for s in r.json()["lines"] if s["status"] == "STALE"]

    r = await client.post(
        f"{KOK}/count-sessions/{sid}/apply",
        json={"idempotency_key": f"k-{_uniq()}"},
        headers=h,
    )
    assert r.status_code == 409, r.text
    assert await _hareket_sayisi(pid, "COUNT_ADJUSTMENT") == 0
    assert await _kovalar(pid) == (11, 0)


async def test_YENIDEN_SAYIM_sonrasi_APPLY_basarili(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    sid = await _oturum_ac(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    await _say(client, h, sid, 9)
    await _belirsizlestir(pid)
    await client.post(f"{KOK}/count-sessions/{sid}/submit", headers=h)

    assert (
        await client.post(f"{KOK}/count-sessions/{sid}/reopen", headers=h)
    ).status_code == 200
    await _say(client, h, sid, 9)                    # rafta gerçekten 9
    await client.post(f"{KOK}/count-sessions/{sid}/submit", headers=h)
    r = await client.post(
        f"{KOK}/count-sessions/{sid}/apply",
        json={"idempotency_key": f"k-{_uniq()}"},
        headers=h,
    )
    assert r.status_code == 200 and r.json()["status"] == "APPLIED"
    assert await _kovalar(pid) == (9, 0)


# ══════════ 4-5. Apply idempotency ══════════

async def _uygulanmis(client, h, fab, sayilan: int = 8):
    pid = await fab.urun(stock=10)
    sid = await _oturum_ac(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    await _say(client, h, sid, sayilan)
    await client.post(f"{KOK}/count-sessions/{sid}/submit", headers=h)
    anahtar = f"idem-{_uniq()}"
    r = await client.post(
        f"{KOK}/count-sessions/{sid}/apply",
        json={"idempotency_key": anahtar},
        headers=h,
    )
    assert r.status_code == 200, r.text
    return pid, sid, anahtar


async def test_AYNI_apply_anahtari_REPLAY_yeni_hareket_yazmaz(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid, sid, anahtar = await _uygulanmis(client, h, fab)
    once = await _hareket_sayisi(pid)

    r = await client.post(
        f"{KOK}/count-sessions/{sid}/apply",
        json={"idempotency_key": anahtar},
        headers=h,
    )
    assert r.status_code == 200 and r.json()["status"] == "APPLIED"
    assert await _hareket_sayisi(pid) == once
    assert await _kovalar(pid) == (8, 0)


async def test_FARKLI_apply_anahtariyla_ikinci_istek_409(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid, sid, _anahtar = await _uygulanmis(client, h, fab)
    once = await _hareket_sayisi(pid)

    r = await client.post(
        f"{KOK}/count-sessions/{sid}/apply",
        json={"idempotency_key": f"baska-{_uniq()}"},
        headers=h,
    )
    assert r.status_code == 409, r.text
    assert await _hareket_sayisi(pid) == once


# ══════════ 6-9. Hasar uçları ══════════

async def _hasar(client, h, pid, **govde):
    return await client.post(
        f"{KOK}/damage-events",
        json={"product_id": pid, "kind": "TRANSFER", "qty": 2,
              "reason_code": "KIRIK", **govde},
        headers=h,
    )


async def test_HASAR_TRANSFERI_iki_kovayi_ATOMIK_degistirir(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    r = await _hasar(client, h, pid, qty=3)
    assert r.status_code in (200, 201), r.text
    govde = r.json()
    assert govde["kind"] == "TRANSFER" and govde["source_bucket"] == "SALEABLE"
    assert await _kovalar(pid) == (7, 3)
    assert await _hareket_sayisi(pid, "DAMAGE_TRANSFER") == 2


async def test_HASAR_ayni_aktor_ve_anahtar_REPLAY(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    anahtar = f"h-{_uniq()}"
    ilk = await _hasar(client, h, pid, idempotency_key=anahtar)
    tekrar = await _hasar(client, h, pid, idempotency_key=anahtar)
    assert tekrar.status_code in (200, 201), tekrar.text
    assert tekrar.json()["id"] == ilk.json()["id"]
    assert await _kovalar(pid) == (8, 2), "replay bakiyeyi ikinci kez değiştirdi"
    assert await _olay_sayisi(pid) == 1


async def test_HASAR_ayni_anahtar_FARKLI_govde_409(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    anahtar = f"h-{_uniq()}"
    await _hasar(client, h, pid, qty=2, idempotency_key=anahtar)
    r = await _hasar(client, h, pid, qty=5, idempotency_key=anahtar)
    assert r.status_code == 409, r.text
    assert await _kovalar(pid) == (8, 2)


async def test_HASAR_FARKLI_ADMIN_ayni_metinsel_anahtari_kullanabilir(client, kur, fab):
    _a1, h1 = await kur.admin(izinler=TAM)
    _a2, h2 = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    ortak = "gunluk-hasar-1"
    r1 = await _hasar(client, h1, pid, qty=2, idempotency_key=ortak)
    r2 = await _hasar(client, h2, pid, qty=3, idempotency_key=ortak)
    assert r1.status_code in (200, 201) and r2.status_code in (200, 201), r2.text
    assert r1.json()["id"] != r2.json()["id"]
    assert await _kovalar(pid) == (5, 5)


# ══════════ 10. Ledger invariant ══════════

async def test_LEDGER_INVARIANT_bozuksa_UC_ONARMAZ_ve_409_doner(client, kur, fab):
    """Uç bozuk veriyi otomatik onarmaz; 409 döner ve bakiye değişmez."""
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    anahtar = f"h-{_uniq()}"
    r = await _hasar(client, h, pid, qty=2, idempotency_key=anahtar)
    olay_id = r.json()["id"]
    async with AsyncSessionLocal() as db:
        await db.execute(text("ALTER TABLE stock_movements DISABLE TRIGGER USER"))
        await db.execute(
            text(
                "DELETE FROM stock_movements WHERE ref_type = 'damage_event' "
                "AND ref_id = :i AND bucket = 'DAMAGED'"
            ),
            {"i": olay_id},
        )
        await db.execute(text("ALTER TABLE stock_movements ENABLE TRIGGER USER"))
        await db.commit()

    once = await _kovalar(pid)
    r = await _hasar(client, h, pid, qty=2, idempotency_key=anahtar)
    assert r.status_code == 409, r.text
    assert "LEDGER_INVARIANT" in r.text
    assert await _kovalar(pid) == once
    assert (
        await _hareket_sayisi(pid, "DAMAGE_TRANSFER") == 1
    ), "eksik bacak sessizce yazıldı"


# ══════════ 11-12. Reddedilen istekler ══════════

async def test_DIJITAL_URUNDE_hasar_islemi_400(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=None, kind="DIGITAL")
    r = await _hasar(client, h, pid, qty=1)
    assert r.status_code == 400, r.text
    assert await _olay_sayisi(pid) == 0


async def test_YETERSIZ_STOKTA_hicbir_olay_ve_hareket_kalmaz(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=2)
    once = await _hareket_sayisi(pid)
    r = await _hasar(client, h, pid, qty=9)
    assert r.status_code == 409, r.text
    assert await _olay_sayisi(pid) == 0
    assert await _hareket_sayisi(pid) == once
    assert await _kovalar(pid) == (2, 0)


async def test_DIJITAL_URUN_sayima_EKLENEMEZ_400(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=None, kind="DIGITAL")
    r = await client.post(
        f"{KOK}/count-sessions",
        json={"scope": "MANUAL", "product_ids": [pid]},
        headers=h,
    )
    assert r.status_code == 400, r.text


# ══════════ 13. Sayfalama tavanı ══════════

@pytest.mark.parametrize("yol", ["/count-sessions", "/damage-events"])
async def test_LISTE_UCLARI_limit_TAVANINI_uygular(client, kur, yol):
    _aid, h = await kur.admin(izinler=[VIEW])
    r = await client.get(f"{KOK}{yol}?limit=100000", headers=h)
    assert r.status_code == 422, r.text          # tavan Query ile zorlanıyor
    r = await client.get(f"{KOK}{yol}?limit=200", headers=h)
    assert r.status_code == 200
    govde = r.json()
    assert govde["limit"] == 200
    assert {"items", "total", "limit", "offset"} <= set(govde)


# ══════════ 14. Yetkisiz erişim ══════════

async def test_BASKA_ADMIN_yetkisiz_erisimde_403(client, kur, fab):
    """Yetkisi olmayan admin 403 alır; 404 ile GİZLENMEZ (kaynak vardır)."""
    _sahip, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=5)
    sid = await _oturum_ac(client, h, pid)

    _yabanci, hy = await kur.admin(izinler=["dashboard.view"])
    assert (
        await client.get(f"{KOK}/count-sessions/{sid}", headers=hy)
    ).status_code == 403
    assert (
        await client.post(f"{KOK}/count-sessions/{sid}/start", headers=hy)
    ).status_code == 403


async def test_BASKASININ_oturumunu_iptal_APPLY_ister(client, kur, fab):
    """`cancel` sayım yetkisidir; **başkasının** oturumunu kapatmak denetim
    yetkisidir (plan §6.3)."""
    _sahip, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=5)
    sid = await _oturum_ac(client, h, pid)

    _sayici, hc = await kur.admin(izinler=[VIEW, COUNT])
    r = await client.post(
        f"{KOK}/count-sessions/{sid}/cancel", json={"reason": "olmaz"}, headers=hc
    )
    assert r.status_code == 403, r.text

    r = await client.post(
        f"{KOK}/count-sessions/{sid}/cancel", json={"reason": "vazgeçildi"}, headers=h
    )
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"


async def test_KENDI_oturumunu_COUNT_izniyle_iptal_edebilir(client, kur, fab):
    _sayici, hc = await kur.admin(izinler=[VIEW, COUNT])
    pid = await fab.urun(stock=5)
    sid = await _oturum_ac(client, hc, pid)
    r = await client.post(
        f"{KOK}/count-sessions/{sid}/cancel", json={"reason": "vazgeçildi"}, headers=hc
    )
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"


# ══════════ 15. Yanıt sözleşmesi ══════════

_PARASAL = ("price", "cost", "amount", "currency", "tutar", "maliyet", "vat", "kdv")
_DAHILI = ("hashed_password", "deleted_at", "search_vector", "digital_asset_key")


@pytest.mark.parametrize("alan", _PARASAL)
async def test_YANITTA_parasal_alan_YOK(client, kur, fab, alan):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    sid = await _oturum_ac(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    await _hasar(client, h, pid, qty=1)
    for yol in (
        f"/count-sessions/{sid}",
        "/count-sessions",
        "/damage-events",
        f"/products/{pid}/on-premise",
    ):
        yanit = await client.get(f"{KOK}{yol}", headers=h)
        # Durum kodu doğrulanmadan yapılan yasak-kelime taraması VAKUMDA
        # koşar: 404 gövdesi de hiçbir parasal kelime içermez ve iddia
        # boşa geçer — var olmayan bir uç "temiz" sayılırdı.
        assert yanit.status_code == 200, f"{yol} → {yanit.status_code}"
        govde = yanit.text.lower()
        assert alan not in govde, f"{yol} → parasal alan sızmış: {alan}"


async def test_YANITTA_dahili_alan_YOK(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    sid = await _oturum_ac(client, h, pid)
    govde = (await client.get(f"{KOK}/count-sessions/{sid}", headers=h)).text
    for alan in _DAHILI:
        assert alan not in govde


async def test_ISTEMCI_counted_at_GONDEREMEZ(client, kur, fab):
    """Şema `extra="forbid"`: sunucuya ait bir alanı göndermek 422'dir."""
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    sid = await _oturum_ac(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    satir = (
        await client.get(f"{KOK}/count-sessions/{sid}", headers=h)
    ).json()["lines"][0]
    r = await client.post(
        f"{KOK}/count-sessions/{sid}/lines/{satir['id']}/count",
        json={"counted_qty": 5, "counted_at": "2020-01-01T00:00:00Z"},
        headers=h,
    )
    assert r.status_code == 422, r.text


async def test_GECERSIZ_KOVA_ve_GEREKCE_422(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    r = await _hasar(client, h, pid, reason_code="CANIM_ISTEDI")
    assert r.status_code == 422
    r = await _hasar(
        client, h, pid, kind="SUPPLIER_RETURN", bucket="RAFTA"
    )
    assert r.status_code == 422


async def test_NEGATIF_MIKTAR_422(client, kur, fab):
    _aid, h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=10)
    assert (await _hasar(client, h, pid, qty=0)).status_code == 422
    assert (await _hasar(client, h, pid, qty=-3)).status_code == 422


async def test_OLMAYAN_OTURUM_404(client, kur):
    _aid, h = await kur.admin(izinler=TAM)
    r = await client.get(f"{KOK}/count-sessions/99999999", headers=h)
    assert r.status_code == 404, r.text


async def test_YANLIS_OTURUMDAKI_satiri_saymak_404_ve_YAZMAZ(client, kur, fab):
    """Satır başka oturuma aitse 404 döner **ve sayım yazılmaz**.

    Transaction sınırı provası: uç, servis çağrısından sonra ama `commit`'ten
    ÖNCE reddediyor; hata hâlinde `get_db` rollback ediyor. Reddi commit'ten
    sonraya almak, reddedilen isteğin yine de veri bırakması demek olurdu.
    """
    _aid, h = await kur.admin(izinler=TAM)
    a = await fab.urun(stock=10)
    b = await fab.urun(stock=10)
    sid_a = await _oturum_ac(client, h, a)
    sid_b = await _oturum_ac(client, h, b)
    await client.post(f"{KOK}/count-sessions/{sid_a}/start", headers=h)
    await client.post(f"{KOK}/count-sessions/{sid_b}/start", headers=h)

    satir_b = (
        await client.get(f"{KOK}/count-sessions/{sid_b}", headers=h)
    ).json()["lines"][0]

    r = await client.post(
        f"{KOK}/count-sessions/{sid_a}/lines/{satir_b['id']}/count",
        json={"counted_qty": 7},
        headers=h,
    )
    assert r.status_code == 404, r.text

    async with AsyncSessionLocal() as db:
        sayilan = (
            await db.execute(
                text("SELECT counted_qty FROM stock_count_lines WHERE id = :i"),
                {"i": satir_b["id"]},
            )
        ).scalar_one()
    assert sayilan is None, "reddedilen istek yine de sayım yazdı (rollback yok)"
