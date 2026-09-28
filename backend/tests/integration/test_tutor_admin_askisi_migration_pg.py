"""`d1f3a5b7c9e2` backfill'i — audit geçmişine göre admin askısı işareti.

Migration'ın UPDATE'i, modülün kendisinden (`op.execute` yakalanarak) alınır
ve test verisine karşı gerçek PG'de koşulur; işlem sonunda geri alınır, yani
paylaşılan test veritabanında kalıcı değişiklik bırakmaz.

Senaryolar, yalnız audit geçmişine bakan bir kuralın ayırt EDEMEDİĞİ durumu da
(eğitmenin audit'e düşmeyen self-servis geçişleri) açıkça belgeler.
"""
from __future__ import annotations

import datetime
import importlib.util
import pathlib

from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.tutor import TutorStatus

_MIGRATION = (
    pathlib.Path(__file__).resolve().parents[2]
    / "migrations/versions/d1f3a5b7c9e2_tutor_suspended_by_admin_at.py"
)
T0 = datetime.datetime(2026, 9, 1, 12, 0, tzinfo=datetime.timezone.utc)


def _backfill_sql() -> str:
    spec = importlib.util.spec_from_file_location("_askisi_migration", _MIGRATION)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    yakalanan: list[str] = []

    class _Op:
        def add_column(self, *a, **k):
            pass

        def execute(self, sql):
            yakalanan.append(str(sql))

    modul.op = _Op()
    modul.upgrade()
    assert len(yakalanan) == 1, "backfill tek UPDATE bekleniyordu"
    return yakalanan[0]


async def _audit(s, admin_id: int, tutor_id: int, action: str, dk: int, **k) -> None:
    await s.execute(
        text(
            "INSERT INTO audit_logs (actor_id, actor_role, action, target_type,"
            " target_id, created_at) VALUES (:a, 1, :act, :tt, :t, :c)"
        ),
        {
            "a": admin_id,
            "act": action,
            "tt": k.get("target_type", "tutor"),
            "t": tutor_id,
            "c": T0 + datetime.timedelta(minutes=dk),
        },
    )


async def test_backfill_senaryolari_ve_idempotensi(ip3):
    admin = await ip3.admin()
    S, A = TutorStatus.SUSPENDED, TutorStatus.APPROVED
    t = {ad: await ip3.tutor(status=durum) for ad, durum in [
        ("admin_kaldirdi", S),
        ("admin_kaldirdi_admin_acti", A),
        ("admin_acti_sonra_kendisi_kapatti", S),
        ("yalniz_kendisi_kapatti", S),
        ("admin_kaldirdi_kendisi_acip_kapatti", S),
        ("ayni_an_son_id_activate", S),
        ("admin_kaldirdi_kendisi_acti_yayinda", A),
        ("baska_hedef_tipi", S),
    ]}
    sql = _backfill_sql()

    async with AsyncSessionLocal() as s:
        await _audit(s, admin.id, t["admin_kaldirdi"].id, "tutor.suspend", 0)
        await _audit(s, admin.id, t["admin_kaldirdi_admin_acti"].id, "tutor.suspend", 0)
        await _audit(s, admin.id, t["admin_kaldirdi_admin_acti"].id, "tutor.activate", 5)
        await _audit(s, admin.id, t["admin_acti_sonra_kendisi_kapatti"].id, "tutor.suspend", 0)
        await _audit(s, admin.id, t["admin_acti_sonra_kendisi_kapatti"].id, "tutor.activate", 5)
        await _audit(s, admin.id, t["admin_kaldirdi_kendisi_acip_kapatti"].id, "tutor.suspend", 0)
        await _audit(s, admin.id, t["ayni_an_son_id_activate"].id, "tutor.suspend", 0)
        await _audit(s, admin.id, t["ayni_an_son_id_activate"].id, "tutor.activate", 0)
        await _audit(s, admin.id, t["admin_kaldirdi_kendisi_acti_yayinda"].id, "tutor.suspend", 0)
        # Aynı id başka bir hedef tipinde (ör. tanıtım videosu) — eşleşmemeli.
        await _audit(
            s, admin.id, t["baska_hedef_tipi"].id, "tutor.suspend", 0,
            target_type="tutor_intro_video",
        )
        await s.commit()

    ids = [x.id for x in t.values()]
    async with AsyncSessionLocal() as s:
        try:
            await s.execute(text(sql))
            ilk = dict(
                (await s.execute(
                    text("SELECT id, suspended_by_admin_at FROM tutors WHERE id = ANY(:i)"),
                    {"i": ids},
                )).all()
            )
            # İdempotensi: ikinci koşum aynı sonucu üretir.
            await s.execute(text(sql))
            ikinci = dict(
                (await s.execute(
                    text("SELECT id, suspended_by_admin_at FROM tutors WHERE id = ANY(:i)"),
                    {"i": ids},
                )).all()
            )
        finally:
            await s.rollback()

    assert ilk == ikinci
    isaretli = {ad for ad, x in t.items() if ilk[x.id] is not None}
    assert isaretli == {
        "admin_kaldirdi",
        # Bilinen yanlış pozitif: eğitmenin aradaki self-servis aç/kapa'sı
        # audit'e düşmez; kural admin kararını geçerli sayar (güvenli taraf).
        "admin_kaldirdi_kendisi_acip_kapatti",
    }, isaretli
    assert ilk[t["admin_kaldirdi"].id] == T0
