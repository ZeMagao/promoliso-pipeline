# Operação no VPS (Hetzner) — PromoLiso

Migração executada em **2026-08-05** (madrugada). O pipeline **não roda mais no Windows**.

| Item | Valor |
|---|---|
| Host | `<IP-DO-VPS>` (Hetzner CX23, Falkenstein) |
| SO | Ubuntu 24.04.4 LTS — 2 vCPU / 3.8 GB RAM / 2 GB swap / 38 GB disco |
| Domínio | **https://n8n.promoliso.com.br** (HTTPS via Caddy + Let's Encrypt) |
| Projeto | `/opt/promoliso` (user `promo`) |
| Dados n8n | `/opt/promoliso/data/.n8n` (DB + `config` com encryptionKey + community nodes) |
| Renderizador | `/opt/promoliso/renderer` → `127.0.0.1:5680` |
| Token IG | `/home/promo/ig-token.json` (600, dono `promo`) |
| Acesso | `ssh root@<IP-DO-VPS>` (só chave; senha desabilitada) |

## Serviços (systemd — substituem os `.ps1`/`.cmd` do Windows)

```bash
systemctl status promo-n8n promo-renderer caddy
systemctl restart promo-n8n          # o "deploy" agora é isto
journalctl -u promo-n8n -f           # logs ao vivo
journalctl -u promo-renderer -n 50
```

| Unit | O que é |
|---|---|
| `promo-renderer.service` | Chrome headless + sharp, escuta 127.0.0.1:5680 |
| `promo-n8n.service` | n8n 2.30.4, escuta 127.0.0.1:5678 (só o Caddy expõe) |
| `caddy.service` | Reverse proxy HTTPS → 5678 |
| `promo-backup.timer` | Backup diário do banco às **03:30 BRT** |

Env relevantes ficam **no unit** (`/etc/systemd/system/promo-n8n.service`), não em `.env`:
`N8N_USER_FOLDER`, `N8N_EDITOR_BASE_URL`/`N8N_WEBHOOK_URL` = domínio fixo,
`TZ=America/Sao_Paulo`, `N8N_SECURE_COOKIE=true`, `N8N_PUBLIC_API_DISABLED=true`,
`EXECUTIONS_DATA_PRUNE` (336 h / 500 execuções), `MemoryHigh=2800M`.
Depois de editar: `systemctl daemon-reload && systemctl restart promo-n8n`.

## Healthchecks

```bash
curl 127.0.0.1:5680/healthz    # {"status":"ok","chrome":"/usr/bin/google-chrome-stable"}
curl 127.0.0.1:5678/healthz    # {"status":"ok"}
curl https://n8n.promoliso.com.br/healthz
```

## Backup

`/usr/local/bin/promo-backup.sh` → `/opt/promoliso/backups/backup-<stamp>.tar.gz`
(`.backup` do SQLite = quente e seguro, + o `config` com a **encryptionKey**; retenção 7 dias).

```bash
systemctl start promo-backup.service     # rodar na hora
systemctl list-timers promo-backup
```

> ⚠️ **Pendente:** o backup é **local**. VPS morto = tudo perdido. Falta destino externo
> (rclone → object storage, ou `scp` pra outra máquina).

## Restaurar

```bash
systemctl stop promo-n8n
cd /tmp && tar -xzf /opt/promoliso/backups/backup-<stamp>.tar.gz
gunzip database-<stamp>.sqlite.gz
cp database-<stamp>.sqlite /opt/promoliso/data/.n8n/database.sqlite
cp config-<stamp>          /opt/promoliso/data/.n8n/config    # SEM isto as credenciais quebram
rm -f /opt/promoliso/data/.n8n/database.sqlite-wal /opt/promoliso/data/.n8n/database.sqlite-shm
chown -R promo:promo /opt/promoliso/data
systemctl start promo-n8n
```

## Agendamentos (cron dos Schedule Triggers, BRT)

| Workflow | Quando |
|---|---|
| Produtor `NL8eVLKErgnIXBQq` | `0 0 8-22/2 * * *` → 08,10,12,14,16,18,20,22h (**não roda de madrugada**) |
| Publicador `E27F7yVdsZRj` | 12:30 diário, 20:00 diário, 16:30 ter/qua/sex |
| Watchdog `MJly91QFGKep` | 13:00 e 21:30 |
| Monitor de erros `PRMLERR20260725A` | Error Trigger (sob demanda) |

## Community nodes — binários nativos são específicos de plataforma

Vieram do Windows com binários `win32`. Foram trocados pelos de Linux **sem npm** no
diretório dos nodes (npm ali apagaria os patches em `dist/`):

| Pacote | Versão | Instalado |
|---|---|---|
| `@img/sharp-linux-x64` + `sharp-libvips-linux-x64` | 0.33.5 / 1.0.4 | dentro de `n8n-nodes-image-sharp/node_modules/@img` |
| idem | 0.34.5 / 1.2.4 | em `nodes/node_modules/@img` (sharp raiz) |
| `@resvg/resvg-js-linux-x64-gnu` | 2.6.2 | `@resvg/` |
| `@napi-rs/canvas-linux-x64-gnu` | 0.1.100 | `@napi-rs/` |

Receita: `npm pack <pacote>@<versao>` num diretório temporário → `tar -xzf --strip-components=1`
para dentro do destino → apagar o dir `*win32*`. **Nunca** rodar `npm install` em
`data/.n8n/nodes` — mata os dois patches:

- `n8n-nodes-image-sharp/dist/nodes/ImageSharp/ImageSharpDefaults.js` → jpeg q95 4:4:4
- `n8n-nodes-instagram-integrations/dist/nodes/Instagram/GenericFunctions.js` → token de `~/ig-token.json`

## Gotchas

- **`npm ci` não funciona** neste projeto: o `package-lock.json` está fora de sincronia com a
  árvore do n8n 2.30.4. Usar `npm install` (o n8n segue pinado em 2.30.4 no `package.json`).
- **`n8n execute` (CLI) não serve pra testar** os workflows: o processo avulso não registra os
  helpers do módulo `data-table` (erro "Attempted to use Data table node but the module is
  disabled") e briga pela porta 5679 do task broker. Testar pela UI ou esperar o schedule.
- `writer.cjs` (em `design/`) tem path Windows hardcoded — ajustar pra Linux antes de usar.
  Os `patch_*.cjs` usam path relativo e funcionam.
- SSH da máquina Windows pra este VPS é **instável** (~20% de timeout). Scripts de automação
  precisam de retry; `scp` falha mais que `ssh` (usar `ssh host 'cat > arquivo' < local`).
- Redirect URI do OAuth do Instagram agora é fixo:
  `https://n8n.promoliso.com.br/rest/oauth2-credential/callback` — cadastrar **uma vez** no app
  do Meta. Publicar não depende disso (usa `ig-token.json`); só reconectar a conta depende.
