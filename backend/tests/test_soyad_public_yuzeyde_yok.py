"""Soyad PUBLIC yüzeylerde görünmez — ÜK-9 nöbetçisi.

## Karar (kullanıcı, 8 Eyl 2026)

*"soyisim göstermesek mi acaba."* Sektör de aynı yönde: Superprof ve Tutor Hunt
yalnız adı, Wyzant ad + soyad baş harfini gösteriyor; italki eğitmenlere tam
yasal adını kullanmamayı öneriyor.

## Bu nöbetçinin ASIL iddiası

Kesme SUNUCUDA yapılır. Arayüzde `split(" ")[0]` yazmak kozmetik kalır ve bu
depoda tam olarak öyle olmuştu: `TutorCard` yalnız adı basıyordu ama aynı
bileşenin `alt` metni ve avatar URL'i tam adı taşıyor, kartın gittiği adres
`/egitmenler/ahmet-yilmaz-42` oluyor, sitemap o slug'ı Google'a veriyordu.

Bu yüzden burada ölçülen şey EKRAN değil, ŞEMA ve SLUG: soyad public sözleşmeye
hiç girmemeli. Ekran katmanı ondan sonra zaten soyadı bulamaz.

## Kapsam — neye DOKUNULMADI

Yasal ad oturum içi akışlarda ve `full_name` alanında duruyor: rezervasyon,
mesajlaşma, sipariş, admin panelleri, hesap sahibinin kendi ayarları, ödeme/KYC
(iyzico alt üye işyeri) ve fatura. Karar bir gizleme değil KAPSAM ayrımıdır.

Rozet bağı da korunur: "Kimliği Doğrulanmış" `payout_status`a bakar, gösterilen
ada değil (`docs/kimlik-ve-diploma-dogrulama-plani.md` §A6 bunu şart koşuyor).
"""
from __future__ import annotations

import pytest

from core.slug import tutor_slug
from models.tutor import Tutor
from schemas.tutor import TutorSearchOut


SOYAD = "Kayaoglu"


@pytest.fixture
def egitmen() -> Tutor:
    return Tutor(id=42, first_name="Enes", last_name=SOYAD)


class TestModelSozlesmesi:
    def test_display_name_yalniz_ad(self, egitmen):
        assert egitmen.display_name == "Enes"

    def test_full_name_DEGISMEDI(self, egitmen):
        """Ters prova: yasal ad hâlâ üretilebiliyor.

        `display_name` `full_name`in yerine GEÇMEZ; ödeme, fatura ve admin
        tarafı ona bağlı. İkisi de yaşamaya devam etmeli.
        """
        assert egitmen.full_name == f"Enes {SOYAD}"

    def test_cok_sozcuklu_ad_KORUNUR(self):
        """Kesilen şey SOYAD, adın kendisi değil."""
        t = Tutor(id=7, first_name="Ayşe Nur", last_name=SOYAD)
        assert t.display_name == "Ayşe Nur"


class TestPublicSema:
    def test_public_semada_soyad_alani_YOK(self):
        alanlar = set(TutorSearchOut.model_fields)
        assert "display_name" in alanlar
        for yasak in ("full_name", "last_name"):
            assert yasak not in alanlar, (
                f"`{yasak}` public şemada — bu uçlar auth'suz, yani yanıtı herkes "
                "görür. Ekranda gizlemek yetmez."
            )

    def test_public_semada_eposta_ve_telefon_de_YOK(self):
        """Bitişik kapı: aynı şema kişisel iletişim bilgisi de taşımamalı."""
        alanlar = set(TutorSearchOut.model_fields)
        for yasak in ("email", "phone"):
            assert yasak not in alanlar


class TestSlug:
    def test_slug_soyad_ICERMEZ(self):
        assert tutor_slug(42, "Enes") == "enes-42"

    def test_slug_soyad_gecirilirse_de_URL_kirilmaz(self):
        """Kaza payı: biri yanlışlıkla tam ad geçirirse slug soyadı taşır.

        Fonksiyonun kendisi bunu engelleyemez (aldığı şey bir dizedir); asıl
        koruma çağrı yerlerinde ve aşağıdaki testte. Buradaki iddia yalnız
        biçimin bozulmadığı: id sonda kalır, yani link her hâlde çözülür.
        """
        assert tutor_slug(42, "Enes Kayaoglu").endswith("-42")

    def test_semadan_uretilen_slug_temiz(self, egitmen):
        veri = {
            "id": egitmen.id,
            "display_name": egitmen.display_name,
            "rating_average": None,
            "rating_count": 0,
            "bayesian_score": 0.0,
        }
        cikti = TutorSearchOut.model_construct(**veri)
        assert SOYAD.lower() not in cikti.slug.lower()
        assert cikti.slug == "enes-42"


class TestCagriYerleri:
    """Sözleşme testi: soyadı public yüzeye taşıyan bilinen yollar kapalı mı.

    Düşük güçlü (kaynak taraması) ama tam da sessizce geri gelebilecek şeyi
    tutuyor: biri `full_name`i public bir şemaya/slug'a geri koyarsa derleme
    geçer, ekran "normal" görünür ve sızıntı yalnız sayfa kaynağında olur.
    """

    def _oku(self, göreli: str) -> str:
        import pathlib

        return (pathlib.Path(__file__).resolve().parents[1] / göreli).read_text(
            encoding="utf-8"
        )

    def test_sitemap_full_name_kullanmiyor(self):
        kaynak = self._oku("services/sitemap_service.py")
        assert "last_name" not in kaynak, (
            "sitemap slug'ları doğrudan arama motorlarına veriliyor; soyad "
            "buraya girerse arayüzden kaldırılmış olması hiçbir şey ifade etmez"
        )

    def test_bot_meta_full_name_kullanmiyor(self):
        kaynak = self._oku("services/social_meta.py")
        assert "last_name" not in kaynak

    def test_arama_soyada_gore_eslesmiyor(self):
        kaynak = self._oku("services/search_service.py")
        assert "normalized(Tutor.full_name)" not in kaynak, (
            "soyadla arama açık kalırsa soyad gizli ama SORGULANABİLİR olur: "
            "bir soyadı yazıp sonuç dönüp dönmediğine bakarak kişinin platformda "
            "olup olmadığı öğrenilebilir"
        )
