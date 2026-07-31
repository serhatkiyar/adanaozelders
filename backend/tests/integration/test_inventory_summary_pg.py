"""F29 commit 8 kapanışı — ürün kimliği ve liste özeti (GERÇEK HTTP + GERÇEK PG).

## Neden bu testler var

Arayüz sayım satırında "Ürün #123" göstermek zorunda kalıyordu: sayım uçları
ürün adını ve SKU'yu taşımıyordu. Rafın başında duran kişi numaradan ürün
tanıyamaz — bu doğrudan **yanlış ürün sayma** riskidir.

Liste ucu da satır sayısını ve "dikkat gerekiyor" sinyalini taşımıyordu;
operatör hangi oturumu açacağını bilemiyor, her oturuma tek tek girmek zorunda
kalıyordu.

İki ihtiyacı da istemcide çözmek N+1 istek (ya da uydurma sayı) demekti; bu
yüzden sözleşme sunucu tarafında, TOPLU sorgularla genişletildi. Son test bunu
gerçek SQL sayımıyla kanıtlar.
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


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Kurulum:
    def __init__(self) -> None:
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []

    async def admin(self, *, izinler: list[str]) -> dict:
        ek = uuid.uuid4().hex[:10]
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"envozet-{ek}@test.local",
                hashed_password="test-only",
                first_name="Envanter",
                last_name="Ozet",
                username=f"eo{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"EO_{ek.upper()}", name="Envanter ozet",
                    permission_codes=izinler,
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            self.admin_ids.append(a.id)
            self.role_ids.append(rol.id)
            token = create_access_token(subject=a.id, role="ADMIN", role_id=1)
            return {"Authorization": f"Bearer {token}"}

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.admin_ids:
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_id = ANY(:i) AND actor_role = 1"
                    ),
                    {"i": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text("DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:i)"),
                    {"i": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"), {"i": self.role_ids}
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


async def _oturum_ac(client, h, *pids: int) -> int:
    r = await client.post(
        f"{KOK}/count-sessions",
        json={"scope": "MANUAL", "product_ids": list(pids)},
        headers=h,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def _say_hepsini(client, h, sid: int, adet: int) -> None:
    for satir in (await client.get(f"{KOK}/count-sessions/{sid}", headers=h)).json()["lines"]:
        r = await client.post(
            f"{KOK}/count-sessions/{sid}/lines/{satir['id']}/count",
            json={"counted_qty": adet if satir["bucket"] == "SALEABLE" else 0},
            headers=h,
        )
        assert r.status_code == 200, r.text


async def _belirsizlestir(pid: int) -> None:
    """Sayımdan sonra fiziksel etkisi belirsiz bir olay yazar → satır STALE."""
    from services import stock_ledger

    async with AsyncSessionLocal() as db:
        await stock_ledger.apply_movement(
            db, pid, qty_delta=+1, bucket=stock_ledger.StockBucket.SALEABLE,
            movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="SAYIM_FARKI", actor_type="ADMIN", actor_id=1,
            idempotency_key=f"stale-{uuid.uuid4().hex[:12]}",
        )
        await db.commit()


# ══════════════════════ 1. Ürün kimliği ══════════════════════


async def test_DETAY_satirinda_urun_ADI_ve_SKU_doner(client, kur, fab):
    h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=5, title="Palme TYT Matematik Soru Bankası")
    sid = await _oturum_ac(client, h, pid)

    r = await client.get(f"{KOK}/count-sessions/{sid}", headers=h)
    assert r.status_code == 200, r.text
    satir = r.json()["lines"][0]
    assert satir["product_name"] == "Palme TYT Matematik Soru Bankası"
    assert satir["product_sku"], "SKU boş döndü"
    assert satir["product_id"] == pid

    # SKU üründen gelir, uydurulmaz.
    async with AsyncSessionLocal() as db:
        gercek = (
            await db.execute(text("SELECT sku FROM products WHERE id = :i"), {"i": pid})
        ).scalar_one()
    assert satir["product_sku"] == gercek


async def test_SAYIM_yaniti_da_urun_kimligini_tasir(client, kur, fab):
    """Tek satır dönen uçlar da aynı sözleşmeyi taşımalı; aksi hâlde sayım
    kaydedildikten sonra ekranda ürün adı KAYBOLUR."""
    h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=5, title="Karekök AYT Fizik")
    sid = await _oturum_ac(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    satir = (await client.get(f"{KOK}/count-sessions/{sid}", headers=h)).json()["lines"][0]

    r = await client.post(
        f"{KOK}/count-sessions/{sid}/lines/{satir['id']}/count",
        json={"counted_qty": 5},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["product_name"] == "Karekök AYT Fizik"
    assert r.json()["product_sku"]


async def test_YALNIZ_inventory_view_urun_adini_gorebilir(client, kur, fab):
    """Sayım görevini yapmak için ürün adı ŞART. Bunu `products.view` iznine
    bağlamak, sayan kişiye ürün kataloğu yetkisi vermeyi zorunlu kılardı."""
    hy = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=3, title="Bilgi Sarmal LGS Türkçe")
    sid = await _oturum_ac(client, hy, pid)

    h = await kur.admin(izinler=[VIEW])  # products.view YOK
    r = await client.get(f"{KOK}/count-sessions/{sid}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["lines"][0]["product_name"] == "Bilgi Sarmal LGS Türkçe"


# ══════════════════════ 2. Liste özeti ══════════════════════


async def test_LISTE_line_count_ve_has_stale_doner(client, kur, fab):
    h = await kur.admin(izinler=TAM)
    sid = await _oturum_ac(client, h, await fab.urun(stock=6))

    r = await client.get(f"{KOK}/count-sessions?limit=25&offset=0", headers=h)
    assert r.status_code == 200, r.text
    kayit = [o for o in r.json()["items"] if o["id"] == sid][0]
    assert kayit["line_count"] == 2, "ürün başına iki kova satırı beklenir"
    assert kayit["uncounted_line_count"] == 2
    assert kayit["has_stale"] is False


async def test_LISTE_has_stale_gercek_STALE_satirda_true(client, kur, fab):
    h = await kur.admin(izinler=TAM)
    pid = await fab.urun(stock=6)
    sid = await _oturum_ac(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    await _say_hepsini(client, h, sid, 6)
    await _belirsizlestir(pid)
    await client.post(f"{KOK}/count-sessions/{sid}/submit", headers=h)

    r = await client.get(f"{KOK}/count-sessions?limit=25&offset=0", headers=h)
    kayit = [o for o in r.json()["items"] if o["id"] == sid][0]
    assert kayit["has_stale"] is True, "STALE satır varken has_stale false döndü"
    assert kayit["uncounted_line_count"] == 0


async def test_LISTE_ozeti_SAYFALAMA_ile_dogru_kalir(client, kur, fab):
    """Aggregate sayfa dışına taşmamalı: her satır KENDİ oturumunun sayısını
    taşır, komşusununkini değil."""
    h = await kur.admin(izinler=TAM)
    sid_kucuk = await _oturum_ac(client, h, await fab.urun(stock=1))  # 2 satır
    sid_buyuk = await _oturum_ac(
        client, h, await fab.urun(stock=1), await fab.urun(stock=1)
    )  # 4 satır

    s1 = (await client.get(f"{KOK}/count-sessions?limit=1&offset=0", headers=h)).json()
    s2 = (await client.get(f"{KOK}/count-sessions?limit=1&offset=1", headers=h)).json()
    hepsi = {o["id"]: o for o in s1["items"] + s2["items"]}

    assert hepsi[sid_buyuk]["line_count"] == 4
    assert hepsi[sid_kucuk]["line_count"] == 2
    assert s1["total"] == s2["total"] >= 2, "sayfalama toplamı bozuldu"
    assert len(s1["items"]) == 1


async def test_AYNI_SAYFADAKI_oturumlar_KENDI_sayilarini_tasir(client, kur, fab):
    """Aynı sayfada FARKLI boyutta oturumlar bulunmalı ve her satır KENDİ
    sayısını taşımalı.

    Bu test mutasyon provasında doğdu: `limit=1` ile iki ayrı sayfa istemek,
    "özeti sayfadaki ilk oturumdan al" gibi bir hatayı GÖREMİYORDU — sayfada
    zaten tek oturum vardı. Yanlış atama ancak tek sayfada birden çok oturum
    varken görünür.
    """
    h = await kur.admin(izinler=TAM)
    kucuk = await _oturum_ac(client, h, await fab.urun(stock=1))  # 2 satır
    orta = await _oturum_ac(
        client, h, await fab.urun(stock=1), await fab.urun(stock=1)
    )  # 4 satır
    buyuk = await _oturum_ac(
        client, h,
        await fab.urun(stock=1), await fab.urun(stock=1), await fab.urun(stock=1),
    )  # 6 satır

    r = await client.get(f"{KOK}/count-sessions?limit=25&offset=0", headers=h)
    assert r.status_code == 200, r.text
    kayit = {o["id"]: o for o in r.json()["items"]}
    assert kayit[kucuk]["line_count"] == 2
    assert kayit[orta]["line_count"] == 4
    assert kayit[buyuk]["line_count"] == 6
    # Üçü de aynı sayıyı taşıyorsa özet oturuma değil sayfaya bağlanmış demektir.
    assert len({kayit[s]["line_count"] for s in (kucuk, orta, buyuk)}) == 3


async def test_URUN_KIMLIGI_ve_OZET_parasal_alan_TASIMAZ(client, kur, fab):
    h = await kur.admin(izinler=TAM)
    sid = await _oturum_ac(client, h, await fab.urun(stock=4, title="Görünmemeli"))
    for yol in (f"{KOK}/count-sessions?limit=5&offset=0", f"{KOK}/count-sessions/{sid}"):
        govde = (await client.get(yol, headers=h)).text.lower()
        for yasak in ("price", "cost", "amount", "currency", "maliyet", "tutar"):
            assert yasak not in govde, f"{yol} → parasal alan sızmış: {yasak}"


# ══════════════════════ 3. N+1 kanıtı ══════════════════════


async def test_URUN_KIMLIGI_ve_OZET_N_ARTI_BIR_URETMEZ(client, kur, fab):
    """Sorgu sayısı satır/oturum sayısından BAĞIMSIZ olmalı.

    Ölçüm gerçek SQL üzerinden: motorun `before_cursor_execute` olayı dinlenir.
    Satır sayısı üçe katlandığında sorgu sayısı değişmiyorsa, birleştirme satır
    başına değil TOPLU yapılıyor demektir.
    """
    from sqlalchemy import event

    from core.database import engine

    h = await kur.admin(izinler=TAM)
    kucuk = await _oturum_ac(client, h, await fab.urun(stock=1))  # 2 satır
    buyuk = await _oturum_ac(
        client, h,
        await fab.urun(stock=1), await fab.urun(stock=1), await fab.urun(stock=1),
    )  # 6 satır

    sorgular: list[str] = []

    def dinle(conn, cursor, statement, params, context, executemany):
        sorgular.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", dinle)
    try:
        sorgular.clear()
        await client.get(f"{KOK}/count-sessions/{kucuk}", headers=h)
        az = len(sorgular)
        sorgular.clear()
        await client.get(f"{KOK}/count-sessions/{buyuk}", headers=h)
        cok = len(sorgular)

        sorgular.clear()
        await client.get(f"{KOK}/count-sessions?limit=1&offset=0", headers=h)
        bir_oturum = len(sorgular)
        sorgular.clear()
        await client.get(f"{KOK}/count-sessions?limit=25&offset=0", headers=h)
        cok_oturum = len(sorgular)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", dinle)

    assert az == cok, f"detay ucu N+1 üretiyor: 2 satır={az} sorgu, 6 satır={cok} sorgu"
    assert bir_oturum == cok_oturum, (
        f"liste ucu N+1 üretiyor: 1 oturum={bir_oturum} sorgu, "
        f"25 oturum={cok_oturum} sorgu"
    )
