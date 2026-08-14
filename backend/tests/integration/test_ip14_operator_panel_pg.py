"""İP-14 kırmızı matris — operatör paneli: sıralama + denetim izi (GERÇEK Postgres).

## Bu dosya neyi nöbetliyor

İki ayrı iddia var ve ikisi de gerçek HTTP + gerçek veritabanı ister:

**S · Sıralama.** `library_exam_service.list_library_sessions_admin` oturumları
`starts_at DESC` döndürüyordu: en uzak gelecekteki oturum en üstte, bugünün
sınavı listenin dibinde. Bu "kozmetik" bir kusur değil — operatörün sınav günü
yönetmesi gereken satır, gelecek yılın planları arasında kayboluyor. İddia
kaynak taramasıyla değil, **gerçek uçtan dönen sıra** ile ölçülür (CLAUDE.md
§B): sıralama ifadesi değişse bile (ör. ikincil anahtar eklense) test doğru
davranışı korumaya devam eder.

**D · Denetim izi.** Operatörün üç aksiyonu para ve geri alınamaz durum üretir:

  • yoklama doğrulama  → emanet kütüphaneye RELEASED (geri alınamaz damga)
  • oturum iptali      → ödeyen herkese toplu iade
  • karne yayınlama    → öğrencilere bildirim, geri alınamaz

İP-3'te kurye saha aksiyonları `audit_logs`'a bağlanmıştı
(`delivery_service.py::_ZimmetAktoru` + `audit_service.record`); operatör aynı
sınıfta para etkisi doğuruyor ama izi yalnız `attended_by_operator_id`
kolonundaydı. "Hangi operatör, ne zaman, hangi girişi doğruladı" sorusunun
cevabı bir hesap ele geçirildiğinde bu kolonla verilemez (kolon üzerine yazılır,
iptal/yayın aksiyonlarında ise hiç yoktur).

`actor_role` iddiası (D-5) bilinçlidir: audit satırı ADMIN adına yazılırsa
denetim izi **yanlış kişiyi** gösterir — bu, iz olmamasından daha kötüdür.

`D-4` (aynı transaction) mutasyona en açık düğümdür: audit ayrı bir session'da
yazılırsa aksiyon geri alındığında bile iz kalır (ya da tersi). Test bunu
"aksiyon başarısız → audit YOK" senaryosuyla ölçer.

## Kanıt sınıfı

Gerçek PostgreSQL + gerçek ASGI HTTP + gerçek JWT (dependency override YOK).
Fabrika: `ip3_factory.IP3Fabrika` (cleanup'ı `audit_logs WHERE actor_role=4`
satırlarını zaten siliyor — hijyen nöbetçisi audit_logs sayar).
"""
from __future__ import annotations

import datetime

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.ip3_factory import yetki_basligi

pytestmark = pytest.mark.asyncio


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _audit_satirlari(
    *, actor_id: int, action: str | None = None
) -> list[dict]:
    """Operatörün (role 4) yazdığı denetim satırları."""
    async with AsyncSessionLocal() as s:
        sql = (
            "SELECT id, actor_id, actor_role, action, target_type, target_id, "
            'reason, details, metadata AS meta FROM audit_logs '
            "WHERE actor_id = :a AND actor_role = 4"
        )
        params: dict = {"a": actor_id}
        if action is not None:
            sql += " AND action = :act"
            params["act"] = action
        rows = (await s.execute(text(sql + " ORDER BY id"), params)).mappings().all()
    return [dict(r) for r in rows]


async def _tum_audit(*, target_type: str, target_id: int) -> list[dict]:
    async with AsyncSessionLocal() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT actor_id, actor_role, action FROM audit_logs "
                    "WHERE target_type = :t AND target_id = :i ORDER BY id"
                ),
                {"t": target_type, "i": target_id},
            )
        ).mappings().all()
    return [dict(r) for r in rows]


async def _oturum_tarihi(session_id: int, *, starts_at: datetime.datetime) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(
            text("UPDATE library_exam_sessions SET starts_at = :d WHERE id = :i"),
            {"d": starts_at, "i": session_id},
        )
        await s.commit()


# ══════════════════════════════════════════════════════════════════════════
# S · Sıralama — yaklaşanlar önce
# ══════════════════════════════════════════════════════════════════════════


async def test_S1_S2_oturum_listesi_kronolojik_yaklasanlar_once(ip3, http):
    """S-1 + S-2: yönetim listesi erken→geç sıralı; geçmiş oturumlar altta.

    Fixture bilinçli olarak KARIŞIK sırayla üretilir ve sıra `id` ile
    korelasyonsuzdur: liste yalnızca `id ASC` ile de doğru çıkmasın.
    """
    lib = await ip3.library()
    op = await ip3.operator(lib)

    gelecek_uzak = await ip3.exam_session(lib, results_published=False)
    await _oturum_tarihi(gelecek_uzak.id, starts_at=_now() + datetime.timedelta(days=90))
    gecmis = await ip3.exam_session(lib, results_published=False)
    await _oturum_tarihi(gecmis.id, starts_at=_now() - datetime.timedelta(days=10))
    gelecek_yakin = await ip3.exam_session(lib, results_published=False)
    await _oturum_tarihi(gelecek_yakin.id, starts_at=_now() + datetime.timedelta(days=1))

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib.id},
        headers=yetki_basligi(op),
    )
    assert r.status_code == 200, r.text
    sira = [s["id"] for s in r.json()]

    # S-1: yaklaşanlar önce ve kendi içinde erken→geç.
    assert sira.index(gelecek_yakin.id) < sira.index(gelecek_uzak.id), (
        f"yarınki oturum 90 gün sonrakinden SONRA geliyor: {sira}"
    )
    # S-2: geçmiş oturum en altta.
    assert sira[-1] == gecmis.id, f"geçmiş oturum altta değil: {sira}"


async def test_S3_public_liste_sıralaması_bozulmadı(ip3, http):
    """S-3: yönetim sıralaması değişirken public liste de erken→geç kalmalı.

    Tam tarama (`grep list_library_sessions_admin`) tek çağıran gösterdi
    (`api/routers/library_exams.py`), ama public liste AYRI bir fonksiyondur ve
    zaten `asc` sıralıdır. Bu test, ortak bir yardımcıya çekilirken yönün
    yanlışlıkla ters çevrilmesini yakalar.
    """
    lib = await ip3.library()
    client = await ip3.client()

    uzak = await ip3.exam_session(lib, results_published=False)
    await _oturum_tarihi(uzak.id, starts_at=_now() + datetime.timedelta(days=60))
    yakin = await ip3.exam_session(lib, results_published=False)
    await _oturum_tarihi(yakin.id, starts_at=_now() + datetime.timedelta(days=2))

    r = await http.get(
        "/api/v1/exam-sessions",
        params={"library_id": lib.id},
        headers=yetki_basligi(client),
    )
    assert r.status_code == 200, r.text
    sira = [s["id"] for s in r.json()]
    assert sira.index(yakin.id) < sira.index(uzak.id), sira


# ══════════════════════════════════════════════════════════════════════════
# D · Denetim izi
# ══════════════════════════════════════════════════════════════════════════


async def test_D1_D5_yoklama_audit_logs_a_yaziliyor_ve_aktor_operator(ip3, http):
    """D-1 + D-5: yoklama doğrulama denetim izine düşer; aktör OPERATÖRDÜR.

    Bu aksiyon emaneti kütüphaneye serbest bırakır (`released_at`), yani para
    hareketidir. Audit satırı ADMIN adına yazılırsa iz yanlış kişiyi gösterir.
    """
    lib = await ip3.library()
    op = await ip3.operator(lib)
    client = await ip3.client()
    sess = await ip3.exam_session(lib, results_published=False)
    reg = await ip3.exam_registration(sess, client, status="PAID")

    r = await http.post(
        f"/api/v1/exam-registrations/{reg.id}/attend",
        headers=yetki_basligi(op),
    )
    assert r.status_code == 200, r.text
    assert r.json()["already"] is False

    satirlar = await _audit_satirlari(actor_id=op.id)
    assert satirlar, "yoklama doğrulaması audit_logs'a HİÇ yazılmadı"
    kayit = satirlar[-1]
    # D-5: aktör rolü LIBRARY_OPERATOR (4) — admin değil.
    assert kayit["actor_role"] == 4, kayit
    assert kayit["actor_id"] == op.id, kayit
    # Hedef: doğrulanan kayıt. (Aksiyonun neye dokunduğu izden okunabilmeli.)
    assert kayit["target_id"] == reg.id, kayit
    assert "attend" in kayit["action"] or "attendance" in kayit["action"], kayit

    # Aynı kayıt için ADMIN adına yazılmış bir satır OLMAMALI.
    hepsi = await _tum_audit(target_type=kayit["target_type"], target_id=reg.id)
    assert all(h["actor_role"] == 4 for h in hepsi), hepsi


async def test_D1_calisma_rezervasyonu_girisi_de_audit_e_yaziliyor(ip3, http):
    """D-1 (ikinci yüzey): çalışma alanı QR girişi de emanet serbest bırakır."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    client = await ip3.client()
    res = await ip3.study_reservation(lib, client, status="PAID")

    r = await http.post(
        f"/api/v1/study-reservations/{res.id}/attend",
        headers=yetki_basligi(op),
    )
    assert r.status_code == 200, r.text

    satirlar = await _audit_satirlari(actor_id=op.id)
    assert satirlar, "çalışma rezervasyonu girişi audit_logs'a yazılmadı"
    assert satirlar[-1]["target_id"] == res.id, satirlar[-1]
    assert satirlar[-1]["actor_role"] == 4, satirlar[-1]


async def test_D2_oturum_iptali_audit_e_yaziliyor(ip3, http):
    """D-2: oturum iptali ödeyen herkese iade tetikler — izsiz kalamaz."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    client = await ip3.client()
    sess = await ip3.exam_session(lib, results_published=False)
    await ip3.exam_registration(sess, client, status="PAID")

    r = await http.post(
        f"/api/v1/exam-sessions/{sess.id}/cancel", headers=yetki_basligi(op)
    )
    assert r.status_code == 200, r.text

    satirlar = await _audit_satirlari(actor_id=op.id)
    assert satirlar, "oturum iptali audit_logs'a yazılmadı"
    kayit = satirlar[-1]
    assert kayit["actor_role"] == 4, kayit
    assert kayit["target_id"] == sess.id, kayit
    assert "cancel" in kayit["action"], kayit


async def test_D3_karne_yayinlama_audit_e_yaziliyor(ip3, http):
    """D-3: karne yayınlama geri alınamaz (öğrenciye bildirim gider)."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    sess = await ip3.exam_session(lib, results_published=False)

    r = await http.post(
        f"/api/v1/exam-sessions/{sess.id}/results/publish",
        headers=yetki_basligi(op),
    )
    assert r.status_code == 200, r.text

    satirlar = await _audit_satirlari(actor_id=op.id)
    assert satirlar, "karne yayınlama audit_logs'a yazılmadı"
    kayit = satirlar[-1]
    assert kayit["actor_role"] == 4, kayit
    assert kayit["target_id"] == sess.id, kayit
    assert "publish" in kayit["action"], kayit


async def test_D4_audit_aksiyonla_ayni_transaction_da(ip3, http):
    """D-4: aksiyon başarısızsa audit da YAZILMAZ.

    Yoklama zaten doğrulanmış bir kayıtta ikinci kez çalıştırılır: servis
    `already=True` ile erken döner, durum DEĞİŞMEZ. Audit ayrı bir
    transaction'da (ya da erken dönüşten önce) yazılıyorsa, hiç olmamış bir
    "doğrulama" izi birikir — denetim izinin anlamı biter.

    İkinci prova: yabancı kütüphanenin kaydında 404 alınır (İP-3 kapısı) ve
    yine hiçbir iz kalmamalıdır.
    """
    lib = await ip3.library()
    op = await ip3.operator(lib)
    client = await ip3.client()
    sess = await ip3.exam_session(lib, results_published=False)
    reg = await ip3.exam_registration(sess, client, status="PAID")

    ilk = await http.post(
        f"/api/v1/exam-registrations/{reg.id}/attend", headers=yetki_basligi(op)
    )
    assert ilk.status_code == 200, ilk.text
    ilk_sayim = len(await _audit_satirlari(actor_id=op.id))
    assert ilk_sayim == 1, "ilk doğrulama tam olarak bir iz bırakmalı"

    # (a) Tekrar: durum değişmez → yeni iz olmamalı.
    tekrar = await http.post(
        f"/api/v1/exam-registrations/{reg.id}/attend", headers=yetki_basligi(op)
    )
    assert tekrar.status_code == 200
    assert tekrar.json()["already"] is True
    assert len(await _audit_satirlari(actor_id=op.id)) == ilk_sayim, (
        "durum değişmediği hâlde ikinci audit satırı yazıldı"
    )

    # (b) Başarısız aksiyon (yabancı kayıt → 404) iz bırakmamalı.
    yabanci_lib = await ip3.library()
    yabanci_sess = await ip3.exam_session(yabanci_lib, results_published=False)
    yabanci_client = await ip3.client()
    yabanci_reg = await ip3.exam_registration(yabanci_sess, yabanci_client, status="PAID")

    red = await http.post(
        f"/api/v1/exam-registrations/{yabanci_reg.id}/attend",
        headers=yetki_basligi(op),
    )
    assert red.status_code == 404, red.text
    assert len(await _audit_satirlari(actor_id=op.id)) == ilk_sayim, (
        "reddedilen aksiyon audit izi bıraktı"
    )
