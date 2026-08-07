"""İP-1b C düğümleri — bilet kodu TEKİLLİĞİ (GERÇEK PostgreSQL).

## Ölçülen iş kuralı

`qr_token` ve `short_code` bir bileti **tek başına** tanımlar: operatör
`/exam-attendance/verify` ile yalnız kodu okutur, kayıt id'si göndermez
(`library_exam_service.verify_attendance`). İki canlı satır aynı kodu taşırsa
`.first()` hangi bileti döndüreceği belirsizleşir — yanlış öğrencinin katılımı
doğrulanır ve **yanlış emanet serbest bırakılır**.

## Denetim raporuna ek iki ölçüm

1. `_unique_short_code` yalnız **aktif** (PAID/ATTENDED) satırlara karşı
   tekillik arar; oysa `verify_attendance` **statü filtresi olmadan** arar. Yani
   iptal edilmiş bir kaydın kodu canlı bir bilete yeniden dağıtılabiliyor ve
   doğrulama belirsizleşiyor. C-2 tam olarak bunu kurar.
2. `qr_token` için tekillik **hiç** aranmıyor (`secrets.token_urlsafe(24)`
   doğrudan yazılıyor). 192 bitte çakışma pratikte imkânsızdır ama arkasında
   kısıt olmayan bir alan, üretim/geri yükleme/veri taşıma hatalarında sessizce
   ikizlenir — teslimat tarafı bu yüzden `unique=True` koymuş
   (`models/delivery.py:207-209`).
"""
from __future__ import annotations

import datetime
import secrets
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from core.database import AsyncSessionLocal
from models.library_exam import RegistrationStatus

SABIT_KOD = "AB2345"
SABIT_TOKEN = "ip1b-sabit-token"


# ═══════════════════════ C-1 · DB kısıtı gerçekten var mı ═══════════════════════


async def test_C1_deneme_bileti_qr_token_db_de_tekil(ip1b, pg):
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    a, b = await ip1b.ogrenci(), await ip1b.ogrenci()

    await ip1b.ham_kayit(
        session_id=oturum.id,
        client_id=a.id,
        status=RegistrationStatus.PAID.value,
        qr_token=SABIT_TOKEN,
    )
    with pytest.raises(IntegrityError):
        await ip1b.ham_kayit(
            session_id=oturum.id,
            client_id=b.id,
            status=RegistrationStatus.PAID.value,
            qr_token=SABIT_TOKEN,
        )


async def test_C1b_deneme_bileti_short_code_db_de_tekil(ip1b, pg):
    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    a, b = await ip1b.ogrenci(), await ip1b.ogrenci()

    await ip1b.ham_kayit(
        session_id=oturum.id,
        client_id=a.id,
        status=RegistrationStatus.PAID.value,
        short_code=SABIT_KOD,
    )
    with pytest.raises(IntegrityError):
        await ip1b.ham_kayit(
            session_id=oturum.id,
            client_id=b.id,
            # İPTAL edilmiş satır da çakışamaz: doğrulama statüye bakmadan arar.
            status=RegistrationStatus.CANCELLED.value,
            short_code=SABIT_KOD,
        )


async def test_C1c_calisma_rezervasyonu_kodlari_db_de_tekil(ip1b, pg):
    lib = await ip1b.kutuphane(capacity=5, study_hourly_price=Decimal("25.00"))
    a, b = await ip1b.ogrenci(), await ip1b.ogrenci()
    baslangic = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)
    res_a = await ip1b.ham_rezervasyon(
        library_id=lib.id,
        client_id=a.id,
        starts=baslangic,
        ends=baslangic + datetime.timedelta(hours=2),
        status=RegistrationStatus.PAID.value,
    )
    # Çakışan pencere değil, çakışan KOD ölçülüyor: b'nin penceresi ayrık.
    res_b = await ip1b.ham_rezervasyon(
        library_id=lib.id,
        client_id=b.id,
        starts=baslangic + datetime.timedelta(days=1),
        ends=baslangic + datetime.timedelta(days=1, hours=2),
        status=RegistrationStatus.PAID.value,
    )
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE study_reservations SET qr_token = :t WHERE id = :i"),
            {"t": SABIT_TOKEN, "i": res_a},
        )
        await s.commit()
    async with AsyncSessionLocal() as s:
        with pytest.raises(IntegrityError):
            await s.execute(
                text("UPDATE study_reservations SET qr_token = :t WHERE id = :i"),
                {"t": SABIT_TOKEN, "i": res_b},
            )
            await s.commit()
        await s.rollback()


# ════════════ C-2 · üretici çakışmayı görüyor mu (kısıt + oku-yaz döngüsü) ════════════


async def test_C2_kod_uretici_iptal_edilmis_kaydin_kodunu_tekrar_dagitmaz(
    ip1b, sayan_saglayici, pg, monkeypatch
):
    """İptal edilmiş bir bilet kodu canlı bir bilete YENİDEN dağıtılamaz.

    Kurulum çakışmayı **zorlar**: üretici ilk iki çağrıda sabit kodu döndürür.
    Doğru uygulama kodun kullanımda olduğunu görüp yeniden üretir; kusurlu
    uygulama (yalnız aktif statülere bakan döngü) aynı kodu ikinci kez dağıtır.
    """
    uretilen: list[str] = []
    sirali = [SABIT_KOD, SABIT_KOD]

    def sahte_kod(n: int = 6) -> str:
        uretilen.append("cagri")
        if sirali:
            return sirali.pop(0)
        return "ZY9876"

    # Adı bağlayan HER modül yamalanır: üretim kodu yardımcıyı taşırsa test
    # sessizce hiçbir şeyi yamamış olup YANLIŞ YEŞİL vermesin diye aşağıda
    # çağrı sayısı da ölçülür.
    import core.codes as codes
    from services import library_exam_service, study_reservation_service

    hedefler = [codes, library_exam_service, study_reservation_service]
    try:
        from services import library_capacity  # noqa: F401  (düzeltme sonrası var)

        hedefler.append(library_capacity)
    except ImportError:
        pass
    for modul in hedefler:
        if hasattr(modul, "gen_short_code"):
            monkeypatch.setattr(modul, "gen_short_code", sahte_kod)

    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    iptal_eden, odeyen = await ip1b.ogrenci(), await ip1b.ogrenci()
    await ip1b.ham_kayit(
        session_id=oturum.id,
        client_id=iptal_eden.id,
        status=RegistrationStatus.CANCELLED.value,
        short_code=SABIT_KOD,
    )

    kayit = await ip1b.kaydol(odeyen, oturum.id)
    await ip1b.ode(odeyen, kayit.id)

    assert uretilen, (
        "kod üreticisi hiç çağrılmadı — yama tutmadı, bu test hiçbir şey "
        "kanıtlamıyor (yanlış yeşil koruması)"
    )
    satirlar = await ip1b.kayitlar(oturum.id)
    yeni = next(r for r in satirlar if r["id"] == kayit.id)
    assert yeni["short_code"] != SABIT_KOD, (
        "iptal edilmiş kaydın kısa kodu canlı bilete yeniden dağıtıldı — "
        "`verify_attendance` statüye bakmadan aradığı için doğrulama belirsizleşir"
    )


async def test_C2b_qr_token_uretici_cakismayi_gorur(
    ip1b, sayan_saglayici, pg, monkeypatch
):
    """Aynı QR token'ı iki canlı bilete yazılamaz (üretici çakışmayı görür)."""
    sirali = [SABIT_TOKEN, SABIT_TOKEN]
    cagri: list[str] = []
    gercek = secrets.token_urlsafe

    #: Bilet token'ı `token_urlsafe(24)` ile üretilir; sahte sağlayıcı ise kendi
    #: `provider_ref`'i için `token_urlsafe(8)` çağırır. Uzunluğa bakmayan bir
    #: yama sabit değeri SAĞLAYICIYA yedirir ve bilet token'ları farklı çıkar —
    #: test hiçbir çakışma kurmadan YEŞİL görünürdü (ilk koşumda tam olarak bu
    #: oldu). Yama bu yüzden yalnız bilet uzunluğunu hedefler.
    BILET_UZUNLUGU = 24

    def sahte_token(n: int = 32) -> str:
        if n != BILET_UZUNLUGU:
            return gercek(n)
        cagri.append("x")
        if sirali:
            return sirali.pop(0)
        return gercek(n)

    monkeypatch.setattr(secrets, "token_urlsafe", sahte_token)

    lib = await ip1b.kutuphane()
    oturum = await ip1b.oturum(lib.id, capacity=10)
    a, b = await ip1b.ogrenci(), await ip1b.ogrenci()
    kayit_a = await ip1b.kaydol(a, oturum.id)
    kayit_b = await ip1b.kaydol(b, oturum.id)
    await ip1b.ode(a, kayit_a.id)
    await ip1b.ode(b, kayit_b.id)

    assert cagri, "token üreticisi hiç çağrılmadı — yama tutmadı"
    satirlar = {r["id"]: r for r in await ip1b.kayitlar(oturum.id)}
    ta, tb = satirlar[kayit_a.id]["qr_token"], satirlar[kayit_b.id]["qr_token"]
    assert ta and tb, "ödenmiş bilete QR token yazılmadı"
    assert ta != tb, (
        "iki canlı bilet AYNI qr_token'ı taşıyor — `verify_attendance` hangisini "
        "döndüreceğine karar veremez ve yanlış emanet serbest bırakılabilir"
    )
