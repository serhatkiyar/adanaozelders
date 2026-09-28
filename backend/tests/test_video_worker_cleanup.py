"""Video worker'ı: temizlik damgası, imzalı PUT süresi ve beklenmeyen hata.

Burada DB yok: `AsyncSessionLocal` sahte oturumla, servis sorguları sahte
satırlarla değiştirilir. Gerçek Postgres davranışı (kilit/yarış)
`tests/integration/test_tutor_video_pg.py` içinde.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql

from core import storage, ws_outbox
from core.config import settings
from services import tutor_video_service
from workers import video_worker


class FakeSession:
    def __init__(self) -> None:
        self.commits = 0
        self.statements: list = []
        self.rows: list = []

    async def __aenter__(self) -> "FakeSession":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1

    async def flush(self) -> None:
        return None

    async def execute(self, stmt):
        self.statements.append(stmt)
        rows = self.rows
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))


@pytest.fixture
def oturum(monkeypatch):
    s = FakeSession()
    monkeypatch.setattr(video_worker, "AsyncSessionLocal", lambda: s)

    async def _flush(db):
        return None

    monkeypatch.setattr(ws_outbox, "flush", _flush)
    return s


def _satir(i: int, **over):
    base = dict(
        id=i,
        source_key=f"private/tutor-videos/1/{i}.bin",
        output_key=f"tutor-videos/{i}.mp4",
        poster_key=f"tutor-videos/{i}.jpg",
        objects_deleted_at=None,
        updated_at=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


def _temizlik_kur(monkeypatch, rows, basarisiz: set[str]):
    async def _bos_liste(db):
        return []

    async def _sifir(db):
        return 0

    async def _liste(db):
        return rows

    silinen: list[str] = []

    async def _sil(key):
        silinen.append(key)
        return key not in basarisiz

    monkeypatch.setattr(tutor_video_service, "requeue_stale", _bos_liste)
    monkeypatch.setattr(tutor_video_service, "expire_pending_uploads", _sifir)
    monkeypatch.setattr(tutor_video_service, "list_for_cleanup", _liste)
    monkeypatch.setattr(storage, "delete_key", _sil)
    return silinen


async def test_silme_basarisizsa_damga_basilmaz_satir_sona_kayar(monkeypatch, oturum):
    ok, kotu = _satir(1), _satir(2)
    _temizlik_kur(monkeypatch, [ok, kotu], basarisiz={kotu.output_key})

    await video_worker.cleanup_tick()

    assert ok.objects_deleted_at is not None
    assert kotu.objects_deleted_at is None, "geçici silme hatası kalıcı yetim bırakmamalı"
    assert kotu.updated_at is not None, "başarısız satır kuyruğun önünü tıkamamalı"


async def test_sinifsiz_anahtar_atlanir_ve_basarili_sayilir(monkeypatch, oturum):
    v = _satir(3, poster_key="eski-kok/3.jpg")
    silinen = _temizlik_kur(monkeypatch, [v], basarisiz=set())

    await video_worker.cleanup_tick()

    assert "eski-kok/3.jpg" not in silinen
    assert v.objects_deleted_at is not None


async def test_temizlik_imzali_put_suresi_dolmayani_beklemez():
    db = FakeSession()
    await tutor_video_service.list_for_cleanup(db)
    sql = str(
        db.statements[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": False}
        )
    )
    assert "upload_expires_at IS NULL OR tutor_intro_videos.upload_expires_at <" in sql


async def test_beklenmeyen_hata_once_kuyruga_doner_sonra_failed_internal(monkeypatch, oturum):
    satir = SimpleNamespace(
        id=7,
        tutor_id=42,
        status="UPLOADED",
        attempts=0,
        lock_token=None,
        processing_started_at=None,
        output_key=None,
        poster_key=None,
        source_key="private/tutor-videos/42/src.bin",
        error_code=None,
        error_message=None,
    )
    sayac = {"n": 0}

    async def _claim(db):
        sayac["n"] += 1
        satir.status = "PROCESSING"
        satir.attempts += 1
        satir.lock_token = f"tok{sayac['n']}"
        satir.output_key = f"tutor-videos/d{sayac['n']}.mp4"
        satir.poster_key = f"tutor-videos/d{sayac['n']}.jpg"
        return satir

    async def _kilitli(db, video_id, lock_token):
        return satir if satir.lock_token == lock_token else None

    async def _process(video, state):
        raise RuntimeError("upload_public_file: bağlantı koptu")

    bildirimler: list[str] = []

    async def _notify(db, **kw):
        bildirimler.append(kw["message"])

    silinen: list[str] = []

    async def _sil(key):
        silinen.append(key)
        return True

    monkeypatch.setattr(tutor_video_service, "claim_next", _claim)
    monkeypatch.setattr(tutor_video_service, "_locked_processing", _kilitli)
    monkeypatch.setattr(tutor_video_service.notification_service, "notify", _notify)
    monkeypatch.setattr(video_worker, "_process", _process)
    monkeypatch.setattr(storage, "delete_key", _sil)
    monkeypatch.setattr(settings, "TUTOR_VIDEO_MAX_ATTEMPTS", 2)

    state = video_worker._State()
    assert await video_worker.process_one(state) is True
    assert satir.status == "UPLOADED" and satir.attempts == 1 and satir.lock_token is None
    assert bildirimler == []
    assert silinen == ["tutor-videos/d1.mp4", "tutor-videos/d1.jpg"]

    assert await video_worker.process_one(state) is True
    assert satir.status == "FAILED" and satir.error_code == "INTERNAL"
    assert satir.attempts == 2, "beklenmeyen hata deneme sayılır"
    assert len(bildirimler) == 1 and "beklenmeyen" in bildirimler[0]
    assert state.current is None
