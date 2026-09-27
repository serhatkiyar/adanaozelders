"""Eğitmen tanıtım videosu — doğrudan yükleme akışı (gerçek Postgres, gerçek auth).

Kilitlenen sözleşme:
* imzalı PUT yalnız sunucu üretimi anahtara; eğitmen başına tek yolda video;
* boyut aşımı `complete`te FAILED döner (4xx DEĞİL — satır takılmasın);
* sahiplik: başkasının kaydı 404;
* ATOMİK DEĞİŞİM: yeni video işlenip ONAYLANANA kadar eski video/bağlantı
  public yanıtta kalır; onay eskiyi düşürür, red/iptal eskiye dokunmaz;
* tek kaynak kuralı: bağlantı kaydı aktif upload'ı düşürür;
* admin izni: `tutors.view` liste görür, karar `tutors.manage` ister.

Depo ağa çıkmaz (HEAD/DELETE taklit); FFmpeg yok — worker'ın DB adımları
(`claim_next` / `finalize_success`) doğrudan çağrılır.
"""
from __future__ import annotations

import pytest

from core import storage
from core.database import AsyncSessionLocal
from models.tutor import Tutor, TutorStatus
from models.tutor_intro_video import TutorIntroVideo
from services import tutor_video_service
from tests.integration.ip3_factory import yetki_basligi

VIDEO = "/api/v1/tutors/me/intro-video"
YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


@pytest.fixture
def depo(monkeypatch):
    """Depo taklidi: HEAD boyutu ayarlanabilir, silmeler kaydedilir."""
    durum = {"size": 5_000_000, "deleted": []}

    async def head_size(key):
        return durum["size"]

    async def delete_key(key):
        durum["deleted"].append(key)
        return True

    monkeypatch.setattr(storage, "head_size", head_size)
    monkeypatch.setattr(storage, "delete_key", delete_key)
    return durum


async def _basla(http, basliklar, **over):
    payload = {
        "filename": "tanitim.mov",
        "size_bytes": 5_000_000,
        "content_type": "video/quicktime",
        **over,
    }
    return await http.post(f"{VIDEO}/uploads", headers=basliklar, json=payload)


async def _worker_isler(video_id: int) -> str | None:
    """Worker'ın DB adımları (FFmpeg atlanır)."""
    async with AsyncSessionLocal() as s:
        v = await tutor_video_service.claim_next(s)
        assert v is not None and v.id == video_id, "kuyrukta beklenen kayıt yok"
        token = v.lock_token
        await s.commit()
    async with AsyncSessionLocal() as s:
        durum = await tutor_video_service.finalize_success(
            s, video_id, token, duration_seconds=61.2, width=1280, height=720, output_size_bytes=4096
        )
        await s.commit()
    return durum


async def _satir(video_id: int) -> TutorIntroVideo:
    async with AsyncSessionLocal() as s:
        v = await s.get(TutorIntroVideo, video_id)
        assert v is not None
        return v


@pytest.mark.asyncio
async def test_yukleme_onay_ve_yayin_eski_baglanti_korunur(ip3, http, fab12, depo):
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    # Eski kaynak: YouTube bağlantısı yayında.
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})
    assert r.status_code == 200, r.text

    r = await _basla(http, b)
    assert r.status_code == 201, r.text
    init = r.json()
    assert init["method"] == "PUT" and init["headers"] == {"Content-Type": "video/quicktime"}
    assert "X-Amz-Signature=" in init["upload_url"]
    assert f"/private/tutor-videos/{egitmen.id}/" in init["upload_url"]
    vid = init["video_id"]

    # Tek yolda video: ikinci başlatma 409.
    r2 = await _basla(http, b)
    assert r2.status_code == 409, r2.text

    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["pending"]["status"] == "PENDING_UPLOAD" and durum["active"] is None
    assert durum["link_url"] == YOUTUBE and durum["require_review"] is True

    r = await http.post(f"{VIDEO}/uploads/{vid}/complete", headers=b)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "UPLOADED"

    assert await _worker_isler(vid) == "PENDING_REVIEW"

    # Onay bekleyen video public'te GÖRÜNMEZ; eski bağlantı yayında kalır.
    pub = (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()
    assert pub["intro_video"] is None and pub["intro_video_url"] == YOUTUBE

    # Admin: yalnız görüntüleme izni liste görür, karar veremez.
    _, sadece_gorur = await fab12.admin(izinler=["tutors.view"])
    r = await http.get("/api/v1/admin/tutor-videos/pending", headers=sadece_gorur)
    assert r.status_code == 200 and any(k["id"] == vid for k in r.json()), r.text
    r = await http.post(f"/api/v1/admin/tutor-videos/{vid}/review", headers=sadece_gorur, json={"action": "approve"})
    assert r.status_code == 403, r.text

    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])
    r = await http.post(f"/api/v1/admin/tutor-videos/{vid}/review", headers=yonetir, json={"action": "approve"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ACTIVE"

    # Aktivasyon: yeni video public'te, bağlantı düştü (tek kaynak).
    pub = (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()
    assert pub["intro_video"]["kind"] == "upload"
    assert pub["intro_video"]["mp4_url"].endswith(".mp4") and "tutor-videos/" in pub["intro_video"]["mp4_url"]
    assert pub["intro_video"]["poster_url"].endswith(".jpg")
    assert pub["intro_video"]["duration_seconds"] == pytest.approx(61.2)
    assert pub["intro_video_url"] is None
    async with AsyncSessionLocal() as s:
        assert (await s.get(Tutor, egitmen.id)).intro_video_url is None
    me = (await http.get("/api/v1/tutors/me", headers=b)).json()
    assert me["intro_video"]["kind"] == "upload" and me["intro_video_url"] is None
    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["active"]["status"] == "ACTIVE" and durum["pending"] is None
    # Kaynak nesne yalnız worker tarafından silinir; burada silme kaydı yok.
    assert depo["deleted"] == []


@pytest.mark.asyncio
async def test_boyut_asimi_complete_failed_ve_yeniden_baslanabilir(ip3, http, depo):
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    r = await _basla(http, b)
    vid = r.json()["video_id"]
    kaynak = (await _satir(vid)).source_key

    depo["size"] = 400 * 1024 * 1024  # imzalı PUT boyutu zorlayamaz; HEAD yakalar
    r = await http.post(f"{VIDEO}/uploads/{vid}/complete", headers=b)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "FAILED" and r.json()["error_code"] == "TOO_LARGE"
    assert depo["deleted"] == [kaynak]

    # Başarısız kayıt yolda sayılmaz: yeni yükleme hemen başlar; durum 'pending'
    # son hatayı gösterir (eğitmen 'yeniden dene' görür).
    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["pending"]["status"] == "FAILED"
    r = await _basla(http, b)
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_baskasinin_kaydi_404_ve_beyan_dogrulamasi(ip3, http, depo):
    sahip = await ip3.tutor(status=TutorStatus.APPROVED)
    baskasi = await ip3.tutor(status=TutorStatus.APPROVED)
    vid = (await _basla(http, yetki_basligi(sahip))).json()["video_id"]
    yb = yetki_basligi(baskasi)
    assert (await http.post(f"{VIDEO}/uploads/{vid}/complete", headers=yb)).status_code == 404
    assert (await http.delete(f"{VIDEO}/uploads/{vid}", headers=yb)).status_code == 404
    # Beyan: video dışı tür ve sınır üstü boyut daha başlamadan reddedilir.
    assert (await _basla(http, yb, content_type="image/png")).status_code == 422
    assert (await _basla(http, yb, size_bytes=301 * 1024 * 1024)).status_code == 422


@pytest.mark.asyncio
async def test_red_ve_iptal_eski_videoya_dokunmaz(ip3, http, fab12, depo):
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])

    # İlk video yayına girer.
    v1 = (await _basla(http, b)).json()["video_id"]
    await http.post(f"{VIDEO}/uploads/{v1}/complete", headers=b)
    await _worker_isler(v1)
    assert (await http.post(f"/api/v1/admin/tutor-videos/{v1}/review", headers=yonetir, json={"action": "approve"})).status_code == 200
    eski_mp4 = (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()["intro_video"]["mp4_url"]

    # İkinci video reddedilir → eski video yayında, gerekçe eğitmene görünür.
    v2 = (await _basla(http, b)).json()["video_id"]
    await http.post(f"{VIDEO}/uploads/{v2}/complete", headers=b)
    await _worker_isler(v2)
    r = await http.post(
        f"/api/v1/admin/tutor-videos/{v2}/review", headers=yonetir, json={"action": "reject", "note": "Telefon numarası söyleniyor"}
    )
    assert r.status_code == 200 and r.json()["status"] == "REJECTED", r.text
    pub = (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()
    assert pub["intro_video"]["mp4_url"] == eski_mp4
    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["active"]["status"] == "ACTIVE"
    assert durum["pending"]["status"] == "REJECTED" and durum["pending"]["review_note"] == "Telefon numarası söyleniyor"

    # Üçüncü video işlenirken iptal: worker kilidi kaybeder, sonucu yazamaz.
    v3 = (await _basla(http, b)).json()["video_id"]
    await http.post(f"{VIDEO}/uploads/{v3}/complete", headers=b)
    async with AsyncSessionLocal() as s:
        v = await tutor_video_service.claim_next(s)
        assert v is not None and v.id == v3
        token = v.lock_token
        await s.commit()
    assert (await http.delete(f"{VIDEO}/uploads/{v3}", headers=b)).status_code == 204
    async with AsyncSessionLocal() as s:
        assert await tutor_video_service.finalize_success(
            s, v3, token, duration_seconds=1, width=2, height=2, output_size_bytes=1
        ) is None
        await s.commit()
    assert (await _satir(v3)).status == "REPLACED"
    assert (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()["intro_video"]["mp4_url"] == eski_mp4

    # Eğitmen aktif videoyu kaldırır → public'te video yok, satır REPLACED.
    assert (await http.delete(VIDEO, headers=b)).status_code == 204
    assert (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()["intro_video"] is None
    assert (await _satir(v1)).status == "REPLACED"


@pytest.mark.asyncio
async def test_baglanti_kaydi_aktif_uploadi_dusurur(ip3, http, fab12, depo):
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])
    vid = (await _basla(http, b)).json()["video_id"]
    await http.post(f"{VIDEO}/uploads/{vid}/complete", headers=b)
    await _worker_isler(vid)
    await http.post(f"/api/v1/admin/tutor-videos/{vid}/review", headers=yonetir, json={"action": "approve"})
    assert (await _satir(vid)).status == "ACTIVE"

    # Boş bağlantı kaydı (temizleme) aktif upload'a DOKUNMAZ.
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": ""})
    assert r.status_code == 200 and (await _satir(vid)).status == "ACTIVE"

    # Dolu bağlantı tek kaynak kuralıyla upload'ı düşürür.
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})
    assert r.status_code == 200, r.text
    assert r.json()["intro_video"] is None and r.json()["intro_video_url"] == YOUTUBE
    assert (await _satir(vid)).status == "REPLACED"
    pub = (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()
    assert pub["intro_video"] is None and pub["intro_video_url"] == YOUTUBE


@pytest.mark.asyncio
async def test_onay_surecindeki_profil_yukleyemez(ip3, http, depo):
    egitmen = await ip3.tutor(status=TutorStatus.PENDING_APPROVAL)
    r = await _basla(http, yetki_basligi(egitmen))
    assert r.status_code == 409, r.text
