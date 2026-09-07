"""E-posta tekilliği BEŞ kullanıcı tablosunun TAMAMINDA geçerlidir.

## Ölçülen tehlike (düzeltmeden ÖNCE, gerçek Postgres'te doğrulandı)

`register_tutor` yalnız `Tutor`a, `register_client` yalnız `Client`a
bakıyordu — çapraz tablo tekilliği YOKTU. İki sonuç ölçüldü:

  1. Aynı e-posta iki tabloya birden yazılabiliyordu.
  2. Kişi iki hesapta AYNI parolayı kullanırsa — ki "üyeyim, bir de eğitmen
     olayım" diyen herkes bunu yapar — `authenticate` `_LOGIN_PRECEDENCE`
     sırasında TUTOR'ı önce gördüğü için giriş EĞİTMENİ açıyordu. Üye
     hesabına (siparişleri, rezervasyonları, favorileri, mesajları) artık
     hiçbir parolayla ULAŞILAMIYORDU. Sessiz hesap kaybı.

Bu, "kayıtta rol seçimini kaldıralım, üye sonradan eğitmen olsun" paketinin
tam ortasındaki tuzaktı: o akış naif yazılsaydı insanların mevcut hesaplarını
öksüz bırakırdı. Kapı burada kapatıldı; dönüşüm ayrı ve bilinçli bir mekanizma
gerektirir (satır taşıma ya da bağlama), ikinci bir kayıt DEĞİL.

## Gölge satırlar neden hariç

Eğitmen mağazaya girdiğinde ona bir gölge `Client` satırı açılıyor ve o satır
eğitmenin GERÇEK e-postasını taşıyor (docs/egitmen-alici-sozlesme.md §1.2).
Hariç tutulmasaydı hiçbir eğitmen kendi e-postasıyla ikinci bir işlem
yapamazdı — gölgesi kendi önünü keserdi.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from core.database import AsyncSessionLocal
from models.client import Client
from models.tutor import Tutor
from core.security import hash_password_async
from services import auth_service
from tests.integration.conftest import _uniq

PAROLA = "Aa123456!"


async def _temizle(eposta: str) -> None:
    """Bu dosya kendi satırlarını siler — hijyen nöbetçisi kalıcı satır bırakan
    suite'i düşürüyor ve haklı: sızan fikstür sonraki testin kümesini bozar."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Tutor).where(Tutor.email == eposta))
        await db.execute(delete(Client).where(Client.email == eposta))
        await db.commit()


@pytest.mark.asyncio
async def test_egitmen_kaydi_MEVCUT_uye_epostasini_reddeder(pg):
    eposta = f"cift-{_uniq()}@ciftkayit.example.com"
    try:
        async with AsyncSessionLocal() as db:
            await auth_service.register_client(
                db, email=eposta, password=PAROLA, first_name="Uye", last_name="Test"
            )
            await db.commit()

        with pytest.raises(HTTPException) as hata:
            async with AsyncSessionLocal() as db:
                await auth_service.register_tutor(
                    db, email=eposta, password=PAROLA, first_name="Uye", last_name="Test"
                )
        assert hata.value.status_code == 409

        # DOLULUK: üye satırı DURUYOR ve girişi hâlâ kendisini açıyor.
        # Bu olmadan "409 verdi" iddiası, kaydın hiç oluşmadığı bir dünyada da
        # geçerdi.
        async with AsyncSessionLocal() as db:
            u, rol = await auth_service.authenticate(db, email=eposta, password=PAROLA)
        assert u is not None and rol.value == "CLIENT"
    finally:
        await _temizle(eposta)


@pytest.mark.asyncio
async def test_uye_kaydi_MEVCUT_egitmen_epostasini_reddeder(pg):
    """Ters yön de kapalı olmalı; tek yönlü kapı yarım kapıdır."""
    eposta = f"cift2-{_uniq()}@ciftkayit.example.com"
    try:
        async with AsyncSessionLocal() as db:
            await auth_service.register_tutor(
                db, email=eposta, password=PAROLA, first_name="Egitmen", last_name="Test"
            )
            await db.commit()

        with pytest.raises(HTTPException) as hata:
            async with AsyncSessionLocal() as db:
                await auth_service.register_client(
                    db, email=eposta, password=PAROLA, first_name="Uye", last_name="Test"
                )
        assert hata.value.status_code == 409
    finally:
        await _temizle(eposta)


@pytest.mark.asyncio
async def test_GOLGE_satir_arama_yolunu_PATLATMAZ(pg):
    """Kapının yanlış tarafa kapanmadığının kanıtı — ve doğru düğüm.

    İlk yazımda bu testin adı "gölge eğitmenin e-postasını kilitlemez"di ama
    onu SINAMIYORDU: mutasyon provasında gölge hariç tutması kaldırıldığında
    test yeşil kaldı. Çünkü eğitmen satırı zaten e-postayı tutuyor;
    `_email_taken` gölgeye hiç bakmadan True dönüyor.

    Hariç tutmanın GERÇEKTEN koruduğu şey arama yolu: `authenticate` ve
    `find_by_email` `scalar_one_or_none()` kullanıyor. Aynı e-postada hem
    GERÇEK bir `Client` hem de bir gölge varsa (çapraz tekillik gelmeden önce
    açılmış eski kayıtlar), filtre olmadan iki satır bulunur ve
    `MultipleResultsFound` → 500 olur. Şifre sıfırlama ekranı da bu yoldan
    geçer.

    Bu yüzden senaryo o eski durumu ELLE kurar: kayıt yolundan artık
    üretilemez ama üretimde durabilir.
    """
    eposta = f"golge-{_uniq()}@ciftkayit.example.com"
    try:
        async with AsyncSessionLocal() as db:
            egitmen = await auth_service.register_tutor(
                db, email=eposta, password=PAROLA, first_name="Egitmen", last_name="Test"
            )
            await db.commit()
            tutor_id = egitmen.id

        # Eski (grandfathered) durum: aynı e-postada GERÇEK üye + GÖLGE.
        async with AsyncSessionLocal() as db:
            # GERÇEK üyenin özeti geçerli olmalı: `verify_password_async`
            # "!" gibi bir yer tutucuda `ValueError: Invalid salt` atar.
            # (Gölge satırda "!" meşrudur — o hiç doğrulanmaz.)
            db.add(
                Client(
                    email=eposta,
                    hashed_password=await hash_password_async("Uye" + PAROLA),
                    first_name="Eski", last_name="Uye", role_id=3,
                )
            )
            db.add(
                Client(
                    email=eposta, hashed_password="!", first_name="Egitmen",
                    last_name="Test", role_id=3, shadow_of_tutor_id=tutor_id,
                )
            )
            await db.commit()

        # DOLULUK: iki `Client` satırı gerçekten var — biri gölge, biri değil.
        async with AsyncSessionLocal() as db:
            satirlar = (
                await db.execute(select(Client).where(Client.email == eposta))
            ).scalars().all()
        assert len(satirlar) == 2
        assert sum(1 for c in satirlar if c.shadow_of_tutor_id is None) == 1

        # ASIL YOL: eğitmenin parolası TUTMAZSA döngü CLIENT sorgusuna iner.
        # Filtre olmadan orada iki satır bulunur ve `scalar_one_or_none()`
        # `MultipleResultsFound` fırlatır → giriş ekranı 500 verir.
        # (Doğru parolayla test edilseydi TUTOR ilk turda dönerdi ve Client
        #  sorgusuna HİÇ inilmezdi — ilk denememin yakalayamamasının sebebi
        #  buydu.)
        async with AsyncSessionLocal() as db:
            u, rol = await auth_service.authenticate(
                db, email=eposta, password="Bambaska" + PAROLA
            )
        assert u is None and rol is None, "yanlış parola giriş açmamalı"

        # Doğru parolayla hâlâ EĞİTMEN açılır.
        async with AsyncSessionLocal() as db:
            u2, rol2 = await auth_service.authenticate(db, email=eposta, password=PAROLA)
        assert u2 is not None and rol2.value == "TUTOR"
    finally:
        await _temizle(eposta)
