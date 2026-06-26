import json
import asyncio
from sqlalchemy import select
from core.database import AsyncSessionLocal
from models.tutor import Tutor

async def get_tutors():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Tutor))
        tutors = result.scalars().all()
        data = []
        for t in tutors:
            data.append({
                "id": t.id,
                "first_name": t.first_name,
                "last_name": t.last_name,
                "gender": str(t.gender.name) if t.gender else None,
                "avatar_url": t.avatar_url
            })
        print("TUTORS_DATA:" + json.dumps(data))

if __name__ == "__main__":
    asyncio.run(get_tutors())
