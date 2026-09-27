#!/usr/bin/env bash
# Adana Özel Ders — Postgres yedeği (üretim).
#
# Escrow para kayıtları, audit log ve KVKK kapsamındaki kullanıcı verisi tek
# diskte ve kopyasız duruyordu. Bu script günlük dump alır, şifreler ve uzak
# depoya iter.
#
# Kurulum (sunucuda, kök dizinde):
#   chmod +x scripts/backup-postgres.sh
#   crontab -e
#   0 3 * * * cd /opt/adana-ozel-ders && ./scripts/backup-postgres.sh >> /var/log/adana-backup.log 2>&1
#
# Uzak depo (restic + Backblaze B2, ~1 $/ay) — ilk kurulum:
#   export RESTIC_REPOSITORY="b2:adana-yedek:/postgres"
#   export RESTIC_PASSWORD="uzun-rastgele-parola"   # BUNU KAYBETMEYİN
#   export B2_ACCOUNT_ID=... B2_ACCOUNT_KEY=...
#   restic init
#
# NOT: Provası yapılmamış yedek, yedek sayılmaz.
#      Ayda bir `scripts/restore-drill.sh` çalıştırın.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/adana}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "HATA: $ENV_FILE bulunamadı (script proje kökünden çalıştırılmalı)" >&2
	exit 1
fi

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/adana-$STAMP.sql.gz"

echo "[$(date -Is)] dump başlıyor → $OUT"

# --clean --if-exists: dump'ı boş OLMAYAN bir veritabanına da geri yükleyebilmek
# için. -Fp (düz SQL) tercih edildi: gzip ile küçülür ve gerektiğinde gözle
# incelenebilir/kısmi kurtarma yapılabilir.
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
	pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
	| gzip -9 > "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[$(date -Is)] dump tamam ($SIZE)"

# Boş/bozuk dump sessizce birikmesin: gzip bütünlüğü + asgari boyut kontrolü.
gzip -t "$OUT"
MIN_BYTES="${MIN_BYTES:-10240}"
ACTUAL="$(stat -c%s "$OUT")"
if (( ACTUAL < MIN_BYTES )); then
	echo "HATA: dump şüpheli derecede küçük ($ACTUAL bayt) — yedek geçersiz" >&2
	exit 1
fi

# MinIO nesneleri — varsayılan KAPALI (27 Eyl 2026, R2 geçişi).
#
# Dosyalar artık Cloudflare R2'de; MinIO yalnız geçiş için `eski-depo`
# profilinde durur. Nesne yedeği ileride ayrı token'lı `adanaozelders-backups`
# bucket'ına taşınacak. Aynalama yalnız BACKUP_MINIO_ENABLED=true iken çalışır
# ve başarısız olsa bile PostgreSQL dump'ının uzak depoya (restic) itilmesini
# DURDURMAZ: hata kaydedilir, betik restic'ten SONRA sıfırdan farklı kodla çıkar.
MINIO_MIRROR_FAILED=0
if [[ "${BACKUP_MINIO_ENABLED:-false}" == "true" ]]; then
	if command -v mc >/dev/null 2>&1; then
		echo "[$(date -Is)] MinIO aynalanıyor"
		if ! mc mirror --overwrite --remove local/"${AWS_BUCKET_NAME:-avatars}" \
			"$BACKUP_DIR/minio/${AWS_BUCKET_NAME:-avatars}"; then
			echo "HATA: MinIO aynalama başarısız — DB yedeği yine de sürüyor" >&2
			MINIO_MIRROR_FAILED=1
		fi
	else
		echo "UYARI: mc (MinIO client) yok — nesne deposu YEDEKLENMEDİ" >&2
		MINIO_MIRROR_FAILED=1
	fi
else
	echo "[$(date -Is)] MinIO aynalama kapalı (BACKUP_MINIO_ENABLED=false)"
fi

# Uzak depoya it (şifreli). RESTIC_REPOSITORY tanımlı değilse atlanır ama
# yerel-tek-kopya durumu sessiz kalmasın diye uyarır.
if [[ -n "${RESTIC_REPOSITORY:-}" ]]; then
	echo "[$(date -Is)] restic'e itiliyor"
	restic backup "$BACKUP_DIR" --tag adana --exclude-caches
	restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
else
	echo "UYARI: RESTIC_REPOSITORY tanımsız — yedek YALNIZCA bu sunucuda." >&2
	echo "       Disk kaybı = veri kaybı. Uzak depoyu yapılandırın." >&2
fi

find "$BACKUP_DIR" -name 'adana-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
if (( MINIO_MIRROR_FAILED )); then
	echo "[$(date -Is)] bitti — DB yedeği tamam, MinIO aynalama BAŞARISIZ" >&2
	exit 2
fi
echo "[$(date -Is)] bitti"
