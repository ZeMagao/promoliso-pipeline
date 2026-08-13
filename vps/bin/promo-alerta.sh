#!/usr/bin/env bash
# uso: <algo que gera texto> | promo-alerta.sh "<assunto>"
exec /usr/bin/node /usr/local/bin/promo-alerta.js "${1:-[PromoLiso] alerta}"
