"""scripts/r2-backup.sh — R2 nesne yedeği sözleşmesi (27 Eyl 2026).

Betik gerçekten çalıştırılır; `rclone` PATH'te çağrıları kaydeden sahte bir
komutla değiştirilir (Cloudflare'e bağlanılmaz). Sınanan kurallar:

* ayna + arşiv: `sync --backup-dir r2/archive/<RUN_ID>/...` (kör ayna değil);
* RUN_ID = UTC zaman damgası + rastgele ek; her koşu (yeniden deneme dahil) yeni;
* kaynak YALNIZ okuma kimliğiyle, yedek YALNIZ yazma kimliğiyle; ikisi aynıysa
  koşu başlamaz; sırlar komut satırında ve çıktıda görünmez;
* snapshot sunucu tarafı (yedek → yedek) ve yalnız başarılı koşuda;
* hata → sıfırdan farklı çıkış + durum manifesti; kilit → ikinci koşu 75;
* geçici dizin (umask 077) her durumda temizlenir.

POSIX izinleri ve `flock` gerektirir; Windows'ta atlanır, CI'da (Ubuntu) koşar.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

BETIK = Path(__file__).resolve().parents[2] / "scripts" / "r2-backup.sh"

pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("flock") is None,
    reason="POSIX izinleri ve flock gerekli (CI Ubuntu'da koşar)",
)

OKUMA_ID, OKUMA_SIR = "OKUMA-ID-sentinel-7c1", "OKUMA-SIR-sentinel-9f2"
YAZMA_ID, YAZMA_SIR = "YAZMA-ID-sentinel-4a8", "YAZMA-SIR-sentinel-2d6"
RUN_ID_RE = r"\d{8}T\d{6}Z-[0-9a-f]{8}"

SAHTE_RCLONE = r"""#!/usr/bin/env bash
# Çağrıyı kaydeder; sır DEĞERİ yazmaz, yalnız doğru kimlik geldi mi yazar.
kimlik="kimlik_hatali"
if [[ "$RCLONE_CONFIG_KAYNAK_ACCESS_KEY_ID" == "$BEKLENEN_OKUMA" && "$RCLONE_CONFIG_YEDEK_ACCESS_KEY_ID" == "$BEKLENEN_YAZMA" \
   && "$RCLONE_CONFIG" == "/dev/null" && "$RCLONE_CONFIG_KAYNAK_NO_CHECK_BUCKET" == "true" ]]; then
  kimlik="kimlik_ok"
fi
printf '%s\t%s\n' "$kimlik" "$*" >> "$IZ/cagrilar.log"
alt="$1"
[[ "$alt" == check && " $* " == *" --download "* ]] && alt="check-download"
case "$alt" in
  lsjson)
    echo '[{"Path":"profiles/a.webp","Size":3,"ModTime":"2026-09-27T01:00:00Z","Hashes":{"md5":"abc"}}]' ;;
  copyto)
    if [[ "$2" == yedek:* ]]; then
      printf 'geri-icerik' > "$3"
    else
      echo "$(stat -c %a "$2") $2" >> "$IZ/yuklenen_yerel.log"
      cp "$2" "$IZ/son_$(basename "$3")"
    fi ;;
esac
if [[ -n "${SAHTE_HATA:-}" && "$alt" == "$SAHTE_HATA" ]]; then exit 7; fi
exit 0
"""


@pytest.fixture
def ortam(tmp_path):
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    (bin_ / "rclone").write_text(SAHTE_RCLONE, encoding="utf-8", newline="\n")
    (bin_ / "rclone").chmod(0o755)
    iz = tmp_path / "iz"
    iz.mkdir()
    env_dosyasi = tmp_path / "r2-yedek.env"
    env_dosyasi.write_text(
        "R2_YEDEK_ENDPOINT=https://hesap123.r2.cloudflarestorage.com\n"
        f"R2_YEDEK_OKUMA_ACCESS_KEY_ID={OKUMA_ID}\nR2_YEDEK_OKUMA_SECRET_ACCESS_KEY={OKUMA_SIR}\n"
        f"R2_YEDEK_YAZMA_ACCESS_KEY_ID={YAZMA_ID}\nR2_YEDEK_YAZMA_SECRET_ACCESS_KEY={YAZMA_SIR}\n",
        encoding="utf-8", newline="\n",
    )
    env_dosyasi.chmod(0o600)
    temel = {k: v for k, v in os.environ.items() if not k.startswith(("R2_YEDEK", "RCLONE", "SNAPSHOT"))}
    return {
        "tmp": tmp_path, "iz": iz, "env_dosyasi": env_dosyasi,
        "env": {
            **temel,
            "PATH": f"{bin_}{os.pathsep}{os.environ['PATH']}",
            "IZ": str(iz),
            "R2_YEDEK_ENV": str(env_dosyasi),
            "R2_YEDEK_KILIT": str(tmp_path / "kilit"),
            "R2_YEDEK_SNAPSHOT_GUNU": "9",  # hiçbir gün: snapshot yalnız SNAPSHOT=1 ile
            "BEKLENEN_OKUMA": OKUMA_ID, "BEKLENEN_YAZMA": YAZMA_ID,
            "TMPDIR": str(tmp_path / "gecici"),
        },
    }


def _calistir(o, *arg, **ek) -> subprocess.CompletedProcess:
    (o["tmp"] / "gecici").mkdir(exist_ok=True)
    return subprocess.run(
        ["bash", str(BETIK), *arg], env={**o["env"], **ek},
        capture_output=True, text=True, timeout=60,
    )


def _cagrilar(o) -> list[tuple[str, str]]:
    yol = o["iz"] / "cagrilar.log"
    if not yol.exists():
        return []
    return [tuple(s.split("\t", 1)) for s in yol.read_text(encoding="utf-8").splitlines()]


# ── Ana akış ────────────────────────────────────────────────────────────────


def test_gunluk_koşu_ayna_arsiv_ve_manifest(ortam):
    r = _calistir(ortam)
    assert r.returncode == 0, r.stderr
    cagrilar = _cagrilar(ortam)
    assert cagrilar and all(k == "kimlik_ok" for k, _ in cagrilar), "yanlış kimlik ya da config dosyası"
    komutlar = [c for _, c in cagrilar]

    syncler = [c for c in komutlar if c.startswith("sync ")]
    assert len(syncler) == 2
    run_idler = set()
    for taraf, bucket in (("public", "adanaozelders-public"), ("private", "adanaozelders-private")):
        [s] = [c for c in syncler if f"kaynak:{bucket} " in c]
        m = re.search(
            rf"^sync kaynak:{bucket} yedek:adanaozelders-backups/r2/current/{taraf} "
            rf"--backup-dir yedek:adanaozelders-backups/r2/archive/({RUN_ID_RE})/{taraf} "
            r"--checksum --fast-list --max-delete 20 ", s,
        )
        assert m, s
        run_idler.add(m.group(1))
        assert f"check kaynak:{bucket} yedek:adanaozelders-backups/r2/current/{taraf} --fast-list" in " | ".join(komutlar)
        assert any(c.startswith(f"lsjson -R --files-only --hash --use-server-modtime kaynak:{bucket}") for c in komutlar)
    assert not any(c.startswith("check ") and "--download" in c for c in komutlar), "günlük koşuda derin check yok"
    assert len(run_idler) == 1, "iki taraf aynı RUN_ID altında olmalı"
    run_id = run_idler.pop()
    for ad in ("public.json", "private.json", "durum.json"):
        assert any(c.endswith(f"yedek:adanaozelders-backups/r2/manifests/{run_id}/{ad} --retries 3 --low-level-retries 10 --log-level NOTICE --stats 0") for c in komutlar), ad
    durum = json.loads((ortam["iz"] / "son_durum.json").read_text(encoding="utf-8"))
    assert durum["run_id"] == run_id and durum["sonuc"] == "basarili" and durum["snapshot"] == "hayir"
    assert not any(c.startswith("copy ") for c in komutlar), "SNAPSHOT istenmedi"


def test_her_koşu_yeni_run_id_uretir_yeniden_denemede_anahtar_cakismaz(ortam):
    assert _calistir(ortam).returncode == 0
    assert _calistir(ortam).returncode == 0
    idler = re.findall(rf"r2/archive/({RUN_ID_RE})/public", (ortam["iz"] / "cagrilar.log").read_text())
    assert len(idler) == 2 and idler[0] != idler[1]


def test_snapshot_sunucu_tarafi_ve_yedekten_kopyalanir(ortam):
    r = _calistir(ortam, SNAPSHOT="1")
    assert r.returncode == 0, r.stderr
    kopyalar = [c for _, c in _cagrilar(ortam) if c.startswith("copy ")]
    assert len(kopyalar) == 2
    for taraf in ("public", "private"):
        assert any(re.match(
            rf"copy yedek:adanaozelders-backups/r2/current/{taraf} "
            rf"yedek:adanaozelders-backups/r2/snapshots/{RUN_ID_RE}/{taraf} ", c) for c in kopyalar), taraf
    assert not any("kaynak:" in c for c in kopyalar), "snapshot kaynaktan veri çekmemeli"
    assert json.loads((ortam["iz"] / "son_durum.json").read_text())["snapshot"] == "evet"


# ── Hata ve güvenlik ────────────────────────────────────────────────────────


def test_sync_hatasi_kosuyu_basarisiz_yapar_snapshot_alinmaz(ortam):
    r = _calistir(ortam, SAHTE_HATA="sync", SNAPSHOT="1")
    assert r.returncode == 1
    komutlar = [c for _, c in _cagrilar(ortam)]
    assert not any(c.startswith("copy ") for c in komutlar), "bozuk aynadan snapshot alınmamalı"
    durum = json.loads((ortam["iz"] / "son_durum.json").read_text())
    assert durum["sonuc"] == "basarisiz" and durum["snapshot"] == "atlandi"


def test_check_farki_kosuyu_basarisiz_yapar(ortam):
    assert _calistir(ortam, SAHTE_HATA="check").returncode == 1


@pytest.mark.parametrize("izin", [0o640, 0o604, 0o644])
def test_sir_dosyasi_baskalarina_aciksa_calismaz(ortam, izin):
    ortam["env_dosyasi"].chmod(izin)
    r = _calistir(ortam)
    assert r.returncode == 2 and "chmod 600" in r.stderr
    assert _cagrilar(ortam) == []


def test_sir_dosyasi_yoksa_ya_da_eksikse_calismaz(ortam):
    assert _calistir(ortam, R2_YEDEK_ENV=str(ortam["tmp"] / "yok.env")).returncode == 2
    ortam["env_dosyasi"].write_text("R2_YEDEK_ENDPOINT=https://x\n", encoding="utf-8")
    ortam["env_dosyasi"].chmod(0o600)
    r = _calistir(ortam)
    assert r.returncode == 2 and "tanımlı değil" in r.stderr
    assert _cagrilar(ortam) == []


def test_okuma_ve_yazma_ayni_kimlikse_calismaz(ortam):
    metin = ortam["env_dosyasi"].read_text().replace(YAZMA_ID, OKUMA_ID)
    ortam["env_dosyasi"].write_text(metin, encoding="utf-8")
    ortam["env_dosyasi"].chmod(0o600)
    r = _calistir(ortam)
    assert r.returncode == 2 and "iki ayrı token" in r.stderr
    assert _cagrilar(ortam) == []


def test_sirlar_komut_satirinda_ve_ciktida_gorunmez(ortam):
    r = _calistir(ortam, SAHTE_HATA="sync")
    metin = r.stdout + r.stderr + (ortam["iz"] / "cagrilar.log").read_text()
    for sir in (OKUMA_ID, OKUMA_SIR, YAZMA_ID, YAZMA_SIR):
        assert sir not in metin


def test_kilit_varken_ikinci_kosu_75_ile_cikar(ortam):
    kilit = ortam["env"]["R2_YEDEK_KILIT"]
    tutucu = subprocess.Popen(["flock", kilit, "sleep", "5"])
    try:
        import time
        time.sleep(0.5)
        r = _calistir(ortam)
    finally:
        tutucu.kill()
    assert r.returncode == 75
    assert _cagrilar(ortam) == []


@pytest.mark.parametrize("hata", ["", "sync"])
def test_gecici_dizin_700_dosyalar_600_ve_her_durumda_temizlenir(ortam, hata):
    _calistir(ortam, SAHTE_HATA=hata)
    yuklenen = (ortam["iz"] / "yuklenen_yerel.log").read_text().splitlines()
    assert yuklenen
    for satir in yuklenen:
        izin, yol = satir.split(" ", 1)
        assert izin == "600", satir
        assert not Path(yol).exists(), "geçici dosya temizlenmedi"
    assert list((ortam["tmp"] / "gecici").iterdir()) == [], "geçici dizin kaldı"


# ── geri-al ────────────────────────────────────────────────────────────────


def test_geri_al_yedekten_indirir_boyut_ve_sha256_basar_kaynaga_yazmaz(ortam):
    hedef = ortam["tmp"] / "geri.bin"
    r = _calistir(ortam, "geri-al", "r2/archive/20260927T040001Z-3f9a1c2e/private/private/x.pdf", str(hedef))
    assert r.returncode == 0, r.stderr
    import hashlib
    assert hedef.read_bytes() == b"geri-icerik"
    assert f"sha256={hashlib.sha256(b'geri-icerik').hexdigest()}" in r.stdout
    assert "boyut=11" in r.stdout
    [(kimlik, komut)] = _cagrilar(ortam)
    assert kimlik == "kimlik_ok"
    assert komut.startswith("copyto yedek:adanaozelders-backups/r2/archive/20260927T040001Z-3f9a1c2e/private/private/x.pdf ")
    assert "kaynak:" not in komut


@pytest.mark.parametrize("yol", ["profiles/x.webp", "r2/../private/x", ""])
def test_geri_al_yalniz_r2_altindaki_yollari_kabul_eder(ortam, yol):
    r = _calistir(ortam, "geri-al", yol, str(ortam["tmp"] / "x"))
    assert r.returncode == 2
    assert _cagrilar(ortam) == []


# ── Statik sözleşme ─────────────────────────────────────────────────────────


def test_betik_sertlestirmeleri_ve_production_kimligi_kullanmaz():
    metin = BETIK.read_text(encoding="utf-8")
    for parca in ("set -euo pipefail", "umask 077", "flock -n", "trap temizle EXIT"):
        assert parca in metin, parca
    # Production uygulama token'ı ve .env.prod bu betikte yok.
    assert "AWS_ACCESS_KEY_ID" not in metin and ".env.prod" not in metin
    assert "--backup-dir" in metin
    ornek = (BETIK.parent / "r2-backup.env.example").read_text(encoding="utf-8")
    for satir in ornek.splitlines():
        if satir and not satir.startswith("#") and "=" in satir:
            k, v = satir.split("=", 1)
            assert v.startswith(("BURAYA", "https://BURAYA")), f"örnekte gerçek değer: {k}"


# ── Haftalık derin kontrol (--download) ─────────────────────────────────────


def test_snapshot_oncesi_iki_kaynak_icin_derin_check_calisir(ortam):
    assert _calistir(ortam, SNAPSHOT="1").returncode == 0
    komutlar = [c for _, c in _cagrilar(ortam)]
    derin = [i for i, c in enumerate(komutlar) if c.startswith("check ") and "--download" in c]
    assert len(derin) == 2
    for taraf, bucket in (("public", "adanaozelders-public"), ("private", "adanaozelders-private")):
        assert any(c.startswith(
            f"check kaynak:{bucket} yedek:adanaozelders-backups/r2/current/{taraf} --download --fast-list ")
            for c in komutlar), taraf
    ilk_snapshot = min(i for i, c in enumerate(komutlar) if c.startswith("copy "))
    assert max(derin) < ilk_snapshot, "derin check snapshot'tan ÖNCE çalışmalı"


def test_derin_check_basarisizsa_snapshot_alinmaz_kosu_basarisiz(ortam):
    r = _calistir(ortam, SNAPSHOT="1", SAHTE_HATA="check-download")
    assert r.returncode == 1
    assert "derin check" in r.stderr
    komutlar = [c for _, c in _cagrilar(ortam)]
    assert not any(c.startswith("copy ") for c in komutlar), "snapshot alınmamalı"
    durum = json.loads((ortam["iz"] / "son_durum.json").read_text())
    assert durum["sonuc"] == "basarisiz" and durum["snapshot"] == "atlandi"


def test_max_silme_env_ile_yukseltilebilir(ortam):
    metin = ortam["env_dosyasi"].read_text() + "R2_YEDEK_MAX_SILME=250\n"
    ortam["env_dosyasi"].write_text(metin, encoding="utf-8")
    ortam["env_dosyasi"].chmod(0o600)
    assert _calistir(ortam).returncode == 0
    syncler = [c for _, c in _cagrilar(ortam) if c.startswith("sync ")]
    assert syncler and all("--max-delete 250 " in c for c in syncler)
