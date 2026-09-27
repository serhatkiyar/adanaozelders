"""scripts/pg-offsite-backup.sh — şifreli PostgreSQL off-site yedeği sözleşmesi.

Betik gerçekten çalıştırılır, GERÇEK gpg ile (testte üretilen geçici anahtarlar).
`docker` (pg_restore --list) ve `rclone` (R2) sahte komutlarla değiştirilir;
sahte rclone yüklenenleri yerel bir "depo" dizininde tutar, böylece yüklenen
.gpg dosyası özel anahtarla çözülüp düz dump ile karşılaştırılabilir.

POSIX izinleri, /proc ve flock gerektirir; Windows'ta atlanır, CI'da (Ubuntu) koşar.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import pytest

BETIK = Path(__file__).resolve().parents[2] / "scripts" / "pg-offsite-backup.sh"
pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("flock") is None or shutil.which("gpg") is None,
    reason="POSIX, flock ve gpg gerekli (CI Ubuntu'da koşar)",
)

YAZMA_ID, YAZMA_SIR = "YAZMA-ID-sentinel-5b3", "YAZMA-SIR-sentinel-8e1"
OKUMA_ID, OKUMA_SIR = "OKUMA-ID-sentinel-1c7", "OKUMA-SIR-sentinel-6d4"
RUN_RE = r"\d{8}T\d{6}Z-[0-9a-f]{8}"

SAHTE_DOCKER = r"""#!/usr/bin/env bash
# docker exec -i <container> pg_restore --list  (stdin: dump)
cat > /dev/null
if [[ "${SAHTE_PGLIST:-}" == "hata" ]]; then echo "pg_restore: error: input file is too short" >&2; exit 1; fi
if [[ "${SAHTE_PGLIST:-}" == "bos" ]]; then echo ";"; exit 0; fi
for i in 1 2 3; do echo "$((3000+i)); 0 1640$i TABLE DATA public tablo$i postgres"; done
"""

SAHTE_RCLONE = r"""#!/usr/bin/env bash
kimlik="kimlik_hatali"
[[ "$RCLONE_CONFIG_YEDEK_ACCESS_KEY_ID" == "$BEKLENEN_YAZMA" && "$RCLONE_CONFIG" == "/dev/null" \
   && -z "${RCLONE_CONFIG_KAYNAK_ACCESS_KEY_ID:-}" ]] && kimlik="kimlik_ok"
printf '%s\t%s\n' "$kimlik" "$*" >> "$IZ/cagrilar.log"
yol() { local p="${1#yedek:}"; echo "$DEPO/$p"; }
alt="$1"; shift
[[ -n "${SAHTE_HATA:-}" && "$alt" == "${SAHTE_HATA%%:*}" ]] && {
  [[ "$SAHTE_HATA" != *:* || "$*" == *"${SAHTE_HATA#*:}"* ]] && exit 7; }
case "$alt" in
  copyto)
    src="$1"; dst="$2"
    if [[ "$src" == yedek:* && "$dst" == yedek:* ]]; then mkdir -p "$(dirname "$(yol "$dst")")"; cp "$(yol "$src")" "$(yol "$dst")"
    elif [[ "$src" == yedek:* ]]; then cp "$(yol "$src")" "$dst"; [[ -n "${SAHTE_BOZ:-}" ]] && printf 'X' >> "$dst"
    else mkdir -p "$(dirname "$(yol "$dst")")"; cp "$src" "$(yol "$dst")"; fi ;;
  lsf)
    [[ "$1" == "-R" ]] && { shift 2; d="$(yol "$1")"; [[ -d "$d" ]] && (cd "$d" && find . -type f | sed 's#^\./##'); exit 0; }
    d="$(yol "$1")"; [[ -d "$d" ]] && ls -1 "$d" ;;
  link) echo "https://hesap.r2.cloudflarestorage.com/${1#yedek:}?X-Amz-Signature=imza-sentinel" ;;
  cat) cat "$(yol "$1")" ;;
esac
exit 0
"""


def _gpg(home, *arg, girdi=None):
    return subprocess.run(["gpg", "--homedir", str(home), "--batch", "--pinentry-mode", "loopback",
                           "--passphrase", "", *arg], capture_output=True, input=girdi, check=True)


def _anahtar_uret(home, ad):
    _gpg(home, "--quick-gen-key", f"{ad} <{ad}@test.invalid>", "ed25519", "cert", "never")
    fpr = [ln.split(":")[9] for ln in _gpg(home, "--with-colons", "--list-keys", ad).stdout.decode().splitlines()
           if ln.startswith("fpr:")][0]
    _gpg(home, "--quick-add-key", fpr, "cv25519", "encr", "never")
    return fpr


@pytest.fixture(scope="module")
def anahtarlar():
    """Çevrimdışı (tam) keyring: A1, A2 ve yabancı bir anahtar. Kısa yol: gpg-agent soketi."""
    home = Path(tempfile.mkdtemp(prefix="g", dir="/tmp"))
    home.chmod(0o700)
    a1, a2, yabanci = (_anahtar_uret(home, ad) for ad in ("alici1", "alici2", "yabanci"))
    yield {"home": home, "a1": a1, "a2": a2, "yabanci": yabanci}
    subprocess.run(["gpgconf", "--homedir", str(home), "--kill", "gpg-agent"], check=False)
    shutil.rmtree(home, ignore_errors=True)


def _yalniz_public_keyring(anahtarlar, hedef: Path, *fprler):
    hedef.mkdir(mode=0o700)
    pub = _gpg(anahtarlar["home"], "--export", *fprler).stdout
    _gpg(hedef, "--import", girdi=pub)


@pytest.fixture
def ortam(anahtarlar):
    tmp = Path(tempfile.mkdtemp(prefix="p", dir="/tmp"))
    bin_ = tmp / "bin"; bin_.mkdir()
    for ad, icerik in (("docker", SAHTE_DOCKER), ("rclone", SAHTE_RCLONE)):
        (bin_ / ad).write_text(icerik, encoding="utf-8", newline="\n"); (bin_ / ad).chmod(0o755)
    (tmp / "iz").mkdir(); (tmp / "depo").mkdir(); (tmp / "gecici").mkdir()
    yedekler = tmp / "backups"; yedekler.mkdir()
    dump = yedekler / "db-20260928-0330.dump"
    dump.write_bytes(b"PGDMP" + os.urandom(4000))
    eski = time.time() - 600
    os.utime(dump, (eski, eski))
    vps = tmp / "gnupg"
    _yalniz_public_keyring(anahtarlar, vps, anahtarlar["a1"], anahtarlar["a2"])
    konf = tmp / "pg-offsite.conf"
    konf.write_text(
        f"PG_ALICI_1={anahtarlar['a1']}\nPG_ALICI_2={anahtarlar['a2']}\n"
        f"PG_YEDEK_DIZIN={yedekler}\nPG_GNUPGHOME={vps}\n"
        "PG_MIN_BOYUT=1000\nPG_MIN_YAS_SN=60\nPG_STABIL_BEKLE=1\nPG_MAX_YAS_DK=180\n",
        encoding="utf-8", newline="\n")
    env_dosyasi = tmp / "r2-yedek.env"
    env_dosyasi.write_text(
        "R2_YEDEK_ENDPOINT=https://hesap.r2.cloudflarestorage.com\n"
        f"R2_YEDEK_OKUMA_ACCESS_KEY_ID={OKUMA_ID}\nR2_YEDEK_OKUMA_SECRET_ACCESS_KEY={OKUMA_SIR}\n"
        f"R2_YEDEK_YAZMA_ACCESS_KEY_ID={YAZMA_ID}\nR2_YEDEK_YAZMA_SECRET_ACCESS_KEY={YAZMA_SIR}\n",
        encoding="utf-8", newline="\n")
    env_dosyasi.chmod(0o600)
    temel = {k: v for k, v in os.environ.items() if not k.startswith(("R2_YEDEK", "RCLONE", "PG_", "SAHTE"))}
    o = {
        "tmp": tmp, "iz": tmp / "iz", "depo": tmp / "depo", "dump": dump, "vps": vps, "konf": konf,
        "env": {**temel, "PATH": f"{bin_}{os.pathsep}{os.environ['PATH']}", "IZ": str(tmp / "iz"),
                "DEPO": str(tmp / "depo"), "PG_OFFSITE_CONF": str(konf), "R2_YEDEK_ENV": str(env_dosyasi),
                "PG_OFFSITE_KILIT": str(tmp / "kilit"), "BEKLENEN_YAZMA": YAZMA_ID, "TMPDIR": str(tmp / "gecici")},
    }
    yield o
    subprocess.run(["gpgconf", "--homedir", str(vps), "--kill", "gpg-agent"], check=False)
    shutil.rmtree(tmp, ignore_errors=True)


def _calistir(o, *arg, **ek):
    return subprocess.run(["bash", str(BETIK), *arg], env={**o["env"], **ek},
                          capture_output=True, text=True, timeout=120)


def _cagrilar(o):
    yol = o["iz"] / "cagrilar.log"
    return [tuple(s.split("\t", 1)) for s in yol.read_text().splitlines()] if yol.exists() else []


def _yuklemeler(o):
    return [c for _, c in _cagrilar(o) if c.startswith("copyto ")]


def _depodaki(o, desen):
    return sorted(p for p in o["depo"].rglob("*") if p.is_file() and re.search(desen, str(p)))


def _parmak_izi_satiri(o, satir):
    metin = o["konf"].read_text()
    o["konf"].write_text(re.sub(r"^PG_ALICI_1=.*$", satir, metin, flags=re.M), encoding="utf-8")


# ── Başarılı akış ───────────────────────────────────────────────────────────


def test_basarili_yedek_sifreli_yukler_manifest_ve_aylik_kopya(ortam, anahtarlar):
    once = (ortam["dump"].read_bytes(), ortam["dump"].stat().st_mtime)
    r = _calistir(ortam)
    assert r.returncode == 0, r.stderr
    assert all(k == "kimlik_ok" for k, _ in _cagrilar(ortam)), "yalnız yazma kimliği kullanılmalı"
    [gpg_dosyasi] = _depodaki(ortam, rf"postgres/daily/{RUN_RE}/db\.dump\.gpg$")
    [manifest_yolu] = _depodaki(ortam, rf"postgres/daily/{RUN_RE}/manifest\.json$")
    m = json.loads(manifest_yolu.read_text())
    duz = ortam["dump"].read_bytes()
    assert m["duz_sha256"] == hashlib.sha256(duz).hexdigest() and m["duz_boyut"] == len(duz)
    assert m["sifreli_sha256"] == hashlib.sha256(gpg_dosyasi.read_bytes()).hexdigest()
    assert m["sifreli_boyut"] == gpg_dosyasi.stat().st_size
    assert m["dump_adi"] == ortam["dump"].name and m["table_data"] == 3
    assert m["alicilar"] == [anahtarlar["a1"], anahtarlar["a2"]]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", m["zaman_utc"])
    assert gpg_dosyasi.read_bytes()[:5] != b"PGDMP", "yüklenen dosya düz dump olmamalı"
    # Aylık: depo boşken ilk başarılı koşu sunucu tarafı kopya yapar (yedek → yedek).
    aylik = [c for c in _yuklemeler(ortam) if "/postgres/monthly/" in c]
    assert len(aylik) == 2 and all(c.split()[1].startswith("yedek:") for c in aylik)
    # İkili birlikte: db.dump.gpg + manifest.json AYNI monthly/<YYYY-MM>/<RUN_ID>/ dizininde,
    # günlük RUN_ID ile aynı ve günlük kopyalarla bayt bayt aynı.
    run_id = gpg_dosyasi.parent.name
    aylik_dosyalar = _depodaki(ortam, rf"postgres/monthly/\d{{4}}-\d\d/{run_id}/")
    assert sorted(p.name for p in aylik_dosyalar) == ["db.dump.gpg", "manifest.json"]
    assert len({p.parent for p in aylik_dosyalar}) == 1
    aylik_dizin = aylik_dosyalar[0].parent
    assert (aylik_dizin / "db.dump.gpg").read_bytes() == gpg_dosyasi.read_bytes()
    assert (aylik_dizin / "manifest.json").read_bytes() == manifest_yolu.read_bytes()
    # Yerel dump'a dokunulmadı.
    assert (ortam["dump"].read_bytes(), ortam["dump"].stat().st_mtime) == once


@pytest.mark.parametrize("alici", ["a1", "a2"])
def test_iki_alicidan_her_biri_tek_basina_cozebilir(ortam, anahtarlar, alici):
    assert _calistir(ortam).returncode == 0
    [gpg_dosyasi] = _depodaki(ortam, r"postgres/daily/.*/db\.dump\.gpg$")
    tek = ortam["tmp"] / f"tek-{alici}"
    tek.mkdir(mode=0o700)
    gizli = _gpg(anahtarlar["home"], "--export-secret-keys", anahtarlar[alici]).stdout
    _gpg(tek, "--import", girdi=gizli)
    cozulen = _gpg(tek, "--decrypt", str(gpg_dosyasi)).stdout
    subprocess.run(["gpgconf", "--homedir", str(tek), "--kill", "gpg-agent"], check=False)
    assert cozulen == ortam["dump"].read_bytes()


def test_ham_dump_hicbir_rclone_argumaninda_yok(ortam):
    assert _calistir(ortam).returncode == 0
    for _, komut in _cagrilar(ortam):
        assert ortam["dump"].name not in komut and str(ortam["dump"]) not in komut, komut
        assert not re.search(r"\.dump(\s|$)", komut), komut
    yerel_kaynaklar = [c.split()[1] for c in _yuklemeler(ortam) if not c.split()[1].startswith("yedek:")]
    assert yerel_kaynaklar and all(p.endswith(("db.dump.gpg", "manifest.json")) for p in yerel_kaynaklar)


def test_iki_tam_parmak_izi_kullanilir_kisa_id_reddedilir(ortam, anahtarlar):
    kisa = anahtarlar["a1"][-16:]
    _parmak_izi_satiri(ortam, f"PG_ALICI_1={kisa}")
    r = _calistir(ortam)
    assert r.returncode == 2 and "40 veya 64 haneli" in r.stderr
    _parmak_izi_satiri(ortam, f"PG_ALICI_1={anahtarlar['a1'].lower()}")
    assert _calistir(ortam).returncode == 2
    _parmak_izi_satiri(ortam, f"PG_ALICI_1={anahtarlar['a2']}")
    r = _calistir(ortam)
    assert r.returncode == 2 and "aynı" in r.stderr
    assert _yuklemeler(ortam) == []


# ── Parmak izi biçimi: 40 (v4) ya da 64 (v5/v6) büyük harf onaltılık ─────────

_FPR_64 = "0123456789ABCDEF" * 4  # biçimce geçerli, keyring'de yok


@pytest.mark.parametrize(
    "deger",
    [
        "A" * 39, "A" * 41, "A" * 63, "A" * 65,          # geçersiz uzunluklar
        "a" * 40, _FPR_64.lower(),                        # küçük harf
        "G" + "A" * 39, "A" * 63 + "Z",                   # onaltılık olmayan
        "A" * 20 + " " + "A" * 19, "",                    # boşluklu / boş
    ],
    ids=["39", "41", "63", "65", "kucuk-40", "kucuk-64", "hex-degil-40", "hex-degil-64", "bosluk", "bos"],
)
def test_gecersiz_parmak_izi_bicimi_reddedilir(ortam, deger):
    # Tırnaklı: değer (boşluk dahil) tek parça olarak betiğe ulaşsın.
    _parmak_izi_satiri(ortam, f'PG_ALICI_1="{deger}"')
    r = _calistir(ortam)
    assert r.returncode == 2 and "40 veya 64 haneli" in r.stderr
    assert _cagrilar(ortam) == []


def test_gecerli_40_haneli_parmak_izi_kabul_edilir(ortam, anahtarlar):
    assert len(anahtarlar["a1"]) == 40
    r = _calistir(ortam)
    assert r.returncode == 0, r.stderr


def test_gecerli_64_haneli_parmak_izi_bicim_kontrolunden_gecer(ortam):
    """64 haneli (v5/v6) parmak izi biçim olarak kabul edilir; test anahtarı
    keyring'de olmadığı için sonraki adımda 'keyring'de yok' ile durur."""
    _parmak_izi_satiri(ortam, f"PG_ALICI_1={_FPR_64}")
    r = _calistir(ortam)
    assert "40 veya 64 haneli" not in r.stderr
    assert r.returncode == 2 and "keyring'de yok" in r.stderr
    assert _yuklemeler(ortam) == []


@pytest.mark.parametrize("uzunluk", [40, 64])
def test_ayni_iki_parmak_izi_her_uzunlukta_reddedilir(ortam, anahtarlar, uzunluk):
    fpr = anahtarlar["a1"] if uzunluk == 40 else _FPR_64
    metin = re.sub(r"^PG_ALICI_\d=.*$\n?", "", ortam["konf"].read_text(), flags=re.M)
    ortam["konf"].write_text(f"PG_ALICI_1={fpr}\nPG_ALICI_2={fpr}\n{metin}", encoding="utf-8")
    r = _calistir(ortam)
    assert r.returncode == 2 and "aynı" in r.stderr
    assert _cagrilar(ortam) == []


def test_keyringde_olmayan_alici_reddedilir(ortam, anahtarlar):
    _parmak_izi_satiri(ortam, f"PG_ALICI_1={anahtarlar['yabanci']}")
    r = _calistir(ortam)
    assert r.returncode == 2 and "keyring'de yok" in r.stderr
    assert _yuklemeler(ortam) == []


def test_keyringde_gizli_anahtar_varsa_fail_closed(ortam, anahtarlar):
    gizli = _gpg(anahtarlar["home"], "--export-secret-keys", anahtarlar["a1"]).stdout
    _gpg(ortam["vps"], "--import", girdi=gizli)
    r = _calistir(ortam)
    assert r.returncode == 2 and "GİZLİ anahtar" in r.stderr
    assert _cagrilar(ortam) == []


# ── Dump seçimi ─────────────────────────────────────────────────────────────


def _degistir_arka_planda(dump: Path, gecikme: float):
    def is_():
        time.sleep(gecikme)
        with dump.open("ab") as f:
            f.write(b"hala-yaziliyor")
    t = threading.Thread(target=is_); t.start(); return t


def test_dump_hala_degisiyorsa_yukleme_yok(ortam):
    t = _degistir_arka_planda(ortam["dump"], 0.5)
    r = _calistir(ortam, PG_STABIL_BEKLE="2")
    t.join()
    assert r.returncode == 3 and "değişti" in r.stderr
    assert _yuklemeler(ortam) == [] and not _depodaki(ortam, r"\.gpg$")


@pytest.mark.parametrize(("yas_sn", "beklenen"), [(5, "sabit olmalı"), (4 * 3600, "dk eski")])
def test_cok_yeni_ya_da_cok_eski_dump_reddedilir(ortam, yas_sn, beklenen):
    t = time.time() - yas_sn
    os.utime(ortam["dump"], (t, t))
    r = _calistir(ortam)
    assert r.returncode == 3 and beklenen in r.stderr
    assert _yuklemeler(ortam) == []


def test_kucuk_dump_reddedilir(ortam):
    ortam["dump"].write_bytes(b"PGDMP-kisa")
    t = time.time() - 600; os.utime(ortam["dump"], (t, t))
    r = _calistir(ortam)
    assert r.returncode == 3 and "bayt" in r.stderr
    assert _yuklemeler(ortam) == []


def test_acik_dosya_tutuluyorsa_reddedilir(ortam):
    tutucu = subprocess.Popen(["bash", "-c", f"exec 3>>'{ortam['dump']}'; sleep 10"])
    try:
        time.sleep(0.5)
        t = time.time() - 600; os.utime(ortam["dump"], (t, t))
        r = _calistir(ortam)
    finally:
        tutucu.kill()
    assert r.returncode == 3 and "açık" in r.stderr
    assert _yuklemeler(ortam) == []


@pytest.mark.parametrize("durum", ["hata", "bos"])
def test_gecersiz_pg_restore_list_yukleme_yok(ortam, durum):
    r = _calistir(ortam, SAHTE_PGLIST=durum)
    assert r.returncode == 3 and "pg_restore" in r.stderr
    assert _yuklemeler(ortam) == [] and not _depodaki(ortam, r"\.gpg$")


# ── Yükleme ve doğrulama hataları ───────────────────────────────────────────


def test_dogrulama_indirmesi_bozuksa_basarisiz(ortam):
    r = _calistir(ortam, SAHTE_BOZ="1")
    assert r.returncode == 1 and "eşleşmiyor" in r.stderr
    assert not [c for c in _yuklemeler(ortam) if "/monthly/" in c], "doğrulanmamış yedekten aylık kopya olmaz"


def test_yukleme_hatasi_sifirdan_farkli_ve_yerel_dump_saglam(ortam):
    once = hashlib.sha256(ortam["dump"].read_bytes()).hexdigest()
    r = _calistir(ortam, SAHTE_HATA="copyto")
    assert r.returncode == 1 and "yükleme başarısız" in r.stderr
    assert hashlib.sha256(ortam["dump"].read_bytes()).hexdigest() == once


# ── Aylık kopya koşulu ──────────────────────────────────────────────────────


def test_aylik_kopya_bu_ay_varsa_yapilmaz(ortam):
    ay = time.strftime("%Y-%m", time.gmtime())
    onceki = ortam["depo"] / "adanaozelders-backups" / "postgres" / "monthly" / ay / "20260901T005000Z-aaaaaaaa"
    onceki.mkdir(parents=True)
    (onceki / "db.dump.gpg").write_bytes(b"onceki")
    r = _calistir(ortam)
    assert r.returncode == 0 and "zaten var" in r.stdout
    assert not [c for c in _yuklemeler(ortam) if "/monthly/" in c]


def test_aylik_kopya_hatasi_sifirdan_farkli(ortam):
    r = _calistir(ortam, SAHTE_HATA="copyto:/monthly/")
    assert r.returncode == 1 and "aylık kopya başarısız" in r.stderr


# ── Sırlar, kilit, geçici dosyalar, benzersiz RUN_ID ────────────────────────


@pytest.mark.parametrize("ek", [{}, {"SAHTE_HATA": "copyto"}, {"SAHTE_PGLIST": "hata"}])
def test_sirlar_cikti_ve_argumanlarda_gorunmez(ortam, ek):
    r = _calistir(ortam, **ek)
    metin = r.stdout + r.stderr + ((ortam["iz"] / "cagrilar.log").read_text() if (ortam["iz"] / "cagrilar.log").exists() else "")
    for sir in (YAZMA_ID, YAZMA_SIR, OKUMA_ID, OKUMA_SIR):
        assert sir not in metin


def test_kilit_varken_75(ortam):
    tutucu = subprocess.Popen(["flock", str(ortam["tmp"] / "kilit"), "sleep", "5"])
    try:
        time.sleep(0.5)
        r = _calistir(ortam)
    finally:
        tutucu.kill()
    assert r.returncode == 75 and _cagrilar(ortam) == []


@pytest.mark.parametrize("ek", [{}, {"SAHTE_BOZ": "1"}])
def test_gecici_dizin_her_durumda_temizlenir(ortam, ek):
    _calistir(ortam, **ek)
    assert list((ortam["tmp"] / "gecici").iterdir()) == []


def test_her_kosu_benzersiz_run_id(ortam):
    assert _calistir(ortam).returncode == 0
    assert _calistir(ortam).returncode == 0
    assert len(_depodaki(ortam, r"postgres/daily/.*/db\.dump\.gpg$")) == 2


# ── Restore yardımcıları ────────────────────────────────────────────────────


def test_adres_uret_dosyaya_yazar_15dk_varsayilan_stdoutta_yok(ortam):
    hedef = ortam["tmp"] / "adres.txt"
    r = _calistir(ortam, "adres-uret", "20260928T005000Z-0123abcd", str(hedef))
    assert r.returncode == 0, r.stderr
    assert (hedef.stat().st_mode & 0o777) == 0o600
    assert "imza-sentinel" in hedef.read_text() and "imza-sentinel" not in r.stdout + r.stderr
    [komut] = [c for _, c in _cagrilar(ortam)]
    assert komut.startswith("link --expire 15m yedek:adanaozelders-backups/postgres/daily/20260928T005000Z-0123abcd/db.dump.gpg")


@pytest.mark.parametrize("run", ["../x", "20260928", ""])
def test_adres_uret_gecersiz_run_id_reddedilir(ortam, run):
    assert _calistir(ortam, "adres-uret", run, str(ortam["tmp"] / "a")).returncode == 2
    assert _cagrilar(ortam) == []


# ── Statik sözleşme ─────────────────────────────────────────────────────────


def test_betik_sertlestirmeleri():
    metin = BETIK.read_text(encoding="utf-8")
    for parca in ("set -euo pipefail", "umask 077", "flock -n", "trap temizle EXIT",
                  "--trust-model always", "--compress-algo none", "--list-secret-keys"):
        assert parca in metin, parca
    assert "AWS_ACCESS_KEY_ID" not in metin and ".env.prod" not in metin
    assert "RCLONE_CONFIG_KAYNAK" not in metin, "okuma token'ı kullanılmamalı"
    ornek = (BETIK.parent / "pg-offsite.conf.example").read_text(encoding="utf-8")
    assert not re.search(r"^PG_ALICI_\d=[0-9A-F]{40}$", ornek, re.M), "örnekte gerçek parmak izi"
