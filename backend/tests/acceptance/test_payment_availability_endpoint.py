"""PK-1 kabul testi — public uygunluk ucunun HTTP sözleşmesi.

Servis katmanı testleri (`test_payment_branch_gates.py`) `branches_status`'un
teşhis alanlarını çıkardığını doğruluyor. Ama şema (`PaymentBranchOut`) admin
yüzeyiyle paylaşıldığı için opsiyonel alanlar `None` kalıp gövdeye `null`
olarak yazılabiliyordu — bilgi sızmıyordu, fakat public sözleşme "bu alanlar
var, boş" diyordu. Bu test HTTP gövdesinin kendisini kontrol eder.

(Gerçek dev ortamında bu uç kontrol edilirken fark edildi; bu yüzden testi
servis seviyesinde değil uç seviyesinde tutuyoruz.)
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    from main import app

    # Not: lifespan çalıştırılmaz (DB/Redis gerektirmesin) — uç `get_db`
    # bağımlılığını kullanır ve bayraklar okunamazsa fail-closed davranır.
    return TestClient(app)


def test_uygunluk_ucu_anonim_erisilebilir_ve_teshis_alani_ICERMEZ(client):
    r = client.get("/api/v1/payments/availability")
    assert r.status_code == 200
    body = r.json()
    assert "branches" in body
    # 4 kol: store, tutor_marketplace, library_marketplace, tutor_promotion.
    # Sayı bilinçli olarak elle yazılıdır (kaynaktaki `_BRANCH_ORDER`'a
    # bağlanmaz): kol eklemek public sözleşmeyi genişletir ve bu testin
    # güncellenmesi o kararın kaydıdır. Sayıyı kaynaktan okumak, kolun
    # gövdeye hiç düşmediği durumu da sessizce yeşil gösterirdi.
    assert len(body["branches"]) == 4

    for row in body["branches"]:
        # Public sözleşme: yalnız bunlar.
        assert set(row) <= {"branch", "label", "open", "message"}
        assert "flag_enabled" not in row
        assert "blockers" not in row
        assert isinstance(row["open"], bool)


def test_kapali_kol_musteri_metni_dondurur_ve_emanet_vaadi_ICERMEZ(client):
    r = client.get("/api/v1/payments/availability")
    for row in r.json()["branches"]:
        if row["open"]:
            continue
        assert row.get("message"), "kapalı kol için kullanıcıya metin dönmeli"
        lowered = row["message"].lower()
        assert "emanet" not in lowered
        assert "escrow" not in lowered
