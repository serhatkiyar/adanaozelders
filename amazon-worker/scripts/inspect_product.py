import asyncio
import httpx
import json

async def main():
    url = "https://b2b.yildirimdagitim.com/api/vitrin/urun/90405"
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0"
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=headers)
        if r.status_code == 200:
            print(json.dumps(r.json(), indent=2, ensure_ascii=False))
        else:
            url2 = "https://b2b.yildirimdagitim.com/api/vitrin/urunler/90405"
            r2 = await client.get(url2, headers=headers)
            print("urunler endpoint:")
            print(r2.status_code)
            if r2.status_code == 200:
                print(json.dumps(r2.json(), indent=2, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(main())
