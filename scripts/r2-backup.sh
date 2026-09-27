#!/usr/bin/env bash
# Adana Özel Ders — R2 nesne yedeği (adanaozelders-public/-private → adanaozelders-backups).
#
# Tasarım (27 Eyl 2026, onaylı):
#   r2/current/{public,private}/<anahtar>            kaynağın güncel aynası
#   r2/archive/<RUN_ID>/{public,private}/<anahtar>   bu koşuda değişen/silinen dosyanın ESKİ hali
#   r2/snapshots/<RUN_ID>/{public,private}/<anahtar> tam kopya (haftalık ya da SNAPSHOT=1);
#                                                    öncesinde içerik indirilerek derin check
#   r2/manifests/<RUN_ID>/...                        kaynak listesi + koşu durumu
#
# Kör ayna DEĞİLDİR: `rclone sync --backup-dir` kaynakta silinen/değişen dosyayı
# yedekten silmez, o koşunun archive/ dizinine TAŞIR. archive/ (90 gün),
# snapshots/ (56 gün) ve manifests/ (≥90 gün) Cloudflare'de Bucket Lock ile
# silinemez/üzerine yazılamaz; lifecycle süreyi dolduranı siler.
#
# RUN_ID = UTC zaman damgası + rastgele ek (ör. 20260927T040001Z-3f9a1c2e). Her
# koşu, yeniden deneme dahil, YENİ anahtarlar üretir: kilitli bir anahtarın
# üzerine yazmaya çalışılmaz.
#
# İki AYRI kimlik (en az yetki):
#   okuma  → Object Read,        yalnız public + private bucket (kaynağa yazamaz)
#   yazma  → Object Read & Write, yalnız backups bucket (kaynağı okuyamaz)
# Production uygulama token'ı burada KULLANILMAZ ve backups'a erişemez.
#
# Sırlar yalnız R2_YEDEK_ENV dosyasında (varsayılan /root/r2-yedek.env, izin
# 600) durur; rclone'a ortam değişkeniyle verilir, komut satırına ve loga yazılmaz.
#
# Kullanım:
#   r2-backup.sh                    günlük yedek (Pazar günü UTC otomatik snapshot)
#   SNAPSHOT=1 r2-backup.sh         günlük yedek + zorunlu snapshot
#   r2-backup.sh geri-al <yedek-yolu> <yerel-dosya>
#       Yedekteki bir nesneyi (ör. r2/current/public/profiles/x.webp ya da
#       r2/archive/<RUN_ID>/private/...) yerel dosyaya indirir, boyut ve
#       SHA-256 basar. Kaynağa YAZMAZ (okuma token'ı yazamaz zaten).
#
# Çıkış kodları: 0 başarı · 1 hata · 2 yapılandırma hatası · 75 başka koşu sürüyor

set -euo pipefail
umask 077

R2_YEDEK_ENV="${R2_YEDEK_ENV:-/root/r2-yedek.env}"
KILIT="${R2_YEDEK_KILIT:-/var/lock/adana-r2-yedek.lock}"
RCLONE="${RCLONE:-rclone}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
hata() { log "HATA: $*" >&2; }

TMP=""
temizle() { [[ -n "$TMP" && -d "$TMP" ]] && rm -rf -- "$TMP"; return 0; }
trap temizle EXIT
trap 'temizle; exit 130' INT TERM

# ── Yapılandırma ─────────────────────────────────────────────────────────────
if [[ ! -f "$R2_YEDEK_ENV" ]]; then
	hata "$R2_YEDEK_ENV bulunamadı"
	exit 2
fi
# Sır dosyası yalnız sahibine açık olmalı (grup/diğer hiçbir izin yok).
izin="$(stat -c %a "$R2_YEDEK_ENV")"
if (( (8#$izin & 8#077) != 0 )); then
	hata "$R2_YEDEK_ENV izni $izin — yalnız sahibine açık olmalı (chmod 600)"
	exit 2
fi
set -a
# shellcheck disable=SC1090
. "$R2_YEDEK_ENV"
set +a
for v in R2_YEDEK_ENDPOINT \
	R2_YEDEK_OKUMA_ACCESS_KEY_ID R2_YEDEK_OKUMA_SECRET_ACCESS_KEY \
	R2_YEDEK_YAZMA_ACCESS_KEY_ID R2_YEDEK_YAZMA_SECRET_ACCESS_KEY; do
	if [[ -z "${!v:-}" ]]; then
		hata "$v tanımlı değil"
		exit 2
	fi
done
if [[ "$R2_YEDEK_OKUMA_ACCESS_KEY_ID" == "$R2_YEDEK_YAZMA_ACCESS_KEY_ID" ]]; then
	hata "okuma ve yazma kimlikleri AYNI — iki ayrı token gerekli"
	exit 2
fi
PUBLIC_BUCKET="${R2_YEDEK_PUBLIC_BUCKET:-adanaozelders-public}"
PRIVATE_BUCKET="${R2_YEDEK_PRIVATE_BUCKET:-adanaozelders-private}"
BACKUP_BUCKET="${R2_YEDEK_BACKUP_BUCKET:-adanaozelders-backups}"
MAX_SILME="${R2_YEDEK_MAX_SILME:-20}"   # küçük veri: tam silinmeyi de yakalar; env ile yükseltilebilir
SNAPSHOT_GUNU="${R2_YEDEK_SNAPSHOT_GUNU:-7}"   # date +%u (UTC): 7 = Pazar

# rclone uzakları yalnız ortam değişkeniyle tanımlanır; config dosyası okunmaz.
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_KAYNAK_TYPE=s3 RCLONE_CONFIG_YEDEK_TYPE=s3
export RCLONE_CONFIG_KAYNAK_PROVIDER=Cloudflare RCLONE_CONFIG_YEDEK_PROVIDER=Cloudflare
export RCLONE_CONFIG_KAYNAK_ENDPOINT="$R2_YEDEK_ENDPOINT" RCLONE_CONFIG_YEDEK_ENDPOINT="$R2_YEDEK_ENDPOINT"
export RCLONE_CONFIG_KAYNAK_REGION=auto RCLONE_CONFIG_YEDEK_REGION=auto
# Token'lar bucket listeleyemez/oluşturamaz (object kapsamlı).
export RCLONE_CONFIG_KAYNAK_NO_CHECK_BUCKET=true RCLONE_CONFIG_YEDEK_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_KAYNAK_ACCESS_KEY_ID="$R2_YEDEK_OKUMA_ACCESS_KEY_ID"
export RCLONE_CONFIG_KAYNAK_SECRET_ACCESS_KEY="$R2_YEDEK_OKUMA_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_YEDEK_ACCESS_KEY_ID="$R2_YEDEK_YAZMA_ACCESS_KEY_ID"
export RCLONE_CONFIG_YEDEK_SECRET_ACCESS_KEY="$R2_YEDEK_YAZMA_SECRET_ACCESS_KEY"
# Kabuk değişkenleri rclone dışındaki komutlara sızmasın.
unset R2_YEDEK_OKUMA_ACCESS_KEY_ID R2_YEDEK_OKUMA_SECRET_ACCESS_KEY \
	R2_YEDEK_YAZMA_ACCESS_KEY_ID R2_YEDEK_YAZMA_SECRET_ACCESS_KEY

RCLONE_ORTAK=(--retries 3 --low-level-retries 10 --log-level NOTICE --stats 0)

TMP="$(mktemp -d)"

# ── geri-al: yedekten yerel dosyaya (kaynağa dokunmaz) ───────────────────────
if [[ "${1:-}" == "geri-al" ]]; then
	yol="${2:-}"
	hedef="${3:-}"
	if [[ -z "$yol" || -z "$hedef" || "$yol" != r2/* || "$yol" == *..* ]]; then
		hata "kullanım: r2-backup.sh geri-al r2/<current|archive/RUN|snapshots/RUN>/<public|private>/<anahtar> <yerel-dosya>"
		exit 2
	fi
	"$RCLONE" copyto "yedek:${BACKUP_BUCKET}/${yol}" "$hedef" "${RCLONE_ORTAK[@]}"
	log "geri alındı: $yol → $hedef boyut=$(stat -c %s "$hedef") sha256=$(sha256sum "$hedef" | cut -d' ' -f1)"
	exit 0
fi

# ── Tek koşu kilidi ──────────────────────────────────────────────────────────
exec 9>"$KILIT"
if ! flock -n 9; then
	log "başka bir R2 yedek koşusu sürüyor — çıkılıyor"
	exit 75
fi

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
BASLA="$(date -u +%FT%TZ)"
log "R2 yedek başlıyor run=$RUN_ID"

durum_yaz() {  # $1 = sonuc (basarili|basarisiz), $2 = snapshot (evet|hayir)
	printf '{"run_id":"%s","baslangic":"%s","bitis":"%s","sonuc":"%s","snapshot":"%s"}\n' \
		"$RUN_ID" "$BASLA" "$(date -u +%FT%TZ)" "$1" "$2" > "$TMP/durum.json"
	"$RCLONE" copyto "$TMP/durum.json" "yedek:${BACKUP_BUCKET}/r2/manifests/${RUN_ID}/durum.json" "${RCLONE_ORTAK[@]}" \
		|| hata "durum manifesti yazılamadı"
}

SNAP="hayir"
if [[ "${SNAPSHOT:-0}" == "1" || "$(date -u +%u)" == "$SNAPSHOT_GUNU" ]]; then
	SNAP="evet"
fi

sonuc="basarili"
for taraf in public private; do
	if [[ "$taraf" == public ]]; then kaynak_bucket="$PUBLIC_BUCKET"; else kaynak_bucket="$PRIVATE_BUCKET"; fi

	# Manifest: kaynak listesi (anahtar, boyut, son değişiklik, rclone'un ETag'den
	# türettiği md5 — çok parçalı yüklemede boş olabilir; bütünlük kanıtı DEĞİL).
	if ! "$RCLONE" lsjson -R --files-only --hash --use-server-modtime "kaynak:${kaynak_bucket}" "${RCLONE_ORTAK[@]}" > "$TMP/${taraf}.json"; then
		hata "$taraf listelenemedi"; sonuc="basarisiz"; continue
	fi
	"$RCLONE" copyto "$TMP/${taraf}.json" "yedek:${BACKUP_BUCKET}/r2/manifests/${RUN_ID}/${taraf}.json" "${RCLONE_ORTAK[@]}" \
		|| { hata "$taraf manifesti yazılamadı"; sonuc="basarisiz"; }

	# Ayna + arşiv. Değişen/silinen dosya silinmez, archive/<RUN_ID>/ altına taşınır.
	if ! "$RCLONE" sync "kaynak:${kaynak_bucket}" "yedek:${BACKUP_BUCKET}/r2/current/${taraf}" \
		--backup-dir "yedek:${BACKUP_BUCKET}/r2/archive/${RUN_ID}/${taraf}" \
		--checksum --fast-list --max-delete "$MAX_SILME" "${RCLONE_ORTAK[@]}"; then
		hata "$taraf sync başarısız"; sonuc="basarisiz"; continue
	fi
	if ! "$RCLONE" check "kaynak:${kaynak_bucket}" "yedek:${BACKUP_BUCKET}/r2/current/${taraf}" \
		--fast-list "${RCLONE_ORTAK[@]}"; then
		hata "$taraf check: kaynak ile yedek farklı"; sonuc="basarisiz"
	fi
	log "$taraf tamam"
done

if [[ "$SNAP" == "evet" && "$sonuc" == "basarili" ]]; then
	# Derin kontrol: içerik indirilerek karşılaştırılır. Günlük check ortak hash
	# bulamadığı objelerde (çok parçalı ya da harici yüklenmiş) yalnız boyuta
	# bakar; snapshot'tan önce gerçek içerik doğrulanır.
	for taraf in public private; do
		if [[ "$taraf" == public ]]; then kaynak_bucket="$PUBLIC_BUCKET"; else kaynak_bucket="$PRIVATE_BUCKET"; fi
		if ! "$RCLONE" check "kaynak:${kaynak_bucket}" "yedek:${BACKUP_BUCKET}/r2/current/${taraf}" \
			--download --fast-list "${RCLONE_ORTAK[@]}"; then
			hata "$taraf derin check (--download): içerik farklı — snapshot alınmayacak"; sonuc="basarisiz"
		fi
	done
fi

if [[ "$SNAP" == "evet" && "$sonuc" == "basarili" ]]; then
	for taraf in public private; do
		# Sunucu tarafı kopya (aynı uzak): kaynak bucket'tan veri çekilmez.
		if ! "$RCLONE" copy "yedek:${BACKUP_BUCKET}/r2/current/${taraf}" \
			"yedek:${BACKUP_BUCKET}/r2/snapshots/${RUN_ID}/${taraf}" \
			--fast-list "${RCLONE_ORTAK[@]}"; then
			hata "$taraf snapshot başarısız"; sonuc="basarisiz"
		fi
	done
elif [[ "$SNAP" == "evet" ]]; then
	SNAP="atlandi"
fi

durum_yaz "$sonuc" "$SNAP"
if [[ "$sonuc" != "basarili" ]]; then
	hata "R2 yedek BAŞARISIZ run=$RUN_ID"
	exit 1
fi
log "R2 yedek tamam run=$RUN_ID snapshot=$SNAP"
