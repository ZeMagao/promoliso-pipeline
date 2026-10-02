#!/usr/bin/env bash
# Backup quente do SQLite do n8n + upload pro Cloudflare R2.
# Roda como 'promo' via promo-backup.service (timer diario 03:30 BRT).
set -euo pipefail
DATA=/opt/promoliso/data/.n8n
# PROMO_BACKUP_DEST / PROMO_BACKUP_SEM_UPLOAD existem para o ensaio de restauracao (sem tocar no R2)
DEST=${PROMO_BACKUP_DEST:-/opt/promoliso/backups}
STAMP=$(date +%Y%m%d-%H%M%S)
RETENCAO_LOCAL_DIAS=7
RETENCAO_R2_DIAS=30
mkdir -p "$DEST"

# --- codigo e configuracao que vivem FORA do banco (02/10/2026) ---
# Ate aqui o backup tinha 2 arquivos: o sqlite e o config. Tudo o que roda fora do n8n existia so
# no disco do VPS (e parte no repo): os dois patches no no do Instagram (token e retry por filho),
# o renderizador com o sharp nativo, a ponte, os 25 units, os scripts, o token do Instagram e o
# destino dos alertas. Sem o token, restaurar exige reautorizar no Meta.
# Fica de fora o que se reconstroi sozinho: node_modules do n8n (npm install n8n@<versao>) e o cache
# de imagens (o promo-cdn rebaixa). Segredos entram: o bucket e privado e ja guarda a encryptionKey.
CODIGO=(
  opt/promoliso/analytics opt/promoliso/renderer opt/promoliso/cdn opt/promoliso/design
  opt/promoliso/workflows opt/promoliso/export-workflows.cjs opt/promoliso/promo-fila-writeback.cjs
  opt/promoliso/deploy-vps.sh opt/promoliso/ig-set-token.cjs
  opt/promoliso/package.json opt/promoliso/package-lock.json
  opt/promoliso/data/.n8n/nodes opt/promoliso/cdn-cache/_ponte/apelido
  etc/caddy/Caddyfile etc/promoliso etc/promo-r2-bucket
  home/promo/ig-token.json var/lib/promo-vigia
)
for f in /usr/local/bin/promo-* /etc/systemd/system/promo-*; do CODIGO+=("${f#/}"); done
EXISTENTES=()
for c in "${CODIGO[@]}"; do [ -e "/$c" ] && EXISTENTES+=("$c"); done

if [ "${1:-}" = "--listar" ]; then
  # so mostra o que entraria e quanto pesa; nao grava nada
  printf '%s\n' "${EXISTENTES[@]}"
  du -sch "${EXISTENTES[@]/#//}" 2>/dev/null | tail -1
  exit 0
fi

# --- backup local ---
sqlite3 "$DATA/database.sqlite" ".backup '$DEST/database-$STAMP.sqlite'"
cp "$DATA/config" "$DEST/config-$STAMP"       # encryptionKey: SEM ela o backup e inutil
gzip -9 -f "$DEST/database-$STAMP.sqlite"

# O pacote de codigo NUNCA pode derrubar o backup do banco: se o tar falhar (arquivo mudando no
# meio, permissao), o banco segue sozinho, como antes de 02/10, e o aviso vai pro log.
EXTRA=()
umask 077
# tar: 0 = ok, 1 = algum arquivo mudou durante a leitura (aceitavel: e um cache ou log), 2 = falha
RC=0
tar -czf "$DEST/codigo-$STAMP.tar.gz" -C / --warning=no-file-changed \
  --exclude='*/node_modules/.cache' "${EXISTENTES[@]}" || RC=$?
if [ "$RC" -le 1 ]; then
  EXTRA=("codigo-$STAMP.tar.gz")
else
  echo "$(date -Is) AVISO: pacote de codigo falhou (tar saiu com $RC) - backup segue so com o banco" >&2
  rm -f "$DEST/codigo-$STAMP.tar.gz"
fi

ARQ="$DEST/backup-$STAMP.tar.gz"
tar -czf "$ARQ" -C "$DEST" "database-$STAMP.sqlite.gz" "config-$STAMP" "${EXTRA[@]}"
rm -f "$DEST/database-$STAMP.sqlite.gz" "$DEST/config-$STAMP" "$DEST/codigo-$STAMP.tar.gz"
find "$DEST" -name 'backup-*.tar.gz' -mtime "+$RETENCAO_LOCAL_DIAS" -delete
echo "$(date -Is) backup local OK: $ARQ ($(du -h "$ARQ" | cut -f1))"

# --- upload pro R2 (silenciosamente pulado enquanto nao configurado) ---
if [ "${PROMO_BACKUP_SEM_UPLOAD:-0}" = "1" ]; then
  echo "$(date -Is) PROMO_BACKUP_SEM_UPLOAD=1: upload pulado"
  exit 0
fi
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
