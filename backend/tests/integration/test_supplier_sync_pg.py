"""Tedarikçi senkron servisi — GERÇEK Postgres, sahte sağlayıcı.

Ağ `FakeSupplierClient` ile kesilir (`SUPPLIER_NETWORK_DISABLED=1` ayrıca
güvence); ölçülen şey **veritabanının son durumu**: hangi satır yazıldı, hangi
bağ kuruldu, hangi bayrak kondu, hata sonrası cooldown nereye kaydı.

Neden mock yetmez: upsert idempotansı, kısmi unique index çakışması, `SET NULL`
davranışı ve advisory lock yarışı yalnız gerçek PG'de gözlenir (kök
`CLAUDE.md` § F).
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.suppliers.base import SupplierUnavailable
from core.suppliers.fake import FakeSupplierClient
from services import supplier_sync_service
from tests.integration.supplier_factory import (
    BOZUK_BARKOD,
    GECERLI_BARKODLAR,
    Fabrika,
    now,
)

GIZLI_TOKEN = "eyJhbGciOiJIUzI1NiJ9.COK-GIZLI-TOKEN.imza"


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    yield f
    await f.temizle()


def _fav(
    external_id: int,
    *,
    barcode: str | None = None,
    stock: str = "5",
    unit: str = "Adet",
    vat: str = "0.20",
    code: str | None = None,
):
    """`SupplierFavorite` üretir — sahte istemcinin döndüreceği kayıt."""
    from core.suppliers.base import SupplierFavorite

    return SupplierFavorite(
        external_id=external_id,
        code=code or f"KOD {external_id}",
        name=f"Urun {external_id}",
        brand="MARKA",
        list_price=Decimal("120.00"),
        vat_rate=Decimal(vat),
        min_order=Decimal("1"),
        has_image=True,
        stock_status="H",
        category_path="KIRTASİYE > TEST",
        opened_at=None,
        stockless=Decimal(stock) == 0,
        stock_qty=Decimal(stock),
        unit_name=unit,
        unit_multiplier=Decimal("1"),
        barcode=barcode,
    )


async def _senkron(supplier_id: int, client) -> object:
    async with AsyncSessionLocal() as s:
        from models.supplier import Supplier

        sup = await s.get(Supplier, supplier_id)
        return await supplier_sync_service.sync_stock(s, sup, client)


# ═══════════════ Upsert ═══════════════


async def test_favoriler_ilk_koşumda_yazilir(fab):
    sid = await fab.tedarikci()
    istemci = FakeSupplierClient(favorites=[_fav(1001), _fav(1002)])

    rapor = await _senkron(sid, istemci)

    assert rapor.favorites == 2
    assert rapor.new == 2
    async with AsyncSessionLocal() as s:
        n = (
            await s.execute(
                text("SELECT count(*) FROM supplier_products WHERE supplier_id = :i"),
                {"i": sid},
            )
        ).scalar_one()
    assert n == 2


async def test_ikinci_kosum_kopya_uretmez_stogu_gunceller(fab):
    """Upsert idempotansı: `uq_supplier_products_external` ihlal edilmemeli."""
    sid = await fab.tedarikci()

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, stock="5")]))
    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, stock="9")]))

    async with AsyncSessionLocal() as s:
        satirlar = (
            await s.execute(
                text(
                    "SELECT stock_qty FROM supplier_products WHERE supplier_id = :i"
                ),
                {"i": sid},
            )
        ).scalars().all()
    assert satirlar == [Decimal("9.000")]


async def test_kesirli_stok_veritabanina_kesirli_yazilir(fab):
    sid = await fab.tedarikci()
    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, stock="12.5")]))

    async with AsyncSessionLocal() as s:
        v = (
            await s.execute(
                text("SELECT stock_qty FROM supplier_products WHERE supplier_id = :i"),
                {"i": sid},
            )
        ).scalar_one()
    assert v == Decimal("12.5"), "12,5 düzine 12 düzineye yuvarlanmamalı"


async def test_favoriden_cikan_urun_isaretlenir_silinmez(fab):
    """Kayıt SİLİNMEZ: geçmiş bağ ve maliyet bilgisi yöneticinin kararına
    dayanak. Yalnız `is_favorite=false` olur ve vitrin uygunluğundan düşer."""
    sid = await fab.tedarikci()
    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001), _fav(1002)]))
    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001)]))

    async with AsyncSessionLocal() as s:
        rows = dict(
            (
                await s.execute(
                    text(
                        "SELECT external_id, is_favorite FROM supplier_products "
                        "WHERE supplier_id = :i"
                    ),
                    {"i": sid},
                )
            ).all()
        )
    assert rows == {1001: True, 1002: False}

    async with AsyncSessionLocal() as s:
        damga = (
            await s.execute(
                text(
                    "SELECT unfavorited_at FROM supplier_products "
                    "WHERE supplier_id = :i AND external_id = 1002"
                ),
                {"i": sid},
            )
        ).scalar_one()
    assert damga is not None


async def test_favoriye_geri_donen_urun_yeniden_acilir(fab):
    sid = await fab.tedarikci()
    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001)]))
    await _senkron(sid, FakeSupplierClient(favorites=[]))
    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001)]))

    async with AsyncSessionLocal() as s:
        row = (
            await s.execute(
                text(
                    "SELECT is_favorite, unfavorited_at FROM supplier_products "
                    "WHERE supplier_id = :i"
                ),
                {"i": sid},
            )
        ).one()
    assert row[0] is True
    assert row[1] is None, "geri dönen ürünün 'çıkarıldı' damgası temizlenmeli"


# ═══════════════ Otomatik bağlama (D-7) ═══════════════


async def test_barkod_eslesmesi_otomatik_bag_kurar(fab):
    sid = await fab.tedarikci()
    kod = GECERLI_BARKODLAR[0]
    pid = await fab.urun(barcode=kod)

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod)]))

    async with AsyncSessionLocal() as s:
        row = (
            await s.execute(
                text(
                    "SELECT product_id, link_source FROM supplier_products "
                    "WHERE supplier_id = :i"
                ),
                {"i": sid},
            )
        ).one()
    assert row[0] == pid
    assert row[1] == "AUTO"


async def test_isbn_eslesmesi_de_bag_kurar(fab):
    """Kitapta barkod = ISBN-13'ün EAN karşılığıdır; ürün tarafında ISBN
    dolu, `barcode` boş olabilir."""
    sid = await fab.tedarikci()
    kod = GECERLI_BARKODLAR[2]
    pid = await fab.urun(isbn=kod)

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod)]))

    sp = await fab.tedarikci_satiri(
        (await _tek_sp_id(sid))
    )
    assert sp["product_id"] == pid


async def test_tireli_isbn_de_eslesir(fab):
    sid = await fab.tedarikci()
    kod = GECERLI_BARKODLAR[2]
    pid = await fab.urun(isbn="978-605-285-647-5")
    assert kod == "9786052856475"

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod)]))

    sp = await fab.tedarikci_satiri(await _tek_sp_id(sid))
    assert sp["product_id"] == pid, "ISBN'deki tireler eşleşmeyi engellememeli"


async def test_bozuk_barkod_bag_kurmaz(fab):
    """Checksum'ı geçersiz barkodla kurulan bağ, YANLIŞ ürünün stoğunu
    vitrine yazabilir."""
    sid = await fab.tedarikci()
    await fab.urun(barcode=BOZUK_BARKOD)

    await _senkron(
        sid, FakeSupplierClient(favorites=[_fav(1001, barcode=BOZUK_BARKOD)])
    )

    sp = await fab.tedarikci_satiri(await _tek_sp_id(sid))
    assert sp["product_id"] is None
    assert sp["barcode_valid"] is False
    assert "BARKOD_BOZUK" in (sp["quarantine_flags"] or [])


async def test_coklu_eslesme_bag_kurmaz_bayraklar(fab):
    """İki ürün aynı ISBN'i taşıyabilir (farklı basım). Hangisi olduğu
    belirsizken bağ kurmak, yanlış ürünü stokta göstermektir."""
    sid = await fab.tedarikci()
    kod = GECERLI_BARKODLAR[2]
    await fab.urun(isbn=kod)
    await fab.urun(isbn=kod)

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod)]))

    sp = await fab.tedarikci_satiri(await _tek_sp_id(sid))
    assert sp["product_id"] is None
    assert "COKLU_ESLESME" in (sp["quarantine_flags"] or [])


async def test_zaten_bagli_urun_ikinci_kez_baglanmaz(fab):
    sid = await fab.tedarikci()
    kod = GECERLI_BARKODLAR[0]
    pid = await fab.urun(barcode=kod)
    await fab.tedarikci_urunu(sid, external_id=999, product_id=pid, link_source="MANUAL")

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod)]))

    async with AsyncSessionLocal() as s:
        yeni = (
            await s.execute(
                text(
                    "SELECT product_id, quarantine_flags FROM supplier_products "
                    "WHERE supplier_id = :i AND external_id = 1001"
                ),
                {"i": sid},
            )
        ).one()
    assert yeni[0] is None
    assert "URUN_ZATEN_BAGLI" in (yeni[1] or [])


async def test_elle_kurulmus_bag_otomatik_ezilmez(fab):
    """Yönetici bilinçli bağladıysa senkron onu değiştiremez."""
    sid = await fab.tedarikci()
    kod = GECERLI_BARKODLAR[0]
    elle_pid = await fab.urun()
    await fab.urun(barcode=kod)  # barkod eşleşen BAŞKA ürün
    spid = await fab.tedarikci_urunu(
        sid, external_id=1001, barcode=kod, product_id=elle_pid, link_source="MANUAL"
    )

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod)]))

    sp = await fab.tedarikci_satiri(spid)
    assert sp["product_id"] == elle_pid
    assert sp["link_source"] == "MANUAL"


async def test_silinmis_urun_eslesmeye_girmez(fab):
    sid = await fab.tedarikci()
    kod = GECERLI_BARKODLAR[0]
    pid = await fab.urun(barcode=kod)
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE products SET deleted_at = now() WHERE id = :i"), {"i": pid}
        )
        await s.commit()

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, barcode=kod)]))

    sp = await fab.tedarikci_satiri(await _tek_sp_id(sid))
    assert sp["product_id"] is None


# ═══════════════ Fiyat döngüsü ═══════════════


async def test_fiyat_senkronu_maliyeti_yazar(fab):
    from core.suppliers.base import PriceBreakdown, SupplierPrice

    sid = await fab.tedarikci()
    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001, vat="0.10")]))

    fiyat = SupplierPrice(
        external_id=1001,
        base=Decimal("208.38"),
        vat_rate=Decimal("0.10"),
        currency_id=1,
        campaign=False,
        envelope_net=Decimal("170.00"),
        breakdowns=(
            PriceBreakdown(
                sub_account_id=2,
                name="PEŞİN",
                is_default=True,
                net=Decimal("153.00"),
                discounts=(Decimal("26.58"),),
                order=1,
            ),
        ),
    )
    istemci = FakeSupplierClient(favorites=[], prices={1001: fiyat})
    async with AsyncSessionLocal() as s:
        from models.supplier import Supplier

        sup = await s.get(Supplier, sid)
        await supplier_sync_service.sync_prices(s, sup, istemci)

    sp = await fab.tedarikci_satiri(await _tek_sp_id(sid))
    assert sp["cost_net"] == Decimal("153.00")
    assert sp["cost_gross"] == Decimal("168.30"), "D-3: 153 × 1,10"
    assert sp["price_synced_at"] is not None


async def test_fiyat_yuzluk_batchlere_bolunur(fab):
    sid = await fab.tedarikci()
    favoriler = [_fav(2000 + i) for i in range(250)]
    await _senkron(sid, FakeSupplierClient(favorites=favoriler))

    istemci = FakeSupplierClient(favorites=[], prices={})
    async with AsyncSessionLocal() as s:
        from models.supplier import Supplier

        sup = await s.get(Supplier, sid)
        await supplier_sync_service.sync_prices(s, sup, istemci)

    assert [len(c) for c in istemci.price_calls] == [100, 100, 50]


# ═══════════════ Hata yolu ve devre kesici ═══════════════


async def test_hata_cooldown_uretir_ve_vadeyi_oteler(fab):
    sid = await fab.tedarikci()
    istemci = FakeSupplierClient(fail_with=SupplierUnavailable("origin 502"))

    with pytest.raises(SupplierUnavailable):
        await _senkron(sid, istemci)

    durum = await fab.tedarikci_durumu(sid)
    assert durum["consecutive_failures"] == 1
    assert durum["cooldown_until"] is not None
    assert durum["last_error"]
    assert durum["last_error_at"] is not None


async def test_ard_arda_hatalarda_cooldown_uzar(fab):
    sid = await fab.tedarikci()
    istemci = FakeSupplierClient(fail_with=SupplierUnavailable("origin 502"))

    sureler = []
    for _ in range(3):
        with pytest.raises(SupplierUnavailable):
            await _senkron(sid, istemci)
        durum = await fab.tedarikci_durumu(sid)
        sureler.append(durum["cooldown_until"])

    assert sureler[0] < sureler[1] < sureler[2], (
        "üstel geri çekilme yok — 60 sn'lik döngü düşmüş origin'i döver"
    )


async def test_basarili_kosum_sayaci_ve_cooldownu_sifirlar(fab):
    sid = await fab.tedarikci()
    with pytest.raises(SupplierUnavailable):
        await _senkron(sid, FakeSupplierClient(fail_with=SupplierUnavailable("x")))

    await _senkron(sid, FakeSupplierClient(favorites=[_fav(1001)]))

    durum = await fab.tedarikci_durumu(sid)
    assert durum["consecutive_failures"] == 0
    assert durum["cooldown_until"] is None
    assert durum["last_stock_sync_ok_at"] is not None


async def test_hata_metni_tokeni_sizdirmaz(fab):
    """D-5 / S3'ün hedefi. `last_error` panelde GÖSTERİLİR; sağlayıcının hata
    gövdesinde token'ı yansıtması bizi ifşa etmemeli."""
    sid = await fab.tedarikci(token=GIZLI_TOKEN)
    istemci = FakeSupplierClient(
        fail_with=SupplierUnavailable(f"401 gecersiz token: {GIZLI_TOKEN}")
    )

    with pytest.raises(SupplierUnavailable):
        await _senkron(sid, istemci)

    durum = await fab.tedarikci_durumu(sid)
    assert GIZLI_TOKEN not in (durum["last_error"] or "")
    assert "COK-GIZLI" not in (durum["last_error"] or "")


async def test_vade_araliktan_hesaplanir(fab):
    sid = await fab.tedarikci(stock_interval_seconds=120)
    once = now()
    await _senkron(sid, FakeSupplierClient(favorites=[]))

    durum = await fab.tedarikci_durumu(sid)
    fark = durum["next_stock_sync_at"] - once
    assert datetime.timedelta(seconds=110) < fark < datetime.timedelta(seconds=130)


# ═══════════════ D-9: açık transaction içinde ağ beklenmez ═══════════════


async def test_ag_cagrisi_sirasinda_acik_transaction_yok(fab):
    """Uzun bir HTTP çağrısını açık transaction içinde beklemek, bağlantıyı ve
    (varsa) satır kilitlerini o süre boyunca tutar; `DB_STATEMENT_TIMEOUT_MS`
    de bu yüzden tetiklenir."""
    sid = await fab.tedarikci()
    gozlem: list[bool] = []

    async with AsyncSessionLocal() as s:
        from models.supplier import Supplier

        sup = await s.get(Supplier, sid)

        def _kontrol():
            gozlem.append(s.in_transaction())

        istemci = FakeSupplierClient(favorites=[_fav(1001)], on_call=_kontrol)
        await supplier_sync_service.sync_stock(s, sup, istemci)

    assert gozlem, "sahte istemci hiç çağrılmadı — test kurgusu bozuk"
    assert not any(gozlem), "ağ çağrısı açık transaction içinde yapıldı (D-9)"


# ═══════════════ D-12: elle senkron ve kilit ═══════════════


async def test_elle_senkron_kilit_meşgulken_409(fab):
    """Döngü koşarken yönetici "Şimdi senkronla"ya basarsa iki tarama aynı
    satırları upsert etmeye çalışır."""
    from fastapi import HTTPException

    sid = await fab.tedarikci()
    admin_id = await fab.admin()

    async with AsyncSessionLocal() as kilitci:
        alindi = (
            await kilitci.scalar(
                text("SELECT pg_try_advisory_lock(:k)"),
                {"k": supplier_sync_service.LOCK_KEY},
            )
        )
        assert alindi, "test kurgusu: kilit alınamadı"
        try:
            async with AsyncSessionLocal() as s:
                from models.admin import Admin
                from models.supplier import Supplier

                sup = await s.get(Supplier, sid)
                admin = await s.get(Admin, admin_id)
                with pytest.raises(HTTPException) as hata:
                    await supplier_sync_service.sync_now(s, admin, sup, scope="stock")
            assert hata.value.status_code == 409
        finally:
            await kilitci.execute(
                text("SELECT pg_advisory_unlock(:k)"),
                {"k": supplier_sync_service.LOCK_KEY},
            )


async def test_kapali_tedarikcide_elle_senkron_400(fab):
    from fastapi import HTTPException

    sid = await fab.tedarikci(is_enabled=False)
    admin_id = await fab.admin()

    async with AsyncSessionLocal() as s:
        from models.admin import Admin
        from models.supplier import Supplier

        with pytest.raises(HTTPException) as hata:
            await supplier_sync_service.sync_now(
                s, await s.get(Admin, admin_id), await s.get(Supplier, sid),
                scope="stock",
            )
    assert hata.value.status_code == 400


async def test_tokensiz_tedarikcide_elle_senkron_400(fab):
    from fastapi import HTTPException

    sid = await fab.tedarikci(token=None)
    admin_id = await fab.admin()

    async with AsyncSessionLocal() as s:
        from models.admin import Admin
        from models.supplier import Supplier

        with pytest.raises(HTTPException) as hata:
            await supplier_sync_service.sync_now(
                s, await s.get(Admin, admin_id), await s.get(Supplier, sid),
                scope="stock",
            )
    assert hata.value.status_code == 400


async def test_cooldown_dongude_atlanir_elle_senkronda_atlanmaz(fab):
    """Cooldown otomatik döngüyü durdurur; yöneticinin bilinçli isteğini
    durdurmaz — "şimdi dene" düğmesinin anlamı budur."""
    sid = await fab.tedarikci()
    with pytest.raises(SupplierUnavailable):
        await _senkron(sid, FakeSupplierClient(fail_with=SupplierUnavailable("x")))

    async with AsyncSessionLocal() as s:
        sonuc = await supplier_sync_service.run_due(
            s, client_factory=lambda sup: FakeSupplierClient(favorites=[_fav(1001)])
        )
    assert sonuc.skipped_cooldown == 1

    async with AsyncSessionLocal() as s:
        from models.admin import Admin
        from models.supplier import Supplier

        admin_id = await fab.admin()
        rapor = await supplier_sync_service.sync_now(
            s,
            await s.get(Admin, admin_id),
            await s.get(Supplier, sid),
            scope="stock",
            client=FakeSupplierClient(favorites=[_fav(1001)]),
        )
    assert rapor.favorites == 1


# ═══════════════ D-10: audit ═══════════════


async def test_ayar_degisikligi_audite_yazilir_token_gizli(fab):
    from schemas.supplier import SupplierSettingsIn

    sid = await fab.tedarikci(token=None)
    admin_id = await fab.admin()

    async with AsyncSessionLocal() as s:
        from models.admin import Admin
        from models.supplier import Supplier

        await supplier_sync_service.update_settings(
            s,
            await s.get(Admin, admin_id),
            await s.get(Supplier, sid),
            SupplierSettingsIn(
                is_enabled=True,
                stock_interval_seconds=90,
                api_token=GIZLI_TOKEN,
                reason="ilk kurulum",
            ),
        )
        await s.commit()

    async with AsyncSessionLocal() as s:
        kayit = (
            await s.execute(
                text(
                    "SELECT action, reason, before_values::text, after_values::text "
                    "FROM audit_logs WHERE target_type = 'supplier' "
                    "AND target_id = :i ORDER BY id DESC LIMIT 1"
                ),
                {"i": sid},
            )
        ).one()
    assert kayit[0] == "supplier.settings_update"
    assert kayit[1] == "ilk kurulum"
    assert GIZLI_TOKEN not in (kayit[2] or "") + (kayit[3] or "")
    assert "token_set" in (kayit[3] or ""), (
        "token'ın GİRİLDİĞİ audit'te görünmeli — değeri değil"
    )


async def test_elle_baglama_ve_cozme_audite_yazilir(fab):
    sid = await fab.tedarikci()
    pid = await fab.urun()
    spid = await fab.tedarikci_urunu(sid, barcode=GECERLI_BARKODLAR[1])
    admin_id = await fab.admin()

    async with AsyncSessionLocal() as s:
        from models.admin import Admin
        from models.supplier import SupplierProduct

        admin = await s.get(Admin, admin_id)
        sp = await s.get(SupplierProduct, spid)
        await supplier_sync_service.link_manual(
            s, admin, sp, product_id=pid, reason="elle eslestirme"
        )
        await s.commit()

    sp_row = await fab.tedarikci_satiri(spid)
    assert sp_row["product_id"] == pid
    assert sp_row["link_source"] == "MANUAL"
    assert sp_row["linked_by_admin_id"] == admin_id

    async with AsyncSessionLocal() as s:
        from models.admin import Admin
        from models.supplier import SupplierProduct

        await supplier_sync_service.unlink(
            s,
            await s.get(Admin, admin_id),
            await s.get(SupplierProduct, spid),
            reason="yanlis eslestirme",
        )
        await s.commit()

    sp_row = await fab.tedarikci_satiri(spid)
    assert sp_row["product_id"] is None
    assert sp_row["link_source"] is None

    async with AsyncSessionLocal() as s:
        eylemler = (
            await s.execute(
                text(
                    "SELECT action FROM audit_logs "
                    "WHERE target_type = 'supplier_product' AND target_id = :i "
                    "ORDER BY id"
                ),
                {"i": spid},
            )
        ).scalars().all()
    assert eylemler == ["supplier_product.link", "supplier_product.unlink"]


async def test_dijital_urune_baglanamaz(fab):
    from fastapi import HTTPException

    sid = await fab.tedarikci()
    pid = await fab.urun(kind="DIGITAL", stock=None)
    spid = await fab.tedarikci_urunu(sid)
    admin_id = await fab.admin()

    async with AsyncSessionLocal() as s:
        from models.admin import Admin
        from models.supplier import SupplierProduct

        with pytest.raises(HTTPException) as hata:
            await supplier_sync_service.link_manual(
                s,
                await s.get(Admin, admin_id),
                await s.get(SupplierProduct, spid),
                product_id=pid,
                reason="olmaz",
            )
    assert hata.value.status_code == 400


async def test_bagli_urune_ikinci_bag_409(fab):
    from fastapi import HTTPException

    sid = await fab.tedarikci()
    pid = await fab.urun()
    await fab.tedarikci_urunu(sid, external_id=111, product_id=pid, link_source="AUTO")
    ikinci = await fab.tedarikci_urunu(sid, external_id=222)
    admin_id = await fab.admin()

    async with AsyncSessionLocal() as s:
        from models.admin import Admin
        from models.supplier import SupplierProduct

        with pytest.raises(HTTPException) as hata:
            await supplier_sync_service.link_manual(
                s,
                await s.get(Admin, admin_id),
                await s.get(SupplierProduct, ikinci),
                product_id=pid,
                reason="olmaz",
            )
    assert hata.value.status_code == 409


# ── yardımcı ──


async def _tek_sp_id(supplier_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT id FROM supplier_products WHERE supplier_id = :i "
                    "ORDER BY id DESC LIMIT 1"
                ),
                {"i": supplier_id},
            )
        ).scalar_one()
