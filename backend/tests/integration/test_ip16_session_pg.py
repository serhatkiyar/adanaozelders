"""İP-16 S matrisi — cevap idempotency'si, eşzamanlılık, undo (gerçek PG).

S-1/S-2 claim deseninin (İP-1a) nöbetçileridir: aynı `client_token` kaç kez
ve kaç paralel istekle gelirse gelsin TEK log satırı ve TEK ilerleme adımı
üretilir. Mutasyon #13 (claim'i koşulsuzlaştır) bu ikisini kırmalıdır.
"""
from __future__ import annotations

import asyncio
import datetime
import uuid

from tests.integration.ip16_factory import cevapla, deste, kuyruk, not_ekle

UTC = datetime.timezone.utc
T0 = datetime.datetime(2026, 8, 10, 9, 0, 0, tzinfo=UTC)


async def _kart(ip16, http, hdr) -> tuple[int, int]:
    d = await deste(http, hdr)
    await not_ekle(http, hdr, d["id"], front="s", back="c")
    q = await kuyruk(http, hdr, d["id"])
    return d["id"], q["card"]["id"]


async def _log_sayisi(ip16, user_id: int) -> int:
    r = await ip16.sql(
        "SELECT count(*) FROM srs_review_logs WHERE user_id = :u AND role_id = 3",
        u=user_id,
    )
    return r[0][0]


async def _durum(ip16, card_id: int, user_id: int):
    r = await ip16.sql(
        "SELECT state, step, stability, difficulty, reps, due_at FROM"
        " srs_progress WHERE card_id = :c AND user_id = :u AND role_id = 3",
        c=card_id, u=user_id,
    )
    return r[0] if r else None


# ── S-1: aynı cevap iki kez → tek ilerleme ──────────────────────────────────

async def test_s1_cevap_idempotent(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    _d, kart = await _kart(ip16, ip16_http, hdr)
    token = str(uuid.uuid4())
    r1 = await cevapla(ip16_http, hdr, kart, 3, token=token)
    assert r1["state"] == "LEARNING" and r1["step"] == 1
    # Aynı token'la ikinci gönderim: ilerleme İKİNCİ KEZ yazılmaz.
    r2 = await cevapla(ip16_http, hdr, kart, 3, token=token)
    assert r2["state"] == "LEARNING" and r2["step"] == 1, "ikinci gönderim ilerletti"
    assert await _log_sayisi(ip16, cid) == 1, "aynı token iki log üretti"
    durum = await _durum(ip16, kart, cid)
    assert durum[4] == 1, f"reps 1 olmalıydı: {durum[4]}"


# ── S-2: eşzamanlı iki (ve beş) cevap tek ilerleme üretiyor ─────────────────

async def test_s2_eszamanli_cevaplar_tek_ilerleme(ip16, ip16_saat):
    """Aynı token'la 5 PARALEL istek — bağımsız HTTP istemcileriyle.

    Tek AsyncClient istekleri sıraya sokabilir; her görev kendi ASGI
    transport'unu kurar ki DB'ye gerçekten yarışan transaction'lar insin.
    """
    import httpx

    from main import app

    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ilk:
        _d, kart = await _kart(ip16, ilk, hdr)
    for tur in range(3):  # dosya içinde 3 tur; doğrulama fazında 5 koşum daha
        token = str(uuid.uuid4())

        async def atis(token=token):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as c:
                return await c.post(
                    "/api/v1/srs/study/answer",
                    headers=hdr,
                    json={"card_id": kart, "rating": 3, "client_token": token},
                )

        yanitlar = await asyncio.gather(*[atis() for _ in range(5)])
        assert all(r.status_code == 200 for r in yanitlar), (
            f"tur {tur}: {[r.status_code for r in yanitlar]}"
        )
        assert await _log_sayisi(ip16, cid) == tur + 1, (
            f"tur {tur}: paralel istekler birden çok log üretti"
        )
    durum = await _durum(ip16, kart, cid)
    assert durum[4] == 3, f"3 tur sonrası reps 3 olmalıydı: {durum[4]}"


# ── S-3: oturum kesilirse ilerleme korunuyor ────────────────────────────────

async def test_s3_kesinti_ilerlemeyi_korur(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    d, kart = await _kart(ip16, ip16_http, hdr)
    await cevapla(ip16_http, hdr, kart, 3)
    # "Kesinti": istemci durumu yok — yeni kuyruk çağrısı DB'deki gerçek
    # durumu gösterir; cevap kalıcıdır.
    durum = await _durum(ip16, kart, cid)
    assert durum is not None and durum[0] == "LEARNING" and durum[4] == 1
    q = await kuyruk(ip16_http, hdr, d)
    assert q["counts"]["learning"] == 1 and q["counts"]["new"] == 0


# ── S-4: undo son cevabı geri alıyor ────────────────────────────────────────

async def test_s4_undo_durumu_eski_haline_dondurur(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    d, kart = await _kart(ip16, ip16_http, hdr)
    await cevapla(ip16_http, hdr, kart, 3)
    once = await _durum(ip16, kart, cid)
    await cevapla(ip16_http, hdr, kart, 3)  # REVIEW'a mezun oldu
    assert (await _durum(ip16, kart, cid))[0] == "REVIEW"
    r = await ip16_http.post("/api/v1/srs/study/undo", headers=hdr, json={})
    assert r.status_code == 200, r.text[:200]
    sonra = await _durum(ip16, kart, cid)
    assert sonra == once, f"undo durumu geri yüklemedi: {sonra} != {once}"
    # Kart kuyruğa geri döner (learning, vadesi 10 dk içinde → learn-ahead).
    q = await kuyruk(ip16_http, hdr, d)
    assert q["counts"]["learning"] == 1


# ── S-5: undo yalnız son cevabı geri alabiliyor (zincir değil) ──────────────

async def test_s5_undo_zincirlenemez(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    _d, kart = await _kart(ip16, ip16_http, hdr)
    await cevapla(ip16_http, hdr, kart, 3)
    await cevapla(ip16_http, hdr, kart, 3)
    r1 = await ip16_http.post("/api/v1/srs/study/undo", headers=hdr, json={})
    assert r1.status_code == 200
    r2 = await ip16_http.post("/api/v1/srs/study/undo", headers=hdr, json={})
    assert r2.status_code == 409, (
        f"ikinci undo zincirlendi: {r2.status_code} {r2.text[:200]}"
    )


# ── S-6: sayaçlar doğru — yeni / öğrenme / tekrar kalan ─────────────────────

async def test_s6_sayaclar(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    cid, hdr = await ip16.ogrenci()
    did = (await deste(ip16_http, hdr))["id"]
    for i in range(3):
        await not_ekle(ip16_http, hdr, did, front=f"s{i}", back="c")
    q0 = await kuyruk(ip16_http, hdr, did)
    assert q0["counts"] == {"new": 3, "learning": 0, "review": 0}
    liste = await ip16_http.get(
        "/api/v1/srs/cards", headers=hdr, params={"deck_id": did}
    )
    k1, k2, _k3 = [k["id"] for k in liste.json()["items"]]
    await cevapla(ip16_http, hdr, k1, 3)   # LEARNING
    await cevapla(ip16_http, hdr, k2, 4)   # REVIEW (vade gelecekte)
    q1 = await kuyruk(ip16_http, hdr, did)
    assert q1["counts"] == {"new": 1, "learning": 1, "review": 0}, q1["counts"]
    # REVIEW kartının vadesini bugüne çek → review sayacı 1 olur.
    await ip16.sql_exec(
        "UPDATE srs_progress SET due_at = :t WHERE card_id = :c AND"
        " user_id = :u AND role_id = 3",
        t=T0 - datetime.timedelta(hours=1), c=k2, u=cid,
    )
    q2 = await kuyruk(ip16_http, hdr, did)
    assert q2["counts"] == {"new": 1, "learning": 1, "review": 1}, q2["counts"]
