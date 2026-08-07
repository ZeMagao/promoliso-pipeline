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
| `promo-writeback.timer` | De hora em hora: escreve de volta em `promoliso_publicacoes` o que a fila publicou |

### `promo-writeback` — por que existe

O publicador só escreve na FILA (`Marcar PUBLISHED`); ninguém escrevia em `promoliso_publicacoes`
desde a virada. Em 2026-08-06 a tabela tinha **1** linha `PUBLISHED` (de 29/07, era do publish
inline) contra 16 em `PREPARED`, incluindo posts que saíram de verdade. Isso quebrava duas coisas:

- `blocksTopic()` do "Montar contexto editorial" bloqueia tema por `operational_status='PUBLISHED'`
  **ou** `PREPARED com <= 6 h`. Sem nada virar PUBLISHED, a trava contra republicar durava só 6 h.
- o `instagram_post_id` só existia no `execution_data`, podado em 7 dias — sem auditoria possível.

`promo-fila-writeback.cjs` roda de fora do n8n de propósito: escrever de dentro exigiria inserir nó
no publicador, e cirurgia de workflow é o que quebrou a publicação por 3 dias no carrossel variável.
Rodando de hora em hora, ele captura o `post_id` bem dentro da retenção do `execution_data`.

Só faz `UPDATE`, nunca `INSERT`/`DELETE`; só toca linha cujo `content_key` está PUBLISHED na fila
(prova de publicação); nunca sobrescreve `instagram_post_id` que já tenha valor. É idempotente.

```bash
sudo -u promo node /opt/promoliso/promo-fila-writeback.cjs --dry   # mostra sem gravar
systemctl start promo-writeback.service                            # rodar na hora
journalctl -u promo-writeback -n 20 --no-pager
```

Env relevantes ficam **no unit** (`/etc/systemd/system/promo-n8n.service`), não em `.env`:
`N8N_USER_FOLDER`, `N8N_EDITOR_BASE_URL`/`N8N_WEBHOOK_URL` = domínio fixo,
`TZ=America/Sao_Paulo`, `N8N_SECURE_COOKIE=true`, `N8N_PUBLIC_API_DISABLED=true`,
`EXECUTIONS_DATA_PRUNE` (**168 h / 150 execuções**), `MemoryHigh=2800M`.
Depois de editar: `systemctl daemon-reload && systemctl restart promo-n8n`.

## Healthchecks

```bash
curl 127.0.0.1:5680/healthz    # {"status":"ok","chrome":"/usr/bin/google-chrome-stable"}
curl 127.0.0.1:5678/healthz    # {"status":"ok"}
curl https://n8n.promoliso.com.br/healthz
```

## ⚠️ A Hetzner bloqueia saída nas portas 25 e 465 — só 587 funciona

Descoberto em 2026-08-05, **depois** da migração. Isso quebra silenciosamente todo o alerta por
e-mail: a credencial `smtp` do n8n não tinha `port` definido, e o default do n8n é **465** → todo
`emailSend` dá timeout sem barulho. No Windows funcionava (465 aberto).

**Correção:** na UI do n8n → Credentials → "SMTP account" → **Port = 587** e **SSL/TLS desligado**
(usa STARTTLS). Testar depois com:

```bash
echo "teste" | /usr/local/bin/promo-alerta.sh "[PromoLiso] teste"
```

Se algum dia precisar da 465/25, dá pra pedir desbloqueio pro suporte da Hetzner (eles liberam
depois de a conta ter algum tempo), mas a 587 resolve.

## Backup

`/usr/local/bin/promo-backup.sh` → `/opt/promoliso/backups/backup-<stamp>.tar.gz`
(`.backup` do SQLite = quente e seguro, + o `config` com a **encryptionKey**).
Retenção: **7 dias local, 30 dias no R2**. Timer diário 03:30 BRT.
Falha do backup → e-mail automático via `promo-backup-falhou.service`.

```bash
systemctl start promo-backup.service     # rodar na hora
journalctl -u promo-backup -n 20 --no-pager
systemctl list-timers promo-backup
```

### Cópia externa no Cloudflare R2 — ✅ ATIVA desde 2026-08-05

Bucket `promoliso-backups` (privado), prefixo `n8n/`, retenção 30 dias. Upload roda no fim do
`promo-backup.sh`. Config em `/home/promo/.config/rclone/rclone.conf` (600, dono `promo`),
nome do bucket em `/etc/promo-r2-bucket`.

**rclone: use `/usr/local/bin/rclone` (1.75, zip oficial).** O do apt no Ubuntu 24.04 é o
**1.60.1, de 2022** — funciona, mas está velho demais pra confiar com R2. Os scripts apontam pro
caminho absoluto do 1.75 de propósito.

```bash
rclone --config /home/promo/.config/rclone/rclone.conf ls   r2:promoliso-backups/n8n/
rclone --config /home/promo/.config/rclone/rclone.conf size r2:promoliso-backups
```

Pra reconfigurar (token novo, outra conta):

```bash
promo-r2-setup.sh <ACCOUNT_ID> <ACCESS_KEY_ID> <SECRET_ACCESS_KEY> [BUCKET]
```
Ele valida o formato (`ACCOUNT_ID`/`ACCESS_KEY` = 32 hex, `SECRET` = 64 hex) **antes** de gravar,
cria o bucket se faltar, e só declara sucesso se leitura+escrita+delete passarem.

**Como ler os erros do R2:**

| erro | causa |
|---|---|
| `403 AccessDenied` | token sem permissão ou escopado noutro bucket. Precisa *Admin Read & Write* ou *Object Read & Write* |
| `404 NoSuchBucket` | o bucket não existe **nessa conta** (o token já está ok) |

⚠️ **Pegadinha:** com `no_check_bucket = true` na config, `rclone mkdir` vira **no-op** e o bucket
nunca é criado (silenciosamente). Pra criar de fato:

```bash
rclone --config $CONF --s3-no-check-bucket=false mkdir r2:promoliso-backups
```

Enquanto não houver config, o backup roda **só local** e loga o aviso — não quebra.

> O `.tar.gz` contém a **encryptionKey em texto claro**. Bucket privado é o mínimo; se quiser
> defesa a mais, dá pra pôr um remote `crypt` do rclone na frente — mas aí a senha do crypt passa
> a ser tão crítica quanto a encryptionKey (perdeu a senha, perdeu o backup).

### Restaurar do R2

Baixe como o user `promo` (o rclone roda como `promo`; pasta criada por root dá
`permission denied`):

```bash
CONF=/home/promo/.config/rclone/rclone.conf
install -d -o promo -g promo /home/promo/restore
sudo -u promo rclone --config $CONF lsf r2:promoliso-backups/n8n/
sudo -u promo rclone --config $CONF copy \
  r2:promoliso-backups/n8n/backup-<stamp>.tar.gz /home/promo/restore/
# depois segue o "Restaurar" abaixo
```

**Restauração TESTADA de verdade em 2026-08-05** (não só o upload): md5 idêntico entre R2, cópia
baixada e cópia local; `gzip -t` ok; banco extraído com `integrity_check` ok, 5 workflows
(4 ativos), 7 credenciais, 99 execuções e a fila intacta; e a **encryptionKey de dentro do backup
decifrou as 7 credenciais do próprio backup**. Ou seja: o `.tar.gz` sozinho reconstrói o sistema.
Vale repetir esse teste depois de qualquer mudança no backup.

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

## Tamanho do banco

`execution_data` é ~95% do banco: **~8 MB por execução** (o produtor carrega 309 itens de feed
com conteúdo inteiro + payloads dos agentes). São ~14 execuções/dia somando produtor, publicador,
watchdog e monitor → **~110 MB/dia**.

Com a retenção de 7 dias, o estado estável é **~800 MB** (não ~200 MB — medido). Em 2026-08-05 o
prune de 82 execuções antigas + `VACUUM` levou 1006 MB → 824 MB. `VACUUM` **sozinho não serve**:
o freelist fica em ~1 MB, ou seja não há páginas mortas, é dado vivo. Se precisar encolher de
verdade, o lever é `EXECUTIONS_DATA_MAX_AGE` (3 dias ≈ 350 MB).

Prune manual imediato (o prune do n8n só faz hard-delete ~1 h depois do soft-delete):

```bash
systemctl stop promo-n8n
sqlite3 $DB "PRAGMA foreign_keys=ON;"   # o CLI vem com FK OFF -> CASCADE não dispara
# apagar execution_data / execution_metadata / execution_annotations e depois execution_entity
sqlite3 $DB "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"
systemctl start promo-n8n
```

## Alerta por e-mail fora do n8n

`/usr/local/bin/promo-alerta.sh "<assunto>"` (corpo pelo stdin) manda e-mail **reusando a
credencial SMTP do próprio n8n** — lê o blob cifrado do banco e decifra com a encryptionKey local,
então não existe senha duplicada em nenhum arquivo. Usa o `nodemailer` que já vem com o n8n.
É o que o `promo-backup-falhou.service` chama. Depende da correção da porta 587 acima.

## Gotchas

- **Dois fusos no mesmo banco.** O n8n grava `execution_entity.startedAt/stoppedAt` e
  `data_table_*.published_at` em **UTC**; nossos `patch_*.cjs` gravam `workflow_entity.updatedAt` e
  `workflow_history.createdAt` em **hora local** (o `now()` deles usa `getHours()`). Comparar os
  dois direto faz você errar por 3 h e concluir que um patch já estava no ar quando não estava.
  Ancore no `journalctl` (local) e no horário do cron. Produtor 08–22h BRT = 11–01h UTC.
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
