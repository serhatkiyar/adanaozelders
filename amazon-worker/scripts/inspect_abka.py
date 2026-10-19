import asyncio
import httpx
import json

async def main():
    url = "https://b2b.yildirimdagitim.com/api/vitrin/arama?aranan=8694123016486"
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0"
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=headers)
        data = r.json()
        urunler = data.get('urunler', [])
        for u in urunler:
            print(json.dumps(u, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(main())
