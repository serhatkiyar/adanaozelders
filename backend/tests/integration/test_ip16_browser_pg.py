"""İP-16 E/B/I matrisi — etiketler, kart tarayıcı, istatistik (gerçek PG+HTTP).

B-3'ün kanıtı HTTP düzeyindedir: sunucu sayfalıyorsa yanıt gövdesi yalnız
istenen dilimi taşır; istemci dilimlemesi (mutasyon #18) tüm kayıtları
gövdeye koyar ve `len(items)` asserts'i kırılır.
"""
from __future__ import annotations

import datetime

from tests.integration.ip16_factory import cevapla, deste, kartlar, not_ekle

UTC = datetime.timezone.utc
T0 = datetime.datetime(2026, 8, 10, 9, 0, 0, tzinfo=UTC)


# ── E-1: karta birden çok etiket ────────────────────────────────────────────

async def test_e1_coklu_etiket(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(
        ip16_http, hdr, d["id"], front="türev", back="derivative",
        tags=["matematik", "analiz"],
    )
    sonuc = await kartlar(ip16_http, hdr, d["id"])
    etiketler = sonuc["items"][0]["tags"]
    assert sorted(etiketler) == ["analiz", "matematik"]
    r = await ip16_http.get("/api/v1/srs/tags", headers=hdr)
    adlar = {t["name"] for t in r.json()["items"]}
    assert {"matematik", "analiz"} <= adlar


# ── E-2: etikete göre filtreleme sunucuda ───────────────────────────────────

async def test_e2_etiket_filtresi_sunucuda(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(ip16_http, hdr, d["id"], front="a", back="1", tags=["mat"])
    await not_ekle(ip16_http, hdr, d["id"], front="b", back="2", tags=["fizik"])
    sonuc = await kartlar(ip16_http, hdr, d["id"], tag="mat")
    assert sonuc["total"] == 1, "etiket filtresi sunucuda daraltmadı"
    assert sonuc["items"][0]["front"] == "a"


# ── E-3: etiket silinince kart korunuyor ────────────────────────────────────

async def test_e3_etiket_silinince_kart_korunur(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(ip16_http, hdr, d["id"], front="a", back="1", tags=["gecici"])
    kart_id = (await kartlar(ip16_http, hdr, d["id"]))["items"][0]["id"]
    r = await ip16_http.post(
        "/api/v1/srs/cards/bulk",
        headers=hdr,
        json={"ids": [kart_id], "action": "remove_tag", "tag": "gecici"},
    )
    assert r.status_code == 200
    sonuc = await kartlar(ip16_http, hdr, d["id"])
    assert sonuc["total"] == 1, "etiket silinince kart gitti"
    assert sonuc["items"][0]["tags"] == []


# ── B-1: kart arama metin üzerinde ──────────────────────────────────────────

async def test_b1_metin_aramasi(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(ip16_http, hdr, d["id"], front="fotosentez nedir", back="...")
    await not_ekle(ip16_http, hdr, d["id"], front="hücre zarı", back="fotosentezle ilgisiz")
    await not_ekle(ip16_http, hdr, d["id"], front="mitoz", back="bölünme")
    sonuc = await kartlar(ip16_http, hdr, d["id"], q="fotosentez")
    assert sonuc["total"] == 2, "arama ön+arka metinde çalışmalı"


# ── B-2: deste/durum/etiket filtresi sunucuya gidiyor ───────────────────────

async def test_b2_durum_filtresi(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(ip16_http, hdr, d["id"], front="a", back="1")
    await not_ekle(ip16_http, hdr, d["id"], front="b", back="2")
    k1 = (await kartlar(ip16_http, hdr, d["id"]))["items"][0]["id"]
    await cevapla(ip16_http, hdr, k1, 3)  # k1 → LEARNING
    yeni = await kartlar(ip16_http, hdr, d["id"], state="NEW")
    assert yeni["total"] == 1 and yeni["items"][0]["front"] == "b"
    ogrenme = await kartlar(ip16_http, hdr, d["id"], state="LEARNING")
    assert ogrenme["total"] == 1 and ogrenme["items"][0]["id"] == k1


# ── B-3: sunucu sayfalaması gerçek (HTTP kanıtı) ────────────────────────────

async def test_b3_sunucu_sayfalamasi(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    for i in range(30):
        await not_ekle(ip16_http, hdr, d["id"], front=f"kart-{i:02d}", back="c")
    s1 = await kartlar(ip16_http, hdr, d["id"], page=1, page_size=10)
    s2 = await kartlar(ip16_http, hdr, d["id"], page=2, page_size=10)
    assert s1["total"] == 30 and s2["total"] == 30
    assert len(s1["items"]) == 10, (
        f"sayfa gövdesi {len(s1['items'])} kayıt taşıyor — sunucu dilimlemiyor"
    )
    assert len(s2["items"]) == 10
    assert {k["id"] for k in s1["items"]}.isdisjoint(
        {k["id"] for k in s2["items"]}
    ), "sayfalar kesişiyor — sayfalama deterministik değil"


# ── B-4: toplu işlemler ─────────────────────────────────────────────────────

async def test_b4_toplu_islemler(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    d1 = await deste(ip16_http, hdr)
    d2 = await deste(ip16_http, hdr)
    for i in range(3):
        await not_ekle(ip16_http, hdr, d1["id"], front=f"s{i}", back="c")
    idler = [k["id"] for k in (await kartlar(ip16_http, hdr, d1["id"]))["items"]]
    # Toplu askı:
    r = await ip16_http.post(
        "/api/v1/srs/cards/bulk", headers=hdr,
        json={"ids": idler[:2], "action": "suspend"},
    )
    assert r.status_code == 200 and r.json()["affected"] == 2
    askida = await kartlar(ip16_http, hdr, d1["id"], suspended="true")
    assert askida["total"] == 2
    # Toplu etiket:
    r2 = await ip16_http.post(
        "/api/v1/srs/cards/bulk", headers=hdr,
        json={"ids": idler, "action": "add_tag", "tag": "toplu"},
    )
    assert r2.status_code == 200
    assert (await kartlar(ip16_http, hdr, d1["id"], tag="toplu"))["total"] == 3
    # Toplu deste değiştirme:
    r3 = await ip16_http.post(
        "/api/v1/srs/cards/bulk", headers=hdr,
        json={"ids": [idler[2]], "action": "move_deck", "target_deck_id": d2["id"]},
    )
    assert r3.status_code == 200
    assert (await kartlar(ip16_http, hdr, d2["id"]))["total"] == 1
    assert (await kartlar(ip16_http, hdr, d1["id"]))["total"] == 2
    # Toplu gömme (kalan 2'den biri):
    r4 = await ip16_http.post(
        "/api/v1/srs/cards/bulk", headers=hdr,
        json={"ids": [idler[0]], "action": "bury"},
    )
    assert r4.status_code == 200
    satir = await ip16.sql(
        "SELECT buried_until FROM srs_progress WHERE card_id = :c AND"
        " user_id = :u AND role_id = 3",
        c=idler[0], u=cid,
    )
    assert satir and satir[0][0] is not None


# ── B-5: toplam sayı görünüyor, sessiz kesilme yok ──────────────────────────

async def test_b5_toplam_sessiz_kesilmez(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    for i in range(25):
        await not_ekle(ip16_http, hdr, d["id"], front=f"k{i}", back="c")
    sonuc = await kartlar(ip16_http, hdr, d["id"])  # varsayılan sayfa boyu
    assert sonuc["total"] == 25, "toplam sayı dilim boyuna eşitlendi (sessiz kesilme)"
    assert len(sonuc["items"]) <= sonuc["total"]


# ── B-6: geçersiz filtre değeri → 422 ───────────────────────────────────────

async def test_b6_gecersiz_filtre_422(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    for params in [
        {"deck_id": d["id"], "state": "OLMAYAN_DURUM"},
        {"deck_id": d["id"], "page": 0},
        {"deck_id": d["id"], "page_size": 100000},
        {"deck_id": "abc"},
    ]:
        r = await ip16_http.get("/api/v1/srs/cards", headers=hdr, params=params)
        assert r.status_code == 422, (
            f"geçersiz filtre {params} kabul edildi: {r.status_code}"
        )


# ── I-1: tutma oranı doğru ──────────────────────────────────────────────────

async def test_i1_tutma_orani(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    for i in range(2):
        await not_ekle(ip16_http, hdr, d["id"], front=f"s{i}", back="c")
    idler = [k["id"] for k in (await kartlar(ip16_http, hdr, d["id"]))["items"]]
    for k in idler:
        await cevapla(ip16_http, hdr, k, 4)  # ikisi de REVIEW
        await ip16.sql_exec(
            "UPDATE srs_progress SET due_at = :t WHERE card_id = :c AND"
            " user_id = :u AND role_id = 3",
            t=T0 - datetime.timedelta(hours=1), c=k, u=cid,
        )
    # Bir Good, bir Again → REVIEW cevaplarında tutma 1/2.
    await cevapla(ip16_http, hdr, idler[0], 3)
    await cevapla(ip16_http, hdr, idler[1], 1)
    r = await ip16_http.get(
        "/api/v1/srs/stats", headers=hdr, params={"deck_id": d["id"]}
    )
    stats = r.json()
    assert stats["review_count"] == 2
    assert stats["retention_rate"] == 0.5, (
        f"tutma oranı 0.5 olmalıydı: {stats['retention_rate']}"
    )


# ── I-2: gelecek yük tahmini vadesi gelenleri doğru sayıyor ─────────────────

async def test_i2_gelecek_yuk(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    for i in range(3):
        await not_ekle(ip16_http, hdr, d["id"], front=f"s{i}", back="c")
    idler = [k["id"] for k in (await kartlar(ip16_http, hdr, d["id"]))["items"]]
    for k in idler:
        await cevapla(ip16_http, hdr, k, 4)
    # Vadeleri belirli günlere sabitle: +1, +1, +3 gün.
    hedefler = [T0 + datetime.timedelta(days=g) for g in (1, 1, 3)]
    for k, hedef in zip(idler, hedefler, strict=True):
        await ip16.sql_exec(
            "UPDATE srs_progress SET due_at = :t WHERE card_id = :c AND"
            " user_id = :u AND role_id = 3",
            t=hedef, c=k, u=cid,
        )
    r = await ip16_http.get(
        "/api/v1/srs/stats", headers=hdr, params={"deck_id": d["id"]}
    )
    yuk = r.json()["future_load"]  # [{"day": "YYYY-MM-DD", "due": n}, ...]
    harita = {x["day"]: x["due"] for x in yuk}
    assert harita.get("2026-08-11") == 2, f"gün+1 yükü: {harita}"
    assert harita.get("2026-08-13") == 1, f"gün+3 yükü: {harita}"


# ── I-3: boş veri durumunda ekran bozulmuyor (sunucu yarısı) ────────────────

async def test_i3_bos_veri(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    r = await ip16_http.get(
        "/api/v1/srs/stats", headers=hdr, params={"deck_id": d["id"]}
    )
    assert r.status_code == 200
    stats = r.json()
    assert stats["review_count"] == 0
    assert stats["retention_rate"] is None or stats["retention_rate"] == 0
    assert stats["future_load"] == [] or isinstance(stats["future_load"], list)


# ── I-4: istatistik yalnız kendi verisini gösteriyor (K-6) ──────────────────

async def test_i4_istatistik_yalniz_kendi_verisi(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _c1, hdr1 = await ip16.ogrenci()
    _c2, hdr2 = await ip16.ogrenci()
    d = await deste(ip16_http, hdr1)
    await not_ekle(ip16_http, hdr1, d["id"], front="s", back="c")
    k = (await kartlar(ip16_http, hdr1, d["id"]))["items"][0]["id"]
    await cevapla(ip16_http, hdr1, k, 3)
    # Yabancı öğrenci o desteye istatistik soramaz (404 — IDOR).
    r = await ip16_http.get(
        "/api/v1/srs/stats", headers=hdr2, params={"deck_id": d["id"]}
    )
    assert r.status_code == 404
    # Genel istatistiği (desteysiz) kendi verisiyle sınırlı: 0 tekrar.
    r2 = await ip16_http.get("/api/v1/srs/stats", headers=hdr2)
    assert r2.status_code == 200
    assert r2.json()["review_count"] == 0, "başkasının tekrarları sızdı"
