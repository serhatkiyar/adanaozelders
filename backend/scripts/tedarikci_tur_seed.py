"""Gerçek tarayıcı turu için veri tohumu — GELİŞTİRME ortamı.

Tur (`frontend/scripts/tedarikci_tur.mjs`) senkronun AĞ ayağını ölçmez;
senkron SONRASI durumun uçtan uca davranışını ölçer. Bu betik o durumu
gerçek tablolara yazar:

* Yıldırım tedarikçi satırı ETKİN (token sahte — ağa çıkılmayacak),
* kendi stoğu 0 ama tedarikçide 7 adet olan, "tedarikçiden temin" AÇIK bir
  ürün (vitrin ayağı),
* bağlanmamış bir favori satırı (panelin "eşleşmemiş" listesi).

Üretimde koşmayı REDDEDER. `--temizle` ile ürettiği her şeyi geri alır.

    cd backend
    python -m scripts.tedarikci_tur_seed
    python -m scripts.tedarikci_tur_seed --temizle
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import sys
from decimal import Decimal

from sqlalchemy import select, text

from core.config import settings
from core.database import AsyncSessionLocal

#: Tohumun imzası — temizlik bunu arar, başka satıra dokunmaz.
ETIKET = "tedarikci-tur"
SLUG = f"{ETIKET}-defter"
#: Geçerli EAN-13 (checksum doğrulanmış).
BARKOD = "8695894110038"
BARKOD_BAGSIZ = "8691217932103"


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _tedarikci(s):
    from models.supplier import Supplier

    sup = (
        await s.execute(
            select(Supplier).where(
                Supplier.provider == "yildirim", Supplier.deleted_at.is_(None)
            )
        )
    ).scalars().first()
    if sup is None:
        sup = Supplier(
            provider="yildirim",
            name="Yıldırım Dağıtım",
            base_url="https://b2b.yildirimdagitim.com/api/vitrin",
        )
        s.add(sup)
        await s.flush()
    sup.is_enabled = True
    # SAHTE token: tur ağa çıkmaz (SUPPLIER_NETWORK_DISABLED açık kalmalı).
    # Gerçek token panelden girilir ve BU BETİKLE ASLA yazılmaz.
    sup.api_token = "eyJhbGciOiJIUzI1NiJ9.TUR-ICIN-SAHTE-TOKEN.imza"
    sup.last_stock_sync_ok_at = _now()
    sup.next_stock_sync_at = _now() + datetime.timedelta(hours=6)
    return sup


async def tohumla() -> None:
    from models.store import Product
    from models.supplier import SupplierProduct

    async with AsyncSessionLocal() as s:
        sup = await _tedarikci(s)

        urun = (
            await s.execute(select(Product).where(Product.slug == SLUG))
        ).scalars().first()
        if urun is None:
            urun = Product(
                slug=SLUG,
                title="Tur Testi · Çınar Okul Defteri A5",
                description="Gerçek tarayıcı turu için tohumlanmış kayıt.",
                kind="PHYSICAL",
                seller_type="PLATFORM",
                price=Decimal("249.90"),
                tax_rate=Decimal("0.20"),
                stock=0,
                status="ACTIVE",
                barcode=BARKOD,
            )
            s.add(urun)
            await s.flush()
        # Kendi stoğu BİLEREK 0: turun ölçtüğü şey "raf boş ama tedarikçide var".
        urun.supplier_backed = True
        urun.status = "ACTIVE"
        # `--temizle` ürünü SOFT siler; yeniden tohumlarken diriltilmeli.
        # Unutulduğunda hata sessizdi: uç 404 döner, tur "vitrin ayağı kaldı"
        # der ve neden görünmez (ilk koşumda tam olarak bu yaşandı).
        urun.deleted_at = None

        bagli = (
            await s.execute(
                select(SupplierProduct).where(
                    SupplierProduct.supplier_id == sup.id,
                    SupplierProduct.external_id == 911001,
                )
            )
        ).scalars().first()
        if bagli is None:
            bagli = SupplierProduct(
                supplier_id=sup.id, external_id=911001, last_seen_at=_now()
            )
            s.add(bagli)
        bagli.external_code = "CINARDEF 11003"
        bagli.name = "ÇINAR OKUL DEFTERİ A5 KARELİ"
        bagli.brand = "ÇINAR"
        bagli.category_path = "KIRTASİYE > DEFTERLER > Okul Defteri"
        bagli.barcode = BARKOD
        bagli.barcode_valid = True
        bagli.unit_name = "Düzine"
        bagli.unit_multiplier = Decimal("1")
        bagli.stock_qty = Decimal("7")
        bagli.stockless = False
        bagli.list_price = Decimal("208.38")
        bagli.vat_rate = Decimal("0.10")
        bagli.cost_net = Decimal("153.00")
        bagli.cost_gross = Decimal("168.30")
        bagli.cost_breakdown_name = "PEŞİN"
        bagli.quarantine_flags = ["BIRIM_ADET_DEGIL"]
        bagli.product_id = urun.id
        bagli.link_source = "AUTO"
        bagli.linked_at = _now()
        bagli.is_favorite = True
        bagli.last_seen_at = _now()
        bagli.stock_synced_at = _now()
        bagli.price_synced_at = _now()

        bagsiz = (
            await s.execute(
                select(SupplierProduct).where(
                    SupplierProduct.supplier_id == sup.id,
                    SupplierProduct.external_id == 911002,
                )
            )
        ).scalars().first()
        if bagsiz is None:
            bagsiz = SupplierProduct(
                supplier_id=sup.id, external_id=911002, last_seen_at=_now()
            )
            s.add(bagsiz)
        bagsiz.external_code = "MAS 9321"
        bagsiz.name = "MAS BİON OFİS MAKASI 20 CM"
        bagsiz.brand = "MAS BION"
        bagsiz.category_path = "KIRTASİYE > OFİS ÜRÜNLERİ > Makaslar"
        bagsiz.barcode = BARKOD_BAGSIZ
        bagsiz.barcode_valid = True
        bagsiz.unit_name = "Adet"
        bagsiz.unit_multiplier = Decimal("1")
        bagsiz.stock_qty = Decimal("62")
        bagsiz.stockless = False
        bagsiz.list_price = Decimal("44.90")
        bagsiz.vat_rate = Decimal("0.20")
        bagsiz.cost_net = Decimal("51.02")
        bagsiz.cost_gross = Decimal("61.23")
        bagsiz.cost_breakdown_name = "PEŞİN"
        bagsiz.quarantine_flags = []
        bagsiz.product_id = None
        bagsiz.link_source = None
        bagsiz.is_favorite = True
        bagsiz.last_seen_at = _now()
        bagsiz.stock_synced_at = _now()

        await s.commit()
        print(f"tohum hazır — ürün slug: {SLUG} (id={urun.id}), tedarikçi id={sup.id}")
        print("  bağlı satır: ÇINARDEF 11003 (7 düzine) · bağsız: MAS 9321")


async def temizle() -> None:
    from models.store import Product

    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "DELETE FROM supplier_products WHERE external_id IN (911001, 911002)"
            )
        )
        urun = (
            await s.execute(select(Product).where(Product.slug == SLUG))
        ).scalars().first()
        if urun is not None:
            # Defter append-only; ürün SOFT silinir (üretim yolunun aynısı).
            urun.deleted_at = _now()
            urun.status = "HIDDEN"
            urun.supplier_backed = False
        await s.execute(
            text(
                "UPDATE suppliers SET is_enabled = false, api_token = NULL "
                "WHERE provider = 'yildirim'"
            )
        )
        await s.commit()
        print("tohum temizlendi (ürün soft-delete edildi, tedarikçi kapatıldı)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--temizle", action="store_true")
    a = ap.parse_args()

    if settings.is_production:
        print("REDDEDİLDİ: bu betik üretimde koşamaz (sahte token yazıyor).")
        return 2

    # ── AĞ GUARD'I — bu kontrol GERÇEK BİR OLAYDAN sonra eklendi ──
    #
    # Betik tedarikçiyi ETKİN + SAHTE TOKEN'lı bırakıyor. Arka plan döngüsü
    # `next_price_sync_at IS NULL` gördüğü an fiyat turunu koşuyor ve
    # `SUPPLIER_NETWORK_DISABLED` kapalıyken bu, Yıldırım'ın CANLI sunucusuna
    # geçersiz token'lı bir istek demektir. Bir kez oldu: uygulama açıldıktan
    # ~19 saniye sonra `POST /fiyat` gitti (200 döndü).
    #
    # Zararsız bir okumaydı ama izinsiz bir dış istekti. Guard artık şart:
    # tohum yalnız ağ KAPALIYKEN atılabilir.
    if not a.temizle and not settings.SUPPLIER_NETWORK_DISABLED:
        print(
            "REDDEDİLDİ: SUPPLIER_NETWORK_DISABLED kapalı.\n\n"
            "Bu betik tedarikçiyi ETKİN + SAHTE token'lı bırakır; arka plan\n"
            "döngüsü o token'la Yıldırım'ın CANLI sunucusuna istek atar.\n\n"
            "Şöyle koşun:\n"
            "  SUPPLIER_NETWORK_DISABLED=True python -m scripts.tedarikci_tur_seed\n"
            "ve uygulamayı da AYNI değişkenle açın."
        )
        return 2

    asyncio.run(temizle() if a.temizle else tohumla())
    return 0


if __name__ == "__main__":
    sys.exit(main())
