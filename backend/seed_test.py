import asyncio
import sys
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy import text
from core.config import settings

async def main():
    db_url = str(settings.DATABASE_URL)
    engine = create_async_engine(db_url)
    async with AsyncSession(engine) as session:
        # User tablosuna ekle (role_id=2 -> TUTOR)
        res = await session.execute(text("""
            INSERT INTO users (email, hashed_password, full_name, role_id, is_active)
            VALUES ('test32@example.com', 'dummy', 'Yıldız Test Eğitmen', 2, true)
            RETURNING id
        """))
        user_id = res.scalar()
        
        # Tutor profili oluştur ve rating 3.2 ver
        await session.execute(text("""
            INSERT INTO tutors (id, headline, bio, hourly_rate, rating_average, rating_count, bayesian_score, status)
            VALUES (:id, 'Test 3.2', 'Yıldız test profili', 100, 3.2, 5, 3.2, 'APPROVED')
        """), {"id": user_id})
        
        await session.commit()
        print(f"Created tutor with ID: {user_id}")

if __name__ == "__main__":
    asyncio.run(main())
