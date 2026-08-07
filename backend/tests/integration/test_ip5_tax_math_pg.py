"""İP-5 · M-1…M-8 — sipariş vergi kırılımının aritmetiği (gerçek uç + gerçek PG).

Sipariş GERÇEK ``POST /store/orders`` ucundan doğar; kırılım ``orders``
tablosundan HAM SQL ile okunur. Ham ``INSERT`` ile kurulmuş bir sipariş, tam
olarak ölçülmesi gereken kodu (create_order'ın vergi hesabını) atlar ve
yalancı yeşil üretirdi.

Ürün kararları (docs/ip5-kdv-fatura-sozlesme.md §2):

* **S-1** Fiyatlar KDV DAHİL. Vergi brütün İÇİNDEDİR: ``v = b × r / (1 + r)``.
* **S-2** Kupon indirimi satırlara ``returns.allocate_discount_shares``
  (en-büyük-artık) ile dağıtılır; her satırın vergisi ``brüt − pay`` üzerinden.
* **S-3** Kargonun oranı ``settings.SHIPPING_TAX_RATE``'ten gelir; ayar boşsa
  kırılım BELİRSİZ kalır (``shipping_tax_rate IS NULL``), sessizce %0 yazılmaz.
* **S-4** Geriye dönük hesap YOK — bu dosyadaki her sipariş yenidir.

Sağlamlık ölçütü her testte aynıdır: **Σ(matrah) + Σ(vergi) = orders.total**.

Buradaki oranlar (%0 / %20) TEST VERİSİDİR, koda gömülü değildir; ürünün
``tax_rate`` alanından gelir.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from core.config import settings
from tests.integration.ip5_factory import fab5  # noqa: F401

pytestmark = pytest.mark.asyncio

D = Decimal
CENT = D("0.01")


def _breakdown_map(kirilim) -> dict[str, dict]:
    """``tax_breakdown`` (JSONB liste) → {oran_metni: {base, tax}}."""
    assert kirilim is not None, "tax_breakdown yazılmamış"
    out: dict[str, dict] = {}
    for satir in kirilim:
        out[str(satir["rate"])] = {
            "base": D(str(satir["base"])),
            "tax": D(str(satir["tax"])),
        }
    return out


def _toplamlar_tutuyor(v: dict) -> None:
    """Kırılımın kendi içinde ve sipariş toplamıyla tutarlı olduğunu doğrular."""
    kirilim = _breakdown_map(v["tax_breakdown"])
    assert v["net_total"] is not None, "net_total yazılmamış"
    assert v["tax_total"] is not None, "tax_total yazılmamış"
    assert sum((s["base"] for s in kirilim.values()), D("0.00")) == v["net_total"]
    assert sum((s["tax"] for s in kirilim.values()), D("0.00")) == v["tax_total"]
    assert v["net_total"] + v["tax_total"] == v["total"], (
        f"Σ(matrah+vergi)={v['net_total'] + v['tax_total']} ≠ total={v['total']}"
    )


@pytest.fixture(autouse=True)
def _kargo_orani(monkeypatch):
    """Varsayılan: kargo oranı TANIMLI (0.20) — M-4 ayrıca boş hâli sınar.

    Değer test verisidir; üretimde ``.env``'den gelir ve mali müşavir onayına
    kadar boş bırakılır (S-3).
    """
    monkeypatch.setattr(settings, "SHIPPING_TAX_RATE", 0.20, raising=False)


# ── M-1 · Tek oranlı sepette matrah + vergi = toplam ─────────────────────────


async def test_m1_tek_oranli_sepet(http, fab5):
    m = await fab5.musteri()
    # 120 TL × 5 = 600 TL → kargo eşiğinin (500) üstünde, kargo 0.
    pid = await fab5.urun(price="120.00", tax_rate="0.20", stock=10)

    o = await fab5.siparis_ver(http, m, items=[(pid, 5)])
    v = await fab5.siparis_vergisi(o["id"])

    assert v["total"] == D("600.00")
    assert v["shipping_fee"] == D("0.00")
    # 600 × 0.20 / 1.20 = 100.00
    assert v["tax_total"] == D("100.00")
    assert v["net_total"] == D("500.00")
    _toplamlar_tutuyor(v)

    kirilim = _breakdown_map(v["tax_breakdown"])
    assert set(kirilim) == {"0.2000"}, kirilim


async def test_m1b_sifir_oranli_sepet_vergisiz(http, fab5):
    """%0 oranlı sepette vergi 0, matrah = toplam. `tax_breakdown` yine YAZILIR.

    "Vergi yok" ile "kırılım hesaplanmadı" ayrı şeylerdir; ikincisi NULL'dur.
    """
    m = await fab5.musteri()
    pid = await fab5.urun(price="150.00", tax_rate="0", stock=10)

    o = await fab5.siparis_ver(http, m, items=[(pid, 4)])
    v = await fab5.siparis_vergisi(o["id"])

    assert v["total"] == D("600.00")
    assert v["tax_total"] == D("0.00")
    assert v["net_total"] == D("600.00")
    _toplamlar_tutuyor(v)
    assert set(_breakdown_map(v["tax_breakdown"])) == {"0.0000"}


# ── M-2 · Karışık oranlı sepette her oran AYRI satır ─────────────────────────


async def test_m2_karisik_oranli_sepet_ayri_satirlar(http, fab5):
    """Denetim raporunun kabul şartı: %0 kitap + %20 kırtasiye aynı sepette.

    Fatura bu ikisini AYRI satırlarda göstermek zorundadır; tek "toplam KDV"
    satırı yasal fatura üretmez.
    """
    m = await fab5.musteri()
    kitap = await fab5.urun(price="100.00", tax_rate="0", stock=10)
    kirtasiye = await fab5.urun(price="120.00", tax_rate="0.20", stock=10)

    o = await fab5.siparis_ver(http, m, items=[(kitap, 3), (kirtasiye, 3)])
    v = await fab5.siparis_vergisi(o["id"])

    assert v["total"] == D("660.00")  # 300 + 360, eşik üstü → kargo 0
    kirilim = _breakdown_map(v["tax_breakdown"])
    assert set(kirilim) == {"0.0000", "0.2000"}, kirilim

    assert kirilim["0.0000"]["base"] == D("300.00")
    assert kirilim["0.0000"]["tax"] == D("0.00")
    # 360 × 0.20 / 1.20 = 60.00
    assert kirilim["0.2000"]["tax"] == D("60.00")
    assert kirilim["0.2000"]["base"] == D("300.00")
    _toplamlar_tutuyor(v)


async def test_m2b_kalem_bazinda_oran_ve_vergi_snapshotlaniyor(http, fab5):
    m = await fab5.musteri()
    kitap = await fab5.urun(price="100.00", tax_rate="0", stock=10)
    kirtasiye = await fab5.urun(price="120.00", tax_rate="0.20", stock=10)

    o = await fab5.siparis_ver(http, m, items=[(kitap, 3), (kirtasiye, 3)])
    kalemler = {k["product_id"]: k for k in await fab5.kalem_vergileri(o["id"])}

    assert kalemler[kitap]["tax_rate"] == D("0.0000")
    assert kalemler[kitap]["tax_amount"] == D("0.00")
    assert kalemler[kirtasiye]["tax_rate"] == D("0.2000")
    assert kalemler[kirtasiye]["tax_amount"] == D("60.00")


# ── M-3 · Kuponlu sepette indirim S-2'ye göre dağılıyor ──────────────────────


async def test_m3_kuponlu_karisik_sepet(http, fab5):
    """S-2: indirim satırlara dağıtılır, vergi indirimli brütten hesaplanır.

    %0 satıra düşen pay vergiyi hiç değiştirmez; %20 satıra düşen pay vergiyi
    orantılı düşürür. Bu, "indirim kimin vergisini azalttı" sorusunun kayıtta
    izlenebilir cevabıdır.
    """
    m = await fab5.musteri()
    kitap = await fab5.urun(price="100.00", tax_rate="0", stock=10)
    kirtasiye = await fab5.urun(price="120.00", tax_rate="0.20", stock=10)
    _, kod = await fab5.kupon(discount_type="FIXED", value="110.00")

    # Brütler: kitap 3×100 = 300, kırtasiye 3×120 = 360; subtotal 660.
    # Paylar (en-büyük-artık): 110 × 300/660 = 50.00, 110 × 360/660 = 60.00.
    o = await fab5.siparis_ver(
        http, m, items=[(kitap, 3), (kirtasiye, 3)], coupon_code=kod
    )
    v = await fab5.siparis_vergisi(o["id"])

    assert v["discount"] == D("110.00")
    assert v["total"] == D("550.00")  # 660 − 110, eşik üstü → kargo 0

    kirilim = _breakdown_map(v["tax_breakdown"])
    # %0 satır: 300 − 50 = 250, vergi 0.
    assert kirilim["0.0000"]["base"] == D("250.00")
    assert kirilim["0.0000"]["tax"] == D("0.00")
    # %20 satır: 360 − 60 = 300 → vergi 300 × 0.20/1.20 = 50.00, matrah 250.00
    assert kirilim["0.2000"]["tax"] == D("50.00")
    assert kirilim["0.2000"]["base"] == D("250.00")
    _toplamlar_tutuyor(v)


async def test_m3b_indirim_vergiyi_gercekten_dusuruyor(http, fab5):
    """Nöbetçi: indirim yok sayılırsa bu test kırılır.

    Aynı sepet kuponlu ve kuponsuz kurulur; kuponlunun vergisi KESİNLİKLE
    daha düşük olmalıdır. "Vergi indirimsiz brütten hesaplanıyor" hatası
    (S-2'nin reddedilen ikinci seçeneği) tam olarak burada görünür.
    """
    m = await fab5.musteri()
    kirtasiye = await fab5.urun(price="120.00", tax_rate="0.20", stock=20)
    _, kod = await fab5.kupon(discount_type="FIXED", value="120.00")

    kuponsuz = await fab5.siparis_ver(http, m, items=[(kirtasiye, 5)])
    kuponlu = await fab5.siparis_ver(
        http, m, items=[(kirtasiye, 5)], coupon_code=kod
    )

    v1 = await fab5.siparis_vergisi(kuponsuz["id"])
    v2 = await fab5.siparis_vergisi(kuponlu["id"])

    assert v1["tax_total"] == D("100.00")  # 600 × 0.20/1.20
    assert v2["tax_total"] == D("80.00")   # 480 × 0.20/1.20
    _toplamlar_tutuyor(v1)
    _toplamlar_tutuyor(v2)


# ── M-4 · Kargo S-3 kararına göre vergilendiriliyor ──────────────────────────


async def test_m4_kargo_ayardaki_oranla_vergileniyor(http, fab5):
    m = await fab5.musteri()
    kitap = await fab5.urun(price="100.00", tax_rate="0", stock=10)

    # 2 × 100 = 200 → eşik (500) altı → kargo SHIPPING_FLAT_FEE.
    o = await fab5.siparis_ver(http, m, items=[(kitap, 2)])
    v = await fab5.siparis_vergisi(o["id"])

    kargo = D(str(settings.SHIPPING_FLAT_FEE)).quantize(CENT)
    assert v["shipping_fee"] == kargo
    assert v["shipping_tax_rate"] == D("0.2000")
    # 49.90 × 0.20 / 1.20 = 8.3166… → 8.32 (ROUND_HALF_UP)
    beklenen_kargo_vergisi = (kargo * D("0.20") / D("1.20")).quantize(CENT)
    assert v["shipping_tax_amount"] == beklenen_kargo_vergisi

    kirilim = _breakdown_map(v["tax_breakdown"])
    # Mal %0, kargo %20 → iki ayrı oran satırı.
    assert set(kirilim) == {"0.0000", "0.2000"}, kirilim
    assert kirilim["0.2000"]["tax"] == beklenen_kargo_vergisi
    _toplamlar_tutuyor(v)


async def test_m4b_ayar_bossa_kargo_kirilimi_belirsiz_kaliyor(
    http, fab5, monkeypatch
):
    """S-3 eki: ayar boşken sipariş GEÇER ama kırılım sessizce %0 yazılmaz.

    `shipping_tax_rate IS NULL` kalıcı ve görünür bir "belirlenmedi" kaydıdır;
    fatura ucu bu siparişte 409 döner (bkz. test_ip5_invoice_pg::F-4c).
    """
    monkeypatch.setattr(settings, "SHIPPING_TAX_RATE", None, raising=False)
    m = await fab5.musteri()
    kitap = await fab5.urun(price="100.00", tax_rate="0", stock=10)

    o = await fab5.siparis_ver(http, m, items=[(kitap, 2)])
    v = await fab5.siparis_vergisi(o["id"])

    assert v["shipping_fee"] > 0
    assert v["shipping_tax_rate"] is None, "ayar boşken orana değer yazılmış"
    assert v["shipping_tax_amount"] is None, "ayar boşken kargo vergisi uydurulmuş"


async def test_m4c_kargosuz_sipariste_belirsizlik_yok(http, fab5, monkeypatch):
    """Kargo 0 iken ayar boş olsa da belirsizlik doğmaz: 0'ın vergisi her oranda 0."""
    monkeypatch.setattr(settings, "SHIPPING_TAX_RATE", None, raising=False)
    m = await fab5.musteri()
    kitap = await fab5.urun(price="200.00", tax_rate="0", stock=10)

    o = await fab5.siparis_ver(http, m, items=[(kitap, 3)])  # 600 → eşik üstü
    v = await fab5.siparis_vergisi(o["id"])

    assert v["shipping_fee"] == D("0.00")
    assert v["shipping_tax_amount"] == D("0.00")
    _toplamlar_tutuyor(v)


# ── M-5 · Kuruş artığı deterministik; Σ = sipariş toplamı ────────────────────


async def test_m5_uc_satirli_kurus_artigi(http, fab5):
    """3 × 100 TL satıra 10 TL indirim: 3 × 3,33 = 9,99 ≠ 10,00.

    En-büyük-artık dağıtımı olmadan Σ(matrah+vergi) sipariş toplamından
    1 kuruş sapar. Bu test o kuruşu kovalar.
    """
    m = await fab5.musteri()
    a = await fab5.urun(price="100.00", tax_rate="0.20", stock=10)
    b = await fab5.urun(price="100.00", tax_rate="0.20", stock=10)
    c = await fab5.urun(price="100.00", tax_rate="0", stock=10)
    _, kod = await fab5.kupon(discount_type="FIXED", value="10.00")

    o = await fab5.siparis_ver(
        http, m, items=[(a, 2), (b, 2), (c, 2)], coupon_code=kod
    )
    v = await fab5.siparis_vergisi(o["id"])

    assert v["subtotal"] == D("600.00")
    assert v["discount"] == D("10.00")
    assert v["total"] == D("590.00")
    _toplamlar_tutuyor(v)


async def test_m5b_yuzde_kuponlu_tek_kurus_artigi(http, fab5):
    """Bölünmeyen indirim: 3 satır, %7 kupon → paylar tam bölünmez.

    Yine tek ölçüt: kırılım toplamı sipariş toplamına KURUŞU KURUŞUNA eşit.
    """
    m = await fab5.musteri()
    a = await fab5.urun(price="33.33", tax_rate="0.20", stock=10)
    b = await fab5.urun(price="66.67", tax_rate="0.20", stock=10)
    c = await fab5.urun(price="99.99", tax_rate="0", stock=10)
    _, kod = await fab5.kupon(discount_type="PERCENT", value="7")

    o = await fab5.siparis_ver(
        http, m, items=[(a, 3), (b, 3), (c, 3)], coupon_code=kod
    )
    v = await fab5.siparis_vergisi(o["id"])
    _toplamlar_tutuyor(v)


# ── M-6 · Ürünün oranı sonradan değişirse kırılım DEĞİŞMİYOR ────────────────


async def test_m6_saklanan_kirilim_urun_oranindan_bagimsiz(http, fab5, monkeypatch):
    """Anlık değer saklanır; fatura sipariş anındaki oranla kesilir.

    Bu, kırılımın "her okumada yeniden hesaplanan" bir görünüm olmadığının
    kanıtıdır: ürünün oranı değiştikten sonra ESKİ siparişin kırılımı aynı
    kalmalıdır.
    """
    m = await fab5.musteri()
    pid = await fab5.urun(price="120.00", tax_rate="0.20", stock=10)

    o = await fab5.siparis_ver(http, m, items=[(pid, 5)])
    once = await fab5.siparis_vergisi(o["id"])
    kalem_once = await fab5.kalem_vergileri(o["id"])

    await fab5.urun_orani_degistir(pid, "0")
    assert await fab5.urun_orani(pid) == D("0.0000")

    sonra = await fab5.siparis_vergisi(o["id"])
    kalem_sonra = await fab5.kalem_vergileri(o["id"])

    assert sonra["tax_total"] == once["tax_total"] == D("100.00")
    assert sonra["net_total"] == once["net_total"]
    assert _breakdown_map(sonra["tax_breakdown"]) == _breakdown_map(
        once["tax_breakdown"]
    )
    assert kalem_sonra[0]["tax_rate"] == kalem_once[0]["tax_rate"] == D("0.2000")
    assert kalem_sonra[0]["tax_amount"] == kalem_once[0]["tax_amount"]

    # ── Faturanın da ESKİ oranı göstermesi ──
    # DB'yi okumak, kırılımın saklandığını kanıtlar; ama belgeyi ÜRETEN yolun
    # da saklanandan okuduğunu ayrıca göstermek gerekir. Aksi hâlde biri
    # `build_invoice`'ı "kalemlerden anlık hesapla" diye değiştirdiğinde
    # tablo doğru kalır, MÜŞTERİYE GİDEN BELGE yanlışa döner.
    monkeypatch.setattr(settings, "INVOICE_ENABLED", True, raising=False)
    for ad, deger in (
        ("INVOICE_SELLER_NAME", "IP5 Test Satıcı"),
        ("INVOICE_SELLER_TAX_NUMBER", "5590521517"),
        ("INVOICE_SELLER_TAX_OFFICE", "Test VD"),
        ("INVOICE_SELLER_ADDRESS", "Adana, Türkiye"),
        ("INVOICE_SELLER_PHONE", "+905550000000"),
        ("INVOICE_SELLER_EMAIL", "bilgi@test.local"),
    ):
        monkeypatch.setattr(settings, ad, deger, raising=False)

    r = await http.get(
        f"/api/v1/store/orders/{o['id']}/invoice", headers=m.headers
    )
    assert r.status_code == 200, r.text
    g = r.json()
    assert D(str(g["totals"]["tax_total"])) == D("100.00"), (
        "fatura, ürünün YENİ oranıyla yeniden hesaplamış"
    )
    assert {str(s["rate"]) for s in g["tax_lines"]} == {"0.2000"}, g["tax_lines"]
    assert D(str(g["items"][0]["tax_rate"])) == D("0.2000")


# ── M-7 / M-8 · İadede vergi kırılımı ───────────────────────────────────────


async def _tam_iade_et(http, fab5, order_id: int) -> None:
    _, ah = await fab5.admin(izinler=["orders.view", "orders.manage"])
    r = await http.post(
        f"/api/v1/store/admin/orders/{order_id}/refund",
        headers=ah,
        json={"reason": "IP5 tam iade provası"},
    )
    assert r.status_code == 200, r.text


async def _iade_vergisi(order_id: int):
    from core.database import AsyncSessionLocal
    from services import invoice_service

    async with AsyncSessionLocal() as s:
        return await invoice_service.refunded_breakdown(s, order_id)


async def test_m8_tam_iadede_vergi_tamamen_geri_donuyor(http, fab5):
    """Tam iade: iade edilen verginin toplamı siparişin vergisine EŞİT."""
    m = await fab5.musteri()
    kitap = await fab5.urun(price="100.00", tax_rate="0", stock=10)
    kirtasiye = await fab5.urun(price="120.00", tax_rate="0.20", stock=10)

    o = await fab5.siparis_ver(http, m, items=[(kitap, 3), (kirtasiye, 3)])
    v = await fab5.siparis_vergisi(o["id"])
    assert v["tax_total"] == D("60.00")

    await _tam_iade_et(http, fab5, o["id"])

    iade = await _iade_vergisi(o["id"])
    assert iade.tax_total == v["tax_total"], "tam iadede vergi tamamen geri dönmedi"
    assert iade.net_total == v["net_total"]


async def test_m7_kismi_iadede_vergi_orantili_geri_donuyor(http, fab5):
    """Kısmi iade: yalnız iade edilen kalemin vergisi geri döner.

    Sipariş: 3 kitap (%0) + 3 kırtasiye (%20). İade: 1 kırtasiye.
    Beklenen iade vergisi = 120 × 0.20 / 1.20 = 20,00 — kitabın vergisi
    (zaten 0) ve iade edilmeyen 2 kırtasiye HARİÇ.
    """
    m = await fab5.musteri()
    kitap = await fab5.urun(price="100.00", tax_rate="0", stock=10)
    kirtasiye = await fab5.urun(price="120.00", tax_rate="0.20", stock=10)

    o = await fab5.siparis_ver(http, m, items=[(kitap, 3), (kirtasiye, 3)])
    kalemler = {k["product_id"]: k for k in await fab5.kalem_vergileri(o["id"])}

    # Teslim edilmiş sipariş → cayma hakkı penceresi açık.
    await _teslim_et(fab5, o["id"])

    # CAYMA koşulsuzdur: talep OTOMATİK onaylanır ve iade anında yapılır
    # (`returns.auto_approved`). Ayrıca `approve` çağırmak 409 verirdi —
    # ilk yazımda tam bu tuzağa düşüldü.
    r = await http.post(
        f"/api/v1/store/orders/{o['id']}/return",
        headers=m.headers,
        json={
            "type": "CAYMA",
            "reason": "IP5 kısmi iade provası",
            "items": [
                {"order_item_id": kalemler[kirtasiye]["id"], "quantity": 1}
            ],
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["refund_status"] == "REFUNDED", r.json()

    iade = await _iade_vergisi(o["id"])
    assert iade.tax_total == D("20.00"), iade
    assert iade.net_total == D("100.00"), iade


async def _teslim_et(fab5, order_id: int) -> None:
    """Siparişi DELIVERED'a çeker (iade penceresi için) — ham SQL, girdi kurulumu."""
    import datetime

    from sqlalchemy import text as sa_text

    from core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        await s.execute(
            sa_text(
                "UPDATE orders SET status = 'DELIVERED', delivered_at = :d "
                "WHERE id = :i"
            ),
            {
                "d": datetime.datetime.now(datetime.timezone.utc)
                - datetime.timedelta(days=1),
                "i": order_id,
            },
        )
        await s.commit()
