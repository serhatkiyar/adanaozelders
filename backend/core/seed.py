from __future__ import annotations

import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.security import hash_password
from models.admin import Admin
from models.admin_access import AdminRole, AdminRoleAssignment
from models.role import ROLE_IDS, Role, RoleType
from models.tutor import (
    Gender,
    Tutor,
    TutorAvailability,
    TutorEducation,
    TutorStatus,
    TutorSubject,
)


async def seed_roles(session: AsyncSession) -> None:
    for role_type, role_id in ROLE_IDS.items():
        if await session.get(Role, role_id) is None:
            session.add(Role(id=role_id, name=role_type))


async def seed_admin(session: AsyncSession) -> None:
    if not (settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD):
        return
    stmt = select(Admin).where(
        Admin.email == settings.ADMIN_EMAIL, Admin.deleted_at.is_(None)
    )
    admin = await session.scalar(stmt)
    if admin is None:
        parts = settings.ADMIN_FULL_NAME.split(" ", 1)
        first_name = parts[0] or "System"
        last_name = parts[1] if len(parts) > 1 else "Admin"
        admin = Admin(
            email=settings.ADMIN_EMAIL,
            hashed_password=hash_password(settings.ADMIN_PASSWORD),
            first_name=first_name,
            last_name=last_name,
            role_id=ROLE_IDS[RoleType.ADMIN],
            # Seed admin'i doğrulanmış kabul et (kendine doğrulama maili göndermez).
            email_verified_at=datetime.datetime.now(datetime.timezone.utc),
        )
        session.add(admin)
        await session.flush()

    super_admin_role_id = await session.scalar(
        select(AdminRole.id).where(
            AdminRole.code == "SUPER_ADMIN", AdminRole.deleted_at.is_(None)
        )
    )
    if super_admin_role_id is not None:
        assignment_id = await session.scalar(
            select(AdminRoleAssignment.id).where(
                AdminRoleAssignment.admin_id == admin.id,
                AdminRoleAssignment.deleted_at.is_(None),
            )
        )
        if assignment_id is None:
            session.add(
                AdminRoleAssignment(
                    admin_id=admin.id,
                    admin_role_id=super_admin_role_id,
                    assigned_by_admin_id=admin.id,
                )
            )


# Demo/başlangıç eğitmenleri. APPROVED + is_active → aramada ve liderlikte görünür;
# içerikleri (başlık/biyografi/branş/eğitim/uygunluk) eksiksiz doldurulmuştur ki
# platform boş bir DB'de bile gerçek verilerle dolu görünsün. Idempotent: e-posta
# zaten varsa atlanır. Şifre hepsinde "Tutor1234!".
_SEED_TUTOR_PASSWORD = "Tutor1234!"

# (weekday: 0=Pzt … 6=Paz, başlangıç dk, bitiş dk) — dakika gece yarısından.
_SEED_TUTORS: tuple[dict, ...] = (
    {
        "email": "elif.yilmaz@ornek-egitmen.com",
        "first_name": "Elif",
        "last_name": "Yılmaz",
        "gender": Gender.FEMALE,
        "birth_date": datetime.date(1992, 4, 18),
        "hourly_rate": 450,
        "teaching_mode": "BOTH",
        "headline": "TYT-AYT Matematik | 9 yıllık deneyimle sınav koçluğu",
        "bio": (
            "Merhaba, ben Elif. Çukurova Üniversitesi Matematik Öğretmenliği "
            "mezunuyum ve 9 yıldır TYT-AYT öğrencilerini üniversiteye hazırlıyorum. "
            "Derslerimde her öğrencinin eksiğini önce bir deneme analiziyle çıkarır, "
            "sonra konuyu sıfırdan anlatıp bol soru çözümüyle pekiştiririm. "
            "Özellikle problemler, fonksiyonlar ve türev konularında öğrencilerimin "
            "net sayısını kısa sürede artırıyorum. İlk ders tanışma ve seviye tespiti "
            "olduğu için ücretsizdir."
        ),
        "about": "Sabırlı, planlı ve sonuç odaklı bir matematik eğitmeni.",
        "location_text": "Adana, Seyhan",
        "location_lat": 37.000000,
        "location_lng": 35.321300,
        "subjects": ["Matematik", "TYT", "AYT"],
        "educations": [
            {
                "school_name": "Çukurova Üniversitesi",
                "degree": "Lisans",
                "field_of_study": "Matematik Öğretmenliği",
                "start_year": 2010,
                "end_year": 2014,
            }
        ],
        "availability": [
            (0, 1020, 1260),  # Pzt 17:00-21:00
            (2, 1020, 1260),  # Çar 17:00-21:00
            (5, 600, 840),    # Cmt 10:00-14:00
        ],
    },
    {
        "email": "mehmet.demir@ornek-egitmen.com",
        "first_name": "Mehmet",
        "last_name": "Demir",
        "gender": Gender.MALE,
        "birth_date": datetime.date(1988, 11, 3),
        "hourly_rate": 500,
        "teaching_mode": "BOTH",
        "headline": "Fizik ve Kimya | Sayısal netlerini katlayan mühendis eğitmen",
        "bio": (
            "Makine mühendisiyim ve 11 yıldır TYT-AYT fizik-kimya dersleri veriyorum. "
            "Soyut görünen fizik konularını günlük hayattan örneklerle somutlaştırır, "
            "formül ezberi yerine mantığını kavratırım. Kimyada ise özellikle "
            "mol kavramı, asit-baz ve organik kimya konularında öğrencilerimin "
            "en çok zorlandığı noktaları hedef alırım. Online derslerde dijital tahta "
            "ve interaktif simülasyonlar kullanıyorum. İlk ders ücretsizdir."
        ),
        "about": "Konuyu mantığıyla kavratan, soru çözüm odaklı bir eğitmen.",
        "location_text": "Adana, Ceyhan",
        "location_lat": 36.919700,
        "location_lng": 35.820300,
        "subjects": ["Fizik", "Kimya", "TYT", "AYT"],
        "educations": [
            {
                "school_name": "Orta Doğu Teknik Üniversitesi",
                "degree": "Lisans",
                "field_of_study": "Makine Mühendisliği",
                "start_year": 2006,
                "end_year": 2011,
            }
        ],
        "availability": [
            (1, 1020, 1260),  # Sal 17:00-21:00
            (3, 1020, 1260),  # Per 17:00-21:00
            (6, 600, 900),    # Paz 10:00-15:00
        ],
    },
    {
        "email": "zeynep.kaya@ornek-egitmen.com",
        "first_name": "Zeynep",
        "last_name": "Kaya",
        "gender": Gender.FEMALE,
        "birth_date": datetime.date(1995, 7, 22),
        "hourly_rate": 400,
        "teaching_mode": "ONLINE",
        "headline": "İngilizce Konuşma & YDS | Akıcı konuşmaya 3 ayda",
        "bio": (
            "İngilizce öğretmeniyim ve Boğaziçi Üniversitesi mezunuyum. Hedefim "
            "öğrencilerimi kalıp ezberinden kurtarıp gerçekten konuşturmak. "
            "Günlük konuşma, iş İngilizcesi ve YDS/YÖKDİL sınav hazırlığı için "
            "kişiye özel programlar hazırlıyorum. Derslerimiz tamamen İngilizce "
            "geçer; seviyene göre tempoyu ayarlar, her ders sonunda küçük ödevlerle "
            "kalıcılığı sağlarım. İlk ders tanışma ve seviye belirleme amaçlı ücretsizdir."
        ),
        "about": "Pratik odaklı, özgüven kazandıran bir dil eğitmeni.",
        "location_text": "Adana, Çukurova",
        "location_lat": 37.050000,
        "location_lng": 35.300000,
        "subjects": ["İngilizce", "İngilizce konuşma becerileri", "YDS"],
        "educations": [
            {
                "school_name": "Boğaziçi Üniversitesi",
                "degree": "Lisans",
                "field_of_study": "İngilizce Öğretmenliği",
                "start_year": 2013,
                "end_year": 2017,
            }
        ],
        "availability": [
            (0, 1140, 1320),  # Pzt 19:00-22:00
            (3, 1140, 1320),  # Per 19:00-22:00
            (5, 540, 720),    # Cmt 09:00-12:00
        ],
    },
)


async def seed_tutors(session: AsyncSession) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    hashed = hash_password(_SEED_TUTOR_PASSWORD)
    for data in _SEED_TUTORS:
        stmt = select(Tutor.id).where(
            Tutor.email == data["email"], Tutor.deleted_at.is_(None)
        )
        if (await session.execute(stmt)).first() is not None:
            continue
        tutor = Tutor(
            email=data["email"],
            hashed_password=hashed,
            is_active=True,
            role_id=ROLE_IDS[RoleType.TUTOR],
            status=TutorStatus.APPROVED,
            first_name=data["first_name"],
            last_name=data["last_name"],
            gender=data["gender"],
            birth_date=data["birth_date"],
            hourly_rate=data["hourly_rate"],
            teaching_mode=data["teaching_mode"],
            headline=data["headline"],
            bio=data["bio"],
            about=data["about"],
            location_text=data["location_text"],
            location_lat=data["location_lat"],
            location_lng=data["location_lng"],
            email_verified_at=now,
        )
        tutor.subject_links = [
            TutorSubject(subject=s) for s in data["subjects"]
        ]
        tutor.educations = [TutorEducation(**edu) for edu in data["educations"]]
        tutor.availability_links = [
            TutorAvailability(weekday=wd, start_minute=sm, end_minute=em)
            for (wd, sm, em) in data["availability"]
        ]
        session.add(tutor)
