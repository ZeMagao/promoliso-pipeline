#!/usr/bin/env bash
# Backup quente do SQLite do n8n + upload pro Cloudflare R2.
# Roda como 'promo' via promo-backup.service (timer diario 03:30 BRT).
set -euo pipefail
DATA=/opt/promoliso/data/.n8n
DEST=/opt/promoliso/backups
STAMP=$(date +%Y%m%d-%H%M%S)
RETENCAO_LOCAL_DIAS=7
RETENCAO_R2_DIAS=30
mkdir -p "$DEST"

# --- backup local ---
sqlite3 "$DATA/database.sqlite" ".backup '$DEST/database-$STAMP.sqlite'"
cp "$DATA/config" "$DEST/config-$STAMP"       # encryptionKey: SEM ela o backup e inutil
gzip -9 -f "$DEST/database-$STAMP.sqlite"
ARQ="$DEST/backup-$STAMP.tar.gz"
tar -czf "$ARQ" -C "$DEST" "database-$STAMP.sqlite.gz" "config-$STAMP"
rm -f "$DEST/database-$STAMP.sqlite.gz" "$DEST/config-$STAMP"
find "$DEST" -name 'backup-*.tar.gz' -mtime "+$RETENCAO_LOCAL_DIAS" -delete
echo "$(date -Is) backup local OK: $ARQ ($(du -h "$ARQ" | cut -f1))"

# --- upload pro R2 (silenciosamente pulado enquanto nao configurado) ---
CONF=/home/promo/.config/rclone/rclone.conf
if [ ! -f "$CONF" ] || [ ! -f /etc/promo-r2-bucket ]; then
  echo "$(date -Is) AVISO: R2 nao configurado - backup so LOCAL. Rode: promo-r2-setup.sh"
  exit 0
fi
BUCKET=$(cat /etc/promo-r2-bucket)
if /usr/local/bin/rclone --config "$CONF" copy "$ARQ" "r2:$BUCKET/n8n/" --s3-no-check-bucket; then
  echo "$(date -Is) upload R2 OK: r2:$BUCKET/n8n/$(basename "$ARQ")"
  /usr/local/bin/rclone --config "$CONF" delete "r2:$BUCKET/n8n/" --min-age "${RETENCAO_R2_DIAS}d" \
    && echo "$(date -Is) retencao R2 aplicada (>${RETENCAO_R2_DIAS}d removidos)"
  echo "$(date -Is) copias no R2: $(/usr/local/bin/rclone --config "$CONF" ls "r2:$BUCKET/n8n/" | wc -l)"
else
  echo "$(date -Is) ERRO: upload pro R2 FALHOU (backup local esta ok)" >&2
  exit 1
fi
