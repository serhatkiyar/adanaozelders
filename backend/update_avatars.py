import asyncio
from sqlalchemy import select
from core.database import AsyncSessionLocal
from models.tutor import Tutor

async def update_avatars():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Tutor))
        tutors = result.scalars().all()
        for t in tutors:
            if t.first_name == "Dilan" and t.last_name == "Kıyar":
                t.avatar_url = "/images/tutors/dilan.png"
            elif t.first_name == "Berivan" and t.last_name == "Kıyar":
                t.avatar_url = "/images/tutors/berivan.png"
            elif t.gender and t.gender.name == "FEMALE":
                t.avatar_url = "/images/tutors/female.png"
            elif t.gender and t.gender.name == "MALE":
                t.avatar_url = "/images/tutors/male.png"
            else:
                # Guess from first name if gender is null
                if t.first_name in ["Eda", "Yildiz"]:
                    t.avatar_url = "/images/tutors/female.png"
                else:
                    t.avatar_url = "/images/tutors/male.png"
        
        await db.commit()
        print("Avatars updated successfully!")

if __name__ == "__main__":
    asyncio.run(update_avatars())
