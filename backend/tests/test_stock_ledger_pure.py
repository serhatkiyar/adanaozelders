"""Stok hareket defteri — saf mantık testleri (DB gerektirmez).

Bu dosya `services/stock_ledger.py`'nin **sözleşmesini** yazar. Test matrisi
koddan önce (commit 1'de) yazıldı ve `ImportError` ile kırmızıydı; commit 3'te
servis geldiğinde yeşile döndü. Beklenen değerler bu yüzden implementasyona
bakılarak değil, sözleşmeden türetilmiştir.

Buradaki fonksiyonların saf tutulmasının sebebi, hepsinin **karar** üretmesi:
SKU'nun ne olacağı, stoğun yetip yetmediği, hangi gerekçenin geçerli olduğu,
bir tekrarın aynı işlem mi yoksa çelişki mi olduğu. Bu kararlar DB'ye bağlı
olmadan doğrulanabilirse, eşzamanlılık testleri yalnız *yarışa* odaklanabilir.
"""
from __future__ import annotations

import pytest

from services.stock_ledger import (
    ADMIN_ADJUSTMENT_REASONS,
    IDEMPOTENCY_PAYLOAD_FIELDS,
    IdempotencyConflict,
    InsufficientStock,
    PartialIdempotencyState,
    StockMovementType,
    StockNotTracked,
    has_shortage,
    idempotency_key_for,
    make_sku,
    payload_differences,
    sku_prefix,
    validate_reason,
    verify_chain,
)


# ─────────────────────────── SKU (Karar 1) ───────────────────────────
# SKU sequence'sız, `(kind, id)`'nin fonksiyonu. Bu yüzden testler de sabit
# beklenen dizgileri çivileyebilir — üretim kodu formülü değiştirirse kırılır.

class TestSku:
    def test_prefix_kind_basina(self):
        assert sku_prefix("PHYSICAL") == "FZK"
        assert sku_prefix("DIGITAL") == "DIJ"

    def test_bilinmeyen_kind_reddedilir(self):
        # Sessizce bir önek uydurmak, SKU'nun anlamını kaybettirir.
        with pytest.raises(ValueError):
            sku_prefix("HAYALI")

    @pytest.mark.parametrize(
        "kind,product_id,beklenen",
        [
            ("PHYSICAL", 1, "FZK-000001"),
            ("PHYSICAL", 42, "FZK-000042"),
            ("PHYSICAL", 999999, "FZK-999999"),
            # 6 haneyi aşınca dolgu doğal olarak büyür; kırpma YAPILMAZ
            # (kırpma iki ürüne aynı SKU'yu verirdi).
            ("PHYSICAL", 1000000, "FZK-1000000"),
            ("DIGITAL", 7, "DIJ-000007"),
        ],
    )
    def test_deterministik_bicim(self, kind, product_id, beklenen):
        assert make_sku(kind, product_id) == beklenen

    def test_ayni_girdi_ayni_cikti(self):
        # Idempotent backfill'in ve "immutable SKU" iddiasının temeli.
        assert make_sku("PHYSICAL", 42) == make_sku("PHYSICAL", 42)

    def test_farkli_kind_farkli_sku(self):
        assert make_sku("PHYSICAL", 42) != make_sku("DIGITAL", 42)

    def test_id_yoksa_sku_uretilmez(self):
        # SKU `id`'ye bağlı olduğu için satır INSERT edilmeden üretilemez;
        # 0/None ile çağrı bir programlama hatasıdır, sessiz kalmamalı.
        with pytest.raises(ValueError):
            make_sku("PHYSICAL", 0)


# ──────────────────── Stok yeterliliği (Karar 5) ────────────────────
# `has_shortage`, iki yerin AYNI aritmetiği kullanmasını sağlar:
# `_finalize_paid`'deki claim öncesi ön kontrol ve `apply_movement`'ın
# negatiflik kontrolü. Ayrışırlarsa biri "yeter" derken diğeri patlar.

class TestHasShortage:
    @pytest.mark.parametrize(
        "mevcut,gereken,beklenen",
        [
            (10, 2, False),
            (2, 2, False),   # tam sınır: kalan 0, eksik DEĞİL
            (1, 2, True),
            (0, 1, True),
            (0, 0, False),
        ],
    )
    def test_sinirlar(self, mevcut, gereken, beklenen):
        assert has_shortage(mevcut, gereken) is beklenen

    def test_stok_takibi_kapali_urun_eksik_saymaz(self):
        # stock IS NULL = "bu ürünün stoğu takip edilmiyor" (dijital ürün).
        # Eksik saymak, satılabilir dijital ürünü kilitlerdi.
        #
        # DİKKAT: bu, SEPET okumasının semantiğidir. Defter tarafında aynı durum
        # `StockNotTracked` ile REDDEDİLİR (§3g0) — takip edilmeyen bir bakiyeye
        # hareket yazmak anlamsızdır. İki farklı soru, iki farklı cevap.
        assert has_shortage(None, 5) is False


# ─────────────────── Gerekçe zorunluluğu (Karar 8) ───────────────────

class TestValidateReason:
    def test_admin_duzeltmesi_beyaz_listeden_secer(self):
        for kod in ADMIN_ADJUSTMENT_REASONS:
            validate_reason(StockMovementType.ADMIN_ADJUSTMENT, kod, note="x")

    def test_admin_duzeltmesinde_liste_disi_kod_reddedilir(self):
        with pytest.raises(ValueError):
            validate_reason(StockMovementType.ADMIN_ADJUSTMENT, "CANIM_ISTEDI", note=None)

    def test_admin_duzeltmesinde_gerekce_zorunlu(self):
        with pytest.raises(ValueError):
            validate_reason(StockMovementType.ADMIN_ADJUSTMENT, None, note=None)

    def test_diger_gerekcesinde_not_zorunlu(self):
        # "DIGER" tek başına hiçbir şey açıklamaz; açıklamayı not taşır.
        with pytest.raises(ValueError):
            validate_reason(StockMovementType.ADMIN_ADJUSTMENT, "DIGER", note=None)
        with pytest.raises(ValueError):
            validate_reason(StockMovementType.ADMIN_ADJUSTMENT, "DIGER", note="   ")
        validate_reason(StockMovementType.ADMIN_ADJUSTMENT, "DIGER", note="depo sayımı")

    @pytest.mark.parametrize(
        "tip,kod",
        [
            (StockMovementType.OPENING_BALANCE, "MIGRATION_OPENING"),
            (StockMovementType.INITIAL, "PRODUCT_CREATE"),
            (StockMovementType.INITIAL, "CSV_IMPORT"),
            (StockMovementType.SALE, "ORDER_PAID"),
            (StockMovementType.SALE_CANCEL, "ORDER_CANCELLED"),
            (StockMovementType.SALE_CANCEL, "ORDER_REFUNDED"),
            (StockMovementType.RETURN, "RETURN_ACCEPTED"),
        ],
    )
    def test_sistem_tipleri_sabit_kod_tasir(self, tip, kod):
        validate_reason(tip, kod, note=None)

    def test_sistem_tipinde_gerekce_bos_birakilamaz(self):
        # reason_code NOT NULL: her hareket kendini açıklar.
        with pytest.raises(ValueError):
            validate_reason(StockMovementType.SALE, None, note=None)

    def test_sistem_tipinde_yanlis_kod_reddedilir(self):
        with pytest.raises(ValueError):
            validate_reason(StockMovementType.SALE, "RETURN_ACCEPTED", note=None)


# ───────────────── Idempotency anahtarları (Karar 7) ─────────────────

class TestIdempotencyKey:
    def test_satis_urun_basina(self):
        # Sipariş+ürün granülerliği, aynı ürünün iki sipariş satırında
        # geçmesi hâlinde adetlerin TOPLANMASINI zorunlu kılar.
        assert (
            idempotency_key_for(StockMovementType.SALE, order_id=17, product_id=5)
            == "order:17:product:5:SALE"
        )

    def test_iptal_satistan_ayri_anahtar(self):
        satis = idempotency_key_for(StockMovementType.SALE, order_id=17, product_id=5)
        iptal = idempotency_key_for(
            StockMovementType.SALE_CANCEL, order_id=17, product_id=5
        )
        assert iptal == "order:17:product:5:SALE_CANCEL"
        assert iptal != satis

    def test_iade_satir_bazli(self):
        # Kısmi iadede idempotency kaynağı iade SATIRIdır (OrderReturnItem.id):
        # aynı üründen iki iade satırı iki GEÇERLİ harekettir.
        a = idempotency_key_for(StockMovementType.RETURN, return_item_id=101)
        b = idempotency_key_for(StockMovementType.RETURN, return_item_id=102)
        assert a == "return_line:101:RETURN"
        assert a != b

    def test_ilk_stok_urun_basina(self):
        assert (
            idempotency_key_for(StockMovementType.INITIAL, product_id=5)
            == "product:5:INITIAL"
        )

    def test_acilis_bakiyesi_migration_kaynagini_tasir(self):
        assert (
            idempotency_key_for(
                StockMovementType.OPENING_BALANCE, product_id=5, revision="abc123"
            )
            == "migration:abc123:product:5"
        )

    def test_admin_duzeltmesinin_dogal_anahtari_yok(self):
        # Her elle düzeltme ayrı bir olaydır. Çift tıklama zaten doğal olarak
        # idempotenttir: hedef mutlak verilir, delta kilit altında hesaplanır,
        # ikinci istekte delta 0 çıkar ve satır yazılmaz.
        assert idempotency_key_for(StockMovementType.ADMIN_ADJUSTMENT) is None

    def test_eksik_parametre_sessizce_kabul_edilmez(self):
        # "order:None:product:5" gibi bir anahtar iki farklı işlemi
        # çakıştırabilirdi.
        with pytest.raises(ValueError):
            idempotency_key_for(StockMovementType.SALE, product_id=5)
        with pytest.raises(ValueError):
            idempotency_key_for(StockMovementType.RETURN)
        with pytest.raises(ValueError):
            idempotency_key_for(StockMovementType.OPENING_BALANCE, product_id=5)


# ─────────────────── Zincir doğrulaması (Karar 9) ───────────────────
# rows: kronolojik (id, qty_delta, qty_after) üçlüleri.

class TestVerifyChain:
    def test_bos_defter_stok_sifirsa_tutarli(self):
        assert verify_chain([], current_stock=0).consistent is True

    def test_bos_defter_stok_varsa_tutarsiz(self):
        # Defteri olmayan bir bakiye, açıklanamayan bakiyedir.
        sonuc = verify_chain([], current_stock=7)
        assert sonuc.consistent is False

    def test_tutarli_zincir(self):
        rows = [(1, 10, 10), (2, -2, 8), (3, 5, 13)]
        sonuc = verify_chain(rows, current_stock=13)
        assert sonuc.consistent is True
        assert sonuc.first_divergent_id is None

    def test_kopuk_halka_ilk_sapmayi_bildirir(self):
        # 2. satır 10-2=8 olmalıyken 9 yazmış.
        rows = [(1, 10, 10), (2, -2, 9), (3, 5, 14)]
        sonuc = verify_chain(rows, current_stock=14)
        assert sonuc.consistent is False
        assert sonuc.first_divergent_id == 2

    def test_son_bakiye_urun_stogundan_sapiyorsa(self):
        # Zincir kendi içinde tutarlı ama products.stock elle değiştirilmiş.
        rows = [(1, 10, 10), (2, -2, 8)]
        sonuc = verify_chain(rows, current_stock=99)
        assert sonuc.consistent is False

    def test_ilk_satir_sifirdan_baslamak_zorunda(self):
        # İlk hareket qty_delta == qty_after olmalı (öncesi yok).
        rows = [(1, 3, 10)]
        sonuc = verify_chain(rows, current_stock=10)
        assert sonuc.consistent is False
        assert sonuc.first_divergent_id == 1

    def test_sifir_delta_yalniz_acilis_bakiyesinde_beklenir(self):
        # OPENING_BALANCE stoğu 0 olan ürün için de satır yazar (zincirin
        # tabanı olsun diye); bu satır zinciri bozmaz.
        rows = [(1, 0, 0), (2, 4, 4)]
        assert verify_chain(rows, current_stock=4).consistent is True


# ────────────────────────── İstisnalar ──────────────────────────

class TestPayloadDifferences:
    """Idempotency payload karşılaştırması — `apply_movement` ve `apply_many`
    AYNI fonksiyonu kullanır; ayrışırlarsa biri çelişkiyi görürken diğeri
    görmez."""

    def test_karsilastirilan_alanlar_tam(self):
        # Karar 2 (rev. 3): actor ve reason_code da karşılaştırmaya girer.
        assert IDEMPOTENCY_PAYLOAD_FIELDS == (
            "product_id",
            "qty_delta",
            "movement_type",
            "reason_code",
            "ref_type",
            "ref_id",
            "ref_line_id",
            "actor_type",
            "actor_id",
        )

    def _spec(self, **over):
        temel = dict(
            product_id=5,
            qty_delta=-2,
            movement_type=StockMovementType.SALE,
            reason_code="ORDER_PAID",
            ref_type="order",
            ref_id=17,
            ref_line_id=None,
            actor_type="SYSTEM",
            actor_id=None,
        )
        temel.update(over)
        return temel

    def test_ayni_payload_fark_uretmez(self):
        assert payload_differences(self._spec(), self._spec()) == {}

    @pytest.mark.parametrize(
        "alan,yeni",
        [
            ("product_id", 6),
            ("qty_delta", -3),
            ("movement_type", StockMovementType.SALE_CANCEL),
            ("reason_code", "ORDER_CANCELLED"),
            ("ref_type", "order_return"),
            ("ref_id", 18),
            ("ref_line_id", 99),
            ("actor_type", "ADMIN"),
            ("actor_id", 1),
        ],
    )
    def test_her_alan_farki_yakalanir(self, alan, yeni):
        fark = payload_differences(self._spec(), self._spec(**{alan: yeni}))
        assert alan in fark
        assert fark[alan] == (self._spec()[alan], yeni)


class TestExceptions:
    def test_stok_takip_edilmiyor_istisnasi(self):
        # Dijital ürün / bakiyesi bilinmeyen ürün: sessiz atlama DEĞİL, ret.
        exc = StockNotTracked(product_id=5)
        assert exc.product_id == 5
        assert "5" in str(exc)

    def test_kismi_idempotency_durumu_eksikleri_bildirir(self):
        exc = PartialIdempotencyState(
            found_keys=["order:1:product:5:SALE"],
            missing_keys=["order:1:product:6:SALE"],
        )
        assert exc.found_keys == ["order:1:product:5:SALE"]
        assert exc.missing_keys == ["order:1:product:6:SALE"]
        # Operatör hangi hareketin eksik olduğunu mesajdan görmeli.
        assert "order:1:product:6:SALE" in str(exc)

    def test_yetersiz_stok_istisnasi_taniyici_bilgi_tasir(self):
        exc = InsufficientStock(product_id=5, current=1, qty_delta=-3)
        assert exc.product_id == 5
        assert exc.current == 1
        assert exc.qty_delta == -3
        # Operatörün mesajdan durumu anlaması gerekir.
        assert "5" in str(exc)

    def test_idempotency_catismasi_celisen_alani_soyler(self):
        exc = IdempotencyConflict(
            idempotency_key="order:17:product:5:SALE",
            conflicting_fields={"qty_delta": (-2, -3)},
        )
        assert "qty_delta" in str(exc)
        assert exc.conflicting_fields["qty_delta"] == (-2, -3)


# ────────────────────── Hareket türü kataloğu ──────────────────────

def test_hareket_turleri_tam_olarak_alti():
    # Yeni bir tür eklemek, gerekçe sözlüğünü ve admin yüzeyindeki etiketleri
    # de güncellemeyi gerektirir; sessizce büyümesin.
    assert {t.value for t in StockMovementType} == {
        "OPENING_BALANCE",
        "INITIAL",
        "SALE",
        "SALE_CANCEL",
        "RETURN",
        "ADMIN_ADJUSTMENT",
    }


def test_admin_gerekce_beyaz_listesi():
    assert ADMIN_ADJUSTMENT_REASONS == frozenset(
        {"SAYIM_FARKI", "HASAR", "KAYIP", "HATALI_GIRIS", "TEDARIK", "DIGER"}
    )
