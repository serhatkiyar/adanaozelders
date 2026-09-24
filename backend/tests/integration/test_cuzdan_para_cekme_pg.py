"""Öğretmen cüzdanı: bakiye, "Para çek" talebi, admin ödemesi, CSV.

Kural (kullanıcı kararı, 23 Eyl 2026): öğretmene para, kendisi "Para çek"
diyene kadar gönderilmez. Admin öğretmene ödemeyi ancak açık talep üzerine
kaydedebilir; kayıtla talep PAID olur.

Kazanç kaynağı (ödeme satırları) bu testin konusu değil: `_tutor_earned`
sabit bir kazançla değiştirilir, geri kalan her şey gerçek uçlardan geçer.
Elle havale kapısı (`assert_manual_payout_open`) üretimde kapalıdır; burada
admin yolunu sınamak için açılır.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text

from core.database import AsyncSessionLocal
from models.payout import PayoutRequest
from models.tutor import Tutor
from services import payment_gates, payout_ledger
from tests.integration.ip3_factory import yetki_basligi

KOK = "/api/v1/me/wallet"
KAZANC = Decimal("500.00")
EMANET = Decimal("120.00")


@pytest.fixture
async def sabit_kazanc(monkeypatch):
    """Her öğretmen için sabit kazanç; tek öğretmen filtresine de uyar."""
    kayitli: set[int] = set()

    async def _sahte(db, *, yalniz_tutor_id=None):  # noqa: ANN001
        ids = {yalniz_tutor_id} if yalniz_tutor_id is not None else kayitli
        return (
            {i: KAZANC for i in ids if i in kayitli},
            {i: EMANET for i in ids if i in kayitli},
        )

    monkeypatch.setattr(payout_ledger, "_tutor_earned", _sahte)

    async def _acik(db):  # noqa: ANN001
        return None

    monkeypatch.setattr(payment_gates, "assert_manual_payout_open", _acik)
    yield kayitli

    # Suite hijyeni: fabrika temizliği öğretmen aktörlü denetim kayıtlarını ve
    # (FK'sız) ödeme defteri satırlarını bilmez; bu testin ürettiklerini sil.
    if kayitli:
        async with AsyncSessionLocal() as s:
            ids = list(kayitli)
            await s.execute(
                text(
                    "DELETE FROM audit_logs WHERE target_type = 'tutor' "
                    "AND target_id = ANY(:t) AND action IN ('payout.request', 'payout.record')"
                ),
                {"t": ids},
            )
            await s.execute(text("DELETE FROM payout_requests WHERE tutor_id = ANY(:t)"), {"t": ids})
            await s.execute(
                text("DELETE FROM payout_records WHERE payee_type = 'TUTOR' AND payee_id = ANY(:t)"),
                {"t": ids},
            )
            await s.commit()


async def _iban_aktif(tutor_id: int, durum: str = "ACTIVE") -> None:
    async with AsyncSessionLocal() as s:
        t = await s.get(Tutor, tutor_id)
        t.payout_status = durum
        await s.commit()


@pytest.mark.asyncio
async def test_ogrenci_ve_anonim_cuzdana_erisemez(ip3, http):
    ogrenci = await ip3.client()
    assert (await http.get(KOK, headers=yetki_basligi(ogrenci))).status_code == 403
    assert (await http.get(KOK)).status_code == 401
    assert (await http.post(f"{KOK}/withdrawals", headers=yetki_basligi(ogrenci))).status_code == 403


@pytest.mark.asyncio
async def test_iban_yoksa_para_cekilemez(ip3, http, sabit_kazanc):
    ogretmen = await ip3.tutor()
    sabit_kazanc.add(ogretmen.id)
    h = yetki_basligi(ogretmen)
    cuzdan = (await http.get(KOK, headers=h)).json()
    assert Decimal(cuzdan["balance"]) == KAZANC
    assert Decimal(cuzdan["pending"]) == EMANET
    assert "IBAN" in (cuzdan["withdraw_block_reason"] or "")
    r = await http.post(f"{KOK}/withdrawals", headers=h)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_talep_admin_odemesi_ve_bakiye(ip3, http, sabit_kazanc):
    ogretmen = await ip3.tutor()
    sabit_kazanc.add(ogretmen.id)
    await _iban_aktif(ogretmen.id)
    h = yetki_basligi(ogretmen)

    r = await http.post(f"{KOK}/withdrawals", headers=h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert Decimal(body["open_request"]["amount"]) == KAZANC, "tutar sunucuda, bakiyenin tamamı"
    assert body["withdraw_block_reason"] is not None

    # İkinci talep reddedilir.
    assert (await http.post(f"{KOK}/withdrawals", headers=h)).status_code == 409

    admin = await ip3.admin(permissions=["payments.view", "payments.manage"])
    ah = yetki_basligi(admin)
    liste = (await http.get("/api/v1/payouts/pending", headers=ah)).json()
    satir = next(x for x in liste if x["payee_type"] == "TUTOR" and x["payee_id"] == ogretmen.id)
    assert Decimal(satir["requested_amount"]) == KAZANC

    # Talep tutarından fazlası kaydedilemez.
    fazla = await http.post(
        "/api/v1/payouts",
        json={"payee_type": "TUTOR", "payee_id": ogretmen.id, "amount": "600"},
        headers=ah,
    )
    assert fazla.status_code == 409

    ode = await http.post(
        "/api/v1/payouts",
        json={"payee_type": "TUTOR", "payee_id": ogretmen.id, "amount": str(KAZANC)},
        headers=ah,
    )
    assert ode.status_code == 201, ode.text

    cuzdan = (await http.get(KOK, headers=h)).json()
    assert Decimal(cuzdan["balance"]) == Decimal("0")
    assert cuzdan["open_request"] is None
    async with AsyncSessionLocal() as s:
        talep = await s.scalar(select(PayoutRequest).where(PayoutRequest.tutor_id == ogretmen.id))
        assert talep.status == "PAID" and talep.payout_record_id is not None

    # CSV: BOM + başlık + para çekme satırı.
    csv = await http.get(f"{KOK}/export", headers=h)
    assert csv.status_code == 200
    assert csv.headers["content-type"].startswith("text/csv")
    assert "attachment" in csv.headers["content-disposition"]
    metin = csv.content.decode("utf-8")
    assert metin.startswith("﻿")
    assert "Tarih (UTC),Tür,Açıklama" in metin
    assert "Para çekme" in metin and "Ödendi" in metin


@pytest.mark.asyncio
async def test_talep_yokken_admin_ogretmene_odeyemez(ip3, http, sabit_kazanc):
    ogretmen = await ip3.tutor()
    sabit_kazanc.add(ogretmen.id)
    await _iban_aktif(ogretmen.id)
    admin = await ip3.admin(permissions=["payments.view", "payments.manage"])
    r = await http.post(
        "/api/v1/payouts",
        json={"payee_type": "TUTOR", "payee_id": ogretmen.id, "amount": "100"},
        headers=yetki_basligi(admin),
    )
    assert r.status_code == 409
    assert "talebi yok" in r.text


@pytest.mark.asyncio
async def test_esitmanli_iki_talep_tek_kayit(ip3, sabit_kazanc):
    ogretmen = await ip3.tutor()
    sabit_kazanc.add(ogretmen.id)
    await _iban_aktif(ogretmen.id)

    async def talep():
        async with AsyncSessionLocal() as s:
            t = await s.get(Tutor, ogretmen.id)
            try:
                out = await payout_ledger.create_request(s, t)
                await s.commit()
                return out
            except HTTPException as exc:
                await s.rollback()
                return exc

    sonuc = await asyncio.gather(talep(), talep())
    assert sum(isinstance(x, HTTPException) for x in sonuc) == 1
    async with AsyncSessionLocal() as s:
        adet = await s.scalar(
            select(func.count()).select_from(PayoutRequest).where(
                PayoutRequest.tutor_id == ogretmen.id,
                PayoutRequest.status == "REQUESTED",
            )
        )
    assert adet == 1


@pytest.mark.asyncio
async def test_baska_ogretmenin_talebi_gorunmez(ip3, http, sabit_kazanc):
    a = await ip3.tutor()
    b = await ip3.tutor()
    sabit_kazanc.update({a.id, b.id})
    await _iban_aktif(a.id)
    assert (await http.post(f"{KOK}/withdrawals", headers=yetki_basligi(a))).status_code == 201
    cuzdan_b = (await http.get(KOK, headers=yetki_basligi(b))).json()
    assert cuzdan_b["open_request"] is None
