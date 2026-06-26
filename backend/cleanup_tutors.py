import asyncio
from sqlalchemy import delete
from core.database import AsyncSessionLocal
from models.tutor import Tutor

async def cleanup_tutors():
    async with AsyncSessionLocal() as db:
        # Delete test tutors: Tut Or (1), Reviewed Tutor (2), Search Reflect (3), Smoke Renamed (5), Eda Yilmaz duplicate (7)
        await db.execute(delete(Tutor).where(Tutor.id.in_([1, 2, 3, 5, 7])))
        await db.commit()
        print("Cleanup done!")

if __name__ == "__main__":
    asyncio.run(cleanup_tutors())
