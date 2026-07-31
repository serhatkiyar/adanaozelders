"""Stok hareket defteri — admin (SALT OKUNUR) şemaları.

Bu modülde **girdi** şeması yoktur ve olmamalıdır: defter append-only'dir,
hareket oluşturma/düzenleme/silme ucu yazılmaz. Hareketler yalnız iş
akışlarının (`order_service`, `store_service`) yan etkisi olarak doğar.
"""
from __future__ import annotations

import datetime

from pydantic import BaseModel, Field


class StockMovementOut(BaseModel):
    """Defter satırının admin görünümü.

    `idempotency_key` **bilinçli olarak yok**: normal listede işe yaramaz
    (operatöre bir şey anlatmaz) ve içinde sipariş/iade kimlikleri taşır.
    Ayıklama gerektiğinde `StockMovementDebugOut` maskeli hâlini verir.
    """

    id: int
    product_id: int
    sku: str
    product_title: str

    qty_delta: int
    qty_after: int
    movement_type: str
    reason_code: str

    ref_type: str | None = None
    ref_id: int | None = None
    ref_line_id: int | None = None

    actor_type: str
    actor_id: int | None = None

    note: str | None = None
    created_at: datetime.datetime


class StockMovementDebugOut(StockMovementOut):
    """Ayrıntı/ayıklama görünümü — anahtar **maskeli**.

    Tam anahtar (`order_item:4213:SALE`) ticari kimlikleri açığa çıkarır;
    ayıklamada gereken şey "anahtar var mı, hangi aileden" bilgisidir.
    """

    idempotency_key_masked: str | None = None


class StockMovementPageOut(BaseModel):
    rows: list[StockMovementOut]
    total: int
    limit: int
    offset: int


class LedgerProblemOut(BaseModel):
    """Tek doğrulama bulgusu.

    `code` arayüzün bağlanacağı sabit; `message` insan metni. `expected`/
    `actual` ayrı alanlar — operatör "ne olmalıydı / ne var" sorusunu bir
    cümleyi ayrıştırmadan cevaplayabilmeli.
    """

    code: str
    message: str
    product_id: int
    sku: str | None = None
    movement_id: int | None = None
    expected: int | None = None
    actual: int | None = None


class LedgerVerificationOut(BaseModel):
    consistent: bool
    product_id: int
    sku: str | None = None
    product_title: str | None = None
    current_stock: int | None = None
    ledger_stock: int | None = None
    movement_count: int
    first_divergent_id: int | None = None
    problems: list[LedgerProblemOut] = Field(default_factory=list)
    #: Stok takip edilmeyen (dijital) ürün için defter TUTULMAZ — arayüz bunu
    #: "sorun yok" ile karıştırmamalı.
    tracked: bool = True


class LedgerAuditOut(BaseModel):
    """Sayfalı genel denetim. Sınırsız tam tarama YOKTUR."""

    checked: int
    inconsistent: int
    problems: list[LedgerProblemOut] = Field(default_factory=list)
    #: `None` ise defterin sonuna gelindi.
    next_offset: int | None = None
    limit: int
    offset: int
