#!/usr/bin/env bash
# Configura o remote R2 do rclone e SO declara sucesso se os 3 testes passarem.
#   promo-r2-setup.sh <ACCOUNT_ID> <ACCESS_KEY_ID> <SECRET_ACCESS_KEY> [BUCKET]
set -uo pipefail
RCLONE=/usr/local/bin/rclone
[ -x "$RCLONE" ] || RCLONE=/usr/bin/rclone

if [ $# -lt 3 ]; then
  cat <<USAGE
uso: promo-r2-setup.sh <ACCOUNT_ID> <ACCESS_KEY_ID> <SECRET_ACCESS_KEY> [BUCKET]
  ACCOUNT_ID -> 32 hex. R2 > Overview (o MESMO painel que lista o bucket)
  ACCESS_KEY / SECRET -> R2 > Manage R2 API Tokens > Create API token
                         permissao "Admin Read & Write" (ou "Object Read & Write")
  BUCKET     -> default: promoliso-backups
USAGE
  exit 1
fi
ACC="$1"; KEY="$2"; SEC="$3"; BUCKET="${4:-promoliso-backups}"

# valida formato antes de gravar
erro=0
[[ "$ACC" =~ ^[0-9a-f]{32}$ ]] || { echo "ACCOUNT_ID nao parece valido (esperado 32 hex, veio ${#ACC} chars)"; erro=1; }
[[ "$KEY" =~ ^[0-9a-f]{32}$ ]] || { echo "ACCESS_KEY_ID nao parece valido (esperado 32 hex, veio ${#KEY} chars)"; erro=1; }
[[ "$SEC" =~ ^[0-9a-f]{64}$ ]] || { echo "SECRET nao parece valido (esperado 64 hex, veio ${#SEC} chars)"; erro=1; }
[ "$erro" = 0 ] || { echo "ABORTADO: confira os valores na tela do token."; exit 2; }

CONF=/home/promo/.config/rclone/rclone.conf
[ -f "$CONF" ] && cp "$CONF" "$CONF.bak.$(date +%s)"
install -d -o promo -g promo -m 700 /home/promo/.config /home/promo/.config/rclone
cat > "$CONF" <<CFG
[r2]
type = s3
provider = Cloudflare
region = auto
access_key_id = $KEY
secret_access_key = $SEC
endpoint = https://$ACC.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
CFG
chown promo:promo "$CONF"; chmod 600 "$CONF"
echo "$BUCKET" > /etc/promo-r2-bucket; chmod 644 /etc/promo-r2-bucket

echo "### garantindo que o bucket '$BUCKET' existe"
sudo -u promo "$RCLONE" --config "$CONF" --s3-no-check-bucket=false mkdir "r2:$BUCKET" 2>/dev/null   && echo "  bucket ok (criado ou ja existia)" || echo "  AVISO: nao consegui criar/verificar o bucket"

falhou=0
echo "### teste 1/3 LEITURA (list objects em '$BUCKET')"
if sudo -u promo "$RCLONE" --config "$CONF" ls "r2:$BUCKET" >/dev/null 2>/tmp/r2err; then
  echo "  OK"
else
  echo "  FALHOU: $(tail -1 /tmp/r2err)"; falhou=1
fi

echo "### teste 2/3 ESCRITA"
echo "teste-$(date +%s)" > /tmp/r2-teste.txt
if sudo -u promo "$RCLONE" --config "$CONF" copy /tmp/r2-teste.txt "r2:$BUCKET/_teste/" >/dev/null 2>/tmp/r2err; then
  echo "  OK"
else
  echo "  FALHOU: $(tail -1 /tmp/r2err)"; falhou=1
fi

echo "### teste 3/3 DELETE"
if sudo -u promo "$RCLONE" --config "$CONF" delete "r2:$BUCKET/_teste/r2-teste.txt" >/dev/null 2>/tmp/r2err; then
  echo "  OK"
else
  echo "  FALHOU: $(tail -1 /tmp/r2err)"; falhou=1
fi
rm -f /tmp/r2-teste.txt /tmp/r2err

echo ""
if [ "$falhou" = 0 ]; then
  echo "R2 CONFIGURADO E TESTADO. O backup diario (03:30 BRT) ja sobe automatico."
  echo "Validar agora: systemctl start promo-backup.service && journalctl -u promo-backup -n 20 --no-pager"
  exit 0
fi
cat <<FIM
R2 NAO CONFIGURADO - algum teste falhou. Leia o erro de cada teste acima:
  403 AccessDenied  = token sem permissao/escopo errado
  404 NoSuchBucket  = o bucket nao existe nessa conta
Os valores tem o formato certo, entao o problema esta no painel. Confira, nesta ordem:
  1. Permissao do token: precisa ser "Admin Read & Write" ou "Object Read & Write"
     (as opcoes "... Read only" nao escrevem).
  2. Escopo: se estiver limitado a um bucket, tem que ser exatamente "$BUCKET".
     Na duvida, cria o token com "Apply to all buckets".
  3. Conta: o ACCOUNT_ID tem que ser da MESMA conta que lista o bucket em R2 > Overview.
A config anterior foi salva em $CONF.bak.*
FIM
exit 3
