"""İlan öne çıkarma — kayıt defteri nöbetçileri (DB'siz).

Bu dosyadaki iddiaların hepsi "bir yere eklenmesi UNUTULURSA sessizce yanlış
davranan" bağlantıları korur. Üçü de gerçek arıza sınıflarıdır:

* referans türü kayıtsızsa → para tahsil edilir, kayıt hiç oluşmaz;
* reconciler kapsamı dışındaysa → kayıp callback hiç yakalanmaz;
* advisory kilit sınıfı çakışırsa → iki alakasız iade birbirini bekler.
"""
from __future__ import annotations

import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]


def test_T23_promo_referans_turu_kayitli_ve_callback_dalinda():
    """Kayıtsız referans → `parse_reference` None → "çözülemeyen referans".

    O dalda para çekilmiştir ama hiçbir kayıt kesinleşmez ve kullanıcı
    başarısızlık sayfasına düşer.
    """
    from core.payments.iyzico import _REFERENCE_KINDS, parse_reference

    assert "promo" in _REFERENCE_KINDS
    assert parse_reference("promo:42") == ("promo", 42)

    callback = (BACKEND / "api" / "routers" / "payments.py").read_text(
        encoding="utf-8"
    )
    assert 'if kind == "promo":' in callback
    assert "tutor_promotion_service.complete_checkout" in callback


def test_T24_advisory_kilit_siniflari_TEKIL():
    """Aynı numarayı iki spec paylaşırsa iki alakasız iade birbirini bekler."""
    from services import escrow

    spec_siniflari = [
        escrow.PAYMENT_SPEC.lock_class,
        escrow.EXAM_SPEC.lock_class,
        escrow.STUDY_SPEC.lock_class,
        escrow.ORDER_SPEC.lock_class,
        escrow.RETURN_SPEC.lock_class,
        escrow.PROMOTION_SPEC.lock_class,
        escrow.EXAM_SESSION_CAPACITY_LOCK_CLASS,
        escrow.LIBRARY_CAPACITY_LOCK_CLASS,
    ]
    assert len(spec_siniflari) == len(set(spec_siniflari)), spec_siniflari


def test_T22_reconciler_promosyon_tablosunu_kapsar():
    """Taramaya eklenmeyen bir para tablosunun kayıp callback'i hiç görülmez."""
    from services import escrow, escrow_reconciler
    from models.tutor_promotion import TutorPromotion

    hedefler = dict(escrow_reconciler._REFUNDING_TARGETS)
    assert hedefler.get(TutorPromotion) is escrow.PROMOTION_SPEC

    kaynak = (BACKEND / "services" / "escrow_reconciler.py").read_text(
        encoding="utf-8"
    )
    bayat = kaynak.split("async def reconcile_stale_checkouts")[1]
    assert "TutorPromotion" in bayat
    assert "tutor_promotion_service.complete_checkout" in bayat


def test_promosyon_spec_dogrudan_satis_sozlesmesini_tasir():
    """Hak ediş yoktur: `released_at` guard'ı açık kalırsa iade hiç claim edilemez."""
    from services import escrow

    assert escrow.PROMOTION_SPEC.has_released_guard is False
    assert escrow.PROMOTION_SPEC.status_attr == "payment_status"
    assert escrow.PROMOTION_SPEC.amount_attr == "price"
    assert escrow.PROMOTION_SPEC.reference_prefix == "promo"


def test_izin_katalogu_promosyon_izinlerini_ICERIR():
    """T-21: katalogda olmayan izin SUPER_ADMIN'de bile 403 verir."""
    from core.admin_permissions import PERMISSION_CODES

    assert "promotions.view" in PERMISSION_CODES
    assert "promotions.manage" in PERMISSION_CODES


def test_paket_katalogu_fiyatlari_pozitif_ve_gun_sayilari_tekil():
    from core.promotion_packages import PROMOTION_PACKAGES, package_for

    gunler = [p.days for p in PROMOTION_PACKAGES]
    assert len(gunler) == len(set(gunler))
    assert all(p.price > 0 for p in PROMOTION_PACKAGES)
    # Uzun paket, gün başına DAHA UCUZ olmalı — aksi hâlde katalog kendi
    # içinde tutarsızdır ve arayüzdeki "avantajlı" vaadi yalan olur.
    birim = [p.price / p.days for p in PROMOTION_PACKAGES]
    assert birim == sorted(birim, reverse=True)
    assert package_for(999) is None


def test_one_cikarma_ucunda_siralama_parametresi_YOKTUR():
    """Blokta sıralama satın alınmaz: `sort`/`exam` uca hiç girmez."""
    import inspect

    from api.routers import tutors

    imza = inspect.signature(tutors.featured_tutors)
    assert "sort" not in imza.parameters
    assert "exam" not in imza.parameters
    # Filtre eşleşmesi ise ŞART: reklam, aranan dersle ilgisiz olamaz.
    for zorunlu in ("subject", "district", "mode", "q"):
        assert zorunlu in imza.parameters
