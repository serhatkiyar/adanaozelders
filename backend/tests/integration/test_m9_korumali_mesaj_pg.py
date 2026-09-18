"""Modül 5 (18 Eyl 2026) — ders öncesi korumalı mesaj, GERÇEK Postgres.

## Ölçülen iş kuralı

* Dersi olmayan öğrenci yayındaki eğitmene yazabilir (INQUIRY aşaması), ama:
  eğitmen yanıt verene kadar en fazla `MESSAGE_INQUIRY_MAX_UNANSWERED` (3)
  mesaj; son 24 saatte en fazla `MESSAGE_INQUIRY_DAILY_NEW` (5) yeni eğitmen.
  Sayımlar veritabanındandır (Redis olmasa da uygulanır).
* INQUIRY'de dış bağlantılar gizlenir.
* Eğitmen ders öncesi sohbeti başlatamaz; yalnız öğrencinin başlattığına yazar.
* Eğitmenin engeli iki yönü de kapatır; öğrencinin yeni ders talebini ve eski
  ders yorumunu da keser.
* Mesaj şikâyeti yalnız sohbetin tarafınca yapılır; içerik kayda kopyalanır.
"""
from __future__ import annotations

import datetime

import pytest
from sqlalchemy import text

from core.config import settings
from core.database import AsyncSessionLocal
from tests.integration.ip3_factory import yetki_basligi

KOK = "/api/v1/messages"


@pytest.fixture
async def m9(ip3):
    """ip3 fabrikası + testlerin açtığı şikâyetlerin fiziksel temizliği
    (reports tablosunda FK yok; kullanıcı silinince kendiliğinden gitmez)."""
    try:
        yield ip3
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "DELETE FROM reports WHERE (reporter_role = 2 AND reporter_id = ANY(:t))"
                    " OR (reporter_role = 3 AND reporter_id = ANY(:c))"
                ),
                {"t": ip3.tutor_ids or [0], "c": ip3.client_ids or [0]},
            )
            await s.commit()


async def _yaz(http, gonderen, alici_id: int, govde: str = "Merhaba hocam"):
    return await http.post(
        f"{KOK}/{alici_id}", headers=yetki_basligi(gonderen), json={"body": govde}
    )


def _kod(r) -> str | None:
    detail = r.json().get("detail")
    return detail.get("code") if isinstance(detail, dict) else None


@pytest.mark.asyncio
async def test_yanit_beklerken_uc_mesaj_siniri_ve_dis_baglanti_maskesi(m9, http):
    ogrenci = await m9.client()
    egitmen = await m9.tutor()

    uygun = await http.get(
        f"{KOK}/tutors/{egitmen.id}/eligibility", headers=yetki_basligi(ogrenci)
    )
    assert uygun.status_code == 200, uygun.text
    assert uygun.json()["stage"] == "INQUIRY"
    assert uygun.json()["remaining_before_reply"] == settings.MESSAGE_INQUIRY_MAX_UNANSWERED

    ilk = await _yaz(http, ogrenci, egitmen.id, "Detaylar https://kotu.example.com/odeme")
    assert ilk.status_code == 201, ilk.text
    assert "kotu.example.com" not in ilk.json()["body"]
    assert "[gizlendi]" in ilk.json()["body"]
    assert ilk.json()["contact_masked"] is True

    for _ in range(settings.MESSAGE_INQUIRY_MAX_UNANSWERED - 1):
        r = await _yaz(http, ogrenci, egitmen.id)
        assert r.status_code == 201, r.text

    fazla = await _yaz(http, ogrenci, egitmen.id)
    assert fazla.status_code == 429, fazla.text
    assert _kod(fazla) == "INQUIRY_AWAITING_REPLY"

    yanit = await _yaz(http, egitmen, ogrenci.id, "Merhaba, nasıl yardımcı olabilirim?")
    assert yanit.status_code == 201, yanit.text

    sonra = await _yaz(http, ogrenci, egitmen.id)
    assert sonra.status_code == 201, sonra.text


@pytest.mark.asyncio
async def test_gunluk_yeni_egitmen_siniri(m9, http):
    ogrenci = await m9.client()
    egitmenler = [
        await m9.tutor() for _ in range(settings.MESSAGE_INQUIRY_DAILY_NEW + 1)
    ]

    for e in egitmenler[:-1]:
        r = await _yaz(http, ogrenci, e.id)
        assert r.status_code == 201, r.text

    fazla = await _yaz(http, ogrenci, egitmenler[-1].id)
    assert fazla.status_code == 429, fazla.text
    assert _kod(fazla) == "INQUIRY_DAILY_LIMIT"
    assert int(fazla.headers["Retry-After"]) > 0


@pytest.mark.asyncio
async def test_egitmen_iliskisiz_ogrenciye_ilk_mesaji_atamaz(m9, http):
    ogrenci = await m9.client()
    egitmen = await m9.tutor()

    r = await _yaz(http, egitmen, ogrenci.id)

    assert r.status_code == 403, r.text
    assert _kod(r) == "TUTOR_CANNOT_START"


@pytest.mark.asyncio
async def test_engel_mesaji_ve_ders_talebini_keser_kalkinca_acilir(m9, http):
    ogrenci = await m9.client()
    egitmen = await m9.tutor()
    assert (await _yaz(http, ogrenci, egitmen.id)).status_code == 201

    engel = await http.post(
        f"{KOK}/blocks",
        headers=yetki_basligi(egitmen),
        json={"client_id": ogrenci.id, "reason": "OFF_PLATFORM", "note": None},
    )
    assert engel.status_code == 201, engel.text
    assert engel.json()["client_id"] == ogrenci.id

    r = await _yaz(http, ogrenci, egitmen.id)
    assert r.status_code == 403, r.text
    assert _kod(r) == "MESSAGE_BLOCKED"

    baslangic = (
        datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)
    ).replace(minute=0, second=0, microsecond=0)
    ders = await http.post(
        "/api/v1/bookings",
        headers=yetki_basligi(ogrenci),
        json={
            "tutor_id": egitmen.id,
            "start_at": baslangic.isoformat(),
            "end_at": (baslangic + datetime.timedelta(hours=1)).isoformat(),
        },
    )
    assert ders.status_code == 409, ders.text

    # Engelden otomatik şikâyet (OFF_PLATFORM → CONTACT_INFO) açıldı.
    async with AsyncSessionLocal() as s:
        sikayet = (
            await s.execute(
                text(
                    "SELECT reason FROM reports WHERE reporter_role = 2 "
                    "AND reporter_id = :t AND target_type = 'CLIENT' AND target_id = :c"
                ),
                {"t": egitmen.id, "c": ogrenci.id},
            )
        ).scalar_one()
    assert sikayet == "CONTACT_INFO"

    kaldir = await http.delete(
        f"{KOK}/blocks/{ogrenci.id}", headers=yetki_basligi(egitmen)
    )
    assert kaldir.status_code == 204, kaldir.text

    tekrar = await _yaz(http, ogrenci, egitmen.id)
    assert tekrar.status_code == 201, tekrar.text


@pytest.mark.asyncio
async def test_engel_eski_ders_yorumundan_asilamaz(m9, http):
    ogrenci = await m9.client()
    egitmen = await m9.tutor()
    ders = await m9.booking(egitmen, ogrenci)
    engel = await http.post(
        f"{KOK}/blocks",
        headers=yetki_basligi(egitmen),
        json={"client_id": ogrenci.id, "reason": "NOT_A_FIT", "note": None},
    )
    assert engel.status_code == 201, engel.text

    r = await http.post(
        f"/api/v1/bookings/{ders.id}/comments",
        headers=yetki_basligi(ogrenci),
        json={"body": "Hocam bakar mısın"},
    )
    assert r.status_code == 403, r.text
    assert _kod(r) == "MESSAGE_BLOCKED"


@pytest.mark.asyncio
async def test_mesaj_sikayeti_yalniz_sohbet_tarafinca(m9, http):
    ogrenci = await m9.client()
    yabanci = await m9.client()
    egitmen = await m9.tutor()
    assert (await _yaz(http, ogrenci, egitmen.id)).status_code == 201
    yanit = await _yaz(http, egitmen, ogrenci.id, "Pazartesi uygunum.")
    assert yanit.status_code == 201, yanit.text
    mesaj_id = yanit.json()["id"]

    govde = {"target_type": "MESSAGE", "target_id": mesaj_id, "reason": "SCAM"}
    baskasi = await http.post(
        "/api/v1/reports", headers=yetki_basligi(yabanci), json=govde
    )
    assert baskasi.status_code == 404, baskasi.text

    taraf = await http.post(
        "/api/v1/reports", headers=yetki_basligi(ogrenci), json=govde
    )
    assert taraf.status_code == 201, taraf.text
    assert "Pazartesi uygunum." in (taraf.json()["target_snapshot"] or "")
