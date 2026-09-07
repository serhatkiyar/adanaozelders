"""Ders taksonomisi türetmesi — saf dönüşüm nöbetçileri.

Betiğin tek gerçek riski **sessiz veri bozulması**: yanlış slug, kaybolan
ders, iki derse birden bağlanmış eşanlamlı. Hiçbiri hata vermez, hepsi
aramayı sessizce boşa düşürür — bugün `Fen` / `Fen Bilgisi` ayrışmasının
yaptığı gibi.

DB'ye dokunmaz; `donustur()` saf fonksiyondur.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]


def _betik():
    yol = BACKEND / "scripts" / "dersler_disa_aktar.py"
    spec = importlib.util.spec_from_file_location("dersler_disa_aktar", yol)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


betik = _betik()


def _kayit(kimlik, ad, *, kategori="1", kullanim=("Okul dersi",), ust="0", alias=()):
    return {
        "id": kimlik,
        "name": ad,
        "parent_id": ust,
        "aliases": [[{"name": a} for a in alias]] if alias else [],
        "related": {
            "category": {"id": kategori},
            "proceedings": [{"name": k} for k in kullanim],
        },
    }


class TestSlug:
    def test_turkce_harfler_katlanir(self):
        assert betik.slugify("Türk Dili ve Edebiyatı") == "turk-dili-ve-edebiyati"
        assert betik.slugify("İngilizce") == "ingilizce"
        assert betik.slugify("Coğrafya") == "cografya"

    def test_noktalama_ve_bosluk_tek_tireye_iner(self):
        assert betik.slugify("  C / C++  ") == "c-c"
        assert betik.slugify("Ses Eğitimi (Şan)") == "ses-egitimi-san"


class TestDonustur:
    def test_saf_hobi_elenir(self):
        """Rugby/oyun/yemek Adana'da özel ders talebi değil — ürün kararı."""
        ham = [
            _kayit("1", "Matematik"),
            _kayit("2", "Rugby", kategori="10", kullanim=("Hobi",)),
        ]
        dersler, _ = betik.donustur(ham)
        assert [d["ad"] for d in dersler] == ["Matematik"]

    def test_bilinmeyen_kategori_betigi_DURDURUR(self):
        """Sessizce varsayılana düşmek yanlış gruplanmış dersleri yükler."""
        with pytest.raises(SystemExit):
            betik.donustur([_kayit("1", "Bilinmeyen", kategori="99")])

    def test_dil_alt_becerisi_ana_dersin_aliasi_olur(self):
        """Kimse "Almanca aksan dersi" aramaz; ayrı ders olursa seçici şişer."""
        ham = [
            _kayit("1", "Almanca", kategori="5"),
            _kayit("2", "Almanca aksan", kategori="5", ust="1"),
        ]
        dersler, _ = betik.donustur(ham)
        assert [d["ad"] for d in dersler] == ["Almanca"]
        assert "almanca aksan" in dersler[0]["aliaslar"]

    def test_yetim_cocuk_koke_terfi_eder(self):
        """Ebeveyni süzgeçte kalan ders KAYBOLMAZ, köke çıkar."""
        ham = [_kayit("9", "Arkeoloji", ust="404")]
        dersler, rapor = betik.donustur(ham)
        assert dersler[0]["ust_slug"] is None
        assert any(r.startswith("KOKE_ALINDI") for r in rapor)

    def test_slug_cakismasi_ebeveyn_onekiyle_ayrisir(self):
        """C / C# / C++ hepsi "c" slug'ına iner; sessizce üzerine yazılamaz."""
        ham = [
            _kayit("1", "Programlama dilleri", kategori="8"),
            _kayit("2", "C", kategori="8", ust="1"),
            _kayit("3", "C#", kategori="8", ust="1"),
        ]
        dersler, rapor = betik.donustur(ham)
        sluglar = sorted(d["slug"] for d in dersler)
        assert len(sluglar) == len(set(sluglar))
        assert any(r.startswith("SLUG_CAKISMA") for r in rapor)

    def test_alias_iki_derse_birden_baglanmaz(self):
        """Belirsiz eşanlamlı arama sonucunu sessizce bozar; ikincisi atlanır."""
        ham = [
            _kayit("1", "Fizik", alias=("bilim",)),
            _kayit("2", "Kimya", alias=("bilim",)),
        ]
        dersler, rapor = betik.donustur(ham)
        sahipler = [d["slug"] for d in dersler if "bilim" in d["aliaslar"]]
        assert len(sahipler) == 1
        assert any(r.startswith("ALIAS_CAKISMA") for r in rapor)

    def test_sehir_iceren_alias_elenir_meslek_eki_kalir(self):
        """"ingilizce ankara" başka şehrin talebi; "gitar dersi" gerçek arama."""
        ham = [_kayit("1", "Gitar", kategori="9", kullanim=("Konservatuvar",),
                      alias=("gitar dersi", "gitar ankara"))]
        dersler, _ = betik.donustur(ham)
        assert dersler[0]["aliaslar"] == ["gitar dersi"]

    def test_alias_ve_ad_normalize_edilir(self):
        """Alias'lar `tr_normalize` çıktısıdır — arama iki tarafta aynı fonksiyonu
        kullanmazsa sessizce boş sonuç döner."""
        ham = [_kayit("1", "Matematik", alias=("MATEMATİK LİSE",))]
        dersler, _ = betik.donustur(ham)
        assert dersler[0]["aliaslar"] == ["matematik lise"]

    def test_dersin_kendi_adi_alias_olarak_tekrarlanmaz(self):
        ham = [_kayit("1", "Fizik", alias=("Fizik",))]
        dersler, _ = betik.donustur(ham)
        assert dersler[0]["aliaslar"] == []


class TestUretilmisAnlikGoruntu:
    """Depoya giren `data/dersler_v1.json` sözleşmesi."""

    @staticmethod
    def _veri():
        yol = BACKEND / "data" / "dersler_v1.json"
        return json.loads(yol.read_text(encoding="utf-8"))["dersler"]

    def test_slug_ve_alias_tekil(self):
        dersler = self._veri()
        sluglar = [d["slug"] for d in dersler]
        aliaslar = [a for d in dersler for a in d["aliaslar"]]
        assert len(sluglar) == len(set(sluglar))
        assert len(aliaslar) == len(set(aliaslar))

    def test_ebeveyn_baglari_kirik_degil(self):
        dersler = self._veri()
        sluglar = {d["slug"] for d in dersler}
        assert [d["slug"] for d in dersler if d["ust_slug"] and d["ust_slug"] not in sluglar] == []

    def test_bugun_secilebilen_branslar_kanonike_baglanir(self):
        """Geri uyum: `tutor_subjects`'te BUGÜN yazılı olan kısa değerler
        (fen, din, edebiyat) bir derse çözülmeli, yoksa mevcut eğitmenler
        aramadan düşer."""
        dersler = self._veri()
        alias_sahibi = {a: d["slug"] for d in dersler for a in d["aliaslar"]}
        slug_var = {d["slug"] for d in dersler}
        for eski in ["fen", "din", "edebiyat", "inkilap", "matematik", "tyt", "ayt"]:
            assert eski in alias_sahibi or eski in slug_var, eski

    def test_her_dersin_en_az_bir_seviye_merdiveni_var(self):
        assert all(d["merdivenler"] for d in self._veri())


class TestSemaVeUclar:
    """Faz 1 kablolama sözleşmesi — hepsi "unutulursa sessizce bozulan" türden."""

    def test_public_uc_kayitli(self):
        """Router `api_router`'a eklenmezse frontend'in ders listesi 404 alır."""
        from fastapi import FastAPI

        from api.router import api_router

        app = FastAPI()
        app.include_router(api_router)
        yollar = set(app.openapi()["paths"])
        assert "/subjects" in yollar
        assert "/subjects/levels" in yollar

    def test_model_registry_kaydi(self):
        """__init__ kaydı yoksa Alembic autogenerate tabloları hiç görmez."""
        import models

        for ad in ("Subject", "SubjectAlias", "Level", "LevelScale", "SubjectLevelScale"):
            assert ad in models.__all__, ad

    def test_migration_seedi_model_sabitiyle_ayni(self):
        """Merdiven kodları iki yerde yaşıyor: modeldeki `LEVEL_SCALES` sabiti ve
        migration'daki referans seed. Ayrışırlarsa seviye filtresi hata vermez,
        sessizce hiç sonuç döndürür — `AdminExamCatalogs`'un `EXAM_TYPES` hatası
        tam olarak buydu."""
        import importlib.util

        from models.subject import LEVEL_SCALES

        yol = BACKEND / "migrations" / "versions" / "b27db6c5d4b6_ders_taksonomisi_tablolari.py"
        spec = importlib.util.spec_from_file_location("m_ders", yol)
        mig = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mig)

        assert {k for k, _, _ in mig.MERDIVENLER} == set(LEVEL_SCALES)
        assert {m for m, _, _, _ in mig.BASAMAKLAR} == set(LEVEL_SCALES)
        # Her merdivende en az bir basamak olmalı; boş merdiven seçiciyi
        # kullanılamaz hâle getirir.
        for kod in LEVEL_SCALES:
            assert any(m == kod for m, _, _, _ in mig.BASAMAKLAR), kod

    def test_yukleyici_bozuk_anlik_goruntuyu_reddeder(self):
        """Yarım katalog yüklemektense hiç yükleme. Saf doğrulama."""
        import importlib.util

        yol = BACKEND / "scripts" / "dersler_yukle.py"
        spec = importlib.util.spec_from_file_location("dersler_yukle", yol)
        yukleyici = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(yukleyici)

        saglam = {"slug": "a", "ad": "A", "ust_slug": None, "grup": "OKUL",
                  "merdivenler": ["OKUL"], "aliaslar": []}
        yukleyici._dogrula([saglam])  # sorun yok

        for bozuk in (
            [saglam, dict(saglam)],                                   # slug çakışması
            [dict(saglam, ust_slug="yok")],                           # kırık ebeveyn
            [dict(saglam, grup="UYDURMA")],                           # bilinmeyen grup
            [dict(saglam, merdivenler=["UYDURMA"])],                  # bilinmeyen merdiven
            [dict(saglam, aliaslar=["x"]), dict(saglam, slug="b", aliaslar=["x"])],  # alias çakışması
        ):
            with pytest.raises(SystemExit):
                yukleyici._dogrula(bozuk)

    def test_iki_kapsam_ayri_uctan_verilir(self):
        """Vitrin ve eğitmen seçimi ZIT kurallara tabi: öğrenciye arkasında
        eğitmen olmayan ders gösterilmez (sıfır sonuç üretir), eğitmene ise
        kataloğun tamamı gösterilir (yoksa branşını bildiremez). Tek bayrağa
        bağlamak ikisinden birini bozar."""
        from fastapi import FastAPI

        from api.router import api_router

        app = FastAPI()
        app.include_router(api_router)
        uc = app.openapi()["paths"]["/subjects"]["get"]
        kapsam = [p for p in uc.get("parameters", []) if p["name"] == "kapsam"]
        assert kapsam, "`kapsam` parametresi yok — eğitmen tam kataloğu göremez"
        assert set(kapsam[0]["schema"]["enum"]) == {"vitrin", "secim"}
        assert kapsam[0]["schema"].get("default") == "vitrin"


class TestAramaFiltresi:
    """Faz 2 — `?subject=` artık kanonik terime çözülüp NORMALİZE eşleşiyor."""

    def test_filtre_ham_esitlik_degil_normalize_kullanir(self):
        """Derlenmiş SQL'de `tr_normalize` GÖRÜNMELİ.

        Eski hâli `TutorSubject.subject IN (...)` idi: tam ve büyük/küçük harfe
        duyarlı. Branşını "Fen Bilgisi" yazan eğitmen "Fen" aramasında
        çıkmıyordu — hata vermeyen, yalnız "sonuç bulunamadı" diyen bir arıza.
        Ham eşitliğe geri dönülürse bu test kırılır.
        """
        from sqlalchemy import select as sa_select
        from sqlalchemy.dialects import postgresql

        from models.tutor import Tutor
        from services.search_service import _apply_tutor_filters

        stmt, _ = _apply_tutor_filters(
            sa_select(Tutor.id), subjects=["matematik", "fen bilgisi"]
        )
        sql = str(stmt.compile(dialect=postgresql.dialect()))
        assert "tr_normalize" in sql

    def test_her_listeleme_yolu_cozumlemeden_gecer(self):
        """Arama, fiyat histogramı, öne çıkarma ve cinsiyet fasetleri AYNI
        kümeyi kullanmalı.

        Ayrışırlarsa histogram listede görünmeyen eğitmenlerin dağılımını,
        faset de listede olmayan sayıları gösterir — dosyanın kendi yorumunun
        uyardığı ikizlenme tuzağı.

        Sayı DÖRT: `gender_facets` (6 Eyl) dördüncü yol olarak eklendi.
        Eşik bir SAYI olduğu için yeni bir listeleme yolu eklenip çözümlemeyi
        atlayan biri burada durur; sayıyı büyütmeden geçemez.
        """
        kaynak = (BACKEND / "services" / "search_service.py").read_text(encoding="utf-8")
        cagri = [
            s for s in kaynak.splitlines()
            if "await subject_service.resolve_filter_terms(" in s
        ]
        assert len(cagri) == 4, cagri


class TestAramaBulunabilirligi:
    """Kullanıcının yazdığı gerçek terimler sonuçsuz kalmamalı.

    ÖLÇÜLEN ARIZA: küratörlü 113 derslik listeyle sınırlı öneri kutusunda
    "yazılım", "hukuk", "psikoloji", "Kuran", "ekonomi" gibi terimler HİÇBİR
    ŞEY döndürmüyordu — hepsi katalogda mevcut olduğu hâlde. Kullanıcı sitenin
    o dersi hiç bilmediğini sanıyor.
    """

    @staticmethod
    def _veri():
        yol = BACKEND / "data" / "dersler_v1.json"
        return json.loads(yol.read_text(encoding="utf-8"))["dersler"]

    def test_dogal_arama_terimleri_katalogda_karsilik_buluyor(self):
        import re
        import sys

        sys.path.insert(0, str(BACKEND))
        from core.search_text import normalize_tr

        dersler = self._veri()
        for terim in [
            "yazilim", "programlama", "bilgisayar", "hukuk", "psikoloji",
            "ekonomi", "kuran", "matematik", "gitar", "ingilizce",
        ]:
            bulunan = [
                d for d in dersler
                if terim in normalize_tr(d["ad"])
                or any(terim in a for a in d["aliaslar"])
            ]
            assert bulunan, terim
        assert re is not None  # lint susturucu değil; import kullanıldı
