"""F29 hasarlı stok servisi — kova transferi, kurtarma, imha, tedarikçi iadesi.

Kapsam (commit 6): dört hasar işlemi + append-only `stock_damage_events` +
istek düzeyinde idempotency + deterministik ürün kilidi. **HTTP router, Pydantic
şeması, izin kablolaması ve arayüz bu modülde YOKTUR** (commit 7/8).

## Temel sözleşme

`products.stock` **yalnız satılabilir** miktardır; `products.damaged_stock`
işletmede duran, satılamaz miktardır. Dijital üründe ikisi de `NULL`'dur
(`ck_products_damaged_pairing`) ve hiçbir hasar işlemi kabul edilmez.

Her hareket **açık kova** ile yazılır (`stock_ledger` `bucket` parametresini
zorunlu ister; sessiz varsayılan yoktur):

| İşlem | SALEABLE | DAMAGED | Hareket türü |
|---|---|---|---|
| Hasara ayırma | −q | +q | `DAMAGE_TRANSFER` (iki satır) |
| Hasardan kurtarma | +q | −q | `DAMAGE_RECOVERY` (iki satır) |
| İmha | — | −q | `DAMAGE_DISPOSAL` (tek satır) |
| Tedarikçiye iade | −q *veya* — | — *veya* −q | `SUPPLIER_RETURN` (tek satır) |

### Çiftin iki bacağı neden AYNI hareket türünü taşıyor

Yön bilgisi türün adında DEĞİL, `bucket` + `qty_delta` işaretinde durur:
`(DAMAGE_TRANSFER, SALEABLE, −q)` çıkış, `(DAMAGE_TRANSFER, DAMAGED, +q)`
giriştir. Tür adına `_OUT`/`_IN` eklemek aynı bilgiyi ikinci kez kodlar, defter
sorgularını (`GROUP BY movement_type`) böler ve `ck_stock_movements_type`
kısıtını değiştirecek yeni bir migration gerektirirdi. İki bacak zaten ortak
`stock_damage_events.id` ile bağlıdır (`ref_type='damage_event'`).

## Atomiklik

Bir işlem ya tamamen olur ya hiç olmaz. Olay satırı, iki defter hareketi ve iki
bakiye **aynı transaction'dadır**; modül `commit` YAPMAZ (transaction sınırı
çağıranındır — `stock_ledger` ve `inventory_service` ile aynı disiplin).

## Kilit sırası

Global sıra `StockCountSession → Product → Order → OrderReturn → DeliveryStop`.
Hasar servisi **yalnız Product** kilidi alır ve bunu `stock_ledger.lock_products`
üzerinden yapar — ürün kilidi alan tek yer orasıdır ve artan `id` sırasını o
garanti eder. Ayrı bir kilit yöntemi kurulmaz.
"""
from __future__ import annotations

from typing import Any, Sequence

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models.inventory import DAMAGE_REASONS, DamageEventKind, StockDamageEvent
from models.store import (
    ProductKind,
    StockBucket,
    StockMovement,
    StockMovementType,
)
from services import audit_service, stock_ledger

SALEABLE = StockBucket.SALEABLE.value
DAMAGED = StockBucket.DAMAGED.value

#: İşlem türü → (kaynak kova, hedef kova | None, hareket türü).
#: Hedef `None` ise miktar işletmeden **fiziksel olarak çıkar** (imha / iade).
_ISLEM: dict[str, tuple[str, str | None, StockMovementType]] = {
    DamageEventKind.TRANSFER.value: (
        SALEABLE, DAMAGED, StockMovementType.DAMAGE_TRANSFER,
    ),
    DamageEventKind.RECOVERY.value: (
        DAMAGED, SALEABLE, StockMovementType.DAMAGE_RECOVERY,
    ),
    DamageEventKind.DISPOSAL.value: (
        DAMAGED, None, StockMovementType.DAMAGE_DISPOSAL,
    ),
    # Kaynak kova ÇAĞIRAN tarafından açıkça seçilir; sessiz varsayılan yok.
    DamageEventKind.SUPPLIER_RETURN.value: (
        "", None, StockMovementType.SUPPLIER_RETURN,
    ),
}

#: Idempotency **KAPSAMI**: `(actor_admin_id, idempotency_key)`.
#:
#: Anahtar isteği gönderenin kendi alanıdır, küresel bir isim alanı değil. İki
#: yönetici aynı metni bağımsız kullanabilir; DB garantisi
#: `uq_stock_damage_events_idem` (aktör + anahtar) composite unique index'idir.
IDEMPOTENCY_SCOPE: tuple[str, ...] = ("actor_admin_id", "idempotency_key")

#: Kapsamı DB'de zorlayan composite unique index. Savepoint içinde yakalanan
#: `IntegrityError` YALNIZ bu index'e aitse idempotency çatışması sayılır.
IDEMPOTENCY_INDEX = "uq_stock_damage_events_idem"

#: Aynı kapsamda gelen isteğin "aynı iş" sayılması için eşleşmesi gereken
#: alanlar.
#:
#: `note` **koşullu** olarak dâhildir (`_payload`): `reason_code='DIGER'` iken
#: not açıklamanın TAMAMIDIR — gerekçe kodu hiçbir şey anlatmaz, anlamı not
#: taşır (DB'de de zorunlu: `ck_stock_damage_events_note`). Aynı anahtarla
#: farklı bir `DIGER` açıklaması göndermek **başka bir iştir**, sessiz replay
#: değil. Diğer gerekçelerde not payload'ın DIŞINDADIR: bu durumda replay
#: mevcut olayı olduğu gibi döndürür ve **yeni not sessizce yazılmaz** (olay
#: append-only'dir; açıklama düzeltmesi yeni bir iş talebi gerektirir).
#: `actor_admin_id` bu listede DEĞİLDİR ve olmamalıdır: aktör karşılaştırması
#: **kapsamın kendisidir** (`_kapsamda_olay` yalnız aynı aktörün kaydını arar,
#: DB'de `uq_stock_damage_events_idem` bunu zorlar). Payload'a da koymak, hiçbir
#: koşulda farklı olamayacak bir alanı karşılaştırmak olurdu — mutasyon
#: provasında ölü olduğu görüldü ve kaldırıldı.
IDEMPOTENCY_PAYLOAD_FIELDS: tuple[str, ...] = (
    "product_id",
    "kind",
    "qty",
    "source_bucket",
    "reason_code",
    "note",
)


def _hata(code: int, mesaj: str) -> HTTPException:
    return HTTPException(status_code=code, detail=mesaj)


class _Aktor:
    """`audit_service.record` yalnız `id` ve `role_id` okur."""

    __slots__ = ("id", "role_id")

    def __init__(self, admin_id: int) -> None:
        self.id = admin_id
        self.role_id = 1


def movement_key(event_id: int, bucket: str) -> str:
    """Defter anahtarı — olaydan **deterministik** türetilir.

    Aynı olayın yeniden uygulanması (`replay_damage_event`) aynı anahtarları
    üretir, dolayısıyla defter onu replay sayar ve yeni satır yazmaz.
    """
    return f"damage:{event_id}:{bucket}"


def _dogrula(qty: Any, reason_code: str, note: str | None) -> int:
    if isinstance(qty, bool) or not isinstance(qty, int):
        raise _hata(status.HTTP_400_BAD_REQUEST, "miktar tam sayı olmalı")
    if qty <= 0:
        raise _hata(
            status.HTTP_400_BAD_REQUEST,
            "hasar işlemi miktarı pozitif olmalı (sıfır olay iz üretmez)",
        )
    if reason_code not in DAMAGE_REASONS:
        raise _hata(
            status.HTTP_400_BAD_REQUEST,
            f"geçersiz hasar gerekçesi: {reason_code!r} "
            f"(geçerli: {sorted(DAMAGE_REASONS)})",
        )
    # "DIGER" tek başına hiçbir şey açıklamaz; DB'de de aynı kural var
    # (`ck_stock_damage_events_note`, `ck_stock_movements_note`).
    if reason_code == "DIGER" and not (note or "").strip():
        raise _hata(
            status.HTTP_400_BAD_REQUEST, "'DIGER' gerekçesinde açıklama notu zorunlu"
        )
    return int(qty)


def _payload(
    *,
    product_id: int,
    kind: str,
    qty: int,
    source_bucket: str,
    reason_code: str,
    note: str | None,
) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "product_id": product_id,
        "kind": kind,
        "qty": qty,
        "source_bucket": source_bucket,
        "reason_code": reason_code,
    }
    # `DIGER`'de anlam notta durur → semantik payload'ın parçası.
    if reason_code == "DIGER":
        spec["note"] = (note or "").strip()
    return spec


def payload_differences(
    existing: StockDamageEvent, spec: dict[str, Any]
) -> dict[str, tuple[Any, Any]]:
    """Kayıtlı olay ile gelen isteğin çelişen alanları."""
    farklar: dict[str, tuple[Any, Any]] = {}
    for alan in IDEMPOTENCY_PAYLOAD_FIELDS:
        if alan not in spec:
            continue          # `note` yalnız `DIGER`'de karşılaştırılır
        eski = getattr(existing, alan, None)
        if alan == "note":
            eski = (eski or "").strip()
        yeni = spec[alan]
        if eski != yeni:
            farklar[alan] = (eski, yeni)
    return farklar


async def _bakiye(db: AsyncSession, product_id: int, bucket: str) -> int:
    """Kilit ALTINDAKİ ürün nesnesinden kova bakiyesi.

    Var olmayan ürün 404'tür: `lock_products` kayıtsız bir `ValueError`
    fırlatıyordu ve global handler'ı olmadığı için uç 500 dönüyordu.
    Silinmiş ürün de kapsam dışıdır — sayım oturumu da onu almıyor.
    """
    try:
        urun = (await stock_ledger.lock_products(db, [product_id]))[product_id]
    except ValueError as exc:
        raise _hata(status.HTTP_404_NOT_FOUND, "ürün bulunamadı") from exc
    if urun.deleted_at is not None:
        raise _hata(status.HTTP_404_NOT_FOUND, "ürün bulunamadı")
    if urun.kind == ProductKind.DIGITAL.value or urun.stock is None:
        raise _hata(
            status.HTTP_400_BAD_REQUEST,
            "stok takip edilmeyen üründe (dijital ya da izlenmeyen) hasar "
            "işlemi yapılamaz",
        )
    return int((urun.stock if bucket == SALEABLE else urun.damaged_stock) or 0)


async def _kapsamda_olay(
    db: AsyncSession, admin_id: int, idempotency_key: str
) -> StockDamageEvent | None:
    """Idempotency KAPSAMI: `(actor_admin_id, idempotency_key)`.

    Yalnız anahtara bakmak, iki yöneticinin aynı metni kullanmasını çatışma
    sayardı; anahtar isteği gönderenin kendi alanıdır.
    """
    return (
        await db.execute(
            select(StockDamageEvent).where(
                StockDamageEvent.actor_admin_id == admin_id,
                StockDamageEvent.idempotency_key == idempotency_key,
            )
        )
    ).scalars().first()


#: Defter bütünlüğü ihlali mesajının değişmez öneki. Arayüz ve operatör
#: yordamları serbest metne değil bu koda bağlanır.
INVARIANT_MARKER = "LEDGER_INVARIANT"


def expected_legs(olay: StockDamageEvent) -> list[tuple[str, int, str]]:
    """Olayın deftere yazmış OLMASI GEREKEN satırları: `(kova, delta, tür)`.

    Tek doğruluk kaynağı `_ISLEM` tablosudur; beklenen küme burada ikinci kez
    elle yazılmaz.
    """
    kaynak, hedef, tur = _ISLEM[olay.kind]
    if olay.kind == DamageEventKind.SUPPLIER_RETURN.value:
        kaynak = olay.source_bucket
    adet = int(olay.qty)
    bacaklar = [(kaynak, -adet, tur.value)]
    if hedef is not None:
        bacaklar.append((hedef, +adet, tur.value))
    return bacaklar


async def _mevcut_bacaklar(
    db: AsyncSession, event_id: int
) -> list[tuple[str, int, str]]:
    """Olaya **yapısal referansla** bağlı defter satırları.

    Bağ `ref_type='damage_event'` + `ref_id`'dir; metinsel idempotency
    anahtarına güvenilmez. Başka bir olaya bağlı hareket bu sorguya hiç
    düşmez — dolayısıyla bu olayın bacağı olarak sayılmaz.
    """
    satirlar = (
        await db.execute(
            select(
                StockMovement.bucket,
                StockMovement.qty_delta,
                StockMovement.movement_type,
            ).where(
                StockMovement.ref_type == "damage_event",
                StockMovement.ref_id == event_id,
            )
        )
    ).all()
    return sorted((r.bucket, int(r.qty_delta), r.movement_type) for r in satirlar)


async def assert_ledger_intact(db: AsyncSession, olay: StockDamageEvent) -> None:
    """Olayın defter bacakları **tam ve doğru** mu? Değilse domain hatası.

    ## Neden eksik bacak "tamamlanmaz"

    Olay, iki defter satırı ve iki bakiye **aynı transaction'da** yazılır;
    üretim akışında yarım bir olay OLUŞAMAZ. Olay varken bacak eksikse bu bir
    idempotent retry değil, **veri bütünlüğü ihlalidir** — ve sebebi bilinmez:
    bakiye çoktan değişmiş, yalnız defter satırı kaybolmuş olabilir (elle
    silme, kurtarma hatası, bozuk geri yükleme). Bu durumda hareketi yeniden
    uygulamak stoğu **ikinci kez** değiştirir ve bozukluğu sessizce büyütür.

    Bu yüzden servis bozuk veriyi **onarmaz**: durur, adıyla söyler ve düzeltmeyi
    ayrı bir onarım/denetim işine bırakır (`verify_ledger` / `audit_products`
    bulguyu zaten görünür kılıyor).

    Fazla bacak, yanlış kova, yanlış `qty_delta`, yanlış tür ve yanlış referans
    da aynı ihlaldir: beklenen küme ile mevcut küme **birebir** eşleşmelidir.
    """
    beklenen = sorted(expected_legs(olay))
    mevcut = await _mevcut_bacaklar(db, olay.id)
    if mevcut != beklenen:
        raise _hata(
            status.HTTP_409_CONFLICT,
            f"{INVARIANT_MARKER}: hasar olayı {olay.id} için defter satırları "
            f"beklenenle uyuşmuyor (beklenen={beklenen}, mevcut={mevcut}). "
            "Otomatik onarım YAPILMAZ; ayrı bir onarım/denetim işi gerekir.",
        )


#: Replay bayragi icin gecici oznitelik adi. Kalici DEGIL (DB'ye yazilmaz);
#: yalniz "bu yanit yeni is mi replay mi" bilgisini servis katmanindan uca
#: tasir. Uc bunu HTTP durum koduna cevirir (201 vs 200).
_REPLAY_BAYRAGI = "_f29_replayed"


def was_replayed(olay: StockDamageEvent) -> bool:
    """Bu olay YENİ mi yazıldı, yoksa aynı anahtarın replay'i mi?

    Arayüz ikisini aynı "kaydedildi" mesajıyla gösterirse operatör yapılmamış
    bir işi yapılmış sanar ve yeni anahtarla ikinci kez gerçek bir işlem
    yazabilir. İmha ve tedarikçi iadesi geri alınamaz.
    """
    return bool(getattr(olay, _REPLAY_BAYRAGI, False))


async def _replay_veya_catisma(
    db: AsyncSession,
    onceki: StockDamageEvent,
    spec: dict[str, Any],
) -> StockDamageEvent:
    """Kapsamda kayıtlı olay varsa: aynı iş → replay, farklı iş → 409.

    Replay **hiçbir şey yazmaz**: yalnız defter bacaklarının tam ve doğru
    olduğunu doğrular. Bkz. `assert_ledger_intact`.
    """
    farklar = payload_differences(onceki, spec)
    if farklar:
        raise _hata(
            status.HTTP_409_CONFLICT,
            "aynı idempotency anahtarı farklı bir hasar işlemiyle kullanılmış: "
            f"{farklar}",
        )
    await assert_ledger_intact(db, onceki)
    setattr(onceki, _REPLAY_BAYRAGI, True)
    return onceki


async def _uygula(
    db: AsyncSession,
    *,
    product_id: int,
    kind: str,
    qty: Any,
    source_bucket: str | None,
    reason_code: str,
    admin_id: int,
    note: str | None,
    idempotency_key: str | None,
) -> StockDamageEvent:
    """Dört işlemin ORTAK çekirdeği. `commit` YAPMAZ.

    Sıra kritiktir:

    1. saf doğrulama (kilit almadan hızlı hata),
    2. **ürün kilidi** (`stock_ledger.lock_products` — tek kilit noktası),
    3. idempotency araması *kilidin altında*: aynı anahtarlı iki eşzamanlı istek
       ürün kilidinde sıralanır, ikincisi birincinin commit'ini görür,
    4. kaynak kova yeterliliği,
    5. olay satırı (`flush` → kimlik),
    6. defter hareketleri **tek** `apply_many` batch'i.

    Idempotency araması kilitten ÖNCE yapılsaydı iki istek de "kayıt yok" görür,
    ikisi de olay yazar ve unique index'e çarpardı; ürün kilidi bu yarışı
    baştan kapatır (unique index yine de son savunmadır).
    """
    kaynak, hedef, hareket_turu = _ISLEM[kind]
    if kind == DamageEventKind.SUPPLIER_RETURN.value:
        if source_bucket not in (SALEABLE, DAMAGED):
            raise _hata(
                status.HTTP_400_BAD_REQUEST,
                "tedarikçi iadesinde kaynak kova açıkça seçilmeli "
                f"(geçerli: {SALEABLE}, {DAMAGED})",
            )
        kaynak = source_bucket
    adet = _dogrula(qty, reason_code, note)

    # ── Kilit: ürün. Global sıra `... → Product → ...` bozulmaz. ──
    mevcut = await _bakiye(db, product_id, kaynak)

    spec = _payload(
        product_id=product_id, kind=kind, qty=adet,
        source_bucket=kaynak, reason_code=reason_code, note=note,
    )
    if idempotency_key:
        onceki = await _kapsamda_olay(db, admin_id, idempotency_key)
        if onceki is not None:
            return await _replay_veya_catisma(db, onceki, spec)

    if mevcut < adet:
        raise _hata(
            status.HTTP_409_CONFLICT,
            f"{kaynak} kovasında yeterli stok yok (mevcut {mevcut}, istenen "
            f"{adet}); kırpma yapılmaz",
        )

    olay = StockDamageEvent(
        product_id=product_id,
        kind=kind,
        qty=adet,
        source_bucket=kaynak,
        reason_code=reason_code,
        note=note,
        actor_admin_id=admin_id,
        idempotency_key=idempotency_key,
    )
    # ── Yarışa dayanıklı yazım: SAVEPOINT ──
    #
    # Yukarıdaki `SELECT` commit EDİLMEMİŞ satırı göremez; iki eşzamanlı istek
    # (özellikle FARKLI ürünlerde — ürün kilidi onları serileştirmez) ikisi de
    # "kayıt yok" görüp INSERT'e gider. Gerçek garanti
    # `uq_stock_damage_events_idem` composite unique index'idir.
    #
    # INSERT savepoint içinde yapılır: ihlal hâlinde YALNIZ savepoint geri alınır,
    # dış transaction kullanılabilir kalır ve çağırana ham `IntegrityError` (yani
    # 500) yerine kontrollü replay/409 döner. Savepoint olmasaydı transaction
    # "aborted" duruma düşer ve sonraki her ifade `InFailedSqlTransaction` alırdı.
    try:
        async with db.begin_nested():
            db.add(olay)
            await db.flush()      # anahtarlar olayın KİMLİĞİNDEN türer
    except IntegrityError as exc:
        # Savepoint geri alındığında SQLAlchemy nesneyi session'dan zaten
        # düşürmüş olabilir; `expunge` o hâlde hata verir.
        try:
            db.expunge(olay)
        except Exception:  # noqa: BLE001 - nesne zaten session'da değil
            pass
        # YALNIZ idempotency tekilliği çatışması bu yolda çözülür. FK ihlali
        # (uydurma aktör) ya da CHECK ihlali "aynı iş tekrar geldi" DEĞİLDİR;
        # onu 409'a çevirmek gerçek bir veri hatasını gizlerdi.
        if not idempotency_key or IDEMPOTENCY_INDEX not in str(exc.orig or exc):
            raise
        onceki = await _kapsamda_olay(db, admin_id, idempotency_key)
        if onceki is None:
            raise _hata(
                status.HTTP_409_CONFLICT,
                "hasar olayı yazılamadı (eşzamanlı çatışma); isteği tekrarlayın",
            )
        return await _replay_veya_catisma(db, onceki, spec)

    await _defter_yaz(db, olay, adet, kaynak, hedef, hareket_turu,
                       reason_code, note, admin_id)
    await audit_service.record(
        db,
        actor=_Aktor(admin_id),
        action=f"inventory.damage_{kind.lower()}",
        target_type="stock_damage_event",
        target_id=olay.id,
        reason=reason_code,
        meta={
            "product_id": product_id,
            "qty": adet,
            "source_bucket": kaynak,
            "target_bucket": hedef,
        },
    )
    return olay


async def _defter_yaz(
    db: AsyncSession,
    olay: StockDamageEvent,
    adet: int,
    kaynak: str,
    hedef: str | None,
    hareket_turu: StockMovementType,
    reason_code: str,
    note: str | None,
    admin_id: int,
) -> list[Any]:
    """Olayın defter karşılığını **tek batch** hâlinde yazar.

    İki kovalı işlemde iki spec tek `apply_many` çağrısına verilir: batch'in
    yarısı kayıtlıysa `stock_ledger` `PartialIdempotencyState` yükseltir, yani
    "yarım transfer" sessizce oluşamaz.
    """
    ortak = {
        "product_id": olay.product_id,
        "movement_type": hareket_turu,
        "reason_code": reason_code,
        "ref_type": "damage_event",
        "ref_id": olay.id,
        "actor_type": "ADMIN",
        "actor_id": admin_id,
        "note": note,
    }
    specs: list[dict[str, Any]] = [
        {
            **ortak,
            "bucket": kaynak,
            "qty_delta": -adet,
            "idempotency_key": movement_key(olay.id, kaynak),
        }
    ]
    if hedef is not None:
        specs.append(
            {
                **ortak,
                "bucket": hedef,
                "qty_delta": +adet,
                "idempotency_key": movement_key(olay.id, hedef),
            }
        )
    try:
        return await stock_ledger.apply_many(db, specs)
    except stock_ledger.InsufficientStock as exc:
        raise _hata(
            status.HTTP_409_CONFLICT,
            f"ürün {exc.product_id} bakiyesi hasar işlemi için yetersiz",
        ) from exc


# ════════════════════════ Genel arayüz ════════════════════════


async def damage_transfer(
    db: AsyncSession,
    product_id: int,
    *,
    qty: int,
    reason_code: str,
    admin_id: int,
    note: str | None = None,
    idempotency_key: str | None = None,
) -> StockDamageEvent:
    """Satılabilir → hasarlı. `SALEABLE −q` **ve** `DAMAGED +q`, tek transaction."""
    return await _uygula(
        db, product_id=product_id, kind=DamageEventKind.TRANSFER.value,
        qty=qty, source_bucket=None, reason_code=reason_code,
        admin_id=admin_id, note=note, idempotency_key=idempotency_key,
    )


async def damage_recovery(
    db: AsyncSession,
    product_id: int,
    *,
    qty: int,
    reason_code: str,
    admin_id: int,
    note: str | None = None,
    idempotency_key: str | None = None,
) -> StockDamageEvent:
    """Hasarlı → satılabilir (kurtarıldı). `DAMAGED −q` **ve** `SALEABLE +q`."""
    return await _uygula(
        db, product_id=product_id, kind=DamageEventKind.RECOVERY.value,
        qty=qty, source_bucket=None, reason_code=reason_code,
        admin_id=admin_id, note=note, idempotency_key=idempotency_key,
    )


async def damage_disposal(
    db: AsyncSession,
    product_id: int,
    *,
    qty: int,
    reason_code: str,
    admin_id: int,
    note: str | None = None,
    idempotency_key: str | None = None,
) -> StockDamageEvent:
    """Hasarlı kovadan **fiziksel çıkış** (imha). Satılabilir DEĞİŞMEZ."""
    return await _uygula(
        db, product_id=product_id, kind=DamageEventKind.DISPOSAL.value,
        qty=qty, source_bucket=None, reason_code=reason_code,
        admin_id=admin_id, note=note, idempotency_key=idempotency_key,
    )


async def supplier_return(
    db: AsyncSession,
    product_id: int,
    *,
    qty: int,
    bucket: str,
    reason_code: str,
    admin_id: int,
    note: str | None = None,
    idempotency_key: str | None = None,
) -> StockDamageEvent:
    """Seçilen kovadan tedarikçiye **fiziksel çıkış**.

    Kaynak kova ZORUNLU ve açıktır; miktar yalnız o kovadan düşer, diğer kovaya
    sessiz transfer YAPILMAZ.

    Parasal taraf (alacak, maliyet, fatura) F29 kapsamı DIŞINDADIR.
    """
    return await _uygula(
        db, product_id=product_id, kind=DamageEventKind.SUPPLIER_RETURN.value,
        qty=qty, source_bucket=bucket, reason_code=reason_code,
        admin_id=admin_id, note=note, idempotency_key=idempotency_key,
    )


async def replay_damage_event(db: AsyncSession, event_id: int) -> StockDamageEvent:
    """Kayıtlı bir olayın defter bütünlüğünü **doğrular** ve olayı döndürür.

    ⚠️ Onarım YAPMAZ. Önceki uygulama eksik bacakları yeniden yazıyordu; bu
    güvenli değildi: bakiye çoktan değişmiş ve yalnız defter satırı kaybolmuş
    olabilir, o hâlde yeniden yazmak stoğu ikinci kez değiştirirdi. Eksik,
    fazla ya da yanlış bacak artık açık bir domain hatası üretir
    (`assert_ledger_intact`).
    """
    olay = (
        await db.execute(
            select(StockDamageEvent).where(StockDamageEvent.id == event_id)
        )
    ).scalars().first()
    if olay is None:
        raise _hata(status.HTTP_404_NOT_FOUND, "hasar olayı bulunamadı")
    await assert_ledger_intact(db, olay)
    return olay


async def list_damage_events(
    db: AsyncSession,
    *,
    product_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[StockDamageEvent], int]:
    """Zorunlu sayfalı hasar olayı listesi (defter listesiyle aynı disiplin)."""
    from sqlalchemy import func as _f

    limit = max(1, min(int(limit), stock_ledger.LIST_MAX_LIMIT))
    offset = max(0, int(offset))
    kosul: list[Any] = []
    if product_id is not None:
        kosul.append(StockDamageEvent.product_id == product_id)
    toplam = (
        await db.execute(
            select(_f.count()).select_from(StockDamageEvent).where(*kosul)
        )
    ).scalar_one()
    satirlar = list(
        (
            await db.execute(
                select(StockDamageEvent)
                .where(*kosul)
                .order_by(StockDamageEvent.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
    )
    return satirlar, int(toplam)


__all__ = [
    "IDEMPOTENCY_PAYLOAD_FIELDS",
    "INVARIANT_MARKER",
    "assert_ledger_intact",
    "was_replayed",
    "expected_legs",
    "damage_disposal",
    "damage_recovery",
    "damage_transfer",
    "list_damage_events",
    "movement_key",
    "payload_differences",
    "replay_damage_event",
    "supplier_return",
]
