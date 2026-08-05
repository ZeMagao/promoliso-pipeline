#!/usr/bin/env bash
# Deploy de patch de workflow NO VPS (substitui os deploy-*.ps1 do Windows).
#   sudo deploy-vps.sh design/patch_algum.cjs
# Faz: backup -> para o n8n -> dry-run -> aplica -> religa -> valida.
set -euo pipefail

PATCH="${1:-}"
RAIZ=/opt/promoliso
[ -n "$PATCH" ] || { echo "uso: deploy-vps.sh <caminho/do/patch.cjs>"; exit 1; }
[ -f "$RAIZ/$PATCH" ] || [ -f "$PATCH" ] || { echo "patch não encontrado: $PATCH"; exit 1; }
[ -f "$RAIZ/$PATCH" ] && PATCH="$RAIZ/$PATCH"

echo "### 1. Backup antes de tudo"
/usr/local/bin/promo-backup.sh | tail -2

echo ""
echo "### 2. Dry-run (n8n ainda no ar, leitura apenas)"
cd "$RAIZ"
sudo -u promo node "$PATCH" --dry

echo ""
if [ "${AUTO:-0}" = "1" ]; then
  echo "### AUTO=1 — seguindo sem confirmar"
elif [ -t 0 ]; then
  read -r -p "### aplicar de verdade? [s/N] " ok
  [ "${ok,,}" = "s" ] || { echo "abortado pelo operador."; exit 0; }
else
  echo "ABORTADO: sem terminal pra confirmar. Rode com AUTO=1 se for proposital."
  exit 1
fi

echo ""
echo "### 3. Parando o n8n (não patchar com o banco aberto)"
systemctl stop promo-n8n
for i in $(seq 1 20); do
  ss -tln 2>/dev/null | grep -q ':5678 ' || break
  echo "  aguardando a porta 5678 fechar ($i)"; sleep 1
done
ss -tln 2>/dev/null | grep -q ':5678 ' && { echo "ABORTADO: 5678 ainda escutando"; systemctl start promo-n8n; exit 1; }
echo "  n8n parado"

echo ""
echo "### 4. Aplicando"
sudo -u promo node "$PATCH"

echo ""
echo "### 5. Religando"
systemctl start promo-n8n
for i in $(seq 1 24); do
  s=$(curl -sS --max-time 5 http://127.0.0.1:5678/healthz 2>/dev/null || echo "")
  echo "$s" | grep -q ok && { echo "  healthz OK"; break; }
  sleep 5
done
sleep 6

echo ""
echo "### 6. Validando"
DB=$RAIZ/data/.n8n/database.sqlite
sqlite3 -header -column "$DB" "SELECT id, active, versionId=activeVersionId AS draft_igual_pub, activeVersionId FROM workflow_entity WHERE active=1;"
echo "--- workflows reativados ---"
journalctl -u promo-n8n --since "-3 min" --no-pager | grep -i "activated workflow" || echo "AVISO: nenhum ativado"
echo "--- erros ---"
# `|| true`: grep sem match retorna 1 e derrubaria o script pelo set -e
erros=$(journalctl -u promo-n8n --since "-3 min" --no-pager | grep -iE "error|failed" \
  | grep -viE "deprecat|Python task runner|license" | head -5 || true)
if [ -n "$erros" ]; then echo "$erros"; else echo "  (nenhum)"; fi

echo ""
echo "### DEPLOY CONCLUIDO"
