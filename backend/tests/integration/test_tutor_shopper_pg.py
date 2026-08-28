"""Eğitmen alıcı — gerçek HTTP + gerçek PostgreSQL.

Sözleşme: `docs/egitmen-alici-sozlesme.md`. Test adları oradaki kırmızı test
matrisinin madde numaralarını (K-n) taşır.

Dependency override YOK: rol kararı üretimdeki yoldan (`get_shopping_client`)
çözülür, token `auth_headers` ile gerçek `auth_ver` claim'inden üretilir.
"""
from __future__ import annotations

import dataclasses
import datetime
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from core import flags
from core.database import AsyncSessionLocal
from core.security import decode_access_token, hash_password_async
from models.admin import Admin
from models.client import Client
from models.store import Product
from models.tutor import Tutor, TutorStatus
from schemas.admin_access import AdminRoleCreate
from tests.integration.auth_headers import bearer_headers
from tests.integration.db_guard import purge_products
from tests.integration.product_category import integration_product_category_id
from services import admin_access_service, feature_flag_service, stock_ledger

#: Fabrikanın ürettiği eğitmenlerin gerçek parolası — `POST /auth/login`
#: bcrypt hash'i ister; "test-only" gibi ham metin `verify_password` içinde
#: ValueError üretir.
TEST_PAROLA = "Str0ngPass!42"

pytestmark = pytest.mark.asyncio


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@dataclasses.dataclass
class Egitmen:
    tutor_id: int
    email: str
    headers: dict


@pytest.fixture
async def fabA(pg):
    f = AliciFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


class AliciFabrikasi:
    """Eğitmen + ürün + (gölge üzerinden doğan) sipariş satırlarını yönetir."""

    def __init__(self) -> None:
        self.tutor_ids: list[int] = []
        self.client_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []
        self.product_ids: list[int] = []
        self.order_ids: list[int] = []
        self.flag_keys: list[str] = []

    async def egitmen(self, *, telefon_dogrulu: bool = True) -> Egitmen:
        ek = _uniq()
        eposta = f"alici-{ek}@example.com"
        async with AsyncSessionLocal() as s:
            t = Tutor(
                email=eposta,
                hashed_password=await hash_password_async(TEST_PAROLA),
                first_name="Alici",
                last_name="Egitmen",
                username=f"ae{ek}",
                role_id=2,
                status=TutorStatus.APPROVED,
                hourly_rate=Decimal("500"),
                phone=f"+90555{ek[:7]}",
                phone_verified_at=_now() if telefon_dogrulu else None,
            )
            s.add(t)
            await s.flush()
            tid = t.id
            await s.commit()
        self.tutor_ids.append(tid)
        return Egitmen(
            tutor_id=tid,
            email=eposta,
            headers=await bearer_headers(tid, role="TUTOR", role_id=2),
        )

    async def musteri(self) -> tuple[int, dict]:
        ek = _uniq()
        async with AsyncSessionLocal() as s:
            c = Client(
                email=f"alici-c-{ek}@test.local",
                hashed_password="test-only",
                first_name="Gercek",
                last_name="Ogrenci",
                username=f"ac{ek}",
                role_id=3,
                phone=f"+90555{ek[:7]}",
                phone_verified_at=_now(),
            )
            s.add(c)
            await s.flush()
            cid = c.id
            await s.commit()
        self.client_ids.append(cid)
        return cid, await bearer_headers(cid, role="CLIENT", role_id=3)

    async def admin(self, *, izinler: list[str] | None = None) -> tuple[int, dict]:
        """Gerçek admin + gerçek rol/izin satırları (izin kararı üretim yolundan)."""
        ek = _uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"alici-a-{ek}@test.local",
                hashed_password="test-only",
                first_name="Alici",
                last_name="Admin",
                username=f"aa{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            aid = a.id
            if izinler:
                rol = await admin_access_service.create_role(
                    s,
                    AdminRoleCreate(
                        code=f"ALICI_{ek.upper()}",
                        name="Alici Test Rolu",
                        permission_codes=izinler,
                    ),
                )
                await admin_access_service.assign_role(
                    s, admin_id=aid, role_id=rol.id, assigned_by_admin_id=aid
                )
                self.role_ids.append(rol.id)
            await s.commit()
        self.admin_ids.append(aid)
        return aid, await bearer_headers(aid, role="ADMIN", role_id=1)

    async def bayrak_ac(self, admin_id: int, key: str) -> None:
        async with AsyncSessionLocal() as s:
            await feature_flag_service.set_flag(
                s, key=key, enabled=True, admin_id=admin_id, note="entegrasyon testi"
            )
            await s.commit()
        flags.invalidate(key)
        self.flag_keys.append(key)

    async def urun(
        self,
        *,
        price: str = "100.00",
        kind: str = "PHYSICAL",
        seller_type: str = "PLATFORM",
        tutor_id: int | None = None,
        stock: int = 50,
    ) -> int:
        async with AsyncSessionLocal() as s:
            p = Product(
                slug=f"alici-{_uniq()}",
                title=f"Alici Urun {_uniq()}",
                kind=kind,
                seller_type=seller_type,
                tutor_id=tutor_id,
                price=Decimal(price),
                tax_rate=Decimal("0"),
                stock=0 if kind == "PHYSICAL" else None,
                status="ACTIVE",
                category_id=await integration_product_category_id(s),
            )
            s.add(p)
            await s.flush()
            pid = p.id
            await s.commit()
        self.product_ids.append(pid)
        if kind == "PHYSICAL" and stock:
            async with AsyncSessionLocal() as s:
                await stock_ledger.apply_movement(
                    s,
                    pid,
                    qty_delta=stock,
                    bucket=stock_ledger.StockBucket.SALEABLE,
                    movement_type=stock_ledger.StockMovementType.INITIAL,
                    reason_code="PRODUCT_CREATE",
                    ref_type="product",
                    ref_id=pid,
                    idempotency_key=stock_ledger.idempotency_key_for(
                        stock_ledger.StockMovementType.INITIAL, product_id=pid
                    ),
                )
                await s.commit()
        return pid

    async def adres_ekle(self, http, headers: dict, *, beklenen: int = 201) -> int | None:
        """GERÇEK ``POST /me/addresses`` — rol kapısı üretim yolundan geçer."""
        r = await http.post(
            "/api/v1/me/addresses",
            json={
                "title": "Ev",
                "recipient_name": "Alici Egitmen",
                "phone": "+905550000000",
                "address_line": "Test Mah. Test Sok. No:1",
                "city": "Adana",
                "district": "Seyhan",
                "location_lat": "37.000000",
                "location_lng": "35.320000",
                "is_default": True,
            },
            headers=headers,
        )
        assert r.status_code == beklenen, f"{r.status_code}: {r.text}"
        return r.json()["id"] if r.status_code == 201 else None

    async def siparis_ver(
        self,
        http,
        headers: dict,
        *,
        address_id: int | None,
        items: list[tuple[int, int]],
        beklenen: int = 201,
    ) -> dict:
        gövde = {"items": [{"product_id": p, "quantity": q} for p, q in items]}
        if address_id is not None:
            gövde["address_id"] = address_id
        r = await http.post("/api/v1/store/orders", json=gövde, headers=headers)
        assert r.status_code == beklenen, f"{r.status_code}: {r.text}"
        data = r.json()
        if r.status_code == 201:
            self.order_ids.append(data["id"])
        return data

    # ── Ham okumalar (ORM kimlik haritasını atlar) ───────────────────────────

    async def golge(self, tutor_id: int) -> dict | None:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text(
                        "SELECT id, email, username, is_active, hashed_password, "
                        "first_name, last_name, phone_verified_at "
                        "FROM clients WHERE shadow_of_tutor_id = :t "
                        "AND deleted_at IS NULL"
                    ),
                    {"t": tutor_id},
                )
            ).mappings().first()
        return dict(row) if row else None

    async def siparis_alicisi(self, order_id: int) -> int:
        async with AsyncSessionLocal() as s:
            return int(
                (
                    await s.execute(
                        text("SELECT client_id FROM orders WHERE id = :i"),
                        {"i": order_id},
                    )
                ).scalar_one()
            )

    async def bildirimler(self, *, user_id: int, role_id: int) -> list[str]:
        async with AsyncSessionLocal() as s:
            return [
                r[0]
                for r in (
                    await s.execute(
                        text(
                            "SELECT message FROM notifications "
                            "WHERE user_id = :u AND role_id = :r"
                        ),
                        {"u": user_id, "r": role_id},
                    )
                ).all()
            ]

    async def kalem_kazanci(self, order_id: int) -> list[tuple]:
        async with AsyncSessionLocal() as s:
            return [
                tuple(r)
                for r in (
                    await s.execute(
                        text(
                            "SELECT tutor_id, commission_amount, tutor_earning "
                            "FROM order_items WHERE order_id = :o"
                        ),
                        {"o": order_id},
                    )
                ).all()
            ]

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.order_ids:
                for tablo in (
                    "coupon_redemptions",
                    "order_items",
                    "order_status_history",
                ):
                    await s.execute(
                        text(f"DELETE FROM {tablo} WHERE order_id = ANY(:o)"),
                        {"o": self.order_ids},
                    )
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE target_type = 'order' "
                        "AND target_id = ANY(:o)"
                    ),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text(
                        "DELETE FROM outbox_events "
                        "WHERE kind = 'email:order_status' "
                        "AND (payload->>'order_id')::int = ANY(:o)"
                    ),
                    {"o": self.order_ids},
                )
                await s.execute(
                    text("DELETE FROM orders WHERE id = ANY(:o)"),
                    {"o": self.order_ids},
                )
            if self.product_ids:
                await purge_products(s, self.product_ids)
            if self.tutor_ids:
                # Gölge, eğitmene ON DELETE CASCADE ile bağlı; adresleri ve
                # bildirimleri önce düşer.
                golge_ids = [
                    r[0]
                    for r in (
                        await s.execute(
                            text(
                                "SELECT id FROM clients "
                                "WHERE shadow_of_tutor_id = ANY(:t)"
                            ),
                            {"t": self.tutor_ids},
                        )
                    ).all()
                ]
                hepsi = self.client_ids + golge_ids
                if hepsi:
                    await s.execute(
                        text(
                            "DELETE FROM client_addresses WHERE client_id = ANY(:c)"
                        ),
                        {"c": hepsi},
                    )
                    await s.execute(
                        text(
                            "DELETE FROM notifications "
                            "WHERE user_id = ANY(:c) AND role_id = 3"
                        ),
                        {"c": hepsi},
                    )
                    await s.execute(
                        text("DELETE FROM clients WHERE id = ANY(:c)"),
                        {"c": hepsi},
                    )
                await s.execute(
                    text(
                        "DELETE FROM notifications "
                        "WHERE user_id = ANY(:t) AND role_id = 2"
                    ),
                    {"t": self.tutor_ids},
                )
                # `POST /auth/login` (K-11) gerçek bir refresh token satırı
                # yazar; hijyen nöbetçisi kalıcı satırı yakalar.
                await s.execute(
                    text(
                        "DELETE FROM refresh_tokens "
                        "WHERE user_id = ANY(:t) AND role_id = 2"
                    ),
                    {"t": self.tutor_ids},
                )
                await s.execute(
                    text("DELETE FROM tutors WHERE id = ANY(:t)"),
                    {"t": self.tutor_ids},
                )
            if self.flag_keys:
                # Bayrak DB'de yaşar: açık bırakılan satır sonraki testlere ve
                # geliştirme ortamına sızar. Süreç içi önbellek de temizlenir.
                await s.execute(
                    text("DELETE FROM feature_flags WHERE key = ANY(:k)"),
                    {"k": self.flag_keys},
                )
            if self.admin_ids:
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_id = ANY(:a) "
                        "AND actor_role = 1"
                    ),
                    {"a": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text("DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:r)"),
                    {"r": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:r)"),
                    {"r": self.role_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
            await s.commit()
        for key in self.flag_keys:
            flags.invalidate(key)


# ── K-1 · K-2 · K-3 — eğitmen adres ekler, sipariş verir, gölge doğar ────────


async def test_K1_K2_K3_egitmen_adres_ekleyip_siparis_verir(fabA, http):
    e = await fabA.egitmen()
    assert await fabA.golge(e.tutor_id) is None, "gölge istek öncesi var olmamalı"

    adres_id = await fabA.adres_ekle(http, e.headers)  # K-1
    golge = await fabA.golge(e.tutor_id)
    assert golge is not None, "adres ucu gölgeyi doğurmalıydı"
    assert golge["email"] == e.email, "kimlik yansıtılmalı (§1.5)"
    assert golge["is_active"] is False and golge["hashed_password"] == "!"

    pid = await fabA.urun()
    siparis = await fabA.siparis_ver(  # K-2
        http, e.headers, address_id=adres_id, items=[(pid, 1)]
    )
    assert await fabA.siparis_alicisi(siparis["id"]) == golge["id"]  # K-3


# ── K-4 — telefon kapısı eğitmende de geçerli ────────────────────────────────


async def test_K4_telefonu_dogrulanmamis_egitmen_siparis_veremez(fabA, http):
    e = await fabA.egitmen(telefon_dogrulu=False)
    adres_id = await fabA.adres_ekle(http, e.headers)
    pid = await fabA.urun()

    await fabA.siparis_ver(
        http, e.headers, address_id=adres_id, items=[(pid, 1)], beklenen=403
    )

    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE tutors SET phone_verified_at = now() WHERE id = :t"),
            {"t": e.tutor_id},
        )
        await s.commit()

    await fabA.siparis_ver(http, e.headers, address_id=adres_id, items=[(pid, 1)])


# ── K-5 · K-6 — sipariş izolasyonu ve IDOR ──────────────────────────────────


async def test_K5_K6_baska_egitmenin_siparisi_gorunmez(fabA, http):
    a = await fabA.egitmen()
    b = await fabA.egitmen()
    adres_a = await fabA.adres_ekle(http, a.headers)
    await fabA.adres_ekle(http, b.headers)
    pid = await fabA.urun()

    siparis = await fabA.siparis_ver(
        http, a.headers, address_id=adres_a, items=[(pid, 1)]
    )

    r = await http.get("/api/v1/store/orders/mine", headers=a.headers)
    assert r.status_code == 200
    assert siparis["id"] in [o["id"] for o in r.json()]

    r = await http.get("/api/v1/store/orders/mine", headers=b.headers)
    assert r.status_code == 200
    assert siparis["id"] not in [o["id"] for o in r.json()], "K-5 sızıntısı"

    r = await http.get(
        f"/api/v1/store/orders/{siparis['id']}", headers=b.headers
    )
    assert r.status_code == 404, "K-6: başka alıcının siparişi 404 olmalı"


# ── K-8 — bildirim eğitmen kimliğine düşer, gölgeye değil ───────────────────


async def test_K8_siparis_bildirimi_egitmene_gider(fabA, http):
    """Sipariş iptali müşteriye bildirim yazar; hedef gölge değil eğitmen olmalı.

    Sipariş OLUŞTURMA müşteriye bildirim yazmaz (üretimde de yazmıyor);
    bildirim üreten ilk müşteri olayı iptaldir.
    """
    e = await fabA.egitmen()
    adres_id = await fabA.adres_ekle(http, e.headers)
    pid = await fabA.urun()
    siparis = await fabA.siparis_ver(
        http, e.headers, address_id=adres_id, items=[(pid, 1)]
    )

    r = await http.post(
        f"/api/v1/store/orders/{siparis['id']}/cancel", headers=e.headers
    )
    assert r.status_code == 200, r.text

    golge = await fabA.golge(e.tutor_id)
    assert await fabA.bildirimler(user_id=golge["id"], role_id=3) == [], (
        "gölgeye bildirim düşmemeli (§4.4)"
    )
    assert await fabA.bildirimler(user_id=e.tutor_id, role_id=2), (
        "bildirim eğitmen kimliğine yeniden adreslenmeliydi (§4.1)"
    )


# ── K-9 · K-10 — self-dealing kapısı ────────────────────────────────────────


async def test_K9_egitmen_kendi_urununu_siparis_edemez(fabA, http):
    e = await fabA.egitmen()
    adres_id = await fabA.adres_ekle(http, e.headers)
    kendi = await fabA.urun(
        kind="DIGITAL", seller_type="TUTOR", tutor_id=e.tutor_id, stock=0
    )

    r = await http.post(
        "/api/v1/store/orders",
        json={"items": [{"product_id": kendi, "quantity": 1}], "address_id": adres_id},
        headers=e.headers,
    )
    assert r.status_code == 409, f"self-dealing kapısı açık kaldı: {r.text}"

    async with AsyncSessionLocal() as s:
        kalan = (
            await s.execute(
                text(
                    "SELECT count(*) FROM order_items oi JOIN orders o "
                    "ON o.id = oi.order_id WHERE oi.product_id = :p"
                ),
                {"p": kendi},
            )
        ).scalar_one()
    assert kalan == 0, "reddedilen sipariş kalem yazmamalı"


async def test_K9_sepet_dogrulama_self_dealing_uyarir(fabA, http):
    e = await fabA.egitmen()
    kendi = await fabA.urun(
        kind="DIGITAL", seller_type="TUTOR", tutor_id=e.tutor_id, stock=0
    )
    r = await http.post(
        "/api/v1/store/cart/validate",
        json={"items": [{"product_id": kendi, "quantity": 1}]},
        headers=e.headers,
    )
    assert r.status_code == 200
    assert any("satın alamazsınız" in i for i in r.json()["issues"]), r.json()


async def test_K10_baska_egitmenin_urununde_kazanc_normal_yazilir(fabA, http):
    """Kapı yalnız ALICININ KENDİ ürününü kesmeli — başkasının satışı akmalı."""
    alici = await fabA.egitmen()
    satici = await fabA.egitmen()
    # Eğitmen dijital ürünü iki kapının ardında: pazaryeri ödeme kolu + dijital
    # ürün satışı. İkisi de üretimde varsayılan KAPALI (PK-1); bu test kolun
    # açık olduğu dünyayı ölçer.
    admin_id, _ = await fabA.admin()
    await fabA.bayrak_ac(admin_id, flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE)
    await fabA.bayrak_ac(admin_id, flags.FLAG_DIGITAL_PRODUCTS_LIVE)

    adres_id = await fabA.adres_ekle(http, alici.headers)
    urun = await fabA.urun(
        kind="DIGITAL", seller_type="TUTOR", tutor_id=satici.tutor_id, stock=0
    )

    siparis = await fabA.siparis_ver(
        http, alici.headers, address_id=adres_id, items=[(urun, 1)]
    )
    kalemler = await fabA.kalem_kazanci(siparis["id"])
    assert kalemler and kalemler[0][0] == satici.tutor_id
    assert kalemler[0][2] is not None and Decimal(str(kalemler[0][2])) > 0, (
        "satıcı eğitmenin kazancı yazılmalıydı"
    )


# ── K-7 — fatura alıcı adı gölgenin değil eğitmenin gerçek adı ──────────────


async def test_K7_fatura_alici_adi_egitmenin_gercek_adi(fabA, http, monkeypatch):
    """Dijital-yalnız siparişte fatura adı hesap sahibinden düşer.

    Kargo adresi olmadığı için `order.ship_recipient` boştur ve
    `invoice_service._hesap_adi` devreye girer: `order.client.full_name`.
    Yansıtma çalışmazsa burada boş ya da eski bir ad görünürdü.
    """
    from core.config import settings

    # Üretimde uç kapalıdır (mali müşavir onayı bekliyor); bu test açık dünyayı
    # ölçer. Satıcı kimliği de tam olmalı, yoksa uç 409 verir.
    monkeypatch.setattr(settings, "INVOICE_ENABLED", True, raising=False)
    for alan, deger in (
        ("INVOICE_SELLER_NAME", "Alici Test Satici"),
        ("INVOICE_SELLER_TAX_NUMBER", "5590521517"),
        ("INVOICE_SELLER_TAX_OFFICE", "Test VD"),
        ("INVOICE_SELLER_ADDRESS", "Adana, Türkiye"),
        ("INVOICE_SELLER_PHONE", "+905550000000"),
        ("INVOICE_SELLER_EMAIL", "bilgi@test.local"),
    ):
        monkeypatch.setattr(settings, alan, deger, raising=False)

    alici = await fabA.egitmen()
    satici = await fabA.egitmen()
    admin_id, _ = await fabA.admin()
    await fabA.bayrak_ac(admin_id, flags.FLAG_TUTOR_MARKETPLACE_PAYMENTS_LIVE)
    await fabA.bayrak_ac(admin_id, flags.FLAG_DIGITAL_PRODUCTS_LIVE)

    urun = await fabA.urun(
        kind="DIGITAL", seller_type="TUTOR", tutor_id=satici.tutor_id, stock=0
    )
    siparis = await fabA.siparis_ver(
        http, alici.headers, address_id=None, items=[(urun, 1)]
    )

    r = await http.get(
        f"/api/v1/store/orders/{siparis['id']}/invoice", headers=alici.headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["buyer"]["name"] == "Alici Egitmen", r.json()["buyer"]


# ── K-11 · K-12 · K-13 · K-14 — gölge bir giriş öznesi değildir ─────────────


async def test_K11_golge_epostasiyla_giris_yapilamaz(fabA, http):
    e = await fabA.egitmen()
    await fabA.adres_ekle(http, e.headers)  # gölgeyi doğur
    golge = await fabA.golge(e.tutor_id)
    assert golge is not None and golge["email"] == e.email

    # Gölge eğitmenin e-postasını taşıyor. Doğru parola EĞİTMEN satırına aittir
    # ve giriş her hâlde TUTOR döner; gölge asla bir principal olmaz.
    r = await http.post(
        "/api/v1/auth/login",
        data={"username": e.email, "password": TEST_PAROLA},
    )
    assert r.status_code == 200, r.text
    iddia = decode_access_token(r.json()["access_token"])
    assert iddia["role_id"] == 2 and int(iddia["sub"]) == e.tutor_id, (
        "giriş EĞİTMEN satırını döndürmeli, gölgeyi değil"
    )

    # Gölgenin kendi parolası ("!") hiçbir şeyle eşleşmez ve sorgudan da
    # düşürülmüştür → yanlış parola 500 değil temiz 401 verir.
    r = await http.post(
        "/api/v1/auth/login",
        data={"username": e.email, "password": "yanlis-parola-42"},
    )
    assert r.status_code == 401, r.text


async def test_K12_sifre_sifirlama_golgeyi_bulmaz(fabA, http):
    from services import auth_service

    e = await fabA.egitmen()
    await fabA.adres_ekle(http, e.headers)
    async with AsyncSessionLocal() as s:
        bulunan = await auth_service.find_by_email(s, email=e.email)
    assert isinstance(bulunan, Tutor) and bulunan.id == e.tutor_id


async def test_K13_K14_golge_tekillik_alanini_tuketmez(fabA, http):
    e = await fabA.egitmen()
    await fabA.adres_ekle(http, e.headers)
    golge = await fabA.golge(e.tutor_id)

    # K-14: eğitmenin e-postasıyla ayrı bir öğrenci hesabı hâlâ açılabilir.
    r = await http.post(
        "/api/v1/auth/register/client",
        json={
            "email": e.email,
            "password": TEST_PAROLA,
            "first_name": "Ayri",
            "last_name": "Ogrenci",
            "username": f"ayri{_uniq()}",
            "consent_version": "2026-01-01",
        },
    )
    assert r.status_code == 201, f"gölge e-posta tekilliğini kilitledi: {r.text}"
    fabA.client_ids.append(r.json()["id"])

    # K-13: gölgenin türetilmiş kullanıcı adı global isim alanında yer tutmaz.
    r = await http.post(
        "/api/v1/auth/register/client",
        json={
            "email": f"ayri-{_uniq()}@example.com",
            "password": TEST_PAROLA,
            "first_name": "Ad",
            "last_name": "Cakismasi",
            "username": golge["username"],
            "consent_version": "2026-01-01",
        },
    )
    assert r.status_code == 201, f"gölge kullanıcı adını kilitledi: {r.text}"
    fabA.client_ids.append(r.json()["id"])


# ── K-15 — yansıtma driftte kalmaz ──────────────────────────────────────────


async def test_K15_egitmen_adi_degisince_golge_tazelenir(fabA, http):
    e = await fabA.egitmen()
    await fabA.adres_ekle(http, e.headers)
    assert (await fabA.golge(e.tutor_id))["first_name"] == "Alici"

    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE tutors SET first_name = 'Yeni' WHERE id = :t"),
            {"t": e.tutor_id},
        )
        await s.commit()

    r = await http.get("/api/v1/me/addresses", headers=e.headers)
    assert r.status_code == 200
    assert (await fabA.golge(e.tutor_id))["first_name"] == "Yeni", "drift kaldı"


# ── K-16 — gölge admin dizininde ve sayaçlarında yok ────────────────────────


async def test_K16_golge_admin_dizininde_gorunmez(fabA, http):
    e = await fabA.egitmen()
    await fabA.adres_ekle(http, e.headers)
    golge = await fabA.golge(e.tutor_id)
    _aid, admin_h = await fabA.admin(izinler=["users.view"])

    r = await http.get(
        f"/api/v1/admin/users?q={e.email}&role=CLIENT", headers=admin_h
    )
    assert r.status_code == 200, r.text
    gövde = r.json()
    satirlar = gövde["items"] if isinstance(gövde, dict) else gövde
    assert all(u["id"] != golge["id"] for u in satirlar), "gölge dizinde (§5.1)"

    r = await http.get(
        f"/api/v1/admin/users/client/{golge['id']}", headers=admin_h
    )
    assert r.status_code == 404, "gölge detayı 404 olmalı (§5.2)"


# ── K-18 — yolda kargosu olan eğitmen hesabını kapatamaz ────────────────────


async def test_K18_acik_siparisli_egitmen_hesabini_kapatamaz(fabA, http):
    from services import account_deletion_service

    e = await fabA.egitmen()
    adres_id = await fabA.adres_ekle(http, e.headers)
    pid = await fabA.urun()
    await fabA.siparis_ver(http, e.headers, address_id=adres_id, items=[(pid, 1)])

    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, e.tutor_id)
        olur, gerekce = await account_deletion_service.can_delete(s, tutor)
    assert olur is False and "sipariş" in (gerekce or "").lower(), gerekce


# ── K-17 — eğitmen silinince gölge de anonimleşir ───────────────────────────


async def test_K17_egitmen_silinince_golge_anonimlesir(fabA, http):
    from services import account_deletion_service

    e = await fabA.egitmen()
    await fabA.adres_ekle(http, e.headers)
    golge = await fabA.golge(e.tutor_id)

    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, e.tutor_id)
        await account_deletion_service.anonymize_account(s, tutor)
        await s.commit()

    async with AsyncSessionLocal() as s:
        row = (
            await s.execute(
                text(
                    "SELECT email, deleted_at FROM clients WHERE id = :i"
                ),
                {"i": golge["id"]},
            )
        ).mappings().one()
    assert row["deleted_at"] is not None, "gölge kapanmalı (§5.3)"
    assert row["email"] != e.email, "gölge e-postası anonimleşmeli"


# ── K-20 · K-21 — kapsam sınırı ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "yol,govde",
    [
        ("/api/v1/bookings", {"tutor_id": 1, "start_at": "2030-01-01T10:00:00Z"}),
        ("/api/v1/demands", {"subject": "Matematik", "description": "x"}),
        ("/api/v1/bookmarks/1", None),
    ],
)
async def test_K20_kapsam_disi_uclar_egitmene_kapali(fabA, http, yol, govde):
    e = await fabA.egitmen()
    r = (
        await http.post(yol, json=govde, headers=e.headers)
        if govde is not None
        else await http.put(yol, headers=e.headers)
    )
    assert r.status_code == 403, f"{yol} eğitmene açılmış: {r.status_code}"


async def test_K21_admin_alici_yuzeyine_giremez(fabA, http):
    _aid, admin_h = await fabA.admin()
    r = await http.get("/api/v1/me/addresses", headers=admin_h)
    assert r.status_code == 403, "ADMIN alıcı olamaz (fail-closed)"
