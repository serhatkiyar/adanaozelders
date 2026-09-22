"""Ders taksonomisi okuma servisi.

Bu paketin (Faz 1) kapsamı yalnız OKUMA'dır: katalog listesi ve seviye
merdivenleri. Arama filtresinin kanonik değere geçmesi (`resolve`), eğitmenin
ders/seviye bildirimi ve admin yönetimi sonraki fazlar.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.search_text import normalize_tr, normalized
from models.subject import (
    Level,
    LevelScale,
    Subject,
    SubjectAlias,
    SubjectLevelScale,
)
from models.tutor import Tutor, TutorStatus, TutorSubject
from schemas.subject import LevelScaleOut, SubjectOut


async def list_subjects(db: AsyncSession, *, only_active: bool = True) -> list[SubjectOut]:
    """Ders kataloğu (düz liste).

    ``only_active`` İKİ YÜZEYİ ayırır ve kuralları BİLEREK zıttır:

    - **Vitrin/arama (only_active=True):** yalnız küratörlü liste. Arkasında
      eğitmen olmayan bir dersi öğrenciye göstermek, aratıldığında garantili
      sıfır sonuç üretir — düzeltmeye çalıştığımız hastalığın ta kendisi.
    - **Eğitmen ders seçimi (only_active=False):** kataloğun TAMAMI. Arkeoloji
      ya da ACCA hazırlığı veren bir eğitmen varsa branşını bildirebilmeli;
      seçimi kısıtlamak arzı kendi elimizle kesmek olurdu. Eğitmen bildirdiği
      anda o dersin arkasında gerçek arz oluşur.

    İleride vitrin tarafı `is_active` yerine "en az bir eğitmeni var mı"
    ölçüsüne bağlanabilir; o zamana kadar küratörlü liste vekildir.
    """
    stmt = (
        select(Subject)
        .where(Subject.deleted_at.is_(None))
        .options(
            selectinload(Subject.aliases),
            selectinload(Subject.level_scales),
        )
        .order_by(Subject.group_code, Subject.sort_order, Subject.name)
    )
    if only_active:
        stmt = stmt.where(Subject.is_active.is_(True))

    dersler = (await db.execute(stmt)).scalars().unique().all()
    sayim = await _tutor_counts(db)
    return [
        SubjectOut(
            id=d.id,
            slug=d.slug,
            name=d.name,
            parent_id=d.parent_id,
            group_code=d.group_code,
            sort_order=d.sort_order,
            scales=sorted(m.scale_code for m in d.level_scales),
            aliases=sorted(a.normalized for a in d.aliases),
            tutor_count=sayim.get(d.id, 0),
        )
        for d in dersler
    ]


async def _tutor_counts(db: AsyncSession) -> dict[int, int]:
    """Ders başına YAYINDAKİ eğitmen sayısı.

    Yalnız onaylı ve aktif eğitmenler sayılır: taslak bir ilan arama sonucunda
    çıkmadığı için sayıya girmesi kullanıcıyı yanıltırdı.
    """
    satirlar = (
        await db.execute(
            select(TutorSubject.subject_id, func.count())
            .join(Tutor, Tutor.id == TutorSubject.tutor_id)
            .where(
                TutorSubject.subject_id.isnot(None),
                Tutor.status == TutorStatus.APPROVED,
                Tutor.is_active.is_(True),
                Tutor.deleted_at.is_(None),
            )
            .group_by(TutorSubject.subject_id)
        )
    ).all()
    return {sid: n for sid, n in satirlar}


async def list_level_scales(db: AsyncSession) -> list[LevelScaleOut]:
    """Seviye merdivenleri + basamakları (kapalı referans veri)."""
    merdivenler = (
        await db.execute(
            select(LevelScale)
            .options(selectinload(LevelScale.levels))
            .order_by(LevelScale.sort_order)
        )
    ).scalars().unique().all()
    return [
        LevelScaleOut(
            code=m.code,
            name=m.name,
            sort_order=m.sort_order,
            levels=sorted(
                (b for b in m.levels if b.is_active), key=lambda b: b.sort_order
            ),
        )
        for m in merdivenler
    ]


async def _canonical_subject_ids(db: AsyncSession, aranan: set[str]) -> set[int]:
    """Normalize edilmiş girişleri (slug/eşanlamlı/ad) kanonik ders id'lerine çözer.

    `resolve_filter_terms` ve `resolve_filter_subject_ids` arasında paylaşılan
    çekirdek: ikisi de aynı üç sütunlu çözümleme sırasını (slug → eşanlamlı →
    ad) kullanır, farkları çözümün SONUCU (metin kümesi mi, id kümesi mi).
    """
    ders_ids: set[int] = set()
    for kolon in (
        select(Subject.id).where(
            Subject.deleted_at.is_(None), Subject.slug.in_(aranan)
        ),
        select(SubjectAlias.subject_id).where(SubjectAlias.normalized.in_(aranan)),
        select(Subject.id).where(
            Subject.deleted_at.is_(None), normalized(Subject.name).in_(aranan)
        ),
    ):
        ders_ids.update((await db.execute(kolon)).scalars().all())
    return ders_ids


async def resolve_filter_terms(db: AsyncSession, values: list[str]) -> list[str]:
    """`?subject=` değerlerini ARAMADA EŞLEŞTİRİLECEK normalize metinlere çevirir.

    Bugünkü arıza: filtre `TutorSubject.subject.in_(...)` ile TAM ve
    BÜYÜK/KÜÇÜK HARFE DUYARLI eşleşme yapıyor. Eğitmen branşını `"Fen Bilgisi"`
    diye bildirmişse `?subject=Fen` araması onu BULMUYOR — ikisi de aynı dersin
    adı olmasına rağmen. Ölçüldü: bu yüzden arama listesindeki 85+ kalem
    garantili sıfır sonuç veriyor.

    Çözüm: gelen değeri kanonik derse çöz, o dersin ADI + TÜM EŞANLAMLILARI +
    ALT DERSLERİNİN adları ve eşanlamlıları normalize edilmiş bir küme olarak
    dön. Eşleştirme `tr_normalize` üzerinden yapılır — yazma tarafındaki
    `subject_aliases.normalized` da aynı fonksiyondan geçtiği için iki taraf
    ayrışamaz.

    Çözümleme sırası: slug → eşanlamlı → normalize edilmiş ders adı. Hiçbiri
    tutmazsa değer OLDUĞU GİBİ (normalize edilerek) döner; yani paylaşılmış
    eski linkler ve taksonomide karşılığı olmayan serbest branşlar çalışmaya
    devam eder. Bu, davranışı koruyan bir ÜST KÜMEDİR: bugün eşleşen her
    sorgu yarın da eşleşir, üstüne eşanlamlılar eklenir.
    """
    if not values:
        return []

    aranan = {normalize_tr(v) for v in values if v and v.strip()}
    if not aranan:
        return []

    ders_ids = await _canonical_subject_ids(db, aranan)

    if not ders_ids:
        # Taksonomide karşılığı yok — bugünkü davranış (ham metin eşleşmesi).
        return sorted(aranan)

    # Alt ders genişletmesi: "Diller" seçildiğinde Almanca/Fransızca eğitmenleri
    # de gelir. Ağaç iki seviyeli olduğu için özyinelemeli CTE gerekmez.
    alt = (
        await db.execute(
            select(Subject.id).where(
                Subject.deleted_at.is_(None), Subject.parent_id.in_(ders_ids)
            )
        )
    ).scalars().all()
    ders_ids.update(alt)

    terimler = set(aranan)
    adlar = (
        await db.execute(select(Subject.name).where(Subject.id.in_(ders_ids)))
    ).scalars().all()
    terimler.update(normalize_tr(a) for a in adlar)
    esanlamlilar = (
        await db.execute(
            select(SubjectAlias.normalized).where(
                SubjectAlias.subject_id.in_(ders_ids)
            )
        )
    ).scalars().all()
    terimler.update(esanlamlilar)
    return sorted(t for t in terimler if t)


async def resolve_filter_subject_ids(db: AsyncSession, values: list[str]) -> set[int]:
    """`?subject=` değerini SEVİYE FİLTRESİ için kanonik ders id'sine çözer.

    `resolve_filter_terms` serbest metinle eşleşecek TERİMLER döner; seviye
    filtresi ise `TutorSubjectLevel(tutor_id, subject_id, level_id)` üzerinden
    çalıştığı için gerçek `Subject.id` gerekir — metin eşleşmesi burada işe
    yaramaz. Taksonomide karşılığı olmayan (serbest metin) bir ders için boş
    küme döner; çağıran bunu "seviyesi bilinmiyor" olarak ele alıp filtreyi
    sıfır sonuca düşürür (yanlışlıkla başka bir dersin seviyesini eşleştirmez).

    Alt ders genişletmesi `resolve_filter_terms` ile aynıdır: "Diller"
    seçiliyken Almanca/Fransızca'nın seviyeleri de sayılır.
    """
    if not values:
        return set()
    aranan = {normalize_tr(v) for v in values if v and v.strip()}
    if not aranan:
        return set()

    ders_ids = await _canonical_subject_ids(db, aranan)
    if not ders_ids:
        return set()

    alt = (
        await db.execute(
            select(Subject.id).where(
                Subject.deleted_at.is_(None), Subject.parent_id.in_(ders_ids)
            )
        )
    ).scalars().all()
    ders_ids.update(alt)
    return ders_ids


async def map_texts_to_ids(db: AsyncSession, texts: list[str]) -> dict[str, int]:
    """Serbest metin branşları kanonik ders id'sine eşler (normalize → id).

    Öncelik sırası ADI en güçlü sinyal kabul eder: slug < eşanlamlı < ders adı.
    Eşleşmeyen metin sözlükte YER ALMAZ — çağıran onu `subject_id=NULL` olarak
    saklar, silmez.
    """
    if not texts:
        return {}
    aranan = {normalize_tr(t) for t in texts if t and t.strip()}
    if not aranan:
        return {}

    harita: dict[str, int] = {}
    for slug, sid in (
        await db.execute(
            select(Subject.slug, Subject.id).where(
                Subject.deleted_at.is_(None), Subject.slug.in_(aranan)
            )
        )
    ).all():
        harita[slug] = sid
    for metin, sid in (
        await db.execute(
            select(SubjectAlias.normalized, SubjectAlias.subject_id).where(
                SubjectAlias.normalized.in_(aranan)
            )
        )
    ).all():
        harita[metin] = sid
    for ad, sid in (
        await db.execute(
            select(Subject.name, Subject.id).where(
                Subject.deleted_at.is_(None), normalized(Subject.name).in_(aranan)
            )
        )
    ).all():
        harita[normalize_tr(ad)] = sid
    return harita


async def match_free_text(
    db: AsyncSession, metin: str | None
) -> tuple[list[dict], list[str]]:
    """Virgülle ayrılmış serbest metni kanonik derslere çözer.

    Ön başvuru formundaki ders alanı bilinçli olarak AÇIK UÇLUDUR (aday ne
    veriyorsa kendi cümlesiyle yazar). Bu fonksiyon panelin "kategori atama"
    işini yapar: yazdığının hangi derse denk geldiğini gösterir, denk gelmeyeni
    de ayrı listeler.

    Sonuç SAKLANMAZ, her okumada yeniden hesaplanır — admin yeni bir eşanlamlı
    eklediğinde eski başvurular da anında doğru dersi göstersin.
    """
    if not metin or not metin.strip():
        return [], []
    parcalar = [p.strip() for p in metin.split(",") if p.strip()]
    if not parcalar:
        return [], []

    harita = await map_texts_to_ids(db, parcalar)
    ids = {sid for sid in harita.values()}
    dersler = {
        d.id: d
        for d in (
            await db.execute(select(Subject).where(Subject.id.in_(ids)))
        ).scalars()
    } if ids else {}

    eslesen: list[dict] = []
    eslesmeyen: list[str] = []
    gorulen: set[int] = set()
    for parca in parcalar:
        sid = harita.get(normalize_tr(parca))
        ders = dersler.get(sid) if sid else None
        if ders is None:
            eslesmeyen.append(parca)
            continue
        if ders.id in gorulen:
            continue
        gorulen.add(ders.id)
        eslesen.append(
            {"id": ders.id, "slug": ders.slug, "name": ders.name, "source_text": parca}
        )
    return eslesen, eslesmeyen


async def valid_level_ids(
    db: AsyncSession, istekler: list[tuple[int, list[int]]]
) -> set[tuple[int, int]]:
    """(ders, seviye) çiftlerinden GEÇERLİ olanları döner.

    Geçerlilik ölçüsü: seviye, o dersin merdivenlerinden birine ait mi. Yani
    `Matematik` dersine `b1` (CEFR) verilemez — dersin merdiveni `OKUL`.
    """
    if not istekler:
        return set()
    ders_ids = [d for d, _ in istekler]
    level_ids = [lv for _, lvler in istekler for lv in lvler]
    if not level_ids:
        return set()

    ders_merdiven: dict[int, set[str]] = {}
    for sid, kod in (
        await db.execute(
            select(SubjectLevelScale.subject_id, SubjectLevelScale.scale_code).where(
                SubjectLevelScale.subject_id.in_(ders_ids)
            )
        )
    ).all():
        ders_merdiven.setdefault(sid, set()).add(kod)

    seviye_merdiven = dict(
        (
            await db.execute(
                select(Level.id, Level.scale_code).where(
                    Level.id.in_(level_ids), Level.is_active.is_(True)
                )
            )
        ).all()
    )
    return {
        (sid, lv)
        for sid, lvler in istekler
        for lv in lvler
        if seviye_merdiven.get(lv) in ders_merdiven.get(sid, set())
    }


async def level_count(db: AsyncSession) -> int:
    """Referans verinin yüklü olduğunu doğrulamak için (nöbetçi/duman turu)."""
    return len((await db.execute(select(Level.id))).scalars().all())
