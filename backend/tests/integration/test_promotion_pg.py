"""İlan öne çıkarma — para ve görünürlük sözleşmesi (GERÇEK Postgres).

Sözleşme ve test matrisi: `docs/one-cikarma-sozlesmesi.md`.

Neden gerçek DB: yürürlük kararı `func.now()` ile DB saatinde verilen bir SQL
yüklemidir, para geçişleri koşullu UPDATE'in `rowcount`'una dayanır ve kuyruk
hesabı aynı sorgunun içindedir. Bunların hiçbiri sahte oturumla ölçülemez.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from core.promotion_packages import MAX_OPEN_PER_TUTOR, SLOT_LIMIT
from models.tutor import Tutor, TutorStatus
from models.tutor_promotion import PromotionPaymentStatus, TutorPromotion
from services import audit_service, search_service, tutor_promotion_service

pytestmark = pytest.mark.usefixtures("pg")


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _promo(promo_id: int) -> TutorPromotion:
    async with AsyncSessionLocal() as s:
        return await s.get(TutorPromotion, promo_id)


# ═══════════════════ Satın alma (S-6, S-7, S-8, S-9) ═══════════════════


async def test_T1_fiyat_istemciden_DEGIL_katalogdan_gelir(promo_fab, promo_kol_acik):
    """T-1/S-6: uç yalnız gün sayısı alır; tutar sunucuda belirlenir."""
    tutor_id = await promo_fab.tutor()
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, tutor_id)
        promo, redirect = await tutor_promotion_service.purchase(
            s, tutor, days=7, terms_accepted=True
        )
        promo_fab.promotion_ids.append(promo.id)
        assert redirect is None  # fake sağlayıcı anında kesinleştirir
        assert Decimal(str(promo.price)) == Decimal("149.00")
        assert promo.payment_status == PromotionPaymentStatus.PAID.value
        assert promo.starts_at is not None and promo.ends_at is not None
        assert (promo.ends_at - promo.starts_at).days == 7


async def test_T2_katalog_disi_gun_sayisi_reddedilir(promo_fab, promo_kol_acik):
    """T-1/S-6 ikizi: "1000 günlük paket" denemesi 422."""
    tutor_id = await promo_fab.tutor()
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, tutor_id)
        with pytest.raises(HTTPException) as exc:
            await tutor_promotion_service.purchase(
                s, tutor, days=1000, terms_accepted=True
            )
        assert exc.value.status_code == 422


async def test_T2b_fiyat_snapshot_katalog_degisse_de_sabit_kalir(
    promo_fab, promo_kol_acik, monkeypatch
):
    """T-2/S-6: geçmiş kayıt katalog fiyatından bağımsızdır."""
    tutor_id = await promo_fab.tutor()
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, tutor_id)
        promo, _ = await tutor_promotion_service.purchase(
            s, tutor, days=7, terms_accepted=True
        )
        promo_fab.promotion_ids.append(promo.id)
        promo_id = promo.id

    from core import promotion_packages

    yeni = promotion_packages.PromotionPackage(
        days=7, price=Decimal("999.00"), label="7 gün"
    )
    monkeypatch.setitem(promotion_packages._BY_DAYS, 7, yeni)

    kayit = await _promo(promo_id)
    assert Decimal(str(kayit.price)) == Decimal("149.00")


async def test_T3_onaysiz_egitmen_satin_alamaz(promo_fab, promo_kol_acik):
    """T-3/S-7: onaylanmamış ilan aramada görünmüyor; parası boşa gitmesin."""
    for durum in (TutorStatus.DRAFT, TutorStatus.PENDING_APPROVAL, TutorStatus.SUSPENDED):
        tutor_id = await promo_fab.tutor(status=durum)
        async with AsyncSessionLocal() as s:
            tutor = await s.get(Tutor, tutor_id)
            with pytest.raises(HTTPException) as exc:
                await tutor_promotion_service.purchase(
                    s, tutor, days=7, terms_accepted=True
                )
            assert exc.value.status_code == 409, durum


async def test_T4_kol_KAPALIYKEN_503_ve_kayit_olusmaz(promo_fab):
    """T-4/S-8: bayrak varsayılanı kapalı — tahsilat hiç başlamaz."""
    tutor_id = await promo_fab.tutor()
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, tutor_id)
        with pytest.raises(HTTPException) as exc:
            await tutor_promotion_service.purchase(
                s, tutor, days=7, terms_accepted=True
            )
        assert exc.value.status_code == 503
        assert exc.value.detail["code"] == "PAYMENT_BRANCH_CLOSED"

    async with AsyncSessionLocal() as s:
        sayi = (
            await s.execute(
                select(TutorPromotion).where(TutorPromotion.tutor_id == tutor_id)
            )
        ).scalars().all()
    assert sayi == []


async def test_T4b_cayma_hakki_onayi_SUNUCUDA_zorunlu(promo_fab, promo_kol_acik):
    """S-14: onay kutusu arayüz kolaylığı değil, kaydın hukuki parçası."""
    tutor_id = await promo_fab.tutor()
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, tutor_id)
        with pytest.raises(HTTPException) as exc:
            await tutor_promotion_service.purchase(
                s, tutor, days=7, terms_accepted=False
            )
        assert exc.value.status_code == 422


async def test_T5_kol_alt_uye_isyeri_GEREKTIRMEZ():
    """T-5/S-8: platform kendi reklamını satar — pazaryeri yeteneği aranmaz.

    `True` olsaydı iyzico `supports_marketplace=False` olduğu için kol üretimde
    hiç açılamazdı; bu satır sessizce yanlış konursa kimse fark etmezdi.
    """
    from services import payment_gates

    assert (
        payment_gates.BRANCH_NEEDS_MARKETPLACE[
            payment_gates.PaymentBranch.TUTOR_PROMOTION
        ]
        is False
    )


async def test_T6_aktif_varken_alinan_paket_KUYRUGA_girer(promo_fab, promo_kol_acik):
    """T-6/S-9: süreler üst üste binmez, arka arkaya eklenir."""
    tutor_id = await promo_fab.tutor()
    ilk_id = await promo_fab.promotion(tutor_id, days=7)
    ilk = await _promo(ilk_id)

    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, tutor_id)
        ikinci, _ = await tutor_promotion_service.purchase(
            s, tutor, days=30, terms_accepted=True
        )
        promo_fab.promotion_ids.append(ikinci.id)
        ikinci_id = ikinci.id

    ikinci = await _promo(ikinci_id)
    # Yeni paket ilkinin BİTİŞİNDE başlar (saniye altı fark tolere edilir).
    assert abs((ikinci.starts_at - ilk.ends_at).total_seconds()) < 1
    assert (ikinci.ends_at - ikinci.starts_at).days == 30
    # Kuyruktaki kayıt HENÜZ yürürlükte değil.
    assert not await _yururlukte_mi(ikinci_id)


async def test_T7_aktif_arti_kuyruk_doluyken_ucuncu_alim_409(
    promo_fab, promo_kol_acik
):
    """T-7/S-9: raf ömrü sınırsız satılamaz (MAX_OPEN_PER_TUTOR)."""
    tutor_id = await promo_fab.tutor()
    now = _now()
    await promo_fab.promotion(tutor_id, days=7)
    await promo_fab.promotion(
        tutor_id,
        days=30,
        starts_at=now + datetime.timedelta(days=7),
        ends_at=now + datetime.timedelta(days=37),
    )
    assert MAX_OPEN_PER_TUTOR == 2

    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, tutor_id)
        with pytest.raises(HTTPException) as exc:
            await tutor_promotion_service.purchase(
                s, tutor, days=7, terms_accepted=True
            )
        assert exc.value.status_code == 409


# ═══════════════════ Kesinleştirme (S-10, S-11, S-12) ═══════════════════


async def test_T8_cift_callback_tek_PAID_uretir_ve_sureyi_bir_kez_ekler(
    promo_fab, promo_kol_acik
):
    """T-8/S-10: `escrow.claim` atomiktir; ikinci callback yan etkisizdir."""
    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(
        tutor_id,
        payment_status=PromotionPaymentStatus.PENDING.value,
        provider_ref="cf-cift",
    )

    async with AsyncSessionLocal() as s:
        await tutor_promotion_service.complete_checkout(
            s, promotion_id=promo_id, success=True, provider_ref="cf-cift",
            token="cf-cift", paid_price=Decimal("149.00"),
        )
        # `complete_checkout` commit ETMEZ: çağıran eder (`core.database.get_db`
        # dependency'si ya da reconciler). Test de o sözleşmeyi izler.
        await s.commit()
    ilk = await _promo(promo_id)
    assert ilk.payment_status == PromotionPaymentStatus.PAID.value
    ilk_bitis = ilk.ends_at

    async with AsyncSessionLocal() as s:
        await tutor_promotion_service.complete_checkout(
            s, promotion_id=promo_id, success=True, provider_ref="cf-cift",
            token="cf-cift", paid_price=Decimal("149.00"),
        )
        await s.commit()
    ikinci = await _promo(promo_id)
    assert ikinci.ends_at == ilk_bitis  # süre İKİNCİ KEZ eklenmedi


async def test_T9_paidPrice_uyusmazsa_KESINLESMEZ_ve_iade_edilir(
    promo_fab, promo_kol_acik, monkeypatch
):
    """T-9/S-11: tahsil edilen tutar kayıtla tutmuyorsa hak doğmaz."""
    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(
        tutor_id,
        payment_status=PromotionPaymentStatus.PENDING.value,
        provider_ref="cf-tutar",
    )

    iadeler: list[tuple[str | None, Decimal]] = []

    async def sahte_iade(*, provider_ref, amount, context):
        iadeler.append((provider_ref, Decimal(str(amount))))
        return True

    from services import escrow

    monkeypatch.setattr(escrow, "refund_unexpected_charge", sahte_iade)

    async with AsyncSessionLocal() as s:
        await tutor_promotion_service.complete_checkout(
            s, promotion_id=promo_id, success=True, provider_ref="cf-tutar",
            token="cf-tutar", paid_price=Decimal("1.00"),
        )

    kayit = await _promo(promo_id)
    assert kayit.payment_status == PromotionPaymentStatus.PENDING.value
    assert kayit.starts_at is None
    assert iadeler == [("cf-tutar", Decimal("1.00"))]


@pytest.mark.parametrize(
    "durum",
    [PromotionPaymentStatus.PENDING.value, PromotionPaymentStatus.FAILED.value],
)
async def test_T10_iptal_edilmis_kayda_gelen_tahsilat_iade_akisina_girer(
    promo_fab, promo_kol_acik, durum
):
    """T-10/S-12: ölü kayda gelen para kara delikte kalmaz.

    FAILED de kapsanır: admin iptali para durumunu DEĞİŞTİRMEDİĞİ için kayıt
    `FAILED + cancelled_at` olarak durabiliyor; iade claim'i yalnız PENDING
    kabul etseydi geç doğrulanan bu tahsilat sağlayıcıda kalırdı.
    """
    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(
        tutor_id,
        payment_status=durum,
        provider_ref="cf-olu",
        cancelled_at=_now(),
    )

    async with AsyncSessionLocal() as s:
        await tutor_promotion_service.complete_checkout(
            s, promotion_id=promo_id, success=True, provider_ref="cf-olu",
            token="cf-olu", paid_price=Decimal("149.00"),
        )
        await s.commit()

    kayit = await _promo(promo_id)
    # PAID olmadı; iade akışına claim edildi (fake sağlayıcı anında başarır).
    assert kayit.payment_status == PromotionPaymentStatus.REFUNDED.value
    # Defter de yazılır: bu yol REFUNDING'de kalmadığı için reconciler onu bir
    # daha görmez; tutar burada yazılmazsa kalıcı olarak 0 kalırdı.
    assert Decimal(str(kayit.refunded_amount)) == Decimal(str(kayit.price))
    assert kayit.starts_at is None


# ═══════════════════ Yürürlük ve görünürlük (S-1, S-2, S-3) ═══════════════════


async def _yururlukte_mi(promo_id: int) -> bool:
    async with AsyncSessionLocal() as s:
        row = await s.scalar(
            select(TutorPromotion.id).where(
                TutorPromotion.id == promo_id,
                tutor_promotion_service.aktif_kosul(),
            )
        )
    return row is not None


async def test_T11_suresi_dolmus_kayit_AKTIF_SAYILMAZ(promo_fab):
    """T-11/S-2: süpürge işi olmadan, sorgu düzeyinde düşer."""
    tutor_id = await promo_fab.tutor()
    now = _now()
    promo_id = await promo_fab.promotion(
        tutor_id,
        starts_at=now - datetime.timedelta(days=10),
        ends_at=now - datetime.timedelta(minutes=1),
    )
    assert await _yururlukte_mi(promo_id) is False

    sonuc = await _featured(subjects=["Matematik"])
    assert tutor_id not in [t.id for t in sonuc]


async def test_T12_gelecekte_baslayan_kayit_AKTIF_SAYILMAZ(promo_fab):
    """T-12/S-2: kuyruktaki paket henüz görünürlük üretmez."""
    tutor_id = await promo_fab.tutor()
    now = _now()
    promo_id = await promo_fab.promotion(
        tutor_id,
        starts_at=now + datetime.timedelta(days=1),
        ends_at=now + datetime.timedelta(days=8),
    )
    assert await _yururlukte_mi(promo_id) is False
    assert tutor_id not in [t.id for t in await _featured(subjects=["Matematik"])]


async def _featured(**kwargs):
    async with AsyncSessionLocal() as s:
        return await search_service.featured_tutors(s, **kwargs)


async def test_T15_blok_en_fazla_SLOT_LIMIT_kart_dondurur(promo_fab):
    """T-15/S-3: aday sayısı slottan fazlaysa liste yine de taşmaz."""
    ids = []
    for _ in range(SLOT_LIMIT + 2):
        tutor_id = await promo_fab.tutor()
        await promo_fab.promotion(tutor_id)
        ids.append(tutor_id)

    sonuc = await _featured(subjects=["Matematik"])
    assert len(sonuc) <= SLOT_LIMIT
    assert all(t.id in ids for t in sonuc)


async def test_T16_filtre_eslesmesi_uygulanir(promo_fab):
    """T-16/S-3: Fizik arayan öğrenci, Matematik reklamı görmez."""
    mat_id = await promo_fab.tutor(subjects=("Matematik",))
    await promo_fab.promotion(mat_id)
    fiz_id = await promo_fab.tutor(subjects=("Fizik",))
    await promo_fab.promotion(fiz_id)

    fizik = [t.id for t in await _featured(subjects=["Fizik"])]
    assert fiz_id in fizik
    assert mat_id not in fizik


async def test_T17_ASKIYA_ALINMIS_egitmen_odemis_olsa_da_blokta_CIKMAZ(promo_fab):
    """T-17/S-3: ödenmiş paket görünürlük kapısını ATLATAMAZ."""
    tutor_id = await promo_fab.tutor(status=TutorStatus.APPROVED)
    await promo_fab.promotion(tutor_id)
    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, tutor_id)
        tutor.status = TutorStatus.SUSPENDED
        await s.commit()

    assert tutor_id not in [t.id for t in await _featured(subjects=["Matematik"])]


async def test_T18_eslesme_yoksa_bos_liste(promo_fab):
    """T-18/S-3: blok yalnız gerçekten aday varsa çizilir."""
    tutor_id = await promo_fab.tutor(subjects=("Matematik",))
    await promo_fab.promotion(tutor_id)
    assert await _featured(subjects=["Almanca"]) == []


async def test_T19_promosyon_organik_SIRALAMAYI_degistirmez(promo_fab):
    """T-19/S-1: para, puan sıralamasına hiçbir noktada girmez."""
    dusuk = await promo_fab.tutor()
    yuksek = await promo_fab.tutor()
    async with AsyncSessionLocal() as s:
        y = await s.get(Tutor, yuksek)
        y.rating_count = 20
        y.rating_sum = 100  # 5.0 ortalama
        await s.commit()

    async with AsyncSessionLocal() as s:
        oncesi = [
            t.id
            for t in await search_service.search_tutors(s, subjects=["Matematik"])
            if t.id in (dusuk, yuksek)
        ]

    # Düşük puanlı eğitmen paketi satın alıyor.
    await promo_fab.promotion(dusuk)

    async with AsyncSessionLocal() as s:
        sonrasi = [
            t.id
            for t in await search_service.search_tutors(s, subjects=["Matematik"])
            if t.id in (dusuk, yuksek)
        ]

    assert oncesi == sonrasi
    assert sonrasi[0] == yuksek


async def test_T20_arama_ve_histogram_AYNI_kumeyi_gorur(promo_fab):
    """T-20/S-1: ortak filtre yardımcısı iki yolu ayrıştırmamalı.

    Filtreler eskiden elle ikizlenmişti; ayrıştıklarında histogramın gösterdiği
    fiyat dağılımı listedeki eğitmenlere ait olmuyordu. Bu test o eşitliği
    ölçer — kaynak okumaz, DAVRANIŞ karşılaştırır.
    """
    await promo_fab.tutor(district="Seyhan", hourly_rate=Decimal("200.00"))
    await promo_fab.tutor(district="Seyhan", hourly_rate=Decimal("400.00"))
    await promo_fab.tutor(district="Çukurova", hourly_rate=Decimal("300.00"))

    async with AsyncSessionLocal() as s:
        filtre = {"subjects": ["Matematik"], "districts": ["Seyhan"]}
        liste = await search_service.search_tutors(s, limit=100, **filtre)
        dagilim = await search_service.price_histogram(s, **filtre)

    ucreti_olan = [t for t in liste if t.hourly_rate is not None]
    assert len(ucreti_olan) == len(dagilim)
    assert sorted(float(t.hourly_rate) for t in ucreti_olan) == sorted(dagilim)


async def test_T20b_histogram_fiyat_filtresini_UYGULAMAZ(promo_fab):
    """Bilinçli tek fark: aralık daraltılsa da dağılımın tamamı gösterilir."""
    await promo_fab.tutor(district="Ceyhan", hourly_rate=Decimal("200.00"))
    await promo_fab.tutor(district="Ceyhan", hourly_rate=Decimal("900.00"))

    async with AsyncSessionLocal() as s:
        filtre = {"subjects": ["Matematik"], "districts": ["Ceyhan"]}
        dar = await search_service.search_tutors(
            s, limit=100, max_rate=Decimal("300.00"), **filtre
        )
        dagilim = await search_service.price_histogram(s, **filtre)

    assert len(dar) == 1
    assert len(dagilim) == 2


# ═══════════════════ Admin iptali (S-14) ═══════════════════


async def test_T14_admin_iptali_kaydi_ANINDA_dusurur_ve_iade_baslatir(promo_fab):
    """T-14/S-14: `cancelled_at` iade sağlayıcıdan dönmeden önce yazılır."""
    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(tutor_id)
    assert await _yururlukte_mi(promo_id) is True

    async with AsyncSessionLocal() as s:
        await tutor_promotion_service.cancel_by_admin(
            s, promo_id, reason="Yanlis islem"
        )

    kayit = await _promo(promo_id)
    assert kayit.cancelled_at is not None
    assert kayit.payment_status in (
        PromotionPaymentStatus.REFUNDED.value,
        PromotionPaymentStatus.REFUNDING.value,
    )
    assert await _yururlukte_mi(promo_id) is False
    assert tutor_id not in [t.id for t in await _featured(subjects=["Matematik"])]


async def test_T14b_ayni_kayit_iki_kez_iptal_edilemez(promo_fab):
    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(tutor_id)
    async with AsyncSessionLocal() as s:
        await tutor_promotion_service.cancel_by_admin(s, promo_id, reason="ilk")
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await tutor_promotion_service.cancel_by_admin(s, promo_id, reason="ikinci")
        assert exc.value.status_code == 409


# ═══════════ Admin iptali: atomiklik, audit ve bildirim (para akışı) ═══════════
#
# Bu blok tek bir arıza sınıfını kapatır: iptal damgası ile iade niyeti AYRI
# commit'lerde yazıldığında, araya düşen bir çökme "cancelled ama hâlâ PAID"
# yetim kaydı bırakıyordu. Reconciler yalnız REFUNDING tarar, yeniden deneme ise
# `cancelled_at` dolu olduğu için 409 alırdı: para kurumda kalır, görünürlük
# kapanmıştır ve kimse haberdar olmaz.


class _Aktor:
    """`audit_service.record` yalnız `id`/`role_id` okur; audit_logs FK taşımaz."""

    def __init__(self, id: int = 1, role_id: int = 1) -> None:
        self.id = id
        self.role_id = role_id


async def _audit_sayisi(promo_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM audit_logs"
                    " WHERE action = 'promotion.cancel' AND target_id = :i"
                ),
                {"i": promo_id},
            )
        ).scalar_one()


async def _bildirim_sayisi(tutor_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM notifications WHERE user_id = :t"
                    " AND role_id = 2 AND message LIKE '%iade ediliyor%'"
                ),
                {"t": tutor_id},
            )
        ).scalar_one()


async def _audit_temizle(promo_id: int) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "DELETE FROM audit_logs WHERE action = 'promotion.cancel'"
                " AND target_id = :i"
            ),
            {"i": promo_id},
        )
        await s.commit()


async def _iptal_et(promo_id: int, *, reason: str = "test", aktor=None):
    """Router'ın sırasını birebir taklit eder: audit ÖNCE stage edilir."""
    async with AsyncSessionLocal() as s:
        await audit_service.record(
            s,
            actor=aktor or _Aktor(),
            action="promotion.cancel",
            target_type="tutor_promotion",
            target_id=promo_id,
            reason=reason,
        )
        try:
            return await tutor_promotion_service.cancel_by_admin(
                s, promo_id, reason=reason
            )
        except HTTPException:
            # `get_db` istisnada rollback eder; stage edilmiş audit de silinir.
            await s.rollback()
            raise


async def test_T14c_saglayici_patlarsa_kayit_cancelled_REFUNDING_kalir(
    promo_fab, provider
):
    """Faz 1 kalıcı, faz 2 başarısız: yetim (cancelled + PAID) kayıt DOĞMAZ."""
    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(tutor_id)
    provider.refund_result = False  # sağlayıcı iadeyi reddetti

    await _iptal_et(promo_id, reason="saglayici testi")

    kayit = await _promo(promo_id)
    assert kayit.cancelled_at is not None
    # PAID'e ASLA geri dönülmez; reconciler'ın tarayabileceği durumda kalır.
    assert kayit.payment_status == PromotionPaymentStatus.REFUNDING.value
    assert kayit.refund_requested_at is not None
    assert kayit.refund_attempts == 1
    assert await _yururlukte_mi(promo_id) is False
    # İade kesinleşmediği için defter tutarı da yazılmaz.
    assert Decimal(str(kayit.refunded_amount)) == Decimal("0")
    # Denetim izi kazanan geçişin commit'ine bindi.
    assert await _audit_sayisi(promo_id) == 1
    await _audit_temizle(promo_id)


async def test_T14c2_basarili_iptalde_iade_tutari_deftere_yazilir(promo_fab, provider):
    """REFUNDED ama `refunded_amount = 0` satırı mutabakatı yanıltırdı."""
    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(tutor_id)
    provider.refund_result = True
    try:
        await _iptal_et(promo_id, reason="defter")
        kayit = await _promo(promo_id)
        assert kayit.payment_status == PromotionPaymentStatus.REFUNDED.value
        assert Decimal(str(kayit.refunded_amount)) == Decimal(str(kayit.price))
    finally:
        await _audit_temizle(promo_id)


async def test_T14d_sarkan_iade_reconciler_tarafindan_tamamlanir(promo_fab, provider):
    """T-14c'nin devamı: kayıt otomatik telafi yolundan çıkmaz."""
    from services import escrow_reconciler

    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(tutor_id)
    provider.refund_result = False
    await _iptal_et(promo_id)
    assert (await _promo(promo_id)).payment_status == (
        PromotionPaymentStatus.REFUNDING.value
    )

    # Karantina penceresini geçir ve sağlayıcıyı ayağa kaldır.
    async with AsyncSessionLocal() as s:
        await s.execute(
            text(
                "UPDATE tutor_promotions SET refund_requested_at ="
                " now() - interval '2 hours' WHERE id = :i"
            ),
            {"i": promo_id},
        )
        await s.commit()
    provider.refund_result = True
    provider.refund_calls.clear()

    async with AsyncSessionLocal() as s:
        await escrow_reconciler.reconcile_refunding(s)

    kayit = await _promo(promo_id)
    assert kayit.payment_status == PromotionPaymentStatus.REFUNDED.value
    assert kayit.cancelled_at is not None
    assert len(provider.refund_calls) == 1
    # Telafi yolu canlı istekle AYNI sonucu üretir: tutar deftere yazılır.
    assert Decimal(str(kayit.refunded_amount)) == Decimal(str(kayit.price))
    await _audit_temizle(promo_id)


async def test_T14e_es_zamanli_iki_iptalden_YALNIZ_biri_kazanir(promo_fab, provider):
    """Kaybeden 409 alır: ikinci sağlayıcı isteği, bildirimi ve audit'i YOK."""
    import asyncio

    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(tutor_id)
    provider.refund_result = True

    sonuclar = await asyncio.gather(
        _iptal_et(promo_id, reason="a"),
        _iptal_et(promo_id, reason="b"),
        return_exceptions=True,
    )
    hatalar = [r for r in sonuclar if isinstance(r, HTTPException)]
    basarililar = [r for r in sonuclar if not isinstance(r, Exception)]
    assert len(basarililar) == 1, "iki taraf da kazandı — atomik claim kırık"
    assert len(hatalar) == 1 and hatalar[0].status_code == 409

    assert len(provider.refund_calls) == 1
    assert await _audit_sayisi(promo_id) == 1
    assert await _bildirim_sayisi(tutor_id) == 1
    await _audit_temizle(promo_id)


@pytest.mark.parametrize(
    "durum",
    [PromotionPaymentStatus.PENDING.value, PromotionPaymentStatus.FAILED.value],
)
async def test_T14f_tahsilatsiz_iptalde_para_yolu_hic_acilmaz(
    promo_fab, provider, durum
):
    """PENDING/FAILED: kayıt kapanır ama iade niyeti ve bildirim ÜRETİLMEZ."""
    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(tutor_id, payment_status=durum)
    provider.refund_calls.clear()

    await _iptal_et(promo_id, reason="tahsilatsiz")

    kayit = await _promo(promo_id)
    assert kayit.cancelled_at is not None
    # Para durumu DEĞİŞMEZ: REFUNDING'e geçirilmez.
    assert kayit.payment_status == durum
    assert kayit.refund_requested_at is None
    assert kayit.refund_attempts == 0
    assert provider.refund_calls == []
    assert await _bildirim_sayisi(tutor_id) == 0
    assert await _audit_sayisi(promo_id) == 1
    await _audit_temizle(promo_id)


async def test_T14g_ikinci_iptal_409_ve_EK_YAN_ETKI_URETMEZ(promo_fab, provider):
    """Sonuçlanmış kayda ikinci iptal: ERKEN guard 409 verir, yan etki bırakmaz.

    Atomik claim'in KAYBEDİLDİĞİ dal T14e'de ölçülür; burada ölçülen, önceden
    iptal edilmiş kaydın `cancelled_at` guard'ında durdurulması ve stage edilen
    audit satırının rollback'te gitmesidir.
    """
    tutor_id = await promo_fab.tutor()
    promo_id = await promo_fab.promotion(tutor_id)
    provider.refund_result = True

    await _iptal_et(promo_id, reason="ilk")
    ilk_cagri = len(provider.refund_calls)
    with pytest.raises(HTTPException) as exc:
        await _iptal_et(promo_id, reason="ikinci")
    assert exc.value.status_code == 409

    assert len(provider.refund_calls) == ilk_cagri
    assert await _audit_sayisi(promo_id) == 1
    assert await _bildirim_sayisi(tutor_id) == 1
    await _audit_temizle(promo_id)
