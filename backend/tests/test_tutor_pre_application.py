"""Eğitmen ön başvurusu (lead) — DB'siz nöbetçiler.

Kayıt zincirindeki her halka "eklenmesi UNUTULURSA sessizce bozulan" türden:
router kayıtsızsa sayfa 404 verir, outbox handler kayıtsızsa gönderim
runtime'da patlar, KVKK/telefon kontrolü gevşerse onaysız/aranamaz kayıt
birikir.
"""
from __future__ import annotations

import pathlib

import pytest
from fastapi import HTTPException

from schemas.tutor_pre_application import TutorPreApplicationIn
from services import tutor_pre_application_service as svc

BACKEND = pathlib.Path(__file__).resolve().parents[1]


def _payload(**over):
    data = dict(
        full_name="Ayşe Yılmaz",
        phone="0532 123 45 67",
        subjects=["Matematik", "Fizik"],
        kvkk_accepted=True,
    )
    data.update(over)
    return TutorPreApplicationIn(**data)


def test_public_rota_kayitli():
    """Router api_router'a eklenmezse Facebook'a atılan link 404 verir."""
    from fastapi import FastAPI

    from api.router import api_router

    app = FastAPI()
    app.include_router(api_router)
    # FastAPI include'ları tembel çözer; openapi() rota tablosunu kesinleştirir.
    paths = set(app.openapi()["paths"])
    assert "/tutor-pre-applications" in paths


def test_public_ucta_rate_limit_var():
    """Public yazma ucu limitsiz kalamaz (spam + SMTP maliyeti)."""
    kaynak = (BACKEND / "api" / "routers" / "tutor_pre_applications.py").read_text(
        encoding="utf-8"
    )
    assert "rate_limit(" in kaynak
    assert "dependencies=[Depends(_submit_limit)]" in kaynak


def test_outbox_handleri_kayitli():
    """enqueue bilinmeyen kind'ı reddeder — kayıt yoksa form runtime'da patlar."""
    from core import outbox

    assert "email:tutor_lead" in outbox._HANDLERS


def test_model_registry_kaydi():
    """__init__ kaydı yoksa Alembic autogenerate tabloyu hiç görmez."""
    import models

    assert "TutorPreApplication" in models.__all__


def test_kvkk_onaysiz_gonderim_reddedilir():
    """Checkbox istemcide atlanabilir; onay sunucuda da şarttır."""
    with pytest.raises(HTTPException) as exc:
        svc.prepare_submission(_payload(kvkk_accepted=False))
    assert exc.value.status_code == 422


def test_gecersiz_telefon_reddedilir():
    """Lead'in tek değeri aranabilir numara — sabit hat/çöp metin kayıt açamaz."""
    with pytest.raises(HTTPException) as exc:
        svc.prepare_submission(_payload(phone="0322 111 22 33"))
    assert exc.value.status_code == 422


def test_telefon_e164e_indirgenir():
    """Aynı numara iki yazımla iki kayıt olmasın diye tek biçime iner."""
    data = svc.prepare_submission(_payload(phone="0532 123 45 67"))
    assert data["phone"] == "+905321234567"
    ayni = svc.prepare_submission(_payload(phone="+90 (532) 123-45-67"))
    assert ayni["phone"] == data["phone"]


def test_eposta_normalize_edilir_ve_istege_baglidir():
    """Lansman daveti tek biçimli adrese gider; boş bırakmak kayıt engeli değil."""
    data = svc.prepare_submission(_payload(email="  Ayse@Ornek.COM "))
    assert data["email"] == "ayse@ornek.com"
    assert svc.prepare_submission(_payload())["email"] is None


def test_belge_dogrulamasi_uctan_atlanamaz():
    """Anonim uç dosya kabul ediyor: uzantı/boyut/adet kontrolü gevşerse
    private/ altına sınırsız çöp yazılır."""
    kaynak = (BACKEND / "api" / "routers" / "tutor_pre_applications.py").read_text(
        encoding="utf-8"
    )
    assert "storage.is_allowed_resource" in kaynak
    assert "MAX_RESOURCE_SIZE_BYTES" in kaynak
    assert "MAX_DOCUMENTS" in kaynak


def test_dersler_kirpilir_ve_tekillenir():
    data = svc.prepare_submission(
        _payload(subjects=["  Matematik ", "Matematik", "Fizik"])
    )
    assert data["subjects"] == "Matematik, Fizik"


def test_admin_uclari_izinle_korunur():
    """Lead PII taşır: liste/durum uçları izinsiz kalamaz."""
    kaynak = (BACKEND / "api" / "routers" / "admin.py").read_text(encoding="utf-8")
    liste = kaynak.split("async def list_tutor_pre_applications")[0]
    assert 'require_admin_permission("tutors.view")' in liste.rsplit("@router.get", 1)[1]
    durum = kaynak.split("async def update_tutor_pre_application_status")[1]
    assert 'require_admin_permission("tutors.manage")' in durum.split("db:")[0]


# ── İlan dosyası alanları (formun isteğe bağlı bölümleri) ────────────────


def test_ders_bicimi_kapali_liste():
    """Serbest metin kabul edilirse kalıcı profile taşınamayan değer birikir."""
    with pytest.raises(ValueError):
        _payload(teaching_mode="uzaydan")


def test_tanitim_videosu_yalniz_guvenli_konak():
    """Rastgele iframe adresi = phishing yüzeyi; kural `schemas.tutor` ile aynı."""
    assert _payload(intro_video_url="https://youtu.be/abc").intro_video_url
    with pytest.raises(ValueError):
        _payload(intro_video_url="http://youtu.be/abc")
    with pytest.raises(ValueError):
        _payload(intro_video_url="https://kotu-site.example/abc")


def test_ucret_araligi_dogrulanir():
    """Serbest sayı alanı: negatif ya da uçuk tutar kayda girmemeli."""
    assert svc.prepare_submission(_payload(hourly_rate=650))["hourly_rate"] == 650
    with pytest.raises(ValueError):
        _payload(hourly_rate=-1)
    with pytest.raises(ValueError):
        _payload(hourly_rate=999999)


def test_bos_birakilan_alan_null_yazilir():
    """Doldurulmayan isteğe bağlı alan boş dize değil NULL olmalı; aksi hâlde
    panelde "dolu ama boş" satırlar görünür."""
    data = svc.prepare_submission(_payload(headline="   ", bio=""))
    assert data["headline"] is None
    assert data["bio"] is None


def test_fotograf_private_onekte_saklanir():
    """Anonim uçtan public önek'e yazmak siteyi bedava görsel barındırmaya
    açardı; yükleyici `private/` altına yazmak ZORUNDA."""
    kaynak = (BACKEND / "core" / "storage.py").read_text(encoding="utf-8")
    govde = kaynak.split("async def upload_pre_application_photo")[1].split(
        "async def upload_library_photo"
    )[0]
    assert "PRIVATE_PREFIX" in govde
    assert 'prefix="avatars"' not in govde
