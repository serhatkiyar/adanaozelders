"""Canlı ders sayfasını test etmek için sabit bir rezervasyon oluşturur/yeniler.

Çalıştır:  cd backend && python seed_live_lesson.py

- İki bilinen-şifreli test hesabı (varsa korunur, yoksa oluşturulur):
    Eğitmen : canli-tutor@test.local     / Test1234!
    Öğrenci : canli-ogrenci@test.local   / Test1234!
- Aralarında ONLINE + ACCEPTED, meeting_room atanmış tek bir rezervasyon.
- Zaman penceresi [şimdi - 1 saat, şimdi + 7 gün] olarak AYARLANIR; böylece
  "Canlı Derse Katıl" hep aktif olur (katılım penceresi: başlangıç - 15 dk ..
  bitiş + 30 dk). Script'i tekrar çalıştırmak pencereyi tazeler (idempotent).

İki tarayıda (biri eğitmen, biri öğrenci) giriş yapıp aynı derse katılarak P2P
dosya aktarımını da test edebilirsin.
"""
import asyncio
import datetime

from sqlalchemy import select

from core.database import AsyncSessionLocal
from core.security import hash_password
from models.booking import Booking, BookingStatus
from models.client import Client
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorStatus

PASSWORD = "Test1234!"
TUTOR_EMAIL = "canli-tutor@test.local"
CLIENT_EMAIL = "canli-ogrenci@test.local"


async def main() -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    async with AsyncSessionLocal() as db:
        # ── Eğitmen (APPROVED, doğrulanmış) ──
        tutor = (
            await db.execute(
                select(Tutor).where(
                    Tutor.email == TUTOR_EMAIL, Tutor.deleted_at.is_(None)
                )
            )
        ).scalar_one_or_none()
        if tutor is None:
            tutor = Tutor(
                email=TUTOR_EMAIL,
                hashed_password=hash_password(PASSWORD),
                first_name="Canlı",
                last_name="Eğitmen",
                username="canli_egitmen_test",
                role_id=ROLE_IDS[RoleType.TUTOR],
            )
            db.add(tutor)
        tutor.status = TutorStatus.APPROVED
        tutor.headline = "Canlı Ders Test Eğitmeni"
        tutor.bio = "Canlı ders sayfasını test etmek için oluşturulmuş hesap."
        tutor.hourly_rate = 200
        tutor.teaching_mode = "ONLINE"
        tutor.is_active = True
        tutor.email_verified_at = now

        # ── Öğrenci (doğrulanmış) ──
        client = (
            await db.execute(
                select(Client).where(
                    Client.email == CLIENT_EMAIL, Client.deleted_at.is_(None)
                )
            )
        ).scalar_one_or_none()
        if client is None:
            client = Client(
                email=CLIENT_EMAIL,
                hashed_password=hash_password(PASSWORD),
                first_name="Canlı",
                last_name="Öğrenci",
                username="canli_ogrenci_test",
                role_id=ROLE_IDS[RoleType.CLIENT],
            )
            db.add(client)
        client.is_active = True
        client.email_verified_at = now

        await db.flush()  # id'ler için

        room = f"CeyhanCanliDersTest-{tutor.id}-{client.id}"
        start_at = now - datetime.timedelta(hours=1)
        end_at = now + datetime.timedelta(days=7)

        # ── Rezervasyon (varsa güncelle, yoksa oluştur) ──
        booking = (
            await db.execute(
                select(Booking)
                .where(
                    Booking.tutor_id == tutor.id,
                    Booking.client_id == client.id,
                    Booking.status == BookingStatus.ACCEPTED,
                    Booking.deleted_at.is_(None),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if booking is None:
            booking = Booking(
                tutor_id=tutor.id,
                client_id=client.id,
                status=BookingStatus.ACCEPTED,
                mode="ONLINE",
                meeting_room=room,
                price=200,
                notes="Canlı ders test rezervasyonu",
            )
            db.add(booking)
        booking.start_at = start_at
        booking.end_at = end_at
        booking.mode = "ONLINE"
        booking.meeting_room = room
        booking.status = BookingStatus.ACCEPTED

        await db.flush()
        booking_id = booking.id
        await db.commit()

    print("[OK] Test rezervasyonu hazir.")
    print(f"  Rezervasyon ID : {booking_id}")
    print(f"  Oda            : {room}")
    print(f"  Pencere        : {start_at:%Y-%m-%d %H:%M} - {end_at:%Y-%m-%d %H:%M} (UTC)")
    print()
    print("  Giriş bilgileri (şifre ikisinde de Test1234!):")
    print(f"    Eğitmen : {TUTOR_EMAIL}")
    print(f"    Öğrenci : {CLIENT_EMAIL}")
    print()
    print(f"  Ders detayi: /panel/rezervasyonlar/{booking_id}  -> 'Canli Derse Katil'")


if __name__ == "__main__":
    asyncio.run(main())
