"""İP-2a · Admin iade karar akışı — GERÇEK FastAPI HTTP + GERÇEK PostgreSQL.

Sözleşme: docs/ip2a-magaza-iade-sozlesme.md (§2 A1/A2/D1; §3 İP2A-08/12/13/17).

Bu dosya iade uçlarının HTTP katmanını İLK KEZ test eder (mevcut suite'te
hiç yoktu): gerçek token, gerçek `require_admin_permission` çözümü, gerçek
dependency zinciri, gerçek transaction sınırı. Taşıyıcı `httpx.ASGITransport`
— uygulama testin event loop'unda koşar. KIRMIZI testler ``KNOWN-RED``
işaretlidir ve bugün FAIL etmeleri beklenir.
"""
from __future__ import annotations

from decimal import Decimal

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import MissingGreenlet

from core.database import AsyncSessionLocal
from tests.integration.ip2a_factory import IadeFabrikasi

KOK = "/api/v1/store"


async def _post_500e_tolere(client, url: str, **kw) -> int:
    """POST at; uygulama içi çökme (İP2A-18 MissingGreenlet) durumunda 500 say.

    Gerçek sunucuda starlette bu istisnayı 500 yanıtına çevirir;
    `ASGITransport` ise istisnayı test sürecine yükseltir — ikisi aynı üretim
    davranışıdır, testler onu HTTP 500 olarak ölçer.
    """
    try:
        yanit = await client.post(url, **kw)
        return yanit.status_code
    except MissingGreenlet:
        return 500


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def fab(pg):
    f = IadeFabrikasi()
    try:
        yield f
    finally:
        await f.temizle()


async def _musteri_talebi(
    client, fab, sip, headers, *, tip: str = "AYIPLI", items=None
) -> httpx.Response:
    govde = {
        "type": tip,
        "reason": "" if tip == "CAYMA" else "kapak yirtik geldi",
        "items": items or [],
    }
    return await client.post(
        f"{KOK}/orders/{sip.order_id}/return", json=govde, headers=headers
    )


async def _audit_toplam_order_return(return_id: int) -> int:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text(
                    "SELECT count(*) FROM audit_logs "
                    "WHERE target_type = 'order_return' AND target_id = :i"
                ),
                {"i": return_id},
            )
        ).scalar_one()


# ── YEŞİL NÖBETÇİLER ─────────────────────────────────────────────────────────


async def test_g10_gecerli_tam_iade_uctan_uca(fab, provider, client):
    """G-10: Geçerli tam iade gerçek HTTP'de uçtan uca çalışır — müşteri CAYMA
    talebi 201 döner (otomatik onay), para + stok + sipariş bütünlüğü tamamlanır
    ve `returns.view` izinli admin talebi listede görür.

    (AYIPLI onayının admin-HTTP yolu bugün İP2A-18 yüzünden 500'dür — R-18.)
    """
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid)
    r = await _musteri_talebi(client, fab, sip, chead, tip="CAYMA")
    assert r.status_code == 201, r.text
    govde = r.json()
    rid = govde["id"]
    assert govde["status"] == "APPROVED"
    assert govde["refund_status"] == "REFUNDED"

    assert len(provider.refund_calls) == 1
    assert provider.refund_calls[0][1] == sip.total
    # PK-α: para iadesi stok üretmez; mal ancak depo kabulüyle döner.
    assert await fab.hareketler(pid, "RETURN") == []
    o = await fab.siparis_satiri(sip.order_id)
    assert o["payment_status"] == "REFUNDED"
    assert o["refunded_amount"] == sip.total
    assert await fab.bildirim_sayisi(cid, icinde="iade edildi") == 1

    # Depo kabulü de GERÇEK HTTP ucundan geçer (yetki + gövde doğrulaması dahil).
    _, mhead = await fab.admin(izinler=["returns.view", "returns.manage"])
    kalemler = await fab.iade_kalemleri(rid)
    kabul = await client.post(
        f"{KOK}/admin/returns/{rid}/receive",
        json={
            "lines": [
                {
                    "return_item_id": k["id"],
                    "accepted_quantity": k["quantity"],
                    "damaged_quantity": 0,
                }
                for k in kalemler
            ]
        },
        headers=mhead,
    )
    assert kabul.status_code == 200, kabul.text
    assert kabul.json()["received_at"] is not None
    assert len(await fab.hareketler(pid, "RETURN")) == 1
    assert await fab.stok(pid) == 10

    _, ahead = await fab.admin(izinler=["returns.view"])
    liste = await client.get(f"{KOK}/admin/returns", headers=ahead)
    assert liste.status_code == 200
    assert any(x["id"] == rid for x in liste.json()), (
        "tamamlanan iade returns.view listesinde görünmeli"
    )


async def test_r18_ayipli_onayin_basarili_yolu_500_vermeden_tamamlanmali(
    fab, provider, client
):
    """R-18 · İP2A-18: yetkili adminin AYIPLI iade onayı 500 vermeden tamamlanır
    ve **para emri çıktıysa bütün zorunlu yan etkiler de tamamlanır**.

    Kusur (bu checkpoint'in bulduğu üretim hatası): sağlayıcıdan para
    İSTENDİKTEN sonra `_restock_items`, `_lock_order`'ın refresh'iyle expire
    olmuş `ret.items` koleksiyonuna dokunuyor → async oturumda lazy-load →
    `MissingGreenlet` → HTTP 500. Para çıkmış, stok dönmemiş, talep
    REFUNDING'de sarkık, müşteri habersiz; İP2A-02 ile birleşince reconciler
    da kurtaramıyordu.

    ## Bu test neden genişletildi (bağımsız denetimin P2-2 borcu)

    Tarihsel hâli YALNIZ `kod == 200` ölçüyordu. 200 dönen ama parayı yarım
    bırakan bir uygulama da o testi geçerdi — yani nöbetçi, düzeltmenin
    kanıtı değildi. Artık para emrinin bütün sonuçları tek tek ölçülüyor.
    """
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid)
    r = await _musteri_talebi(client, fab, sip, chead, tip="AYIPLI")
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert provider.refund_calls == [], "ön koşul: AYIPLI talep para çıkarmaz"

    _, ahead = await fab.admin(izinler=["returns.view", "returns.manage"])
    kod = await _post_500e_tolere(
        client,
        f"{KOK}/admin/returns/{rid}/approve",
        json={"admin_note": "uygun"},
        headers=ahead,
    )

    assert kod == 200, (
        f"KNOWN-RED(İP2A-18): AYIPLI onayının başarılı yolu {kod} döndü — "
        "sağlayıcıya para emri verildikten sonra süreç çöküyor "
        f"(provider çağrısı: {len(provider.refund_calls)}); stok geri konmadı, "
        "talep REFUNDING'de sarkık kaldı"
    )

    # ── Para emri TAM BİR KEZ ve doğru referansla çıktı ──
    assert len(provider.refund_calls) == 1
    ref, tutar = provider.refund_calls[0]
    assert tutar == sip.total
    talep = (await fab.iade_satirlari(sip.order_id))[0]
    assert ref == talep["provider_ref"] and ref is not None, (
        "sağlayıcıya talebin KENDİ referansı gitmeli (İP2A-02)"
    )

    # ── Para emri çıktıysa finalize de tamamlandı ──
    assert talep["status"] == "APPROVED"
    assert talep["refund_status"] == "REFUNDED"
    o = await fab.siparis_satiri(sip.order_id)
    assert o["refunded_amount"] == sip.total
    assert o["payment_status"] == "REFUNDED"
    assert o["status"] == "REFUNDED"

    # ── Bildirim + audit ──
    assert await fab.bildirim_sayisi(cid, icinde="iade") == 1
    assert await fab.audit_sayisi(
        action="return.approve", target_type="order_return", target_id=rid
    ) == 1

    # ── PK-α: para yolu stok üretmez; kabul üretir ve TEKRARLAMAZ ──
    assert await fab.hareketler(pid, "RETURN") == []
    await fab.teslim_al(rid)
    assert len(await fab.hareketler(pid, "RETURN")) == 1
    await fab.teslim_al(rid)
    assert len(await fab.hareketler(pid, "RETURN")) == 1

    # ── Retry ikinci para emri üretmez ──
    tekrar = await client.post(
        f"{KOK}/admin/returns/{rid}/approve",
        json={"admin_note": "yine"},
        headers=ahead,
    )
    assert tekrar.status_code == 409
    assert len(provider.refund_calls) == 1
    assert await fab.bildirim_sayisi(cid, icinde="iade") == 1


async def test_g11_eksik_izinli_admin_reddedilir(fab, provider, client):
    """G-11: Yalnız `returns.view` izni olan admin onaylayamaz/reddedemez (403);
    hiçbir yan etki oluşmaz."""
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid)
    r = await _musteri_talebi(client, fab, sip, chead)
    rid = r.json()["id"]

    _, view_head = await fab.admin(izinler=["returns.view"])
    for uc in ("approve", "reject"):
        yanit = await client.post(
            f"{KOK}/admin/returns/{rid}/{uc}",
            json={"admin_note": "x"},
            headers=view_head,
        )
        assert yanit.status_code == 403, (
            f"returns.manage'sız admin {uc} çağırabildi: {yanit.status_code}"
        )
    assert provider.refund_calls == []
    assert (await fab.iade_satirlari(sip.order_id))[0]["status"] == "PENDING"
    # view izni listeyi görebilir (izin ayrımının pozitif yarısı).
    liste = await client.get(f"{KOK}/admin/returns", headers=view_head)
    assert liste.status_code == 200


async def test_g12_musteri_tokeni_ve_anonim_admin_uclarina_giremez(
    fab, provider, client
):
    """G-12: CLIENT token'ı admin iade uçlarında 403, token'sız istek 401 alır."""
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid)
    r = await _musteri_talebi(client, fab, sip, chead)
    rid = r.json()["id"]

    yanit = await client.get(f"{KOK}/admin/returns", headers=chead)
    assert yanit.status_code == 403
    yanit = await client.post(
        f"{KOK}/admin/returns/{rid}/approve", json={}, headers=chead
    )
    assert yanit.status_code == 403
    yanit = await client.post(f"{KOK}/admin/returns/{rid}/approve", json={})
    assert yanit.status_code == 401
    assert provider.refund_calls == []


async def test_g13_terminal_talep_tekrar_karara_baglanamaz(fab, provider, client):
    """G-13: REJECTED talebe ikinci approve/reject 409'dur; ikinci audit,
    bildirim ve para hareketi oluşmaz."""
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid)
    r = await _musteri_talebi(client, fab, sip, chead)
    rid = r.json()["id"]

    _, ahead = await fab.admin(izinler=["returns.view", "returns.manage"])
    r1 = await client.post(
        f"{KOK}/admin/returns/{rid}/reject",
        json={"admin_note": "kanıt yetersiz"},
        headers=ahead,
    )
    assert r1.status_code == 200

    for uc in ("approve", "reject"):
        tekrar = await client.post(
            f"{KOK}/admin/returns/{rid}/{uc}", json={}, headers=ahead
        )
        assert tekrar.status_code == 409, f"terminal talebe {uc} kabul edildi"

    assert provider.refund_calls == []
    assert await fab.hareketler(pid, "RETURN") == []
    assert await fab.audit_sayisi(
        action="return.reject", target_type="order_return", target_id=rid
    ) == 1, "yalnız ilk karar audit'e yazılmalı"
    assert await fab.bildirim_sayisi(cid, icinde="reddedildi") == 1, (
        "müşteri ret kararı için tam bir kez bilgilendirilmeli"
    )


# ── KIRMIZI KABUL TESTLERİ ───────────────────────────────────────────────────


async def test_r08a_cayma_otomatik_onayi_audit_izi_birakmali(fab, provider, client):
    """R-08a · KNOWN-RED(İP2A-08): CAYMA talebi admin'siz otomatik onaylanır ve
    parayı ANINDA iade eder — para hareketi üreten bu karar audit izine sahip
    olmalıdır.

    Bugün: audit yalnız router'ın admin uçlarında yazılır; müşteri ucundaki
    otomatik onay (`request_return` → `_settle_return`) hiçbir `audit_logs`
    satırı üretmez. Para çıkışının 'kim/ne zaman/hangi kararla' izi yoktur.
    """
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid)
    r = await _musteri_talebi(client, fab, sip, chead, tip="CAYMA")
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert len(provider.refund_calls) == 1  # ön koşul: para gerçekten çıktı

    assert await _audit_toplam_order_return(rid) >= 1, (
        "KNOWN-RED(İP2A-08): CAYMA otomatik onayı sağlayıcıya para emri verdi "
        "ama audit_logs'ta tek satır yok — para hareketi üreten karar izsiz"
    )


async def test_r08b_saglayici_reddinde_admin_karari_audit_kaybolmamali(
    fab, provider, client
):
    """R-08b · KNOWN-RED(İP2A-08): sağlayıcı 502'sinde admin onay kararı
    audit'e yazılmalıdır — talep APPROVED+REFUNDING olarak COMMIT edilmiştir.

    Bugün: router audit'i handler başarısından SONRA yazar; `_settle_return`
    502 fırlatınca satıra hiç ulaşılmaz. DB'de durum değişmiş ('kim onayladı'
    sorusunun cevabı yok), reconciler parayı sonradan gönderecek.
    """
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid)
    r = await _musteri_talebi(client, fab, sip, chead)
    rid = r.json()["id"]

    provider.refund_result = False
    _, ahead = await fab.admin(izinler=["returns.view", "returns.manage"])
    yanit = await client.post(
        f"{KOK}/admin/returns/{rid}/approve",
        json={"admin_note": "uygun"},
        headers=ahead,
    )
    assert yanit.status_code == 502  # ön koşul: sağlayıcı reddi
    satir = (await fab.iade_satirlari(sip.order_id))[0]
    assert satir["status"] == "APPROVED", "ön koşul: karar DB'ye işlendi"
    assert satir["refund_status"] == "REFUNDING"

    assert await _audit_toplam_order_return(rid) >= 1, (
        "KNOWN-RED(İP2A-08): talep APPROVED+REFUNDING olarak commit'lendi ama "
        "502 yüzünden audit satırı hiç yazılmadı — durumu değiştiren admin "
        "kararı izsiz kaldı"
    )


async def test_r12_returns_yetkisi_olmayan_admin_teslim_edilmis_siparisi_iade_edememeli(
    fab, provider, client
):
    """R-12 · KNOWN-RED(İP2A-12): `returns.manage` verilmemiş bir admin, RMA
    kuyruğunu atlayarak TESLİM EDİLMİŞ siparişin parasını iade edememelidir.

    Bugün: `/admin/orders/{id}/refund` yalnız `orders.manage` ister ve
    DELIVERED sipariş için de tam iade yürütür — iade izin ayrımı
    (`returns.view/manage`) bu uç yüzünden fiilen etkisizdir (görev ayrılığı
    deliği; politika ayrıntısı sözleşme PK-γ).
    """
    pid = await fab.urun(stock=10)
    sip = await fab.siparis(items=[(pid, 2)])  # DELIVERED
    _, ahead = await fab.admin(izinler=["orders.view", "orders.manage"])

    # Gövde ZORUNLUDUR (İP-2b R3: gerekçesiz para hareketi yok). Tarihsel test
    # gövdesiz POST atıyordu ve 422 ölçüyordu — yani görev ayrılığı iddiası
    # HİÇ SINANMIYORDU. Gerekçe verilerek uç gerçekten çalıştırılır.
    yanit = await client.post(
        f"{KOK}/admin/orders/{sip.order_id}/refund",
        json={"reason": "musteri talebi"},
        headers=ahead,
    )

    assert yanit.status_code in (403, 409), (
        f"KNOWN-RED(İP2A-12): returns.manage'sız admin teslim edilmiş siparişi "
        f"{yanit.status_code} ile komple iade etti — RMA süreci ve iade izin "
        "ayrımı tek uçla atlanabiliyor"
    )
    assert provider.refund_calls == [], (
        "KNOWN-RED(İP2A-12): yetkisiz yoldan sağlayıcıya para emri gitti"
    )
    # Hiçbir yan etki: para, stok ve durum dokunulmamış olmalı.
    o = await fab.siparis_satiri(sip.order_id)
    assert (o["status"], o["payment_status"]) == ("DELIVERED", "PAID")
    assert o["refunded_amount"] == Decimal("0.00")
    assert await fab.hareketler(pid, "RETURN") == []
    assert await fab.hareketler(pid, "SALE_CANCEL") == []


async def test_r13_onay_musteriye_tek_bildirim_uretmeli(fab, provider, client):
    """R-13 · KNOWN-RED(İP2A-13): admin onayı müşteriye AYNI karar için TAM BİR
    bildirim üretmelidir.

    Kodda `_settle_return` ve `approve_return` aynı kararı iki kez duyurur
    (çift bildirim). Bugün gözlem İP2A-18 ile bileşiktir: onay 500'e çakıldığı
    için müşteriye SIFIR bildirim gider. Her iki hâl de A2 ihlalidir; İP2A-18
    düzeltilince bu test çift-bildirimi ölçmeye devam eder.
    """
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid)
    r = await _musteri_talebi(client, fab, sip, chead)
    rid = r.json()["id"]

    _, ahead = await fab.admin(izinler=["returns.view", "returns.manage"])
    await _post_500e_tolere(
        client,
        f"{KOK}/admin/returns/{rid}/approve",
        json={"admin_note": "uygun"},
        headers=ahead,
    )

    adet = await fab.bildirim_sayisi(cid, icinde="iade")
    assert adet == 1, (
        f"KNOWN-RED(İP2A-13): tek onay kararı müşteriye {adet} bildirim üretti "
        "— beklenen tam 1 (bugün 500/İP2A-18 yüzünden 0; kod düzelince de "
        "_settle_return + approve_return aynı olayı 2 kez duyuracak)"
    )


async def test_r17_cayma_penceresi_ayipli_yolu_kapatmamali(fab, provider, client):
    """R-17 · KNOWN-RED(İP2A-17): 14 günlük cayma penceresi dolduktan sonra
    AYIPLI (kusurlu ürün) iade yolu kapanmamalıdır.

    Bugün: pencere guard'ı `type`'a bakmaz; teslimden 20 gün sonra ayıplı mal
    bildirimi de 409 'İade süresi doldu' alır. `ReturnType` docstring'i ayıplı
    malda sürenin daha uzun olduğunu söyler, kod uygulamaz (süre üst sınırı
    ürün/hukuk kararıdır — sözleşme PK-β; bu test yalnız 'cayma penceresi
    ayıplıyı kapatmasın' hedefini ölçer).
    """
    pid = await fab.urun(stock=10)
    cid, chead = await fab.musteri()
    sip = await fab.siparis(items=[(pid, 2)], client_id=cid, delivered_days_ago=20)

    yanit = await _musteri_talebi(client, fab, sip, chead, tip="AYIPLI")
    assert yanit.status_code == 201, (
        f"KNOWN-RED(İP2A-17): teslimden 20 gün sonra AYIPLI talebi "
        f"{yanit.status_code} aldı ({yanit.json().get('detail', '')!r}) — "
        "cayma penceresi tür ayrımı yapmadan ayıplı ürün yolunu da kapattı"
    )
