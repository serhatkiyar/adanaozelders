"""İP-2a · Kısmi iade hesabı, kupon/indirim telafisi — GERÇEK PG.

Sözleşme: docs/ip2a-magaza-iade-sozlesme.md (§2 M4-M6; §3 İP2A-05/14/15/16).

Para davranışı gerçek servis katmanı + gerçek DB kısıtlarıyla ölçülür; sağlayıcı
çağrıları kaydeden sahte provider'dan okunur. KIRMIZI testler ``KNOWN-RED``
işaretlidir ve bugün FAIL etmeleri beklenir.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException

from core.database import AsyncSessionLocal
from schemas.store import OrderReturnItemIn
from services import order_service
from tests.integration.ip2a_factory import IadeFabrikasi


@pytest.fixture
async def fab(pg):
    f = IadeFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


async def _talep(order_id: int, *, tip: str, items=None, reason: str = "kusurlu"):
    async with AsyncSessionLocal() as db:
        order = await order_service._load_full(db, order_id)
        assert order is not None
        return await order_service.request_return(
            db,
            order,
            "" if tip == "CAYMA" else reason,
            return_type=tip,
            items=items,
        )


async def _onayla(return_id: int):
    async with AsyncSessionLocal() as db:
        return await order_service.approve_return(db, return_id, admin_note="uygun")


# ── YEŞİL NÖBETÇİLER ─────────────────────────────────────────────────────────


async def test_g03_kuponlu_kismi_iade_odenen_payi_iade_eder(fab, provider):
    """G-03: Kuponla alınan üründe liste fiyatı değil ödenen pay iade edilir.

    2 adetlik kalemden 1 adet iade: 100 TL brüt − kuponun orantısal payı
    (30 × 100/200 = 15) = 85 TL. Kargo kısmi iadede eklenmez.
    """
    pid = await fab.urun(stock=10, price="100.00")
    kupon = await fab.kupon(discount_type="FIXED", value="30.00")
    sip = await fab.siparis(
        items=[(pid, 2)],
        discount="30.00",
        shipping="49.90",
        coupon_id=kupon,
        coupon_redeemed=True,
    )
    await _talep(
        sip.order_id,
        tip="CAYMA",
        items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
    )

    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_status"] == "REFUNDED"
    assert talep["refund_amount"] == Decimal("85.00"), (
        "kısmi iade = brüt(100) − kupon payı(15); kargo eklenmez"
    )
    assert provider.refund_calls[-1][1] == Decimal("85.00")
    k = await fab.kupon_satiri(kupon)
    assert k["used_count"] == 1, "kısmi iade kupon kullanımını geri almaz"
    o = await fab.siparis_satiri(sip.order_id)
    assert o["payment_status"] == "PAID", "kısmi iadede sipariş ayakta kalır"
    assert o["refunded_amount"] == Decimal("85.00")


async def test_g04_gercek_tam_iade_kargo_dahil_ve_kupon_serbest(fab, provider):
    """G-04: Siparişin TAMAMI iade edilince tutar = subtotal − kupon + kargo;
    sipariş REFUNDED'a geçer, kupon serbest kalır."""
    p1 = await fab.urun(stock=5, price="100.00")
    p2 = await fab.urun(stock=5, price="100.00")
    kupon = await fab.kupon(discount_type="FIXED", value="30.00")
    sip = await fab.siparis(
        items=[(p1, 1), (p2, 1)],
        discount="30.00",
        shipping="49.90",
        coupon_id=kupon,
        coupon_redeemed=True,
    )
    assert sip.total == Decimal("219.90")
    await _talep(sip.order_id, tip="CAYMA", items=None)  # tamamı

    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_amount"] == Decimal("219.90"), (
        "tam iade fiilen ödenenin tamamıdır (kargo dahil, kupon düşülmüş)"
    )
    assert provider.refund_calls[-1][1] == Decimal("219.90")
    o = await fab.siparis_satiri(sip.order_id)
    assert o["payment_status"] == "REFUNDED"
    assert o["status"] == "REFUNDED"
    k = await fab.kupon_satiri(kupon)
    assert k["used_count"] == 0, "tam iadede kupon kullanımı geri alınır"
    assert k["redemptions"] == 0


# ── KIRMIZI KABUL TESTLERİ ───────────────────────────────────────────────────


async def test_r05a_secim_bazli_tam_iade_kargo_sizdirmamali(fab, provider):
    """R-05a · KNOWN-RED(İP2A-05): 2 kalemli siparişte YALNIZ bir kalemin tam
    adediyle iadesi 'tam sipariş iadesi' sayılamaz — kargo bedeli eklenemez.

    Bugün: `is_full_return` yalnız gönderilen seçimi denetler; müşteri B
    kalemini elinde tutarken A için 100 + 49.90 kargo alır (satıcı zararı).
    """
    p1 = await fab.urun(stock=5, price="100.00")
    p2 = await fab.urun(stock=5, price="100.00")
    sip = await fab.siparis(items=[(p1, 1), (p2, 1)], shipping="49.90")
    assert sip.total == Decimal("249.90")

    await _talep(
        sip.order_id,
        tip="CAYMA",
        items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
    )

    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert talep["refund_amount"] == Decimal("100.00"), (
        f"KNOWN-RED(İP2A-05): tek kalem iadesine {talep['refund_amount']} TL "
        "ödendi — kargo bedeli (49.90) kısmi iadeye sızdı; müşteri diğer "
        "kalemi elinde tutarken sipariş 'tam iade' sayıldı"
    )


async def test_r05b_secim_bazli_tam_iade_kuponu_serbest_birakmamali(fab, provider):
    """R-05b · KNOWN-RED(İP2A-05): aynı senaryoda kupon da serbest bırakılıyor —
    sipariş ayaktayken tek kullanımlık kupon yeniden kullanılabilir oluyor."""
    p1 = await fab.urun(stock=5, price="100.00")
    p2 = await fab.urun(stock=5, price="100.00")
    kupon = await fab.kupon(discount_type="FIXED", value="50.00", max_uses=1)
    sip = await fab.siparis(
        items=[(p1, 1), (p2, 1)],
        discount="50.00",
        coupon_id=kupon,
        coupon_redeemed=True,
    )

    await _talep(
        sip.order_id,
        tip="CAYMA",
        items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
    )

    o = await fab.siparis_satiri(sip.order_id)
    assert o["payment_status"] == "PAID", "ön koşul: sipariş hâlâ ayakta"
    k = await fab.kupon_satiri(kupon)
    assert k["used_count"] == 1, (
        "KNOWN-RED(İP2A-05): sipariş ayaktayken (B kalemi müşteride) kupon "
        "kullanımı geri alındı — is_partial yanlış hesaplandığı için tek "
        "kullanımlık kupon yeniden harcanabilir"
    )


async def test_r14_coklu_kismi_iade_toplami_tek_seferlik_iadeyle_esit(fab, provider):
    """R-14 · KNOWN-RED(İP2A-14): kalemleri tek tek iade etmenin toplamı, tek
    seferde tam iadeyle kuruşu kuruşuna aynı olmalıdır.

    3×100 TL + 20 TL kupon (total 280). Kalem başına kupon payı 6.67'ye
    yuvarlanır → 3 × 93.33 = 279.99; artık kuruş hiçbir satıra atanmadığından
    müşteri 1 kuruş eksik alır. (Ters yönlü senaryolarda tavan kırpması sırayı
    bağımlı kılar — bkz. sözleşme M5.)
    """
    pids = [await fab.urun(stock=5, price="100.00") for _ in range(3)]
    kupon = await fab.kupon(discount_type="FIXED", value="20.00")
    sip = await fab.siparis(
        items=[(p, 1) for p in pids],
        discount="20.00",
        coupon_id=kupon,
        coupon_redeemed=True,
    )
    assert sip.total == Decimal("280.00")

    for item_id in sip.item_ids:
        await _talep(
            sip.order_id,
            tip="CAYMA",
            items=[OrderReturnItemIn(order_item_id=item_id, quantity=1)],
        )

    toplam = sum(t["refund_amount"] for t in await fab.iade_satirlari(sip.order_id))
    assert toplam == sip.total, (
        f"KNOWN-RED(İP2A-14): üç parçalı iade toplamı {toplam} TL — tek "
        f"seferlik eşdeğeri {sip.total} TL; yuvarlama artığı hiçbir satıra "
        "dağıtılmadığından son kuruş kayboldu"
    )


async def test_r15_iade_kalem_tutarlari_odenen_payla_tutarli_olmali(fab, provider):
    """R-15 · KNOWN-RED(İP2A-15): müşteriye/admin'e gösterilen kalem tutarları
    (`OrderReturnItem.amount`) toplamı, talebin gerçek iade tutarına eşit olmalı.

    Bugün kalem tutarı BRÜT yazılır (kupon payı düşülmeden): kuponlu siparişte
    Σ items.amount ≠ refund_amount — iade dekontu bu alandan üretilirse yanlış.
    """
    pid = await fab.urun(stock=10, price="100.00")
    kupon = await fab.kupon(discount_type="FIXED", value="30.00")
    sip = await fab.siparis(
        items=[(pid, 2)],
        discount="30.00",
        coupon_id=kupon,
        coupon_redeemed=True,
    )
    await _talep(
        sip.order_id,
        tip="CAYMA",
        items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
    )

    talep = (await fab.iade_satirlari(sip.order_id))[0]
    async with AsyncSessionLocal() as s:
        from sqlalchemy import text

        kalem_toplami = (
            await s.execute(
                text(
                    "SELECT COALESCE(SUM(amount), 0) FROM order_return_items "
                    "WHERE return_id = :r"
                ),
                {"r": talep["id"]},
            )
        ).scalar_one()
    assert Decimal(str(kalem_toplami)) == talep["refund_amount"], (
        f"KNOWN-RED(İP2A-15): kalem tutarları toplamı {kalem_toplami} TL, "
        f"talebin gerçek iadesi {talep['refund_amount']} TL — kalem satırları "
        "kupon payı düşülmeden (brüt) yazılıyor, gösterilen döküm yanlış"
    )


async def test_r16_tuketilmemis_kupon_iadesi_baskasinin_kullanimini_silmemeli(
    fab, provider
):
    """R-16 · KNOWN-RED(İP2A-16): `redeem` edilmemiş (sayaç artmamış) kuponlu
    siparişin iadesi kupon sayacını düşürmemelidir.

    Bugün `release` redemption satırının varlığına bakmadan `used_count -= 1`
    yapar: limit dolduğu için sayaca girmemiş bir siparişin iadesi, BAŞKA
    müşterinin kullanımını sayaçtan siler → kupon limiti fiilen delinir.
    """
    pid = await fab.urun(stock=5, price="100.00")
    # Sayaçtaki tek kullanım BAŞKA bir müşteriye ait; bizim sipariş redeem
    # EDİLMEMİŞ (gerçek yol: _finalize_paid'de limit doluysa redeem False döner
    # ama sipariş coupon_id ile PAID kalır).
    kupon = await fab.kupon(
        discount_type="FIXED", value="50.00", max_uses=1, used_count=1
    )
    sip = await fab.siparis(
        items=[(pid, 1)],
        discount="50.00",
        coupon_id=kupon,
        coupon_redeemed=False,
    )
    await _talep(sip.order_id, tip="CAYMA", items=None)  # tam iade → release

    k = await fab.kupon_satiri(kupon)
    assert k["used_count"] == 1, (
        "KNOWN-RED(İP2A-16): bu siparişin hiç artırmadığı kupon sayacı iade "
        f"yolunda {k['used_count']}'a düşürüldü — başka müşterinin kullanımı "
        "silindi, tükenmiş kupon yeniden kullanılabilir hale geldi"
    )


async def test_r11_ikinci_talep_kalan_iade_edilebilir_adedi_asamamali(fab, provider):
    """R-11 · KNOWN-RED(İP2A-11): daha önce iade edilmiş adet ikinci talepte
    yeniden iade edilememeli — kalem-adet kümülatifi talep anında denetlenmeli.

    qty=2'lik kalemden 1 adet iade edildikten sonra 2 adetlik yeni talep bugün
    KABUL edilir (guard yalnız `sel.quantity <= item.quantity`); para tavana,
    stok kırpmaya yaslanır ama talep kaydı 2 adet olarak yazılır — müşteriden
    2 kitap istenir, karşılığında tek kitaplık para/stok işler.
    """
    pid = await fab.urun(stock=10, price="100.00")
    sip = await fab.siparis(items=[(pid, 2)])
    await _talep(
        sip.order_id,
        tip="CAYMA",
        items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
    )

    kabul_edildi = True
    try:
        await _talep(
            sip.order_id,
            tip="CAYMA",
            items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=2)],
        )
    except HTTPException:
        kabul_edildi = False

    if kabul_edildi:
        async with AsyncSessionLocal() as s:
            from sqlalchemy import text

            son_adet = (
                await s.execute(
                    text(
                        "SELECT ri.quantity FROM order_return_items ri "
                        "JOIN order_returns r ON r.id = ri.return_id "
                        "WHERE r.order_id = :o ORDER BY r.id DESC LIMIT 1"
                    ),
                    {"o": sip.order_id},
                )
            ).scalar_one()
        assert son_adet <= 1, (
            f"KNOWN-RED(İP2A-11): ikinci talep {son_adet} adetle kabul edildi — "
            "kalemden yalnız 1 adet iade hakkı kalmıştı; önceki taleplerin "
            "kümülatif adedi talep kabulünde hiç denetlenmiyor"
        )


# ── İP-2a üretim uygulaması: kuruş sözleşmesi nöbetçileri ────────────────────


async def test_kupon_kargo_ve_kurus_matematigi_parcali_iadede_de_tutar(
    fab, provider
):
    """Kupon + kargo + yuvarlama artığı: parçalı iadenin toplamı ödenene EŞİT.

    R-14 yalnız kupon artığını ölçüyordu. Burada üç mekanizma AYNI siparişte
    çalışır ve birbirini bozmamak zorundadır:

    * kupon payı satırlara kuruşu kuruşuna dağıtılır (en-büyük-artık),
    * kargo yalnız siparişi BOŞALTAN talebe eklenir (m.12) — parçalara
      bölünmez, iki kez de verilmez,
    * her talebin kalem dökümü kendi tutarıyla tutar
      (`refund_amount = Σ items.amount + shipping_refund`).

    3 × 100 TL + 10 TL kupon + 29,90 TL kargo → total 319,90.
    """
    pids = [await fab.urun(stock=5, price="100.00") for _ in range(3)]
    kupon = await fab.kupon(discount_type="FIXED", value="10.00")
    sip = await fab.siparis(
        items=[(p, 1) for p in pids],
        discount="10.00",
        shipping="29.90",
        coupon_id=kupon,
        coupon_redeemed=True,
    )
    assert sip.total == Decimal("319.90")

    for item_id in sip.item_ids:
        await _talep(
            sip.order_id,
            tip="CAYMA",
            items=[OrderReturnItemIn(order_item_id=item_id, quantity=1)],
        )

    talepler = await fab.iade_satirlari(sip.order_id)
    toplam = sum(t["refund_amount"] for t in talepler)
    assert toplam == sip.total, (
        f"parçalı iade toplamı {toplam} TL — ödenen {sip.total} TL olmalıydı"
    )
    assert sum(t for _, t in provider.refund_calls) == sip.total

    # Kargo TAM BİR KEZ ve yalnız siparişi boşaltan (son) talepte.
    kargolar = [t["shipping_refund"] for t in talepler]
    assert sum(kargolar) == Decimal("29.90"), f"kargo payları: {kargolar}"
    assert kargolar[-1] == Decimal("29.90") and set(kargolar[:-1]) == {Decimal("0.00")}

    # Dekont özdeşliği her talepte ayrı ayrı geçerli.
    for t in talepler:
        kalemler = await fab.iade_kalemleri(t["id"])
        assert sum(k["amount"] for k in kalemler) + t["shipping_refund"] == t[
            "refund_amount"
        ], f"talep {t['id']} dökümü tutarıyla tutmuyor"

    # is_partial yalnız SONUNCUDA False → kupon tam bir kez serbest kalır.
    assert [t["is_partial"] for t in talepler] == [True, True, False]
    assert (await fab.kupon_satiri(kupon))["used_count"] == 0
    o = await fab.siparis_satiri(sip.order_id)
    assert o["refunded_amount"] == sip.total and o["payment_status"] == "REFUNDED"


async def test_satir_ici_kismi_adetlerde_kupon_payi_kaybolmaz(fab, provider):
    """Aynı satırdan parça parça iade: kupon payı ne kaybolur ne iki kez verilir.

    3 adetlik tek kalem + 10 TL kupon (total 290). Adetler 1+1+1 iade edilirse
    satır payı (10,00) tam olarak dağıtılmalı; naif `round(pay*k/n)` yaklaşımı
    3 × 3,33 = 9,99 üretip müşteriye 1 kuruş fazla öderdi.
    """
    pid = await fab.urun(stock=10, price="100.00")
    kupon = await fab.kupon(discount_type="FIXED", value="10.00")
    sip = await fab.siparis(
        items=[(pid, 3)], discount="10.00", coupon_id=kupon, coupon_redeemed=True
    )
    assert sip.total == Decimal("290.00")

    for _ in range(3):
        await _talep(
            sip.order_id,
            tip="CAYMA",
            items=[OrderReturnItemIn(order_item_id=sip.item_ids[0], quantity=1)],
        )

    talepler = await fab.iade_satirlari(sip.order_id)
    assert sum(t["refund_amount"] for t in talepler) == sip.total
    assert sum(t for _, t in provider.refund_calls) == sip.total
    assert (await fab.siparis_satiri(sip.order_id))["refunded_amount"] == sip.total


async def test_tek_seferlik_tam_iade_parcali_toplamla_ayni_kurusu_uretir(
    fab, provider
):
    """M5: aynı sepet, iki farklı iade stratejisi → AYNI kuruş.

    Bu, R-14'ün karşı yakasıdır: parçalı toplamın doğru olduğunu bilmek
    yetmez, tek seferlik eşdeğerinin de aynı sayıyı ürettiği gösterilmelidir
    (yoksa "ikisi de yanlış ama tutarlı" durumu fark edilmez).
    """
    async def _sepet():
        pids = [await fab.urun(stock=5, price="100.00") for _ in range(3)]
        kupon = await fab.kupon(discount_type="FIXED", value="20.00")
        return await fab.siparis(
            items=[(p, 1) for p in pids],
            discount="20.00",
            shipping="19.90",
            coupon_id=kupon,
            coupon_redeemed=True,
        )

    parcali = await _sepet()
    for item_id in parcali.item_ids:
        await _talep(
            parcali.order_id,
            tip="CAYMA",
            items=[OrderReturnItemIn(order_item_id=item_id, quantity=1)],
        )
    parcali_toplam = sum(
        t["refund_amount"] for t in await fab.iade_satirlari(parcali.order_id)
    )

    tek = await _sepet()
    await _talep(tek.order_id, tip="CAYMA", items=None)
    tek_toplam = (await fab.iade_satirlari(tek.order_id))[0]["refund_amount"]

    assert parcali_toplam == tek_toplam == tek.total, (
        f"parçalı {parcali_toplam} ≠ tek seferlik {tek_toplam} (ödenen {tek.total})"
    )
