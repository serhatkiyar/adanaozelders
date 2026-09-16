"""İlan yayın kapısı — DB'siz nöbetçiler.

5 Eylül 2026'da yayın sözleşmesi değişti: **diploma artık yayın kapısı değil.**
Eskiden `submit_for_approval`, en az bir eğitim kaydında doğrulama materyali
(yüklenen belge VEYA e-Devlet barkodu) yoksa 422 atıyordu. Bu, henüz hiçbir
öğrenciye ulaşmamış bir eğitmenden ilanı yayınlanmadan ÖNCE evrak istemek
demekti ve arzın önündeki en büyük engeldi.

Yeni sözleşme: belgesiz ilan da yayına gider; belgesi admin tarafından e-Devlet
üzerinden doğrulanmış eğitmen profilinde "Diploması Doğrulandı" rozeti alır.
Belge bir BİLET değil, bir AYRICALIK.

Buradaki testler kapının geri gelmesini engellemek için var: kaldırılan bir
kapı, sonraki bir turda "eksik kalmış" sanılıp sessizce geri eklenebilir.
"""
from __future__ import annotations

import inspect

import pytest
from fastapi import HTTPException

from core.text import HEADLINE_MIN_WORDS, HOURLY_RATE_MAX, HOURLY_RATE_MIN
from models.tutor import Tutor, TutorStatus
from services import tutor_service


class _SahteDb:
    """`submit_for_approval` yalnız `flush()` çağırıyor; DB'ye gerek yok."""

    def __init__(self) -> None:
        self.flush_sayisi = 0

    async def flush(self) -> None:
        self.flush_sayisi += 1


def _egitmen(headline: str) -> Tutor:
    t = Tutor()
    t.status = TutorStatus.DRAFT
    t.headline = headline
    return t


UZUN_BASLIK = " ".join(f"sozcuk{i}" for i in range(HEADLINE_MIN_WORDS + 2))


@pytest.mark.asyncio
async def test_belgesiz_ilan_yayina_gonderilebilir():
    """K4: belge yokken de onaya gidebilmeli. Kapı geri eklenirse burası kırılır."""
    db = _SahteDb()
    tutor = _egitmen(UZUN_BASLIK)
    sonuc = await tutor_service.submit_for_approval(db, tutor)  # type: ignore[arg-type]
    assert sonuc.status is TutorStatus.PENDING_APPROVAL
    assert db.flush_sayisi == 1


@pytest.mark.asyncio
async def test_ucret_araligi_disi_reddedilir():
    """Ücret kapısı (16 Eyl 2026): 250–5000 ₺ dışındaki ücretle yayına çıkılamaz;
    boş ücret serbest (kart "Ücret belirtilmemiş" der)."""
    for ucret in (HOURLY_RATE_MIN - 1, HOURLY_RATE_MAX + 1):
        tutor = _egitmen(UZUN_BASLIK)
        tutor.hourly_rate = ucret
        with pytest.raises(HTTPException) as e:
            await tutor_service.submit_for_approval(_SahteDb(), tutor)  # type: ignore[arg-type]
        assert e.value.status_code == 422
    for ucret in (HOURLY_RATE_MIN, 400, HOURLY_RATE_MAX, None):
        tutor = _egitmen(UZUN_BASLIK)
        tutor.hourly_rate = ucret
        sonuc = await tutor_service.submit_for_approval(_SahteDb(), tutor)  # type: ignore[arg-type]
        assert sonuc.status is TutorStatus.PENDING_APPROVAL


@pytest.mark.asyncio
async def test_kisa_baslik_hala_reddedilir():
    """Başlık kapısı KALDI: yayın kalitesinin tek asgari şartı bu."""
    db = _SahteDb()
    tutor = _egitmen("çok kısa başlık")
    with pytest.raises(HTTPException) as e:
        await tutor_service.submit_for_approval(db, tutor)  # type: ignore[arg-type]
    assert e.value.status_code == 422
    assert str(HEADLINE_MIN_WORDS) in str(e.value.detail)


def test_submit_belge_materyaline_BAKMAZ():
    """Kaynak nöbetçisi.

    Davranış testi kapının yokluğunu ancak "belgesiz de geçiyor" üzerinden
    ölçebiliyor; kapı başka bir biçimde (ör. uyarı yerine 409) geri eklenirse
    o test yine kırılırdı ama sebebi görünmezdi. Bu nöbetçi doğrudan söyler:
    fonksiyon belge sorgusuna dokunmuyor.
    """
    kaynak = inspect.getsource(tutor_service.submit_for_approval)
    # Yorum satırları elenmeli: gerekçe metni `has_verification_material` adını
    # bilerek anıyor ve tarama onu çağrı sanmamalı.
    kod = "\n".join(
        s for s in kaynak.splitlines() if not s.strip().startswith("#")
    )
    assert "has_verification_material" not in kod
    assert "has_verified_document" not in kod
