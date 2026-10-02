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

echo "### 0. Janela segura (o deploy PARA o n8n: rodada no meio morre)"
# Tres vezes o deploy comeu uma rodada: agosto (slot das 12:30), 17/09 (produtor das 22:00) e 02/10
# (produtor das 18:00 — o backup leva ~1 min e o n8n parou com o validador rodando; a pauta se
# perdeu e o proprio monitor de erros morreu junto, sem alerta). Lembrar do relogio nao funcionou;
# por isso a trava mora aqui. FORCAR_JANELA=1 passa por cima (so com motivo).
# DEPLOY_AGORA="H M DIA_DA_SEMANA" simula o relogio (para testar a trava sem esperar a hora).
janela_bloqueada() {
  local H="$1" M="$2" D="$3"
  # produtor: 0 0 8-22/2 * * * (horas pares). Evita :50-:59 da hora anterior e :00-:10 da hora par.
  if [ $((H % 2)) -eq 0 ] && [ "$H" -ge 8 ] && [ "$H" -le 22 ] && [ "$M" -lt 10 ]; then echo "produtor das ${H}:00"; return 0; fi
  if [ $((H % 2)) -eq 1 ] && [ "$H" -ge 7 ] && [ "$H" -le 21 ] && [ "$M" -ge 50 ]; then echo "produtor das $((H + 1)):00"; return 0; fi
  # publicador: 12:30 e 20:30 todo dia, 16:30 ter/qua/sex (dia da semana 2, 3, 5). Evita :20-:39.
  if [ "$M" -ge 20 ] && [ "$M" -lt 40 ]; then
    if [ "$H" -eq 12 ] || [ "$H" -eq 20 ]; then echo "publicador das ${H}:30"; return 0; fi
    if [ "$H" -eq 16 ] && { [ "$D" -eq 2 ] || [ "$D" -eq 3 ] || [ "$D" -eq 5 ]; }; then echo "publicador das 16:30"; return 0; fi
  fi
  return 1
}
if [ "${FORCAR_JANELA:-0}" != "1" ]; then
  read -r AGORA_H AGORA_M AGORA_D <<< "${DEPLOY_AGORA:-$(TZ=America/Sao_Paulo date '+%-H %-M %u')}"
  if MOTIVO=$(janela_bloqueada "$AGORA_H" "$AGORA_M" "$AGORA_D"); then
    echo "ABORTADO: $(printf '%02d:%02d' "$AGORA_H" "$AGORA_M") está na janela do ${MOTIVO}. Rode fora dela."; exit 1
  fi
  RODANDO=$(sqlite3 -readonly "$RAIZ/data/.n8n/database.sqlite" \
    "SELECT count(*) FROM execution_entity WHERE status IN ('running','new','waiting');" 2>/dev/null || echo "?")
  if [ "$RODANDO" != "0" ]; then
    echo "ABORTADO: ${RODANDO} execução(ões) do n8n rodando agora — parar o n8n mataria a rodada. Espere terminar."; exit 1
  fi
  echo "  $(printf '%02d:%02d' "$AGORA_H" "$AGORA_M") fora das janelas, nenhuma execução rodando"
  [ "${DEPLOY_SO_JANELA:-0}" = "1" ] && { echo "DEPLOY_SO_JANELA=1: só conferi a janela"; exit 0; }
fi

echo ""
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
