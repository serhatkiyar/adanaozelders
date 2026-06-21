"""Adana veri setindeki KÜTÜPHANELERİ (yalnız 'Kütüphaneler' + 'Bilgi Evleri'
kategorileri) dev veritabanına Library kataloğu olarak yükler.

Kurallar:
- Google puanı/yorumu ALINMAZ (review sıfırdan başlar; Bayesian sıralama temiz kalır).
- Yalnız kamuya açık dizin bilgisi: ad, adres, konum, çalışma saatleri.
- Olanaklar (amenity) uydurulmaz — veri setinde yok, boş bırakılır.
- Idempotent: aynı isimde aktif kayıt varsa atlanır (tekrar çalıştırmak güvenli).
- status=ACTIVE (katalogda görünür ki test edilebilsin).

Çalıştırma:  cd backend && python seed_libraries.py
"""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from core.database import AsyncSessionLocal
from models.library import Library, LibraryHours
from services.library_service import _slugify, _unique_slug
from sqlalchemy import select

DATA = Path(__file__).resolve().parent.parent / "scripts" / "out" / "adana_venues_all.json"
CATEGORIES = {"Kütüphaneler", "Bilgi Evleri"}

_DAYS = {
    "Pazartesi": 0, "Salı": 1, "Çarşamba": 2, "Perşembe": 3,
    "Cuma": 4, "Cumartesi": 5, "Pazar": 6,
}


def _parse_minute_pairs(text: str) -> list[int]:
    """Metindeki tüm HH:MM'leri dakikaya çevirip sırayla döndürür."""
    out = []
    for h, m in re.findall(r"(\d{1,2}):(\d{2})", text):
        out.append(int(h) * 60 + int(m))
    return out


def parse_hours(saatler: str | None) -> list[dict]:
    """'Pazartesi: 08:00–18:00 | ...' metnini LibraryHours satırlarına çevirir.
    Öğle arası bölünmesinde dış zarfı (ilk açılış → son kapanış) alır."""
    if not saatler or not saatler.strip():
        return []
    rows: list[dict] = []
    for part in saatler.split("|"):
        part = part.strip()
        if ":" not in part:
            continue
        day_name, val = part.split(":", 1)
        weekday = _DAYS.get(day_name.strip())
        if weekday is None:
            continue
        val = val.strip()
        low = val.lower()
        if "kapalı" in low:
            rows.append({"weekday": weekday, "is_closed": True})
            continue
        if "24 saat" in low or "24 sa" in low:
            rows.append({"weekday": weekday, "is_closed": False, "open": 0, "close": 1440})
            continue
        nums = _parse_minute_pairs(val)
        if len(nums) < 2:
            continue
        open_m, close_m = nums[0], nums[-1]
        if not (0 <= open_m < close_m <= 1440):
            continue
        rows.append({"weekday": weekday, "is_closed": False, "open": open_m, "close": close_m})
    return rows


async def main() -> None:
    raw = json.loads(DATA.read_text(encoding="utf-8"))
    libs = [d for d in raw if d.get("kategori") in CATEGORIES]
    print(f"Aday kayıt: {len(libs)} (kategoriler: {', '.join(sorted(CATEGORIES))})")

    created = skipped = 0
    async with AsyncSessionLocal() as db:
        for d in libs:
            name = (d.get("isim") or "").strip()
            if not name:
                skipped += 1
                continue
            # Idempotent: aynı isimde aktif kayıt varsa atla.
            exists = await db.scalar(
                select(Library.id).where(
                    Library.name == name, Library.deleted_at.is_(None)
                )
            )
            if exists:
                skipped += 1
                continue

            slug = await _unique_slug(db, _slugify(name))
            lat = d.get("lat")
            lng = d.get("lng")
            lib = Library(
                name=name,
                slug=slug,
                phone=(d.get("telefon") or d.get("google_phone") or None) or None,
                website=(d.get("website") or d.get("google_website") or None) or None,
                google_place_id=(d.get("google_place_id") or None),
                location_text=(d.get("adres") or None),
                location_lat=lat if lat else None,
                location_lng=lng if lng else None,
                city=(d.get("il") or None),
                district=(d.get("ilce") or None),
                neighborhood=(d.get("mahalle") or None),
                status="ACTIVE",
            )
            for h in parse_hours(d.get("saatler")):
                lib.hours.append(
                    LibraryHours(
                        weekday=h["weekday"],
                        is_closed=h["is_closed"],
                        open_minute=h.get("open"),
                        close_minute=h.get("close"),
                    )
                )
            db.add(lib)
            created += 1

        await db.commit()

    print(f"Eklendi: {created} · Atlandı (zaten var/isimsiz): {skipped}")


if __name__ == "__main__":
    asyncio.run(main())
