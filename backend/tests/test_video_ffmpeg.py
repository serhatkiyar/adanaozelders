"""Video işçisinin saf parçaları: ffprobe doğrulaması, ffmpeg argümanları,
zaman aşımında öldürme. FFmpeg ikilisi GEREKMEZ (alt süreç taklit edilir).

Güvenlik sözleşmesi burada kilitlenir: uzantı/content-type kullanılmaz, komut
argüman listesidir (shell yok), meta veri atılır, süre/çözünürlük/akış sınırı
zorlanır, zaman aşımı süreci öldürür.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from workers import ffmpeg


def _probe(**over):
    base = {
        "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "42.5"},
        "streams": [
            {"codec_type": "video", "width": 1920, "height": 1080},
            {"codec_type": "audio"},
        ],
    }
    base.update(over)
    return json.dumps(base)


# ── parse_probe ──────────────────────────────────────────────────────────────


def test_gecerli_video_kabul():
    info = ffmpeg.parse_probe(_probe(), max_seconds=130)
    assert (info.width, info.height, info.has_audio) == (1920, 1080, True)
    assert info.duration == pytest.approx(42.5)


def test_sessiz_video_kabul():
    raw = _probe(streams=[{"codec_type": "video", "width": 640, "height": 480}])
    assert ffmpeg.parse_probe(raw, max_seconds=130).has_audio is False


@pytest.mark.parametrize(
    "raw, code",
    [
        ("bu json değil", "NOT_VIDEO"),
        (json.dumps({"format": {}, "streams": []}), "NOT_VIDEO"),
        # Yalnız ses: uzantısı .mp4 olsa bile reddedilir.
        (_probe(streams=[{"codec_type": "audio"}]), "NOT_VIDEO"),
        # Kapak resmi "video" akışı sayılmaz (mp3 içindeki albüm kapağı).
        (
            _probe(
                streams=[
                    {"codec_type": "audio"},
                    {"codec_type": "video", "width": 500, "height": 500, "disposition": {"attached_pic": 1}},
                ]
            ),
            "NOT_VIDEO",
        ),
        (_probe(format={"duration": "131"}), "TOO_LONG"),
        (_probe(streams=[{"codec_type": "video", "width": 8000, "height": 4500}]), "TOO_LARGE"),
        (_probe(streams=[{"codec_type": "video", "width": 100, "height": 100}] + [{"codec_type": "data"}] * 9), "NOT_VIDEO"),
        (_probe(format={"duration": "0"}), "NOT_VIDEO"),
    ],
)
def test_reddedilen_girdiler(raw, code):
    with pytest.raises(ffmpeg.VideoRejected) as exc:
        ffmpeg.parse_probe(raw, max_seconds=130)
    assert exc.value.code == code
    assert exc.value.message  # eğitmene gösterilecek metin boş değil


def test_sure_siniri_tam_sinirda_kabul():
    assert ffmpeg.parse_probe(_probe(format={"duration": "130"}), max_seconds=130).duration == 130


def _kural(raw, **kw):
    return ffmpeg.parse_probe(
        raw,
        max_seconds=130,
        min_seconds=30,
        min_short_side=360,
        require_landscape=True,
        **kw,
    )


def test_yatay_720p_40sn_kurallardan_gecer():
    info = _kural(_probe(format={"duration": "40"}, streams=[{"codec_type": "video", "width": 1280, "height": 720}]))
    assert (info.width, info.height) == (1280, 720)


@pytest.mark.parametrize(
    "stream, code",
    [
        # Gerçek dikey dosya.
        ({"codec_type": "video", "width": 1080, "height": 1920}, "VERTICAL"),
        # Telefon yatay piksel yazıp "90 derece çevir" demiş → izleyici dikey görür.
        ({"codec_type": "video", "width": 1920, "height": 1080, "side_data_list": [{"rotation": -90}]}, "VERTICAL"),
        ({"codec_type": "video", "width": 1920, "height": 1080, "tags": {"rotate": "90"}}, "VERTICAL"),
        # Kısa kenarı 360'ın altında.
        ({"codec_type": "video", "width": 320, "height": 240}, "LOW_RESOLUTION"),
    ],
)
def test_dikey_ve_dusuk_cozunurluk_reddedilir(stream, code):
    with pytest.raises(ffmpeg.VideoRejected) as exc:
        _kural(_probe(format={"duration": "40"}, streams=[stream]))
    assert exc.value.code == code


def test_180_derece_donuk_yatay_video_yatay_sayilir():
    info = _kural(
        _probe(
            format={"duration": "40"},
            streams=[{"codec_type": "video", "width": 1280, "height": 720, "side_data_list": [{"rotation": 180}]}],
        )
    )
    assert (info.width, info.height) == (1280, 720)


def test_kare_video_kabul():
    _kural(_probe(format={"duration": "40"}, streams=[{"codec_type": "video", "width": 720, "height": 720}]))


def test_30_saniyeden_kisa_reddedilir():
    with pytest.raises(ffmpeg.VideoRejected) as exc:
        _kural(_probe(format={"duration": "29.4"}, streams=[{"codec_type": "video", "width": 1280, "height": 720}]))
    assert exc.value.code == "TOO_SHORT"


def test_suresiz_tarayici_kaydi_on_kontrolden_gecer_karar_ciktida():
    """MediaRecorder webm'i container'a süre yazmaz: kaynakta geçer (süre 0),
    karar dönüştürülmüş çıktının süresiyle `check_duration`da verilir."""
    raw = _probe(format={"format_name": "matroska,webm"}, streams=[{"codec_type": "video", "width": 1280, "height": 720}])
    assert _kural(raw, allow_missing_duration=True).duration == 0
    with pytest.raises(ffmpeg.VideoRejected):
        _kural(raw)  # izin yoksa eski davranış: süre okunamadı
    ffmpeg.check_duration(45, min_seconds=30, max_seconds=130)
    with pytest.raises(ffmpeg.VideoRejected) as uzun:
        ffmpeg.check_duration(131, min_seconds=30, max_seconds=130)
    assert uzun.value.code == "TOO_LONG"
    with pytest.raises(ffmpeg.VideoRejected) as kisa:
        ffmpeg.check_duration(12, min_seconds=30, max_seconds=130)
    assert kisa.value.code == "TOO_SHORT"


# ── Komut argümanları ────────────────────────────────────────────────────────


def test_transcode_argumanlari_sozlesmeyi_tasir():
    args = ffmpeg.transcode_args("/tmp/x/src.bin", "/tmp/x/out.mp4", max_seconds=130)
    assert args[0] == "ffmpeg" and args[-1] == "/tmp/x/out.mp4"
    joined = " ".join(args)
    # 720p tavanı, H.264 + AAC, faststart, yuv420p
    assert "scale='min(1280,iw)':'min(720,ih)'" in joined
    assert "force_divisible_by=2" in joined
    for flag in ("-c:v libx264", "-c:a aac", "-movflags +faststart", "-pix_fmt yuv420p"):
        assert flag in joined
    # Meta veri (GPS/cihaz), bölümler, altyazı/data akışları atılır.
    assert "-map_metadata -1" in joined and "-map_chapters -1" in joined
    assert "-sn" in args and "-dn" in args
    # Süre ikinci emniyet; ses isteğe bağlı (`?`), sessiz videoda patlamaz.
    assert args[args.index("-t") + 1] == "130"
    assert "0:a:0?" in args
    # Etkileşim yok, thread tavanı var.
    assert "-nostdin" in args and args[args.index("-threads") + 1] == "2"


def test_argumanlar_liste_ve_shell_karakteri_icermez():
    args = ffmpeg.transcode_args("/tmp/a/src.bin", "/tmp/a/out.mp4", max_seconds=130)
    assert all(isinstance(a, str) for a in args)
    # Yollar worker'ın kendi ürettiği geçici yollardır; yine de tek bir liste
    # elemanı birden fazla argüman gibi yorumlanamaz (shell yok).
    assert not any(";" in a or "&&" in a or "|" in a for a in args if not a.startswith("scale="))


def test_probe_ve_poster_argumanlari():
    p = ffmpeg.probe_args("/tmp/a/src.bin")
    assert p[0] == "ffprobe" and "-show_streams" in p and p[-1] == "/tmp/a/src.bin"
    long_ = ffmpeg.poster_args("/tmp/a/out.mp4", "/tmp/a/p.jpg", duration=40)
    short = ffmpeg.poster_args("/tmp/a/out.mp4", "/tmp/a/p.jpg", duration=0.8)
    assert long_[long_.index("-ss") + 1] == "1.0"
    assert short[short.index("-ss") + 1] == "0.0"
    assert "-frames:v" in long_


# ── run: zaman aşımı süreci öldürür ──────────────────────────────────────────


class _AsiliSurec:
    """`communicate` hiç dönmeyen sahte alt süreç."""

    def __init__(self) -> None:
        self.killed = False
        self.returncode = None

    async def communicate(self):
        await asyncio.sleep(3600)

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    async def wait(self):
        return self.returncode


async def test_zaman_asiminda_surec_oldurulur(monkeypatch):
    proc = _AsiliSurec()

    async def sahte_exec(*args, **kwargs):
        # shell=True gibi bir yol YOK: create_subprocess_exec argüman listesi alır.
        assert args[0] == "ffmpeg"
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", sahte_exec)
    with pytest.raises(ffmpeg.VideoRejected) as exc:
        await ffmpeg.run(["ffmpeg", "-i", "x"], timeout=0.01)
    assert exc.value.code == "TIMEOUT"
    assert proc.killed


class _BitenSurec:
    returncode = 0

    async def communicate(self):
        return b'{"ok": 1}', b""


async def test_run_ciktiyi_dondurur_ve_on_start_cagirir(monkeypatch):
    tutulan = []

    async def sahte_exec(*args, **kwargs):
        return _BitenSurec()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", sahte_exec)
    res = await ffmpeg.run(["ffprobe", "x"], timeout=5, on_start=tutulan.append)
    assert res.returncode == 0 and res.stdout == '{"ok": 1}'
    assert len(tutulan) == 1
