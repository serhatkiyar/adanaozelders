"""Tedarikçi senkron servisi — iş mantığı.

Sözleşme: `docs/tedarikci-senkron-sozlesme.md`.

## Üç yapısal karar

**1. Önce ağ, sonra DB (D-9).** Uzun bir HTTP çağrısını açık transaction
içinde beklemek bağlantıyı ve satır kilitlerini o süre boyunca tutar;
`DB_STATEMENT_TIMEOUT_MS` de bu yüzden tetiklenir. Bu yüzden fonksiyonlar
önce ihtiyaç duydukları alanları **ilkel değer** olarak kopyalar, transaction'ı
kapatır, ağa çıkar, sonra yazar.

**2. Deftere DOKUNULMAZ (D-1).** Bu modül `stock_ledger`'ı hiç çağırmaz;
`tests/acceptance/test_supplier_contract.py` bunu AST ile korur. Tedarikçinin
deposundaki mal bizim rafımızda değildir.

**3. Devre kesici DB'de.** `core/routing._State` süreç-içidir çünkü yalnız "bu
süreç boşuna beklemesin" der. Burada durum panelde GÖRÜNMEK zorunda (yönetici
senkronun neden durduğunu bilmeli) ve replikalar arasında paylaşılmalı.
"""
from __future__ import annotations

import dataclasses
import datetime
import logging
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.suppliers.barcode import normalize_barcode, validate_barcode
from core.suppliers.base import SupplierClient, SupplierError
from core.suppliers.factory import build_client
from core.suppliers.pricing import compute_cost
from core.suppliers.quarantine import (
    favorite_flags,
    link_flags,
    merge_flags,
    price_flags,
    stock_flags,
)
from core.suppliers.yildirim import _maskele, decode_token_expiry
from models.store import Product, ProductKind
from models.supplier import Supplier, SupplierProduct
from services import audit_service

logger = logging.getLogger("adana.suppliers.sync")

#: Postgres danışmanlı kilit anahtarı. `main.py::_LOCK_*` serisinin devamı;
#: çakışma iki farklı işin birbirini bloklaması demektir.
LOCK_KEY = 918_301_005

#: Devre kesici tabanı: `min(30 sn × 2^n, SUPPLIER_MAX_COOLDOWN_SECONDS)`.
_COOLDOWN_BASE_SECONDS = 30


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@dataclasses.dataclass
class SyncReport:
    """Bir senkron turunun sonucu — panelde gösterilir, audit'e yazılmaz."""

    scope: str = "stock"
    favorites: int = 0
    new: int = 0
    updated: int = 0
    unfavorited: int = 0
    auto_linked: int = 0
    flagged: int = 0
    priced: int = 0
    price_batches: int = 0
    notified: int = 0

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclasses.dataclass
class DueReport:
    ran_stock: int = 0
    ran_price: int = 0
    skipped_cooldown: int = 0
    skipped_disabled: int = 0
    failed: int = 0


# ══════════════════ Hata kaydı ve devre kesici ══════════════════


def _sanitize_error(exc: Exception, supplier: Supplier) -> str:
    """Panelde GÖSTERİLECEK hata metni — token asla içermez (D-5).

    Sağlayıcı hata gövdesinde token'ı geri yansıtabilir ve o metin doğrudan
    `last_error`'a yazılıyor. `_maskele` hem bilinen token'ı hem de genel JWT
    desenini temizler.
    """
    ham = f"{exc.__class__.__name__}: {exc}"
    return _maskele(ham, supplier.api_token)[:1000]


async def _note_failure(db: AsyncSession, supplier: Supplier, exc: Exception) -> None:
    """Hatayı kaydeder ve üstel geri çekilme uygular.

    60 saniyelik stok döngüsü, origin 502 verirken onu dövmemeli: her hatada
    bekleme iki katına çıkar, tavanda sabitlenir. `next_*_at` de cooldown'a
    çekilir ki döngü boşuna uyanmasın.
    """
    supplier.consecutive_failures = int(supplier.consecutive_failures or 0) + 1
    saniye = min(
        _COOLDOWN_BASE_SECONDS * (2 ** (supplier.consecutive_failures - 1)),
        settings.SUPPLIER_MAX_COOLDOWN_SECONDS,
    )
    simdi = _now()
    supplier.cooldown_until = simdi + datetime.timedelta(seconds=saniye)
    supplier.last_error = _sanitize_error(exc, supplier)
    supplier.last_error_at = simdi
    supplier.next_stock_sync_at = supplier.cooldown_until
    supplier.next_price_sync_at = supplier.cooldown_until
    await db.commit()


def _note_success(supplier: Supplier) -> None:
    supplier.consecutive_failures = 0
    supplier.cooldown_until = None
    supplier.last_error = None
    supplier.last_error_at = None


# ══════════════════ Stok senkronu ══════════════════


async def sync_stock(
    db: AsyncSession, supplier: Supplier, client: SupplierClient
) -> SyncReport:
    """Favori listesini çeker, upsert eder, otomatik bağlar, bildirim tetikler."""
    supplier_id = supplier.id
    # D-9: ağa çıkmadan ÖNCE transaction kapanır. `expire_on_commit=False`
    # olduğu için `supplier` nesnesi kullanılabilir kalır.
    await db.commit()

    try:
        favoriler = await client.fetch_favorites()
    except Exception as exc:  # noqa: BLE001 - kaydedip yeniden atıyoruz
        await _note_failure(db, supplier, exc)
        raise

    rapor = SyncReport(scope="stock", favorites=len(favoriler))
    simdi = _now()

    mevcutlar = {
        sp.external_id: sp
        for sp in (
            await db.execute(
                select(SupplierProduct).where(
                    SupplierProduct.supplier_id == supplier_id
                )
            )
        ).scalars().all()
    }

    #: (product_id, önceki tedarikçi stoğu) — bildirim tetiği için.
    onceki_stok: dict[int, Decimal] = {}
    gorulen: set[int] = set()

    for fav in favoriler:
        gorulen.add(fav.external_id)
        sp = mevcutlar.get(fav.external_id)
        yeni_mi = sp is None
        if sp is None:
            sp = SupplierProduct(
                supplier_id=supplier_id,
                external_id=fav.external_id,
                last_seen_at=simdi,
            )
            db.add(sp)
            rapor.new += 1
        else:
            if sp.product_id is not None:
                onceki_stok[sp.product_id] = Decimal(str(sp.stock_qty or 0))
            rapor.updated += 1

        barkod = normalize_barcode(fav.barcode)
        kontrol = validate_barcode(barkod)

        sp.external_code = fav.code
        sp.name = fav.name
        sp.brand = fav.brand
        sp.category_path = fav.category_path
        sp.barcode = barkod
        sp.barcode_valid = bool(kontrol.valid)
        sp.unit_name = fav.unit_name
        sp.unit_multiplier = fav.unit_multiplier
        sp.min_order = fav.min_order
        sp.stock_qty = fav.stock_qty
        sp.stockless = fav.stockless
        sp.stock_status = fav.stock_status
        sp.list_price = fav.list_price
        sp.vat_rate = fav.vat_rate
        sp.image_url = (
            f"{supplier.base_url.rstrip('/')}/urun/{fav.external_id}/resim"
            if fav.has_image
            else None
        )
        sp.opened_at = fav.opened_at
        sp.last_seen_at = simdi
        sp.stock_synced_at = simdi
        if not sp.is_favorite:
            # Favoriye geri döndü: "çıkarıldı" damgası temizlenmeli, aksi halde
            # panel bayat bir uyarı gösterir.
            sp.is_favorite = True
            sp.unfavorited_at = None
        # Fiyat bayrakları fiyat turunda konur; burada yalnız ürün bayrakları
        # tazelenir (fiyat bayraklarını EZMEMEK için ayrı tutulur).
        fiyat_bayraklari = tuple(
            b for b in (sp.quarantine_flags or []) if b in _FIYAT_BAYRAKLARI
        )
        sp.quarantine_flags = merge_flags(favorite_flags(fav), fiyat_bayraklari)
        if yeni_mi:
            await db.flush()

    # Listede görünmeyenler: SİLİNMEZ, işaretlenir.
    for dis_id, sp in mevcutlar.items():
        if dis_id in gorulen or not sp.is_favorite:
            continue
        sp.is_favorite = False
        sp.unfavorited_at = simdi
        sp.quarantine_flags = merge_flags(
            tuple(sp.quarantine_flags or []), stock_flags(is_favorite=False)
        )
        rapor.unfavorited += 1

    await db.flush()
    rapor.auto_linked = await auto_link(db, supplier_id)

    _note_success(supplier)
    supplier.last_stock_sync_ok_at = simdi
    supplier.next_stock_sync_at = simdi + datetime.timedelta(
        seconds=int(supplier.stock_interval_seconds)
    )
    supplier.last_sync_stats = rapor.as_dict()
    await db.commit()

    rapor.notified = await _bildirimleri_tetikle(db, supplier_id, onceki_stok)
    return rapor


#: Fiyat turunun koyduğu bayraklar — stok turu bunları EZMEZ (fiyat 6 saatte
#: bir tazeleniyor; her stok turunda silinselerdi panel yanıp sönerdi).
_FIYAT_BAYRAKLARI = frozenset(
    {"KIRILIM_YOK", "SIFIR_FIYAT", "DOVIZ_TL_DEGIL", "NET_TABANDAN_YUKSEK"}
)


async def _bildirimleri_tetikle(
    db: AsyncSession, supplier_id: int, onceki: dict[int, Decimal]
) -> int:
    """Tedarikçi stoğu `<1 → >=1` geçen ürünlerde stok bildirimi.

    Aboneler "bu ürünü SATIN ALABİLECEĞİM zaman haber ver" diyor; "rafınıza
    mal girdiğinde" demiyorlar. Temin açıkken ürün gerçekten satın alınabilir
    hâle gelir. Temin KAPALIYSA gönderilmez — ürün hâlâ satılamaz.
    """
    if not onceki:
        return 0
    from services import store_service

    aday_idler = [pid for pid, eski in onceki.items() if int(eski) < 1]
    if not aday_idler:
        return 0

    satirlar = (
        await db.execute(
            select(Product, SupplierProduct.stock_qty)
            .join(SupplierProduct, SupplierProduct.product_id == Product.id)
            .where(
                Product.id.in_(aday_idler),
                Product.deleted_at.is_(None),
                Product.supplier_backed.is_(True),
                # Kendi stoğu zaten varsa ürün satılabilirdi; "geri geldi"
                # bildirimi yanlış olur.
                func.coalesce(Product.stock, 0) <= 0,
                SupplierProduct.supplier_id == supplier_id,
                SupplierProduct.is_favorite.is_(True),
                SupplierProduct.stock_qty >= 1,
            )
        )
    ).all()

    sayi = 0
    for urun, _qty in satirlar:
        await store_service.notify_back_in_stock(db, urun)
        sayi += 1
    return sayi


# ══════════════════ Otomatik bağlama (D-7) ══════════════════


async def auto_link(db: AsyncSession, supplier_id: int) -> int:
    """Barkod/ISBN eşleşen bağsız satırları ürünlere bağlar.

    Kural: **tam bir** eşleşme. İki ürün aynı ISBN'i taşıyabilir (farklı basım)
    ve hangisi olduğu belirsizken bağ kurmak, yanlış ürünü stokta göstermektir.
    Elle kurulmuş (`MANUAL`) bağlar hiç ele alınmaz — yöneticinin kararı
    senkron tarafından ezilemez.
    """
    adaylar = (
        await db.execute(
            select(SupplierProduct).where(
                SupplierProduct.supplier_id == supplier_id,
                SupplierProduct.product_id.is_(None),
                SupplierProduct.is_favorite.is_(True),
                SupplierProduct.barcode_valid.is_(True),
                SupplierProduct.barcode.isnot(None),
            )
        )
    ).scalars().all()
    if not adaylar:
        return 0

    kodlar = {sp.barcode for sp in adaylar if sp.barcode}
    # ISBN tirelenmiş girilmiş olabilir; iki taraf da normalize edilir.
    isbn_norm = func.replace(func.replace(Product.isbn, "-", ""), " ", "")
    urunler = (
        await db.execute(
            select(Product.id, Product.barcode, isbn_norm.label("isbn_norm")).where(
                Product.deleted_at.is_(None),
                Product.kind == ProductKind.PHYSICAL.value,
                (Product.barcode.in_(kodlar)) | (isbn_norm.in_(kodlar)),
            )
        )
    ).all()

    eslesme: dict[str, list[int]] = {}
    for pid, barkod, isbn in urunler:
        for kod in {barkod, isbn}:
            if kod and kod in kodlar:
                eslesme.setdefault(kod, []).append(pid)

    # Zaten bağlı ürünler: aynı üründe ikinci bağ `uq_supplier_products_link`
    # ile reddedilir; önceden bilmek daha iyi bir bayrak verir.
    bagli_urunler = set(
        (
            await db.execute(
                select(SupplierProduct.product_id).where(
                    SupplierProduct.supplier_id == supplier_id,
                    SupplierProduct.product_id.isnot(None),
                )
            )
        ).scalars().all()
    )

    simdi = _now()
    sayi = 0
    for sp in adaylar:
        adaylar_pid = eslesme.get(sp.barcode or "", [])
        if not adaylar_pid:
            continue
        if len(set(adaylar_pid)) > 1:
            sp.quarantine_flags = merge_flags(
                tuple(sp.quarantine_flags or []), link_flags(multiple_match=True)
            )
            continue
        pid = adaylar_pid[0]
        if pid in bagli_urunler:
            sp.quarantine_flags = merge_flags(
                tuple(sp.quarantine_flags or []),
                link_flags(product_already_linked=True),
            )
            continue
        sp.product_id = pid
        sp.link_source = "AUTO"
        sp.linked_at = simdi
        bagli_urunler.add(pid)
        sayi += 1

    await db.flush()
    return sayi


# ══════════════════ Fiyat senkronu ══════════════════


async def sync_prices(
    db: AsyncSession, supplier: Supplier, client: SupplierClient
) -> SyncReport:
    """Favori ürünlerin maliyetini tazeler (100'lük batch, D-3 hesabı)."""
    supplier_id = supplier.id
    dis_idler = list(
        (
            await db.execute(
                select(SupplierProduct.external_id).where(
                    SupplierProduct.supplier_id == supplier_id,
                    SupplierProduct.is_favorite.is_(True),
                )
            )
        ).scalars().all()
    )
    await db.commit()  # D-9

    rapor = SyncReport(scope="price")
    if not dis_idler:
        supplier.last_price_sync_ok_at = _now()
        supplier.next_price_sync_at = _now() + datetime.timedelta(
            seconds=int(supplier.price_interval_seconds)
        )
        await db.commit()
        return rapor

    try:
        fiyatlar = await client.fetch_prices(dis_idler)
    except Exception as exc:  # noqa: BLE001
        await _note_failure(db, supplier, exc)
        raise

    simdi = _now()
    satirlar = (
        await db.execute(
            select(SupplierProduct).where(
                SupplierProduct.supplier_id == supplier_id,
                SupplierProduct.external_id.in_(list(fiyatlar)),
            )
        )
    ).scalars().all()

    for sp in satirlar:
        fiyat = fiyatlar.get(sp.external_id)
        if fiyat is None:
            continue
        maliyet = compute_cost(fiyat)
        sp.cost_net = maliyet.net
        sp.cost_gross = maliyet.gross
        sp.cost_breakdown_name = maliyet.breakdown_name
        sp.list_price = fiyat.base if fiyat.base is not None else sp.list_price
        if fiyat.vat_rate is not None:
            sp.vat_rate = fiyat.vat_rate
        sp.currency_ok = fiyat.currency_id in (None, 1)
        sp.campaign = fiyat.campaign
        sp.price_synced_at = simdi
        # Ürün bayraklarını KORU, fiyat bayraklarını tazele.
        urun_bayraklari = tuple(
            b for b in (sp.quarantine_flags or []) if b not in _FIYAT_BAYRAKLARI
        )
        sp.quarantine_flags = merge_flags(
            urun_bayraklari, price_flags(fiyat, maliyet)
        )
        rapor.priced += 1

    _note_success(supplier)
    supplier.last_price_sync_ok_at = simdi
    supplier.next_price_sync_at = simdi + datetime.timedelta(
        seconds=int(supplier.price_interval_seconds)
    )
    await db.commit()
    return rapor


# ══════════════════ Döngü ══════════════════


async def run_due(db: AsyncSession, *, client_factory=None) -> DueReport:
    """Vadesi gelen işleri koşar. `main._supplier_sync_tick` bunu çağırır.

    `FOR UPDATE SKIP LOCKED`: aynı anda başka bir replika/elle senkron o satırı
    işliyorsa bu tur sessizce atlanır (advisory kilit zaten üst katmanda ama
    satır kilidi elle senkron yolunu da kapsar).
    """
    fabrika = client_factory or build_client
    rapor = DueReport()
    simdi = _now()

    tedarikciler = (
        await db.execute(
            select(Supplier)
            .where(Supplier.deleted_at.is_(None), Supplier.is_enabled.is_(True))
            .with_for_update(skip_locked=True)
        )
    ).scalars().all()

    for sup in tedarikciler:
        if not sup.api_token:
            rapor.skipped_disabled += 1
            continue
        if sup.cooldown_until is not None and sup.cooldown_until > simdi:
            rapor.skipped_cooldown += 1
            continue

        stok_vadesi = sup.next_stock_sync_at is None or sup.next_stock_sync_at <= simdi
        fiyat_vadesi = sup.next_price_sync_at is None or sup.next_price_sync_at <= simdi
        if not (stok_vadesi or fiyat_vadesi):
            continue

        istemci = fabrika(sup)
        try:
            await _token_tazele(db, sup, istemci)
            if stok_vadesi:
                await sync_stock(db, sup, istemci)
                rapor.ran_stock += 1
            if fiyat_vadesi:
                await sync_prices(db, sup, istemci)
                rapor.ran_price += 1
        except SupplierError:
            # `_note_failure` zaten yazdı ve commit etti; döngü diğer
            # tedarikçilerle devam eder (`main._run_job` deseni).
            rapor.failed += 1
        except Exception:  # noqa: BLE001
            logger.exception("tedarikçi senkronu beklenmeyen hata (id=%s)", sup.id)
            rapor.failed += 1
    return rapor


async def _token_tazele(
    db: AsyncSession, supplier: Supplier, client: SupplierClient
) -> None:
    """Vadesi yaklaşan token'ı kayan pencereyle uzatır.

    Günde en çok bir kez: `jti` değişmediği için her turda çağırmak kazanç
    getirmez, yalnız origin'e fazladan istek atar.
    """
    bitis = supplier.token_expires_at
    if bitis is None:
        return
    simdi = _now()
    kalan = bitis - simdi
    if kalan > datetime.timedelta(days=settings.SUPPLIER_TOKEN_REFRESH_DAYS):
        return
    if (
        supplier.token_refreshed_at is not None
        and (simdi - supplier.token_refreshed_at) < datetime.timedelta(days=1)
    ):
        return
    yeni, yeni_bitis = await client.refresh_token()
    supplier.api_token = yeni
    supplier.token_updated_at = simdi
    supplier.token_refreshed_at = simdi
    supplier.token_expires_at = yeni_bitis
    await db.commit()


# ══════════════════ Elle senkron ══════════════════


async def sync_now(
    db: AsyncSession,
    admin,
    supplier: Supplier,
    *,
    scope: str = "stock",
    client: SupplierClient | None = None,
) -> SyncReport:
    """"Şimdi senkronla" — inline koşar, sonucu döndürür.

    Cooldown'u YOK SAYAR: cooldown otomatik döngüyü durdurmak içindir,
    yöneticinin bilinçli isteğini değil — "şimdi dene" düğmesinin anlamı budur.
    Hata yine kaydedilir.

    Kilit: döngüyle aynı advisory anahtarı. İkisi aynı anda tararsa aynı
    satırlar iki kez upsert edilmeye çalışılır ve otomatik bağlama yarışır.
    """
    if not supplier.is_enabled:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Tedarikçi kapalı — önce ayarlardan etkinleştirin",
        )
    if not supplier.api_token:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "API token girilmemiş — senkron çalıştırılamaz",
        )

    alindi = await db.scalar(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY})
    if not alindi:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Senkron zaten çalışıyor — birkaç saniye sonra tekrar deneyin",
        )
    try:
        istemci = client or build_client(supplier)
        if scope == "price":
            rapor = await sync_prices(db, supplier, istemci)
        elif scope == "both":
            rapor = await sync_stock(db, supplier, istemci)
            fiyat = await sync_prices(db, supplier, istemci)
            rapor.priced = fiyat.priced
            rapor.scope = "both"
        else:
            rapor = await sync_stock(db, supplier, istemci)
        await audit_service.record(
            db,
            actor=admin,
            action="supplier.sync_now",
            target_type="supplier",
            target_id=supplier.id,
            meta={"scope": scope, **rapor.as_dict()},
        )
        await db.commit()
        return rapor
    finally:
        await db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})


# ══════════════════ Ayarlar ══════════════════


async def update_settings(db: AsyncSession, admin, supplier: Supplier, payload):
    """Ayarları gerekçeli ve audit'li günceller.

    Token audit'e **değeri** ile yazılmaz; yalnız "girildi mi" ve uzunluğu
    kaydedilir (D-5). Audit kaydı kalıcıdır ve okunabilir — sırrın oraya
    düşmesi, tek bir yanlış SELECT'le ifşa demektir.
    """
    once = {
        "is_enabled": supplier.is_enabled,
        "stock_interval_seconds": supplier.stock_interval_seconds,
        "price_interval_seconds": supplier.price_interval_seconds,
        "token_set": bool(supplier.api_token),
    }

    veriler = payload.model_dump(exclude_unset=True)
    gerekce = veriler.pop("reason", None)
    yeni_token = veriler.pop("api_token", None)

    for alan, deger in veriler.items():
        # Açıkça `null` gönderilen alan ATLANIR. `exclude_unset` "gönderilmedi"
        # ile "null gönderildi"yi ayırır; ikincisi bu şemada anlamlı değildir
        # (hiçbiri nullable kolon) ve `name: null` NOT NULL ihlaliyle 500
        # üretirdi. Silme niyeti varsa ayrı bir uç gerekir.
        if deger is None:
            continue
        setattr(supplier, alan, deger)

    simdi = _now()
    if yeni_token:
        supplier.api_token = yeni_token
        supplier.token_updated_at = simdi
        supplier.token_expires_at = decode_token_expiry(yeni_token)
        supplier.token_refreshed_at = None
        # Yeni token, eski "yetki reddedildi" hatasını geçersiz kılar.
        _note_success(supplier)

    if supplier.is_enabled and supplier.api_token:
        # Ayar değişince bir sonraki tur HEMEN koşsun: yönetici aralığı
        # 1 dakikaya çekip 6 saat beklemek zorunda kalmamalı.
        supplier.next_stock_sync_at = simdi
        if supplier.next_price_sync_at is None:
            supplier.next_price_sync_at = simdi

    sonra = {
        "is_enabled": supplier.is_enabled,
        "stock_interval_seconds": supplier.stock_interval_seconds,
        "price_interval_seconds": supplier.price_interval_seconds,
        "token_set": bool(supplier.api_token),
        "token_len": len(supplier.api_token or ""),
    }
    await audit_service.record(
        db,
        actor=admin,
        action="supplier.settings_update",
        target_type="supplier",
        target_id=supplier.id,
        reason=gerekce,
        before=once,
        after=sonra,
    )
    await db.flush()
    return supplier


# ══════════════════ Elle bağlama / çözme ══════════════════


async def link_manual(
    db: AsyncSession, admin, sp: SupplierProduct, *, product_id: int, reason: str
) -> SupplierProduct:
    urun = await db.get(Product, product_id)
    if urun is None or urun.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ürün bulunamadı")
    if urun.kind != ProductKind.PHYSICAL.value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Dijital ürün tedarikçiden temin edilemez",
        )
    if sp.product_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Bu tedarikçi kaydı zaten bir ürüne bağlı"
        )

    mevcut = await db.scalar(
        select(SupplierProduct.id).where(
            SupplierProduct.supplier_id == sp.supplier_id,
            SupplierProduct.product_id == product_id,
        )
    )
    if mevcut is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu ürün aynı tedarikçide başka bir kayda bağlı",
        )

    sp.product_id = product_id
    sp.link_source = "MANUAL"
    sp.linked_at = _now()
    sp.linked_by_admin_id = admin.id
    # Eşleştirme bayrakları artık geçersiz.
    sp.quarantine_flags = [
        b
        for b in (sp.quarantine_flags or [])
        if b not in {"COKLU_ESLESME", "URUN_ZATEN_BAGLI"}
    ]
    await audit_service.record(
        db,
        actor=admin,
        action="supplier_product.link",
        target_type="supplier_product",
        target_id=sp.id,
        reason=reason,
        after={"product_id": product_id, "link_source": "MANUAL"},
    )
    await db.flush()
    return sp


async def unlink(
    db: AsyncSession, admin, sp: SupplierProduct, *, reason: str
) -> SupplierProduct:
    once = {"product_id": sp.product_id, "link_source": sp.link_source}
    sp.product_id = None
    sp.link_source = None
    sp.linked_at = None
    sp.linked_by_admin_id = None
    await audit_service.record(
        db,
        actor=admin,
        action="supplier_product.unlink",
        target_type="supplier_product",
        target_id=sp.id,
        reason=reason,
        before=once,
        after={"product_id": None, "link_source": None},
    )
    await db.flush()
    return sp


# ══════════════════ Okuma yardımcıları ══════════════════


async def availability_map(
    db: AsyncSession, product_ids: list[int]
) -> dict[int, Decimal]:
    """{product_id: tedarikçi stoğu} — TEK sorgu.

    `column_property` ya da ilişki gezmek bilinçli olarak KULLANILMIYOR: ilki
    her `select(Product)`'a gizli bir alt sorgu ekler, ikincisi async oturumda
    lazy-load (`MissingGreenlet`) demektir. Çağıran listeyi topluca sorar.
    """
    if not product_ids:
        return {}
    satirlar = (
        await db.execute(
            select(SupplierProduct.product_id, SupplierProduct.stock_qty)
            .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
            .where(
                SupplierProduct.product_id.in_(product_ids),
                SupplierProduct.is_favorite.is_(True),
                Supplier.is_enabled.is_(True),
                Supplier.deleted_at.is_(None),
            )
        )
    ).all()
    out: dict[int, Decimal] = {}
    for pid, qty in satirlar:
        # Aynı ürün birden çok tedarikçiye bağlanabilir (ileride): en yükseği.
        d = Decimal(str(qty or 0))
        if d > out.get(pid, Decimal("0")):
            out[pid] = d
    return out


async def admin_info_map(
    db: AsyncSession, product_ids: list[int]
) -> dict[int, SupplierProduct]:
    """{product_id: SupplierProduct} — yalnız YÖNETİM yollarında kullanılır.

    Maliyet ve marj taşır; public yanıta konması D-6 ihlalidir.
    """
    if not product_ids:
        return {}
    satirlar = (
        await db.execute(
            select(SupplierProduct)
            .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
            .where(
                SupplierProduct.product_id.in_(product_ids),
                Supplier.deleted_at.is_(None),
            )
            .order_by(SupplierProduct.id)
        )
    ).scalars().all()
    return {sp.product_id: sp for sp in satirlar if sp.product_id is not None}


async def health_snapshot(db: AsyncSession, *, verbose: bool | None = None) -> dict:
    """`/health` → `supplier_sync`.

    503 vermez (bkz. `main._check_supplier`): tedarikçi verisi bayatladığında
    sitenin kendi stoğu hâlâ satılıyor ve konteyneri yeniden başlatmak hiçbir
    şeyi düzeltmez.
    """
    if verbose is None:
        verbose = not settings.is_production

    # ETKİN tedarikçiler sorulur, "ilk satır" DEĞİL: `order_by(id).limit(1)`
    # ile ilk satırı almak, kapalı bir kayıt listenin başındayken etkin olanın
    # arızasını gizlerdi (ve tersi). Soru "senkron sağlıklı mı"dır; kapalı bir
    # kaydın sağlığı diye bir şey yoktur.
    etkinler = (
        await db.execute(
            select(Supplier)
            .where(Supplier.deleted_at.is_(None), Supplier.is_enabled.is_(True))
            .order_by(Supplier.id)
        )
    ).scalars().all()

    if not etkinler:
        return {"enabled": False, "status": "disabled", "degraded": False}
    # Bugün sağlayıcı başına tek aktif satır var; birden çok olursa EN KÖTÜ
    # durum raporlanır — biri bozukken "ok" demek, alarmı susturmaktır.
    sup = etkinler[0]

    simdi = _now()
    durum = "ok"
    if sup.cooldown_until is not None and sup.cooldown_until > simdi:
        durum = "down"
    elif sup.last_stock_sync_ok_at is None:
        durum = "stale"
    else:
        esik = datetime.timedelta(
            seconds=int(sup.stock_interval_seconds) * settings.SUPPLIER_STALE_FACTOR
        )
        if simdi - sup.last_stock_sync_ok_at > esik:
            durum = "stale"

    out = {
        "enabled": True,
        "status": durum,
        "degraded": durum != "ok",
        "last_ok_at": (
            sup.last_stock_sync_ok_at.isoformat()
            if sup.last_stock_sync_ok_at
            else None
        ),
    }
    if verbose and sup.last_error:
        # `/health` kimlik doğrulamasız public bir uçtur; üretimde serbest
        # metin DÖNMEZ (`core/routing.health_snapshot` ile aynı disiplin).
        out["last_error"] = sup.last_error
    return out
