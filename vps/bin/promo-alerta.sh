#!/usr/bin/env bash
# uso: <algo que gera texto> | promo-alerta.sh "<assunto>"
#
# Manda o MESMO alerta por dois caminhos: push no Telegram e e-mail.
# Por que push primeiro (17/09/2026): de 25/08 a 17/09 este script mandou ~44 e-mails de "sem
# publicacao" e a conta ficou 23 dias muda. O e-mail chegou; ninguem leu. O e-mail continua indo
# porque e de graca e serve de registro -- mas quem acorda alguem e o push.
#
# Falha de um canal nao pode calar o outro: por isso nenhum dos dois aborta o script.
set -uo pipefail
ASSUNTO="${1:-[PromoLiso] alerta}"
CORPO="$(cat)"
[ -z "${CORPO// }" ] && CORPO="(sem detalhes)"

if ! printf '⚠️ %s\n\n%s' "$ASSUNTO" "$CORPO" | /usr/bin/node /usr/local/bin/promo-telegram.cjs; then
  echo "promo-alerta: push do Telegram falhou — seguindo para o e-mail" >&2
fi

printf '%s' "$CORPO" | /usr/bin/node /usr/local/bin/promo-alerta.js "$ASSUNTO"
