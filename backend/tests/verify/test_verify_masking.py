"""Anti-disintermediation maskesi — gerçek servis katmanı, gerçek DB.

Maske eskiden yalnız mesajlaşma, ders yorumu ve kaynak başlığında vardı.
Yani bir eğitmen hiç mesajlaşmadan, sadece BİYOGRAFİSİNE numara yazarak
öğrenciyi platform dışına çıkarabiliyordu — komisyon da, ödeme koruması da
devre dışı kalıyordu.

Burada yüzeylerin gerçekten maskelendiği ve yıl aralığı gibi meşru metinlerin
bozulmadığı doğrulanır (birim testler saf fonksiyonu ölçer; bu paket fonksiyonun
o yüzeye BAĞLANDIĞINI ölçer — asıl kaçırılan şey bağlantıydı).
"""
from __future__ import annotations

import pytest

TELEFON = "0532 123 45 67"
GECMIS = "2018 - 2022 Çukurova Üniversitesi"


async def test_egitmen_biyografisi_maskelenir(db, factory):
    from models.tutor import TutorStatus
    from schemas.tutor import TutorProfileUpdate
    from services import tutor_service

    tutor = await factory.tutor(db, status=TutorStatus.DRAFT)
    await tutor_service.update_profile(
        db,
        tutor,
        TutorProfileUpdate(
            headline=(
                "Adana Seyhan bölgesinde deneyimli matematik ve geometri "
                "özel ders öğretmeni"
            ),
            bio=f"{GECMIS} mezunuyum. Bana {TELEFON} numarasından ulaşın.",
            lesson_info=f"Ders öncesi {TELEFON} yazın.",
        ),
    )

    assert TELEFON not in tutor.bio
    assert "[gizlendi]" in tutor.bio
    # Meşru metin korunmalı: eğitim geçmişi biyografilerin çoğunda vardır.
    assert "2018 - 2022 Çukurova Üniversitesi" in tutor.bio
    assert "[gizlendi]" in tutor.lesson_info


async def test_ogrenci_talebi_maskelenir(db, factory):
    from schemas.demand import DemandCreate
    from services import demand_service

    client = await factory.client(db)
    demand = await demand_service.create_demand(
        db,
        client,
        DemandCreate(
            title=f"Matematik özel ders arıyorum {TELEFON}",
            description=f"Hafta içi uygunum, {TELEFON} numaralı telefondan arayın.",
            subject="Matematik",
        ),
    )

    assert TELEFON not in demand.title
    assert TELEFON not in (demand.description or "")
    assert "[gizlendi]" in demand.description


async def test_urun_yorumu_maskelenir(db, factory):
    from schemas.store import ProductReviewCreate
    from services import store_service

    client = await factory.client(db)
    product = await factory.product(db)
    # Ürün yorumu satın-alma-gatelidir: ödenmiş bir sipariş gerekir.
    await factory.order(
        db, client=client, items=[(product, 1)], payment_status="PAID", status="PAID"
    )
    await db.commit()

    await store_service.create_review(
        db,
        product_id=product.id,
        client=client,
        payload=ProductReviewCreate(
            rating=5, comment_text=f"Çok iyi kaynak, sorularınız için {TELEFON}"
        ),
    )

    from sqlalchemy import text

    stored = (
        await db.execute(
            text(
                "SELECT comment_text FROM product_reviews "
                "WHERE product_id = :p ORDER BY id DESC LIMIT 1"
            ),
            {"p": product.id},
        )
    ).scalar()
    assert stored is not None
    assert TELEFON not in stored
    assert "[gizlendi]" in stored


@pytest.mark.parametrize(
    "metin",
    [
        "2020 - 2024 arası lisans eğitimi aldım.",
        "Ders saatlerim 14:00 - 16:00 arasındadır.",
        "Ücret 1.250,00 TL",
    ],
)
async def test_mesru_metinler_bozulmaz(db, factory, metin):
    """Yanlış pozitif regresyonu: maske profil metinlerine yayıldığı için
    ürünü sessizce bozma riski en yüksek olan yer burasıdır."""
    from models.tutor import TutorStatus
    from schemas.tutor import TutorProfileUpdate
    from services import tutor_service

    tutor = await factory.tutor(db, status=TutorStatus.DRAFT)
    await tutor_service.update_profile(db, tutor, TutorProfileUpdate(bio=metin))
    assert tutor.bio == metin
