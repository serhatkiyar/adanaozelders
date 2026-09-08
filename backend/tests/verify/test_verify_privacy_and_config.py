"""F — KVKK (hesap silme, rıza) · G — SİTEMAP · H — ÜRETİM AYARLARI.

BEKLENEN DAVRANIŞ:

F1. Hesap silme kimlik/iletişim verisini GERİ DÖNDÜRÜLEMEZ biçimde temizler,
    hesabı kapatır ve oturumları iptal eder.
F2. Mali kayıtlar (sipariş) SİLİNMEZ; yalnız kimlik bilgisi anonimleşir —
    muhasebe ve escrow mutabakatı bozulmamalıdır.
F3. Açık sipariş/ders varken silme ENGELLENİR (anonimleştirmeden sonra
    çözülemez hale gelirdi).
F4. Rıza kaydı append-only'dir: geri alma yeni satır yazar, eskisi durur.
F5. Adres PII'si temizlenir ama satır silinmez (siparişe bağlı olabilir).

G1. Sitemap yalnız PUBLIC ve indekslenebilir kayıtları içerir: taslak/gizli
    ürün, onaysız eğitmen, PENDING kütüphane GİRMEZ.
G2. Üretilen XML geçerlidir ve URL'ler frontend rotalarıyla eşleşir.

H1. `ENVIRONMENT=production` iken tehlikeli varsayılanlar uygulamayı AÇTIRMAZ.
H2. Guard tüm sorunları TEK hatada listeler (deploy sırasında sırayla keşif
    yerine).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.asyncio

NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


# ── F1/F2: hesap anonimleştirme ──────────────────────────────────────────────


async def test_F1_hesap_silme_kimlik_verisini_temizler(db, factory, fake_provider):
    from services import account_deletion_service as ads

    client = await factory.client(db)
    orig_email = client.email
    client.phone = "5551112233"
    client.about = "Merhaba ben test"
    await db.commit()

    await ads.anonymize_account(db, client)
    await db.commit()

    # KOLON ADIYLA okunur, konumla DEĞİL.
    #
    # Eskiden `row[0]..row[8]` şeklindeydi. 5 Eyl 2026'da SELECT listesinden
    # `username` çıkarılınca bütün indeksler bir kaydı ve test "Silinmiş"
    # beklerken soyadı okudu — hata verdi ama SEBEBİ görünmüyordu. Aynı kayma
    # bir INSERT'te olsaydı sessizce YANLIŞ VERİ yazardı. `.mappings()` bu
    # sınıfı tamamen kapatır: kolon listesi değişse de iddialar yerinde kalır.
    row = (
        await db.execute(
            text(
                "SELECT email, first_name, last_name, phone, about, "
                "is_active, deleted_at, hashed_password "
                "FROM clients WHERE id = :i"
            ),
            {"i": client.id},
        )
    ).mappings().first()

    assert row["email"] != orig_email, "e-posta anonimleşmeli"
    assert "@hesap.silindi" in row["email"]
    assert row["first_name"] == "Silinmiş" and row["last_name"] == "Kullanıcı"
    assert row["phone"] is None, "telefon temizlenmeli"
    assert row["about"] is None, "biyografi temizlenmeli"
    assert row["is_active"] is False, "hesap pasifleşmeli"
    assert row["deleted_at"] is not None, "deleted_at damgalanmalı"
    assert row["hashed_password"] == "!", "parola hiçbir girdiyle eşleşmemeli"


async def test_F2_mali_kayitlar_silinmez(db, factory, fake_provider):
    """VUK/TTK gereği sipariş ve tutarlar saklanmak zorunda."""
    from services import account_deletion_service as ads

    client = await factory.client(db)
    product = await factory.product(db, price="250.00")
    order = await factory.order(
        db, client=client, items=[(product, 1)],
        payment_status="PAID", status="DELIVERED",
    )
    await db.commit()

    await ads.anonymize_account(db, client)
    await db.commit()

    row = (
        await db.execute(
            text("SELECT client_id, total, payment_status FROM orders WHERE id = :i"),
            {"i": order.id},
        )
    ).first()
    assert row is not None, "sipariş satırı silinmiş — muhasebe kaydı kayboldu"
    assert row[0] == client.id, "client_id referansı korunmalı (mutabakat)"
    assert str(row[1]) == "250.00"
    assert row[2] == "PAID"


async def test_F3_acik_siparis_varken_silme_engellenir(db, factory, fake_provider):
    from services import account_deletion_service as ads

    client = await factory.client(db)
    product = await factory.product(db, price="100.00")
    await factory.order(
        db, client=client, items=[(product, 1)],
        payment_status="PAID", status="PAID",  # teslim edilmemiş
    )
    await db.commit()

    ok, reason = await ads.can_delete(db, client)
    assert ok is False, "devam eden siparişle silme mümkün olmamalı"
    assert reason and "sipariş" in reason.lower()


async def test_F5_adres_pii_temizlenir_satir_kalir(db, factory, fake_provider):
    from models.client import ClientAddress
    from services import account_deletion_service as ads

    client = await factory.client(db)
    addr = ClientAddress(
        client_id=client.id,
        title="Ev",
        recipient_name="Ayşe Yılmaz",
        phone="5551112233",
        address_line="Çakmak Cad. No:5",
        city="Adana",
        district="Seyhan",
        location_lat=36.99,
        location_lng=35.32,
    )
    db.add(addr)
    await db.commit()

    await ads.anonymize_account(db, client)
    await db.commit()

    row = (
        await db.execute(
            text(
                "SELECT recipient_name, phone, address_line, city, "
                "location_lat, deleted_at FROM client_addresses WHERE id = :i"
            ),
            {"i": addr.id},
        )
    ).first()
    assert row is not None, "adres satırı silinmemeli (siparişe bağlı olabilir)"
    assert row[0] is None and row[1] is None, "alıcı/telefon temizlenmeli"
    assert row[2] == "silindi", "adres metni temizlenmeli"
    assert row[4] is None, "koordinat temizlenmeli"
    assert row[5] is not None


# ── F4: rıza kaydı append-only ───────────────────────────────────────────────


async def test_F4_riza_geri_alinca_eski_satir_durur(db, factory, fake_provider):
    from services import consent_service

    client = await factory.client(db)
    await db.commit()

    await consent_service.record(
        db, user_id=client.id, role_id=client.role_id,
        doc_key="marketing-email", doc_version="2026-06-11",
        granted=True, ip="1.2.3.4", user_agent="pytest",
    )
    await db.commit()
    await consent_service.set_marketing(
        db, user_id=client.id, role_id=client.role_id,
        doc_key="marketing-email", granted=False, doc_version="2026-06-11",
    )
    await db.commit()

    rows = (
        await db.execute(
            text(
                "SELECT granted FROM user_consents WHERE user_id = :u AND role_id = :r "
                "AND doc_key = 'marketing-email' ORDER BY id"
            ),
            {"u": client.id, "r": client.role_id},
        )
    ).all()
    assert len(rows) == 2, "geri alma yeni satır yazmalı, eskisi silinmemeli"
    assert rows[0][0] is True and rows[1][0] is False

    # Geçerli durum: en güncel satır.
    assert await consent_service.is_granted(
        db, user_id=client.id, role_id=client.role_id, doc_key="marketing-email"
    ) is False


async def test_F4b_anonimlestirme_riza_pii_sini_temizler(db, factory, fake_provider):
    """Onayın verildiği GERÇEK kalır (ispat), IP/user-agent silinir."""
    from services import account_deletion_service as ads, consent_service

    client = await factory.client(db)
    await db.commit()
    await consent_service.record(
        db, user_id=client.id, role_id=client.role_id,
        doc_key="kvkk", doc_version="2026-06-11",
        ip="9.9.9.9", user_agent="Mozilla/5.0",
    )
    await db.commit()

    await ads.anonymize_account(db, client)
    await db.commit()

    row = (
        await db.execute(
            text(
                "SELECT granted, ip, user_agent FROM user_consents "
                "WHERE user_id = :u AND role_id = :r"
            ),
            {"u": client.id, "r": client.role_id},
        )
    ).first()
    assert row is not None, "onay kaydı silinmemeli (ispat yükü)"
    assert row[0] is True
    assert row[1] is None and row[2] is None, "IP/user-agent temizlenmeli"


# ── G: sitemap ───────────────────────────────────────────────────────────────


async def test_G1_sitemap_yalniz_public_kayitlari_icerir(db, factory, fake_provider):
    from models.tutor import TutorStatus
    from services import sitemap_service

    # Public OLMAYAN kayıtlar:
    gizli_urun = await factory.product(db, status="DRAFT")
    onaysiz = await factory.tutor(db, status=TutorStatus.PENDING_APPROVAL)
    pasif = await factory.tutor(db, status=TutorStatus.APPROVED, is_active=False)
    # Public olan:
    acik_urun = await factory.product(db, status="ACTIVE")
    onayli = await factory.tutor(db, status=TutorStatus.APPROVED)
    await db.commit()

    xml = await sitemap_service.build_sitemap(db)
    locs = {l.rsplit("/", 1)[-1] for l in re.findall(r"<loc>(.*?)</loc>", xml)}

    # Alt dize DEĞİL, TAM slug karşılaştırması: "-45" dizesi "-145" içinde de
    # geçer ve paralel testlerin ürettiği kayıtlarla yanlış eşleşir.
    def tutor_slug_of(t) -> str:
        from core.slug import tutor_slug

        # YALNIZ AD (ÜK-9, 8 Eyl 2026). Bu yardımcı eskiden
        # `f"{first_name} {last_name}"` kuruyordu — yani üretim kuralının bir
        # KOPYASIYDI ve kural değişince sessizce bayatladı: soyad public
        # yüzeylerden kalkınca slug `isim-{id}` oldu, test hâlâ
        # `isim-soyisim-{id}` bekliyordu ve "onaylı eğitmen girmeli" iddiası
        # kırmızıya döndü. Kaynağı `sitemap_service` ile aynı tuttuk.
        return tutor_slug(t.id, t.first_name or "")

    assert gizli_urun.slug not in locs, "taslak ürün sitemap'e girmemeli"
    assert tutor_slug_of(onaysiz) not in locs, "onaysız eğitmen girmemeli"
    assert tutor_slug_of(pasif) not in locs, "pasif eğitmen girmemeli"
    assert acik_urun.slug in locs, "aktif ürün girmeli"
    assert tutor_slug_of(onayli) in locs, "onaylı eğitmen girmeli"


async def test_G2_sitemap_gecerli_xml_ve_dogru_yollar(db, factory, fake_provider):
    from services import sitemap_service

    product = await factory.product(db, status="ACTIVE")
    await db.commit()

    xml = await sitemap_service.build_sitemap(db)
    root = ET.fromstring(xml)  # geçersizse burada patlar
    assert root.tag == f"{NS}urlset"

    locs = [e.text for e in root.iter(f"{NS}loc")]
    assert any(l.endswith("/egitmenler") for l in locs), "liste sayfası eksik"
    assert any(f"/magaza/urun/{product.slug}" in l for l in locs), (
        "ürün yolu frontend rotasıyla eşleşmiyor"
    )


# ── H: üretim guard'ı ────────────────────────────────────────────────────────


def test_H1_uretimde_sahte_odeme_saglayicisi_reddedilir():
    """`.env`'de tek satır eksikse platform para tahsil etmeden satış yapardı."""
    from core.config import Settings

    with pytest.raises(ValueError, match="PAYMENT_PROVIDER"):
        Settings(
            _env_file=None,
            ENVIRONMENT="production",
            POSTGRES_USER="u", POSTGRES_PASSWORD="p", POSTGRES_DB="d",
            JWT_SECRET_KEY="x" * 48,
            PAYMENT_PROVIDER="fake",
            EMAIL_PROVIDER="smtp", SMS_PROVIDER="netgsm",
            AUTO_CREATE_DB=False, SEED_DEMO_DATA=False,
            AWS_ACCESS_KEY_ID="k", AWS_SECRET_ACCESS_KEY="s",
            BACKEND_CORS_ORIGINS=["https://x.tr"],
            TRUSTED_PROXY_IPS=["127.0.0.1"],
            FRONTEND_BASE_URL="https://x.tr", BACKEND_BASE_URL="https://x.tr",
        )


def test_H2_guard_tum_sorunlari_tek_hatada_listeler():
    from core.config import Settings

    with pytest.raises(ValueError) as exc:
        Settings(
            _env_file=None,
            ENVIRONMENT="production",
            POSTGRES_USER="u", POSTGRES_PASSWORD="p", POSTGRES_DB="d",
            JWT_SECRET_KEY="kisa",           # zayıf
            PAYMENT_PROVIDER="fake",          # sahte ödeme
            EMAIL_PROVIDER="console",         # loga yazar
            SMS_PROVIDER="console",           # OTP gitmez
            AUTO_CREATE_DB=True,              # açılışta migration
            SEED_DEMO_DATA=True,              # demo eğitmenler
            AWS_ACCESS_KEY_ID="minioadmin",   # varsayılan anahtar
            AWS_SECRET_ACCESS_KEY="minioadmin",
            BACKEND_CORS_ORIGINS=["http://localhost:5173"],
            TRUSTED_PROXY_IPS=[],
            FRONTEND_BASE_URL="http://x.tr", BACKEND_BASE_URL="http://x.tr",
        )
    mesaj = str(exc.value)
    for beklenen in (
        "PAYMENT_PROVIDER", "EMAIL_PROVIDER", "SMS_PROVIDER",
        "AUTO_CREATE_DB", "SEED_DEMO_DATA", "JWT_SECRET_KEY",
        "minioadmin", "CORS", "TRUSTED_PROXY_IPS", "https",
    ):
        assert beklenen in mesaj, f"guard '{beklenen}' sorununu bildirmiyor"


def test_H3_gelistirme_ortami_etkilenmez():
    """Guard yalnız production'da koşar; geliştirme akışı bozulmamalı.

    NOT: `PAYMENT_PROVIDER` gibi alanların değeri burada iddia EDİLMEZ —
    pydantic `_env_file=None` verilse bile `os.environ`'ı okur ve bu paket
    .env değerlerini ortama koyar. Testin konusu guard'ın TETİKLENMEMESİ.
    """
    from core.config import Settings

    # Production'da REDDEDİLECEK bir yapılandırma, development'ta sorunsuz kurulmalı.
    s = Settings(
        _env_file=None,
        ENVIRONMENT="development",
        POSTGRES_USER="u", POSTGRES_PASSWORD="p", POSTGRES_DB="d",
        JWT_SECRET_KEY="kisa",          # production'da reddedilirdi
        PAYMENT_PROVIDER="fake",         # production'da reddedilirdi
        AUTO_CREATE_DB=True,             # production'da reddedilirdi
        SEED_DEMO_DATA=True,             # production'da reddedilirdi
    )
    assert s.is_production is False
    assert s.ENVIRONMENT == "development"
