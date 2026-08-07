"""Sunucu taraflı fatura üretimi — e-Arşiv formatına HAZIR, hiçbir dış servise BAĞLI DEĞİL.

## Bu modül ne DEĞİLDİR

* **e-Arşiv entegrasyonu değildir.** Hiçbir entegratöre (Nilvera/Paraşüt vb.)
  bağlanmaz, hiçbir dış istek atmaz. Ürettiği yapı böyle bir entegrasyona
  beslenebilecek alanları taşır, o kadar.
* **Resmî fatura numarası üretmez.** Seri-sıra mantığı bir mevzuat kararıdır
  ve ayrı bir iştir; burada yalnız `order_id` referans olarak döner.
* **Vergi mevzuatı yorumu değildir.** Oranlar veri olarak girilir; bu modül
  yalnız saklanmış kırılımı okur ve biçimlendirir.

## Neden yeniden hesaplamıyor

Kırılım sipariş anında hesaplanıp `orders` tablosuna SAKLANIR. Fatura onu
okur; ürünün bugünkü oranına bakmaz. Aksi hâlde bir ürünün oranı değiştiği
gün, aylar önce kesilmiş faturalar da değişirdi.

## Reddetme kuralları (hepsi 409, biri 404)

Fatura üretmek bir iddiada bulunmaktır; eksik veriyle iddia edilmez:

* Bayrak kapalı → **404** (403 ucun varlığını sızdırırdı).
* Sipariş sahibinin değil / yok → **404** (IDOR deseni: "yok" ile "senin
  değil" ayırt edilemez).
* Ödenmemiş sipariş → **409**: belge ödeme bilgisi taşır (sağlayıcı + tarih).
* Kırılım hesaplanmamış (İP-5 öncesi sipariş — S-4 gereği backfill YOK) → **409**.
* Kargo ücreti alınmış ama oranı belirlenmemiş (`SHIPPING_TAX_RATE` boş) →
  **409**: `Σ(matrah+vergi)` sipariş toplamını tutmaz, yani belge kendi
  içinde tutarsız olurdu.
* Satıcı kimliği eksik yapılandırılmış → **409**.
"""
from __future__ import annotations

import dataclasses
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.store import Order, OrderReturn, OrderReturnItem
from services import tax

CENT = Decimal("0.01")

#: Satıcı kimliğinin ZORUNLU alanları (ayar adı → faturadaki alan adı).
#: Telefon ve vergi dairesi de listede: mesafeli satışta satıcı kimliği
#: eksiksiz olmalıdır ve "boşsa yazma" davranışı burada yanlış olurdu —
#: eksik satıcı bilgisiyle üretilmiş bir belge, hiç üretilmemiş olmasından
#: kötüdür (kullanıcı onu geçerli sanır).
_ZORUNLU_SATICI_ALANLARI = {
    "INVOICE_SELLER_NAME": "name",
    "INVOICE_SELLER_TAX_NUMBER": "tax_number",
    "INVOICE_SELLER_TAX_OFFICE": "tax_office",
    "INVOICE_SELLER_ADDRESS": "address",
    "INVOICE_SELLER_PHONE": "phone",
    "INVOICE_SELLER_EMAIL": "email",
}


@dataclasses.dataclass(frozen=True)
class IadeVergisi:
    """Bir siparişten İADE EDİLEN tutarların matrah/vergi kırılımı."""

    net_total: Decimal
    tax_total: Decimal
    breakdown: list[dict]


def _satici_kimligi() -> dict:
    eksik = [
        ad
        for ad in _ZORUNLU_SATICI_ALANLARI
        if not (getattr(settings, ad, None) or "").strip()
    ]
    if eksik:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Fatura kesilemiyor: satıcı bilgileri eksik ("
            + ", ".join(sorted(eksik))
            + ")",
        )
    return {
        alan: getattr(settings, ad).strip()
        for ad, alan in _ZORUNLU_SATICI_ALANLARI.items()
    }


async def refunded_breakdown(db: AsyncSession, order_id: int) -> IadeVergisi:
    """İade edilen tutarların oran bazında kırılımı — TÜRETİLİR, saklanmaz.

    İki kaynak vardır ve ikisi de snapshot okur:

    1. **RMA (`order_returns`)** — kalem bazlı. `OrderReturnItem.amount` NET
       tutardır (kupon payı düşülmüş, İP-2a sözleşmesi) ve oran kalemin kendi
       `order_items.tax_rate` snapshot'ından gelir. Kargo iadesi
       (`shipping_refund`) siparişin `shipping_tax_rate`'i ile ayrıştırılır.
    2. **Tam iptal/iade** (RMA'sız; `orders.refunded_amount` dolu ama iade
       talebi yok — ör. yönetici iadesi ya da oversell) — bu durumda siparişin
       kırılımının TAMAMI geri dönmüştür.

    Yalnız sağlayıcıda KESİNLEŞMİŞ iadeler sayılır (`refund_status =
    'REFUNDED'`): henüz uçuşta olan bir iadeyi faturaya yazmak, para dönmeden
    dönmüş göstermek olurdu.
    """
    order = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(Order.id == order_id)
        )
    ).scalar_one_or_none()
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")

    oran_by_item = {it.id: Decimal(str(it.tax_rate or 0)) for it in order.items}

    satirlar: list[dict] = []
    kesinlesmis = (
        await db.execute(
            select(OrderReturn).where(
                OrderReturn.order_id == order_id,
                OrderReturn.refund_status == "REFUNDED",
            )
        )
    ).scalars().all()

    kargo_orani = (
        None
        if order.shipping_tax_rate is None
        else Decimal(str(order.shipping_tax_rate))
    )
    rma_toplami = Decimal("0.00")
    for ret in kesinlesmis:
        kalemler = (
            await db.execute(
                select(OrderReturnItem).where(OrderReturnItem.return_id == ret.id)
            )
        ).scalars().all()
        for k in kalemler:
            tutar = Decimal(str(k.amount or 0))
            if tutar <= 0:
                continue
            satirlar.append(
                {"amount": tutar, "tax_rate": oran_by_item.get(k.order_item_id, 0)}
            )
        kargo = Decimal(str(ret.shipping_refund or 0))
        if kargo > 0 and kargo_orani is not None:
            satirlar.append({"amount": kargo, "tax_rate": kargo_orani})
        rma_toplami += Decimal(str(ret.refund_amount or 0))

    iade_edilen = Decimal(str(order.refunded_amount or 0))
    if iade_edilen > 0 and rma_toplami <= 0:
        # RMA'sız iade → siparişin tamamı döndü. Kırılımı saklanan kırılımdır;
        # kalem kalem yeniden bölmek aynı sayıyı üretir ama gereksiz bir
        # ikinci hesap yolu açardı (iki yol = zamanla iki farklı sonuç).
        if order.tax_breakdown:
            kirilim = [
                {
                    "rate": s["rate"],
                    "base": Decimal(str(s["base"])),
                    "tax": Decimal(str(s["tax"])),
                }
                for s in order.tax_breakdown
            ]
            return IadeVergisi(
                net_total=sum((s["base"] for s in kirilim), Decimal("0.00")),
                tax_total=sum((s["tax"] for s in kirilim), Decimal("0.00")),
                breakdown=kirilim,
            )

    sonuc = tax.refund_breakdown(satirlar)
    return IadeVergisi(
        net_total=sonuc.net_total,
        tax_total=sonuc.tax_total,
        breakdown=sonuc.breakdown,
    )


async def build_invoice(db: AsyncSession, order_id: int, *, client_id: int) -> dict:
    """Sipariş faturası — sahiplik doğrulanmış, kırılım saklanandan okunmuş."""
    if not settings.INVOICE_ENABLED:
        # Uç YOK gibi davranır: 403 "burada bir fatura ucu var ama sana kapalı"
        # bilgisini sızdırırdı.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bulunamadı")

    order = (
        await db.execute(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.id == order_id,
                # Sahiplik SORGUDA: "yok" ile "senin değil" ayırt edilemez
                # (İP-2a/İP-3 IDOR deseni).
                Order.client_id == client_id,
                Order.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sipariş bulunamadı")

    if order.payment_status != "PAID" or order.paid_at is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Fatura yalnızca ödemesi tamamlanmış sipariş için düzenlenir",
        )
    if not order.tax_breakdown or order.tax_total is None or order.net_total is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Bu siparişin vergi kırılımı kayıtlı değil; fatura düzenlenemiyor",
        )
    if Decimal(str(order.shipping_fee or 0)) > 0 and order.shipping_tax_rate is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Kargo bedelinin KDV oranı tanımlı değil; fatura düzenlenemiyor",
        )

    satici = _satici_kimligi()
    iade = await refunded_breakdown(db, order.id)

    return {
        "order_id": order.id,
        "issued_for": order.created_at,
        "paid_at": order.paid_at,
        "currency": order.currency,
        "seller": satici,
        "buyer": {
            # Dijital-yalnız siparişte adres alanları BOŞTUR ve boş kalır —
            # başka bir kaynaktan türetmek, faturaya uydurma adres yazmak olur.
            # Ad hesap sahibinden düşer (ship_recipient yoksa).
            "name": order.ship_recipient or _hesap_adi(order),
            "phone": order.ship_phone,
            "address": order.ship_address,
            "city": order.ship_city,
            "district": order.ship_district,
        },
        "payment": {
            # Eskiden istemcide "iyzico ile ödeme" SABİT YAZILIYDI: fake
            # sağlayıcıyla ödenmiş bir siparişte bile öyle görünüyordu.
            "provider": order.provider,
            "provider_ref": order.provider_ref,
            "status": order.payment_status,
            "paid_at": order.paid_at,
        },
        "items": [
            {
                "order_item_id": it.id,
                "title": it.title,
                "quantity": it.quantity,
                "unit_price": str(it.unit_price),
                "line_gross": str(
                    (Decimal(str(it.unit_price)) * it.quantity).quantize(CENT)
                ),
                "tax_rate": str(Decimal(str(it.tax_rate or 0))),
                "tax_amount": str(Decimal(str(it.tax_amount or 0))),
            }
            for it in order.items
        ],
        "tax_lines": [
            {"rate": s["rate"], "base": str(s["base"]), "tax": str(s["tax"])}
            for s in order.tax_breakdown
        ],
        "shipping": {
            "fee": str(order.shipping_fee),
            "tax_rate": (
                None
                if order.shipping_tax_rate is None
                else str(Decimal(str(order.shipping_tax_rate)))
            ),
            "tax_amount": (
                None
                if order.shipping_tax_amount is None
                else str(Decimal(str(order.shipping_tax_amount)))
            ),
        },
        "totals": {
            "subtotal": str(order.subtotal),
            "discount": str(order.discount),
            "coupon_code": order.coupon_code,
            "net_total": str(order.net_total),
            "tax_total": str(order.tax_total),
            "grand_total": str(order.total),
        },
        "refund": {
            "refunded_amount": str(order.refunded_amount or 0),
            "net_total": str(iade.net_total),
            "tax_total": str(iade.tax_total),
            "tax_lines": [
                {"rate": s["rate"], "base": str(s["base"]), "tax": str(s["tax"])}
                for s in iade.breakdown
            ],
        },
        "notice": (
            "Bu belge sipariş kayıtlarından üretilmiştir. Resmî e-Arşiv "
            "faturası ayrıca düzenlenir."
        ),
    }


def _hesap_adi(order: Order) -> str | None:
    """Alıcı adı için yedek: adres kaydında alıcı yoksa hesap sahibi."""
    musteri = getattr(order, "client", None)
    return getattr(musteri, "full_name", None) if musteri is not None else None


async def eksik_kirilim_sayisi(db: AsyncSession) -> dict:
    """Vergi kırılımı EKSİK sipariş sayacı (`GET /store/admin/tax-health`).

    `SHIPPING_TAX_RATE` girildikten sonra "kaç siparişte kırılım eksik kaldı"
    sorusunun cevabı gerekecek; sayaç olmadan bu küme sessizce birikir.
    İki ayrı eksiklik türü ayrı sayılır çünkü çareleri farklıdır: birincisi
    tarihsel (S-4 gereği düzeltilmez), ikincisi ayar girilince yenilerde
    kendiliğinden kapanır.
    """
    row = (
        await db.execute(
            text(
                "SELECT "
                " count(*) FILTER (WHERE tax_breakdown IS NULL) AS kirilimsiz, "
                " count(*) FILTER (WHERE shipping_fee > 0 "
                "                  AND shipping_tax_rate IS NULL) AS kargo_belirsiz, "
                " count(*) AS toplam "
                "FROM orders WHERE deleted_at IS NULL"
            )
        )
    ).one()
    return {
        "orders_total": int(row[2]),
        "missing_breakdown": int(row[0]),
        "shipping_rate_undefined": int(row[1]),
        "shipping_tax_rate_configured": settings.SHIPPING_TAX_RATE is not None,
        "invoice_enabled": settings.INVOICE_ENABLED,
    }


__all__ = ["build_invoice", "eksik_kirilim_sayisi", "refunded_breakdown"]
