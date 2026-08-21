"""Tedarikçi senkronu — yönetim uçları.

Yetki: `suppliers.view` / `suppliers.manage`. `products.*` bilinçli olarak
yeniden kullanılmadı — gerekçesi `core/admin_permissions.py` ve sözleşme §3.

Yol ön eki `/store/admin/suppliers`: panelde Mağaza sekmesinin altında yaşıyor
ve `frontend/.../adminNavigation.ts` `/yonetim/magaza/` önekini o gruba
bağlıyor. Ayrı bir router dosyası olmasının nedeni `api/routers/store.py`'nin
zaten 1500+ satır olması.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, require_admin_permission
from core.suppliers.base import SupplierError, SupplierUnavailable
from models.admin import Admin
from models.store import Product
from models.supplier import Supplier, SupplierProduct
from schemas.supplier import (
    LinkedProductBrief,
    LinkIn,
    SupplierOut,
    SupplierProductOut,
    SupplierSettingsIn,
    SyncIn,
    SyncReportOut,
    UnlinkIn,
)
from services import supplier_sync_service

router = APIRouter(prefix="/store/admin/suppliers", tags=["suppliers"])


async def _tedarikci(db: AsyncSession, supplier_id: int) -> Supplier:
    sup = await db.get(Supplier, supplier_id)
    if sup is None or sup.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tedarikçi bulunamadı")
    return sup


async def _cikti(db: AsyncSession, sup: Supplier) -> SupplierOut:
    """`SupplierOut` + panelin ihtiyaç duyduğu iki sayaç.

    Sayaçlar SUNUCUDA hesaplanır: 11.915 satırlık bir katalogda istemcinin
    listeyi çekip sayması kabul edilemez.
    """
    bagli = await db.scalar(
        select(func.count())
        .select_from(SupplierProduct)
        .where(
            SupplierProduct.supplier_id == sup.id,
            SupplierProduct.product_id.isnot(None),
        )
    )
    eslesmemis = await db.scalar(
        select(func.count())
        .select_from(SupplierProduct)
        .where(
            SupplierProduct.supplier_id == sup.id,
            SupplierProduct.product_id.is_(None),
            SupplierProduct.is_favorite.is_(True),
        )
    )
    return SupplierOut(
        id=sup.id,
        provider=sup.provider,
        name=sup.name,
        is_enabled=sup.is_enabled,
        base_url=sup.base_url,
        # D-5: token'ın DEĞERİ değil, VARLIĞI.
        has_token=bool(sup.api_token),
        token_expires_at=sup.token_expires_at,
        stock_interval_seconds=sup.stock_interval_seconds,
        price_interval_seconds=sup.price_interval_seconds,
        next_stock_sync_at=sup.next_stock_sync_at,
        next_price_sync_at=sup.next_price_sync_at,
        last_stock_sync_ok_at=sup.last_stock_sync_ok_at,
        last_price_sync_ok_at=sup.last_price_sync_ok_at,
        last_error=sup.last_error,
        last_error_at=sup.last_error_at,
        consecutive_failures=sup.consecutive_failures,
        cooldown_until=sup.cooldown_until,
        last_sync_stats=sup.last_sync_stats,
        linked_count=int(bagli or 0),
        unmatched_count=int(eslesmemis or 0),
    )


def _sp_cikti(sp: SupplierProduct, urun: Product | None) -> SupplierProductOut:
    return SupplierProductOut(
        id=sp.id,
        external_id=sp.external_id,
        external_code=sp.external_code,
        name=sp.name,
        brand=sp.brand,
        category_path=sp.category_path,
        barcode=sp.barcode,
        barcode_valid=sp.barcode_valid,
        unit_name=sp.unit_name,
        stock_qty=str(sp.stock_qty),
        stockless=sp.stockless,
        list_price=(str(sp.list_price) if sp.list_price is not None else None),
        cost_net=(str(sp.cost_net) if sp.cost_net is not None else None),
        cost_gross=(str(sp.cost_gross) if sp.cost_gross is not None else None),
        cost_breakdown_name=sp.cost_breakdown_name,
        vat_rate=sp.vat_rate,
        currency_ok=sp.currency_ok,
        campaign=sp.campaign,
        quarantine_flags=list(sp.quarantine_flags or []),
        image_url=sp.image_url,
        product_id=sp.product_id,
        product=(
            LinkedProductBrief(
                id=urun.id,
                title=urun.title,
                sku=urun.sku,
                price=str(urun.price),
                stock=urun.stock,
                supplier_backed=bool(urun.supplier_backed),
            )
            if urun is not None
            else None
        ),
        # Ürün fiziksel silinince FK `product_id`'yi NULL'lar ama `link_source`
        # 'AUTO' kalır (kısıt bilinçli olarak tek yönlü — bkz. models/supplier).
        # Panelde "kaynak: AUTO ama ürün yok" göstermek kafa karıştırırdı:
        # bağ yoksa kaynak da yoktur.
        link_source=(sp.link_source if sp.product_id is not None else None),
        linked_at=(sp.linked_at if sp.product_id is not None else None),
        is_favorite=sp.is_favorite,
        unfavorited_at=sp.unfavorited_at,
        stock_synced_at=sp.stock_synced_at,
        price_synced_at=sp.price_synced_at,
    )


@router.get("", response_model=list[SupplierOut])
async def list_suppliers(
    _admin: Admin = Depends(require_admin_permission("suppliers.view")),
    db: AsyncSession = Depends(get_db),
):
    kayitlar = (
        await db.execute(
            select(Supplier).where(Supplier.deleted_at.is_(None)).order_by(Supplier.id)
        )
    ).scalars().all()
    return [await _cikti(db, s) for s in kayitlar]


@router.patch("/{supplier_id}", response_model=SupplierOut)
async def update_supplier(
    supplier_id: int,
    payload: SupplierSettingsIn,
    admin: Admin = Depends(require_admin_permission("suppliers.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Ayar güncelleme — gerekçe ZORUNLU, audit'e yazılır (D-10)."""
    sup = await _tedarikci(db, supplier_id)
    await supplier_sync_service.update_settings(db, admin, sup, payload)
    await db.commit()
    return await _cikti(db, sup)


@router.post("/{supplier_id}/sync", response_model=SyncReportOut)
async def sync_supplier(
    supplier_id: int,
    payload: SyncIn,
    admin: Admin = Depends(require_admin_permission("suppliers.manage")),
    db: AsyncSession = Depends(get_db),
):
    """"Şimdi senkronla" — inline koşar, sonucu döndürür.

    Ağ arızası opak 500'e DEĞİL, `Retry-After`'lı 503'e çevrilir: istek
    geçerli, altyapı geçici olarak yok (`RoutingUnavailable` kalıbı). Hata
    metni token taşımaz (`_sanitize_error`), ama yine de gövdeye ayrıntı
    konmaz — yalnız sınıfına göre kısa bir açıklama.
    """
    sup = await _tedarikci(db, supplier_id)
    try:
        rapor = await supplier_sync_service.sync_now(
            db, admin, sup, scope=payload.scope
        )
    except SupplierUnavailable:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Tedarikçi servisine şu anda ulaşılamıyor — birazdan tekrar deneyin",
            headers={"Retry-After": "60"},
        ) from None
    except SupplierError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Tedarikçi yanıtı işlenemedi ({exc.__class__.__name__})",
        ) from None
    except RuntimeError as exc:
        # Ağ guard'ı (`SUPPLIER_NETWORK_DISABLED`). Test ortamının normal hâli;
        # üretimde yapılandırma hatasıdır ve 503 doğru sınıflandırmadır.
        if "SUPPLIER_NETWORK_DISABLED" not in str(exc):
            raise
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Tedarikçi ağ erişimi kapalı",
            headers={"Retry-After": "60"},
        ) from None
    return SyncReportOut(**{
        k: v for k, v in rapor.as_dict().items()
        if k in SyncReportOut.model_fields
    })


@router.get("/{supplier_id}/products", response_model=list[SupplierProductOut])
async def list_supplier_products(
    supplier_id: int,
    response: Response,
    linked: bool | None = Query(default=None),
    flagged: bool | None = Query(default=None),
    favorite_only: bool = Query(default=True),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _admin: Admin = Depends(require_admin_permission("suppliers.view")),
    db: AsyncSession = Depends(get_db),
):
    sup = await _tedarikci(db, supplier_id)

    kosullar = [SupplierProduct.supplier_id == sup.id]
    if favorite_only:
        kosullar.append(SupplierProduct.is_favorite.is_(True))
    if linked is True:
        kosullar.append(SupplierProduct.product_id.isnot(None))
    elif linked is False:
        kosullar.append(SupplierProduct.product_id.is_(None))
    if flagged is True:
        kosullar.append(func.cardinality(SupplierProduct.quarantine_flags) > 0)
    elif flagged is False:
        kosullar.append(func.cardinality(SupplierProduct.quarantine_flags) == 0)
    if q:
        desen = f"%{q.strip()}%"
        kosullar.append(
            SupplierProduct.name.ilike(desen)
            | SupplierProduct.external_code.ilike(desen)
            | SupplierProduct.barcode.ilike(desen)
        )

    toplam = await db.scalar(
        select(func.count()).select_from(SupplierProduct).where(*kosullar)
    )
    satirlar = (
        await db.execute(
            select(SupplierProduct, Product)
            .outerjoin(Product, Product.id == SupplierProduct.product_id)
            .where(*kosullar)
            # Deterministik sıra: eşleşmemişlerde yönetici sayfa sayfa
            # ilerliyor ve sıra kayarsa aynı kaydı iki kez görür ya da hiç
            # görmez.
            .order_by(SupplierProduct.name, SupplierProduct.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    response.headers["X-Total-Count"] = str(int(toplam or 0))
    return [_sp_cikti(sp, urun) for sp, urun in satirlar]


async def _satir(db: AsyncSession, supplier_id: int, sp_id: int) -> SupplierProduct:
    """IDOR kapısı: satır BU tedarikçiye ait değilse 404.

    403 değil 404: "var ama senin değil" bilgisi de sızmamalı.
    """
    sp = await db.get(SupplierProduct, sp_id)
    if sp is None or sp.supplier_id != supplier_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tedarikçi kaydı bulunamadı")
    return sp


@router.post("/{supplier_id}/products/{sp_id}/link", response_model=SupplierProductOut)
async def link_product(
    supplier_id: int,
    sp_id: int,
    payload: LinkIn,
    admin: Admin = Depends(require_admin_permission("suppliers.manage")),
    db: AsyncSession = Depends(get_db),
):
    sup = await _tedarikci(db, supplier_id)
    sp = await _satir(db, sup.id, sp_id)
    await supplier_sync_service.link_manual(
        db, admin, sp, product_id=payload.product_id, reason=payload.reason
    )
    await db.commit()
    urun = await db.get(Product, sp.product_id) if sp.product_id else None
    return _sp_cikti(sp, urun)


@router.post(
    "/{supplier_id}/products/{sp_id}/unlink", response_model=SupplierProductOut
)
async def unlink_product(
    supplier_id: int,
    sp_id: int,
    payload: UnlinkIn,
    admin: Admin = Depends(require_admin_permission("suppliers.manage")),
    db: AsyncSession = Depends(get_db),
):
    sup = await _tedarikci(db, supplier_id)
    sp = await _satir(db, sup.id, sp_id)
    await supplier_sync_service.unlink(db, admin, sp, reason=payload.reason)
    await db.commit()
    return _sp_cikti(sp, None)
