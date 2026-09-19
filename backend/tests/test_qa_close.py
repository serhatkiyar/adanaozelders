"""`POST /qa/{thread_id}/close` — `qa_service.close_thread` durum geçişi.

DB'ye bağlanmaz: `close_thread` yalnız `thread.status`'u değiştirip `db.flush()`
çağırır, bu yüzden `db` burada sahte (AsyncMock). Amaç: açık/yanıtlanmış bir
başlığın kapanması ve zaten kapalı bir başlığı ikinci kez kapatmanın 409 vermesi
(frontend'deki "Konuğu kapat" düğmesi bu iki davranışa dayanıyor).
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from models.qa import QAStatus, QAThread
from services import qa_service


@pytest.mark.parametrize("baslangic_durumu", [QAStatus.OPEN, QAStatus.ANSWERED])
async def test_acik_veya_yanitlanmis_baslik_kapanir(baslangic_durumu):
    thread = QAThread(status=baslangic_durumu)
    db = AsyncMock()

    result = await qa_service.close_thread(db, thread)

    assert result.status == QAStatus.CLOSED
    db.flush.assert_awaited_once()


async def test_zaten_kapali_baslik_ikinci_kez_kapatilamaz():
    thread = QAThread(status=QAStatus.CLOSED)
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await qa_service.close_thread(db, thread)

    assert exc_info.value.status_code == 409
    db.flush.assert_not_awaited()
