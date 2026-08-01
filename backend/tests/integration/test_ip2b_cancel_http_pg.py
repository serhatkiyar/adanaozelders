"""İP-2b — sipariş iptali: GERÇEK HTTP + gerçek yetki çözümü (PG).

Sözleşme: docs/ip2b-siparis-iptal-telafi-sozlesme.md

KIRMIZI testler bugünkü üretim davranışındaki doğrulanmış boşlukları ölçer ve
üretim düzeltmesi gelene dek KIRMIZI kalmaları beklenir:
- [IP2B-R1] sahiplik ihlalinde 403 varlık sızıntısı (sözleşme: 404),
- [IP2B-R2] admin sipariş iptal ucunun yokluğu (+ R2b: gerekçe zorunluluğu),
- [IP2B-R3] admin iadesinde zorunlu gerekçe + audit reason,
- [IP2B-R4] DELIVERED siparişin admin refund ucuyla RMA atlanarak kapatılması.

YEŞİL nöbetçiler meşru davranışı çiviler; kırılmaları regresyondur.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal

# pg/provider/fab/http/sms_kayit fixture'ları conftest üzerinden çözülür.
from tests.integration.ip2b_factory import admin_headers, client_headers  # noqa: F401

pytestmark = pytest.mark.asyncio

CANCEL = "/api/v1/store/orders/{oid}/cancel"
ADMIN_REFUND = "/api/v1/store/admin/orders/{oid}/refund"
ADMIN_CANCEL = "/api/v1/store/admin/orders/{oid}/cancel"


# ── Yeşil nöbetçiler: müşteri iptali ─────────────────────────────────────────────


async def test_yesil_odenmemis_iptal(fab, http, provider):
    """PENDING sipariş: iptal 200; sağlayıcıya GİDİLMEZ; stok hareketi yok;
    history changed_by='client'; müşteri bildirimi tam bir kez."""
    pid = await fab.urun(stock=5)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(
        items=[(pid, 2, "PHYSICAL", "100.00")],
        client_id=cid, status="PENDING", payment_status="PENDING",
    )

    r = await http.post(CANCEL.format(oid=oid), headers=client_headers(cid))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "CANCELLED"

    assert provider.refund_calls == []          # ödenmemişte para hareketi yasak
    assert await fab.hareketler(pid) == [("INITIAL", 5)]  # SALE yoktu → telafi de yok
    assert await fab.siparis_durumu(oid) == ("CANCELLED", "PENDING")
    assert await fab.history(oid) == [("PENDING", "CANCELLED", "client")]
    assert await fab.bildirim_sayisi(cid, icerik="iptal edildi") == 1


async def test_yesil_odenmis_iptal_tam_telafi(fab, http, provider):
    """PAID+kuponlu sipariş: iptal 200; tek sağlayıcı iadesi; SALE_CANCEL tam ve
    tek; kupon kotası geri; REFUNDED e-postası outbox'ta tam bir kez."""
    pid = await fab.urun(stock=10)
    cid = await fab.musteri()
    kupon = await fab.kupon(value="50.00")
    oid, _ = await fab.siparis(
        items=[(pid, 3, "PHYSICAL", "100.00")],
        client_id=cid, coupon=kupon, discount="50.00",
    )
    await fab.kupon_kullanimi(coupon_id=kupon[0], client_id=cid, order_id=oid)

    r = await http.post(CANCEL.format(oid=oid), headers=client_headers(cid))
    assert r.status_code == 200, r.text

    assert len(provider.refund_calls) == 1
    assert str(provider.refund_calls[0][1]) == "250.00"  # total = 300 - 50
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 3)]
    assert await fab.stok(pid) == 10
    assert await fab.kupon_durumu(kupon[0]) == (0, 0)
    assert await fab.siparis_durumu(oid) == ("CANCELLED", "REFUNDED")
    olaylar = await fab.outbox_olaylari(oid)
    assert olaylar.count(("email:order_status", "PENDING")) + olaylar.count(
        ("email:order_status", "SENT")
    ) == 1
    assert await fab.bildirim_sayisi(cid, icerik="iptal edildi") == 1


async def test_yesil_tekrarlanan_iptal_yan_etkisiz(fab, http, provider):
    """Duplicate iptal: 409; ikinci sağlayıcı çağrısı, ikinci SALE_CANCEL,
    ikinci bildirim YOK (idempotent sonuç — sözleşme §5.4)."""
    pid = await fab.urun(stock=8)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(items=[(pid, 2, "PHYSICAL", "100.00")], client_id=cid)

    r1 = await http.post(CANCEL.format(oid=oid), headers=client_headers(cid))
    assert r1.status_code == 200, r1.text
    r2 = await http.post(CANCEL.format(oid=oid), headers=client_headers(cid))
    assert r2.status_code == 409

    assert len(provider.refund_calls) == 1
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 2)]
    assert await fab.bildirim_sayisi(cid, icerik="iptal edildi") == 1
    # Tek CANCELLED geçmiş satırı — ikinci istek geçmişe yazmadı.
    gecmis = await fab.history(oid)
    assert [h for h in gecmis if h[1] == "CANCELLED"] == [("PAID", "CANCELLED", "client")]


async def test_yesil_auth_reddi(fab, http, provider):
    """Token'sız 401; yanlış rol (ADMIN cameo değil — düz CLIENT ucu) 403.
    Her iki durumda da sipariş değişmez."""
    pid = await fab.urun(stock=3)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], client_id=cid)

    r = await http.post(CANCEL.format(oid=oid))
    assert r.status_code == 401
    _aid, admin_hdr = await fab.admin_izinli(["orders.manage"])
    r = await http.post(CANCEL.format(oid=oid), headers=admin_hdr)
    assert r.status_code == 403

    assert await fab.siparis_durumu(oid) == ("PAID", "PAID")
    assert provider.refund_calls == []


async def test_yesil_teslim_edilmis_iptal_yerine_iade_yolu(fab, http, provider):
    """DELIVERED sipariş müşteri iptal ucundan GEÇEMEZ: 409 + iade talebine
    yönlendirme; hiçbir para/stok hareketi olmaz (İP-2a sınırı korunur)."""
    pid = await fab.urun(stock=4)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")], client_id=cid, status="DELIVERED"
    )

    r = await http.post(CANCEL.format(oid=oid), headers=client_headers(cid))
    assert r.status_code == 409
    assert "iade" in r.json()["detail"].lower()
    assert provider.refund_calls == []
    assert await fab.hareketler(pid, "SALE_CANCEL") == []
    assert await fab.siparis_durumu(oid) == ("DELIVERED", "PAID")


# ── Kırmızı: varlık sızıntısı ────────────────────────────────────────────────────


async def test_kirmizi_baskasinin_siparisi_varlik_sizdirmaz(fab, http, provider):
    """[IP2B-R1] Yabancı müşteri, siparişin VARLIĞINI öğrenmemeli: sözleşme 404.

    Bugünkü davranış 403 'Sizin siparişiniz değil' — geçerli sipariş ID'sini
    (404 dönen rastgele ID'lerin aksine) doğrular, ID uzayı taranabilir.
    Kurye tarafında aynı sınıf IDOR 404'e çekilmişti; sipariş ucu geride kaldı.
    """
    pid = await fab.urun(stock=3)
    sahip = await fab.musteri()
    yabanci = await fab.musteri()
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], client_id=sahip)

    r = await http.post(CANCEL.format(oid=oid), headers=client_headers(yabanci))
    assert r.status_code == 404, (
        f"varlık sızıntısı: yabancıya {r.status_code} döndü ({r.json()['detail']!r}); "
        "sözleşme olmayan siparişle AYNI yanıtı (404) ister"
    )
    # Yan etki yok — hangi kod dönerse dönsün sipariş değişmemeli.
    assert await fab.siparis_durumu(oid) == ("PAID", "PAID")
    assert provider.refund_calls == []


# ── Admin uçları ────────────────────────────────────────────────────────────────


async def test_yesil_admin_refund_yetkili_ve_auditli(fab, http, provider):
    """orders.manage izinli admin PAID siparişi iade edebilir; audit satırı
    action='order.refund' ile yazılır; stok telafisi tam."""
    pid = await fab.urun(stock=6)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(items=[(pid, 2, "PHYSICAL", "100.00")], client_id=cid)
    aid, hdr = await fab.admin_izinli(["orders.manage"])

    r = await http.post(ADMIN_REFUND.format(oid=oid), headers=hdr)
    assert r.status_code == 200, r.text
    assert await fab.siparis_durumu(oid) == ("REFUNDED", "REFUNDED")
    assert len(provider.refund_calls) == 1
    assert await fab.hareketler(pid, "SALE_CANCEL") == [("SALE_CANCEL", 2)]
    kayitlar = await fab.audit_kayitlari(action="order.refund", target_id=oid)
    assert [k[0] for k in kayitlar] == [aid]


async def test_yesil_eksik_izinli_admin_reddedilir(fab, http, provider):
    """orders.view (salt görüntüleme) izinli admin refund'da 403 alır; sipariş
    ve para değişmez."""
    pid = await fab.urun(stock=6)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(items=[(pid, 2, "PHYSICAL", "100.00")], client_id=cid)
    _aid, hdr = await fab.admin_izinli(["orders.view"])

    r = await http.post(ADMIN_REFUND.format(oid=oid), headers=hdr)
    assert r.status_code == 403
    assert await fab.siparis_durumu(oid) == ("PAID", "PAID")
    assert provider.refund_calls == []
    assert await fab.hareketler(pid, "SALE_CANCEL") == []


async def test_kirmizi_admin_iptal_ucu_gerekceli_calismali(fab, http, provider):
    """[IP2B-R2] Yetkili admin, ödenmemiş bir siparişi ZORUNLU gerekçeyle iptal
    edebilmeli (booking tarafındaki /admin/bookings/{id}/cancel eşdeğeri).

    Bugün `/store/admin/orders/{id}/cancel` ucu YOKTUR (404) — admin, müşteri
    adına ödenmemiş/sorunlu siparişi kapatamaz; tek aracı PAID şartlı refund'dır.

    Uç eklendiğinde 200 dönmesi YETMEZ; sözleşme aksiyonun izlenebilir ve yan
    etkisiz olmasını da ister (yoksa 'ucu ekledim' diye yazılan bir stub bu
    testi yeşillendirirdi):
      • gerekçe `audit_logs.reason`'a YAZILIR (admin.refund'daki R3 kusuru
        burada tekrarlanmasın),
      • `order_status_history.changed_by == 'admin'` (aktör 'client' değil),
      • ödenmemiş siparişte sağlayıcıya GİDİLMEZ, stok telafisi yazılmaz,
      • müşteri iptal bildirimi tam bir kez üretilir.
    """
    GEREKCE = "Müşteri telefonla iptal istedi"
    pid = await fab.urun(stock=3)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")],
        client_id=cid, status="PENDING", payment_status="PENDING",
    )
    aid, hdr = await fab.admin_izinli(["orders.manage"])

    r = await http.post(
        ADMIN_CANCEL.format(oid=oid), headers=hdr, json={"reason": GEREKCE},
    )
    assert r.status_code == 200, (
        f"admin sipariş iptal ucu yok/çalışmıyor: {r.status_code}"
    )
    assert await fab.siparis_durumu(oid) == ("CANCELLED", "PENDING")
    assert await fab.history(oid) == [("PENDING", "CANCELLED", "admin")], (
        "iptalin aktörü geçmişe 'admin' olarak yazılmadı"
    )
    kayitlar = await fab.audit_kayitlari(action="order.cancel", target_id=oid)
    assert [k[0] for k in kayitlar] == [aid], (
        "admin iptali audit_logs'a (action='order.cancel') tam bir kez yazılmalı"
    )
    assert kayitlar[0][1] == GEREKCE, (
        f"audit reason gerekçeyi taşımıyor: {kayitlar[0][1]!r}"
    )
    assert provider.refund_calls == [], "ödenmemiş siparişte para hareketi yasak"
    assert await fab.hareketler(pid, "SALE_CANCEL") == []
    assert await fab.bildirim_sayisi(cid, icerik="iptal edildi") == 1


async def test_kirmizi_admin_iptal_gerekcesiz_reddedilmeli(fab, http, provider):
    """[IP2B-R2b] Admin iptali gerekçesiz KABUL EDİLMEMELİ.

    R2'nin kendisi gövdede `reason` GÖNDERİR; bu, alanın zorunlu olduğunu
    kanıtlamaz — `reason` opsiyonel (hatta hiç okunmayan) bir alan olarak
    eklenirse R2 yeşile döner ve 'gerekçesiz admin iptali' kusuru sessizce
    üretime girer. Zorunluluğu ölçen tek şey, gerekçesiz isteğin REDDİDİR.

    Boş dizgi/yalnız boşluk da gerekçe sayılmaz (aksi hâlde zorunluluk tek bir
    boşluk karakteriyle atlatılır).

    Bugün uç yok → 404 → kırmızı; uç gerekçesiz kabul ederse de kırmızı kalır.
    """
    pid = await fab.urun(stock=3)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(
        items=[(pid, 1, "PHYSICAL", "100.00")],
        client_id=cid, status="PENDING", payment_status="PENDING",
    )
    _aid, hdr = await fab.admin_izinli(["orders.manage"])

    for govde, etiket in (({}, "gövdesiz"), ({"reason": "   "}, "boş gerekçe")):
        r = await http.post(ADMIN_CANCEL.format(oid=oid), headers=hdr, json=govde)
        assert r.status_code in (400, 422), (
            f"{etiket} admin iptali {r.status_code} ile karşılandı; sözleşme "
            "doğrulama reddi (400/422) ister — gerekçe zorunlu olmalı"
        )
    # Reddedilen istek hiçbir iz bırakmamalı.
    assert await fab.siparis_durumu(oid) == ("PENDING", "PENDING")
    assert await fab.history(oid) == []
    assert await fab.audit_kayitlari(action="order.cancel", target_id=oid) == []
    assert provider.refund_calls == []


async def test_kirmizi_admin_refund_gerekce_ve_audit_reason(fab, http, provider):
    """[IP2B-R3] Admin iadesi para hareketi başlatan kritik aksiyondur: zorunlu
    gerekçe alması ve audit satırının `reason` kolonuna yazması gerekir.

    Bugün uç gövdesizdir; audit satırı yazılır ama reason=NULL kalır — 'bu
    iade neden yapıldı' sorusunun yapısal cevabı yoktur.
    """
    pid = await fab.urun(stock=6)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(items=[(pid, 2, "PHYSICAL", "100.00")], client_id=cid)
    _aid, hdr = await fab.admin_izinli(["orders.manage"])

    r = await http.post(
        ADMIN_REFUND.format(oid=oid), headers=hdr,
        json={"reason": "Kargo hasarlı ulaştı, müşteri araması"},
    )
    assert r.status_code == 200, r.text
    kayitlar = await fab.audit_kayitlari(action="order.refund", target_id=oid)
    assert kayitlar, "audit satırı hiç yazılmadı"
    assert kayitlar[0][1], (
        "audit reason boş: admin iadesi gerekçesiz kaydediliyor "
        "(sözleşme: zorunlu gerekçe + audit_logs.reason dolu)"
    )


async def test_kirmizi_delivered_admin_refund_rma_atlanamaz(fab, http, provider):
    """[IP2B-R4] Teslim edilmiş sipariş iptal/iade UÇLARIYLA geriye alınmamalı;
    İP-2a iade (RMA) yoluna gitmelidir.

    Bugün `refund_order` yalnız payment_status'a bakar: DELIVERED sipariş tek
    çağrıyla REFUNDED olur ve kitap MÜŞTERİDEYKEN SALEABLE kovaya kör
    `SALE_CANCEL` yazılır (defter fiziksel gerçekle ayrışır; telafi yalnız
    sonraki sayımın STALE işaretidir).
    """
    pid = await fab.urun(stock=4)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(
        items=[(pid, 2, "PHYSICAL", "100.00")], client_id=cid, status="DELIVERED"
    )
    _aid, hdr = await fab.admin_izinli(["orders.manage"])

    r = await http.post(ADMIN_REFUND.format(oid=oid), headers=hdr)
    assert r.status_code == 409, (
        f"DELIVERED siparişte doğrudan tam iade kabul edildi ({r.status_code}); "
        "sözleşme RMA yoluna yönlendirme (409) ister"
    )
    assert await fab.hareketler(pid, "SALE_CANCEL") == [], (
        "kitap müşterideyken satılabilir stok artırıldı"
    )
    assert await fab.siparis_durumu(oid) == ("DELIVERED", "PAID")


async def test_kirmizi_orm_dogrudan_terminal_yazim_reddedilmeli(fab, provider):
    """[IP2B-R5] FSM'i atlayan doğrudan `orders.status` yazımı para/stok yolunu
    sessizce atlar: PAID sipariş ham UPDATE ile CANCELLED yapılırsa sağlayıcı
    iadesi, SALE_CANCEL ve geçmiş satırı ÜRETİLMEZ — para müşteride kalmış gibi,
    stok satılmış gibi görünürken sipariş 'iptal' görünür.

    Sözleşme: `stock_movements`'ın append-only trigger'ı gibi, `orders.status`
    terminal geçişleri de DB seviyesinde FSM dışı yazıma KAPALI olmalı
    (geçmiş satırı olmayan CANCELLED/REFUNDED yazımı reddedilmeli). Bugün hiçbir
    DB guard'ı yoktur; ham UPDATE sessizce başarılıdır → test kırmızı.
    """
    from sqlalchemy.exc import DBAPIError

    pid = await fab.urun(stock=2)
    cid = await fab.musteri()
    oid, _ = await fab.siparis(items=[(pid, 1, "PHYSICAL", "100.00")], client_id=cid)

    reddedildi = False
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE orders SET status = 'CANCELLED' WHERE id = :o"),
                {"o": oid},
            )
            await s.commit()
    except DBAPIError:
        reddedildi = True

    assert reddedildi, (
        "FSM dışı ham UPDATE ile PAID→CANCELLED yazımı DB tarafından kabul "
        "edildi; para (iade yok) + stok (SALE_CANCEL yok) + audit (geçmiş yok) "
        "yolunun tamamı sessizce atlandı"
    )
