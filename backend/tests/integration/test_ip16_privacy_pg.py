"""İP-16 D matrisi — sahiplik, atama, kopya bağımsızlığı ve K-6 GİZLİLİK SINIRI.

K-6 sözleşmesi (docs/ip16-flashcard-sozlesme.md §7.2): ilerleme verisi
(`srs_progress`, `srs_review_logs` ve türetilen her istatistik) YALNIZ
sahibinindir. Eğitmen atadığı destenin öğrenci ilerlemesini HİÇBİR uçtan
göremez. Mutasyon #16 bu duvarı bilerek deler ve D-5/D-6'nın kırıldığı
kanıtlanır — bu testler o mutasyonu yakalayamazsa yetersizdir.
"""
from __future__ import annotations

import datetime

from tests.integration.ip16_factory import cevapla, deste, kartlar, kuyruk, not_ekle

UTC = datetime.timezone.utc
T0 = datetime.datetime(2026, 8, 10, 9, 0, 0, tzinfo=UTC)

SRS_IZINLER = ["srs_platform.view", "srs_platform.manage"]


async def _atanmis_calisan_ogrenci(ip16, http, ip16_saat):
    """Eğitmen destesi + dersli öğrenci + atama + öğrenci 2 kart çalışmış."""
    ip16_saat(T0)
    tid, t_hdr = await ip16.egitmen()
    cid, c_hdr = await ip16.ogrenci()
    await ip16.ders_bagi(tid, cid)
    d = await deste(http, t_hdr, name="İngilizce A1")
    for i in range(3):
        await not_ekle(http, t_hdr, d["id"], front=f"kelime{i}", back=f"word{i}")
    r = await http.post(
        f"/api/v1/srs/decks/{d['id']}/assign",
        headers=t_hdr,
        json={"client_id": cid},
    )
    assert r.status_code in (200, 201), f"atama: {r.status_code} {r.text[:200]}"
    # Öğrenci 2 kart çalışır → LEARNING ilerlemeleri doğar.
    q = await kuyruk(http, c_hdr, d["id"])
    await cevapla(http, c_hdr, q["card"]["id"], 3)
    q2 = await kuyruk(http, c_hdr, d["id"])
    await cevapla(http, c_hdr, q2["card"]["id"], 1)
    return tid, t_hdr, cid, c_hdr, d["id"]


# ── D-1: eğitmen deste oluşturup öğrenciye atayabiliyor ─────────────────────

async def test_d1_egitmen_atar_ogrenci_gorur(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    tid, t_hdr = await ip16.egitmen()
    cid, c_hdr = await ip16.ogrenci()
    await ip16.ders_bagi(tid, cid)
    d = await deste(ip16_http, t_hdr, name="Atama Testi")
    r = await ip16_http.post(
        f"/api/v1/srs/decks/{d['id']}/assign",
        headers=t_hdr,
        json={"client_id": cid},
    )
    assert r.status_code in (200, 201)
    liste = await ip16_http.get("/api/v1/srs/decks", headers=c_hdr)
    assert liste.status_code == 200
    atananlar = liste.json().get("assigned", [])
    assert any(x["id"] == d["id"] for x in atananlar), "atanan deste görünmüyor"


# ── Atama kapısı: dersi olmayan öğrenciye atanamaz ──────────────────────────

async def test_d1b_ders_bagi_olmadan_atama_reddedilir(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _tid, t_hdr = await ip16.egitmen()
    cid, _c_hdr = await ip16.ogrenci()  # ders bağı YOK
    d = await deste(ip16_http, t_hdr)
    r = await ip16_http.post(
        f"/api/v1/srs/decks/{d['id']}/assign",
        headers=t_hdr,
        json={"client_id": cid},
    )
    assert r.status_code in (403, 404), (
        f"ders bağı olmadan atama kabul edildi: {r.status_code}"
    )


# ── D-2: öğrenci kendi destesini oluşturabiliyor ────────────────────────────

async def test_d2_ogrenci_kendi_destesi(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr, name="Kendi Destem")
    liste = await ip16_http.get("/api/v1/srs/decks", headers=hdr)
    assert any(x["id"] == d["id"] for x in liste.json()["own"])


# ── D-3: platform destesi listede görünüyor ─────────────────────────────────

async def test_d3_platform_destesi_listede(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _aid, a_hdr = await ip16.admin(izinler=SRS_IZINLER)
    r = await ip16_http.post(
        "/api/v1/srs/admin/platform-decks",
        headers=a_hdr,
        json={"name": "YKS Paragraf"},
    )
    assert r.status_code == 201, r.text[:200]
    deck_id = r.json()["id"]
    _cid, c_hdr = await ip16.ogrenci()
    liste = await ip16_http.get("/api/v1/srs/decks/platform", headers=c_hdr)
    assert liste.status_code == 200
    assert any(x["id"] == deck_id for x in liste.json()["items"])


# ── D-4: yabancı öğrencinin destesine erişim → 404 (IDOR) ───────────────────

async def test_d4_yabanci_deste_404(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _c1, hdr1 = await ip16.ogrenci()
    _c2, hdr2 = await ip16.ogrenci()
    d = await deste(ip16_http, hdr1)
    for metot, yol, govde in [
        ("GET", f"/api/v1/srs/decks/{d['id']}", None),
        ("PATCH", f"/api/v1/srs/decks/{d['id']}", {"name": "x"}),
        ("DELETE", f"/api/v1/srs/decks/{d['id']}", None),
        ("POST", f"/api/v1/srs/decks/{d['id']}/notes",
         {"note_type": "BASIC", "front": "a", "back": "b", "tags": []}),
        ("GET", f"/api/v1/srs/study/queue?deck_id={d['id']}", None),
    ]:
        r = await ip16_http.request(
            metot, yol, headers=hdr2, json=govde if govde else None
        )
        assert r.status_code == 404, (
            f"{metot} {yol}: {r.status_code} — yabancı deste sızdı"
        )


# ── D-5: eğitmen atadığı destenin öğrenci ilerlemesini GÖREMİYOR ────────────

async def test_d5_egitmen_ogrenci_ilerlemesini_goremez(ip16, ip16_http, ip16_saat):
    _tid, t_hdr, cid, _c_hdr, deck_id = await _atanmis_calisan_ogrenci(
        ip16, ip16_http, ip16_saat
    )
    # 1) Eğitmenin istatistiği KENDİ verisidir: öğrenci 2 cevap verdi ama
    #    eğitmen istatistiğinde 0 tekrar görünür.
    r = await ip16_http.get(
        "/api/v1/srs/stats", headers=t_hdr, params={"deck_id": deck_id}
    )
    assert r.status_code == 200
    stats = r.json()
    assert stats.get("review_count", 0) == 0, (
        f"eğitmen istatistiğine öğrenci tekrarı sızdı: {stats}"
    )
    # 2) Eğitmenin kart tarayıcısı öğrencinin LEARNING durumlarını GÖSTERMEZ:
    #    eğitmen hiç çalışmadığından bütün kartlar NEW görünmelidir.
    sonuc = await kartlar(ip16_http, t_hdr, deck_id)
    for k in sonuc["items"]:
        assert k.get("state") in (None, "NEW"), (
            f"öğrenci ilerlemesi eğitmen tarayıcısına sızdı: kart {k['id']}"
            f" state={k.get('state')}"
        )
    # 3) Öğrenci-ID'li bir ilerleme sorgusu diye bir yol YOK: student_id /
    #    client_id paramı yok sayılmaz, uç da yoktur.
    r2 = await ip16_http.get(
        "/api/v1/srs/stats",
        headers=t_hdr,
        params={"deck_id": deck_id, "client_id": cid},
    )
    # Parametre tanınmıyorsa aynı kendi-verisi yanıtı döner; sızıntı olmamalı.
    if r2.status_code == 200:
        assert r2.json().get("review_count", 0) == 0


# ── D-6: hiçbir uç eğitmene öğrenci ilerleme verisi dönmüyor (tam tarama) ───

async def test_d6_uc_taramasi_govde_kontrolu(ip16, ip16_http, ip16_saat):
    """Eğitmen token'ıyla TÜM /srs GET uçları gezilir; yanıt gövdelerinde
    öğrenci ilerlemesine ait iz aranır.

    Somut iz: öğrenci kartlarından ikisi LEARNING durumda ve reps>0. Eğitmen
    yanıtlarının hiçbirinde (kendi ilerlemesi NEW/boş olduğundan) LEARNING
    durumu, reps>0 değeri veya stability sayısı görünmemelidir.
    """
    _tid, t_hdr, cid, _c_hdr, deck_id = await _atanmis_calisan_ogrenci(
        ip16, ip16_http, ip16_saat
    )
    # Öğrencinin gerçek ilerleme izleri (DB'den):
    izler = await ip16.sql(
        "SELECT state, stability FROM srs_progress WHERE user_id = :u AND"
        " role_id = 3 AND state != 'NEW'",
        u=cid,
    )
    assert izler, "kurulum hatası: öğrenci ilerlemesi yok"
    # Router'daki GET uçlarının TAMAMI (9 adet) burada karşılanır: 8'i
    # eğitmene açık ve taranır; 9.'su (`/admin/platform-decks`) admin izni
    # ister ve eğitmene kapalıdır — o da aşağıda ayrıca doğrulanır. Liste
    # elle tutulduğu için yeni bir GET ucu eklendiğinde buraya da eklenmeli.
    ucler = [
        "/api/v1/srs/decks",
        "/api/v1/srs/decks/platform",
        f"/api/v1/srs/decks/{deck_id}",
        f"/api/v1/srs/decks/{deck_id}/assignments",
        f"/api/v1/srs/cards?deck_id={deck_id}",
        f"/api/v1/srs/study/queue?deck_id={deck_id}",
        f"/api/v1/srs/stats?deck_id={deck_id}",
        "/api/v1/srs/tags",
    ]
    for uc in ucler:
        r = await ip16_http.get(uc, headers=t_hdr)
        assert r.status_code == 200, f"{uc}: {r.status_code}"
        govde = r.text
        for _durum, kararlilik in izler:
            if kararlilik is not None:
                assert f"{kararlilik:.10f}"[:8] not in govde, (
                    f"{uc}: öğrenci stability değeri yanıtta"
                )
        # Eğitmen bu destede hiç çalışmadı: LEARNING görünüyorsa öğrencinindir.
        assert '"LEARNING"' not in govde and '"RELEARNING"' not in govde, (
            f"{uc}: öğrenci kuyruğu durumu eğitmen yanıtına sızdı"
        )
    # Atama listesi yalnız VARLIK bilgisi taşır: ilerleme alanları yasak.
    r = await ip16_http.get(
        f"/api/v1/srs/decks/{deck_id}/assignments", headers=t_hdr
    )
    for satir in r.json()["items"]:
        yasak = {"progress", "retention", "reps", "state", "stability",
                 "difficulty", "due_at", "percent", "completed"}
        sizan = yasak & set(map(str.lower, satir.keys()))
        assert not sizan, f"atama satırında ilerleme alanı: {sizan}"
    # 9. GET ucu (admin platform kataloğu) eğitmene kapalı — tarama yüzeyinin
    # kalan parçası budur, veri sızdırması değil erişim yokluğuyla kapanır.
    kapali = await ip16_http.get("/api/v1/srs/admin/platform-decks", headers=t_hdr)
    assert kapali.status_code == 403, (
        f"admin platform kataloğu eğitmene açık: {kapali.status_code}"
    )


# ── D-6b: `is_leech` eklendikten SONRA taramanın tekrarı (B6) ───────────────
#
# `is_leech` daha önce HİÇBİR yanıt şemasında yoktu; K-6 taramasının bu alan
# için yeşil çıkması sınırın sağlamlığından değil, alanın hiç dönmemesinden
# geliyordu. Alan artık kart tarayıcısında dönüyor — bu yüzden tarama eğitmen
# VE admin token'ıyla yeniden yapılır.

#: Router'daki GET uçlarının TAMAMI (9). Yeni GET ucu eklenirse buraya da eklenir.
SRS_GET_UCLARI = (
    "/api/v1/srs/decks",
    "/api/v1/srs/decks/platform",
    "/api/v1/srs/decks/{deck}",
    "/api/v1/srs/decks/{deck}/assignments",
    "/api/v1/srs/cards?deck_id={deck}",
    "/api/v1/srs/study/queue?deck_id={deck}",
    "/api/v1/srs/stats?deck_id={deck}",
    "/api/v1/srs/tags",
    "/api/v1/srs/admin/platform-decks",
)


async def test_d6b_leech_izi_hicbir_uctan_sizmiyor(ip16, ip16_http, ip16_saat):
    """Öğrencinin leech/askı durumu ne eğitmene ne admine dönmeli.

    Leech, kullanıcının "bu kartta 8 kez takıldım" bilgisidir; ilerleme
    verisinin en mahremlerinden biridir (§7.2 K-6). Kart tarayıcısı bunu
    YALNIZ isteyenin kendi satırından okur.
    """
    _tid, t_hdr, cid, _c_hdr, deck_id = await _atanmis_calisan_ogrenci(
        ip16, ip16_http, ip16_saat
    )
    # Öğrencinin bir kartını leech + askıda yap (gerçek satır, sahte değil).
    await ip16.sql_exec(
        "UPDATE srs_progress SET is_leech = true, lapses = 8, suspended_at = now()"
        " WHERE user_id = :u AND role_id = 3 AND state != 'NEW'",
        u=cid,
    )
    izli = await ip16.sql(
        "SELECT count(*) FROM srs_progress WHERE user_id = :u AND role_id = 3"
        " AND is_leech",
        u=cid,
    )
    assert izli[0][0] > 0, "kurulum hatası: leech satırı yok"

    _aid, a_hdr = await ip16.admin(izinler=SRS_IZINLER)
    for etiket, hdr in (("eğitmen", t_hdr), ("admin", a_hdr)):
        for kalip in SRS_GET_UCLARI:
            uc = kalip.format(deck=deck_id)
            r = await ip16_http.get(uc, headers=hdr)
            assert r.status_code in (200, 403, 404), (
                f"{etiket} {uc}: beklenmeyen {r.status_code}"
            )
            if r.status_code != 200:
                continue
            govde = r.text
            assert '"is_leech": true' not in govde.replace('"is_leech":true', '"is_leech": true'), (
                f"{etiket} {uc}: öğrencinin leech işareti yanıta sızdı"
            )
            assert '"suspended": true' not in govde.replace(
                '"suspended":true', '"suspended": true'
            ), f"{etiket} {uc}: öğrencinin askı durumu yanıta sızdı"
            for anahtar in ("leech_total", "suspended_total"):
                if f'"{anahtar}"' in govde:
                    veri = r.json()
                    assert veri.get(anahtar) == 0, (
                        f"{etiket} {uc}: {anahtar} başkasının kartlarını saydı"
                    )


# ── D-7: admin de rutin olarak ilerleme görmüyor ────────────────────────────

async def test_d7_admin_ilerleme_goremez(ip16, ip16_http, ip16_saat):
    _tid, _t_hdr, cid, _c_hdr, deck_id = await _atanmis_calisan_ogrenci(
        ip16, ip16_http, ip16_saat
    )
    _aid, a_hdr = await ip16.admin(izinler=SRS_IZINLER)
    # Admin'in kullanıcı destesine/kuyruğuna/istatistiğine yolu yok → 404.
    for uc in [
        f"/api/v1/srs/decks/{deck_id}",
        f"/api/v1/srs/study/queue?deck_id={deck_id}",
        f"/api/v1/srs/stats?deck_id={deck_id}",
    ]:
        r = await ip16_http.get(uc, headers=a_hdr)
        assert r.status_code == 404, f"admin {uc}: {r.status_code}"
    # Uygulamada '/srs' altında progress taşıyan bir admin rotası hiç yok.
    #
    # Route tablosu OpenAPI şemasından okunur. `app.routes` (ve
    # `api_router.routes`) KULLANILAMAZ: FastAPI 0.137 `include_router`'da
    # tembel bir `_IncludedRouter` bırakır, alt-router yolları ancak istek
    # çözümlenirken düzleşir — o listede arama her zaman boş küme döndürür.
    # Bu düğüm commit 1'de tam olarak bu yüzden YANLIŞ KIRMIZIYDI: hiçbir
    # uygulama geçiremezdi. Aynı tuzak bu depoda zaten belgeli
    # (tests/acceptance/test_f30_packing_contract.py::_router_yollari).
    from main import app

    srs_rotalar = [
        p for p in app.openapi()["paths"] if p.startswith("/api/v1/srs")
    ]
    assert srs_rotalar, "srs rotaları kayıtlı değil"
    assert not any("progress" in p or "ilerleme" in p for p in srs_rotalar)


# ── D-8: öğrenci hazır desteyi kopyalayabiliyor ─────────────────────────────

async def test_d8_kopya(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _aid, a_hdr = await ip16.admin(izinler=SRS_IZINLER)
    r = await ip16_http.post(
        "/api/v1/srs/admin/platform-decks",
        headers=a_hdr,
        json={"name": "Hazır Deste"},
    )
    kaynak = r.json()["id"]
    n = await ip16_http.post(
        f"/api/v1/srs/admin/platform-decks/{kaynak}/notes",
        headers=a_hdr,
        json={"note_type": "BASIC", "front": "soru", "back": "cevap", "tags": []},
    )
    assert n.status_code == 201, n.text[:200]
    _cid, c_hdr = await ip16.ogrenci()
    k = await ip16_http.post(f"/api/v1/srs/decks/{kaynak}/copy", headers=c_hdr)
    assert k.status_code == 201, k.text[:200]
    kopya = k.json()["id"]
    assert kopya != kaynak
    sonuc = await kartlar(ip16_http, c_hdr, kopya)
    assert sonuc["total"] == 1, "kopyaya kartlar gelmedi"


# ── D-9: kopya bağımsız — kaynak değişince etkilenmiyor ─────────────────────

async def test_d9_kopya_bagimsiz(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _aid, a_hdr = await ip16.admin(izinler=SRS_IZINLER)
    kaynak = (
        await ip16_http.post(
            "/api/v1/srs/admin/platform-decks", headers=a_hdr, json={"name": "K"}
        )
    ).json()["id"]
    await ip16_http.post(
        f"/api/v1/srs/admin/platform-decks/{kaynak}/notes",
        headers=a_hdr,
        json={"note_type": "BASIC", "front": "eski", "back": "old", "tags": []},
    )
    _cid, c_hdr = await ip16.ogrenci()
    kopya = (
        await ip16_http.post(f"/api/v1/srs/decks/{kaynak}/copy", headers=c_hdr)
    ).json()["id"]
    # Kaynağa yeni not + ad değişikliği:
    await ip16_http.post(
        f"/api/v1/srs/admin/platform-decks/{kaynak}/notes",
        headers=a_hdr,
        json={"note_type": "BASIC", "front": "yeni", "back": "new", "tags": []},
    )
    await ip16_http.patch(
        f"/api/v1/srs/admin/platform-decks/{kaynak}",
        headers=a_hdr,
        json={"name": "K-değişti"},
    )
    sonuc = await kartlar(ip16_http, c_hdr, kopya)
    assert sonuc["total"] == 1, "kaynağa eklenen not kopyaya yansıdı"
    det = await ip16_http.get(f"/api/v1/srs/decks/{kopya}", headers=c_hdr)
    assert det.json()["name"] == "K", "kaynak ad değişikliği kopyaya yansıdı"


# ── D-10: kaynak silinince kopya ve ilerleme korunuyor ──────────────────────

async def test_d10_kaynak_silinince_kopya_yasar(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _aid, a_hdr = await ip16.admin(izinler=SRS_IZINLER)
    kaynak = (
        await ip16_http.post(
            "/api/v1/srs/admin/platform-decks", headers=a_hdr, json={"name": "S"}
        )
    ).json()["id"]
    await ip16_http.post(
        f"/api/v1/srs/admin/platform-decks/{kaynak}/notes",
        headers=a_hdr,
        json={"note_type": "BASIC", "front": "a", "back": "b", "tags": []},
    )
    cid, c_hdr = await ip16.ogrenci()
    kopya = (
        await ip16_http.post(f"/api/v1/srs/decks/{kaynak}/copy", headers=c_hdr)
    ).json()["id"]
    q = await kuyruk(ip16_http, c_hdr, kopya)
    await cevapla(ip16_http, c_hdr, q["card"]["id"], 3)  # ilerleme doğsun
    sil = await ip16_http.delete(
        f"/api/v1/srs/admin/platform-decks/{kaynak}", headers=a_hdr
    )
    assert sil.status_code in (200, 204)
    det = await ip16_http.get(f"/api/v1/srs/decks/{kopya}", headers=c_hdr)
    assert det.status_code == 200, "kaynak silinince kopya da gitti"
    satir = await ip16.sql(
        "SELECT count(*) FROM srs_progress WHERE user_id = :u AND role_id = 3"
        " AND deleted_at IS NULL AND state != 'NEW'",
        u=cid,
    )
    assert satir[0][0] == 1, "kaynak silinince kopyanın ilerlemesi gitti"


# ── D-11: alt deste kartları üst destede de sayılıyor ───────────────────────

async def test_d11_hiyerarsi_sayimi(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    _cid, hdr = await ip16.ogrenci()
    ust = await deste(ip16_http, hdr, name="Üst")
    alt = await deste(ip16_http, hdr, name="Alt", parent_id=ust["id"])
    await not_ekle(ip16_http, hdr, alt["id"], front="s", back="c")
    q = await kuyruk(ip16_http, hdr, ust["id"])
    assert q["counts"]["new"] == 1, "alt deste kartı üst kuyrukta sayılmadı"
    assert q["card"] is not None


# ── D-12: izin duvarları mevcut katalogdan geçiyor ──────────────────────────

async def test_d12_izin_katalogdan(ip16, ip16_http, ip16_saat):
    ip16_saat(T0)
    from core.admin_permissions import PERMISSION_CODES

    assert "srs_platform.view" in PERMISSION_CODES
    assert "srs_platform.manage" in PERMISSION_CODES
    # İzinsiz admin platform destesi YAZAMAZ; yalnız view'lı okur ama yazamaz.
    _a1, izinsiz = await ip16.admin(izinler=["users.view"])
    r = await ip16_http.post(
        "/api/v1/srs/admin/platform-decks", headers=izinsiz, json={"name": "X"}
    )
    assert r.status_code == 403, f"izinsiz admin yazdı: {r.status_code}"
    _a2, sadece_view = await ip16.admin(izinler=["srs_platform.view"])
    ok = await ip16_http.get("/api/v1/srs/admin/platform-decks", headers=sadece_view)
    assert ok.status_code == 200
    yaz = await ip16_http.post(
        "/api/v1/srs/admin/platform-decks", headers=sadece_view, json={"name": "Y"}
    )
    assert yaz.status_code == 403
