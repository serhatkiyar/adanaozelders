"""F30 paketleme uçları (ADMIN) — sözleşme §6.

## Bu katman ne YAPMAZ

İş mantığı taşımaz. FSM, kilit sırası, idempotency, STALE tespiti, miktar
aritmetiği ve olay defteri `services/packing_service.py`'dedir ve burada
**yeniden uygulanmaz**. Uç beş şey yapar: giriş doğrulama · yetki · servis
çağrısı · yanıt dönüşümü · duruma bağlı yetki yükseltme.

## Yetki ayrımı (görev ayrılığı)

| İzin | Kapsam |
|---|---|
| `packing.view` | Kuyruk, paket listesi/detayı, geri dönüş kuyruğu — **okuma** |
| `packing.pack` | Paket açma · tarama · geri alma · tamamlama · **açık** paketi çözme |
| `packing.manage` | Geri dönüş kabulü (`return-in`) · yeniden paketleme (`repack`) · fiziksel bozma (`unpack`) · **kapanmış** paketi çözme |

Ayrımın sebebi F29'un envanter ayrımıyla aynı: **paketi toplayan kişi onu tek
başına çözemez.** `void` bu yüzden tek bir izne bağlı DEĞİLDİR — paket henüz
`OPEN` iken (kimse ona güvenmiyor) paketleyen kişi vazgeçebilir; `PACKED` ya da
`RETURNED` bir paketi çözmek ise başka birinin kararını iptal etmektir ve
`packing.manage` ister. Karar veriye bağlı olduğu için router'da verilir,
servise sızmaz (F29 `cancel` deseninin aynısı).

Kurye paketleme uçlarının **hiçbirine** erişemez (`require_admin_permission`
Admin olmayan her kullanıcıyı 403'ler); zimmet ayrı bir saha ucudur ve
`delivery.field_router`'dadır.

## Transaction sınırı

`packing_service` fonksiyonları **kendi commit'lerini atar** — `delivery_service`
ile aynı desen (bu iki modül aynı operasyonun iki yüzüdür ve zimmet tek
transaction'da paket + sipariş + durak yazar). Bu yüzden uçlar `commit`
ÇAĞIRMAZ; çift commit no-op olurdu ama sahipliği belirsizleştirirdi. F29
`inventory` router'ı ters deseni (router commit eder) kullanır; iki desenin
sınırı modül sınırıdır ve karıştırılmaz.

Ham DB/servis istisnaları global işleyicilerle doğru HTTP koduna çevrilir;
beklenmeyen hata 500 olarak loglanır ve **409'a kılıflanmaz**.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import require_admin_permission
from core.database import get_db
from models.admin import Admin
from schemas.delivery import EligibleOrderOut
from schemas.packing import (
    MAX_LIMIT,
    MAX_OFFSET,
    HandoverManifestOut,
    PackageItemOut,
    PackageOut,
    PackagePage,
    PackageReturnInIn,
    PackageScanIn,
    PackageScanOut,
    PackageUndoScanIn,
    PackageVoidIn,
    ReturnQueueRowOut,
)
from services import admin_access_service, delivery_service, packing_service

router = APIRouter(prefix="/packing", tags=["packing"])

VIEW = require_admin_permission("packing.view")
PACK = require_admin_permission("packing.pack")
MANAGE = require_admin_permission("packing.manage")


# ════════════════════════ Yanıt dönüşümü ════════════════════════


def _paket(gorunum: packing_service.PackageView) -> PackageOut:
    """İç görünümü DIŞARI verilecek biçime çevirir — alan alan.

    `**dataclasses.asdict()` bilinçli olarak KULLANILMAZ: modele yarın eklenen
    bir alan (ör. bir iç maliyet ya da aktör metni) uçtan sessizce sızardı.
    """
    return PackageOut(
        id=gorunum.id,
        order_id=gorunum.order_id,
        package_no=gorunum.package_no,
        code=gorunum.code,
        status=gorunum.status,
        qr_payload=gorunum.qr_payload,
        items_fingerprint=gorunum.items_fingerprint,
        packed_at=gorunum.packed_at,
        packed_by_admin_id=gorunum.packed_by_admin_id,
        handed_over_at=gorunum.handed_over_at,
        handed_to_courier_id=gorunum.handed_to_courier_id,
        handed_over_by_actor=gorunum.handed_over_by_actor,
        delivered_at=gorunum.delivered_at,
        returned_at=gorunum.returned_at,
        return_note=gorunum.return_note,
        void_at=gorunum.void_at,
        void_reason=gorunum.void_reason,
        unpacked_at=gorunum.unpacked_at,
        created_at=gorunum.created_at,
        items=[
            PackageItemOut(
                id=s.id,
                order_item_id=s.order_item_id,
                product_id=s.product_id,
                sku=s.sku,
                barcode=s.barcode,
                title=s.title,
                expected_qty=s.expected_qty,
                scanned_qty=s.scanned_qty,
                remaining=s.remaining,
            )
            for s in gorunum.items
        ],
    )


def _tarama(sonuc: packing_service.ScanResult) -> PackageScanOut:
    """Tarama yanıtı = iş sonucu + paketin GÜNCEL hâli (tek istekte)."""
    return PackageScanOut(
        **_paket(sonuc.package).model_dump(),
        result=sonuc.result,
        qty_delta=sonuc.qty_delta,
        order_item_id=sonuc.order_item_id,
        replayed=sonuc.replayed,
    )


async def _yonetim_izni_ara(db: AsyncSession, admin: Admin) -> None:
    """`packing.manage` yoksa 403 — duruma bağlı yetki yükseltme.

    Görev ayrılığı veriye bağlı olduğunda (kapanmış paketi çözme) karar
    router'da verilir; serviste verilseydi iş mantığı katmanı izin kataloğunu
    tanımak zorunda kalırdı.
    """
    _role_code, izinler = await admin_access_service.get_admin_access(db, admin.id)
    if "packing.manage" not in izinler:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Kapanmış paketi çözmek için packing.manage izni gerekir",
        )


# ════════════════════════ Okuma ════════════════════════


@router.get("/queue", response_model=list[EligibleOrderOut])
async def packing_queue(
    _admin: Admin = Depends(VIEW),
    db: AsyncSession = Depends(get_db),
):
    """Paketlenecek siparişler — söz gününe göre sıralı.

    Paketi ARAÇTA olan sipariş burada GÖRÜNMEZ (sözleşme §3.5); o kuyruk
    ayrıdır (`/packing/return-queue`), yoksa personel aynı ürünleri ikinci kez
    raftan toplamaya kalkardı.
    """
    return await delivery_service.prep_queue(db)


@router.get("/packages", response_model=PackagePage)
async def list_packages(
    status_filter: str | None = Query(default=None, alias="status", max_length=16),
    order_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0, le=MAX_OFFSET),
    _admin: Admin = Depends(VIEW),
    db: AsyncSession = Depends(get_db),
):
    """Sayfalı paket listesi. Tavan hem burada hem serviste zorlanır."""
    satirlar, toplam = await packing_service.list_packages(
        db, status_filter=status_filter, order_id=order_id, limit=limit, offset=offset
    )
    return PackagePage(
        items=[_paket(g) for g in satirlar], total=toplam, limit=limit, offset=offset
    )


@router.get("/return-queue", response_model=list[ReturnQueueRowOut])
async def return_queue(
    _admin: Admin = Depends(VIEW),
    db: AsyncSession = Depends(get_db),
):
    """Geri dönüşü beklenen paketler — en eskisi başta, "kaç gündür" ile.

    Görünmezlik tek başına tehlikelidir: hiçbir yerde görünmeyen paket kimse
    tarafından aranmaz ve süresiz kaybolur (TB-7).
    """
    return [
        ReturnQueueRowOut(
            package_id=r.package_id,
            package_code=r.package_code,
            order_id=r.order_id,
            courier_id=r.courier_id,
            courier_name=r.courier_name,
            handed_over_at=r.handed_over_at,
            waiting_days=r.waiting_days,
        )
        for r in await packing_service.return_queue(db)
    ]


@router.get("/packages/{package_id}", response_model=PackageOut)
async def get_package(
    package_id: int,
    _admin: Admin = Depends(VIEW),
    db: AsyncSession = Depends(get_db),
):
    return _paket(await packing_service.get_package(db, package_id))


# ════════════════════════ Paketleme ════════════════════════


@router.post("/orders/{order_id}/open", response_model=PackageOut)
async def open_package(
    order_id: int,
    admin: Admin = Depends(PACK),
    db: AsyncSession = Depends(get_db),
):
    """Siparişe paket açar. **İdempotenttir**: depodaki canlı paket olduğu gibi
    döner; araçtaki paket 409 verir ve gövde durumu adıyla söyler."""
    return _paket(await packing_service.open_package(db, order_id, admin_id=admin.id))


@router.post("/packages/{package_id}/scan", response_model=PackageScanOut)
async def scan_item(
    package_id: int,
    payload: PackageScanIn,
    admin: Admin = Depends(PACK),
    db: AsyncSession = Depends(get_db),
):
    """Kalem doğrulama. **Red de 200'dür** (`result` taşır): reddedilen tarama
    bir olaydır ve ize yazılabilmesi için transaction commit edilmelidir."""
    return _tarama(
        await packing_service.scan(
            db,
            package_id,
            code=payload.code,
            admin_id=admin.id,
            manual=payload.manual,
            manual_reason=payload.manual_reason,
            order_item_id=payload.order_item_id,
            idempotency_key=payload.idempotency_key,
        )
    )


@router.post("/packages/{package_id}/undo-scan", response_model=PackageScanOut)
async def undo_scan(
    package_id: int,
    payload: PackageUndoScanIn,
    admin: Admin = Depends(PACK),
    db: AsyncSession = Depends(get_db),
):
    """Gerekçeli düzeltme. `idempotency_key` önerilir — geri alma
    durum-idempotan değildir, ağ tekrarı adedi iki kez düşürür (§7 S7)."""
    return _tarama(
        await packing_service.undo_scan(
            db,
            package_id,
            order_item_id=payload.order_item_id,
            admin_id=admin.id,
            reason=payload.reason,
            idempotency_key=payload.idempotency_key,
        )
    )


@router.post("/packages/{package_id}/complete", response_model=PackageOut)
async def complete_package(
    package_id: int,
    admin: Admin = Depends(PACK),
    db: AsyncSession = Depends(get_db),
):
    """Paketi kapatır: bütün kalemler doğrulanmışsa `PACKED` + `prepared_at`.
    Eksik kalem 409, kalem listesi değişmişse 409 (STALE)."""
    return _paket(await packing_service.complete(db, package_id, admin_id=admin.id))


@router.post("/packages/{package_id}/void", response_model=PackageOut)
async def void_package(
    package_id: int,
    payload: PackageVoidIn,
    admin: Admin = Depends(PACK),
    db: AsyncSession = Depends(get_db),
):
    """Paketten vazgeçme — gerekçe ZORUNLU.

    Yetki duruma bağlıdır: `OPEN` paket `packing.pack` ile çözülebilir (henüz
    kimse ona güvenmiyor); `PACKED`/`RETURNED` paketi çözmek başka birinin
    kararını iptal etmektir ve `packing.manage` ister.
    """
    mevcut = await packing_service.get_package(db, package_id)
    if mevcut.status != "OPEN":
        await _yonetim_izni_ara(db, admin)
    return _paket(
        await packing_service.void(
            db, package_id, admin_id=admin.id, reason=payload.reason
        )
    )


# ════════════════════════ Yönetim (görev ayrılığı) ════════════════════════


@router.post("/packages/{package_id}/return-in", response_model=PackageOut)
async def return_in(
    package_id: int,
    payload: PackageReturnInIn | None = None,
    admin: Admin = Depends(MANAGE),
    db: AsyncSession = Depends(get_db),
):
    """Kuryeden dönen paketin depoda OKUTULARAK kabulü (`RETURNED`).

    "Paket depoya döndü" bir varsayım değildir (boşluk G5); bu uç o varsayımın
    yerine geçen fiziksel kabul adımıdır.
    """
    return _paket(
        await packing_service.return_in(
            db,
            package_id,
            admin_id=admin.id,
            note=payload.note if payload is not None else None,
        )
    )


@router.post("/packages/{package_id}/repack", response_model=PackageOut)
async def repack(
    package_id: int,
    admin: Admin = Depends(MANAGE),
    db: AsyncSession = Depends(get_db),
):
    """Geri gelmiş paketi yeniden dağıtıma verir (`RETURNED` → `PACKED`).

    Sıra atlanamaz: `RETURN_PENDING`'ten doğrudan çağrılırsa 409. Basılı etiket
    KORUNUR — G3'ün kazancı budur.
    """
    return _paket(await packing_service.repack(db, package_id, admin_id=admin.id))


@router.post("/packages/{package_id}/unpack", response_model=PackageOut)
async def unpack(
    package_id: int,
    admin: Admin = Depends(MANAGE),
    db: AsyncSession = Depends(get_db),
):
    """Fiziksel bozma damgası — "bozulmayı bekleyen paketler" kuyruğunu kapatır
    (`status='VOID' AND unpacked_at IS NULL`, boşluk G8). Stok hareketi YAZMAZ."""
    return _paket(await packing_service.unpack(db, package_id, admin_id=admin.id))


__all__ = ["router", "HandoverManifestOut"]
