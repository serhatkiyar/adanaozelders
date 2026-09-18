"""Kök SEO adres kaydı — yazma ve okuma (`seo_slugs`).

Saf kurallar `core/seo_adres.py`'de; burası yalnız veritabanıyla konuşur.
Sayfa içeriği (ders/ilçe sayfası, ön-çizim) `seo_sayfa_service`'tedir.
"""
from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from core import seo_adres
from models.seo_slug import SeoSlug
from models.subject import Subject
from models.tutor import Tutor, TutorStatus


def yayinda_kosulu():
    """Eğitmenin herkese açık görünmesi için gereken koşul (arama ile aynı)."""
    return (
        Tutor.status == TutorStatus.APPROVED,
        Tutor.is_active.is_(True),
        Tutor.deleted_at.is_(None),
    )


def yayinda_mi(tutor: Tutor) -> bool:
    return (
        tutor.status == TutorStatus.APPROVED
        and bool(tutor.is_active)
        and tutor.deleted_at is None
    )


async def ilan_slugu(db: AsyncSession, tutor_id: int) -> str | None:
    """Eğitmenin güncel ilan adresi (yoksa None)."""
    return (
        await db.execute(
            select(SeoSlug.slug).where(
                SeoSlug.kind == "ilan",
                SeoSlug.tutor_id == tutor_id,
                SeoSlug.is_current.is_(True),
            )
        )
    ).scalar_one_or_none()


async def ilan_sluglari(db: AsyncSession, tutor_ids: list[int]) -> dict[int, str]:
    """Toplu okuma: {tutor_id: güncel ilan adresi}. Liste başına TEK sorgu."""
    if not tutor_ids:
        return {}
    satirlar = (
        await db.execute(
            select(SeoSlug.tutor_id, SeoSlug.slug).where(
                SeoSlug.kind == "ilan",
                SeoSlug.tutor_id.in_(set(tutor_ids)),
                SeoSlug.is_current.is_(True),
            )
        )
    ).all()
    return {tid: slug for tid, slug in satirlar}


async def url_slug_doldur(db: AsyncSession, kayitlar) -> None:
    """`TutorSearchOut` listesine `url_slug` alanını yerleştirir (yerinde)."""
    kayitlar = list(kayitlar)
    harita = await ilan_sluglari(db, [k.id for k in kayitlar])
    for k in kayitlar:
        k.url_slug = harita.get(k.id)


async def _dolu_sluglar(db: AsyncSession, taban: str) -> set[str]:
    """`taban` ve `taban-N` biçimindeki DOLU adresler (tarihçe dahil)."""
    return set(
        (
            await db.execute(
                select(SeoSlug.slug).where(
                    (SeoSlug.slug == taban) | SeoSlug.slug.like(f"{taban}-%")
                )
            )
        ).scalars()
    )


async def ilan_slug_ata(db: AsyncSession, tutor: Tutor) -> str:
    """Eğitmene ilan adresi verir; zaten varsa DOKUNMADAN onu döndürür.

    Yayına alınan her yoldan (admin onayı, pasiften aktife dönüş) çağrılır ve
    idempotenttir. Adres İLK yayında sabitlenir: başlık sonradan düzeltilince
    yeniden üretilmez — paylaşılmış linkler ve Google'daki kayıt kırılmasın.
    """
    mevcut = await ilan_slugu(db, tutor.id)
    if mevcut:
        return mevcut
    taban = seo_adres.ilan_slug_tabani(tutor.headline, tutor.district)
    # Aynı başlıklı iki ilan AYNI ANDA onaylanırsa ikisi de aynı boş adayı
    # görebilir; kaybeden taraf savepoint içinde geri alınıp bir sonraki eki
    # dener (dış işlem bozulmaz).
    for _ in range(5):
        slug = seo_adres.benzersiz_yap_kume(taban, await _dolu_sluglar(db, taban))
        try:
            async with db.begin_nested():
                db.add(
                    SeoSlug(slug=slug, kind="ilan", tutor_id=tutor.id, is_current=True)
                )
            return slug
        except IntegrityError:
            mevcut = await ilan_slugu(db, tutor.id)
            if mevcut:
                return mevcut
    raise RuntimeError(f"ilan adresi üretilemedi: {taban}")


async def ders_ilce_adreslerini_esitle(db: AsyncSession) -> None:
    """Ders ve ilçe adres satırlarını katalogla eşitler (idempotent, ucuz).

    * Silinmemiş her ders için `<slug>-ozel-ders` satırı yoksa eklenir.
    * Ders slug'ı değişmişse eski satır tarihçeye düşer (`is_current=false`)
      ve yenisi güncel olur — eski adres yeni adrese yönlenir.
    * 15 ilçe satırı yoksa eklenir.

    Yayın yollarından ve sitemap üretiminden çağrılır; böylece sonradan
    eklenen bir ders ayrı bir komut beklemeden adres kazanır.
    """
    dersler = (
        await db.execute(
            select(Subject.id, Subject.slug).where(Subject.deleted_at.is_(None))
        )
    ).all()
    beklenen = {
        sid: seo_adres.ders_sayfasi_slugu(slug)
        for sid, slug in dersler
        if slug and seo_adres.gecerli_slug_mi(slug)
    }
    mevcut = (
        await db.execute(
            select(SeoSlug.id, SeoSlug.subject_id, SeoSlug.slug, SeoSlug.is_current).where(
                SeoSlug.kind == "ders"
            )
        )
    ).all()
    dolu = {slug for _, _, slug, _ in mevcut}
    eskiye_dusecek = [
        rid
        for rid, sid, slug, guncel in mevcut
        if guncel and sid in beklenen and beklenen[sid] != slug
    ]
    if eskiye_dusecek:
        await db.execute(
            update(SeoSlug)
            .where(SeoSlug.id.in_(eskiye_dusecek))
            .values(is_current=False)
        )
    # Eski slug'a geri dönülen dersin tarihçe satırı yeniden güncel olur.
    geri_donen = [
        rid
        for rid, sid, slug, guncel in mevcut
        if not guncel and beklenen.get(sid) == slug
    ]
    if geri_donen:
        await db.execute(
            update(SeoSlug).where(SeoSlug.id.in_(geri_donen)).values(is_current=True)
        )
    yeni = [
        {"slug": slug, "kind": "ders", "subject_id": sid, "district": None, "is_current": True}
        for sid, slug in beklenen.items()
        if slug not in dolu and not seo_adres.rezerve_mi(slug)
    ]
    yeni += [
        {
            "slug": seo_adres.ilce_slugu(ad),
            "kind": "ilce",
            "subject_id": None,
            "district": ad,
            "is_current": True,
        }
        for ad in seo_adres.ADANA_ILCELERI
        if seo_adres.ilce_slugu(ad) not in dolu
    ]
    if yeni:
        # Çok satırlı VALUES: her satır AYNI anahtarları taşımalı (SQLAlchemy).
        await db.execute(
            insert(SeoSlug).values(yeni).on_conflict_do_nothing(index_elements=["slug"])
        )
    await db.flush()


async def kayit(db: AsyncSession, slug: str) -> SeoSlug | None:
    return (
        await db.execute(select(SeoSlug).where(SeoSlug.slug == slug))
    ).scalar_one_or_none()


async def guncel_karsilik(db: AsyncSession, eski: SeoSlug) -> SeoSlug | None:
    """Tarihçe satırının aynı hedefteki güncel satırı."""
    stmt = select(SeoSlug).where(SeoSlug.kind == eski.kind, SeoSlug.is_current.is_(True))
    if eski.kind == "ilan":
        stmt = stmt.where(SeoSlug.tutor_id == eski.tutor_id)
    elif eski.kind == "ders":
        stmt = stmt.where(SeoSlug.subject_id == eski.subject_id)
    else:
        stmt = stmt.where(SeoSlug.district == eski.district)
    return (await db.execute(stmt)).scalar_one_or_none()
