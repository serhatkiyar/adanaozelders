"""Varyant grubu CRUD + ürün bağlama — GERÇEK HTTP + GERÇEK Postgres (Faz 2).

Uçlar `httpx.ASGITransport` ile, dependency override OLMADAN sürülür: yetki
zinciri (JWT + admin izin çözümü) ve IntegrityError→409 global handler'ı da
sınanır. Kısıtın kendisi Faz 1'de DB seviyesinde kanıtlandı; burada kanıtlanan
YÜZEY: admin uçları, servis kapıları (kitap kuralı, sözlük, anlamlı silme
hatası) ve türetme kopyası.

Koşum: tek kullanımlık `adana_varyant_test` DB'si (conftest kurar + migrate).
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.security import create_access_token
from models.admin import Admin
from models.store import ProductCategory, VariantGroup
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service
from tests.integration.db_guard import purge_products

VG = "/api/v1/store/admin/variant-groups"
URUN = "/api/v1/store/admin/products"


def _u() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Kurulum:
    """Admin + test verisi fabrikası; teardown HEPSİNİ fiziksel siler."""

    def __init__(self) -> None:
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []
        self.product_ids: list[int] = []
        self.group_ids: list[int] = []
        self.category_ids: list[int] = []

    async def admin(self, *, izinler: list[str]) -> tuple[int, str]:
        ek = _u()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"vry-{ek}@test.local", hashed_password="test-only",
                first_name="Varyant", last_name="Testi",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s,
                AdminRoleCreate(
                    code=f"VRY_{ek.upper()}", name="Varyant Testi",
                    permission_codes=izinler,
                ),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            self.admin_ids.append(a.id)
            self.role_ids.append(rol.id)
            return a.id, create_access_token(
                subject=a.id, role="ADMIN", role_id=1, auth_version=a.auth_version
            )

    async def kategori(self, *, slug: str, parent_id: int | None = None) -> int:
        async with AsyncSessionLocal() as s:
            c = ProductCategory(slug=slug, name=slug.title(), parent_id=parent_id)
            s.add(c)
            await s.commit()
            self.category_ids.append(c.id)
            return c.id

    async def grup(self, *, option1_name="Renk", option2_name=None) -> int:
        async with AsyncSessionLocal() as s:
            g = VariantGroup(
                title=f"Grup {_u()}", option1_name=option1_name,
                option2_name=option2_name,
            )
            s.add(g)
            await s.commit()
            self.group_ids.append(g.id)
            return g.id

    def urun_govdesi(self, **ek) -> dict:
        g = {
            "title": f"Varyant API Ürünü {_u()}",
            "kind": "PHYSICAL",
            "price": "100.00",
            "tax_rate": "0.20",
        }
        g.update(ek)
        return g

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            # Ürünler (varsa API'nin yarattıkları da): fabrika kayıtları +
            # bu koşumun grup üyeleri.
            if self.group_ids:
                ekstra = (
                    await s.execute(
                        text(
                            "SELECT id FROM products WHERE variant_group_id = ANY(:g)"
                        ),
                        {"g": self.group_ids},
                    )
                ).scalars().all()
                self.product_ids.extend(x for x in ekstra if x not in self.product_ids)
        async with AsyncSessionLocal() as s:
            if self.product_ids:
                await purge_products(s, self.product_ids)
        async with AsyncSessionLocal() as s:
            if self.group_ids:
                await s.execute(
                    text("DELETE FROM variant_groups WHERE id = ANY(:i)"),
                    {"i": self.group_ids},
                )
            if self.category_ids:
                await s.execute(
                    text("DELETE FROM product_categories WHERE id = ANY(:i)"),
                    {"i": list(reversed(self.category_ids))},
                )
            if self.admin_ids:
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
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"),
                    {"i": self.role_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM audit_logs WHERE actor_id = ANY(:i) AND actor_role = 1"),
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
        await k.cleanup()


def _bas(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _urun_kaydet(kur: Kurulum, r: httpx.Response) -> dict:
    veri = r.json()
    if r.status_code in (200, 201) and "id" in veri:
        kur.product_ids.append(veri["id"])
    return veri


# ── Grup CRUD ────────────────────────────────────────────────────────────────


async def test_grup_olustur_listele_guncelle(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    r = await client.post(
        VG, json={"title": "Fosforlu Kalem", "option1_name": "Renk"}, headers=_bas(tok)
    )
    assert r.status_code == 201, r.text
    grup = r.json()
    kur.group_ids.append(grup["id"])
    assert grup["option1_name"] == "Renk"
    assert grup["option2_name"] is None
    assert grup["member_count"] == 0

    liste = await client.get(VG, headers=_bas(tok))
    assert liste.status_code == 200
    assert any(g["id"] == grup["id"] for g in liste.json())

    r = await client.patch(
        f"{VG}/{grup['id']}",
        json={"title": "Fosforlu Kalem Seti", "option2_name": "Uç Kalınlığı"},
        headers=_bas(tok),
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Fosforlu Kalem Seti"
    assert r.json()["option2_name"] == "Uç Kalınlığı"


async def test_sozluk_disi_eksen_adi_reddedilir(client, kur):
    """NEGATİF KONTROL: serbest metin eksen adı 422 (Pydantic) — DB'ye inmez."""
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    r = await client.post(
        VG, json={"title": "Kaçak", "option1_name": "Koku"}, headers=_bas(tok)
    )
    assert r.status_code == 422, r.text


async def test_ayni_eksen_iki_kez_reddedilir(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    r = await client.post(
        VG,
        json={"title": "Çift Renk", "option1_name": "Renk", "option2_name": "Renk"},
        headers=_bas(tok),
    )
    assert r.status_code == 422, r.text


async def test_yetkisiz_admin_403_ve_anonim_401(client, kur):
    _aid, tok = await kur.admin(izinler=["dashboard.view"])
    r = await client.post(
        VG, json={"title": "X", "option1_name": "Renk"}, headers=_bas(tok)
    )
    assert r.status_code == 403
    r = await client.get(VG)
    assert r.status_code == 401


async def test_bos_grup_silinir_uyeli_grup_409(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    bos = await kur.grup()
    r = await client.delete(f"{VG}/{bos}", headers=_bas(tok))
    assert r.status_code == 204
    kur.group_ids.remove(bos)

    dolu = await kur.grup()
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(
            variant_group_id=dolu, option1_value="Sarı", barcode=f"869{_u()}"
        ),
        headers=_bas(tok),
    )
    assert r.status_code == 201, r.text
    _urun_kaydet(kur, r)
    r = await client.delete(f"{VG}/{dolu}", headers=_bas(tok))
    assert r.status_code == 409
    # RESTRICT'in ham "violates foreign key" metni değil, anlamlı Türkçe mesaj.
    assert "ürün" in r.json()["detail"].lower()


# ── Ürün ↔ grup bağlama ──────────────────────────────────────────────────────


async def test_urun_gruba_baglanir_ve_kardesler_listelenir(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    g = await kur.grup(option1_name="Renk")
    for renk in ("Sarı", "Pembe"):
        r = await client.post(
            URUN,
            json=kur.urun_govdesi(
                title=f"Fosforlu Kalem - {renk}",
                variant_group_id=g,
                option1_value=renk,
                variant_sort=0 if renk == "Sarı" else 1,
                barcode=f"869{_u()}",
            ),
            headers=_bas(tok),
        )
        assert r.status_code == 201, r.text
        veri = _urun_kaydet(kur, r)
        assert veri["variant_group_id"] == g
        assert veri["option1_value"] == renk

    detay = await client.get(f"{VG}/{g}", headers=_bas(tok))
    assert detay.status_code == 200
    uyeler = detay.json()["members"]
    assert [m["option1_value"] for m in uyeler] == ["Sarı", "Pembe"]  # variant_sort sırası
    assert detay.json()["member_count"] == 2


async def test_gruplu_urun_barkodsuz_400(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    g = await kur.grup()
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(variant_group_id=g, option1_value="Sarı"),
        headers=_bas(tok),
    )
    assert r.status_code == 400, r.text
    assert "barkod" in r.json()["detail"].lower()


async def test_iki_eksenli_grupta_option2_zorunlu(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    g = await kur.grup(option1_name="Renk", option2_name="Ebat")
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(
            variant_group_id=g, option1_value="Sarı", barcode=f"869{_u()}"
        ),
        headers=_bas(tok),
    )
    assert r.status_code == 400, r.text


async def test_tek_eksenli_grupta_option2_reddedilir(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    g = await kur.grup(option1_name="Renk")
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(
            variant_group_id=g, option1_value="Sarı", option2_value="A4",
            barcode=f"869{_u()}",
        ),
        headers=_bas(tok),
    )
    assert r.status_code == 400, r.text


async def test_ayni_kombinasyon_api_uzerinden_409(client, kur):
    """NEGATİF KONTROL: kombinasyon tekilliği HTTP yüzeyinden 409 olarak döner."""
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    g = await kur.grup(option1_name="Renk")
    r1 = await client.post(
        URUN,
        json=kur.urun_govdesi(
            variant_group_id=g, option1_value="Sarı", barcode=f"869{_u()}"
        ),
        headers=_bas(tok),
    )
    assert r1.status_code == 201
    _urun_kaydet(kur, r1)
    r2 = await client.post(
        URUN,
        json=kur.urun_govdesi(
            variant_group_id=g, option1_value="Sarı", barcode=f"869{_u()}"
        ),
        headers=_bas(tok),
    )
    assert r2.status_code == 409, r2.text
    _urun_kaydet(kur, r2)   # olur da yazıldıysa temizlensin


async def test_gruptan_cikarilan_urunun_optionlari_temizlenir(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    g = await kur.grup()
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(
            variant_group_id=g, option1_value="Sarı", barcode=f"869{_u()}"
        ),
        headers=_bas(tok),
    )
    pid = _urun_kaydet(kur, r)["id"]
    r = await client.patch(
        f"{URUN}/{pid}", json={"variant_group_id": None}, headers=_bas(tok)
    )
    assert r.status_code == 200, r.text
    veri = r.json()
    assert veri["variant_group_id"] is None
    assert veri["option1_value"] is None   # orphan CHECK'e çarpmadan temizlendi


# ── Kitap kuralı (servis kapısı HTTP yüzeyinde) ──────────────────────────────


async def test_kitap_kategorisinde_varyant_409(client, kur):
    """NEGATİF KONTROL hedefi: kapı kaldırılırsa bu test kırılmalı."""
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    kok = await kur.kategori(slug="kitap")             # BOOK_ROOT_SLUGS üyesi
    yaprak = await kur.kategori(slug=f"deneme-{_u()}", parent_id=kok)
    g = await kur.grup()
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(
            category_id=yaprak, variant_group_id=g,
            option1_value="Sarı", barcode=f"869{_u()}",
        ),
        headers=_bas(tok),
    )
    assert r.status_code == 409, r.text
    assert "kitap" in r.json()["detail"].lower()


async def test_gruplu_urun_kitap_kategorisine_tasinamaz(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    kok = await kur.kategori(slug="sinav-kitaplari")
    g = await kur.grup()
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(
            variant_group_id=g, option1_value="Sarı", barcode=f"869{_u()}"
        ),
        headers=_bas(tok),
    )
    pid = _urun_kaydet(kur, r)["id"]
    r = await client.patch(
        f"{URUN}/{pid}", json={"category_id": kok}, headers=_bas(tok)
    )
    assert r.status_code == 409, r.text


async def test_kitap_koku_kategorisi_silinemez_ve_yeniden_adlandirilamaz(client, kur):
    """Nöbetçi: BOOK_ROOT_SLUGS kökleri admin elinden sessizce kaybolamaz."""
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    kok = await kur.kategori(slug="okula-yardimci")
    KAT = "/api/v1/store/admin/categories"
    r = await client.delete(f"{KAT}/{kok}", headers=_bas(tok))
    assert r.status_code == 409, r.text
    r = await client.patch(
        f"{KAT}/{kok}", json={"name": "Yardımcı Kaynaklar"}, headers=_bas(tok)
    )
    assert r.status_code == 409, r.text
    # İkon/sıra gibi zararsız alanlar serbest kalmalı (kural yalnız slug'ı korur).
    r = await client.patch(f"{KAT}/{kok}", json={"sort_order": 5}, headers=_bas(tok))
    assert r.status_code == 200, r.text


# ── Varyant türetme ──────────────────────────────────────────────────────────


async def test_derive_variant_kunye_fiyat_gorsel_kopyalar(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    g = await kur.grup(option1_name="Renk")
    kaynak = await client.post(
        URUN,
        json=kur.urun_govdesi(
            title="Spiralli Defter - Mavi",
            variant_group_id=g, option1_value="Mavi", barcode=f"869{_u()}",
            publisher="Umur", dimensions="A4", cover_type="Spiralli",
            isbn=f"97860{_u()[:8]}", cover_url="https://cdn.test/kapak.png",
            description="80 yaprak spiralli",
        ),
        headers=_bas(tok),
    )
    kid = _urun_kaydet(kur, kaynak)["id"]

    r = await client.post(
        f"{URUN}/{kid}/derive-variant",
        json={"option1_value": "Kırmızı", "barcode": f"869{_u()}"},
        headers=_bas(tok),
    )
    assert r.status_code == 201, r.text
    yeni = _urun_kaydet(kur, r)
    assert yeni["id"] != kid
    assert yeni["variant_group_id"] == g
    assert yeni["option1_value"] == "Kırmızı"
    # Künye + fiyat + görsel kopyalandı…
    assert yeni["publisher"] == "Umur"
    assert yeni["cover_url"] == "https://cdn.test/kapak.png"
    assert yeni["price"] == "100.00"
    # …ISBN kopyalanMADI (her baskı/ürün kendi ISBN'ini taşır) ve başlık türedi.
    assert yeni["isbn"] is None
    assert "Kırmızı" in yeni["title"]
    # Taslak doğar: türetilen varyant fiyat/görsel kontrol edilmeden yayına çıkmaz.
    assert yeni["status"] == "DRAFT"


async def test_derive_variant_grupsuz_kaynaktan_409(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    r = await client.post(URUN, json=kur.urun_govdesi(), headers=_bas(tok))
    pid = _urun_kaydet(kur, r)["id"]
    r = await client.post(
        f"{URUN}/{pid}/derive-variant",
        json={"option1_value": "Sarı", "barcode": f"869{_u()}"},
        headers=_bas(tok),
    )
    assert r.status_code == 409, r.text


# ── P2-2 · Kategori taşınması gruplu ürünü KİLİTLEMEZ ────────────────────────


async def test_kitap_altina_tasinmis_gruplu_urunde_varyantsiz_duzenleme_serbest(client, kur):
    """Bağımsız denetim P2-2: kategori ağacı SONRADAN kitap kökü altına
    taşınınca, oradaki gruplu üründe fiyat/stok/başlık düzenlemesi bile 409
    alıyordu (kapı sonuç duruma bakıyordu). Kapı yalnız VARYANT alanlarına
    ya da kategoriye dokunulduğunda çalışmalı."""
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    kat = await kur.kategori(slug=f"kirtasiye-p22-{_u()}")
    g = await kur.grup()
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(
            category_id=kat, variant_group_id=g,
            option1_value="Sarı", barcode=f"869{_u()}",
        ),
        headers=_bas(tok),
    )
    pid = _urun_kaydet(kur, r)["id"]

    # Kategori ağacı taşınır: mevcut kategori bir kitap kökünün ALTINA girer.
    # (Admin ucuyla değil doğrudan veriyle — P2-1 parent kaçağı ayrı borç;
    # buradaki soru "veri bu hâldeyken ürün düzenlenebiliyor mu".)
    kok = await kur.kategori(slug="kitap")
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE product_categories SET parent_id = :k WHERE id = :i"),
            {"k": kok, "i": kat},
        )
        await s.commit()

    # Varyantla ilgisiz düzenlemeler SERBEST…
    r = await client.patch(
        f"{URUN}/{pid}", json={"price": "160.00"}, headers=_bas(tok)
    )
    assert r.status_code == 200, r.text
    assert r.json()["price"] == "160.00"
    r = await client.patch(
        f"{URUN}/{pid}", json={"title": "Fosforlu Kalem - Sarı (Yeni)"},
        headers=_bas(tok),
    )
    assert r.status_code == 200, r.text

    # …ama VARYANT alanına dokunmak kapıdan geçer ve kitapta 409 alır.
    r = await client.patch(
        f"{URUN}/{pid}", json={"option1_value": "Kızıl"}, headers=_bas(tok)
    )
    assert r.status_code == 409, r.text
    assert "kitap" in r.json()["detail"].lower()


# ── Grup güncelleme tutarlılığı ──────────────────────────────────────────────


async def test_dolu_grubun_eksen_adi_degistirilemez(client, kur):
    """Bağımsız denetim P2-4: üyeler değer taşırken eksen YENİDEN ADLANDIRMA
    da yasak — "Renk"→"Ebat" yapılınca "Sarı" değeri Ebat kutusuna düşer ve
    VARIANT_AXES'in önlediği facet karışması geri gelirdi."""
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    g = await kur.grup(option1_name="Renk", option2_name="Ebat")
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(
            variant_group_id=g, option1_value="Sarı", option2_value="A4",
            barcode=f"869{_u()}",
        ),
        headers=_bas(tok),
    )
    _urun_kaydet(kur, r)

    for govde in (
        {"option1_name": "Gramaj"},
        {"option2_name": "Çizgi Tipi"},
    ):
        r = await client.patch(f"{VG}/{g}", json=govde, headers=_bas(tok))
        assert r.status_code == 409, (govde, r.text)

    # Başlık düzenlemesi serbest kalır (yalnız eksen adları kilitli).
    r = await client.patch(f"{VG}/{g}", json={"title": "Yeni Ad"}, headers=_bas(tok))
    assert r.status_code == 200, r.text

    # BOŞ grupta eksen adı serbestçe değiştirilebilir.
    bos = await kur.grup(option1_name="Renk")
    r = await client.patch(
        f"{VG}/{bos}", json={"option1_name": "Ebat"}, headers=_bas(tok)
    )
    assert r.status_code == 200, r.text


async def test_option2_ekseni_uyeler_deger_tasirken_kaldirilamaz(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view", "products.manage"])
    g = await kur.grup(option1_name="Renk", option2_name="Ebat")
    r = await client.post(
        URUN,
        json=kur.urun_govdesi(
            variant_group_id=g, option1_value="Sarı", option2_value="A4",
            barcode=f"869{_u()}",
        ),
        headers=_bas(tok),
    )
    _urun_kaydet(kur, r)
    r = await client.patch(
        f"{VG}/{g}", json={"option2_name": None}, headers=_bas(tok)
    )
    assert r.status_code == 409, r.text


# ── Sözlük ucu ───────────────────────────────────────────────────────────────


async def test_variant_config_sozlugu_ve_kitap_koklerini_doner(client, kur):
    _aid, tok = await kur.admin(izinler=["products.view"])
    r = await client.get("/api/v1/store/admin/variant-config", headers=_bas(tok))
    assert r.status_code == 200, r.text
    veri = r.json()
    assert "Renk" in veri["axes"] and "Paket Adedi" in veri["axes"]
    assert {"kitap", "sinav-kitaplari", "okula-yardimci"} <= set(veri["book_root_slugs"])
