import asyncio
import datetime
from sqlalchemy import select
from core.database import AsyncSessionLocal
from models.tutor import Tutor

async def fix_tutors():
    async with AsyncSessionLocal() as db:
        # Soft-delete dummy tutors
        result = await db.execute(select(Tutor).where(Tutor.id.in_([1, 2, 3, 5, 7])))
        dummies = result.scalars().all()
        for d in dummies:
            d.deleted_at = datetime.datetime.now(datetime.timezone.utc)
        
        # Update avatars for the remaining 6
        res2 = await db.execute(select(Tutor).where(Tutor.id.notin_([1, 2, 3, 4, 5, 7, 17]))) # Excluding deleted + Dilan(4) + Berivan(17)
        real_tutors = res2.scalars().all()
        
        for t in real_tutors:
            if t.first_name == "Mehmet":
                t.avatar_url = "/images/tutors/mehmet.png"
            elif t.first_name == "Canlı":
                t.avatar_url = "/images/tutors/canli.png"
            elif t.first_name == "Zeynep":
                t.avatar_url = "/images/tutors/zeynep.png"
            elif t.first_name == "Elif":
                t.avatar_url = "/images/tutors/elif.png"
            elif t.first_name == "Yildiz":
                t.avatar_url = "/images/tutors/yildiz.png"
            elif t.first_name == "Eda" and t.id == 6:
                t.avatar_url = "/images/tutors/eda.png"
                
        await db.commit()
        print("Fixed tutors successfully!")

if __name__ == "__main__":
    asyncio.run(fix_tutors())
