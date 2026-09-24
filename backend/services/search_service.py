from __future__ import annotations

import datetime
import re
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from core.promotion_packages import SLOT_LIMIT
from models.booking import Booking, BookingStatus
from models.messaging import Conversation, Message
from core.search_text import (
    normalize_tr,
    normalized,
    phrase_tsquery,
    tsquery as search_tsquery,
)
from models.tutor import (
    Gender,
    Tutor,
    TutorAvailability,
    TutorStatus,
    TutorSubject,
    TutorSubjectLevel,
)
from services import subject_service
from models.tutor_promotion import TutorPromotion
from schemas.education import PublicEducationOut
from schemas.tutor import AvailabilityOut, TutorSearchOut, TutorSort
from services import education_service, seo_slug_service, tutor_promotion_service
from services.ranking import bayesian_average, bayesian_score_expr, compute_global_mean


def _years_ago(years: int) -> datetime.date:
    today = datetime.date.today()
    try:
        return today.replace(year=today.year - years)
    except ValueError:  # 29 Şubat
        return today.replace(year=today.year - years, day=28)


def _to_search_out(
    tutor: Tutor,
    prior_mean: float,
    confidence: float,
    *,
    educations: list | None = None,
    subjects: list[str] | None = None,
    availability: list | None = None,
    distance_km: float | None = None,
    completed_lessons: int = 0,
    avg_response_seconds: int | None = None,
    include_lesson_info: bool = False,
) -> TutorSearchOut:
    return TutorSearchOut(
        id=tutor.id,
        display_name=tutor.display_name,
        avatar_url=tutor.avatar_url,
        headline=tutor.headline,
        bio=tutor.bio,
        # "Ders Hakkında" uzun metin; arama listesinde taşımayız, yalnız detayda.
        lesson_info=tutor.lesson_info if include_lesson_info else None,
        # Tanıtım videosu yalnız detayda; ücretsiz ilk ders rozeti listede de gerekli.
        intro_video_url=tutor.intro_video_url if include_lesson_info else None,
        first_lesson_free=tutor.first_lesson_free,
        hourly_rate=tutor.hourly_rate,
        teaching_mode=tutor.teaching_mode,
        gender=tutor.gender,
        birth_date=tutor.birth_date,
        last_seen_at=tutor.last_seen_at,
        created_at=tutor.created_at,
        completed_lessons=completed_lessons,
        avg_response_seconds=avg_response_seconds,
        rating_count=tutor.rating_count,
        rating_average=(
            tutor.rating_sum / tutor.rating_count if tutor.rating_count else None
        ),
        bayesian_score=bayesian_average(
            tutor.rating_sum, tutor.rating_count, prior_mean, confidence
        ),
        location_text=tutor.location_text,
        location_lat=float(tutor.location_lat) if tutor.location_lat is not None else None,
        location_lng=float(tutor.location_lng) if tutor.location_lng is not None else None,
        district=tutor.district,
        distance_km=round(distance_km, 1) if distance_km is not None else None,
        subjects=subjects or [],
        availability=[
            AvailabilityOut.model_validate(a) for a in (availability or [])
        ],
        educations=[PublicEducationOut.model_validate(e) for e in (educations or [])],
    )


def _haversine_km(lat: float, lng: float):
    """Tutor.location_lat/lng ile (lat,lng) arası km mesafe ifadesi (Haversine).
    acos domain'ini [-1,1]'e clamp ederek float hatasından NaN'i önler."""
    cos_expr = (
        func.cos(func.radians(lat))
        * func.cos(func.radians(Tutor.location_lat))
        * func.cos(func.radians(Tutor.location_lng) - func.radians(lng))
        + func.sin(func.radians(lat)) * func.sin(func.radians(Tutor.location_lat))
    )
    clamped = func.greatest(-1.0, func.least(1.0, cos_expr))
    return 6371.0 * func.acos(clamped)


def _apply_tutor_filters(
    stmt,
    *,
    q: str | None = None,
    min_rate: Decimal | None = None,
    max_rate: Decimal | None = None,
    modes: list[str] | None = None,
    gender: Gender | None = None,
    min_age: int | None = None,
    max_age: int | None = None,
    subjects: list[str] | None = None,
    districts: list[str] | None = None,
    distance_expr=None,
    radius_km: float | None = None,
    level_id: int | None = None,
    level_subject_ids: set[int] | None = None,
):
    """Eğitmen listeleyen HER yolun ortak sert filtreleri. `(stmt, relevance)`.

    Neden ortak: bu filtreler bir zamanlar `search_tutors` ile `price_histogram`
    arasında elle ikizlenmişti ve kodun kendi yorumu ikisinin senkron kalması
    gerektiğini söylüyordu — ayrıştıklarında histogramın gösterdiği dağılım
    listedeki eğitmenlere ait olmuyordu. Öne çıkarma sorgusu üçüncü bir kopya
    üretecekti; onun yerine tek kaynak buraya alındı.

    `relevance` yalnız `q` verildiğinde doludur ve **sıralama içindir**;
    filtrenin parçası değildir (çok kelimeli sorguda pg_trgm `%` operatörü
    bilinçli olarak WHERE'den çıkarılmıştır, yalnız skorda kalır).
    """
    stmt = stmt.where(
        Tutor.status == TutorStatus.APPROVED,
        Tutor.is_active.is_(True),
        Tutor.deleted_at.is_(None),
    )
    if distance_expr is not None:
        konumu_var = and_(
            Tutor.location_lat.isnot(None), Tutor.location_lng.isnot(None)
        )
        if radius_km is not None and districts:
            # MAHALLE ARAMASI: yarıçap bir DARALTMA aracıdır, eleme aracı değil.
            #
            # İlan sihirbazı ilçeyi ZORUNLU, harita pinini OPSİYONEL tutuyor
            # (`sozlesme.ts` — `dogrula` yalnız `district`e bakar). Yani
            # "ilçesini seçmiş ama pin koymamış" eğitmen normal bir durumdur.
            # Sert yarıçap onları sessizce elerdi: kullanıcı Reşatbey'i seçer,
            # Seyhan'daki pinsiz eğitmen listeden düşer ve bunu kimse göremez.
            #
            # İlçe filtresi zaten ayrıca uygulanıyor (aşağıda), dolayısıyla
            # buraya düşen koordinatsız kayıtların ilçesi hâlihazırda tutuyor.
            stmt = stmt.where(
                or_(
                    and_(konumu_var, distance_expr <= radius_km),
                    Tutor.location_lat.is_(None),
                )
            )
        else:
            # "Yakınımdakiler": kullanıcı kendi konumuna göre arıyor ve mesafe
            # sıralamanın kendisi. Konumu olmayan eğitmenin burada karşılığı
            # yok — elenir.
            stmt = stmt.where(konumu_var)
            if radius_km is not None:
                stmt = stmt.where(distance_expr <= radius_km)

    if subjects:
        # NORMALİZE eşleşme: `subjects` buraya `subject_service.resolve_filter_terms`
        # tarafından çözülmüş, `tr_normalize`'dan geçmiş terimler olarak gelir
        # (dersin adı + tüm eşanlamlıları + alt derslerinin adları).
        #
        # Eskiden burada ham `IN` vardı ve TAM + BÜYÜK/KÜÇÜK HARFE DUYARLI
        # eşleşiyordu: branşını "Fen Bilgisi" diye bildiren eğitmen "Fen"
        # aramasında ÇIKMIYORDU. Yazma tarafı serbest metin olduğu için bu
        # sessiz bir arıza — hata vermez, yalnız "sonuç bulunamadı" der.
        stmt = stmt.where(
            Tutor.id.in_(
                select(TutorSubject.tutor_id).where(
                    normalized(TutorSubject.subject).in_(subjects)
                )
            )
        )

    if level_id is not None:
        # Seviye yalnız KANONİK derse bağlanabilir: `TutorSubjectLevel`in
        # `subject_id`si. `level_subject_ids` boşsa (seçili ders taksonomide
        # karşılıksız serbest metin), `in_(())` sıfır satır döner — başka bir
        # dersin seviyesini yanlışlıkla eşleştirmez, sessizce yanlış eğitmen
        # sızdırmaz.
        stmt = stmt.where(
            Tutor.id.in_(
                select(TutorSubjectLevel.tutor_id).where(
                    TutorSubjectLevel.level_id == level_id,
                    TutorSubjectLevel.subject_id.in_(level_subject_ids or set()),
                )
            )
        )

    if districts:
        # Türkçe katlamalı karşılaştırma. Birebir eşitlik kullanılıyordu ve
        # "cukurova"/"ÇUKUROVA" gibi aksansız/büyük harfli değerler sessizce
        # SIFIR sonuç veriyordu — hata değil, boş liste. Kütüphane tarafı aynı
        # sorunu `normalized()` ile çoktan çözmüş (library_service), eğitmen
        # tarafı geride kalmıştı.
        #
        # `Tutor.district` üzerindeki düz indeks bu ifadeyle kullanılamaz;
        # kütüphane tarafında da öyle ve o maliyet bilinçli kabul edilmiş.
        # İlçe kümesi 15 elemanlı, tablo küçük.
        wanted = [normalize_tr(d) for d in districts if d and d.strip()]
        if wanted:
            stmt = stmt.where(normalized(Tutor.district).in_(wanted))

    relevance = None
    if q:
        # ── Katmanlı arama ──────────────────────────────────────────────
        # websearch_to_tsquery zaten AND mantığıyla çalışıyor. Asıl sorun
        # pg_trgm `%` operatörünün WHERE OR içinde olması — çok kelimeli
        # sorguda fuzzy eşleşme istenmeyen sonuçlar getiriyor. Çözüm:
        # çok kelimeli sorguda fuzzy'yi filtreden çıkar, yalnız skorda tut.
        words = [re.sub(r"[^\w]", "", w, flags=re.UNICODE)
                 for w in q.strip().split()]
        words = [w for w in words if w]
        # Diakritik-duyarsız arama: hem indeks (generated tsvector / trigram)
        # hem sorgu `tr_normalize`'dan geçer. "matematık" → "matematik".
        like = f"%{normalize_tr(q.strip())}%"
        # Arama ADA göre yapılır, soyada göre DEĞİL (ÜK-9). Soyad arayüzden
        # kaldırılıp burada bırakılsaydı gizli ama SORGULANABİLİR kalırdı:
        # bir soyadı yazıp sonuç dönüp dönmediğine bakarak o kişinin platformda
        # olup olmadığı öğrenilebilirdi (varlık sızıntısı).
        norm_name = normalized(Tutor.first_name)

        tsquery = search_tsquery(q)

        if len(words) > 1:
            phrase_query = phrase_tsquery(q)
            # pg_trgm % filtreden ÇIKARILDI — fuzzy yalnız skorda.
            stmt = stmt.where(
                or_(
                    Tutor.search_vector.op("@@")(tsquery),
                    norm_name.ilike(like),
                )
            )
            relevance = (
                func.ts_rank(Tutor.search_vector, phrase_query) * 4.0
                + func.ts_rank(Tutor.search_vector, tsquery) * 2.0
                + func.similarity(norm_name, normalized(q)) * 3.0
            )
        else:
            # Tek kelime — fuzzy filtreden dahil.
            stmt = stmt.where(
                or_(
                    Tutor.search_vector.op("@@")(tsquery),
                    norm_name.op("%")(normalized(q)),
                )
            )
            relevance = func.ts_rank(Tutor.search_vector, tsquery) + func.similarity(
                norm_name, normalized(q)
            )

    if min_rate is not None:
        stmt = stmt.where(Tutor.hourly_rate >= min_rate)
    if max_rate is not None:
        stmt = stmt.where(Tutor.hourly_rate <= max_rate)

    if modes:
        # "Uzaktan" istenirse ONLINE+BOTH, "Yüzyüze" istenirse IN_PERSON+BOTH eşleşir.
        acceptable: set[str] = set()
        for m in modes:
            acceptable.add(m)
            acceptable.add("BOTH")
        stmt = stmt.where(Tutor.teaching_mode.in_(acceptable))

    if gender is not None:
        stmt = stmt.where(Tutor.gender == gender)
    # Yaş, birth_date aralığına çevrilir (age kolonu saklanmaz → güncel + indekslenebilir).
    if min_age is not None:
        stmt = stmt.where(Tutor.birth_date <= _years_ago(min_age))
    if max_age is not None:
        stmt = stmt.where(Tutor.birth_date > _years_ago(max_age + 1))

    return stmt, relevance


async def search_tutors(
    db: AsyncSession,
    *,
    q: str | None = None,
    min_rate: Decimal | None = None,
    max_rate: Decimal | None = None,
    modes: list[str] | None = None,
    gender: Gender | None = None,
    min_age: int | None = None,
    max_age: int | None = None,
    subjects: list[str] | None = None,
    districts: list[str] | None = None,
    exam: str | None = None,
    sort: TutorSort | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    level_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[TutorSearchOut]:
    prior_mean = await compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE
    score = bayesian_score_expr(prior_mean, confidence)

    # Seviye filtresi KANONİK id ister; ham `subjects` terimlere çözülmeden
    # önce hesaplanır (aşağıdaki satır `subjects`i serbest metin terimleriyle
    # değiştirir).
    level_subject_ids = (
        await subject_service.resolve_filter_subject_ids(db, subjects or [])
        if level_id is not None
        else None
    )
    # `?subject=` ham metin DEĞİL kanonik terime çözülür (slug / eşanlamlı /
    # ders adı → o dersin ve alt derslerinin tüm yazımları). Üç listeleme
    # yolunun da aynı kümeyi kullanması şart: ayrışırlarsa histogram listedeki
    # eğitmenlere ait olmayan bir dağılım gösterir.
    subjects = await subject_service.resolve_filter_terms(db, subjects or []) or None
    geo = lat is not None and lng is not None
    distance_expr = _haversine_km(lat, lng) if geo else None

    base_cols = (Tutor, distance_expr.label("distance_km")) if geo else (Tutor,)
    stmt = select(*base_cols).options(selectinload(Tutor.subject_links))
    stmt, relevance = _apply_tutor_filters(
        stmt,
        q=q,
        min_rate=min_rate,
        max_rate=max_rate,
        modes=modes,
        gender=gender,
        min_age=min_age,
        max_age=max_age,
        subjects=subjects,
        districts=districts,
        distance_expr=distance_expr,
        radius_km=radius_km,
        level_id=level_id,
        level_subject_ids=level_subject_ids,
    )

    # Sınav bağlamı: SERT FİLTRE DEĞİL. İlanında ilgili sınavdan (ör. "KPSS")
    # bahseden eğitmenleri sıralamada öne çıkarır; bahsetmeyenler elenmez.
    # Ortak filtre yardımcısına ALINMADI: yalnız aramanın sıralamasına aittir,
    # histogram ve öne çıkarma sorgusu sıralama yapmaz.
    if exam:
        exam_tsquery = search_tsquery(exam)
        exam_rank = func.ts_rank(Tutor.search_vector, exam_tsquery)
        relevance = exam_rank if relevance is None else relevance + exam_rank

    if sort == TutorSort.PRICE_ASC:
        stmt = stmt.order_by(Tutor.hourly_rate.asc().nulls_last(), score.desc())
    elif sort == TutorSort.PRICE_DESC:
        stmt = stmt.order_by(Tutor.hourly_rate.desc().nulls_last(), score.desc())
    elif sort == TutorSort.RATING_DESC:
        stmt = stmt.order_by(score.desc(), Tutor.created_at.desc())
    elif geo:
        # Kullanıcı açık bir sıralama seçmediyse, yakınımdaki aramada mesafe önceliklidir.
        stmt = stmt.order_by(distance_expr.asc(), score.desc())
    elif relevance is not None:
        stmt = stmt.order_by(score.desc(), relevance.desc())
    else:
        stmt = stmt.order_by(score.desc(), Tutor.created_at.desc())

    stmt = stmt.limit(limit).offset(offset)

    rows = (await db.execute(stmt)).all()
    results: list[TutorSearchOut] = []
    for row in rows:
        tutor = row[0]
        distance = row[1] if geo else None
        results.append(
            _to_search_out(
                tutor,
                prior_mean,
                confidence,
                subjects=[link.subject for link in tutor.subject_links],
                distance_km=float(distance) if distance is not None else None,
            )
        )
    await seo_slug_service.url_slug_doldur(db, results)
    return results


async def price_histogram(
    db: AsyncSession,
    *,
    q: str | None = None,
    modes: list[str] | None = None,
    gender: Gender | None = None,
    min_age: int | None = None,
    max_age: int | None = None,
    subjects: list[str] | None = None,
    districts: list[str] | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    level_id: int | None = None,
) -> list[float]:
    """Eşleşen eğitmenlerin saatlik ücret dağılımını döndürür.

    Arama ile aynı SERT filtreleri uygular ama **fiyat (min/max) filtresini
    kasıtlı olarak hariç tutar** — Airbnb tarzı fiyat aralığı histogramı, kullanıcı
    fiyat aralığını daraltsa da tüm dağılımı göstermelidir. Ücreti olmayan
    eğitmenler elenir. Sıralama/limit yok; tüm eşleşen ücretler döner.
    """
    # Seviye filtresi KANONİK id ister; ham `subjects` terimlere çözülmeden
    # önce hesaplanır.
    level_subject_ids = (
        await subject_service.resolve_filter_subject_ids(db, subjects or [])
        if level_id is not None
        else None
    )
    # `?subject=` ham metin DEĞİL kanonik terime çözülür (slug / eşanlamlı /
    # ders adı → o dersin ve alt derslerinin tüm yazımları). Üç listeleme
    # yolunun da aynı kümeyi kullanması şart: ayrışırlarsa histogram listedeki
    # eğitmenlere ait olmayan bir dağılım gösterir.
    subjects = await subject_service.resolve_filter_terms(db, subjects or []) or None
    geo = lat is not None and lng is not None
    distance_expr = _haversine_km(lat, lng) if geo else None

    # Ücreti olmayan eğitmen dağılıma giremez — bu filtre histograma özgüdür ve
    # bilinçli olarak ortak yardımcıda DEĞİLDİR (aramada ücretsiz ilan görünür).
    stmt = select(Tutor.hourly_rate).where(Tutor.hourly_rate.isnot(None))
    # min/max_rate KASITLI olarak geçilmez: kullanıcı aralığı daraltsa da
    # histogram tüm dağılımı göstermelidir.
    stmt, _ = _apply_tutor_filters(
        stmt,
        q=q,
        modes=modes,
        gender=gender,
        min_age=min_age,
        max_age=max_age,
        subjects=subjects,
        districts=districts,
        distance_expr=distance_expr,
        radius_km=radius_km,
        level_id=level_id,
        level_subject_ids=level_subject_ids,
    )

    rates = (await db.execute(stmt)).scalars().all()
    return [float(r) for r in rates if r is not None]


async def gender_facets(
    db: AsyncSession,
    *,
    q: str | None = None,
    modes: list[str] | None = None,
    min_age: int | None = None,
    max_age: int | None = None,
    subjects: list[str] | None = None,
    districts: list[str] | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    level_id: int | None = None,
) -> dict[str, int]:
    """Cinsiyet filtresinin her seçeneğinin kaç eğitmene denk geldiği.

    **`gender` filtresini KASITLI olarak uygulamaz** — `price_histogram`in
    fiyat filtresini atlamasıyla aynı desen ve aynı gerekçe: faset sayıları,
    kullanıcı bir seçenek seçtikten SONRA da diğer seçeneklerin ne getireceğini
    göstermelidir. Kendi filtresini uygulasaydı seçili olmayan seçenekler
    her zaman 0 görünürdü.

    Neden var: `Tutor.gender == FEMALE` karşılaştırması hem `NULL` hem
    `UNSPECIFIED` satırları eler. Yani cinsiyet filtreleyen bir öğrenci,
    belirtmemiş HER eğitmeni sessizce kaybediyordu ve bunu göremiyordu.
    Üçüncü sayı (`belirtilmemis`) tam olarak o sessizliği görünür kılar.

    Dönen anahtarlar `Gender` üyeleri + `belirtilmemis`.
    """
    # Seviye filtresi bu ekseni SAYAR (kendi ekseni değil, `gender` gibi): bir
    # eğitmen "Matematik + Lise" filtresiyle daralmışsa cinsiyet faseti de o
    # daralmış kümeden hesaplanmalı.
    level_subject_ids = (
        await subject_service.resolve_filter_subject_ids(db, subjects or [])
        if level_id is not None
        else None
    )
    subjects = await subject_service.resolve_filter_terms(db, subjects or []) or None
    geo = lat is not None and lng is not None
    distance_expr = _haversine_km(lat, lng) if geo else None

    # `func.count` yerine gruplama: tek turda üç sayı. `NULL` ile
    # `UNSPECIFIED` DB'de ayrı satırlardır ve ayrı sayılır; tek kovaya
    # indirmek "hiç sorulmadı" ile "söylemek istemedi" ayrımını yok ederdi.
    stmt = select(Tutor.gender, func.count()).group_by(Tutor.gender)
    stmt, _ = _apply_tutor_filters(
        stmt,
        q=q,
        modes=modes,
        gender=None,  # ← kasıtlı: kendi ekseni sayılmaz
        min_age=min_age,
        max_age=max_age,
        subjects=subjects,
        districts=districts,
        distance_expr=distance_expr,
        radius_km=radius_km,
        level_id=level_id,
        level_subject_ids=level_subject_ids,
    )

    sayilar: dict[str, int] = {g.value: 0 for g in Gender}
    sayilar["belirtilmemis"] = 0
    for deger, adet in (await db.execute(stmt)).all():
        if deger is None:
            sayilar["belirtilmemis"] += adet
        else:
            anahtar = deger.value if hasattr(deger, "value") else str(deger)
            sayilar[anahtar] = sayilar.get(anahtar, 0) + adet
    # `UNSPECIFIED` de filtreden düşer: kullanıcıya "görünmeyen" olarak
    # ikisi BİRLİKTE sunulur, ama veri katmanında ayrı kalır (yukarı bkz.).
    sayilar["gorunmeyen"] = sayilar["belirtilmemis"] + sayilar[Gender.UNSPECIFIED.value]
    return sayilar


async def featured_tutors(
    db: AsyncSession,
    *,
    q: str | None = None,
    min_rate: Decimal | None = None,
    max_rate: Decimal | None = None,
    modes: list[str] | None = None,
    gender: Gender | None = None,
    min_age: int | None = None,
    max_age: int | None = None,
    subjects: list[str] | None = None,
    districts: list[str] | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    level_id: int | None = None,
) -> list[TutorSearchOut]:
    """Yürürlükteki öne çıkarma paketi olan eğitmenler (en fazla `SLOT_LIMIT`).

    ## Neden ayrı sorgu

    Öne çıkarma organik sıralamayı DEĞİŞTİRMEZ (sözleşme S-1): `search_tutors`
    ORDER BY'ı promosyon tablosuna hiçbir koşulda bakmaz. Para ile puan aynı
    listede yarıştırılsaydı sıralamanın anlamı ölçülemez hâle gelirdi ve
    sayfalama da bozulurdu.

    ## Neden rastgele

    Aday sayısı slottan fazlaysa seçim `random()`'dır: gösterim garantisi
    verilmediği hizmet koşullarında yazılıdır. Alternatif (satın alma sırası ya
    da fiyat) ilk gelen eğitmeni kalıcı olarak öne kilitlerdi.
    """
    prior_mean = await compute_global_mean(db)
    confidence = settings.BAYESIAN_CONFIDENCE

    level_subject_ids = (
        await subject_service.resolve_filter_subject_ids(db, subjects or [])
        if level_id is not None
        else None
    )
    # `?subject=` ham metin DEĞİL kanonik terime çözülür (slug / eşanlamlı /
    # ders adı → o dersin ve alt derslerinin tüm yazımları). Üç listeleme
    # yolunun da aynı kümeyi kullanması şart: ayrışırlarsa histogram listedeki
    # eğitmenlere ait olmayan bir dağılım gösterir.
    subjects = await subject_service.resolve_filter_terms(db, subjects or []) or None
    geo = lat is not None and lng is not None
    distance_expr = _haversine_km(lat, lng) if geo else None
    base_cols = (Tutor, distance_expr.label("distance_km")) if geo else (Tutor,)

    stmt = select(*base_cols).options(selectinload(Tutor.subject_links))
    stmt, _ = _apply_tutor_filters(
        stmt,
        q=q,
        min_rate=min_rate,
        max_rate=max_rate,
        modes=modes,
        gender=gender,
        min_age=min_age,
        max_age=max_age,
        subjects=subjects,
        districts=districts,
        distance_expr=distance_expr,
        radius_km=radius_km,
        level_id=level_id,
        level_subject_ids=level_subject_ids,
    )
    # Eğitmenin görünürlük kapısı (APPROVED/is_active) ortak filtrededir; ödenmiş
    # bir paket onu ATLATAMAZ — askıya alınmış eğitmen parasını ödemiş olsa bile
    # blokta çıkmaz.
    stmt = stmt.where(
        exists(
            select(TutorPromotion.id).where(
                TutorPromotion.tutor_id == Tutor.id,
                tutor_promotion_service.aktif_kosul(),
            )
        )
    ).order_by(func.random()).limit(SLOT_LIMIT)

    rows = (await db.execute(stmt)).all()
    sonuc = [
        _to_search_out(
            row[0],
            prior_mean,
            confidence,
            subjects=[link.subject for link in row[0].subject_links],
            distance_km=float(row[1]) if geo and row[1] is not None else None,
        )
        for row in rows
    ]
    await seo_slug_service.url_slug_doldur(db, sonuc)
    return sonuc


async def tutor_avg_response_seconds(
    db: AsyncSession,
    tutor_id: int,
    *,
    window_days: int = 90,
    max_messages: int = 2000,
) -> int | None:
    """Eğitmenin ortalama ilk-yanıt süresi (saniye) — mesajlaşma verisinden.

    Her sohbette, yanıtsız bir öğrenci mesajından sonraki ilk eğitmen mesajına kadar
    geçen süreyi örnekler (art arda öğrenci mesajlarında İLK mesajdan ölçülür) ve tüm
    sohbetler üzerinden ortalar. Yalnız son ``window_days`` gün; örnek yoksa None.
    """
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        days=window_days
    )
    rows = (
        await db.execute(
            select(Message.conversation_id, Message.sender_role, Message.created_at)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.tutor_id == tutor_id, Message.created_at >= since)
            .order_by(Message.conversation_id, Message.created_at, Message.id)
            .limit(max_messages)
        )
    ).all()

    samples: list[float] = []
    pending: dict[int, datetime.datetime] = {}  # conv_id -> yanıtsız ilk öğrenci mesajı
    for conv_id, role, created_at in rows:
        if role == "CLIENT":
            pending.setdefault(conv_id, created_at)
        elif role == "TUTOR":
            start = pending.pop(conv_id, None)
            if start is not None:
                delta = (created_at - start).total_seconds()
                if delta >= 0:
                    samples.append(delta)
    if not samples:
        return None
    return int(sum(samples) / len(samples))


async def get_tutor_public(db: AsyncSession, tutor_id: int) -> TutorSearchOut:
    tutor = await db.get(Tutor, tutor_id)
    if (
        tutor is None
        or tutor.deleted_at is not None
        or tutor.status != TutorStatus.APPROVED
        or not tutor.is_active
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tutor not found")
    prior_mean = await compute_global_mean(db)
    educations = await education_service.list_by(
        db, role_id=tutor.role_id, owner_id=tutor.id
    )
    subj_rows = await db.execute(
        select(TutorSubject.subject)
        .where(TutorSubject.tutor_id == tutor.id)
        .order_by(TutorSubject.subject)
    )
    avail_rows = (
        await db.execute(
            select(TutorAvailability)
            .where(TutorAvailability.tutor_id == tutor.id)
            .order_by(TutorAvailability.weekday, TutorAvailability.start_minute)
        )
    ).scalars().all()
    # Güven sinyali: tamamlanmış ders sayısı (sosyal kanıt). Detayda hesaplanır;
    # arama listesinde N+1'den kaçınmak için 0 bırakılır.
    completed_lessons = (
        await db.execute(
            select(func.count(Booking.id)).where(
                Booking.tutor_id == tutor.id,
                Booking.status == BookingStatus.COMPLETED,
                Booking.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    avg_response_seconds = await tutor_avg_response_seconds(db, tutor.id)
    out = _to_search_out(
        tutor,
        prior_mean,
        settings.BAYESIAN_CONFIDENCE,
        educations=educations,
        subjects=[r[0] for r in subj_rows.all()],
        availability=list(avail_rows),
        completed_lessons=completed_lessons,
        avg_response_seconds=avg_response_seconds,
        include_lesson_info=True,
    )
    out.url_slug = await seo_slug_service.ilan_slugu(db, tutor.id)
    return out
