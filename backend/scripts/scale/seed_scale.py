"""Gerçekçi hacimde veri üretir — ölçek provası için.

NEDEN: sistem bugüne dek 14 eğitmen / 8 siparişlik bir veri setiyle çalıştı.
Bu hacimde her sorgu hızlıdır; seq scan ile index scan arasındaki fark
görünmez, N+1 fark edilmez. Lansmanda hangi sorgunun çökeceğini ancak
gerçekçi hacimde ölçerek bilebiliriz.

ÖNEMLİ: yalnız `adana_scale` veritabanında çalışır (guard aşağıda). Veriyi
`scripts/scale/run.py` üzerinden üretin — o, `.env`'i okuyup DB adını
değiştirir; doğrudan çalıştırmak geliştirme verisine yazma riski taşır.

Kullanım (backend/ içinden):
    python scripts/scale/run.py --create
    python scripts/scale/run.py seed
    python scripts/scale/run.py seed --scale 0.1   # hızlı prova

Üretilen hacim (scale=1.0):
    200 eğitmen · 3.000 öğrenci · 60 kütüphane · 2.000 ürün · 5.000 sipariş
    (~10.000 kalem) · 6.000 ders · ~4.000 ödeme · 1.500 sohbet · 20.000 mesaj
    · 3.000 ders yorumu · 4.000 ürün yorumu · 20.000 bildirim
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import pathlib
import random
import sys
import time
import uuid
from decimal import Decimal

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from sqlalchemy import insert, text  # noqa: E402

from core.config import settings  # noqa: E402
from core.database import AsyncSessionLocal, engine  # noqa: E402

SCALE_DB = "adana_scale"
UTC = datetime.timezone.utc

# Deterministik: aynı tohum → aynı veri. Ölçüm tekrarlanabilir olmalı.
rng = random.Random(20260729)

DISTRICTS = [
    "Seyhan", "Çukurova", "Yüreğir", "Sarıçam", "Ceyhan", "Kozan", "İmamoğlu",
    "Karaisalı", "Karataş", "Pozantı", "Yumurtalık", "Aladağ", "Feke",
]
SUBJECTS = [
    "Matematik", "Fizik", "Kimya", "Biyoloji", "Türkçe", "Edebiyat", "Tarih",
    "Coğrafya", "İngilizce", "Almanca", "Geometri", "Felsefe", "Bilgisayar",
    "Müzik", "Resim", "Rehberlik",
]
FIRST_NAMES = [
    "Ahmet", "Mehmet", "Ayşe", "Fatma", "Mustafa", "Zeynep", "Emre", "Elif",
    "Burak", "Merve", "Can", "Ceren", "Hakan", "Selin", "Okan", "Deniz",
    "Serkan", "Gamze", "Onur", "Büşra", "Kerem", "İrem", "Barış", "Ebru",
]
LAST_NAMES = [
    "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk",
    "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara",
    "Koç", "Kurt", "Özkan", "Şimşek",
]
AMENITIES = ["wifi", "sessiz_alan", "kafeterya", "otopark", "priz", "klima", "kutuphane"]
PUBLISHERS = ["Palme", "Karekök", "3D", "Bilgi Sarmal", "Endemik", "Apotemi", "Limit"]

# Adana merkez çevresi (gerçekçi Haversine dağılımı için).
ADANA_LAT, ADANA_LNG = 37.0000, 35.3213

# Şifre alanı: bcrypt hash'i pahalıdır ve ölçümle ilgisi yoktur; sabit bir
# yer tutucu yazılır (bu veritabanına giriş yapılmaz).
DUMMY_HASH = "$2b$12$scaleseedplaceholderhashvaluenotusableforlogin......"


def _person(i: int, prefix: str) -> dict:
    return {
        "first_name": rng.choice(FIRST_NAMES),
        "last_name": rng.choice(LAST_NAMES),
        "username": f"{prefix}{i}",
        "email": f"{prefix}{i}@scale.test",
        "hashed_password": DUMMY_HASH,
        "is_active": True,
    }


def _near_adana() -> tuple[Decimal, Decimal]:
    """Merkeze ~0-25 km dağılmış koordinat (Haversine filtresini anlamlı kılar)."""
    return (
        Decimal(str(round(ADANA_LAT + rng.uniform(-0.22, 0.22), 6))),
        Decimal(str(round(ADANA_LNG + rng.uniform(-0.25, 0.25), 6))),
    )


def _ago(days_back: int) -> datetime.datetime:
    return datetime.datetime.now(UTC) - datetime.timedelta(
        days=rng.uniform(0, days_back), hours=rng.uniform(0, 24)
    )


class Timer:
    def __init__(self, label: str) -> None:
        self.label = label

    def __enter__(self) -> "Timer":
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, *exc: object) -> None:
        print(f"   {self.label:<28} {time.perf_counter() - self.t0:6.2f} sn", flush=True)


async def _bulk(session, model, rows: list[dict], label: str, chunk: int = 5000) -> None:
    """Parça parça executemany — tek seferde 20.000 satır asyncpg'yi zorlar."""
    if not rows:
        return
    with Timer(f"{label} ({len(rows)})"):
        for start in range(0, len(rows), chunk):
            await session.execute(insert(model), rows[start : start + chunk])
        await session.commit()


async def seed(scale: float) -> None:
    def n(base: int) -> int:
        return max(1, int(base * scale))

    from models.booking import Booking
    from models.client import Client, ClientAddress
    from models.library import Library, LibraryAmenity, LibraryHours, LibraryReview
    from models.messaging import Conversation, Message
    from models.notification import Notification
    from models.payment import Payment
    from models.review import Review
    from models.store import (
        Order,
        OrderItem,
        Product,
        ProductCategory,
        ProductReview,
    )
    from models.tutor import Tutor, TutorAvailability, TutorSubject

    n_tutors = n(200)
    n_clients = n(3000)
    n_libraries = n(60)
    n_products = n(2000)
    n_orders = n(5000)
    n_bookings = n(6000)
    n_convs = n(1500)
    n_messages = n(20000)
    n_notifications = n(20000)

    async with AsyncSessionLocal() as session:
        from core import seed as core_seed

        await core_seed.seed_roles(session)
        await session.commit()

        # ── Eğitmenler ────────────────────────────────────────────────────
        tutors = []
        for i in range(1, n_tutors + 1):
            lat, lng = _near_adana()
            subject = SUBJECTS[i % len(SUBJECTS)]
            tutors.append(
                {
                    "id": i,
                    **_person(i, "egitmen"),
                    "role_id": 2,
                    "status": "APPROVED" if i % 20 else "PENDING_APPROVAL",
                    "headline": f"{subject} Öğretmeni · {DISTRICTS[i % len(DISTRICTS)]}",
                    "bio": (
                        f"{rng.randint(2, 20)} yıllık deneyimle {subject} dersi veriyorum. "
                        f"TYT AYT hazırlık, konu anlatımı ve soru çözümü."
                    ),
                    "hourly_rate": Decimal(str(rng.choice([300, 400, 450, 500, 600, 750, 900]))),
                    "teaching_mode": rng.choice(["ONLINE", "IN_PERSON", "BOTH"]),
                    "district": DISTRICTS[i % len(DISTRICTS)],
                    "location_lat": lat,
                    "location_lng": lng,
                    "location_text": f"{DISTRICTS[i % len(DISTRICTS)]}, Adana",
                    "rating_count": rng.randint(0, 40),
                    "rating_sum": 0,
                    "created_at": _ago(400),
                    "updated_at": datetime.datetime.now(UTC),
                }
            )
        for t in tutors:
            t["rating_sum"] = t["rating_count"] * rng.randint(3, 5)
        await _bulk(session, Tutor, tutors, "eğitmen")

        subj_rows, avail_rows = [], []
        for t in tutors:
            picked = rng.sample(SUBJECTS, rng.randint(1, 4))
            subj_rows += [{"tutor_id": t["id"], "subject": s} for s in picked]
            for wd in rng.sample(range(7), rng.randint(3, 6)):
                avail_rows.append(
                    {
                        "tutor_id": t["id"],
                        "weekday": wd,
                        "start_minute": 9 * 60,
                        "end_minute": 21 * 60,
                    }
                )
        await _bulk(session, TutorSubject, subj_rows, "eğitmen branşı")
        await _bulk(session, TutorAvailability, avail_rows, "müsaitlik")

        # ── Öğrenciler ────────────────────────────────────────────────────
        clients = [
            {
                "id": i,
                **_person(i, "ogrenci"),
                "role_id": 3,
                "birth_date": datetime.date(rng.randint(1995, 2012), rng.randint(1, 12), 10),
                "created_at": _ago(400),
                "updated_at": datetime.datetime.now(UTC),
            }
            for i in range(1, n_clients + 1)
        ]
        await _bulk(session, Client, clients, "öğrenci")

        addresses = []
        for c in clients:
            if rng.random() < 0.6:
                lat, lng = _near_adana()
                addresses.append(
                    {
                        "client_id": c["id"],
                        "title": "Ev",
                        "recipient_name": f"{c['first_name']} {c['last_name']}",
                        "phone": f"05{rng.randint(300000000, 599999999)}",
                        "address_line": f"{rng.randint(1, 200)}. Sokak No:{rng.randint(1, 90)}",
                        "city": "Adana",
                        "district": rng.choice(DISTRICTS),
                        "location_lat": lat,
                        "location_lng": lng,
                        "is_default": True,
                    }
                )
        await _bulk(session, ClientAddress, addresses, "adres")

        # ── Kütüphaneler ──────────────────────────────────────────────────
        libraries, lib_hours, lib_amen = [], [], []
        for i in range(1, n_libraries + 1):
            lat, lng = _near_adana()
            d = DISTRICTS[i % len(DISTRICTS)]
            libraries.append(
                {
                    "id": i,
                    "name": f"{d} Etüt Merkezi {i}",
                    "slug": f"{d.lower()}-etut-{i}",
                    "description": "Sessiz çalışma salonu, bireysel masalar ve kafeterya.",
                    "city": "Adana",
                    "district": d,
                    "location_lat": lat,
                    "location_lng": lng,
                    "location_text": f"{d}, Adana",
                    "capacity": rng.choice([20, 40, 60, 100]),
                    "study_hourly_price": Decimal(str(rng.choice([25, 35, 50]))),
                    "status": "ACTIVE" if i % 12 else "PENDING",
                    "rating_count": rng.randint(0, 60),
                    "rating_sum": 0,
                    "created_at": _ago(300),
                    "updated_at": datetime.datetime.now(UTC),
                }
            )
            for wd in range(7):
                lib_hours.append(
                    {
                        "library_id": i,
                        "weekday": wd,
                        "is_closed": wd == 6 and i % 3 == 0,
                        "open_minute": 8 * 60,
                        "close_minute": 23 * 60,
                    }
                )
            lib_amen += [
                {"library_id": i, "amenity": a}
                for a in rng.sample(AMENITIES, rng.randint(2, 5))
            ]
        for lib in libraries:
            lib["rating_sum"] = lib["rating_count"] * rng.randint(3, 5)
        await _bulk(session, Library, libraries, "kütüphane")
        await _bulk(session, LibraryHours, lib_hours, "çalışma saati")
        await _bulk(session, LibraryAmenity, lib_amen, "olanak")

        lib_reviews = []
        seen_pairs: set[tuple[int, int]] = set()
        for _ in range(n(800)):
            pair = (rng.randint(1, n_libraries), rng.randint(1, n_clients))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            lib_reviews.append(
                {
                    "library_id": pair[0],
                    "client_id": pair[1],
                    "rating": rng.randint(3, 5),
                    "comment": "Sessiz ve temiz, çalışmak için ideal.",
                    "created_at": _ago(200),
                    "updated_at": datetime.datetime.now(UTC),
                }
            )
        await _bulk(session, LibraryReview, lib_reviews, "kütüphane yorumu")

        # ── Mağaza: kategoriler → ürünler ─────────────────────────────────
        categories = []
        top = ["Kitap", "Kırtasiye", "Deneme", "Yardımcı Kaynak", "Dijital", "Teknoloji"]
        cat_id = 0
        leaf_ids: list[int] = []
        for name in top:
            cat_id += 1
            categories.append(
                {"id": cat_id, "slug": f"ust-{cat_id}", "name": name, "sort_order": cat_id}
            )
            parent = cat_id
            for j in range(1, 5):
                cat_id += 1
                categories.append(
                    {
                        "id": cat_id,
                        "slug": f"alt-{cat_id}",
                        "name": f"{name} / {SUBJECTS[(cat_id + j) % len(SUBJECTS)]}",
                        "parent_id": parent,
                        "sort_order": j,
                    }
                )
                leaf_ids.append(cat_id)
        await _bulk(session, ProductCategory, categories, "kategori")

        products = []
        for i in range(1, n_products + 1):
            digital = i % 7 == 0
            subject = SUBJECTS[i % len(SUBJECTS)]
            price = Decimal(str(rng.choice([49, 79, 99, 129, 159, 189, 249, 299])))
            products.append(
                {
                    "id": i,
                    "slug": f"urun-{i}-{subject.lower()}",
                    "title": f"{subject} {'Ders Notu' if digital else 'Soru Bankası'} {i}",
                    "description": (
                        f"{subject} dersi için {rng.randint(200, 2000)} soruluk kaynak. "
                        "Konu anlatımı ve video çözümlü."
                    ),
                    "kind": "DIGITAL" if digital else "PHYSICAL",
                    "seller_type": "TUTOR" if digital else "PLATFORM",
                    "tutor_id": (i % n_tutors) + 1 if digital else None,
                    "price": price,
                    "tax_rate": Decimal("0.20") if digital else Decimal("0"),
                    "stock": None if digital else rng.randint(0, 200),
                    "category_id": rng.choice(leaf_ids),
                    "status": "ACTIVE" if i % 15 else "HIDDEN",
                    "author": rng.choice(FIRST_NAMES) + " " + rng.choice(LAST_NAMES),
                    "publisher": rng.choice(PUBLISHERS),
                    "page_count": rng.randint(80, 900),
                    "publication_year": rng.randint(2018, 2026),
                    "cover_type": rng.choice(["Karton Kapak", "Ciltli"]),
                    "rating_count": rng.randint(0, 50),
                    "rating_sum": 0,
                    "digital_asset_key": f"digital/{uuid.uuid4().hex}.pdf" if digital else None,
                    "created_at": _ago(500),
                    "updated_at": datetime.datetime.now(UTC),
                }
            )
        for p in products:
            p["rating_sum"] = p["rating_count"] * rng.randint(3, 5)
        await _bulk(session, Product, products, "ürün")

        # ── Siparişler ────────────────────────────────────────────────────
        # Durum dağılımı canlıdaki huniyi taklit eder: çoğu ödenmiş, bir kısmı
        # terk edilmiş PENDING, az sayıda iade/iptal.
        orders, items = [], []
        item_id = 0
        for i in range(1, n_orders + 1):
            client_id = rng.randint(1, n_clients)
            roll = rng.random()
            if roll < 0.12:
                status, pay = "PENDING", "PENDING"
            elif roll < 0.55:
                status, pay = "DELIVERED", "PAID"
            elif roll < 0.75:
                status, pay = "PAID", "PAID"
            elif roll < 0.85:
                status, pay = "SHIPPED", "PAID"
            elif roll < 0.93:
                status, pay = "CANCELLED", "FAILED"
            else:
                status, pay = "REFUNDED", "REFUNDED"

            picked = rng.sample(range(1, n_products + 1), rng.randint(1, 3))
            subtotal = Decimal("0")
            has_physical = False
            order_items = []
            for pid in picked:
                p = products[pid - 1]
                qty = rng.randint(1, 3)
                subtotal += Decimal(str(p["price"])) * qty
                has_physical = has_physical or p["kind"] == "PHYSICAL"
                order_items.append((p, qty))

            shipping = Decimal("39.90") if has_physical and subtotal < 300 else Decimal("0")
            total = subtotal + shipping
            created = _ago(300)
            paid_at = created + datetime.timedelta(minutes=rng.randint(1, 40)) if pay != "PENDING" else None
            lat, lng = _near_adana()
            orders.append(
                {
                    "id": i,
                    "client_id": client_id,
                    "status": status,
                    "subtotal": subtotal,
                    "shipping_fee": shipping,
                    "discount": Decimal("0"),
                    "total": total,
                    "payment_status": pay,
                    "provider": "fake",
                    "provider_ref": f"scale-{i}" if pay == "PAID" else None,
                    "paid_at": paid_at,
                    "refunded_at": paid_at if pay == "REFUNDED" else None,
                    "refunded_amount": total if pay == "REFUNDED" else Decimal("0"),
                    "has_physical": has_physical,
                    "ship_recipient": "Alıcı",
                    "ship_phone": f"05{rng.randint(300000000, 599999999)}",
                    "ship_address": f"{rng.randint(1, 200)}. Sokak No:{rng.randint(1, 90)}",
                    "ship_city": "Adana",
                    "ship_district": rng.choice(DISTRICTS),
                    "ship_lat": lat,
                    "ship_lng": lng,
                    "ship_in_zone": True,
                    "promised_delivery_date": (created + datetime.timedelta(days=1)).date(),
                    "delivered_at": (
                        created + datetime.timedelta(days=1) if status == "DELIVERED" else None
                    ),
                    "track_token": uuid.uuid4().hex,
                    "created_at": created,
                    "updated_at": created,
                }
            )
            for p, qty in order_items:
                item_id += 1
                items.append(
                    {
                        "id": item_id,
                        "order_id": i,
                        "product_id": p["id"],
                        "title": p["title"],
                        "unit_price": p["price"],
                        "quantity": qty,
                        "kind": p["kind"],
                        "seller_type": p["seller_type"],
                        "tutor_id": p["tutor_id"],
                        "tax_rate": p["tax_rate"],
                        "tax_amount": (
                            Decimal(str(p["price"])) * qty * Decimal(str(p["tax_rate"]))
                        ).quantize(Decimal("0.01")),
                    }
                )
        await _bulk(session, Order, orders, "sipariş")
        await _bulk(session, OrderItem, items, "sipariş kalemi")

        # ── Dersler + ödemeler ────────────────────────────────────────────
        # Aynı eğitmen için zaman aralıkları deterministik olarak ayrıktır;
        # aksi halde GiST exclusion constraint (ex_bookings_no_overlap) düşer.
        bookings, payments = [], []
        base = datetime.datetime.now(UTC) - datetime.timedelta(days=120)
        per_tutor = max(1, n_bookings // n_tutors)
        bid = 0
        for tutor_idx in range(1, n_tutors + 1):
            t = tutors[tutor_idx - 1]
            for j in range(per_tutor):
                bid += 1
                start = base + datetime.timedelta(days=j // 4, hours=9 + 2 * (j % 4))
                start = start.replace(minute=0, second=0, microsecond=0)
                end = start + datetime.timedelta(hours=1)
                roll = rng.random()
                if roll < 0.60:
                    status = "COMPLETED"
                elif roll < 0.75:
                    status = "ACCEPTED"
                elif roll < 0.85:
                    status = "PENDING"
                elif roll < 0.93:
                    status = "CANCELLED"
                else:
                    status = "REJECTED"
                price = Decimal(str(t["hourly_rate"]))
                bookings.append(
                    {
                        "id": bid,
                        "tutor_id": tutor_idx,
                        "client_id": rng.randint(1, n_clients),
                        "status": status,
                        "start_at": start,
                        "end_at": end,
                        "price": price,
                        "mode": rng.choice(["ONLINE", "IN_PERSON"]),
                        "created_at": start - datetime.timedelta(days=3),
                        "updated_at": start,
                    }
                )
                if status in {"COMPLETED", "ACCEPTED", "CANCELLED"}:
                    commission = (price * Decimal("0.10")).quantize(Decimal("0.01"))
                    pstatus = {
                        "COMPLETED": "RELEASED",
                        "ACCEPTED": "HELD",
                        "CANCELLED": "REFUNDED",
                    }[status]
                    payments.append(
                        {
                            "booking_id": bid,
                            "amount": price,
                            "commission_amount": commission,
                            "tutor_earning": price - commission,
                            "commission_rate": Decimal("0.10"),
                            "status": pstatus,
                            "provider": "fake",
                            "provider_ref": f"scale-b{bid}",
                            "paid_at": start - datetime.timedelta(days=1),
                            "released_at": end if pstatus == "RELEASED" else None,
                            "refunded_at": end if pstatus == "REFUNDED" else None,
                            "created_at": start - datetime.timedelta(days=2),
                            "updated_at": end,
                        }
                    )
        await _bulk(session, Booking, bookings, "ders")
        await _bulk(session, Payment, payments, "ödeme")

        # ── Ders yorumları (yalnız COMPLETED derse) ───────────────────────
        completed = [b for b in bookings if b["status"] == "COMPLETED"]
        rng.shuffle(completed)
        reviews = [
            {
                "booking_id": b["id"],
                "client_id": b["client_id"],
                "tutor_id": b["tutor_id"],
                "rating": rng.randint(3, 5),
                "comment": "Anlatımı çok açıktı, konuyu kavradım.",
                "created_at": b["end_at"],
                "updated_at": b["end_at"],
            }
            for b in completed[: n(3000)]
        ]
        await _bulk(session, Review, reviews, "ders yorumu")

        # ── Ürün yorumları (ürün+müşteri tekil) ───────────────────────────
        prod_reviews, seen_pr = [], set()
        for _ in range(n(4000)):
            pair = (rng.randint(1, n_products), rng.randint(1, n_clients))
            if pair in seen_pr:
                continue
            seen_pr.add(pair)
            prod_reviews.append(
                {
                    "product_id": pair[0],
                    "client_id": pair[1],
                    "rating": rng.randint(3, 5),
                    "comment": "Kargo hızlıydı, kaynak beklediğim gibi.",
                    "created_at": _ago(250),
                    "updated_at": datetime.datetime.now(UTC),
                }
            )
        await _bulk(session, ProductReview, prod_reviews, "ürün yorumu")

        # ── Sohbetler + mesajlar ──────────────────────────────────────────
        convs, seen_conv = [], set()
        cid = 0
        while len(convs) < n_convs:
            pair = (rng.randint(1, n_clients), rng.randint(1, n_tutors))
            if pair in seen_conv:
                continue
            seen_conv.add(pair)
            cid += 1
            convs.append(
                {
                    "id": cid,
                    "client_id": pair[0],
                    "tutor_id": pair[1],
                    "client_last_read_at": _ago(30),
                    "tutor_last_read_at": _ago(30),
                    "created_at": _ago(200),
                    "updated_at": datetime.datetime.now(UTC),
                }
            )
        await _bulk(session, Conversation, convs, "sohbet")

        messages = []
        for k in range(n_messages):
            c = convs[k % len(convs)]
            from_client = rng.random() < 0.5
            messages.append(
                {
                    "conversation_id": c["id"],
                    "sender_role": "CLIENT" if from_client else "TUTOR",
                    "sender_id": c["client_id"] if from_client else c["tutor_id"],
                    "body": rng.choice(
                        [
                            "Merhaba, cumartesi müsait misiniz?",
                            "Ders saatini bir saat öne alabilir miyiz?",
                            "Konu anlatımını paylaştım, inceleyebilirsiniz.",
                            "Teşekkürler, çok faydalı oldu.",
                        ]
                    ),
                    "created_at": _ago(180),
                    "updated_at": datetime.datetime.now(UTC),
                }
            )
        await _bulk(session, Message, messages, "mesaj", chunk=10000)

        # ── Bildirimler ───────────────────────────────────────────────────
        notifications = [
            {
                "user_id": rng.randint(1, n_clients),
                "role_id": 3,
                "message": rng.choice(
                    [
                        "Rezervasyonunuz onaylandı.",
                        "Yeni mesajınız var.",
                        "Siparişiniz kargoya verildi.",
                        "Ders hatırlatması: yarın 14:00.",
                    ]
                ),
                "link": "/panel/ders-taleplerim",
                "is_read": rng.random() < 0.6,
                "created_at": _ago(120),
                "updated_at": datetime.datetime.now(UTC),
            }
            for _ in range(n_notifications)
        ]
        await _bulk(session, Notification, notifications, "bildirim", chunk=10000)

        # ── Sequence senkronu ─────────────────────────────────────────────
        # Satırlar açık id ile yazıldı; sequence geride kalırsa bu veritabanına
        # sonradan yapılacak her INSERT unique ihlali verir.
        with Timer("sequence senkronu"):
            for table in (
                "tutors", "clients", "libraries", "products", "product_categories",
                "orders", "order_items", "bookings", "conversations", "messages",
                "notifications", "reviews", "product_reviews", "library_reviews",
                "client_addresses", "library_hours", "library_images",
                "tutor_availability", "payments",
            ):
                await session.execute(
                    text(
                        "SELECT setval(pg_get_serial_sequence(:t, 'id'), "
                        "COALESCE((SELECT MAX(id) FROM " + table + "), 1))"
                    ),
                    {"t": table},
                )
            await session.commit()

        # ── ANALYZE ───────────────────────────────────────────────────────
        # Planlayıcı istatistiği olmadan ölçüm yanıltıcıdır: Postgres tabloları
        # hâlâ boş sanır ve her şeye seq scan seçer.
        with Timer("ANALYZE"):
            await session.execute(text("ANALYZE"))
            await session.commit()

    await engine.dispose()


async def main() -> int:
    if settings.POSTGRES_DB != SCALE_DB:
        print(
            f"HATA: bu script yalnız '{SCALE_DB}' veritabanında çalışır "
            f"(şu an: '{settings.POSTGRES_DB}').\n"
            f"Çalıştırma: python scripts/scale/run.py seed",
            file=sys.stderr,
        )
        return 1

    parser = argparse.ArgumentParser()
    parser.add_argument("--scale", type=float, default=1.0, help="hacim çarpanı")
    args = parser.parse_args()

    print(f">> ölçek seed'i başlıyor (scale={args.scale})", flush=True)
    t0 = time.perf_counter()
    await seed(args.scale)
    print(f">> tamamlandı: {time.perf_counter() - t0:.1f} sn")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
