"""İP-16 T matrisi (backend yarısı) — kart üretim kuralları (gerçek PG + HTTP).

T-5/T-6/T-7 (yazarak cevaplama karşılaştırması ve diff) istemci tarafındadır:
`frontend/src/lib/srsTypeAnswer.test.ts`. Buradaki düğümler notun kaç kart
doğurduğunu, ters kartın bağımsız ilerlemesini ve cloze boşluk silme
sözleşmesini (§6 T-4 kararı) doğrular.
"""
from __future__ import annotations

import datetime

from tests.integration.ip16_factory import cevapla, deste, kartlar, not_ekle

UTC = datetime.timezone.utc
T0 = datetime.datetime(2026, 8, 10, 9, 0, 0, tzinfo=UTC)


# ── T-1: ön/arka kart — nottan tek kart ─────────────────────────────────────

async def test_t1_basic_tek_kart(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(
        ip16_http, hdr, d["id"], note_type="BASIC", front="başkent?", back="Ankara"
    )
    sonuc = await kartlar(ip16_http, hdr, d["id"])
    assert sonuc["total"] == 1
    kart = sonuc["items"][0]
    assert kart["template_ord"] == 0
    assert kart["front"] == "başkent?" and kart["back"] == "Ankara"


# ── T-2: ters yön kartı AYRI ilerleme taşıyor ───────────────────────────────

async def test_t2_ters_kart_bagimsiz_ilerleme(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(
        ip16_http, hdr, d["id"], note_type="BASIC_REVERSED", front="kedi", back="cat"
    )
    sonuc = await kartlar(ip16_http, hdr, d["id"])
    assert sonuc["total"] == 2, "ters not 2 kart üretmeli"
    ordlar = sorted(k["template_ord"] for k in sonuc["items"])
    assert ordlar == [0, 1]
    on_kart = next(k for k in sonuc["items"] if k["template_ord"] == 0)
    ters_kart = next(k for k in sonuc["items"] if k["template_ord"] == 1)
    # Ön kartı iki kez cevapla → REVIEW; ters kart hiç çalışılmadı.
    await cevapla(ip16_http, hdr, on_kart["id"], 3)
    await cevapla(ip16_http, hdr, on_kart["id"], 3)
    satirlar = await ip16.sql(
        "SELECT card_id, state FROM srs_progress WHERE user_id = :u AND"
        " role_id = 3 AND card_id IN (:a, :b)",
        u=cid, a=on_kart["id"], b=ters_kart["id"],
    )
    durumlar = {r[0]: r[1] for r in satirlar}
    assert durumlar.get(on_kart["id"]) == "REVIEW"
    # Ters kartın ya satırı yok (NEW) ya da NEW: ana kartla PAYLAŞILMAZ.
    assert durumlar.get(ters_kart["id"]) in (None, "NEW"), (
        f"ters kart ilerlemesi ana kartla paylaşıldı: {durumlar}"
    )


# ── T-3: cloze notu her boşluk için ayrı kart üretiyor ──────────────────────

async def test_t3_cloze_bosluk_basina_kart(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(
        ip16_http,
        hdr,
        d["id"],
        note_type="CLOZE",
        front="{{c1::Mustafa Kemal}} {{c2::1881}}'de {{c1::Selanik}}'te doğdu",
        back="ekstra bilgi",
    )
    sonuc = await kartlar(ip16_http, hdr, d["id"])
    # c1 iki kez geçiyor ama TEK kart; c2 ayrı kart → toplam 2.
    assert sonuc["total"] == 2, f"cloze kart sayısı: {sonuc['total']}"
    assert sorted(k["template_ord"] for k in sonuc["items"]) == [0, 1]
    # İpucu sözdizimi de tek kart üretir.
    await not_ekle(
        ip16_http, hdr, d["id"], note_type="CLOZE",
        front="{{c1::Ankara::şehir}} başkenttir", back="",
    )
    sonuc2 = await kartlar(ip16_http, hdr, d["id"])
    assert sonuc2["total"] == 3


# ── T-4: cloze boşluğu silinince kart + ilerleme sözleşmesi ─────────────────
# Sözleşme (§6): kalkan N'in kartı ve ilerlemesi soft-delete edilir; aynı N
# geri gelirse kart VE ilerleme geri canlanır.

async def test_t4_cloze_bosluk_silme_ve_geri_gelme(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    n = await not_ekle(
        ip16_http, hdr, d["id"], note_type="CLOZE",
        front="{{c1::bir}} ve {{c2::iki}}", back="",
    )
    sonuc = await kartlar(ip16_http, hdr, d["id"])
    assert sonuc["total"] == 2
    c2_kart = next(k for k in sonuc["items"] if k["template_ord"] == 1)
    # c2 kartında ilerleme oluştur.
    await cevapla(ip16_http, hdr, c2_kart["id"], 3)
    # c2'yi metinden çıkar → kartı ve ilerlemesi görünmez olur.
    r = await ip16_http.patch(
        f"/api/v1/srs/notes/{n['id']}",
        headers=hdr,
        json={"front": "{{c1::bir}} ve iki"},
    )
    assert r.status_code == 200, r.text[:200]
    sonuc2 = await kartlar(ip16_http, hdr, d["id"])
    assert sonuc2["total"] == 1, "silinen cloze kartı listede kaldı"
    assert sonuc2["items"][0]["template_ord"] == 0
    # c2'yi geri ekle → kart geri gelir, İLERLEME KORUNMUŞ (LEARNING, reps=1).
    r2 = await ip16_http.patch(
        f"/api/v1/srs/notes/{n['id']}",
        headers=hdr,
        json={"front": "{{c1::bir}} ve {{c2::iki}}"},
    )
    assert r2.status_code == 200
    sonuc3 = await kartlar(ip16_http, hdr, d["id"])
    assert sonuc3["total"] == 2, "geri eklenen cloze kartı doğmadı"
    satir = await ip16.sql(
        "SELECT p.state, p.reps FROM srs_progress p WHERE p.card_id = :c AND"
        " p.user_id = :u AND p.role_id = 3 AND p.deleted_at IS NULL",
        c=c2_kart["id"], u=cid,
    )
    assert satir and satir[0][0] == "LEARNING" and satir[0][1] == 1, (
        f"geri canlanan kartın ilerlemesi korunmadı: {satir}"
    )


# ── İç içe cloze v1'de reddedilir (sözleşme §6) ─────────────────────────────

async def test_t3b_ic_ice_cloze_reddedilir(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    r = await ip16_http.post(
        f"/api/v1/srs/decks/{d['id']}/notes",
        headers=hdr,
        json={
            "note_type": "CLOZE",
            "front": "{{c1::dış {{c2::iç}}}}",
            "back": "",
            "tags": [],
        },
    )
    assert r.status_code == 422, f"iç içe cloze kabul edildi: {r.status_code}"


# ── Cloze'suz cloze notu reddedilir ─────────────────────────────────────────

async def test_t3c_bossuz_cloze_reddedilir(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    r = await ip16_http.post(
        f"/api/v1/srs/decks/{d['id']}/notes",
        headers=hdr,
        json={"note_type": "CLOZE", "front": "boşluk yok", "back": "", "tags": []},
    )
    assert r.status_code == 422
