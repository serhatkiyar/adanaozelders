"""İP-19 filo modeli — GERÇEK Postgres + gerçek HTTP (bkz. conftest.py başlığı).

Düğümler: D-2 (uçlar + yetki) · D-3 (üçüncü araç plana girer, tavan aynı
listeden türer) · D-8 (aktif turu olan araç silinemez) · D-10 (gün+araç tekliği
`vehicle_id` üzerinde) · D-14 (metrikler) · D-15 (sıra dışı teslim korunur).

**Üretim kodundan ÖNCE yazıldı** (kök CLAUDE.md §E). Sözleşme:
`docs/ip19-dagitim-operasyon-sozlesme.md`.
"""
from __future__ import annotations

import datetime
import uuid

import pytest
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from tests.integration.auth_headers import bearer_headers


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class FiloFabrikasi:
    """İP-19'un kendi fixture'ı — başka paketin fabrikasına bağımlı olmasın."""

    def __init__(self) -> None:
        self.vehicle_ids: list[int] = []
        self.point_ids: list[int] = []
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []
        self.run_ids: list[int] = []

    async def arac(
        self,
        *,
        code: str | None = None,
        max_stops: int | None = None,
        fixed_cost: int = 0,
        sort_order: int = 0,
        is_active: bool = True,
    ) -> int:
        from models.vehicle import Vehicle

        async with AsyncSessionLocal() as s:
            v = Vehicle(
                code=code or f"ARAC_{_uniq()}",
                label="Test Aracı",
                max_stops=max_stops,
                fixed_cost=fixed_cost,
                sort_order=sort_order,
                is_active=is_active,
            )
            s.add(v)
            await s.flush()
            vid = v.id
            await s.commit()
        self.vehicle_ids.append(vid)
        return vid

    async def baslangic_noktasi(self, *, lat: float = 36.9855, lng: float = 35.3253) -> int:
        from models.pickup_point import PickupPoint

        async with AsyncSessionLocal() as s:
            p = PickupPoint(name=f"Baz {_uniq()}", kind="BASE", lat=lat, lng=lng)
            s.add(p)
            await s.flush()
            pid = p.id
            await s.commit()
        self.point_ids.append(pid)
        return pid

    async def admin(self, *izinler: str) -> tuple[int, dict[str, str]]:
        from models.admin import Admin
        from schemas.admin_access import AdminRoleCreate
        from services import admin_access_service

        async with AsyncSessionLocal() as s:
            # `full_name` hybrid'dir (NameMixin) — yazılamaz; parçaları ver.
            u = _uniq()
            a = Admin(
                email=f"ip19_{u}@test.local",
                first_name="İP19",
                last_name="Denetçi",
                hashed_password="x",
                is_active=True,
                role_id=1,
            )
            s.add(a)
            await s.flush()
            admin_id = a.id
            if izinler:
                rol = await admin_access_service.create_role(
                    s,
                    AdminRoleCreate(
                        code=f"IP19_{_uniq().upper()}",
                        name="İP-19 Test Rolü",
                        permission_codes=list(izinler),
                    ),
                )
                await admin_access_service.assign_role(
                    s, admin_id=admin_id, role_id=rol.id, assigned_by_admin_id=admin_id
                )
                self.role_ids.append(rol.id)
            await s.commit()
        self.admin_ids.append(admin_id)
        return admin_id, await bearer_headers(admin_id, role="ADMIN", role_id=1)

    async def temizle(self) -> None:
        from models.delivery import DeliveryRun
        from models.pickup_point import PickupPoint
        from models.vehicle import Vehicle

        async with AsyncSessionLocal() as s:
            for tablo, idler in (
                (DeliveryRun, self.run_ids),
                (Vehicle, self.vehicle_ids),
                (PickupPoint, self.point_ids),
            ):
                if idler:
                    await s.execute(
                        text(f"DELETE FROM {tablo.__tablename__} WHERE id = ANY(:i)"),
                        {"i": idler},
                    )
            if self.role_ids:
                await s.execute(
                    text(
                        "DELETE FROM admin_role_assignments "
                        "WHERE admin_role_id = ANY(:i)"
                    ),
                    {"i": self.role_ids},
                )
                await s.execute(
                    text(
                        "DELETE FROM admin_role_permissions "
                        "WHERE admin_role_id = ANY(:i)"
                    ),
                    {"i": self.role_ids},
                )
                await s.execute(
                    text("DELETE FROM admin_roles WHERE id = ANY(:i)"),
                    {"i": self.role_ids},
                )
            if self.admin_ids:
                # D-2 audit kaydı (vehicle.create/update) hijyen nöbetçisine
                # takılmasın: bu fabrikanın admin'lerinin izleri de silinir.
                await s.execute(
                    text("DELETE FROM audit_logs WHERE actor_id = ANY(:i)"),
                    {"i": self.admin_ids},
                )
                await s.execute(
                    text("DELETE FROM admins WHERE id = ANY(:i)"), {"i": self.admin_ids}
                )
            await s.commit()


@pytest.fixture
async def filo(pg):
    f = FiloFabrikasi()
    try:
        yield f
    finally:
        # Test BAŞARISIZ olsa bile teardown çalışır (kök CLAUDE.md §G).
        await f.temizle()


# ── D-2: araç uçları + yetki ──────────────────────────────────────────────────


async def test_D2_arac_crud_ucu_calisir_ve_yetki_ister(filo, http):
    """`/delivery/vehicles` dört fiil; yetkisiz **403**, yabancı id **404**."""
    _, yetkili = await filo.admin("delivery.view", "delivery.manage")
    _, yetkisiz = await filo.admin()

    r = await http.post(
        "/api/v1/delivery/vehicles",
        json={"code": f"YENI_{_uniq().upper()}", "label": "Yeni Araç"},
        headers=yetkili,
    )
    assert r.status_code == 201, r.text
    vid = r.json()["id"]
    filo.vehicle_ids.append(vid)

    assert (await http.get("/api/v1/delivery/vehicles", headers=yetkili)).status_code == 200
    assert (await http.get("/api/v1/delivery/vehicles", headers=yetkisiz)).status_code == 403
    assert (
        await http.patch(
            f"/api/v1/delivery/vehicles/{vid}", json={"label": "X"}, headers=yetkisiz
        )
    ).status_code == 403
    assert (
        await http.patch(
            "/api/v1/delivery/vehicles/99999999", json={"label": "X"}, headers=yetkili
        )
    ).status_code == 404


# ── D-3: üçüncü araç — paketin var oluş sebebi ────────────────────────────────


async def test_D3_ucuncu_arac_INSERT_ile_plana_girer(filo, monkeypatch):
    """Araç eklemek bir **INSERT**'tir; kod değişikliği değil (K-1).

    Bugün bu imkânsız: `_VEHICLE_IDS` sözlüğü ve `[1] / [1,2]` ternary'si
    (`delivery_service.py:1396, 1438-1442`) filo boyutunu koda gömüyor.
    """
    from services import delivery_service

    await filo.baslangic_noktasi()
    for i in range(3):
        await filo.arac(max_stops=2, sort_order=i)

    araclar = await delivery_service.aktif_araclar(None)
    assert len({a.id for a in araclar} & set(filo.vehicle_ids)) == 3, (
        "üçüncü araç aktif filoda görünmüyor"
    )


async def test_D3_gunluk_tavan_PLANA_GIREN_araclardan_turer(filo):
    """🔴 Sessiz tuzağın nöbetçisi (sözleşme §0.2).

    Bugün tavan `len(_VEHICLE_IDS)` ile çarpılıyor (`:1427`) ama plana yalnız
    `[1,2]` giriyor (`:1438-1442`). Üçüncü araç eklenirse tavan 120'ye çıkar,
    yük 2 araca biner, araç başına tavan aşılır — ve **hiçbir test görmez**.

    İddia: günlük tavan, plana giren araçların `max_stops` TOPLAMIDIR.
    """
    from services import delivery_service

    # NOT (kırmızı fazdan sonra güçlendirildi, dürüst kayıt): ilk hâl mutlak
    # `tavan == 12` bekliyordu. Migration LADA/COROLLA'yı seed'lediği için
    # taban hiç boş değildir — mutlak sayı, testi seed'e çivilerdi (tam da
    # bu paketin sildiği hata sınıfı). Ölçüm DELTA'ya çevrildi: iddia
    # "tavan, eklenen aktif araçların max_stops'u kadar artar; pasif araç
    # saymaz" — seed'den bağımsız ve daha güçlü.
    once = await delivery_service.gunluk_tavan(None)

    await filo.arac(max_stops=5, sort_order=0)
    await filo.arac(max_stops=7, sort_order=1)
    pasif = await filo.arac(max_stops=100, sort_order=2, is_active=False)

    sonra = await delivery_service.gunluk_tavan(None)
    assert sonra - once == 12, (
        f"tavan farkı {sonra - once} — eklenen aktif araçların max_stops "
        f"toplamı (5+7) olmalı; pasif araç ({pasif}) sayılmamalı"
    )


# ── D-8: aktif turu olan araç silinemez ───────────────────────────────────────


async def test_D8_aktif_turu_olan_arac_silinemez(filo, http):
    """Silme 409 döner ve tur bozulmaz — geçmiş veriyi koruyan FK sözleşmesi."""
    from models.delivery import DeliveryRun

    _, hdr = await filo.admin("delivery.view", "delivery.manage")
    vid = await filo.arac()

    async with AsyncSessionLocal() as s:
        r = DeliveryRun(run_date=datetime.date.today(), status="ACTIVE", vehicle_id=vid)
        s.add(r)
        await s.flush()
        rid = r.id
        await s.commit()
    filo.run_ids.append(rid)

    resp = await http.delete(f"/api/v1/delivery/vehicles/{vid}", headers=hdr)
    assert resp.status_code == 409, resp.text

    async with AsyncSessionLocal() as s:
        tur = (await s.execute(select(DeliveryRun).where(DeliveryRun.id == rid))).scalar_one()
        assert tur.vehicle_id == vid, "tur bozuldu"


# ── D-10: gün+araç tekliği `vehicle_id` üzerinde ──────────────────────────────


async def test_D10_ayni_gun_ayni_arac_ikinci_PLANNED_tur_reddedilir(filo):
    """`uq_delivery_run_planned` index'i `vehicle_id`'ye taşındı (K-8).

    Semantik değişmez: gün+araç başına tek planlı tur. Index otoritedir.
    """
    from sqlalchemy.exc import IntegrityError

    from models.delivery import DeliveryRun

    vid = await filo.arac()
    gun = datetime.date.today() + datetime.timedelta(days=40)

    async with AsyncSessionLocal() as s:
        r = DeliveryRun(run_date=gun, status="PLANNED", vehicle_id=vid)
        s.add(r)
        await s.flush()
        filo.run_ids.append(r.id)
        await s.commit()

    with pytest.raises(IntegrityError):
        async with AsyncSessionLocal() as s:
            s.add(DeliveryRun(run_date=gun, status="PLANNED", vehicle_id=vid))
            await s.commit()

    # DOLULUK NÖBETÇİSİ: kısıt gün+araç çiftine bağlı, "her ikinci tur"a değil.
    vid2 = await filo.arac()
    async with AsyncSessionLocal() as s:
        r2 = DeliveryRun(run_date=gun, status="PLANNED", vehicle_id=vid2)
        s.add(r2)
        await s.flush()
        filo.run_ids.append(r2.id)
        await s.commit()


# ── D-14: metrikler ───────────────────────────────────────────────────────────


async def test_D14_metrik_ucu_bes_alan_doner(filo, http):
    """Beş metrik mevcut alanlardan türer; yeni ölçüm alanı eklenmez (§4.3)."""
    _, hdr = await filo.admin("delivery.view")
    bugun = datetime.date.today().isoformat()

    r = await http.get(
        f"/api/v1/delivery/metrics?from_date={bugun}&to_date={bugun}", headers=hdr
    )
    assert r.status_code == 200, r.text
    for alan in (
        "on_time_rate",
        "first_attempt_rate",
        "stops_per_hour",
        "fail_reasons",
        "km_per_delivery",
    ):
        assert alan in r.json(), f"{alan} metriği yok"


# ── D-15: doğaçlama korunur (K-11) ────────────────────────────────────────────


async def test_D15_sira_disi_teslim_ENGELLENMEZ(filo):
    """`scan` durağı QR'dan bulur; `sequence` sırası **dayatılmaz**.

    Bu davranış bugün doğrudur (`delivery_service.py:2353`, yorum `:1191`) ve
    K-11 gereği **korunacaktır**: toptancıya giderken yol üstündeki paket
    okutulup teslim edilebilmelidir. Nöbetçi, ileride birisi "sıradaki durak
    değilse reddet" kuralı eklerse kırılır.
    """
    import inspect

    from services import delivery_service

    kaynak = inspect.getsource(delivery_service.scan)
    assert "sequence" not in kaynak, (
        "scan() `sequence`'e bakmaya başlamış — sıra dayatması K-11'i ihlal eder"
    )
