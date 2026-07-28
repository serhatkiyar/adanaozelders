#!/usr/bin/env bash
# Adana Özel Ders — yedekten geri yükleme PROVASI.
#
# "Yedeğim var" ile "yedeğimden dönebiliyorum" farklı şeylerdir. Bu script en
# son dump'ı GEÇİCİ bir veritabanına yükler, şema ve satır sayılarını doğrular,
# sonra geçici veritabanını siler. ÜRETİM VERİSİNE DOKUNMAZ.
#
# Ayda bir çalıştırın:
#   ./scripts/restore-drill.sh
#
# Başarısız olursa yedekleme zincirinde bir sorun var demektir — dump bozuk,
# eksik ya da hiç üretilmiyor olabilir. Bunu felaket anında değil, provada
# öğrenmek istersiniz.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/adana}"
DRILL_DB="${DRILL_DB:-adana_restore_drill}"

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

LATEST="$(ls -t "$BACKUP_DIR"/adana-*.sql.gz 2>/dev/null | head -n1 || true)"
if [[ -z "$LATEST" ]]; then
	echo "HATA: $BACKUP_DIR içinde dump yok — yedekleme HİÇ çalışmamış" >&2
	exit 1
fi

AGE_HOURS=$(( ( $(date +%s) - $(stat -c%Y "$LATEST") ) / 3600 ))
echo "En son yedek: $LATEST (${AGE_HOURS} saat önce)"
if (( AGE_HOURS > 48 )); then
	echo "UYARI: yedek 48 saatten eski — cron çalışmıyor olabilir" >&2
fi

psql_in() {
	docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
		psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 "$@"
}

cleanup() {
	echo "geçici veritabanı siliniyor: $DRILL_DB"
	psql_in -d postgres -c "DROP DATABASE IF EXISTS $DRILL_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "geçici veritabanı oluşturuluyor: $DRILL_DB"
psql_in -d postgres -c "DROP DATABASE IF EXISTS $DRILL_DB;" >/dev/null
psql_in -d postgres -c "CREATE DATABASE $DRILL_DB;" >/dev/null

echo "dump geri yükleniyor…"
gunzip -c "$LATEST" | psql_in -d "$DRILL_DB" >/dev/null

echo
echo "── Doğrulama ──"
# Para ve kimlik tabloları: boş dönerlerse dump işe yaramaz.
for t in orders payments clients tutors bookings audit_logs; do
	COUNT="$(psql_in -d "$DRILL_DB" -tAc "SELECT count(*) FROM $t;" | tr -d '[:space:]')"
	printf '  %-14s %s satır\n' "$t" "$COUNT"
done

TABLES="$(psql_in -d "$DRILL_DB" -tAc \
	"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d '[:space:]')"
echo "  toplam tablo:  $TABLES"

if (( TABLES < 50 )); then
	echo >&2
	echo "HATA: yalnız $TABLES tablo geri yüklendi (beklenen ~79) — dump EKSİK" >&2
	exit 1
fi

echo
echo "PROVA BAŞARILI — bu yedekten dönülebilir."
