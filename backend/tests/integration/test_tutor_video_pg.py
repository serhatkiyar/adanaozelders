"""Eğitmen tanıtım videosu — doğrudan yükleme akışı (gerçek Postgres, gerçek auth).

Kilitlenen sözleşme:
* imzalı PUT yalnız sunucu üretimi anahtara; eğitmen başına tek yolda video;
* boyut aşımı `complete`te FAILED döner (4xx DEĞİL — satır takılmasın);
* sahiplik: başkasının kaydı 404;
* ATOMİK DEĞİŞİM: yeni video işlenip ONAYLANANA kadar eski video/bağlantı
  public yanıtta kalır; onay eskiyi düşürür, red/iptal eskiye dokunmaz;
* bağlantı da ön onaydan geçer (28 Eyl 2026 kullanıcı kararı "Önce admin
  onayı"): kaydedilen bağlantı onay bekler, yayındaki video onaya kadar
  kalır; onay tek kaynak kuralıyla eskisini düşürür, red gerekçe taşır;
* admin izni: `tutors.view` liste görür, karar `tutors.manage` ister.

Depo ağa çıkmaz (HEAD/DELETE taklit); FFmpeg yok — worker'ın DB adımları
(`claim_next` / `finalize_success`) doğrudan çağrılır.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from core import storage
from core.database import AsyncSessionLocal
from models.notification import Notification
from models.tutor import Tutor, TutorStatus
from models.tutor_intro_video import TutorIntroVideo
from services import tutor_video_service
from tests.integration.ip3_factory import yetki_basligi

VIDEO = "/api/v1/tutors/me/intro-video"
YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
VIMEO = "https://vimeo.com/123456789"


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


async def _baglanti_yayinla(http, basliklar, yonetir, url: str) -> int:
    """Bağlantıyı kaydeder ve admin onayıyla yayına alır; satır kimliğini döner."""
    r = await http.patch("/api/v1/tutors/me", headers=basliklar, json={"intro_video_url": url})
    assert r.status_code == 200, r.text
    durum = (await http.get(VIDEO, headers=basliklar)).json()
    assert durum["pending"]["kind"] == "LINK" and durum["pending"]["link_url"] == url
    vid = durum["pending"]["id"]
    r = await http.post(f"/api/v1/admin/tutor-videos/{vid}/review", headers=yonetir, json={"action": "approve"})
    assert r.status_code == 200, r.text
    return vid


async def _satir(video_id: int) -> TutorIntroVideo:
    async with AsyncSessionLocal() as s:
        v = await s.get(TutorIntroVideo, video_id)
        assert v is not None
        return v


@pytest.mark.asyncio
async def test_yukleme_onay_ve_yayin_eski_baglanti_korunur(ip3, http, fab12, depo):
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])
    # Eski kaynak: YouTube bağlantısı yayında (bağlantı da onaydan geçer).
    link_id = await _baglanti_yayinla(http, b, yonetir, YOUTUBE)

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

    r = await http.post(f"/api/v1/admin/tutor-videos/{vid}/review", headers=yonetir, json={"action": "approve"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ACTIVE"
    assert (await _satir(link_id)).status == "REPLACED"

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


async def _yayinda_upload(http, b, yonetir) -> tuple[int, str]:
    vid = (await _basla(http, b)).json()["video_id"]
    await http.post(f"{VIDEO}/uploads/{vid}/complete", headers=b)
    await _worker_isler(vid)
    await http.post(f"/api/v1/admin/tutor-videos/{vid}/review", headers=yonetir, json={"action": "approve"})
    assert (await _satir(vid)).status == "ACTIVE"
    return vid, (await http.get("/api/v1/tutors/me", headers=b)).json()["intro_video"]["mp4_url"]


@pytest.mark.asyncio
async def test_baglanti_onay_bekler_onayda_uploadi_dusurur(ip3, http, fab12, depo):
    """Eski sözleşme "bağlantı anında yayında + upload anında REPLACED" idi;
    28 Eyl 2026'dan beri bağlantı da ön onaydan geçer (atomik değişim)."""
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])
    vid, eski_mp4 = await _yayinda_upload(http, b, yonetir)

    # Boş bağlantı kaydı (temizleme) aktif upload'a DOKUNMAZ.
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": ""})
    assert r.status_code == 200 and (await _satir(vid)).status == "ACTIVE"

    # Bağlantı kaydı: onay bekler; public ESKİ upload'ı göstermeye devam eder.
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})
    assert r.status_code == 200, r.text
    assert r.json()["intro_video_url"] is None and r.json()["intro_video"]["mp4_url"] == eski_mp4
    assert (await _satir(vid)).status == "ACTIVE"
    pub = (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()
    assert pub["intro_video"]["mp4_url"] == eski_mp4 and pub["intro_video_url"] is None
    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["active"]["id"] == vid and durum["link_url"] is None
    bekleyen = durum["pending"]
    assert bekleyen["status"] == "PENDING_REVIEW" and bekleyen["kind"] == "LINK"
    assert bekleyen["link_url"] == YOUTUBE and bekleyen["mp4_url"] is None

    # Aynı bağlantıyı yeniden kaydetmek (sihirbaz her adımda gönderir) no-op.
    assert (await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})).status_code == 200
    assert (await http.get(VIDEO, headers=b)).json()["pending"]["id"] == bekleyen["id"]

    # Admin kuyruğunda bağlantı olarak görünür.
    liste = (await http.get("/api/v1/admin/tutor-videos/pending", headers=yonetir)).json()
    oge = next(k for k in liste if k["id"] == bekleyen["id"])
    assert oge["kind"] == "LINK" and oge["link_url"] == YOUTUBE and oge["tutor_id"] == egitmen.id

    # Onay: bağlantı yayında, yüklenmiş video o anda REPLACED (temizliğe gider).
    r = await http.post(
        f"/api/v1/admin/tutor-videos/{bekleyen['id']}/review", headers=yonetir, json={"action": "approve"}
    )
    assert r.status_code == 200 and r.json()["status"] == "ACTIVE", r.text
    assert (await _satir(vid)).status == "REPLACED"
    pub = (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()
    assert pub["intro_video"] is None and pub["intro_video_url"] == YOUTUBE
    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["active"] is None and durum["pending"] is None and durum["link_url"] == YOUTUBE

    # Yayındaki bağlantıyı boşaltmak onay istemez: hemen kalkar, satır REPLACED.
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": None})
    assert r.status_code == 200 and r.json()["intro_video_url"] is None
    assert (await _satir(bekleyen["id"])).status == "REPLACED"
    assert (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()["intro_video_url"] is None


@pytest.mark.asyncio
async def test_baglanti_reddi_gerekce_ve_eski_baglanti_kalir(ip3, http, fab12, depo):
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])
    eski = await _baglanti_yayinla(http, b, yonetir, YOUTUBE)

    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": VIMEO})
    assert r.status_code == 200 and r.json()["intro_video_url"] == YOUTUBE, r.text
    yeni = (await http.get(VIDEO, headers=b)).json()["pending"]["id"]
    r = await http.post(
        f"/api/v1/admin/tutor-videos/{yeni}/review",
        headers=yonetir,
        json={"action": "reject", "note": "Videoda başka bir kişi anlatıyor"},
    )
    assert r.status_code == 200 and r.json()["status"] == "REJECTED", r.text

    # Eski bağlantı yayında kalır; eğitmen gerekçeyi Profilim → Video'da görür.
    assert (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()["intro_video_url"] == YOUTUBE
    assert (await _satir(eski)).status == "ACTIVE"
    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["link_url"] == YOUTUBE
    assert durum["pending"]["status"] == "REJECTED" and durum["pending"]["kind"] == "LINK"
    assert durum["pending"]["review_note"] == "Videoda başka bir kişi anlatıyor"
    async with AsyncSessionLocal() as s:
        mesajlar = (
            await s.execute(select(Notification.message).where(Notification.user_id == egitmen.id))
        ).scalars().all()
    assert any("bağlantın onaylanmadı" in m and "başka bir kişi" in m for m in mesajlar), mesajlar

    # Yayındaki bağlantı sonradan reddedilirse public kopyası da düşer.
    r = await http.post(f"/api/v1/admin/tutor-videos/{eski}/review", headers=yonetir, json={"action": "reject"})
    assert r.status_code == 200, r.text
    assert (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()["intro_video_url"] is None


@pytest.mark.asyncio
async def test_bekleyen_baglanti_geri_cekilir_ve_yenisiyle_degisir(ip3, http, fab12, depo):
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])
    vid, eski_mp4 = await _yayinda_upload(http, b, yonetir)

    # Geri çekme: bekleyen bağlantı REPLACED, yayındaki video değişmez.
    await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})
    l1 = (await http.get(VIDEO, headers=b)).json()["pending"]["id"]
    assert (await http.delete(f"{VIDEO}/uploads/{l1}", headers=b)).status_code == 204
    assert (await _satir(l1)).status == "REPLACED"
    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["pending"] is None and durum["active"]["id"] == vid
    assert (await http.get(f"/api/v1/tutors/{egitmen.id}")).json()["intro_video"]["mp4_url"] == eski_mp4

    # Tek bekleyen kuralı: yeni bağlantı bekleyen bağlantıyı değiştirir ...
    await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})
    l2 = (await http.get(VIDEO, headers=b)).json()["pending"]["id"]
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": VIMEO})
    assert r.status_code == 200, r.text
    l3 = (await http.get(VIDEO, headers=b)).json()["pending"]
    assert l3["link_url"] == VIMEO and (await _satir(l2)).status == "REPLACED"
    # ... yeni yükleme de onu değiştirir (bağlantıda kaybolan emek yok) ...
    r = await _basla(http, b)
    assert r.status_code == 201, r.text
    up = r.json()["video_id"]
    assert (await _satir(l3["id"])).status == "REPLACED"
    # ... ama yolda bir YÜKLEME varken bağlantı 409 (önce iptal), mevcut kural.
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})
    assert r.status_code == 409, r.text
    assert (await _satir(up)).status == "PENDING_UPLOAD"
    assert (await _satir(vid)).status == "ACTIVE"
    # İptalden sonra bağlantı yeniden kaydedilebilir.
    assert (await http.delete(f"{VIDEO}/uploads/{up}", headers=b)).status_code == 204
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_sihirbaz_yeniden_gonderimi_bekleyen_baglantiyi_bozmaz(ip3, http, fab12, depo):
    """İlan sihirbazı alanı (yalnız YAYINDAKİ bağlantı ya da boş) her kayıtta
    yeniden gönderir; onay bekleyen bağlantı bundan etkilenmemeli."""
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])

    # Yayında bağlantı yokken: bekleyen var, sihirbaz boş alan gönderir.
    await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})
    l1 = (await http.get(VIDEO, headers=b)).json()["pending"]["id"]
    for bos in (None, ""):
        r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": bos})
        assert r.status_code == 200, r.text
    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["pending"]["id"] == l1 and durum["pending"]["status"] == "PENDING_REVIEW"

    # Yayında bağlantı varken: sihirbaz yayındakini yeniden gönderir → ikisi de yerinde.
    r = await http.post(f"/api/v1/admin/tutor-videos/{l1}/review", headers=yonetir, json={"action": "approve"})
    assert r.status_code == 200, r.text
    await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": VIMEO})
    l2 = (await http.get(VIDEO, headers=b)).json()["pending"]["id"]
    r = await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": YOUTUBE})
    assert r.status_code == 200 and r.json()["intro_video_url"] == YOUTUBE, r.text
    durum = (await http.get(VIDEO, headers=b)).json()
    assert durum["pending"]["id"] == l2 and durum["pending"]["link_url"] == VIMEO
    assert durum["link_url"] == YOUTUBE and (await _satir(l1)).status == "ACTIVE"


@pytest.mark.asyncio
async def test_onay_surecindeki_profil_yukleyemez(ip3, http, depo):
    egitmen = await ip3.tutor(status=TutorStatus.PENDING_APPROVAL)
    r = await _basla(http, yetki_basligi(egitmen))
    assert r.status_code == 409, r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("boyut", [5_000_000, 400 * 1024 * 1024], ids=["normal", "sinir-ustu"])
async def test_complete_head_sirasinda_iptal_edilirse_409_ve_iptal_korunur(ip3, http, depo, monkeypatch, boyut):
    """Yarış: complete kilitsiz okuyup HEAD atarken eğitmen iptal eder. Kilitli
    yeniden okuma durumu görmeli → 409, satır REPLACED kalır, kaynağa dokunulmaz."""
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    vid = (await _basla(http, b)).json()["video_id"]

    async def head_size_arada_iptal(key):
        async with AsyncSessionLocal() as s:
            await tutor_video_service.cancel_upload(s, await s.get(Tutor, egitmen.id), vid)
            await s.commit()
        return boyut

    monkeypatch.setattr(storage, "head_size", head_size_arada_iptal)
    r = await http.post(f"{VIDEO}/uploads/{vid}/complete", headers=b)
    assert r.status_code == 409, r.text
    assert (await _satir(vid)).status == "REPLACED"
    assert depo["deleted"] == []


@pytest.mark.asyncio
async def test_baglanti_kaldirma_eszamanli_onayin_public_kopyasini_ezmez(ip3, http, fab12, depo, monkeypatch):
    """Yarış: eğitmen yayındaki A bağlantısını boşaltırken admin B'yi onaylar.
    Eğitmen isteğinin `tutor` nesnesi istek başında (A iken) yüklenmiştir;
    kilitten sonra A REPLACED görülünce public kopyaya (artık B) dokunulmamalı."""
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])
    a_id = await _baglanti_yayinla(http, b, yonetir, YOUTUBE)
    await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": VIMEO})
    b_id = (await http.get(VIDEO, headers=b)).json()["pending"]["id"]

    async with AsyncSessionLocal() as s:
        tutor = await s.get(Tutor, egitmen.id)
        assert tutor.intro_video_url == YOUTUBE
        bayat_a = await tutor_video_service.get_active(s, egitmen.id)
        assert bayat_a is not None and bayat_a.id == a_id

        # Admin onayı eğitmenin kilitsiz okumasıyla kilidi arasında commit olur.
        r = await http.post(f"/api/v1/admin/tutor-videos/{b_id}/review", headers=yonetir, json={"action": "approve"})
        assert r.status_code == 200, r.text

        async def bayat_get_active(db, tutor_id):
            return bayat_a

        monkeypatch.setattr(tutor_video_service, "get_active", bayat_get_active)
        await tutor_video_service.submit_link(s, tutor, None)
        await s.commit()

    assert (await _satir(a_id)).status == "REPLACED"
    assert (await _satir(b_id)).status == "ACTIVE"
    async with AsyncSessionLocal() as s:
        assert (await s.get(Tutor, egitmen.id)).intro_video_url == VIMEO


@pytest.mark.asyncio
async def test_hesap_silmede_baglanti_satirlari_ve_notlar_silinir(ip3, http, fab12, depo):
    """KVKK: eğitmen satırı anonimleşir (CASCADE yok); bağlantılar
    (yayındaki, reddedilmiş, bekleyen) veritabanında kalmamalı."""
    from services import account_deletion_service

    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])
    upload_id, _ = await _yayinda_upload(http, b, yonetir)
    await _baglanti_yayinla(http, b, yonetir, YOUTUBE)
    await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": VIMEO})
    red = (await http.get(VIDEO, headers=b)).json()["pending"]["id"]
    r = await http.post(
        f"/api/v1/admin/tutor-videos/{red}/review",
        headers=yonetir,
        json={"action": "reject", "note": "Yüzün görünmüyor"},
    )
    assert r.status_code == 200, r.text
    await http.patch("/api/v1/tutors/me", headers=b, json={"intro_video_url": "https://youtu.be/abcdefghijk"})
    async with AsyncSessionLocal() as s:
        await account_deletion_service.anonymize_account(s, await s.get(Tutor, egitmen.id))
        await s.commit()

    async with AsyncSessionLocal() as s:
        satirlar = (
            await s.execute(select(TutorIntroVideo).where(TutorIntroVideo.tutor_id == egitmen.id))
        ).scalars().all()
        assert [v.id for v in satirlar] == [upload_id], [v.link_url for v in satirlar]
        assert satirlar[0].status == "REPLACED"
        assert all(v.review_note is None for v in satirlar)
        assert (await s.get(Tutor, egitmen.id)).intro_video_url is None


@pytest.mark.asyncio
async def test_int4_disi_video_kimligi_500_degil_404(ip3, http, fab12, depo):
    egitmen = await ip3.tutor(status=TutorStatus.APPROVED)
    b = yetki_basligi(egitmen)
    _, yonetir = await fab12.admin(izinler=["tutors.view", "tutors.manage"])
    tasan = 99_999_999_999
    assert (await http.post(f"{VIDEO}/uploads/{tasan}/complete", headers=b)).status_code == 404
    assert (await http.delete(f"{VIDEO}/uploads/{tasan}", headers=b)).status_code == 404
    r = await http.post(f"/api/v1/admin/tutor-videos/{tasan}/review", headers=yonetir, json={"action": "approve"})
    assert r.status_code == 404, r.text
