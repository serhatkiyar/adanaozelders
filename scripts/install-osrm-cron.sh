#!/usr/bin/env bash
# Aylik OSM veri tazeleme isini SUNUCUYA kurar (cron + logrotate + uyari).
#
# Neden ayri bir kurulum betigi: "ayda bir su komutu calistirin" seklindeki bir
# dokumantasyon maddesi unutulur. Unutuldugunda da SESSIZCE bozulur — rota
# eskiyen yol agiyla hesaplanmaya devam eder, /health "connected" der, kimse
# fark etmez. Bu yuzden is (a) zamanlayiciya baglanir, (b) basarisizliginda
# GURULTU cikarir.
#
# Kurar:
#   /etc/cron.d/osrm-adana        — ayin 1'i 04:00, MAILTO ile hata bildirimi
#   /etc/logrotate.d/osrm-adana   — log sinirsiz buyumesin
#   /var/log/osrm-update.log      — calisma gunlugu
#
# Kullanim (sunucuda, root ile):
#   sudo ./scripts/install-osrm-cron.sh --uygulama-dizini /uygulama \
#        --mail uyari@alanadiniz.com [--webhook https://...] [--compose-file ...]
#   sudo ./scripts/install-osrm-cron.sh --kaldir
#
# Not: cron KURULUMU dogrular ama isin gercekten calistigini kanitlamaz.
# Kurulumdan sonra bir kez elle calistirin:
#   sudo -u root /uygulama/scripts/update-osrm-data.sh --check
set -euo pipefail

APP_DIR=""
MAILTO=""
WEBHOOK=""
COMPOSE_FILE_ARG=""
COMPOSE_ARGS_VAL="--env-file .env.prod"
SCHEDULE="0 4 1 * *"     # her ayin 1'i, 04:00 (dusuk trafik)
LOG="/var/log/osrm-update.log"
KALDIR=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uygulama-dizini) APP_DIR="$2"; shift 2 ;;
    --mail)            MAILTO="$2"; shift 2 ;;
    --webhook)         WEBHOOK="$2"; shift 2 ;;
    --compose-file)    COMPOSE_FILE_ARG="$2"; shift 2 ;;
    --compose-args)    COMPOSE_ARGS_VAL="$2"; shift 2 ;;
    --schedule)        SCHEDULE="$2"; shift 2 ;;
    --kaldir)          KALDIR=1; shift ;;
    *) echo "Bilinmeyen argüman: $1" >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "root olarak calistirin (sudo)." >&2; exit 1; }

if (( KALDIR )); then
  rm -f /etc/cron.d/osrm-adana /etc/logrotate.d/osrm-adana
  echo "Kaldirildi: /etc/cron.d/osrm-adana, /etc/logrotate.d/osrm-adana"
  exit 0
fi

[[ -n "$APP_DIR" ]] || { echo "--uygulama-dizini zorunlu." >&2; exit 2; }
SCRIPT="$APP_DIR/scripts/update-osrm-data.sh"
[[ -x "$SCRIPT" ]] || { echo "Bulunamadi/calistirilabilir degil: $SCRIPT" >&2; exit 1; }

touch "$LOG"; chmod 0640 "$LOG"

{
  echo "# Adana Ozel Ders — aylik OSM yol agi tazeleme."
  echo "# Betik atomiktir: gecici klasorde hazirlar, dogrular, takas eder,"
  echo "# readiness testi yapar, basarisizsa ESKI veriye doner."
  echo "# Sifir-disi cikis = MAILTO'ya posta (rollback basarili olsa BILE veri eskidir)."
  echo "SHELL=/bin/bash"
  echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  [[ -n "$MAILTO" ]] && echo "MAILTO=$MAILTO"
  [[ -n "$WEBHOOK" ]] && echo "ALERT_WEBHOOK=$WEBHOOK"
  [[ -n "$COMPOSE_FILE_ARG" ]] && echo "COMPOSE_FILE=$COMPOSE_FILE_ARG"
  echo "COMPOSE_ARGS=$COMPOSE_ARGS_VAL"
  echo "$SCHEDULE root $SCRIPT >> $LOG 2>&1"
  # Haftalik hafif kontrol: veri tazelenmese de rota YIGININ ayakta oldugunu
  # dogrular (OSRM konteyneri sessizce olmuş olabilir).
  echo "30 5 * * 1 root $SCRIPT --check >> $LOG 2>&1"
} > /etc/cron.d/osrm-adana
chmod 0644 /etc/cron.d/osrm-adana

cat > /etc/logrotate.d/osrm-adana <<EOF
$LOG {
    monthly
    rotate 12
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
}
EOF

echo "Kuruldu:"
echo "  /etc/cron.d/osrm-adana      ($SCHEDULE — aylik tazeleme + haftalik --check)"
echo "  /etc/logrotate.d/osrm-adana (12 ay saklama)"
echo "  $LOG"
echo
echo "SIMDI BIR KEZ ELLE DOGRULAYIN (cron'un calistigini varsaymayin):"
echo "  $SCRIPT --check"
echo "  tail -f $LOG"
