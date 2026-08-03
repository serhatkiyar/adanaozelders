"""F30 saf kuralları — DB'siz, HTTP'siz birim testleri.

Ölçülen şey: paket FSM'i, fiziksel konum tablosu, QR uzayı ayrımı, kod
eşleştirme ve tarama karar fonksiyonu. Bunlar F30'un **sessizce bozulabilecek**
yerleridir; veri olarak durdukları için burada görünür kalırlar.

Modül henüz yazılmadığından her düğüm KIRMIZIDIR. Yükleyici bilinçli olarak
`pytest.fail(pytrace=False)` kullanır — çıplak import ImportError'la tüm dosyayı
collection'da düşürür ve 20 kırmızı düğüm tek satırlık bir hataya iner (F29'da
öğrenildi: `tests/acceptance/test_inventory_contract.py:36-40`).
"""
from __future__ import annotations

import pytest


def _kurallar():
    try:
        from services import packing_rules
    except ImportError as exc:  # noqa: PERF203
        pytest.fail(
            f"HENÜZ YAZILMADI: services/packing_rules.py ({exc})", pytrace=False
        )
    return packing_rules


# ══════════════════ Paket FSM'i ═════════════════════════════════════════════


def test_terminal_durumlarin_CIKISI_YOKTUR():
    """`DELIVERED` ve `VOID` terminaldir. Asıl risk izinli geçişin çalışmaması
    değil, **izinsiz bir geçişin sessizce açık kalmasıdır**
    (ör. DELIVERED → PACKED ile teslim edilmiş paketin yeniden dağıtılması)."""
    k = _kurallar()
    for terminal in ("DELIVERED", "VOID"):
        assert terminal in k.PACKAGE_LOCATION
        cikislar = {h for (b, h) in k.PACKAGE_TRANSITIONS if b == terminal}
        assert not cikislar, f"{terminal} terminal değil: {cikislar}"


@pytest.mark.parametrize(
    "kaynak,hedef",
    [
        ("OPEN", "PACKED"),
        ("OPEN", "VOID"),
        ("PACKED", "HANDED_OVER"),
        ("PACKED", "VOID"),
        ("HANDED_OVER", "DELIVERED"),
        ("HANDED_OVER", "RETURN_PENDING"),
        ("RETURN_PENDING", "RETURNED"),
        ("RETURNED", "PACKED"),
        ("RETURNED", "VOID"),
    ],
)
def test_izinli_gecisler(kaynak, hedef):
    k = _kurallar()
    assert k.can_transition(kaynak, hedef), f"izinli olmalı: {kaynak}→{hedef}"


@pytest.mark.parametrize(
    "kaynak,hedef",
    [
        # Paket kuryeye verilmeden teslim edilemez (zimmet atlanamaz).
        ("PACKED", "DELIVERED"),
        # Eksik paket zimmetlenemez.
        ("OPEN", "HANDED_OVER"),
        # Kuryedeki paket doğrudan rafa dönemez; önce return_in ile okutulur.
        ("HANDED_OVER", "RETURNED"),
        # Geri dönüşü doğrulanmamış paket yeniden dağıtıma verilemez.
        ("RETURN_PENDING", "PACKED"),
        ("RETURN_PENDING", "HANDED_OVER"),
        # Terminal geri açılamaz.
        ("DELIVERED", "PACKED"),
        ("VOID", "OPEN"),
    ],
)
def test_yasak_gecisler(kaynak, hedef):
    k = _kurallar()
    assert not k.can_transition(kaynak, hedef), f"yasak olmalı: {kaynak}→{hedef}"


# ══════════════════ Fiziksel konum ══════════════════════════════════════════


def test_her_durumun_KONUMU_TANIMLI():
    """Konumu tanımsız bir durum, "işletmede mi değil mi" sorusunu cevapsız
    bırakır — envanterin tamamı bu sorunun üstünde duruyor."""
    k = _kurallar()
    durumlar = {b for (b, _h) in k.PACKAGE_TRANSITIONS} | {
        h for (_b, h) in k.PACKAGE_TRANSITIONS
    }
    eksik = durumlar - set(k.PACKAGE_LOCATION)
    assert not eksik, f"konumu tanımsız durum: {eksik}"


@pytest.mark.parametrize(
    "durum,konum",
    [
        ("OPEN", "ON_PREMISE"),
        ("PACKED", "ON_PREMISE"),
        ("RETURNED", "ON_PREMISE"),
        ("HANDED_OVER", "OFF_PREMISE"),
        ("RETURN_PENDING", "OFF_PREMISE"),
        ("DELIVERED", "CUSTOMER"),
        ("VOID", "DISSOLVED"),
    ],
)
def test_konum_tablosu(durum, konum):
    """Sözleşme §3.2. `PACKED` ON_PREMISE'dır: hazırlanmış ama kurye almamış
    paket hâlâ işletmenin kontrolündedir. `HANDED_OVER` değildir."""
    k = _kurallar()
    assert k.PACKAGE_LOCATION[durum] == konum


def test_canli_kume_terminal_disidir():
    k = _kurallar()
    assert set(k.LIVE_STATUSES) == {
        "OPEN", "PACKED", "HANDED_OVER", "RETURN_PENDING", "RETURNED"
    }


def test_isletmede_sayilan_durumlar():
    k = _kurallar()
    assert k.is_on_premise("PACKED") is True
    assert k.is_on_premise("HANDED_OVER") is False
    assert k.is_on_premise("RETURN_PENDING") is False


# ══════════════════ QR uzayı ════════════════════════════════════════════════


def test_paket_qr_PKG1_onekli_uretilir():
    """Sözleşme §3.3: `PKG1:{id}:{token}`. Sürüm öneki, formatı ileride
    değiştirebilmek için."""
    k = _kurallar()
    assert k.build_package_qr(42, "abc123") == "PKG1:42:abc123"


def test_paket_qr_cozulur():
    k = _kurallar()
    assert k.parse_package_qr("PKG1:42:abc123") == (42, "abc123")
    assert k.parse_package_qr("  PKG1:42:abc123  ") == (42, "abc123")


@pytest.mark.parametrize(
    "payload",
    [
        "7:sometoken",        # durak QR'ı — paket DEĞİL
        "PKG2:42:abc",        # bilinmeyen sürüm
        "abc123",             # çıplak token
        "PKG1:abc:def",       # id sayı değil
        "PKG1:42",            # eksik parça
        "",
    ],
)
def test_paket_olmayan_payload_None_doner(payload):
    """`None` dönmek zorunlu: `/delivery/scan` bu değere bakıp mevcut durak
    yoluna düşer (geriye uyum)."""
    k = _kurallar()
    assert k.parse_package_qr(payload) is None


def test_paket_qr_DURAK_UZAYINA_SIZMAZ():
    """Denetçi notu 3 — sessiz çakışma nöbetçisi.

    `delivery_service.parse_qr_token` payload'u ilk `":"`'dan böler ve KALANI
    token sayar. Önek olmasaydı `PKG1:42:abc` → `"42:abc"` diye bir "durak
    token'ı" üretir, DB'de bulamaz ve 404 verirdi — yani hata mesajı yanlış
    yeri işaret ederdi. Bu test iki uzayın ayrık kaldığını sabitler.
    """
    k = _kurallar()
    from services.delivery_service import parse_qr_token

    paket = k.build_package_qr(42, "abc123")
    # Durak ayrıştırıcısı paket payload'unu ÇÖZEMEZ (gerçek token'a eşit değil).
    assert parse_qr_token(paket) != "abc123"
    # Paket ayrıştırıcısı da durak payload'unu çözemez.
    assert k.parse_package_qr("42:abc123") is None


def test_paket_kodu_insan_okunur():
    k = _kurallar()
    assert k.package_code(42) == "PKT-000042"
    assert k.package_code(1234567) == "PKT-1234567"


# ══════════════════ Kod eşleştirme ══════════════════════════════════════════


def _satir(k, *, order_item_id=1, sku="FZK-000001", barcode=None, expected=2, scanned=0,
           product_id=1):
    return k.ScanLine(
        order_item_id=order_item_id,
        product_id=product_id,
        sku=sku,
        barcode=barcode,
        expected_qty=expected,
        scanned_qty=scanned,
    )


def test_barkod_SKU_dan_once_denenir():
    """Fiziksel kalemin üstünde okunan dizgi barkoddur; SKU bizim iç
    kimliğimizdir (`models/store.py:254-261`)."""
    k = _kurallar()
    satirlar = [
        _satir(k, order_item_id=1, sku="FZK-000001", barcode="8690000000001"),
        _satir(k, order_item_id=2, sku="8690000000001", barcode=None),
    ]
    assert k.match_code(satirlar, "8690000000001").order_item_id == 1


def test_sku_ile_eslesir():
    k = _kurallar()
    satirlar = [_satir(k, sku="FZK-000042")]
    assert k.match_code(satirlar, "FZK-000042") is not None


def test_kod_bosluk_ve_buyuk_kucuk_harf_normalize_edilir():
    """USB barkod okuyucular sonda boşluk/CR bırakabilir."""
    k = _kurallar()
    satirlar = [_satir(k, sku="FZK-000042")]
    assert k.match_code(satirlar, " fzk-000042 \r\n") is not None


def test_eslesmeyen_kod_None():
    k = _kurallar()
    assert k.match_code([_satir(k, sku="FZK-000042")], "FZK-000099") is None


# ══════════════════ Tarama kararı ═══════════════════════════════════════════


def test_dogru_kod_OK():
    k = _kurallar()
    assert k.scan_outcome([_satir(k, expected=2, scanned=0)], "FZK-000001").result == "OK"


def test_yanlis_kod_WRONG_SKU():
    """Bu siparişte olmayan ürün paketlenemez (kullanıcı maddesi 4)."""
    k = _kurallar()
    sonuc = k.scan_outcome([_satir(k, sku="FZK-000001")], "FZK-000999")
    assert sonuc.result == "WRONG_SKU"
    assert sonuc.qty_delta == 0


def test_satir_dolunca_OVER_QTY():
    """Fazla adet reddedilir — `expected` tavanı aşılamaz."""
    k = _kurallar()
    sonuc = k.scan_outcome([_satir(k, expected=2, scanned=2)], "FZK-000001")
    assert sonuc.result == "OVER_QTY"
    assert sonuc.qty_delta == 0


def test_urunu_silinmis_kalem_UNSCANNABLE():
    """`product_id IS NULL` geçmiş siparişte SKU/barkod okunamaz (sözleşme §3.6);
    yalnız kontrollü manuel doğrulama ile kapanır."""
    k = _kurallar()
    satirlar = [_satir(k, product_id=None, sku=None, barcode=None)]
    assert k.scan_outcome(satirlar, "FZK-000001").result == "WRONG_SKU"
    assert k.manual_outcome(satirlar[0], reason="Ürün kataloğdan silinmiş").result == (
        "OK_MANUAL"
    )


def test_manuel_dogrulama_GEREKCESIZ_reddedilir():
    k = _kurallar()
    with pytest.raises(ValueError):
        k.manual_outcome(_satir(k), reason="")


def test_tamamlanmislik_TUM_satirlar_tam_olunca():
    k = _kurallar()
    assert k.is_complete([_satir(k, expected=2, scanned=2)]) is True
    assert k.is_complete(
        [_satir(k, expected=2, scanned=2), _satir(k, order_item_id=2, expected=1, scanned=0)]
    ) is False


def test_eksik_kalemler_RAPORLANIR():
    """Ekranın "neyi bekliyoruz" bandı ve `complete` 409 gövdesi bunu kullanır."""
    k = _kurallar()
    eksik = k.missing_lines(
        [_satir(k, order_item_id=1, expected=2, scanned=2),
         _satir(k, order_item_id=2, expected=3, scanned=1)]
    )
    assert [(e.order_item_id, e.expected_qty - e.scanned_qty) for e in eksik] == [(2, 2)]


# ══════════════════ STALE parmak izi ════════════════════════════════════════


def test_parmak_izi_KALEM_SIRASINDAN_BAGIMSIZ():
    """Aynı sipariş, farklı satır sırası → aynı parmak izi. Aksi hâlde her
    `complete` yalancı STALE üretirdi."""
    k = _kurallar()
    a = k.items_fingerprint([(1, 10, 2), (2, 11, 1)])
    b = k.items_fingerprint([(2, 11, 1), (1, 10, 2)])
    assert a == b


def test_parmak_izi_ADET_DEGISINCE_DEGISIR():
    k = _kurallar()
    assert k.items_fingerprint([(1, 10, 2)]) != k.items_fingerprint([(1, 10, 3)])


def test_parmak_izi_KALEM_EKLENINCE_DEGISIR():
    k = _kurallar()
    assert k.items_fingerprint([(1, 10, 2)]) != k.items_fingerprint(
        [(1, 10, 2), (2, 11, 1)]
    )
