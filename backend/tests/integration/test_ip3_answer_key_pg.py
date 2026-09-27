"""İP-3 / Bulgu 2 — Deneme sınavı cevap anahtarı sızıntısı.

## Doğrulanan üretim durumu

`services/library_exam_service.py::_session_out` cevap anahtarını **role göre
değil** yalnız `results_published_at` doluluğuna göre ekler:

    answer_key = (s.answer_key_url or catalog_answer_key_url) if published else None

Aynı yardımcı üç yüzeyi de besler: `GET /exam-sessions` (**anonim, public**),
`GET /exam-sessions/manage` (operatör) ve `GET /exam-registrations/mine`
(öğrenci). Yanıt şeması (`PrivateAsset`) `private/` anahtarını imzaladığı
için sızıntı teorik değil, **indirilebilir bir URL'dir**.

Karşılaştırma noktası: `library_exam_catalog_service._to_out(include_answer_key)`
aynı sorunu doğru çözmüş (router `isinstance(user, Admin)` ile karar veriyor).
İki desen ayrık kaldığı sürece drift eder.

## Güvenlik sözleşmesi

1. `answer_key_url` YALNIZ `libraries.manage` izinli ADMIN yanıtında bulunur.
2. Operatör, öğrenci ve anonim kullanıcı hiçbir koşulda anahtar URL'si veya
   dosya anahtarı görmez — sonuçların yayınlanmış olması yetki değildir.
3. `results_published` bilgisi herkese açık kalır (öğrenci sonucunu görebilsin).
4. Karar tek kaynakta verilir; `PrivateAsset` serileştiricisi yetki otoritesi değildir.
"""
from __future__ import annotations

import pytest

from tests.integration.ip3_factory import yetki_basligi

ANAHTAR = "private/answer-keys/ip3-cevap-anahtari.pdf"


def _anahtar_izi(govde: str) -> bool:
    """Yanıtın herhangi bir yerinde cevap anahtarına götüren iz var mı?

    İmzalı URL, ham anahtar adı ve dosya adı ayrı ayrı aranır: yanıt şeması
    adresi imzalayıp query string eklediği için düz eşitlik yetmez.
    """
    d = govde.lower()
    return "answer-key" in d or "cevap-anahtari" in d


@pytest.mark.asyncio
async def test_public_listede_cevap_anahtari_yok(ip3, http):
    """Senaryo 4a — anonim istek. En ağır sızıntı yüzeyi."""
    lib = await ip3.library()
    await ip3.exam_session(lib, answer_key_url=ANAHTAR, results_published=True)

    r = await http.get("/api/v1/exam-sessions", params={"library_id": lib.id})

    assert r.status_code == 200, r.text[:200]
    assert r.json(), "oturum listesi boş — test hiçbir şey ölçmüyor"
    for oturum in r.json():
        assert oturum.get("answer_key_url") is None, (
            "ANONİM kullanıcıya cevap anahtarı döndü: "
            f"{oturum.get('answer_key_url')!r}"
        )
    assert not _anahtar_izi(r.text), f"public yanıtta anahtar izi var: {r.text[:300]}"


@pytest.mark.asyncio
async def test_ogrenci_biletlerinde_cevap_anahtari_yok(ip3, http):
    """Senaryo 4b — `/exam-registrations/mine` gömülü oturum nesnesi."""
    lib = await ip3.library()
    ogrenci = await ip3.client()
    sess = await ip3.exam_session(lib, answer_key_url=ANAHTAR, results_published=True)
    await ip3.exam_registration(sess, ogrenci, status="PAID")

    r = await http.get(
        "/api/v1/exam-registrations/mine", headers=yetki_basligi(ogrenci)
    )

    assert r.status_code == 200, r.text[:200]
    assert r.json(), "kayıt listesi boş — test hiçbir şey ölçmüyor"
    for kayit in r.json():
        gomulu = kayit.get("session") or {}
        assert gomulu.get("answer_key_url") is None, (
            f"ÖĞRENCİye cevap anahtarı döndü: {gomulu.get('answer_key_url')!r}"
        )
    assert not _anahtar_izi(r.text), f"öğrenci yanıtında anahtar izi: {r.text[:300]}"


@pytest.mark.asyncio
async def test_operator_yonetim_listesinde_cevap_anahtari_yok(ip3, http):
    """Senaryo 4c — operatörün kendi oturumu bile olsa anahtar dönmez.

    `backend/CLAUDE.md`: "cevap anahtarı operatöre hiç dönmez". Kod bunu
    yalnız yükleme ucunda değil, OKUMA yüzeylerinde de tutmalı.
    """
    lib = await ip3.library()
    op = await ip3.operator(lib)
    await ip3.exam_session(lib, answer_key_url=ANAHTAR, results_published=True)

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib.id},
        headers=yetki_basligi(op),
    )

    assert r.status_code == 200, r.text[:200]
    assert r.json(), "yönetim listesi boş — test hiçbir şey ölçmüyor"
    for oturum in r.json():
        assert oturum.get("answer_key_url") is None, (
            f"OPERATÖRe cevap anahtarı döndü: {oturum.get('answer_key_url')!r}"
        )
    assert not _anahtar_izi(r.text), f"operatör yanıtında anahtar izi: {r.text[:300]}"


@pytest.mark.asyncio
async def test_sonuc_yayinlanmamisken_de_operatore_donmez(ip3, http):
    """Yayın durumundan BAĞIMSIZ olmalı: yayınlanmamışken de, yayınlıyken de yok."""
    lib = await ip3.library()
    op = await ip3.operator(lib)
    await ip3.exam_session(lib, answer_key_url=ANAHTAR, results_published=False)

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib.id},
        headers=yetki_basligi(op),
    )

    assert r.status_code == 200
    for oturum in r.json():
        assert oturum.get("answer_key_url") is None


@pytest.mark.asyncio
async def test_yetkili_admin_cevap_anahtarini_gorur(ip3, http):
    """Senaryo 5 — kapı kapanırken meşru erişim de kaybolmamalı.

    Bu test olmasa "her yerde None döndür" gibi bir düzeltme yeşil görünürdü.
    """
    lib = await ip3.library()
    admin = await ip3.admin(permissions=["libraries.manage"])
    await ip3.exam_session(lib, answer_key_url=ANAHTAR, results_published=True)

    r = await http.get(
        "/api/v1/exam-sessions/manage",
        params={"library_id": lib.id},
        headers=yetki_basligi(admin),
    )

    assert r.status_code == 200, r.text[:200]
    oturumlar = r.json()
    assert oturumlar, "admin yönetim listesi boş — test hiçbir şey ölçmüyor"
    assert any(o.get("answer_key_url") for o in oturumlar), (
        "yetkili ADMIN cevap anahtarını GÖREMEDİ — kapı meşru erişimi de kapattı"
    )


@pytest.mark.asyncio
async def test_public_listede_results_published_bilgisi_korunur(ip3, http):
    """Anahtar gizlenirken "sonuçlar açıldı mı" sinyali kaybolmamalı."""
    lib = await ip3.library()
    await ip3.exam_session(lib, answer_key_url=ANAHTAR, results_published=True)

    r = await http.get("/api/v1/exam-sessions", params={"library_id": lib.id})

    assert r.status_code == 200
    assert any(o.get("results_published") for o in r.json()), (
        "results_published bayrağı kayboldu — öğrenci sonucunu göremez"
    )
