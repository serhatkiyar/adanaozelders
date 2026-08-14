"""İP-17 V matrisi — vade damgası granülerliği (gerçek PG + gerçek HTTP).

Sözleşme kararı (İP-17): gün ölçekli aralıklar (`state == "REVIEW"`, aralık
her zaman tam gün × 1440) için vade damgası **hedef çalışma gününün BAŞINA**
yuvarlanır; intraday öğrenme/yeniden-öğrenme adımları (dakika ölçekli)
dokunulmadan `now + interval` kalır.

## Bu dosya neden sıfırdan yazıldı

İP-17 Faz 1'de ölçüldü: önerilen yuvarlama uygulandığında **mevcut 67 İP-16
entegrasyon düğümünün hiçbiri kırılmıyor**. Yani mevcut suite vade
granülerliği üzerinde nöbet TUTMUYOR — bozuk davranışla düzeltilmiş davranış
ona göre ayırt edilemez (kök CLAUDE.md §E: "eski bozuk kod da aynı testi
geçer miydi?" → evet). Bu yüzden tek bir mevcut düğüm yeniden kullanılmadı.

## Bağımsız kâhin (oracle)

Zaman yardımcıları (`_TR`, `_calisma_gunu`, `_gun_basi`) burada **yeniden**
yazılmıştır; `services.spaced_repetition.dayboundary` import EDİLMEZ. Sebep:
üretimin kendi yardımcısıyla ölçmek, o yardımcıya yapılan bir mutasyonu
(TZ'yi UTC'ye çevirme, rollover ofsetini silme) testin de aynı yönde
kaymasıyla görünmez kılardı. Test kendi takvimini bilir.

## Determinizm

Aralık büyüklüğü FSRS'ten gelir ve testin ölçtüğü şey DEĞİLDİR (o F-15
referans tablosuyla zaten çivilenmiştir). Ölçülen şey damganın NEREYE
konduğudur. Aralığı sabitlemek için kart SQL ile bilinen bir hafıza durumuna
kurulur: `S=0.5, D=8.0` + rating Hard → aralık, geçen gün 0/1/2 fark etmeksizin
**tam 1 gündür** (ölçüldü: `scripts` dışı, Faz 1 kurulum taraması).
"""
from __future__ import annotations

import datetime
from zoneinfo import ZoneInfo

from tests.integration.ip16_factory import cevapla, deste, kuyruk, not_ekle

UTC = datetime.timezone.utc

# ── Bağımsız kâhin: sözleşme §4.3 (K-9) testin kendi diliyle ────────────────
_TR = ZoneInfo("Europe/Istanbul")
_ROLLOVER = 4


def _calisma_gunu(an: datetime.datetime) -> datetime.date:
    return (an.astimezone(_TR) - datetime.timedelta(hours=_ROLLOVER)).date()


def _gun_basi(gun: datetime.date) -> datetime.datetime:
    yerel = datetime.datetime.combine(
        gun, datetime.time(hour=_ROLLOVER), tzinfo=_TR
    )
    return yerel.astimezone(UTC)


def _tr(an: datetime.datetime) -> str:
    return an.astimezone(_TR).strftime("%a %Y-%m-%d %H:%M TR")


# Pazartesi 10 Ağu 2026, 20:00 TR — "akşam çalışan öğrenci" anı.
PZT_20 = datetime.datetime(2026, 8, 10, 20, 0, tzinfo=_TR).astimezone(UTC)
# Bir önceki çalışma günü (geçen gün = 1 olsun diye).
PZR_20 = datetime.datetime(2026, 8, 9, 20, 0, tzinfo=_TR).astimezone(UTC)
# Salı sabahı 09:00 TR — "sabah çalışan öğrenci" anı.
SALI_09 = datetime.datetime(2026, 8, 11, 9, 0, tzinfo=_TR).astimezone(UTC)

# Bir günlük aralık üreten hafıza durumu (Faz 1'de ölçüldü).
BIR_GUN_S = 0.5
BIR_GUN_D = 8.0
HARD = 2


async def _durum(ip16, kart: int, cid: int):
    """(state, due_at, stability) — DB'deki KALICI durum."""
    r = await ip16.sql(
        "SELECT state, due_at, stability FROM srs_progress WHERE card_id = :c"
        " AND user_id = :u AND role_id = 3",
        c=kart, u=cid,
    )
    return r[0]


async def _review_karti(
    ip16, http, hdr, cid: int, *, son_cevap: datetime.datetime,
    stability: float = BIR_GUN_S, difficulty: float = BIR_GUN_D,
    deck_id: int | None = None,
) -> tuple[int, int]:
    """REVIEW durumunda, hafıza durumu bilinen kart.

    Kart GERÇEK uçlarla kurulur (T-1..T-4 türetimi atlanmasın); yalnız hafıza
    durumu + son cevap anı SQL ile sabitlenir — bu bir ZAMAN/DURUM kurulumudur,
    İP-16'nın `_review_karti_kur` deseniyle aynı.
    """
    if deck_id is None:
        d = await deste(http, hdr)
        deck_id = d["id"]
    await not_ekle(http, hdr, deck_id, front=f"s{cid}", back="c")
    q = await kuyruk(http, hdr, deck_id)
    kart = q["card"]["id"]
    await cevapla(http, hdr, kart, 4)  # Easy → REVIEW
    await ip16.sql_exec(
        "UPDATE srs_progress SET stability = :s, difficulty = :d, step = NULL,"
        " last_review_at = :t, due_at = :t WHERE card_id = :c AND user_id = :u"
        " AND role_id = 3",
        s=stability, d=difficulty, t=son_cevap, c=kart, u=cid,
    )
    return deck_id, kart


# ── V-1: gün ölçekli vade, hedef çalışma gününün BAŞINA konur ───────────────

async def test_v1_gun_olcekli_vade_calisma_gunu_basina_yuvarlanir(
    ip16, ip16_http, ip16_saat
):
    """Pzt 20:00'de verilen 1 GÜNLÜK aralık → vade Salı 04:00 TR.

    Bugünkü davranış: Salı 20:00 TR (cevap saati korunuyor). Kart Salı'nın
    kartıdır ama Salı'nın akşamına damgalıdır.
    """
    ip16_saat(PZT_20)
    cid, hdr = await ip16.ogrenci()
    _deck, kart = await _review_karti(ip16, ip16_http, hdr, cid, son_cevap=PZR_20)

    r = await cevapla(ip16_http, hdr, kart, HARD)
    assert r["state"] == "REVIEW", f"kurulum bozuk, REVIEW bekleniyordu: {r}"

    state, due, _s = await _durum(ip16, kart, cid)
    beklenen = _gun_basi(datetime.date(2026, 8, 11))
    assert state == "REVIEW"
    assert due == beklenen, (
        f"vade çalışma günü başına yuvarlanmadı: {_tr(due)} "
        f"(beklenen {_tr(beklenen)})"
    )
    # Uçtan dönen gövde de aynı damgayı taşımalı (istemci bunu gösteriyor).
    assert datetime.datetime.fromisoformat(r["due_at"]) == beklenen


# ── V-2: sabah çalışan öğrenci kartı GÖRÜYOR ────────────────────────────────

async def test_v2_sabah_calisan_ogrenci_karti_kuyrukta_gorur(
    ip16, ip16_http, ip16_saat
):
    """Pzt 20:00'de cevaplanan 1 günlük kart Salı 09:00'da kuyrukta ÇIKAR.

    Bugünkü davranış: vade Salı 20:00 olduğu için `due_at <= now` sağlanmaz;
    öğrenci sabah "bugün tekrarım yok" görür, akşam açtığında kuyruk dolu.
    Ölçülen zararın ta kendisi (§11 P2).
    """
    ip16_saat(PZT_20)
    cid, hdr = await ip16.ogrenci()
    deck, kart = await _review_karti(ip16, ip16_http, hdr, cid, son_cevap=PZR_20)
    await cevapla(ip16_http, hdr, kart, HARD)

    ip16_saat(SALI_09)
    q = await kuyruk(ip16_http, hdr, deck)
    _st, due, _s = await _durum(ip16, kart, cid)
    assert q["counts"]["review"] == 1, (
        f"Salı 09:00'da review sayacı 0 — vade {_tr(due)}, sorgu {_tr(SALI_09)}"
    )
    assert q["card"] is not None and q["card"]["id"] == kart, (
        f"Salı 09:00'da kart sunulmadı; vade {_tr(due)}"
    )


# ── V-3: ardışık tekrarlarda vade saati KAYMIYOR ────────────────────────────

async def test_v3_ardisik_tekrarlarda_vade_saati_kaymiyor(
    ip16, ip16_http, ip16_saat
):
    """5 tekrar, her biri vadeden 2 saat sonra cevaplanıyor.

    Bugünkü davranış (Faz 1'de ölçüldü): damga her turda ileri sürükleniyor —
    due saatleri 20 → 22 → 00 → 02 → 04 ve beşinci turda 04:00 rollover'ı
    aşılınca bir çalışma günü sessizce atlanıyor (cevap günleri
    08-10 → 08-11 → 08-12 → 08-13 → **08-15**).

    Aralık her turda 1 günde sabitlenir (hafıza durumu yeniden kurulur); ölçülen
    şey aralık değil damganın yeri.
    """
    ip16_saat(PZT_20)
    cid, hdr = await ip16.ogrenci()
    _deck, kart = await _review_karti(ip16, ip16_http, hdr, cid, son_cevap=PZR_20)

    an = PZT_20
    due_saatleri: list[int] = []
    cevap_gunleri: list[datetime.date] = []
    for _tur in range(5):
        cevap_gunleri.append(_calisma_gunu(an))
        await cevapla(ip16_http, hdr, kart, HARD)
        _st, due, _s = await _durum(ip16, kart, cid)
        due_saatleri.append(due.astimezone(_TR).hour)
        # Sonraki tur: kullanıcı vadeden 2 saat geç cevaplıyor.
        an = due + datetime.timedelta(hours=2)
        ip16_saat(an)
        # Aralığı 1 günde sabitle (ölçülen şey aralık değil, damga).
        await ip16.sql_exec(
            "UPDATE srs_progress SET stability = :s, difficulty = :d WHERE"
            " card_id = :c AND user_id = :u AND role_id = 3",
            s=BIR_GUN_S, d=BIR_GUN_D, c=kart, u=cid,
        )

    assert due_saatleri == [4, 4, 4, 4, 4], (
        f"vade saati sürükleniyor: {due_saatleri} (hepsi 04:00 TR olmalıydı)"
    )
    farklar = [
        (b - a).days
        for a, b in zip(cevap_gunleri, cevap_gunleri[1:], strict=False)
    ]
    assert farklar == [1, 1, 1, 1], (
        f"bir çalışma günü atlandı: {[str(g) for g in cevap_gunleri]} "
        f"→ farklar {farklar}"
    )


# ── V-4: intraday öğrenme adımları yuvarlanMIYOR (aşırı uygulama nöbeti) ────

async def test_v4_ogrenme_adimlari_intraday_kaliyor(ip16, ip16_http, ip16_saat):
    """1 dk / 10 dk öğrenme adımları ve 10 dk relearning adımı gün başına
    ÇEKİLMEZ — yuvarlama yalnız gün ölçekli (REVIEW) aralıklara uygulanır.

    Bu düğüm bugün YEŞİL başlar: koruduğu davranış hâlihazırda doğrudur.
    Nöbetçiliği kırmızıyla değil, Faz 4 mutasyonuyla kanıtlanır (yuvarlamayı
    fazdan bağımsız uygula → bu düğüm kırılmalı).
    """
    ip16_saat(PZT_20)
    cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    await not_ekle(ip16_http, hdr, d["id"], front="s", back="c")
    q = await kuyruk(ip16_http, hdr, d["id"])
    kart = q["card"]["id"]

    # NEW + Good → LEARNING adım 1 (10 dk), intraday.
    r = await cevapla(ip16_http, hdr, kart, 3)
    assert r["state"] == "LEARNING" and r["step"] == 1
    _st, due, _s = await _durum(ip16, kart, cid)
    assert due == PZT_20 + datetime.timedelta(minutes=10), (
        f"öğrenme adımı yuvarlandı: {_tr(due)} (beklenen {_tr(PZT_20)} + 10 dk)"
    )

    # REVIEW + Again → RELEARNING (10 dk), o da intraday.
    _deck2, kart2 = await _review_karti(
        ip16, ip16_http, hdr, cid, son_cevap=PZR_20, deck_id=d["id"]
    )
    r2 = await cevapla(ip16_http, hdr, kart2, 1)
    assert r2["state"] == "RELEARNING"
    _st2, due2, _s2 = await _durum(ip16, kart2, cid)
    assert due2 == PZT_20 + datetime.timedelta(minutes=10), (
        f"relearning adımı yuvarlandı: {_tr(due2)}"
    )


# ── V-5: yuvarlama tabanı ÇALIŞMA günü (rollover), takvim günü değil ────────

async def test_v5_yuvarlama_tabani_calisma_gunu_rollover_oncesi(
    ip16, ip16_http, ip16_saat
):
    """Salı 03:30 TR hâlâ Pazartesi çalışma günüdür (G-2/G-3).

    Bu anda verilen 1 günlük aralığın vadesi Salı 04:00 TR'dir (30 dk sonra),
    Çarşamba 04:00 DEĞİL. Takvim tarihine göre yuvarlayan bir uygulama bir gün
    ileri atar; UTC'ye göre yuvarlayan da (UTC'de saat 00:30 ve tarih 11'dir).
    """
    sali_0330 = datetime.datetime(2026, 8, 11, 3, 30, tzinfo=_TR).astimezone(UTC)
    assert _calisma_gunu(sali_0330) == datetime.date(2026, 8, 10), "kâhin bozuk"

    ip16_saat(sali_0330)
    cid, hdr = await ip16.ogrenci()
    _deck, kart = await _review_karti(
        ip16, ip16_http, hdr, cid,
        son_cevap=datetime.datetime(2026, 8, 9, 20, 0, tzinfo=_TR).astimezone(UTC),
    )
    await cevapla(ip16_http, hdr, kart, HARD)

    _st, due, _s = await _durum(ip16, kart, cid)
    beklenen = _gun_basi(datetime.date(2026, 8, 11))  # Salı 04:00 TR
    assert due == beklenen, (
        f"yuvarlama tabanı çalışma günü değil: {_tr(due)} "
        f"(beklenen {_tr(beklenen)})"
    )


# ── V-6: FSRS'ye giden elapsed_days DEĞİŞMEDİ (regresyon) ──────────────────

async def test_v6_elapsed_days_calisma_gunu_tabaninda_kaldi(
    ip16, ip16_http, ip16_saat
):
    """Yuvarlama, motora giden geçen-gün ölçüsüne DOKUNMAZ.

    Pzt 20:00'de cevaplanmış (S=10, D=5) kart Salı 09:00'da Good alırsa geçen
    çalışma günü 1'dir ve S = 12.52798994372677 olur. Takvim farkına düşen bir
    uygulama 0 gün sayar ve short-term formülüyle S = 14.077712147375411
    üretir — sözleşme §2.1'in ölçtüğü eski hata değeri.

    Bu düğüm de bugün YEŞİL başlar (H3 zaten doğru); nöbetçiliği Faz 4'te
    kanıtlanır. İP-17 açısından anlamı: yuvarlama bu değeri BOZMAMALI.
    """
    ip16_saat(PZT_20)
    cid, hdr = await ip16.ogrenci()
    _deck, kart = await _review_karti(
        ip16, ip16_http, hdr, cid, son_cevap=PZT_20,
        stability=10.0, difficulty=5.0,
    )
    ip16_saat(SALI_09)
    await cevapla(ip16_http, hdr, kart, 3)

    _st, _due, stability = await _durum(ip16, kart, cid)
    assert abs(float(stability) - 12.52798994372677) < 1e-9, (
        f"geçen gün tabanı kaydı: S={stability} "
        f"(14.0777… = takvim farkı/0 gün, 12.5279… = çalışma günü/1 gün)"
    )


# ── V-7: 03:59 kenarı — vade geçmişe düşmez, 04:00'te geri gelir ────────────

async def test_v7_rollover_oncesi_kenar_vade_bir_dakika_sonra(
    ip16, ip16_http, ip16_saat
):
    """03:59 TR'de cevaplanan 1 günlük kartın vadesi AYNI GÜN 04:00'tir.

    Yuvarlamanın kabul edilmiş sonucudur (Anki de böyle davranır): kart o
    çalışma gününün ilk anına düşer, yani 1 dakika sonra. İki şey ölçülür:
    (1) vade cevap anından SONRA (asla geçmişe düşmez), (2) kart 04:01'de
    kuyrukta gerçekten geri gelir. Sözleşmeye yazılmazsa bu davranış sonradan
    "hata" diye raporlanır.
    """
    sali_0359 = datetime.datetime(2026, 8, 11, 3, 59, tzinfo=_TR).astimezone(UTC)
    ip16_saat(sali_0359)
    cid, hdr = await ip16.ogrenci()
    deck, kart = await _review_karti(
        ip16, ip16_http, hdr, cid,
        son_cevap=datetime.datetime(2026, 8, 9, 20, 0, tzinfo=_TR).astimezone(UTC),
    )
    await cevapla(ip16_http, hdr, kart, HARD)

    _st, due, _s = await _durum(ip16, kart, cid)
    beklenen = _gun_basi(datetime.date(2026, 8, 11))  # Salı 04:00 TR
    assert due == beklenen, f"kenar durumda vade: {_tr(due)}"
    assert due > sali_0359, f"vade geçmişe düştü: {_tr(due)} <= {_tr(sali_0359)}"
    assert (due - sali_0359) == datetime.timedelta(minutes=1)

    ip16_saat(datetime.datetime(2026, 8, 11, 4, 1, tzinfo=_TR).astimezone(UTC))
    q = await kuyruk(ip16_http, hdr, deck)
    assert q["card"] is not None and q["card"]["id"] == kart, (
        "04:01'de kart kuyruğa dönmedi"
    )


# ── V-9: undo yuvarlanmış damgayı tutarlı geri alır ────────────────────────

async def test_v9_undo_onceki_damgayi_birebir_geri_yukler(
    ip16, ip16_http, ip16_saat
):
    """`undo` damgayı YENİDEN HESAPLAMAZ, öncekini birebir geri koyar.

    Faz 1'de undo "üretim noktası değil" diye geçilmişti; yuvarlamadan sonra
    yeniden bakıldı. Sözleşme: undo = anlık görüntüye dönüş (S-4). Geri
    yüklenen damga yuvarlanmamış olabilir (eski satır ya da intraday adım) ve
    bu DOĞRUDUR — undo geçmişi düzeltmez. Yuvarlama bir SONRAKİ cevapta
    yeniden uygulanır.
    """
    ip16_saat(PZT_20)
    cid, hdr = await ip16.ogrenci()
    _deck, kart = await _review_karti(ip16, ip16_http, hdr, cid, son_cevap=PZR_20)

    await cevapla(ip16_http, hdr, kart, HARD)
    _st, due1, _s = await _durum(ip16, kart, cid)
    assert due1 == _gun_basi(datetime.date(2026, 8, 11)), (
        f"kurulum: cevap yuvarlanmadı ({_tr(due1)})"
    )

    r = await ip16_http.post("/api/v1/srs/study/undo", headers=hdr)
    assert r.status_code == 200, f"undo: {r.status_code} {r.text[:200]}"
    _st2, due2, _s2 = await _durum(ip16, kart, cid)
    assert due2 == PZR_20, (
        f"undo önceki damgayı birebir geri yüklemedi: {_tr(due2)} "
        f"(beklenen {_tr(PZR_20)})"
    )

    # Yuvarlama bir sonraki cevapta YENİDEN uygulanır (undo onu devre dışı
    # bırakmaz).
    car_20 = datetime.datetime(2026, 8, 12, 20, 0, tzinfo=_TR).astimezone(UTC)
    ip16_saat(car_20)
    await cevapla(ip16_http, hdr, kart, HARD)
    _st3, due3, _s3 = await _durum(ip16, kart, cid)
    yerel = due3.astimezone(_TR)
    assert (yerel.hour, yerel.minute) == (_ROLLOVER, 0), (
        f"undo sonrası yuvarlama uygulanmadı: {_tr(due3)}"
    )
    assert _calisma_gunu(due3) > _calisma_gunu(car_20), (
        f"vade ileri gitmedi: {_tr(due3)}"
    )


# ── V-8: aynı güne düşen review kartları arasında sıra card_id'ye iner ─────

async def test_v8_esit_vadede_sira_card_id_ile_belirlenir(
    ip16, ip16_http, ip16_saat
):
    """Aynı çalışma gününe yuvarlanan review kartlarının vadesi EŞİTLENİR ve
    kuyruk sırası Q-9 tie-breaker'ına (card_id artan) düşer.

    Bugünkü davranış: üç kart farklı saatlerde cevaplandığı için üç FARKLI
    damga taşır ve sıra cevaplama sırasını izler. Yuvarlamadan sonra sıra
    ekleniş sırasına döner. Bu bir kaza değil karar olduğu için nöbetçisi var.

    Q-10 (kardeş ayırma) karışmasın diye Pazartesi'nin SON cevabı başka bir
    destedeki çapa karta verilir; böylece `son_note` üç kartın hiçbiri değildir.
    """
    ip16_saat(PZT_20)
    cid, hdr = await ip16.ogrenci()
    d = await deste(ip16_http, hdr)
    for i in range(3):
        await not_ekle(ip16_http, hdr, d["id"], front=f"s{i}", back="c")
    liste = await ip16_http.get(
        "/api/v1/srs/cards", headers=hdr, params={"deck_id": d["id"]}
    )
    k1, k2, k3 = [k["id"] for k in liste.json()["items"]]
    assert k1 < k2 < k3, "kart kimlikleri artan değil, kurulum varsayımı bozuk"

    # Ekleniş sırasının TERSİNE cevapla: k3 sabah, k2 öğlen, k1 akşam.
    saatler = {k3: 9, k2: 13, k1: 17}
    for kart, saat in saatler.items():
        an = datetime.datetime(2026, 8, 10, saat, 0, tzinfo=_TR).astimezone(UTC)
        ip16_saat(an)
        await cevapla(ip16_http, hdr, kart, 4)  # Easy → REVIEW
        await ip16.sql_exec(
            "UPDATE srs_progress SET stability = :s, difficulty = :d, step = NULL,"
            " last_review_at = :o, due_at = :o WHERE card_id = :c AND"
            " user_id = :u AND role_id = 3",
            s=BIR_GUN_S, d=BIR_GUN_D, o=PZR_20, c=kart, u=cid,
        )
        await cevapla(ip16_http, hdr, kart, HARD)  # 1 günlük aralık

    # Q-10 çapası: günün son cevabı BAŞKA destedeki bir karta.
    capa_deste = await deste(ip16_http, hdr)
    await not_ekle(ip16_http, hdr, capa_deste["id"], front="capa", back="c")
    capa_q = await kuyruk(ip16_http, hdr, capa_deste["id"])
    await cevapla(ip16_http, hdr, capa_q["card"]["id"], 3)

    # ÖNCE iki gözlemi de topla (biri diğerinin arkasında saklanmasın), SONRA
    # doğrula: gözlemlenebilir davranış (sıra) birincil, damga eşitliği onun
    # mekanizması. Sıra okunurken kartlar cevaplandığı için damgalar önce
    # okunmalı.
    vadeler = await ip16.sql(
        "SELECT p.card_id, p.due_at FROM srs_progress p WHERE p.user_id = :u"
        " AND p.role_id = 3 AND p.card_id IN (:a, :b, :c) ORDER BY p.card_id",
        u=cid, a=k1, b=k2, c=k3,
    )
    ip16_saat(datetime.datetime(2026, 8, 11, 20, 0, tzinfo=_TR).astimezone(UTC))
    sira = []
    for _ in range(3):
        q = await kuyruk(ip16_http, hdr, d["id"])
        assert q["card"] is not None, f"kuyruk erken boşaldı: {sira}"
        sira.append(q["card"]["id"])
        await cevapla(ip16_http, hdr, q["card"]["id"], 3)

    damgalar = [(v[0], _tr(v[1])) for v in vadeler]
    assert sira == [k1, k2, k3], (
        f"eşit vadede sıra card_id'ye inmedi: {sira} (beklenen {[k1, k2, k3]}); "
        f"damgalar {damgalar}"
    )
    assert len({v[1] for v in vadeler}) == 1, (
        f"aynı güne düşen kartların vadesi eşitlenmedi: {damgalar}"
    )
