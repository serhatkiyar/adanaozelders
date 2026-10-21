"""Eğitmenin öğrenci listesi (`booking_service.list_tutor_students`).

Aynı uç iki yüzeyi besler: ders teklifi penceresi (`lesson_count`) ve
Öğrenciler sayfası (son/sonraki ders, onaylı ders sayısı). Sorgu DB'siz,
derlenmiş SQL üzerinden doğrulanır: hangi durumun hangi alana sayıldığı iş
kuralıdır ve sessizce kayabilir.
"""

from __future__ import annotations

import datetime
import re

import pytest
from sqlalchemy.dialects import postgresql

from models.tutor import Tutor
from services import booking_service

NOW = datetime.datetime(2026, 9, 22, 12, 0, tzinfo=datetime.timezone.utc)


class _Satir:
    id = 7
    full_name = "Ayşe"
    avatar_url = None
    son_ders = NOW - datetime.timedelta(days=1)
    sonraki_ders = NOW + datetime.timedelta(days=2)
    tamamlanan = 3
    ders_sayisi = 5
    deneme_var = True
    ucretli_var = True
    deneme_tarihi = NOW - datetime.timedelta(days=30)
    ilk_ders = NOW - datetime.timedelta(days=30)
    bekleyen_talep = None
    bekleyen_teklif = None
    tamamlanacak = None
    haftalik = False


class _Sonuc:
    def __init__(self, satirlar):
        self._satirlar = satirlar

    def all(self):
        return self._satirlar


class _KayitDb:
    def __init__(self, satirlar=()) -> None:
        self.sorgular: list[str] = []
        self._satirlar = list(satirlar)

    async def execute(self, stmt):
        self.sorgular.append(
            str(
                stmt.compile(
                    dialect=postgresql.dialect(),
                    compile_kwargs={"literal_binds": True},
                )
            )
        )
        return _Sonuc(self._satirlar)


def _tutor() -> Tutor:
    t = Tutor()
    t.id = 99
    return t


async def _sql() -> str:
    db = _KayitDb()
    await booking_service.list_tutor_students(db, _tutor(), now=NOW)  # type: ignore[arg-type]
    assert len(db.sorgular) == 1
    return db.sorgular[0]


def _filtre(sql: str, etiket: str) -> str:
    """`... FILTER (WHERE ...) AS etiket` ifadesinin WHERE kısmı."""
    m = re.search(
        r"FILTER \(WHERE ((?:(?!FILTER).)+?)\) AS " + etiket + r"\b", sql, re.S
    )
    assert m, f"{etiket} için FILTER bulunamadı:\n{sql}"
    return m.group(1)


@pytest.mark.asyncio
async def test_uyelik_egitmene_ve_silinmemise_bagli_status_filtresiz():
    sql = await _sql()
    # FILTER içleri de "WHERE" taşır; ana WHERE satır başındakidir.
    ana = sql.rsplit("\nWHERE", 1)[1].split("GROUP BY", 1)[0]
    assert "bookings.tutor_id = 99" in ana
    assert "bookings.deleted_at IS NULL" in ana
    assert "status" not in ana, "liste üyeliği has_relationship ile aynı kalmalı"


@pytest.mark.asyncio
async def test_son_ders_baslamis_kabul_ve_tamamlanan():
    f = _filtre(await _sql(), "son_ders")
    assert "'ACCEPTED'" in f and "'COMPLETED'" in f
    for yok in ("'CANCELLED'", "'REJECTED'", "'PENDING'"):
        assert yok not in f
    assert "bookings.start_at <= '2026-09-22 12:00:00+00:00'" in f


@pytest.mark.asyncio
async def test_sonraki_ders_yalniz_kabul_edilmis_gelecek():
    f = _filtre(await _sql(), "sonraki_ders")
    assert "bookings.status = 'ACCEPTED'" in f
    assert "'PENDING'" not in f and "'COMPLETED'" not in f
    assert "bookings.start_at > '2026-09-22 12:00:00+00:00'" in f


@pytest.mark.asyncio
async def test_toplam_ders_yalniz_onayli():
    """Kullanıcı kararı (22 Eyl 2026): "Toplam ders" yalnız COMPLETED sayar."""
    f = _filtre(await _sql(), "tamamlanan")
    assert f.strip() == "bookings.status = 'COMPLETED'"


@pytest.mark.asyncio
async def test_lesson_count_filtresiz_kalir():
    """Ders teklifi penceresi `lesson_count`u gösterir; anlamı değişmemeli."""
    sql = await _sql()
    assert re.search(r"count\(bookings\.id\) AS ders_sayisi", sql), sql


@pytest.mark.asyncio
async def test_satir_eslemesi_yeni_alanlari_tasir():
    db = _KayitDb([_Satir()])
    out = await booking_service.list_tutor_students(db, _tutor(), now=NOW)  # type: ignore[arg-type]
    assert out == [
        {
            "client_id": 7,
            "full_name": "Ayşe",
            "avatar_url": None,
            "last_lesson_at": _Satir.son_ders,
            "next_lesson_at": _Satir.sonraki_ders,
            "completed_lesson_count": 3,
            "lesson_count": 5,
            "kind": "SINGLE",
            "trial_at": _Satir.deneme_tarihi,
            "first_lesson_at": _Satir.ilk_ders,
            # Sıradaki ders var ve bekleyen bir şey yok → öneri yok.
            "suggested_action": None,
        }
    ]


# ── Tür rozeti ──────────────────────────────────────────────────────────────


def test_tur_haftalik_seri_digerlerini_yener():
    assert (
        booking_service.ogrenci_turu(haftalik=True, deneme_var=True, ucretli_var=True)
        == "WEEKLY"
    )


def test_tur_yalniz_ucretsiz_ders_deneme():
    assert (
        booking_service.ogrenci_turu(haftalik=False, deneme_var=True, ucretli_var=False)
        == "TRIAL"
    )


def test_tur_ucretli_ders_varsa_tek_ders():
    """Denemeden sonra ücretli derse geçen öğrenci artık "Deneme" değildir."""
    assert (
        booking_service.ogrenci_turu(haftalik=False, deneme_var=True, ucretli_var=True)
        == "SINGLE"
    )


def test_tur_yalniz_iptal_kaydi_olan_ogrenci_tursuz():
    assert (
        booking_service.ogrenci_turu(haftalik=False, deneme_var=False, ucretli_var=False)
        is None
    )


# ── Önerilen eylem ──────────────────────────────────────────────────────────


def test_eylem_once_bekleyen_talep():
    """Sıra karardır: yanıt bekleyen talep her şeyin önüne geçer."""
    assert booking_service.onerilen_eylem(
        bekleyen_talep=11, tamamlanacak=22, bekleyen_teklif=33, sonraki_ders=None
    ) == {"kind": "RESPOND_REQUEST", "booking_id": 11}


def test_eylem_sonra_tamamlanacak_ders():
    assert booking_service.onerilen_eylem(
        bekleyen_talep=None, tamamlanacak=22, bekleyen_teklif=33, sonraki_ders=None
    ) == {"kind": "COMPLETE_LESSON", "booking_id": 22}


def test_eylem_bekleyen_teklif_bilgi_olarak_kalir():
    assert booking_service.onerilen_eylem(
        bekleyen_talep=None, tamamlanacak=None, bekleyen_teklif=33, sonraki_ders=None
    ) == {"kind": "OFFER_PENDING", "booking_id": 33}


def test_eylem_dersi_yoksa_ders_planla():
    assert booking_service.onerilen_eylem(
        bekleyen_talep=None, tamamlanacak=None, bekleyen_teklif=None, sonraki_ders=None
    ) == {"kind": "PLAN_LESSON", "booking_id": None}


def test_eylem_sonraki_ders_varken_oneri_yok():
    assert (
        booking_service.onerilen_eylem(
            bekleyen_talep=None,
            tamamlanacak=None,
            bekleyen_teklif=None,
            sonraki_ders=NOW + datetime.timedelta(days=1),
        )
        is None
    )


# ── Sorgu: tür ve eylem alanları ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_haftalik_seri_exists_ile_ogrenciye_baglanir():
    """JOIN'e çevrilirse satırlar çoğalır ve sayılar bozulur."""
    sql = await _sql()
    assert "EXISTS (SELECT" in sql
    assert "lesson_series.tutor_id = 99" in sql
    assert "lesson_series.client_id = clients.id" in sql
    assert "lesson_series.status = 'ACTIVE'" in sql


@pytest.mark.asyncio
async def test_bekleyen_talep_ve_teklif_ayrilir():
    sql = await _sql()
    talep = _filtre(sql, "bekleyen_talep")
    teklif = _filtre(sql, "bekleyen_teklif")
    assert "bookings.offered_by_tutor IS false" in talep
    assert "bookings.offered_by_tutor IS true" in teklif
    for f in (talep, teklif):
        assert "bookings.status = 'PENDING'" in f
        assert "bookings.start_at > '2026-09-22 12:00:00+00:00'" in f


@pytest.mark.asyncio
async def test_tamamlanacak_ders_saati_gecmis_kabul_edilmis():
    f = _filtre(await _sql(), "tamamlanacak")
    assert "bookings.status = 'ACCEPTED'" in f
    assert "bookings.end_at <= '2026-09-22 12:00:00+00:00'" in f


@pytest.mark.asyncio
async def test_deneme_alanlari_iptal_ve_reddi_saymaz():
    sql = await _sql()
    assert "bool_or(bookings.is_trial) FILTER" in sql
    assert "bool_or(NOT bookings.is_trial) FILTER" in sql
    # Yaşayan kayıt: iptal ve red türü belirlemez.
    f = _filtre(sql, "deneme_var")
    assert "'PENDING'" in f and "'ACCEPTED'" in f and "'COMPLETED'" in f
    for yok in ("'CANCELLED'", "'REJECTED'"):
        assert yok not in f
    assert "min(bookings.start_at) FILTER (WHERE bookings.is_trial" in sql
