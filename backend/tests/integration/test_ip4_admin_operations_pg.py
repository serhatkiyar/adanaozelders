"""İP-4 · Admin operasyon yüzeyi — BACKEND KABUL MATRİSİ (gerçek PG + gerçek HTTP).

SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ. Bir iddia
uygulamaya uydurmak için zayıflatılacaksa gerekçesi ayrı başlıkta raporlanır.

Paketin ilk commit'i olduğu için uçlar henüz YOKTUR: ilk koşum kırmızıdır.

## Neden bu testler var

Denetim raporu (`docs/DENETIM-RAPORU-2026-07-31.md` §4.2) üç bulguyu ölçtü:

* **P1-4** — `escrow_reconciler.py` deneme sınırı dolan iadeyi `logger.error`
  ile bırakıyor; `grep REFUNDING backend/api/` → **sıfır**, `grep OutboxEvent
  backend/api/` → **sıfır**. Yani sarkan para ve ölü SMS/e-posta işi yalnız
  sunucu logunda görünür, düzeltmesi yalnız SQL'den yapılır.
* **TB-14/1** — admin iade listesinin `refund_status` filtresi ham `str`;
  yanlış yazılmış değer 422 yerine **boş liste** döndürüyor → yönetici "iade
  kuyruğu boş" sanıyor.
* **Eksik akış 6** — eğitmen red gerekçesini göremiyor; admin de girmiyor
  (`POST /admin/tutors/{id}/reject` gövdesiz).

## Neden gerçek PG + gerçek HTTP (mock değil)

İddiaların hepsi "hangi SATIR kuyruğa girer" ve "hangi İZİN kapıdan geçer"
sorusudur. Servis fonksiyonunu doğrudan çağıran bir test, uca yanlış izin
kodu yazılmasını GÖRMEZ (P1-14'ün tam olarak anlattığı boşluk); şema
doğrulamasını atlayan bir test de 422 sözleşmesini kanıtlayamaz.
"""
from __future__ import annotations

import pytest

from core.config import settings
from tests.integration.ip4_factory import IP4Fabrika

pytestmark = pytest.mark.asyncio

STUCK = "/api/v1/admin/escrow/stuck"
OUTBOX = "/api/v1/admin/outbox/failed"
RETURNS = "/api/v1/store/admin/returns"

#: Yeni izin çifti. Kod içine gömülmez — `core/admin_permissions.py` katalogunda
#: ve migration ile DB'de bulunmak ZORUNDA (yoksa hiçbir role bağlanamaz ve uç
#: SUPER_ADMIN dahil herkese 403 döner; `266eeeac2a47`'in anlattığı tuzak).
OPS_VIEW = "operations.view"
OPS_MANAGE = "operations.manage"


@pytest.fixture
async def ip4(pg):
    f = IP4Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


async def _sikismis_iadeli_siparis(ip4: IP4Fabrika, **kw):
    """PAID sipariş + otomatik denemeleri tükenmiş iade talebi."""
    pid = await ip4.urun(price="120.00", stock=5)
    musteri_id, _ = await ip4.musteri()
    sip = await ip4.siparis(items=[(pid, 1)], client_id=musteri_id)
    return_id = await ip4.sikismis_iade(
        order_id=sip.order_id,
        client_id=musteri_id,
        items=[(sip.item_ids[0], 1, "120.00")],
        refund_amount="120.00",
        **kw,
    )
    return sip, return_id


# ══════════════════════ B-1 · Sıkışmış escrow listesi ═══════════════════════


async def test_B1_tavani_dolmus_iade_sikisiklar_listesinde(ip4, http):
    """Deneme tavanı dolmuş REFUNDING iade talebi yönetici kuyruğunda görünür."""
    _sip, return_id = await _sikismis_iadeli_siparis(
        ip4, refund_attempts=settings.REFUND_MAX_ATTEMPTS
    )
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW])

    r = await http.get(STUCK, headers=baslik)

    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    kayitlar = {
        (k["entity"], k["entity_id"]): k for k in r.json()
    }
    anahtar = ("order_return", return_id)
    assert anahtar in kayitlar, (
        "Tavanı dolmuş iade talebi sıkışıklar kuyruğunda YOK — yönetici sarkan "
        f"parayı göremez. Dönen: {list(kayitlar)[:5]}"
    )
    kayit = kayitlar[anahtar]
    assert kayit["reason"] == "RETRY_EXHAUSTED"
    assert kayit["refund_attempts"] == settings.REFUND_MAX_ATTEMPTS
    assert kayit["money_status"] == "REFUNDING"


async def test_B1_manual_review_siparisi_listede(ip4, http):
    """PK-δ'nın yazdığı kalıcı MANUAL_REVIEW durumu kuyruğun asıl konusudur."""
    pid = await ip4.urun(price="80.00", stock=3)
    sip = await ip4.siparis(items=[(pid, 1)])
    await ip4.siparis_para_durumu(sip.order_id, payment_status="MANUAL_REVIEW")
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW])

    r = await http.get(STUCK, headers=baslik)

    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    kayitlar = {(k["entity"], k["entity_id"]): k for k in r.json()}
    assert ("order", sip.order_id) in kayitlar, (
        "MANUAL_REVIEW siparişi kuyrukta YOK — reconciler'ın 'manuel inceleme "
        "gerekiyor' kararı hâlâ yalnız logda."
    )
    assert kayitlar[("order", sip.order_id)]["reason"] == "MANUAL_REVIEW"


async def test_B1_saglikli_kayit_kuyruga_girmez(ip4, http):
    """Henüz denemesi tükenmemiş REFUNDING kayıt ALARM DEĞİLDİR.

    Bu negatif iddia matrisin en kritik parçasıdır: kuyruğa her REFUNDING'i
    koyan bir uygulama da B-1'i geçerdi, ama ekran reconciler'ın dakikalar
    içinde kendiliğinden çözeceği kayıtlarla dolar ve gerçek sıkışıklık
    gürültüde kaybolur.
    """
    _sip, return_id = await _sikismis_iadeli_siparis(ip4, refund_attempts=0)
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW])

    r = await http.get(STUCK, headers=baslik)

    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    anahtarlar = {(k["entity"], k["entity_id"]) for k in r.json()}
    assert ("order_return", return_id) not in anahtarlar, (
        "Denemesi tükenmemiş iade sıkışık sayıldı — kuyruk gürültüyle dolar."
    )


# ═══════════════════════ B-2 · Ölü outbox işleri ════════════════════════════


async def test_B2_failed_outbox_isleri_donuyor(ip4, http):
    olu = await ip4.outbox(kind="sms:failed", attempts=5)
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW])

    r = await http.get(OUTBOX, headers=baslik)

    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    kayitlar = {k["id"]: k for k in r.json()}
    assert olu in kayitlar, (
        "Dead-letter outbox işi yönetici listesinde YOK — ölü SMS/e-posta işi "
        "hâlâ yalnız sunucu logunda."
    )
    assert kayitlar[olu]["kind"] == "sms:failed"
    assert kayitlar[olu]["attempts"] == 5
    assert kayitlar[olu]["last_error"]


async def test_B2_bekleyen_ve_gonderilmis_isler_listede_degil(ip4, http):
    bekleyen = await ip4.outbox(status="PENDING", attempts=1, last_error=None)
    gonderilmis = await ip4.outbox(status="SENT", attempts=1, last_error=None)
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW])

    r = await http.get(OUTBOX, headers=baslik)

    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    kimlikler = {k["id"] for k in r.json()}
    assert bekleyen not in kimlikler, "PENDING iş dead-letter kuyruğunda görünüyor."
    assert gonderilmis not in kimlikler, "SENT iş dead-letter kuyruğunda görünüyor."


async def test_B2_ham_payload_sizmiyor(ip4, http):
    """Kişisel veri (telefon/e-posta) yanıt gövdesine HAM geçmez.

    İP-3'ün whitelist projeksiyonu disiplini (`services/delivery_timeline.py`)
    burada da geçerlidir: teşhis için gereken alan `kind` + `last_error`'dır,
    alıcının telefonu değil.
    """
    telefon = "+905321119988"
    olu = await ip4.outbox(payload={"to": telefon, "order_id": 424242})
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW])

    r = await http.get(OUTBOX, headers=baslik)

    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    assert telefon not in r.text, (
        "Ölü iş listesi alıcının telefonunu HAM döndürdü (KVKK): " + r.text[:300]
    )
    kayit = next(k for k in r.json() if k["id"] == olu)
    assert "payload" not in kayit, "Ham payload alanı yanıtta duruyor."
    assert kayit["order_id"] == 424242, (
        "Teşhis için gereken sipariş numarası da kayboldu — projeksiyon fazla "
        "daraltılmış, ekran işe yaramaz."
    )


# ═════════════════════ B-3 · Retry (idempotent) ═════════════════════════════


async def test_B3_retry_isi_yeniden_kuyruga_aliyor(ip4, http):
    olu = await ip4.outbox(status="FAILED", attempts=5)
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW, OPS_MANAGE])

    r = await http.post(f"/api/v1/admin/outbox/{olu}/retry", headers=baslik)

    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    satir = await ip4.outbox_satiri(olu)
    assert satir["status"] == "PENDING", (
        f"İş yeniden kuyruğa alınmadı: {satir['status']}"
    )
    assert satir["attempts"] == 0, (
        "Deneme sayacı sıfırlanmadı — iş worker'ın ilk turunda yeniden "
        "tavana çarpıp anında FAILED'a düşer, retry hiçbir şey yapmaz."
    )


async def test_B3_retry_idempotent_ikinci_cagri_yeni_is_uretmez(ip4, http):
    olu = await ip4.outbox(status="FAILED", attempts=5, kind="sms:failed")
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW, OPS_MANAGE])
    once = await ip4.outbox_sayisi(kind="sms:failed")

    ilk = await http.post(f"/api/v1/admin/outbox/{olu}/retry", headers=baslik)
    ikinci = await http.post(f"/api/v1/admin/outbox/{olu}/retry", headers=baslik)

    assert ilk.status_code == 200, f"{ilk.status_code}: {ilk.text[:300]}"
    assert ikinci.status_code == 200, (
        "İkinci retry hata verdi; idempotent olmalıydı: "
        f"{ikinci.status_code} {ikinci.text[:200]}"
    )
    assert ilk.json()["requeued"] is True
    assert ikinci.json()["requeued"] is False, (
        "İkinci çağrı da 'yeniden kuyruğa alındı' dedi — sayaç ikinci kez "
        "sıfırlanmışsa iş iki kez gönderilebilir."
    )
    # `once` zaten tohumlanan satırı içerir; retry HİÇ yeni satır üretmemeli.
    assert await ip4.outbox_sayisi(kind="sms:failed") == once, (
        "Retry yeni bir outbox satırı ÜRETTİ — aynı iş iki kez gönderilir."
    )


async def test_B3_gonderilmis_is_yeniden_gonderilemez(ip4, http):
    """SENT bir iş retry edilemez: SMS/e-posta GERİ ALINAMAZ yan etkidir."""
    gonderilmis = await ip4.outbox(status="SENT", attempts=1, last_error=None)
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW, OPS_MANAGE])

    r = await http.post(f"/api/v1/admin/outbox/{gonderilmis}/retry", headers=baslik)

    assert r.status_code == 409, (
        f"Gönderilmiş iş yeniden kuyruğa alındı ({r.status_code}) — müşteriye "
        "ikinci kez SMS gider."
    )
    assert (await ip4.outbox_satiri(gonderilmis))["status"] == "SENT"


async def test_B3_olmayan_is_404(ip4, http):
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW, OPS_MANAGE])
    r = await http.post("/api/v1/admin/outbox/2000000000/retry", headers=baslik)
    assert r.status_code == 404, f"{r.status_code}: {r.text[:200]}"


# ═══════════════════════ B-4 · İzin duvarı ══════════════════════════════════


@pytest.mark.parametrize(
    "method,yol,gereken",
    [
        ("GET", STUCK, OPS_VIEW),
        ("GET", OUTBOX, OPS_VIEW),
        ("POST", "/api/v1/admin/outbox/1/retry", OPS_MANAGE),
    ],
    ids=["escrow-stuck", "outbox-failed", "outbox-retry"],
)
async def test_B4_izinsiz_admin_403(ip4, http, method, yol, gereken):
    """İzin kapısı ROUTER'a kablolanmış mı (P1-14: servis testi bunu görmez)."""
    _admin_id, baslik = await ip4.admin(izinler=["orders.view"])

    r = await http.request(method, yol, headers=baslik)

    assert r.status_code == 403, (
        f"{method} {yol} '{gereken}' izni olmayan admine {r.status_code} döndü: "
        f"{r.text[:200]}"
    )


async def test_B4_view_izni_retry_yapmaya_yetmez(ip4, http):
    """Görev ayrılığı: kuyruğu GÖREN kişi tek başına iş TETİKLEYEMEZ."""
    olu = await ip4.outbox(status="FAILED", attempts=5)
    _admin_id, baslik = await ip4.admin(izinler=[OPS_VIEW])

    r = await http.post(f"/api/v1/admin/outbox/{olu}/retry", headers=baslik)

    assert r.status_code == 403, f"{r.status_code}: {r.text[:200]}"
    assert (await ip4.outbox_satiri(olu))["status"] == "FAILED"


async def test_B4_yeni_izinler_katalogda(ip4, http):
    """İzin kataloğa girmediyse HİÇBİR role bağlanamaz (`266eeeac2a47` tuzağı).

    Kaynak taraması DEĞİL: gerçek `/admin/access/permissions` yanıtı okunur,
    yani izin satırı veritabanında GERÇEKTEN vardır.
    """
    _admin_id, baslik = await ip4.admin(izinler=["admin_roles.view"])

    r = await http.get("/api/v1/admin/access/permissions", headers=baslik)

    assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
    kodlar = {p["code"] for p in r.json()}
    assert {OPS_VIEW, OPS_MANAGE} <= kodlar, (
        f"Yeni izinler `admin_permissions` tablosunda yok: {sorted(kodlar)}"
    )


# ═════════════ E · Admin iade filtresi enum sözleşmesi (TB-14/1) ════════════


async def test_E1_gecersiz_refund_status_422(ip4, http):
    """Yanlış yazılmış filtre BOŞ LİSTE değil 422 döner.

    Bugünkü davranış operasyonel yanılgı üretiyor: yönetici "iade kuyruğu boş"
    sanıyor ve bekleyen iade gözden kaçıyor (TB-14 #1, öncelik 1).
    """
    _admin_id, baslik = await ip4.admin(izinler=["returns.view"])

    r = await http.get(RETURNS, params={"refund_status": "MANUEL_INCELEME"}, headers=baslik)

    assert r.status_code == 422, (
        f"Geçersiz `refund_status` {r.status_code} döndü (beklenen 422). "
        f"Gövde: {r.text[:200]}"
    )


async def test_E1_gecersiz_status_de_422(ip4, http):
    """Aynı sınıf tuzak aynı çağrının ikinci filtresinde de var.

    Matrise İP-4 turunda EKLENDİ (TB-14 #1 yalnız `refund_status`'ı adlandırıyor).
    Gerekçe: düzeltilmiş bir tuzağın yanına aynısını korumasız bırakmak, bir
    sonraki yöneticinin aynı yanılgıyı `status` üzerinden yaşamasıdır.
    """
    _admin_id, baslik = await ip4.admin(izinler=["returns.view"])

    r = await http.get(RETURNS, params={"status": "BEKLIYOR"}, headers=baslik)

    assert r.status_code == 422, f"{r.status_code}: {r.text[:200]}"


async def test_E2_gecerli_deger_filtreli_liste_donuyor(ip4, http):
    """Sözleşmenin ikinci yarısı: geçerli enum değeri ÇALIŞMAYA devam eder."""
    _sip, sikisik = await _sikismis_iadeli_siparis(
        ip4, refund_status="MANUAL_REVIEW", refund_attempts=3
    )
    pid = await ip4.urun(price="60.00", stock=4)
    musteri_id, _ = await ip4.musteri()
    sip2 = await ip4.siparis(items=[(pid, 1)], client_id=musteri_id)
    normal = await ip4.iade_tohumla(
        order_id=sip2.order_id,
        client_id=musteri_id,
        items=[(sip2.item_ids[0], 1, "60.00")],
        refund_amount="60.00",
    )
    _admin_id, baslik = await ip4.admin(izinler=["returns.view"])

    r = await http.get(
        RETURNS, params={"refund_status": "MANUAL_REVIEW"}, headers=baslik
    )

    assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
    kimlikler = {k["id"] for k in r.json()}
    assert sikisik in kimlikler, "MANUAL_REVIEW kuyruğu kendi kaydını getirmedi."
    assert normal not in kimlikler, "Filtre uygulanmadı; ilgisiz kayıt döndü."


# ═════════════ A-6 · Eğitmen reddi gerekçesiz yapılamaz ═════════════════════


async def test_A6_gerekcesiz_red_422(ip4, http):
    """Red kararı gerekçesiz denetim izine yazılamaz.

    Denetim raporu eksik akış 6: "Eğitmen red gerekçesini göremiyor (admin de
    girmiyor)". Gerekçeyi ZORUNLU kılmak bu boşluğun kaynağını kapatır.
    """
    tutor_id = await ip4.egitmen()
    _admin_id, baslik = await ip4.admin(izinler=["tutors.manage"])

    r = await http.post(f"/api/v1/admin/tutors/{tutor_id}/reject", headers=baslik)

    assert r.status_code == 422, (
        f"Gerekçesiz red {r.status_code} ile GEÇTİ: {r.text[:200]}"
    )
    assert await ip4.egitmen_durumu(tutor_id) == "PENDING_APPROVAL", (
        "Durum gerekçesiz değişti."
    )


async def test_A6_gerekce_audit_izine_yaziliyor(ip4, http):
    tutor_id = await ip4.egitmen()
    admin_id, baslik = await ip4.admin(izinler=["tutors.manage"])

    r = await http.post(
        f"/api/v1/admin/tutors/{tutor_id}/reject",
        json={"reason": "Diploma barkodu e-Devlet'te doğrulanamadı."},
        headers=baslik,
    )

    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    assert await ip4.egitmen_durumu(tutor_id) == "REJECTED"
    kayit = await ip4.audit_kaydi(action="tutor.reject", target_id=tutor_id)
    assert kayit is not None, "Red kararı denetim izine hiç yazılmadı."
    assert kayit["actor_id"] == admin_id
    assert "e-Devlet" in (kayit["reason"] or "") + (kayit["details"] or ""), (
        f"Gerekçe denetim izinde yok: {kayit}"
    )


async def test_A6_cok_kisa_gerekce_reddedilir(ip4, http):
    """Zorunluluk 'tek karakter yaz geç'e indirgenmemeli."""
    tutor_id = await ip4.egitmen()
    _admin_id, baslik = await ip4.admin(izinler=["tutors.manage"])

    r = await http.post(
        f"/api/v1/admin/tutors/{tutor_id}/reject",
        json={"reason": "  "},
        headers=baslik,
    )

    assert r.status_code == 422, f"{r.status_code}: {r.text[:200]}"
