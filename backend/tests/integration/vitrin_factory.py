"""Vitrin (merchandising) entegrasyon testleri için gerçek satır fabrikası.

Neden gerekli: G4 sürümlü vitrin sisteminin para/yetki/sürüm davranışlarının
tek testi bugüne kadar saf bir şema testiydi (`tests/test_store_merchandising_
schema.py`, 157 satır). Yayın penceresi, GiST exclusion, tek-HOME index'i,
slug yönlendirmesi ve HMAC attribution token'ı **hiç** davranışla
sınanmamıştı — hepsi yalnız gerçek PostgreSQL'de gözlemlenebilir.

Fabrika üretim yolunu kullanır: sayfa/taslak/yayın HTTP uçlarından geçer,
dependency override YOKTUR, izin kararı `require_admin_permission` ile
gerçek rol satırlarından çözülür.

TAZE TEST DB'Sİ NOTU: `e8c89b9c1b61` backfill migration'ı boş bir veritabanına
da `store_landing_pages` id=1 (`ana-sayfa`, HOME) + revizyon 1 + **süresiz açık
bir yayın** yazar. Yani taze DB'de `/store/home` 200 döner ve **tek HOME
zaten doludur**. Testler bunu veri olarak kabul eder; HOME'a dokunan senaryolar
kendi değişikliğini geri alır.
"""
from __future__ import annotations

import dataclasses
import datetime
import uuid

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.admin import Admin
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service
from tests.integration.auth_headers import bearer_headers


@pytest.fixture
async def fabv(pg):
    f = VitrinFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


def uniq() -> str:
    return uuid.uuid4().hex[:10]


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def iso(dt: datetime.datetime) -> str:
    return dt.isoformat()


@dataclasses.dataclass
class Sayfa:
    id: int
    slug: str
    revision_id: int


class VitrinFabrikasi:
    def __init__(self) -> None:
        self.page_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []

    # ── Yönetici ─────────────────────────────────────────────────────────────

    async def admin(self, *, izinler: list[str]) -> tuple[int, dict]:
        """Gerçek admin + gerçek rol/izin satırları + gerçek imzalı JWT."""
        ek = uniq()
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"vitrin-admin-{ek}@test.local",
                hashed_password="test-only",
                first_name="Vitrin",
                last_name="Admin",
                username=f"va{ek}",
                role_id=1,
            )
            s.add(a)
            await s.flush()
            if izinler:
                rol = await admin_access_service.create_role(
                    s,
                    AdminRoleCreate(
                        code=f"VITRIN_{ek.upper()}",
                        name="Vitrin Test Rolü",
                        permission_codes=izinler,
                    ),
                )
                await admin_access_service.assign_role(
                    s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
                )
                self.role_ids.append(rol.id)
            await s.commit()
            self.admin_ids.append(a.id)
            admin_id = a.id
        return admin_id, await bearer_headers(admin_id, role="ADMIN", role_id=1)

    # ── Sayfa ────────────────────────────────────────────────────────────────

    @staticmethod
    def metin_blogu(baslik: str = "Merhaba", *, link_url: str | None = None) -> dict:
        """En az kısıtlı blok: RICH_TEXT yalnız HTML'siz metin ister.

        Görselli bloklar `_validate_image_url` ile medya kütüphanesi önekine
        bağlı; test kurgusunu depoya bağlamamak için metin bloğu kullanılır.
        """
        return {
            "block_key": uniq(),
            "block_type": "RICH_TEXT",
            "title": baslik,
            "description": "",
            "link_label": "",
            "link_url": link_url,
            "config": {"content": "test metni"},
            "is_active": True,
            "sort_order": 0,
        }

    async def sayfa(
        self,
        http,
        headers: dict,
        *,
        slug: str | None = None,
        page_type: str = "CAMPAIGN",
        baslik: str = "Test Kampanyası",
    ) -> Sayfa:
        """Üretim ucundan sayfa + ilk taslak revizyonu oluşturur."""
        s = slug or f"vitrin-test-{uniq()}"
        r = await http.post(
            "/api/v1/admin/store-merchandising/pages",
            headers=headers,
            json={
                "internal_name": baslik,
                "slug": s,
                "page_type": page_type,
                "revision": {
                    "title": baslik,
                    "seo_title": baslik,
                    "seo_description": "test",
                    "blocks": [self.metin_blogu(baslik)],
                },
            },
        )
        assert r.status_code == 201, r.text
        gövde = r.json()
        self.page_ids.append(gövde["id"])
        return Sayfa(
            id=gövde["id"], slug=gövde["slug"], revision_id=gövde["latest_revision_id"]
        )

    async def yayinla(
        self,
        http,
        headers: dict,
        sayfa: Sayfa,
        *,
        starts_at: datetime.datetime | None = None,
        ends_at: datetime.datetime | None = None,
        revision_id: int | None = None,
    ):
        gövde: dict = {"starts_at": iso(starts_at or (now() - datetime.timedelta(minutes=1)))}
        if ends_at is not None:
            gövde["ends_at"] = iso(ends_at)
        return await http.post(
            f"/api/v1/admin/store-merchandising/pages/{sayfa.id}"
            f"/revisions/{revision_id or sayfa.revision_id}/publish",
            headers=headers,
            json=gövde,
        )

    # ── Temizlik ─────────────────────────────────────────────────────────────

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.page_ids:
                # Yönlendirmeler sayfaya CASCADE bağlı DEĞİL olabilir; önce
                # onlar, sonra sayfa. Revizyon/blok/yayın CASCADE ile gider.
                await s.execute(
                    text("DELETE FROM store_landing_page_redirects WHERE page_id = ANY(:p)"),
                    {"p": self.page_ids},
                )
                # Metrikler sayfaya DEĞİL revizyona bağlıdır
                # (`page_revision_id`, ON DELETE CASCADE) — sayfa silinince
                # revizyonla birlikte kendiliğinden gider. İlk yazımda burada
                # `page_id` vardı ve teardown "column does not exist" ile
                # patlıyordu; bu da hijyen nöbetçisini tetikleyip 14 testi
                # ERROR gösteriyordu (asıl kusur testte değil temizlikteydi).
                await s.execute(
                    text(
                        "DELETE FROM store_page_daily_metrics WHERE page_revision_id IN "
                        "(SELECT id FROM store_landing_page_revisions WHERE page_id = ANY(:p))"
                    ),
                    {"p": self.page_ids},
                )
                await s.execute(
                    text("DELETE FROM store_landing_page_publications WHERE page_id = ANY(:p)"),
                    {"p": self.page_ids},
                )
                await s.execute(
                    text("DELETE FROM store_landing_pages WHERE id = ANY(:p)"),
                    {"p": self.page_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE actor_role = 1 AND actor_id = ANY(:a)"
                    ),
                    {"a": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
            if self.role_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_assignments WHERE admin_role_id = ANY(:r)"
                    ),
                    {"r": self.role_ids},
                )
                await s.execute(
                    text(
                        "DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:r)"
                    ),
                    {"r": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:r)"),
                    {"r": self.role_ids},
                )
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:a)"),
                    {"a": self.admin_ids},
                )
            await s.commit()
