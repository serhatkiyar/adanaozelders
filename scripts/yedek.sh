#!/bin/bash
# Adana Özel Ders — yerel günlük yedek (sunucuda: /opt/backup-scripts/yedek.sh,
# cron: /etc/cron.d/adana-yedek 03:30). PostgreSQL dump + MinIO volume tar + .env kopyası.
# Off-site şifreli DB yedeği ayrı betiktir: scripts/pg-offsite-backup.sh (03:50).
#
# 27 Eyl 2026: yedekler yalnız root'a açık — dizin 700, dosyalar 600 (umask 077).
# Önceden dizin 755 ve dump'lar 644 idi; root dışındaki yerel kullanıcılar
# kişisel veri içeren DB dump'larını okuyabiliyordu.
set -euo pipefail
umask 077

PROJE="${PROJE:-/opt/adanaozelders}"
HEDEF=$PROJE/backups
TARIH=$(date +%Y%m%d-%H%M)
DC="docker compose -f $PROJE/docker-compose.prod.yml -f $PROJE/docker-compose.staging.yml --env-file $PROJE/.env.prod"

mkdir -p "$HEDEF"
chmod 700 "$HEDEF"

source <(grep -E '^(POSTGRES_USER|POSTGRES_DB)=' $PROJE/.env.prod)

# PostgreSQL
$DC exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$HEDEF/db-$TARIH.dump"

# MinIO
docker run --rm \
  -v adana-ozel-ders-prod_miniodata:/veri:ro \
  -v "$HEDEF":/cikti \
  alpine tar czf "/cikti/minio-$TARIH.tar.gz" -C /veri .
# Tar konteyner içinde yazıldığı için bu kabuğun umask'ı uygulanmaz (644 çıkar).
chmod 600 "$HEDEF/minio-$TARIH.tar.gz"

# .env yedegi
cp "$PROJE/.env.prod" "$HEDEF/env-$TARIH.txt"

# 7 gunden eskiyi sil
find "$HEDEF" -name "db-*.dump" -mtime +7 -delete
find "$HEDEF" -name "minio-*.tar.gz" -mtime +7 -delete
find "$HEDEF" -name "env-*.txt" -mtime +7 -delete

echo "$(date '+%F %T') yedek tamam: $TARIH"
