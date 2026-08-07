"""Admin operasyon kurtarma yüzeyi şemaları (İP-4 / P1-4).

İki kuyruk vardır ve ikisi de **salt okunur teşhistir**; tek yazma işlemi ölü
bir işi yeniden kuyruğa almaktır.
"""
from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict

#: Kuyruğa girme sebebi. İkisi ayrı ayrı gösterilir çünkü operatörün yapacağı iş
#: farklıdır: ``MANUAL_REVIEW`` reconciler'ın "artık denemiyorum" kararıdır
#: (PK-δ), ``RETRY_EXHAUSTED`` ise tavana çarpmış ama kalıcı duruma taşınamamış
#: (modelinde ``manual_review`` tanımlı olmayan) kayıttır.
StuckReason = Literal["MANUAL_REVIEW", "RETRY_EXHAUSTED"]

StuckEntity = Literal[
    "payment", "exam_registration", "study_reservation", "order", "order_return"
]


class StuckEscrowOut(BaseModel):
    """Sıkışmış para kaydının teşhis projeksiyonu.

    Kişisel veri taşımaz: kimin ödediği değil, HANGİ kaydın askıda olduğu ve
    sağlayıcıda hangi referansla aranacağı gösterilir.
    """

    entity: StuckEntity
    entity_id: int
    #: İlgili sipariş (mağaza yollarında); ders/bilet/rezervasyonda ``None``.
    order_id: int | None = None
    reason: StuckReason
    #: Ham para durumu değeri (``REFUNDING`` / ``MANUAL_REVIEW`` …).
    money_status: str
    amount: Decimal | None = None
    currency: str | None = None
    refund_attempts: int
    refund_requested_at: datetime.datetime | None = None
    #: Sağlayıcıdaki tahsilat kimliği — manuel mutabakatın tek girdisi.
    provider_ref: str | None = None
    updated_at: datetime.datetime | None = None


class FailedOutboxOut(BaseModel):
    """Dead-letter outbox işinin WHITELIST projeksiyonu.

    ``payload`` bilinçli olarak DIŞARIDA: alıcının telefonu/e-postası orada
    yaşıyor ve teşhis için gereken şey `kind` + `last_error`'dır. Aynı disiplin
    `services/delivery_timeline.py`'de de uygulanır (İP-3).
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    status: str
    attempts: int
    last_error: str | None = None
    #: Payload'dan yalnız bu alan çıkarılır — operatörün siparişe gidebilmesi
    #: için gerekir ve kişisel veri değildir.
    order_id: int | None = None
    next_attempt_at: datetime.datetime | None = None
    created_at: datetime.datetime | None = None
    updated_at: datetime.datetime | None = None


class OutboxRetryOut(FailedOutboxOut):
    """Retry sonucu.

    ``requeued=False`` "hata" değil **idempotent no-op**'tur: iş bu çağrıdan
    önce zaten kuyruğa alınmıştı. Ayrımı yanıtta taşımak şart — aksi hâlde
    arayüz her tıklamada "yeniden kuyruğa alındı" der ve operatör işi kaç kez
    tetiklediğini bilemez.
    """

    requeued: bool
