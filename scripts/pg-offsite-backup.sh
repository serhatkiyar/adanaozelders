#!/usr/bin/env bash
# Adana Özel Ders — PostgreSQL dump'larının şifreli off-site yedeği (R2).
#
# yedek.sh (03:30) yerel dump'ı üretir; bu betik (03:50) onu DOKUNMADAN okur:
#   1. dump seçimi: en yeni db-*.dump — taze (≤ PG_MAX_YAS_DK), asgari boyutta,
#      en az PG_MIN_YAS_SN'dir değişmemiş, bekleme boyunca boyutu/mtime'ı sabit,
#      hiçbir süreç tarafından açık değil, pg_dump çalışmıyor, pg_restore --list geçiyor.
#      Biri tutmazsa şifreleme/yükleme YAPILMAZ.
#   2. GPG public-key şifreleme: iki alıcı, yalnız TAM parmak iziyle. Keyring'de
#      gizli anahtar bulunursa betik çalışmaz (VPS decrypt edememeli).
#   3. Yükleme: yalnız .gpg ve manifest; ham dump hiçbir rclone argümanında yok.
#      postgres/daily/<RUN_ID>/{db.dump.gpg,manifest.json}
#   4. Doğrulama: .gpg geri indirilir, SHA-256 + boyut karşılaştırılır.
#   5. Aylık: UTC ayının ilk başarılı koşusunda postgres/monthly/<YYYY-MM>/<RUN_ID>/
#      altına aynı şifreli obje backups bucket'ı içinde sunucu tarafında kopyalanır.
#
# Kimlik: /root/r2-yedek.env içindeki YAZMA token'ı (yalnız backups bucket).
# Okuma token'ı ve production uygulama kimliği kullanılmaz.
# Parmak izleri (sır değil): /etc/adana-yedek/pg-offsite.conf
#
# Kullanım:
#   pg-offsite-backup.sh                         yedek al
#   pg-offsite-backup.sh adres-uret <RUN_ID> <dosya> [süre]
#       Restore için .gpg'nin imzalı indirme adresini (varsayılan 15m) DOSYAYA
#       yazar (izin 600); adres stdout'a basılmaz.
#   pg-offsite-backup.sh manifest <RUN_ID>       manifesti basar (sır içermez)
#
# Çıkış: 0 başarı · 1 hata · 2 yapılandırma/ön koşul · 3 dump uygun değil · 75 kilit

set -euo pipefail
umask 077

KONF="${PG_OFFSITE_CONF:-/etc/adana-yedek/pg-offsite.conf}"
R2_YEDEK_ENV="${R2_YEDEK_ENV:-/root/r2-yedek.env}"
KILIT="${PG_OFFSITE_KILIT:-/var/lock/adana-pg-offsite.lock}"
RCLONE="${RCLONE:-rclone}"
DOCKER="${DOCKER:-docker}"
GPG="${GPG:-gpg}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
hata() { log "HATA: $*" >&2; }

TMP=""
temizle() { [[ -n "$TMP" && -d "$TMP" ]] && rm -rf -- "$TMP"; return 0; }
trap temizle EXIT
trap 'temizle; exit 130' INT TERM

sadece_sahibi() {  # $1 dosya/dizin: grup/diğer izni olmamalı
	local izin; izin="$(stat -c %a "$1")"
	(( (8#$izin & 8#077) == 0 ))
}

# ── Yapılandırma ─────────────────────────────────────────────────────────────
for f in "$KONF" "$R2_YEDEK_ENV"; do
	[[ -f "$f" ]] || { hata "$f bulunamadı"; exit 2; }
done
sadece_sahibi "$R2_YEDEK_ENV" || { hata "$R2_YEDEK_ENV yalnız sahibine açık olmalı (chmod 600)"; exit 2; }
# shellcheck disable=SC1090
. "$KONF"
PG_YEDEK_DIZIN="${PG_YEDEK_DIZIN:-/opt/adanaozelders/backups}"
PG_GNUPGHOME="${PG_GNUPGHOME:-/etc/adana-yedek/gnupg}"
PG_POSTGRES_CONTAINER="${PG_POSTGRES_CONTAINER:-adana-ozel-ders-prod-postgres-1}"
PG_MAX_YAS_DK="${PG_MAX_YAS_DK:-180}"
PG_MIN_BOYUT="${PG_MIN_BOYUT:-102400}"
PG_MIN_YAS_SN="${PG_MIN_YAS_SN:-180}"
PG_STABIL_BEKLE="${PG_STABIL_BEKLE:-15}"
BACKUP_BUCKET="${R2_YEDEK_BACKUP_BUCKET:-adanaozelders-backups}"

# OpenPGP parmak izi: v4 anahtarda 40, v5/v6 anahtarda 64 onaltılık hane.
FPR_RE='^([0-9A-F]{40}|[0-9A-F]{64})$'
A1="${PG_ALICI_1:-}"; A2="${PG_ALICI_2:-}"
if [[ ! "$A1" =~ $FPR_RE || ! "$A2" =~ $FPR_RE ]]; then
	hata "PG_ALICI_1/PG_ALICI_2 tam 40 veya 64 haneli (büyük harf onaltılık) parmak izi olmalı"
	exit 2
fi
[[ "$A1" != "$A2" ]] || { hata "iki alıcı aynı parmak izi — iki ayrı anahtar gerekli"; exit 2; }

set -a
# shellcheck disable=SC1090
. "$R2_YEDEK_ENV"
set +a
for v in R2_YEDEK_ENDPOINT R2_YEDEK_YAZMA_ACCESS_KEY_ID R2_YEDEK_YAZMA_SECRET_ACCESS_KEY; do
	[[ -n "${!v:-}" ]] || { hata "$v tanımlı değil"; exit 2; }
done
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_YEDEK_TYPE=s3 RCLONE_CONFIG_YEDEK_PROVIDER=Cloudflare RCLONE_CONFIG_YEDEK_REGION=auto
export RCLONE_CONFIG_YEDEK_NO_CHECK_BUCKET=true RCLONE_CONFIG_YEDEK_ENDPOINT="$R2_YEDEK_ENDPOINT"
export RCLONE_CONFIG_YEDEK_ACCESS_KEY_ID="$R2_YEDEK_YAZMA_ACCESS_KEY_ID"
export RCLONE_CONFIG_YEDEK_SECRET_ACCESS_KEY="$R2_YEDEK_YAZMA_SECRET_ACCESS_KEY"
# Okuma token'ı bu betikte hiç kullanılmaz; tüm sır kabuk değişkenleri temizlenir.
unset R2_YEDEK_YAZMA_ACCESS_KEY_ID R2_YEDEK_YAZMA_SECRET_ACCESS_KEY \
	R2_YEDEK_OKUMA_ACCESS_KEY_ID R2_YEDEK_OKUMA_SECRET_ACCESS_KEY
RC=(--retries 3 --low-level-retries 10 --log-level NOTICE --stats 0)
Y="yedek:${BACKUP_BUCKET}/postgres"

TMP="$(mktemp -d)"
RUN_RE='^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$'

# ── Yardımcı komutlar ────────────────────────────────────────────────────────
if [[ "${1:-}" == "adres-uret" ]]; then
	run="${2:-}"; hedef="${3:-}"; sure="${4:-15m}"
	[[ "$run" =~ $RUN_RE && -n "$hedef" ]] || { hata "kullanım: adres-uret <RUN_ID> <dosya> [süre]"; exit 2; }
	( umask 077; "$RCLONE" link --expire "$sure" "$Y/daily/$run/db.dump.gpg" "${RC[@]}" > "$hedef" )
	chmod 600 "$hedef"
	log "imzalı adres $sure geçerli olarak $hedef dosyasına yazıldı (stdout'a basılmadı)"
	exit 0
fi
if [[ "${1:-}" == "manifest" ]]; then
	run="${2:-}"
	[[ "$run" =~ $RUN_RE ]] || { hata "kullanım: manifest <RUN_ID>"; exit 2; }
	"$RCLONE" cat "$Y/daily/$run/manifest.json" "${RC[@]}"
	exit 0
fi

exec 9>"$KILIT"
flock -n 9 || { log "başka bir PG off-site koşusu sürüyor — çıkılıyor"; exit 75; }

# ── 1. GPG: yalnız public key, iki tam parmak izi ────────────────────────────
[[ -d "$PG_GNUPGHOME" ]] && sadece_sahibi "$PG_GNUPGHOME" \
	|| { hata "$PG_GNUPGHOME yok ya da başkalarına açık (chmod 700)"; exit 2; }
# Çıktılar önce değişkene alınır: pipefail altında `… | grep -q` erken çıkınca
# SIGPIPE ile koşul yanlışlıkla "yok" dönebilir (fail-open). Okunamazsa fail-closed.
gizli="$("$GPG" --homedir "$PG_GNUPGHOME" --batch --with-colons --list-secret-keys 2>/dev/null)" \
	|| { hata "gizli anahtar listesi okunamadı — çalışma reddedildi"; exit 2; }
if grep -q '^sec' <<<"$gizli"; then
	hata "keyring'de GİZLİ anahtar var — VPS decrypt edebilmemeli; çalışma reddedildi"
	exit 2
fi
if [[ -d "$PG_GNUPGHOME/private-keys-v1.d" ]] && [[ -n "$(ls -A "$PG_GNUPGHOME/private-keys-v1.d")" ]]; then
	hata "private-keys-v1.d boş değil — gizli anahtar malzemesi var; çalışma reddedildi"
	exit 2
fi
declare -A ALT  # alıcı parmak izi → şifreleme alt anahtar kimlikleri
for a in "$A1" "$A2"; do
	satirlar="$("$GPG" --homedir "$PG_GNUPGHOME" --batch --with-colons --list-keys "$a" 2>/dev/null)" \
		|| { hata "alıcı keyring'de yok: $a"; exit 2; }
	grep -q "^fpr:::::::::${a}:" <<<"$satirlar" || { hata "alıcı parmak izi birebir eşleşmedi: $a"; exit 2; }
	# Geçerli (süresi dolmamış/iptal edilmemiş) şifreleme alt anahtarlarının kimlikleri.
	ALT[$a]="$(awk -F: '$1=="sub" && $12 ~ /e/ && $2 !~ /[erd]/ {print $5}' <<<"$satirlar")"
	[[ -n "${ALT[$a]}" ]] || { hata "alıcının geçerli şifreleme alt anahtarı yok: $a"; exit 2; }
done

# ── 2. Dump seçimi ve doğrulama ──────────────────────────────────────────────
dump="$(ls -1t "$PG_YEDEK_DIZIN"/db-*.dump 2>/dev/null | head -1 || true)"
uygun_degil() { hata "dump uygun değil: $* — şifreleme/yükleme yapılmadı"; exit 3; }
[[ -n "$dump" && -f "$dump" ]] || uygun_degil "db-*.dump bulunamadı"
simdi=$(date +%s); mtime=$(stat -c %Y "$dump"); boyut=$(stat -c %s "$dump")
(( simdi - mtime <= PG_MAX_YAS_DK * 60 )) || uygun_degil "$(basename "$dump") $(( (simdi - mtime) / 60 )) dk eski (en fazla $PG_MAX_YAS_DK)"
(( boyut >= PG_MIN_BOYUT )) || uygun_degil "$(basename "$dump") $boyut bayt (en az $PG_MIN_BOYUT)"
(( simdi - mtime >= PG_MIN_YAS_SN )) || uygun_degil "$(basename "$dump") $(( simdi - mtime )) sn önce değişti (en az $PG_MIN_YAS_SN sn sabit olmalı)"
sleep "$PG_STABIL_BEKLE"
[[ "$(stat -c %s "$dump")" == "$boyut" && "$(stat -c %Y "$dump")" == "$mtime" ]] \
	|| uygun_degil "$(basename "$dump") bekleme sırasında değişti (hâlâ yazılıyor)"
acik="$(find /proc/[0-9]*/fd -maxdepth 1 -lname "$(readlink -f "$dump")" -print -quit 2>/dev/null || true)"
if [[ -n "$acik" ]]; then
	uygun_degil "$(basename "$dump") bir süreç tarafından açık"
fi
if pgrep -x pg_dump >/dev/null 2>&1; then
	uygun_degil "çalışan bir pg_dump süreci var"
fi
if ! "$DOCKER" exec -i "$PG_POSTGRES_CONTAINER" pg_restore --list < "$dump" > "$TMP/liste.txt" 2>/dev/null; then
	uygun_degil "pg_restore --list başarısız (bozuk ya da yarım dump)"
fi
tablo_veri=$(grep -c ' TABLE DATA ' "$TMP/liste.txt" || true)
(( tablo_veri > 0 )) || uygun_degil "pg_restore --list TABLE DATA girdisi yok"
duz_sha=$(sha256sum "$dump" | cut -d' ' -f1)
log "dump uygun: $(basename "$dump") boyut=$boyut table_data=$tablo_veri"

# ── 3. Şifreleme ────────────────────────────────────────────────────────────
mkdir "$TMP/yukle"
GPGF="$TMP/yukle/db.dump.gpg"
"$GPG" --homedir "$PG_GNUPGHOME" --batch --no-tty --quiet --trust-model always \
	--recipient "$A1" --recipient "$A2" --compress-algo none \
	--output "$GPGF" --encrypt "$dump" || { hata "şifreleme başarısız"; exit 1; }
# Paket doğrulaması: şifreli OpenPGP ve iki alıcının alt anahtarına şifrelenmiş olmalı.
paket_ids="$("$GPG" --homedir "$PG_GNUPGHOME" --batch --list-packets "$GPGF" 2>/dev/null \
	| awk '/^:pubkey enc packet:/ {for (i=1;i<=NF;i++) if ($i=="keyid") print $(i+1)}' | sort -u || true)"
[[ -n "$paket_ids" ]] || { hata "şifreli dosyada pubkey paketi yok — yükleme yapılmadı"; exit 1; }
# Her alıcının en az bir alt anahtarı pakette olmalı; pakette başka alıcı olmamalı.
izinli="$(printf '%s\n' "${ALT[$A1]}" "${ALT[$A2]}" | sort -u)"
for a in "$A1" "$A2"; do
	grep -qxFf <(printf '%s\n' "${ALT[$a]}") <<<"$paket_ids" \
		|| { hata "şifreli dosya $a alıcısına şifrelenmemiş — yükleme yapılmadı"; exit 1; }
done
yabanci="$(grep -vxFf <(printf '%s\n' "$izinli") <<<"$paket_ids" || true)"
if [[ -n "$yabanci" ]]; then
	hata "şifreli dosyada beklenmeyen alıcı var — yükleme yapılmadı"; exit 1
fi
if cmp -s "$dump" "$GPGF"; then hata "şifreli dosya düz dump ile aynı — yükleme yapılmadı"; exit 1; fi
sifreli_sha=$(sha256sum "$GPGF" | cut -d' ' -f1); sifreli_boyut=$(stat -c %s "$GPGF")

# ── 4. Manifest, yükleme ve geri indirme doğrulaması ────────────────────────
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
ZAMAN="$(date -u +%FT%TZ)"
printf '{"run_id":"%s","zaman_utc":"%s","dump_adi":"%s","duz_sha256":"%s","duz_boyut":%s,"sifreli_sha256":"%s","sifreli_boyut":%s,"table_data":%s,"alicilar":["%s","%s"]}\n' \
	"$RUN_ID" "$ZAMAN" "$(basename "$dump")" "$duz_sha" "$boyut" "$sifreli_sha" "$sifreli_boyut" "$tablo_veri" "$A1" "$A2" \
	> "$TMP/yukle/manifest.json"
HEDEF="$Y/daily/$RUN_ID"
"$RCLONE" copyto "$GPGF" "$HEDEF/db.dump.gpg" "${RC[@]}" || { hata "yükleme başarısız run=$RUN_ID"; exit 1; }
"$RCLONE" copyto "$TMP/yukle/manifest.json" "$HEDEF/manifest.json" "${RC[@]}" || { hata "manifest yüklenemedi run=$RUN_ID"; exit 1; }
"$RCLONE" copyto "$HEDEF/db.dump.gpg" "$TMP/dogrula.gpg" "${RC[@]}" || { hata "doğrulama indirmesi başarısız run=$RUN_ID"; exit 1; }
[[ "$(sha256sum "$TMP/dogrula.gpg" | cut -d' ' -f1)" == "$sifreli_sha" && "$(stat -c %s "$TMP/dogrula.gpg")" == "$sifreli_boyut" ]] \
	|| { hata "R2'deki obje yerel şifreli dosyayla eşleşmiyor run=$RUN_ID"; exit 1; }
liste="$("$RCLONE" lsf "$HEDEF/" "${RC[@]}")" || { hata "R2 listelenemedi run=$RUN_ID"; exit 1; }
grep -qx 'manifest.json' <<<"$liste" || { hata "manifest R2'de görünmüyor run=$RUN_ID"; exit 1; }
log "günlük yedek tamam run=$RUN_ID sifreli_sha256=$sifreli_sha boyut=$sifreli_boyut"

# ── 5. Aylık kopya (UTC ayının ilk başarılı koşusu) ─────────────────────────
AY="$(date -u +%Y-%m)"
aylik_liste="$("$RCLONE" lsf -R --files-only "$Y/monthly/$AY/" "${RC[@]}" 2>/dev/null || true)"
if grep -q 'db.dump.gpg$' <<<"$aylik_liste"; then
	log "aylık kopya bu ay ($AY) zaten var — atlandı"
else
	# Aynı uzak içinde sunucu tarafı kopya: yeniden şifreleme/yükleme yok.
	"$RCLONE" copyto "$HEDEF/db.dump.gpg" "$Y/monthly/$AY/$RUN_ID/db.dump.gpg" "${RC[@]}" \
		&& "$RCLONE" copyto "$HEDEF/manifest.json" "$Y/monthly/$AY/$RUN_ID/manifest.json" "${RC[@]}" \
		|| { hata "aylık kopya başarısız ($AY) run=$RUN_ID"; exit 1; }
	log "aylık kopya oluşturuldu: monthly/$AY/$RUN_ID"
fi
log "PG off-site yedek tamam run=$RUN_ID"
