"""Mesaj şablonları (sohbet modernizasyonu Faz 2) — GERÇEK Postgres.

Sahiplik ``(owner_role, owner_id)`` ile tutulur (`MessageReaction` ile aynı
kalıp, `models/messaging.py::MessageTemplate`). Bu testler üç şeyi doğrular:

1. Yalnız TUTOR rolü uçlara erişebilir (v1 kapsamı, `docs/...` plana göre).
2. Bir eğitmen başka bir eğitmenin şablonunu ne görebilir ne silebilir —
   sahiplik filtresi olmasa bu sessizce yanlışlıkla başka bir eğitmenin
   özel şablonlarını sızdırır ya da silmesine izin verirdi.
3. Azami şablon sayısı (`_MAX_TEMPLATES_PER_OWNER`) gerçekten uygulanıyor.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.ip3_factory import yetki_basligi

KOK = "/api/v1/messages/templates"


@pytest.mark.asyncio
async def test_client_sablon_uclarina_erisemez(ip3, http):
    ogrenci = await ip3.client()

    r = await http.get(KOK, headers=yetki_basligi(ogrenci))

    assert r.status_code == 403, f"öğrenci şablon uçlarına erişti ({r.status_code})"


@pytest.mark.asyncio
async def test_egitmen_sablon_olusturur_listeler_siler(ip3, http):
    egitmen = await ip3.tutor()
    basligi = yetki_basligi(egitmen)

    olustur = await http.post(
        KOK, headers=basligi, json={"title": "Karşılama", "body": "Merhaba!"}
    )
    assert olustur.status_code == 201, olustur.text
    sablon_id = olustur.json()["id"]

    liste = await http.get(KOK, headers=basligi)
    assert liste.status_code == 200
    assert [s["id"] for s in liste.json()] == [sablon_id]

    sil = await http.delete(f"{KOK}/{sablon_id}", headers=basligi)
    assert sil.status_code == 204

    liste2 = await http.get(KOK, headers=basligi)
    assert liste2.json() == [], "silinen şablon listede hâlâ görünüyor"


@pytest.mark.asyncio
async def test_baska_egitmenin_sablonunu_goremez_silemez(ip3, http):
    egitmen_a = await ip3.tutor()
    egitmen_b = await ip3.tutor()

    olustur = await http.post(
        KOK,
        headers=yetki_basligi(egitmen_a),
        json={"title": "A'nın şablonu", "body": "Yalnız A görsün."},
    )
    assert olustur.status_code == 201, olustur.text
    sablon_id = olustur.json()["id"]

    liste_b = await http.get(KOK, headers=yetki_basligi(egitmen_b))
    assert liste_b.json() == [], "B, A'nın şablonunu listede gördü"

    sil_b = await http.delete(
        f"{KOK}/{sablon_id}", headers=yetki_basligi(egitmen_b)
    )
    assert sil_b.status_code == 404, "B, A'nın şablonunu silebildi"

    liste_a = await http.get(KOK, headers=yetki_basligi(egitmen_a))
    assert [s["id"] for s in liste_a.json()] == [sablon_id], (
        "B'nin başarısız silme denemesinden sonra A'nın şablonu kaybolmuş"
    )

    await http.delete(f"{KOK}/{sablon_id}", headers=yetki_basligi(egitmen_a))


@pytest.mark.asyncio
async def test_azami_sablon_sayisi_asilamaz(ip3, http):
    egitmen = await ip3.tutor()
    basligi = yetki_basligi(egitmen)

    try:
        for i in range(20):
            r = await http.post(
                KOK, headers=basligi, json={"title": f"Şablon {i}", "body": "İçerik"}
            )
            assert r.status_code == 201, f"{i}. şablon reddedildi: {r.text}"

        asan = await http.post(
            KOK, headers=basligi, json={"title": "Fazla", "body": "İçerik"}
        )
        assert asan.status_code == 400, (
            f"21. şablon kabul edildi (status={asan.status_code})"
        )
        assert asan.json()["detail"]["code"] == "TEMPLATE_LIMIT"
    finally:
        # `MessageTemplate`in tutora FK'si yok (MessageReaction kalıbı); ip3
        # fabrikasının teardown'ı bu tabloyu bilmiyor, burada elle temizlenir.
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "DELETE FROM message_templates "
                    "WHERE owner_role = 'TUTOR' AND owner_id = :id"
                ),
                {"id": egitmen.id},
            )
            await s.commit()
