from __future__ import annotations

from core import frontend_yollari

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.moderation import mask_contact_info
from core.text import HEADLINE_MIN_WORDS, HOURLY_RATE_MAX, HOURLY_RATE_MIN, count_words
from models.role import ROLE_IDS, RoleType
from models.tutor import (
    Tutor,
    TutorAvailability,
    TutorStatus,
    TutorSubject,
    TutorSubjectLevel,
)
from schemas.tutor import TutorProfileUpdate
from core.search_text import normalize_tr
from services import notification_service, seo_slug_service, subject_service

_MAX_SUBJECTS = 40
_MAX_AVAILABILITY = 60

# Public profilde görünen serbest-metin alanları (bkz. update_profile).
# `location_text` bilinçli olarak DIŞARIDA: adres bilgisi buluşma için gerekli
# ve içinde telefon deseni bulunmaz.
_MASKED_PROFILE_FIELDS = frozenset({"headline", "bio", "about", "lesson_info"})


async def attach_subjects(db: AsyncSession, tutor: Tutor) -> Tutor:
    """Eğitmenin ders kümesini list[str] olarak `tutor.subjects`'a koyar (serileştirme için)."""
    rows = await db.execute(
        select(TutorSubject.subject)
        .where(TutorSubject.tutor_id == tutor.id)
        .order_by(TutorSubject.subject)
    )
    tutor.subjects = [r[0] for r in rows.all()]
    seviyeler: dict[int, list[int]] = {}
    for sid, lid in (
        await db.execute(
            select(TutorSubjectLevel.subject_id, TutorSubjectLevel.level_id)
            .where(TutorSubjectLevel.tutor_id == tutor.id)
            .order_by(TutorSubjectLevel.subject_id, TutorSubjectLevel.level_id)
        )
    ).all():
        seviyeler.setdefault(sid, []).append(lid)
    tutor.subject_levels = seviyeler
    # Kendi ilan adresi (yayına hiç girmemişse None) — "ilanımı gör" bağlantısı.
    tutor.url_slug = await seo_slug_service.ilan_slugu(db, tutor.id)
    return tutor


async def _replace_subjects(
    db: AsyncSession, tutor: Tutor, subjects: list[str]
) -> None:
    """Branşları tam olarak yeniden yazar ve kanonik derse BAĞLAR.

    Metin kolonu korunuyor (geriye uyum + taksonomide karşılığı olmayan gerçek
    branşları kaybetmemek), ama artık her satır mümkünse `subject_id` taşıyor.
    Bağ olmadan arama filtresi ve seviye seçimi çalışmaz.

    Aynı eğitmende iki farklı metin aynı derse çıkarsa ("İngilizce" +
    "İngilizce konuşma becerileri") İLKİ bağlanır, ikincisi metin olarak durur
    ama `subject_id` almaz — `uq_tutor_subjects_canonical` bunu zaten reddederdi.
    """
    clean: list[str] = []
    seen: set[str] = set()
    for raw in subjects:
        s = raw.strip()
        if s and s not in seen and len(s) <= 100:
            seen.add(s)
            clean.append(s)
        if len(clean) >= _MAX_SUBJECTS:
            break

    harita = await subject_service.map_texts_to_ids(db, clean)
    await db.execute(delete(TutorSubject).where(TutorSubject.tutor_id == tutor.id))
    alinan: set[int] = set()
    for s in clean:
        sid = harita.get(normalize_tr(s))
        if sid is not None and sid in alinan:
            sid = None
        elif sid is not None:
            alinan.add(sid)
        db.add(TutorSubject(tutor_id=tutor.id, subject=s, subject_id=sid))
    # Artık verilmeyen derslerin seviyeleri de gitmeli; yoksa eğitmen dersi
    # kaldırdıktan sonra o dersin seviyeleri sessizce kayıtta kalır.
    await db.execute(
        delete(TutorSubjectLevel).where(
            TutorSubjectLevel.tutor_id == tutor.id,
            TutorSubjectLevel.subject_id.notin_(alinan) if alinan else True,
        )
    )
    await db.flush()


async def _replace_levels(
    db: AsyncSession, tutor: Tutor, secimler: list
) -> None:
    """Ders başına seviye seçimlerini yeniden yazar.

    Doğrulama SESSİZ ATLAMA yapmaz — geçersiz seçim 422 döner. Eski davranış
    (sessizce yut) "kapalı liste" iddiasıyla bağdaşmıyordu: eğitmen seçtiğini
    kaydettiğini sanıp profilinde bulamıyordu.
    """
    if not secimler:
        await db.execute(
            delete(TutorSubjectLevel).where(TutorSubjectLevel.tutor_id == tutor.id)
        )
        return

    bildirilen = {
        r[0]
        for r in (
            await db.execute(
                select(TutorSubject.subject_id).where(
                    TutorSubject.tutor_id == tutor.id,
                    TutorSubject.subject_id.isnot(None),
                )
            )
        ).all()
    }
    gecerli = await subject_service.valid_level_ids(
        db, [(s.subject_id, s.level_ids) for s in secimler]
    )

    await db.execute(
        delete(TutorSubjectLevel).where(TutorSubjectLevel.tutor_id == tutor.id)
    )
    for secim in secimler:
        if secim.subject_id not in bildirilen:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Seviye verilen ders, bildirilen dersler arasında değil.",
            )
        for level_id in dict.fromkeys(secim.level_ids):
            if (secim.subject_id, level_id) not in gecerli:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "Bu ders için geçersiz seviye seçimi.",
                )
            db.add(
                TutorSubjectLevel(
                    tutor_id=tutor.id,
                    subject_id=secim.subject_id,
                    level_id=level_id,
                )
            )
    await db.flush()


async def attach_availability(db: AsyncSession, tutor: Tutor) -> Tutor:
    rows = (
        await db.execute(
            select(TutorAvailability)
            .where(TutorAvailability.tutor_id == tutor.id)
            .order_by(TutorAvailability.weekday, TutorAvailability.start_minute)
        )
    ).scalars().all()
    tutor.availability = list(rows)
    return tutor


async def _replace_availability(
    db: AsyncSession, tutor: Tutor, items: list[dict]
) -> None:
    await db.execute(
        delete(TutorAvailability).where(TutorAvailability.tutor_id == tutor.id)
    )
    for it in items[:_MAX_AVAILABILITY]:
        db.add(
            TutorAvailability(
                tutor_id=tutor.id,
                weekday=it["weekday"],
                start_minute=it["start_minute"],
                end_minute=it["end_minute"],
            )
        )
    await db.flush()

_TRANSITIONS: dict[TutorStatus, set[TutorStatus]] = {
    TutorStatus.DRAFT: {TutorStatus.PENDING_APPROVAL},
    TutorStatus.PENDING_APPROVAL: {TutorStatus.APPROVED, TutorStatus.REJECTED},
    TutorStatus.REJECTED: {TutorStatus.PENDING_APPROVAL},
    TutorStatus.APPROVED: {TutorStatus.SUSPENDED},
    TutorStatus.SUSPENDED: {TutorStatus.APPROVED},
}

# Profil her durumda düzenlenebilir; yalnızca onay sürecindeyken (PENDING_APPROVAL) kilitli.
_EDITABLE_STATES = {
    TutorStatus.DRAFT,
    TutorStatus.REJECTED,
    TutorStatus.APPROVED,
    TutorStatus.SUSPENDED,
}


def _transition(tutor: Tutor, target: TutorStatus) -> None:
    if target not in _TRANSITIONS.get(tutor.status, set()):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Invalid transition: {tutor.status.value} -> {target.value}",
        )
    tutor.status = target


async def update_profile(
    db: AsyncSession, tutor: Tutor, data: TutorProfileUpdate
) -> Tutor:
    if tutor.status not in _EDITABLE_STATES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Profile editable only in DRAFT or REJECTED state",
        )
    payload = data.model_dump(exclude_unset=True)
    subjects = payload.pop("subjects", None)
    # Ham şemadan alınır (model_dump sözlüğe çevirirdi; `_replace_levels`
    # nitelik erişimi bekliyor).
    subject_levels = data.subject_levels if "subject_levels" in payload else None
    payload.pop("subject_levels", None)
    availability = payload.pop("availability", None)
    for field, value in payload.items():
        # Public profil metinleri maskeden geçer. Bu, anti-disintermediation'ın
        # EN BÜYÜK açığıydı: mesajlaşma maskeliyken biyografiye telefon yazan
        # bir eğitmen, hiç mesajlaşmadan doğrudan iletişime yönlendirip
        # komisyonu tamamen atlayabiliyordu.
        if field in _MASKED_PROFILE_FIELDS and isinstance(value, str):
            value = mask_contact_info(value)
        setattr(tutor, field, value)
    if subjects is not None:
        await _replace_subjects(db, tutor, subjects)
    # Seviyeler branşlardan SONRA yazılır: doğrulama "bu ders bildirilmiş mi"
    # sorusuna bakıyor ve cevabı ancak branşlar yazıldıktan sonra doğrudur.
    if subject_levels is not None:
        await _replace_levels(db, tutor, subject_levels)
    if availability is not None:
        await _replace_availability(db, tutor, availability)
    await db.flush()
    await attach_subjects(db, tutor)
    await attach_availability(db, tutor)
    return tutor


async def submit_for_approval(db: AsyncSession, tutor: Tutor) -> Tutor:
    # DİPLOMA ARTIK YAYIN KAPISI DEĞİL (5 Eyl 2026, kullanıcı kararı).
    #
    # Eskiden burada "en az bir eğitim kaydında doğrulama materyali yoksa 422"
    # kapısı vardı. Kaldırıldı: belge istemek, henüz hiçbir öğrenciye ulaşmamış
    # bir eğitmenden ilanı yayınlanmadan ÖNCE evrak istemek demekti ve arzın
    # önündeki en büyük engeliydi. Yeni sözleşme: belgesiz ilan da yayınlanır;
    # belgesi admin tarafından e-Devlet üzerinden doğrulanmış eğitmen profilinde
    # "Diploması Doğrulandı" rozetini alır. Belge bir BİLET değil, bir AYRICALIK.
    #
    # Rozet ve panelin eksikler listesi hâlâ education_service'teki sorguları
    # okuyor; kaldırılan yalnız bu kapıdır. Nöbetçisi:
    # tests/test_tutor_yayin_kapisi.py
    #
    # Zorunlu kalite kapısı: ilan başlığı dolu ve en az HEADLINE_MIN_WORDS sözcük olmalı.
    if count_words(tutor.headline) < HEADLINE_MIN_WORDS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"İlan başlığın en az {HEADLINE_MIN_WORDS} sözcük olmalı. "
            "Branşını, sınav türünü ve deneyimini içeren açıklayıcı bir başlık yaz.",
        )
    # Ücret kapısı: ücret yazılmışsa 250–5000 ₺ aralığında olmalı. Boş ücret
    # (belirtilmemiş) yayına engel değil; kart "Ücret belirtilmemiş" der.
    if tutor.hourly_rate is not None and not (
        HOURLY_RATE_MIN <= float(tutor.hourly_rate) <= HOURLY_RATE_MAX
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Saatlik ücret {HOURLY_RATE_MIN}–{HOURLY_RATE_MAX} ₺ aralığında olmalı.",
        )
    _transition(tutor, TutorStatus.PENDING_APPROVAL)
    await db.flush()
    return tutor


async def _yayina_alindi(db: AsyncSession, tutor: Tutor) -> None:
    """İlan yayına girdiğinde kök SEO adresi sabitlenir (Modül 6).

    İlk yayında başlıktan üretilir; sonraki yayınlarda (pasiften dönüş) mevcut
    adres aynen kalır. Ders/ilçe adres satırları da aynı anda eşitlenir ki
    eğitmenin dersine ait sayfa adres kaydı beklemeden açılabilsin.
    """
    await seo_slug_service.ilan_slug_ata(db, tutor)
    await seo_slug_service.ders_ilce_adreslerini_esitle(db)


async def approve(db: AsyncSession, tutor: Tutor) -> Tutor:
    _transition(tutor, TutorStatus.APPROVED)
    await db.flush()
    await _yayina_alindi(db, tutor)
    await notification_service.notify(
        db,
        user_id=tutor.id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="İlanın onaylandı ve artık yayında!",
        link=frontend_yollari.ILANIM,
    )
    return tutor


async def reject(db: AsyncSession, tutor: Tutor) -> Tutor:
    _transition(tutor, TutorStatus.REJECTED)
    await db.flush()
    await notification_service.notify(
        db,
        user_id=tutor.id,
        role_id=ROLE_IDS[RoleType.TUTOR],
        message="İlanın reddedildi. Bilgilerini güncelleyip tekrar gönderebilirsin.",
        link=frontend_yollari.ILANIM,
    )
    return tutor


async def suspend(db: AsyncSession, tutor: Tutor) -> Tutor:
    # Eğitmenin self-servis "Pasife al" aksiyonu; yalnızca yayındaki ilan pasife alınabilir.
    if tutor.status != TutorStatus.APPROVED:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only an approved listing can be suspended"
        )
    _transition(tutor, TutorStatus.SUSPENDED)
    await db.flush()
    return tutor


async def activate(db: AsyncSession, tutor: Tutor) -> Tutor:
    # Eğitmenin self-servis "Aktifleştir" aksiyonu; yalnızca pasif ilan yeniden yayına alınabilir.
    if tutor.status != TutorStatus.SUSPENDED:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only a suspended listing can be reactivated"
        )
    _transition(tutor, TutorStatus.APPROVED)
    await db.flush()
    await _yayina_alindi(db, tutor)
    return tutor
