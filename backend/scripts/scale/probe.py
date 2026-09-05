"""Gerçek uçları gerçekçi hacimde ölçer — yavaş sorgu ve N+1 avı.

NASIL: uygulamayı httpx'in ASGI taşıyıcısıyla doğrudan çağırır (lifespan
çalışmaz → arka plan döngüleri ölçümü kirletmez), her istek sırasında
SQLAlchemy'nin çalıştırdığı HER sorguyu sayar ve süresini toplar.

Neden sorgu SAYISI: yavaşlığın iki ayrı sebebi vardır ve tedavileri farklıdır.
Tek sorgu yavaşsa → indeks eksiktir. Sorgu sayısı liste uzunluğuyla birlikte
artıyorsa → N+1 vardır ve indeks eklemek çözmez. Süre tek başına ikisini
ayırmaz; bu yüzden ikisi birlikte raporlanır.

Kullanım (backend/ içinden):
    python scripts/scale/run.py probe
    python scripts/scale/run.py probe --repeat 5
    python scripts/scale/run.py probe --only tutor      # ada göre filtre
"""
from __future__ import annotations

import argparse
import asyncio
import pathlib
import statistics
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

# Windows konsolu varsayılan olarak cp1254'tür ve Türkçe/işaret karakterlerinde
# UnicodeEncodeError verir (aynı tuzak requirements.txt'te de yaşandı).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001 - eski Python / yönlendirilmiş çıktı
        pass

import httpx  # noqa: E402
from sqlalchemy import event, text  # noqa: E402

from core.config import settings  # noqa: E402
from core.database import AsyncSessionLocal, engine  # noqa: E402
from core.security import create_access_token  # noqa: E402

SCALE_DB = "adana_scale"

# Ölçümde "yavaş" eşikleri. Kaynak: p95 hedefi 300 ms olan bir listeleme ucu
# için DB süresi 150 ms'i geçmemeli; sorgu sayısı ise sabit olmalı.
SLOW_MS = 150.0
MANY_QUERIES = 10


class QueryStats:
    """Bir istek boyunca çalışan sorguları toplar."""

    def __init__(self) -> None:
        self.count = 0
        self.total_ms = 0.0
        self.slowest_ms = 0.0
        self.slowest_sql = ""
        self.slowest_raw = ""
        self.slowest_params: tuple = ()
        self.by_sql: dict[str, int] = {}

    def add(self, sql: str, ms: float, params: object = ()) -> None:
        self.count += 1
        self.total_ms += ms
        norm = " ".join(sql.split())[:180]
        self.by_sql[norm] = self.by_sql.get(norm, 0) + 1
        if ms > self.slowest_ms:
            self.slowest_ms = ms
            self.slowest_sql = norm
            self.slowest_raw = sql
            self.slowest_params = tuple(params) if isinstance(params, (tuple, list)) else ()

    @property
    def repeated(self) -> tuple[str, int] | None:
        """Aynı sorgunun tekrarı — N+1'in imzası."""
        if not self.by_sql:
            return None
        sql, n = max(self.by_sql.items(), key=lambda kv: kv[1])
        return (sql, n) if n > 1 else None


_current: QueryStats | None = None


def install_counter() -> None:
    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        conn.info["_probe_t0"] = time.perf_counter()

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        if _current is None:
            return
        _current.add(
            statement,
            (time.perf_counter() - conn.info["_probe_t0"]) * 1000,
            parameters,
        )


async def explain(sql: str, params: tuple) -> str:
    """En yavaş sorgunun gerçek planını çıkarır.

    Ham asyncpg bağlantısı kullanılır: SQLAlchemy'nin ürettiği metin zaten
    asyncpg'nin $1 parametre stilindedir, `text()` ile sarmak çakışır.
    """
    import asyncpg

    conn = await asyncpg.connect(
        user=settings.POSTGRES_USER,
        password=settings.POSTGRES_PASSWORD,
        host=settings.POSTGRES_HOST,
        port=settings.POSTGRES_PORT,
        database=settings.POSTGRES_DB,
    )
    try:
        rows = await conn.fetch(f"EXPLAIN (ANALYZE, BUFFERS) {sql}", *params)
        return "\n".join(r[0] for r in rows)
    except Exception as exc:  # noqa: BLE001
        return f"(plan alınamadı: {exc})"
    finally:
        await conn.close()


class Case:
    def __init__(self, name: str, method: str, url: str, *, role: str = "public") -> None:
        self.name = name
        self.method = method
        self.url = url
        self.role = role


async def ensure_admin() -> int:
    """Admin uçlarını ölçebilmek için SUPER_ADMIN yetkili bir hesap garanti eder.

    Yalnız `admins` satırı yetmez: yönetim uçları `require_admin_permission`
    ile görev bazlı izin ister, izinler `admin_role_assignments` üzerinden gelir.
    """
    from models.admin import Admin

    async with AsyncSessionLocal() as s:
        admin_id = (
            await s.execute(text("SELECT id FROM admins ORDER BY id LIMIT 1"))
        ).scalar()
        if not admin_id:
            a = Admin(
                email="admin@scale.test",
                hashed_password="x",
                first_name="Olcum",
                last_name="Admin",
                role_id=1,
                is_active=True,
            )
            s.add(a)
            await s.commit()
            admin_id = a.id

        assigned = (
            await s.execute(
                text(
                    "SELECT 1 FROM admin_role_assignments "
                    "WHERE admin_id = :a AND deleted_at IS NULL"
                ),
                {"a": admin_id},
            )
        ).scalar()
        if not assigned:
            await s.execute(
                text(
                    "INSERT INTO admin_role_assignments (admin_id, admin_role_id) "
                    "SELECT :a, id FROM admin_roles WHERE code = 'SUPER_ADMIN'"
                ),
                {"a": admin_id},
            )
            await s.commit()
        return int(admin_id)


def build_cases(ctx: dict) -> list[Case]:
    lat, lng = 37.00, 35.32
    top_cat = ctx["top_category_id"]
    leaf_cat = ctx["leaf_category_id"]
    return [
        # ── Public arama yüzeyleri (SEO + dönüşümün taşıyıcısı) ──
        Case("tutor.search.ilk-sayfa", "GET", "/api/v1/tutors/search?limit=20"),
        Case("tutor.search.metin", "GET", "/api/v1/tutors/search?q=matematik&limit=20"),
        Case("tutor.search.brans+ilce", "GET",
             "/api/v1/tutors/search?subject=Matematik&district=Seyhan&limit=20"),
        Case("tutor.search.yakinimda", "GET",
             f"/api/v1/tutors/search?lat={lat}&lng={lng}&radius_km=10&limit=20"),
        Case("tutor.search.derin-sayfa", "GET", "/api/v1/tutors/search?limit=20&offset=160"),
        Case("tutor.search.fiyat-siralama", "GET", "/api/v1/tutors/search?sort=price_asc&limit=20"),
        Case("tutor.detay", "GET", f"/api/v1/tutors/{ctx['tutor_id']}"),
        Case("tutor.fiyat-histogrami", "GET", "/api/v1/tutors/price-histogram"),

        Case("kutuphane.liste", "GET", "/api/v1/libraries?limit=20"),
        Case("kutuphane.yakinimda", "GET",
             f"/api/v1/libraries?lat={lat}&lng={lng}&radius_km=10&limit=20"),
        Case("kutuphane.detay", "GET", f"/api/v1/libraries/{ctx['library_id']}"),

        Case("magaza.kategoriler", "GET", "/api/v1/store/categories"),
        Case("magaza.urunler", "GET", "/api/v1/store/products?limit=30"),
        Case("magaza.ust-kategori", "GET", f"/api/v1/store/products?category_id={top_cat}&limit=30"),
        Case("magaza.alt-kategori", "GET", f"/api/v1/store/products?category_id={leaf_cat}&limit=30"),
        Case("magaza.metin-arama", "GET", "/api/v1/store/products?q=matematik&limit=30"),
        Case("magaza.fiyat-siralama", "GET", "/api/v1/store/products?sort=price_asc&limit=30"),
        Case("magaza.derin-sayfa", "GET", "/api/v1/store/products?limit=30&offset=900"),
        Case("magaza.urun-detay", "GET", f"/api/v1/store/products/{ctx['product_slug']}"),
        Case("magaza.teslimat-bilgisi", "GET", "/api/v1/store/delivery-info"),
        Case("liderlik-tablosu", "GET", "/api/v1/leaderboard", role="client"),

        # ── Oturumlu yüzeyler ──
        Case("ogrenci.siparislerim", "GET", "/api/v1/store/orders/mine", role="client"),
        Case("ogrenci.bildirimler", "GET", "/api/v1/notifications?limit=20", role="client"),
        Case("ogrenci.okunmamis", "GET", "/api/v1/notifications/unread-count", role="client"),
        Case("ogrenci.sohbetler", "GET", "/api/v1/messages/conversations", role="client"),
        Case("ogrenci.derslerim", "GET", "/api/v1/bookings", role="client"),
        Case("egitmen.derslerim", "GET", "/api/v1/bookings", role="tutor"),
        Case("egitmen.sohbetler", "GET", "/api/v1/messages/conversations", role="tutor"),

        # ── Admin / operasyon ──
        Case("admin.istatistik", "GET", "/api/v1/admin/stats", role="admin"),
        Case("admin.dashboard", "GET", "/api/v1/admin/dashboard", role="admin"),
        Case("admin.kullanicilar", "GET", "/api/v1/admin/users?limit=50", role="admin"),
        Case("admin.dersler", "GET", "/api/v1/admin/bookings?limit=50", role="admin"),
        Case("admin.siparisler", "GET", "/api/v1/store/admin/orders?limit=50", role="admin"),
        Case("admin.urunler", "GET", "/api/v1/store/admin/products?limit=100", role="admin"),
        Case("admin.hakedis", "GET", "/api/v1/payouts/pending", role="admin"),
        Case("admin.gelir", "GET", "/api/v1/admin/revenue?range=month", role="admin"),
        Case("admin.teslimat-uygun", "GET", "/api/v1/delivery/eligible-orders", role="admin"),
    ]


async def gather_context() -> dict:
    async with AsyncSessionLocal() as s:
        async def one(sql: str):
            return (await s.execute(text(sql))).first()

        tutor = await one("SELECT id FROM tutors WHERE status='APPROVED' ORDER BY id LIMIT 1")
        client = await one("SELECT id FROM clients ORDER BY id LIMIT 1")
        library = await one("SELECT slug FROM libraries WHERE status='ACTIVE' ORDER BY id LIMIT 1")
        product = await one("SELECT slug FROM products WHERE status='ACTIVE' ORDER BY id LIMIT 1")
        top = await one("SELECT id FROM product_categories WHERE parent_id IS NULL ORDER BY id LIMIT 1")
        leaf = await one("SELECT id FROM product_categories WHERE parent_id IS NOT NULL ORDER BY id LIMIT 1")
        return {
            "tutor_id": tutor[0],
            "client_id": client[0],
            "library_id": library[0],
            "product_slug": product[0],
            "top_category_id": top[0],
            "leaf_category_id": leaf[0],
        }


async def run(repeat: int, only: str | None, want_explain: bool) -> int:
    global _current

    ctx = await gather_context()
    admin_id = await ensure_admin()
    tokens = {
        "public": None,
        "client": create_access_token(subject=ctx["client_id"], role="CLIENT", role_id=3, auth_version=1),
        "tutor": create_access_token(subject=ctx["tutor_id"], role="TUTOR", role_id=2, auth_version=1),
        "admin": create_access_token(subject=admin_id, role="ADMIN", role_id=1, auth_version=1),
    }

    from main import app

    install_counter()
    cases = [c for c in build_cases(ctx) if not only or only in c.name]

    results = []
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://probe") as client:
        for case in cases:
            headers = {}
            if tokens[case.role]:
                headers["Authorization"] = f"Bearer {tokens[case.role]}"

            # Isınma turu: ilk istek yolun derleme/plan maliyetini taşır.
            warm = await client.request(case.method, case.url, headers=headers)

            samples, stats_list = [], []
            for _ in range(repeat):
                _current = QueryStats()
                t0 = time.perf_counter()
                resp = await client.request(case.method, case.url, headers=headers)
                wall = (time.perf_counter() - t0) * 1000
                stats_list.append(_current)
                samples.append(wall)
                _current = None

            best = stats_list[len(stats_list) // 2]
            size = len(resp.content)
            results.append(
                {
                    "name": case.name,
                    "status": resp.status_code,
                    "wall_ms": statistics.median(samples),
                    "db_ms": best.total_ms,
                    "queries": best.count,
                    "slowest_ms": best.slowest_ms,
                    "slowest_sql": best.slowest_sql,
                    "slowest_raw": best.slowest_raw,
                    "slowest_params": best.slowest_params,
                    "repeated": best.repeated,
                    "bytes": size,
                    "warm_status": warm.status_code,
                }
            )

    _print_report(results)

    if want_explain:
        print()
        print("PLANLAR (en yavaş sorgu, EXPLAIN ANALYZE)")
        print("=" * 82)
        for r in sorted(results, key=lambda x: -x["db_ms"]):
            if r["db_ms"] <= SLOW_MS or not r["slowest_raw"]:
                continue
            print(f"\n### {r['name']}  ({r['slowest_ms']:.0f} ms)")
            print(" ".join(r["slowest_raw"].split())[:400])
            print("-" * 82)
            print(await explain(r["slowest_raw"], r["slowest_params"]))

    await engine.dispose()
    return 0


def _print_report(results: list[dict]) -> None:
    print()
    print(f"{'senaryo':<32}{'kod':>5}{'süre ms':>10}{'DB ms':>9}{'sorgu':>7}{'en yavaş':>10}{'KB':>7}")
    print("-" * 82)
    for r in sorted(results, key=lambda x: -x["db_ms"]):
        flag = ""
        if r["status"] >= 400:
            flag = "  !HATA"
        elif r["db_ms"] > SLOW_MS:
            flag = "  ← YAVAŞ"
        elif r["queries"] > MANY_QUERIES:
            flag = "  ← ÇOK SORGU"
        print(
            f"{r['name']:<32}{r['status']:>5}{r['wall_ms']:>10.1f}{r['db_ms']:>9.1f}"
            f"{r['queries']:>7}{r['slowest_ms']:>10.1f}{r['bytes']/1024:>7.1f}{flag}"
        )

    print()
    print("DİKKAT EDİLECEKLER")
    print("-" * 82)
    any_flag = False
    for r in sorted(results, key=lambda x: -x["db_ms"]):
        notes = []
        if r["status"] >= 400:
            notes.append(f"HTTP {r['status']} — uç çağrılamadı (parametre/yetki)")
        if r["db_ms"] > SLOW_MS:
            notes.append(f"DB süresi {r['db_ms']:.0f} ms")
        if r["queries"] > MANY_QUERIES:
            notes.append(f"{r['queries']} sorgu")
        if r["repeated"]:
            sql, n = r["repeated"]
            if n >= 3:
                notes.append(f"aynı sorgu {n}× (N+1 şüphesi)")
        if not notes:
            continue
        any_flag = True
        print(f"\n▸ {r['name']}: " + " · ".join(notes))
        if r["slowest_sql"]:
            print(f"    en yavaş ({r['slowest_ms']:.0f} ms): {r['slowest_sql'][:150]}")
        if r["repeated"] and r["repeated"][1] >= 3:
            print(f"    tekrar eden: {r['repeated'][0][:150]}")
    if not any_flag:
        print("(yok)")


async def main() -> int:
    if settings.POSTGRES_DB != SCALE_DB:
        print(
            f"HATA: bu script yalnız '{SCALE_DB}' veritabanında çalışır "
            f"(şu an: '{settings.POSTGRES_DB}').\n"
            f"Çalıştırma: python scripts/scale/run.py probe",
            file=sys.stderr,
        )
        return 1
    parser = argparse.ArgumentParser()
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--only", type=str, default=None)
    parser.add_argument(
        "--explain",
        action="store_true",
        help="yavaş bulunan senaryolar için EXPLAIN ANALYZE planını da yazdır",
    )
    args = parser.parse_args()
    return await run(args.repeat, args.only, args.explain)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
