"""İP-16 Q/L/G matrisi — kuyruk, limitler, gün sınırı (gerçek PG + HTTP).

Zaman, `ip16_saat` ile servise enjekte edilir (sözleşme: bütün zaman okumaları
`services/srs_service._now` üzerinden). Vade kaydırma gereken yerlerde
`due_at` SQL ile geçmişe alınır — bu, İP-1a'daki "geçmişte biten ders" gibi
bir ZAMAN kurulumudur; durum (state) sahtelenmez.
"""
from __future__ import annotations

import datetime

from tests.integration.ip16_factory import cevapla, deste, kuyruk, not_ekle

UTC = datetime.timezone.utc
# 2026-08-10 09:00 UTC = 12:00 Europe/Istanbul (Pazartesi, gün ortası).
T0 = datetime.datetime(2026, 8, 10, 9, 0, 0, tzinfo=UTC)
YARIN = datetime.datetime(2026, 8, 11, 9, 0, 0, tzinfo=UTC)


async def _tek_kart(ip16, http, hdr, **deck_kw) -> tuple[int, int]:
    d = await deste(http, hdr, **deck_kw)
    await not_ekle(http, hdr, d["id"], front="soru", back="cevap")
    q = await kuyruk(http, hdr, d["id"])
    assert q["card"] is not None
    return d["id"], q["card"]["id"]


async def _vadeyi_gecmise_al(ip16, card_id: int, user_id: int, role_id: int, an):
    await ip16.sql_exec(
        "UPDATE srs_progress SET due_at = :t WHERE card_id = :c"
        " AND user_id = :u AND role_id = :r",
        t=an, c=card_id, u=user_id, r=role_id,
    )


# ── Q-1: yeni kart öğrenme adımlarını sırayla geçiyor ───────────────────────

async def test_q1_ogrenme_adimlari_sirali(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    _deck, kart = await _tek_kart(ip16, ip16_http, hdr)
    # 1. Good → adım 1 (10 dk), hâlâ LEARNING
    r1 = await cevapla(ip16_http, hdr, kart, 3)
    assert r1["state"] == "LEARNING" and r1["step"] == 1
    # 2. Good (learn-ahead penceresinde erken gösterim) → REVIEW'a mezun
    r2 = await cevapla(ip16_http, hdr, kart, 3)
    assert r2["state"] == "REVIEW" and r2["step"] is None


# ── Q-2: "Tekrar" öğrenme adımını başa alıyor ───────────────────────────────

async def test_q2_again_adimi_basa_alir(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    _deck, kart = await _tek_kart(ip16, ip16_http, hdr)
    r1 = await cevapla(ip16_http, hdr, kart, 3)
    assert r1["step"] == 1
    r2 = await cevapla(ip16_http, hdr, kart, 1)
    assert r2["state"] == "LEARNING" and r2["step"] == 0


# ── Q-3: öğrenme bitince review kuyruğuna geçiş ─────────────────────────────

async def test_q3_ogrenme_bitince_review(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    deck, kart = await _tek_kart(ip16, ip16_http, hdr)
    await cevapla(ip16_http, hdr, kart, 3)
    r = await cevapla(ip16_http, hdr, kart, 3)
    assert r["state"] == "REVIEW"
    # Vadesi gelecekte: bugünkü kuyrukta yok (G-5 ile aynı gözlem, review yolu).
    q = await kuyruk(ip16_http, hdr, deck)
    assert q["counts"]["review"] == 0 and q["card"] is None
    # DB'de kalıcı durum da REVIEW (yanıt gövdesi değil, son durum).
    satir = await ip16.sql(
        "SELECT state, due_at FROM srs_progress WHERE card_id = :c AND"
        " user_id = :u AND role_id = 3",
        c=kart, u=cid,
    )
    assert satir[0][0] == "REVIEW"


# ── Q-4/Q-5: review'da lapse → relearning → review ─────────────────────────

async def test_q4_q5_lapse_relearning_donusu(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    deck, kart = await _tek_kart(ip16, ip16_http, hdr)
    await cevapla(ip16_http, hdr, kart, 4)  # Easy → REVIEW
    # 5 gün sonra vadesi gelmiş olarak Again:
    ip16_saat(T0 + datetime.timedelta(days=20))
    q = await kuyruk(ip16_http, hdr, deck)
    assert q["card"] is not None and q["counts"]["review"] == 1
    r = await cevapla(ip16_http, hdr, kart, 1)
    assert r["state"] == "RELEARNING"
    satir = await ip16.sql(
        "SELECT lapses FROM srs_progress WHERE card_id = :c AND user_id = :u"
        " AND role_id = 3",
        c=kart, u=cid,
    )
    assert satir[0][0] == 1
    # Q-5: relearning tek adım; Good → REVIEW'a döner.
    r2 = await cevapla(ip16_http, hdr, kart, 3)
    assert r2["state"] == "REVIEW"


# ── Q-6: gömülen kart bugün gelmiyor, ertesi gün geliyor ────────────────────

async def test_q6_bury_ertesi_gun(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    deck, kart = await _tek_kart(ip16, ip16_http, hdr)
    r = await ip16_http.post(
        "/api/v1/srs/cards/bulk",
        headers=hdr,
        json={"ids": [kart], "action": "bury"},
    )
    assert r.status_code == 200
    q = await kuyruk(ip16_http, hdr, deck)
    assert q["card"] is None and q["counts"]["new"] == 0
    # Ertesi çalışma günü (04:00 TR sonrası) kendiliğinden geri gelir.
    ip16_saat(YARIN)
    q2 = await kuyruk(ip16_http, hdr, deck)
    assert q2["card"] is not None and q2["card"]["id"] == kart


# ── Q-7: askıya alınan kart elle geri alınana kadar hiç gelmiyor ────────────

async def test_q7_suspend_kalici(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    deck, kart = await _tek_kart(ip16, ip16_http, hdr)
    r = await ip16_http.post(
        "/api/v1/srs/cards/bulk",
        headers=hdr,
        json={"ids": [kart], "action": "suspend"},
    )
    assert r.status_code == 200
    assert (await kuyruk(ip16_http, hdr, deck))["card"] is None
    ip16_saat(YARIN + datetime.timedelta(days=30))  # bir ay sonra bile
    assert (await kuyruk(ip16_http, hdr, deck))["card"] is None
    r2 = await ip16_http.post(
        "/api/v1/srs/cards/bulk",
        headers=hdr,
        json={"ids": [kart], "action": "unsuspend"},
    )
    assert r2.status_code == 200
    assert (await kuyruk(ip16_http, hdr, deck))["card"]["id"] == kart


# ── Q-8: leech eşiği — 8. lapse'te işaret + otomatik askı ───────────────────

async def test_q8_leech_esigi(ip16, ip16_http, ip16_saat):
    an = T0
    ip16_saat(an)
    cid, hdr = await ip16.ogrenci()
    _deck, kart = await _tek_kart(ip16, ip16_http, hdr)
    await cevapla(ip16_http, hdr, kart, 4)  # REVIEW'a çık
    for lapse in range(1, 9):
        an = an + datetime.timedelta(days=3)
        ip16_saat(an)
        await _vadeyi_gecmise_al(ip16, kart, cid, 3, an - datetime.timedelta(hours=1))
        await cevapla(ip16_http, hdr, kart, 1)      # lapse
        if lapse < 8:
            await cevapla(ip16_http, hdr, kart, 3)  # relearning'den çık
            satir = await ip16.sql(
                "SELECT is_leech, suspended_at FROM srs_progress WHERE"
                " card_id = :c AND user_id = :u AND role_id = 3",
                c=kart, u=cid,
            )
            assert satir[0][0] is False and satir[0][1] is None, (
                f"{lapse}. lapse'te erken leech"
            )
    satir = await ip16.sql(
        "SELECT is_leech, suspended_at, lapses FROM srs_progress WHERE"
        " card_id = :c AND user_id = :u AND role_id = 3",
        c=kart, u=cid,
    )
    assert satir[0][2] == 8
    assert satir[0][0] is True, "8. lapse'te leech işareti yok"
    assert satir[0][1] is not None, "leech askıya alınmadı"


# ── Q-9: kuyruk sırası deterministik ve sözleşmede tanımlı ─────────────────
# Sıra (sözleşme §4.1): vadesi gelmiş learning → review (due artan, id kırıcı)
# → yeni (id artan).

async def test_q9_kuyruk_sirasi(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    idler = []
    for i in range(4):
        await not_ekle(ip16_http, hdr, d["id"], front=f"s{i}", back=f"c{i}")
    liste = await ip16_http.get(
        "/api/v1/srs/cards", headers=hdr, params={"deck_id": d["id"]}
    )
    idler = [k["id"] for k in liste.json()["items"]]
    assert len(idler) == 4
    k_learn, k_rev_eski, k_rev_yeni, k_new = idler
    # learning: Again → adım 0 (1 dk); 2 dk ilerletince vadesi gelmiş olur.
    await cevapla(ip16_http, hdr, k_learn, 1)
    # iki review kartı: Easy ile mezun et, vadeleri SQL ile farklı geçmişe al.
    await cevapla(ip16_http, hdr, k_rev_eski, 4)
    await cevapla(ip16_http, hdr, k_rev_yeni, 4)
    await _vadeyi_gecmise_al(
        ip16, k_rev_eski, cid, 3, T0 - datetime.timedelta(hours=2)
    )
    await _vadeyi_gecmise_al(
        ip16, k_rev_yeni, cid, 3, T0 - datetime.timedelta(hours=1)
    )
    ip16_saat(T0 + datetime.timedelta(minutes=2))
    sira = []
    for _ in range(4):
        q = await kuyruk(ip16_http, hdr, d["id"])
        assert q["card"] is not None
        sira.append(q["card"]["id"])
        await cevapla(ip16_http, hdr, q["card"]["id"], 3)
    assert sira == [k_learn, k_rev_eski, k_rev_yeni, k_new], (
        f"kuyruk sırası sözleşmeye aykırı: {sira}"
    )


# ── L-1: günlük yeni kart limiti aşılamıyor ─────────────────────────────────

async def test_l1_yeni_kart_limiti(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr, new_per_day=2)
    for i in range(3):
        await not_ekle(ip16_http, hdr, d["id"], front=f"s{i}", back="c")
    q = await kuyruk(ip16_http, hdr, d["id"])
    assert q["counts"]["new"] == 2, "sayaç limiti aşıyor"
    tanitilan = 0
    while True:
        q = await kuyruk(ip16_http, hdr, d["id"])
        if q["card"] is None:
            break
        r = await cevapla(ip16_http, hdr, q["card"]["id"], 4)  # Easy: kuyruktan çıkar
        if r.get("introduced_new"):
            tanitilan += 1
        if tanitilan > 2:
            break
    assert tanitilan == 2, f"limit 2 iken {tanitilan} yeni kart tanıtıldı"


# ── L-2: günlük tekrar limiti aşılamıyor ────────────────────────────────────

async def test_l2_tekrar_limiti(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr, reviews_per_day=1)
    for i in range(2):
        await not_ekle(ip16_http, hdr, d["id"], front=f"s{i}", back="c")
    liste = await ip16_http.get(
        "/api/v1/srs/cards", headers=hdr, params={"deck_id": d["id"]}
    )
    idler = [k["id"] for k in liste.json()["items"]]
    for k in idler:
        await cevapla(ip16_http, hdr, k, 4)  # REVIEW'a mezun
        await _vadeyi_gecmise_al(ip16, k, cid, 3, T0 - datetime.timedelta(hours=1))
    q = await kuyruk(ip16_http, hdr, d["id"])
    assert q["counts"]["review"] == 1, "review sayacı limiti aşıyor"
    await cevapla(ip16_http, hdr, q["card"]["id"], 3)
    q2 = await kuyruk(ip16_http, hdr, d["id"])
    assert q2["card"] is None, "limit dolduktan sonra kart sunuldu"


# ── L-3: alt deste limitleri üstten kalıtılıyor ─────────────────────────────

async def test_l3_limit_kalitimi(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    ust = await deste(ip16_http, hdr, new_per_day=1)
    alt = await deste(ip16_http, hdr, parent_id=ust["id"])  # limiti NULL: kalıt
    for i in range(3):
        await not_ekle(ip16_http, hdr, alt["id"], front=f"s{i}", back="c")
    # Alt destede çalışırken üstün limiti bağlar: yalnız 1 yeni kart.
    q = await kuyruk(ip16_http, hdr, alt["id"])
    assert q["counts"]["new"] == 1, "üst limit kalıtılmadı"
    await cevapla(ip16_http, hdr, q["card"]["id"], 4)
    q2 = await kuyruk(ip16_http, hdr, alt["id"])
    assert q2["card"] is None, "kalıtılan limit dolunca kuyruk boşalmadı"


# ── L-4: limit dolunca boş kuyruk, hata değil ───────────────────────────────

async def test_l4_limit_dolunca_bos_kuyruk(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr, new_per_day=0)
    await not_ekle(ip16_http, hdr, d["id"], front="s", back="c")
    r = await ip16_http.get(
        "/api/v1/srs/study/queue", headers=hdr, params={"deck_id": d["id"]}
    )
    assert r.status_code == 200, "boş kuyruk hata döndürdü"
    q = r.json()
    assert q["card"] is None and q["counts"]["new"] == 0


# ── L-5: limit ertesi gün sıfırlanıyor ──────────────────────────────────────

async def test_l5_limit_ertesi_gun_sifirlanir(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr, new_per_day=1)
    for i in range(2):
        await not_ekle(ip16_http, hdr, d["id"], front=f"s{i}", back="c")
    q = await kuyruk(ip16_http, hdr, d["id"])
    await cevapla(ip16_http, hdr, q["card"]["id"], 4)
    assert (await kuyruk(ip16_http, hdr, d["id"]))["card"] is None
    ip16_saat(YARIN)
    q2 = await kuyruk(ip16_http, hdr, d["id"])
    assert q2["card"] is not None, "limit ertesi gün sıfırlanmadı"
    assert q2["counts"]["new"] == 1


# ── G-1/G-2/G-3: Türkiye saati + 04:00 rollover ────────────────────────────

async def test_g1_g3_rollover_gun_yazimi(ip16, ip16_http, ip16_saat):
    """03:30 TR ve 04:30 TR'deki cevaplar doğru çalışma gününe yazılır.

    2026-08-11 00:30 UTC = 03:30 TR → çalışma günü hâlâ 2026-08-10 (G-2/G-3).
    2026-08-11 01:30 UTC = 04:30 TR → çalışma günü 2026-08-11.
    UTC tarihi her iki anda da 11'i — UTC'ye göre yazan bir uygulama iki
    cevabı aynı güne koyar ve bu test kırılır (mutasyon #11/#12 nöbetçisi).
    """
    cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(ip16_http, hdr, d["id"], front="a", back="b")
    await not_ekle(ip16_http, hdr, d["id"], front="c", back="d")
    liste = await ip16_http.get(
        "/api/v1/srs/cards", headers=hdr, params={"deck_id": d["id"]}
    )
    k1, k2 = [k["id"] for k in liste.json()["items"]]
    ip16_saat(datetime.datetime(2026, 8, 11, 0, 30, tzinfo=UTC))  # 03:30 TR
    await cevapla(ip16_http, hdr, k1, 3)
    ip16_saat(datetime.datetime(2026, 8, 11, 1, 30, tzinfo=UTC))  # 04:30 TR
    await cevapla(ip16_http, hdr, k2, 3)
    gunler = await ip16.sql(
        "SELECT l.study_day FROM srs_review_logs l JOIN srs_progress p ON"
        " l.progress_id = p.id WHERE l.user_id = :u AND l.role_id = 3"
        " ORDER BY l.id",
        u=cid,
    )
    assert gunler[0][0] == datetime.date(2026, 8, 10), (
        f"03:30 TR cevabı yanlış güne yazıldı: {gunler[0][0]}"
    )
    assert gunler[1][0] == datetime.date(2026, 8, 11), (
        f"04:30 TR cevabı yanlış güne yazıldı: {gunler[1][0]}"
    )


# ── G-4: kaçırılan günler birikiyor, kart kaybolmuyor ───────────────────────

async def test_g4_kacirilan_gunler_birikir(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(ip16_http, hdr, d["id"], front="s", back="c")
    q = await kuyruk(ip16_http, hdr, d["id"])
    await cevapla(ip16_http, hdr, q["card"]["id"], 4)  # REVIEW, vade ~16 gün
    # 60 gün hiç girilmedi — kart hâlâ kuyrukta (kaybolmadı).
    ip16_saat(T0 + datetime.timedelta(days=60))
    q2 = await kuyruk(ip16_http, hdr, d["id"])
    assert q2["counts"]["review"] == 1 and q2["card"] is not None


# ── G-5: vadesi gelmemiş kart bugünün kuyruğunda yok ────────────────────────

async def test_g5_vadesi_gelmemis_kart_yok(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(ip16_http, hdr, d["id"], front="s", back="c")
    q = await kuyruk(ip16_http, hdr, d["id"])
    await cevapla(ip16_http, hdr, q["card"]["id"], 4)  # vade ~16 gün sonra
    ip16_saat(T0 + datetime.timedelta(days=1))
    q2 = await kuyruk(ip16_http, hdr, d["id"])
    assert q2["counts"]["review"] == 0 and q2["card"] is None
