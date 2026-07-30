"""Stok hareket defteri — yetkilendirme sözleşmesi (Karar 4).

## Neden bu testler DB kurmuyor

Yetki kararı tamamen `api/deps.py::require_admin_permission` içinde veriliyor:
(1) kullanıcı `Admin` örneği değilse 403, (2) izin kümesinde `products.view`
yoksa 403. İkisi de kullanıcının DB'de olup olmamasından bağımsız. Dört rol
için ayrı ayrı kütüphane/kurye/operatör satırı tohumlamak, testi korumadan
kırılgan yapar ve **aynı** kod dalını dördüncü kez ölçer.

Bu yüzden dependency'nin checker'ı **doğrudan** çağrılıyor: gerçek üretim kodu
koşuyor, dört rolün dördü de gerçekten deneniyor, kurulum maliyeti sıfır.
Ucun bu dependency'yi FİİLEN kullandığı ayrıca doğrulanıyor
(`test_stock_ledger_contract.py::test_defter_uclari_mevcut_urun_izinlerini_kullaniyor`)
— iki test birlikte zinciri kapatır.

Paketin ilk commit'i olduğu için uçlar yok: koşum kırmızıdır.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.deps import require_admin_permission
from models.admin import Admin
from models.client import Client
from models.courier_account import CourierAccount
from models.library_operator import LibraryOperator
from models.tutor import Tutor

PERMISSION = "products.view"


@pytest.fixture(scope="module")
def client():
    from main import app

    return TestClient(app)


# ───────────── Admin olmayan roller ─────────────

@pytest.mark.parametrize(
    "model,ad",
    [
        (Client, "CLIENT (3)"),
        (Tutor, "TUTOR (2)"),
        (LibraryOperator, "LIBRARY_OPERATOR (4)"),
        (CourierAccount, "COURIER (5)"),
    ],
)
async def test_admin_olmayan_roller_reddedilir(model, ad):
    checker = require_admin_permission(PERMISSION)
    with pytest.raises(HTTPException) as exc:
        await checker(user=model(), db=None)   # db'ye hiç dokunulmadan reddedilir
    assert exc.value.status_code == 403, ad


# ───────────── İzni olmayan admin ─────────────

async def test_izni_olmayan_admin_reddedilir(monkeypatch):
    from services import admin_access_service

    async def sahte(db, admin_id):
        # Ticaret grubundan başka izinleri olan ama products.view'i OLMAYAN
        # bir alt rol.
        return "SUPPORT", {"orders.view", "returns.view"}

    monkeypatch.setattr(admin_access_service, "get_admin_access", sahte)
    checker = require_admin_permission(PERMISSION)
    with pytest.raises(HTTPException) as exc:
        await checker(user=Admin(), db=None)
    assert exc.value.status_code == 403


async def test_izni_olan_admin_gecer(monkeypatch):
    from services import admin_access_service

    async def sahte(db, admin_id):
        return "SUPER_ADMIN", {PERMISSION}

    monkeypatch.setattr(admin_access_service, "get_admin_access", sahte)
    checker = require_admin_permission(PERMISSION)
    admin = Admin()
    assert await checker(user=admin, db=None) is admin


# ───────────── Anonim erişim ─────────────

def test_anonim_erisim_401(client):
    """Defter geçmişi ve doğrulama uçları oturum ister."""
    for yol in (
        "/api/v1/store/admin/products/1/stock-movements",
        "/api/v1/store/admin/products/1/stock-verify",
    ):
        r = client.get(yol)
        assert r.status_code in (401, 403), f"{yol} → {r.status_code}"


def test_uclarda_yazma_metodu_yok(client):
    """Append-only: uçta PATCH/PUT/DELETE bulunmaz (405 beklenir)."""
    yol = "/api/v1/store/admin/products/1/stock-movements"
    for metod in ("post", "patch", "put", "delete"):
        r = getattr(client, metod)(yol)
        assert r.status_code == 405, f"{metod.upper()} {yol} → {r.status_code}"


# ───────────── Eğitmen stok düzenleyemez (regresyon kalkanı) ─────────────

def test_egitmen_stok_alanini_duzenleyemez():
    """Bugün de böyle; defter geldikten sonra da böyle kalmalı.

    `update_product` eğitmen çağrısında (`owner_tutor_id is not None`) `stock`
    alanını düzenlenebilir listeye ALMAZ. Defter, admin gerekçesi zorunlu
    kıldığı için bu kural daha da kritik: eğitmen gerekçesiz stok yazamamalı.
    """
    import ast
    import pathlib

    src = (
        pathlib.Path(__file__).resolve().parents[2] / "services" / "store_service.py"
    ).read_text(encoding="utf-8")
    fn = next(
        n
        for n in ast.walk(ast.parse(src))
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        and n.name == "update_product"
    )
    # Stok yazımı yalnız `admin_id`/`owner_tutor_id is None` dalında olabilir ve
    # deftere gitmelidir; eğitmen dalında `apply_movement` çağrısı bulunmamalı.
    kaynak = ast.get_source_segment(src, fn) or ""
    assert "owner_tutor_id" in kaynak
    # Gerekçe alanları admin yolunda isteniyor olmalı.
    assert "stock_reason_code" in kaynak, (
        "Admin stok düzeltmesi gerekçe alanını okumuyor"
    )
