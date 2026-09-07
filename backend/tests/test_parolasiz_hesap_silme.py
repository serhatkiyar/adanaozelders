"""Parolasız hesabın KVKK silme hakkı — iki kanıt kolu.

## Neden ayrı bir kol gerekti

Hesap silme parola isteyerek onaylanıyordu (`AccountDeleteRequest.password`).
Google ile açılan hesabın parolası YOKTUR; o kol tek başına bırakılsaydı
kullanıcı hesabını hiç silemezdi. Bu bir kolaylık kaybı değil, KVKK'daki silme
hakkının kapanmasıdır.

## Kolların KARŞILIKLI DIŞLAYICI olması

Hangi kanıtın geçerli olduğunu HESABIN DURUMU belirler, isteğin içeriği değil:

- Parolalı hesap yalnız parola kabul eder. Token da kabul etseydi silme, tek
  bir kanıt sınıfına (e-posta kutusuna erişim) indirgenirdi.
- Parolasız hesap yalnız token kabul eder.
"""
from __future__ import annotations

import pydantic
import pytest

from schemas.auth import AccountDeleteRequest


class TestSemaSozlesmesi:
    def test_parola_kolu_kabul_edilir(self):
        assert AccountDeleteRequest(password="Parola123").password == "Parola123"

    def test_token_kolu_kabul_edilir(self):
        assert AccountDeleteRequest(token="ham-token").token == "ham-token"

    def test_hicbiri_verilmezse_reddedilir(self):
        """Onaysız silme yok."""
        with pytest.raises(pydantic.ValidationError):
            AccountDeleteRequest()

    def test_ikisi_birden_verilirse_reddedilir(self):
        """Hangi kanıtın geçerli sayıldığı belirsiz kalırdı ve uç, hesabın
        durumuna göre doğru kolu seçmek yerine ilk dolu alana bakma eğilimine
        girerdi."""
        with pytest.raises(pydantic.ValidationError):
            AccountDeleteRequest(password="Parola123", token="ham-token")

    def test_bos_dizeler_kanit_sayilmaz(self):
        with pytest.raises(pydantic.ValidationError):
            AccountDeleteRequest(password="", token="")


class TestEnumSozlesmesi:
    """Bu sınıfın varlık sebebi ÖLÇÜLMÜŞ bir sessizlik.

    `TokenPurpose`a `ACCOUNT_DELETE` eklendiğinde
    `alembic revision --autogenerate` değişikliği GÖRMEDİ ve `alembic check`
    "No new upgrade operations detected" dedi. Veritabanındaki `token_purpose`
    tipi iki değer taşıyor, kod üç değer üretiyordu:

        pg_enum -> EMAIL_VERIFY, PASSWORD_RESET
        kod     -> EMAIL_VERIFY, PASSWORD_RESET, ACCOUNT_DELETE

    Migration elle yazılmasaydı hata CI'da değil, bir kullanıcı hesabını silmeye
    çalıştığında CANLIDA görünürdü. Buradaki testler kod tarafını çıpalar;
    veritabanı tarafının kanıtı `alembic upgrade head` + gerçek PG turudur.
    """

    def test_account_delete_amaci_vardir(self):
        from models.verification_token import TokenPurpose

        assert TokenPurpose.ACCOUNT_DELETE.value == "ACCOUNT_DELETE"

    def test_migration_enum_degerini_ekliyor(self):
        """Kaynak sözleşmesi: enum'a değer eklendiğinde onu veritabanına taşıyan
        bir migration DA olmalı. Düşük güçlü ama sessizliğin tam yerini tutuyor:
        autogenerate bu sınıfı hiç görmüyor."""
        import pathlib

        koklar = list(
            (pathlib.Path(__file__).resolve().parents[1] / "migrations" / "versions").glob("*.py")
        )
        icerik = "\n".join(p.read_text(encoding="utf-8") for p in koklar)
        assert "ADD VALUE" in icerik and "ACCOUNT_DELETE" in icerik, (
            "token_purpose enum'una ACCOUNT_DELETE ekleyen migration bulunamadı. "
            "autogenerate bu değişikliği GÖRMEZ; migration elle yazılmalıdır."
        )


class TestMailSablonu:
    def test_onay_maili_baglantiyi_ve_geri_alinamaz_uyarisini_tasir(self):
        from core.mail import templates

        mesaj = templates.account_delete_email(
            to="ada@ornek.com",
            name="Ada Deneme",
            confirm_url="https://adanaozelders.com.tr/hesap-silme-onayi?token=abc123",
        )
        assert "token=abc123" in mesaj.text
        assert "token=abc123" in mesaj.html
        # Geri alinamaz bir islem icin uyari SART.
        assert "GERİ ALINAMAZ" in mesaj.text
        assert "GERİ ALINAMAZ" in mesaj.html
        # Talebi yapmayan biri icin "hicbir sey olmaz" guvencesi.
        assert "hiçbir şey olmaz" in mesaj.text

    def test_onay_maili_kisa_omurlu_oldugunu_soyler(self):
        from core.config import settings
        from core.mail import templates

        mesaj = templates.account_delete_email(
            to="ada@ornek.com", name="Ada", confirm_url="https://x/y?token=t"
        )
        assert str(settings.PASSWORD_RESET_TOKEN_TTL_HOURS) in mesaj.text
