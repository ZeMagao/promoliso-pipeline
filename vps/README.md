# `vps/` — o que roda fora do n8n

O n8n orquestra, mas três coisas não cabem nele e vivem como serviço no servidor. Os arquivos aqui
são a cópia versionada do que está em `/opt/promoliso` e `/etc/systemd/system` — o backup diário do
servidor cobre só o banco e a configuração do n8n, então **este diretório é a única cópia fora do
disco do VPS**.

| caminho | serviço | por que existe |
|---|---|---|
| `renderer/` | `promo-renderer` | Chrome headless + sharp transformam HTML em JPEG. Render local, sem depender de serviço pago, e com fallback quando uma imagem remota não responde |
| `cdn/promo-cdn.cjs` | `promo-cdn` | três funções, cada uma nascida de um defeito medido: servir as imagens de um host nosso (com log de quem pediu), fazer **ponte** para hosts que respondem 403 ao buscador do Cloudinary, e achar as **fotos oficiais do jogo** citado na manchete |
| `bin/promo-vigia.cjs` | `promo-vigia` (timer) | o alarme. Mora fora do n8n de propósito: o watchdog antigo rodava dentro dele, então uma queda levava junto quem deveria avisar da queda |
| `bin/promo-telegram.cjs` | — | envio do push. O token fica em `/etc/promoliso/telegram.json` (dono `promo`, modo 600), nunca aqui |
| `bin/promo-alerta.sh` | — | manda o mesmo alerta por push **e** e-mail; falha de um canal não cala o outro |
| `systemd/` | units e timers | 9 timers: vigia, backup, checagem do token do Instagram, analytics, writeback da fila, detector de nó com erro |
| `caddy/Caddyfile` | proxy | HTTPS do domínio; rotas `/cdn/...`, `/jogo/fotos` e `/img` vão para o `promo-cdn`, o resto vai para o n8n |

## Provas

```bash
node vps/bin/test_promo_vigia.cjs      # 22 provas: escada de severidade, silêncio, heartbeat
node vps/cdn/test_promo_cdn_jogo.cjs   # identificação do jogo: confirma 7, recusa 7
node vps/cdn/test_promo_cdn_ponte.cjs  # a ponte não pode virar proxy aberto
```

A ponte de imagem aceita **só** hosts de uma lista e só `https`. O harness cobra que ela recuse
`127.0.0.1`, `169.254.169.254`, `file://` e `adrenaline.com.br.evil.com` — um endpoint que baixa
qualquer URL e serve pelo nosso domínio é exatamente o que um abusador procura.

## Instalação

Os serviços são copiados para `/opt/promoliso/...`, as units para `/etc/systemd/system`, e sobem
com `systemctl enable --now`. O passo a passo, incluindo restauração, está em
[../docs/OPERACAO-VPS.md](../docs/OPERACAO-VPS.md).
