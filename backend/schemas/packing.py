"""F30 paketleme uçlarının istek/yanıt şemaları.

## Sözleşme

* **İç ORM modeli doğrudan dönmez.** Her yanıt açık alan listesiyle kurulur;
  `order_packages` tablosuna yarın eklenen bir kolon uçtan sessizce sızmaz.
* **İstemci sunucuya ait alan gönderemez.** İstek şemaları `extra="forbid"`
  taşır; `packed_at`, `status`, `actor` gibi bir alan 422 ile reddedilir —
  paket durumunu istemcinin yazabilmesi bütün FSM'i anlamsız kılardı.
* **Tarama sonucu bir İŞ sonucudur.** `PackageScanOut.result` (`OK` ·
  `OK_MANUAL` · `WRONG_SKU` · `OVER_QTY`) 200 ile döner; red de bir olaydır ve
  `package_scan_events`'e yazılabilmesi için transaction commit edilmelidir
  (sözleşme §6). Yapısal hatalar 4xx'tir.
* **Sayfalama zorunlu ve tavanlı** — F29 `schemas/inventory.py` disiplini.
* **`qr_payload` yalnız paketleme yetkisi olanlara gider.** Etiket basımı için
  gereklidir; kalıcı olduğu için (sözleşme §3.3) çalınan etiket riski §7 S4'te
  kayıtlıdır ve zimmet ayrıca durak sahipliği arar.
"""
from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field

#: Liste uçlarının tek istekte dönebileceği EN FAZLA satır (F29 ile aynı tavan).
MAX_LIMIT = 200

#: `offset` tavanı — sınırsız offset her istekte tam tarama maliyeti üretir.
MAX_OFFSET = 100_000

#: Serbest metin alanların üst sınırları. Gerekçe bir cümledir, deneme değil.
REASON_MAX = 200
NOTE_MAX = 500
CODE_MAX = 64
IDEM_MAX = 80


class _Istek(BaseModel):
    """Bütün istek gövdelerinin ortak tabanı — bilinmeyen alan 422."""

    model_config = ConfigDict(extra="forbid")


# ════════════════════════ İstek şemaları ════════════════════════


class PackageScanIn(_Istek):
    """Kalem doğrulama isteği.

    `manual=True` **kaçış kapısıdır** ve `manual_reason` ZORUNLUDUR (servis ve
    DB CHECK'i de aynı şeyi söyler): ürünü kataloğdan silinmiş, kodu okunmayan
    satır ancak gerekçeli ve izli biçimde kapanır (sözleşme §3.6).
    """

    code: str | None = Field(default=None, max_length=CODE_MAX)
    manual: bool = False
    manual_reason: str | None = Field(default=None, max_length=REASON_MAX)
    #: Manuel doğrulamada hangi satırın kapatıldığı; kod eşleşmiyorsa zorunlu.
    order_item_id: int | None = Field(default=None, ge=1)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=IDEM_MAX)


class PackageUndoScanIn(_Istek):
    """Gerekçeli düzeltme. `idempotency_key` **önerilir**: geri alma
    durum-idempotan değildir, ağ tekrarı adedi iki kez düşürür (§7 S7)."""

    order_item_id: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=REASON_MAX)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=IDEM_MAX)


class PackageVoidIn(_Istek):
    """Paketten vazgeçme. Gerekçe boş dizgi olarak da geçemez — `min_length`
    yalnız uzunluğa bakar, boşluk kırpma kontrolü serviste (422)."""

    reason: str = Field(min_length=1, max_length=REASON_MAX)


class PackageReturnInIn(_Istek):
    note: str | None = Field(default=None, max_length=NOTE_MAX)


class HandoverScanIn(_Istek):
    payload: str = Field(min_length=1, max_length=200)


# ════════════════════════ Yanıt şemaları ════════════════════════


class PackageItemOut(BaseModel):
    id: int
    order_item_id: int
    product_id: int | None
    #: Ürünü okunamayan satırda `sku`/`barcode` NULL'dır ve satır TARANAMAZ;
    #: yalnız gerekçeli manuel doğrulamayla kapanır (sözleşme §3.6).
    sku: str | None
    barcode: str | None
    title: str
    expected_qty: int
    scanned_qty: int
    remaining: int


class PackageOut(BaseModel):
    id: int
    order_id: int
    package_no: int
    #: `PKT-000042` — türetilmiş insan okunur kod (kolon değil).
    code: str
    status: str
    #: Etikete basılan `PKG1:{id}:{token}` yükü.
    qr_payload: str
    items_fingerprint: str
    packed_at: datetime.datetime | None = None
    packed_by_admin_id: int | None = None
    handed_over_at: datetime.datetime | None = None
    handed_to_courier_id: int | None = None
    handed_over_by_actor: str | None = None
    delivered_at: datetime.datetime | None = None
    returned_at: datetime.datetime | None = None
    return_note: str | None = None
    void_at: datetime.datetime | None = None
    void_reason: str | None = None
    unpacked_at: datetime.datetime | None = None
    created_at: datetime.datetime | None = None
    items: list[PackageItemOut] = []


class PackageScanOut(PackageOut):
    """Tarama yanıtı = iş sonucu + paketin GÜNCEL hâli.

    Paketin tamamı bilinçli olarak döner: ekran her taramadan sonra satır
    adetlerini yeniden çizmek zorunda ve ayrı bir `GET` isteği, iki isteğin
    arasında değişen bir satırı gösteremezdi.
    """

    result: str
    qty_delta: int
    order_item_id: int | None = None
    #: `True` ise bu yanıt kayıtlı bir sonucun TEKRARIDIR; hiçbir yan etki
    #: üretilmemiştir (aynı `idempotency_key`).
    replayed: bool = False


class PackagePage(BaseModel):
    items: list[PackageOut]
    total: int
    limit: int
    offset: int


class ReturnQueueRowOut(BaseModel):
    """"Geri dönüş bekleniyor" satırı (sözleşme §3.5 / TB-7).

    `waiting_days` görünürlüğün kendisidir: hiçbir yerde görünmeyen paket
    aranmaz ve süresiz kaybolur.
    """

    package_id: int
    package_code: str
    order_id: int
    courier_id: int | None = None
    courier_name: str | None = None
    handed_over_at: datetime.datetime | None = None
    waiting_days: int


class HandoverManifestRowOut(BaseModel):
    stop_id: int
    order_id: int
    sequence: int
    package_id: int | None = None
    package_code: str | None = None
    package_status: str | None = None
    handed_over: bool


class HandoverManifestOut(BaseModel):
    """Kurye zimmet ekranının N/M çubuğu + eksik paket listesi (sözleşme §6)."""

    run_id: int
    run_status: str
    total: int
    handed_over: int
    rows: list[HandoverManifestRowOut] = []
