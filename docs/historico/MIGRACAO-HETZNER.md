# Migração PromoLiso → Hetzner Cloud (runbook)

> ✅ **EXECUTADA em 2026-08-05.** Este arquivo fica como histórico do plano.
> A realidade do que subiu (VPS **CX23**, não CX32; serviços, backup, restore,
> gotchas, troca dos binários nativos win32→linux) está em **`OPERACAO-VPS.md`** — use aquele.

Escrito 2026-08-01. Executar numa NOVA sessão, **depois** do primeiro post TITAN sair.
Objetivo: tirar da máquina Windows + túnel efêmero → VPS com **domínio fixo** (mata o
maior risco: URL do túnel muda a cada restart e quebra o redirect OAuth do Instagram).

## Fatos do ambiente atual (conferidos 2026-08-01)
- **n8n 2.30.4** (instalar a MESMA versão no VPS — copiar DB entre versões diferentes roda
  migrations e pode quebrar). Rodado via `node_modules/n8n/bin/n8n start`.
- **Node v24.17.0** (instalar Node 24 no VPS).
- **N8N_USER_FOLDER = `<projeto>/data`** → DB SQLite em `data/.n8n/database.sqlite`;
  chave de criptografia em `data/.n8n/config` (`encryptionKey`) — **SEM ela as credenciais não
  descriptografam**.
- **6 credenciais** cifradas no DB: OpenAI, Instagram (instagramOAuth2Api), Cloudinary, Tavily,
  Brave, Anthropic.
- **Community nodes** (em `data/.n8n/nodes/node_modules`): `n8n-nodes-cloudinary`,
  `n8n-nodes-image-sharp` (EDITADO: q95 4:4:4), `n8n-nodes-instagram-integrations` (EDITADO:
  patch do token — [[instagram-token-fix]]), `n8n-nodes-atoscapital-htmltoimage`,
  `n8n-nodes-image-editor-pro`. Copiar a pasta `data/.n8n/nodes` inteira preserva os 2 edits.
- **Token Instagram**: `~/ig-token.json` (196 bytes, 60 dias + auto-refresh). O node lê esse
  arquivo (não depende do túnel pra publicar). Levar pro home do user no VPS.
- **Renderizador**: pasta EXTERNA `C:\Users\Magal\Documents\Codex\2026-07-13\chat-eu-to-precisand\renderer`
  (`server.cjs` já com `scale`/sharp/downscale; `fonts/` Barlow+Manrope; `sharp` 0.35.3 + puppeteer-core).
  Escuta 127.0.0.1:5680. No VPS: relocar pra dentro do projeto (ex. `/opt/promoliso/renderer`).
- **Workflows**: `NL8eVLKErgnIXBQq` (principal), `E27F7yVdsZRj` (publicador), + PRMLERR/PLRetry.
  activeVersionId atual = **5c22d155** (TITAN + Sonnet + hi-res). Vem no DB copiado.
- **Data tables**: `promoliso_fila` (id `i2e8ZwnL9kwOV6OG`) → tabela física
  `data_table_user_i2e8ZwnL9kwOV6OG` + outras `data_table_user_*`. Vêm no DB.

## ESTRATÉGIA DE DADOS (decisão)
**Copiar a pasta `data/` inteira com o n8n PARADO** (não export/import). Preserva TUDO —
workflows, credenciais cifradas, data tables, histórico de versões, community nodes editados —
DESDE QUE: (a) mesma versão do n8n (2.30.4), (b) leve junto `data/.n8n/config` (encryptionKey),
(c) DB copiado consistente (n8n parado + incluir `-wal`/`-shm` ou fazer checkpoint).

---

## PARTE A — Provisionar o Hetzner
1. Criar conta Hetzner Cloud. **Fazer a verificação de conta cedo** (pode pedir documento e
   atrasar horas). Cartão internacional ou PayPal.
2. Novo projeto → Add Server:
   - Tipo: **CX32** (4 vCPU / 8 GB / 80 GB NVMe). Linha **CX** (NÃO CPX/CCX — subiram muito em 2026).
   - Imagem: **Ubuntu 24.04 LTS**.
   - Location: **Ashburn (EUA)** ou Nuremberg (tanto faz — servidor só fala com APIs).
   - **Adicionar SSH key** (gerar local: `ssh-keygen -t ed25519`). Sem senha root por email.
3. Firewall (Hetzner Cloud Firewall): permitir **22 (SSH), 80, 443**. NÃO expor 5678/5680.

## PARTE B — Domínio fixo (o ganho principal)
1. Ter um domínio (ex. `n8n.seudominio.com.br`). Se não tiver, registrar.
2. DNS: registro **A** `n8n.seudominio.com.br` → IP do VPS.
3. Reverse proxy **Caddy** (HTTPS automático via Let's Encrypt) → 127.0.0.1:5678. Caddyfile:
   ```
   n8n.seudominio.com.br {
       reverse_proxy 127.0.0.1:5678
   }
   ```
4. `N8N_EDITOR_BASE_URL` e `N8N_WEBHOOK_URL` = `https://n8n.seudominio.com.br` → **redirect OAuth
   estável pra sempre**.
5. Re-cadastrar UMA vez no app do Meta (Instagram) o redirect URI:
   `https://n8n.seudominio.com.br/rest/oauth2-credential/callback`. Nunca mais muda.
   (Publicar NÃO depende disso — usa `ig-token.json`. O domínio só conserta o fluxo de reconectar.)

## PARTE C — Base do VPS (via SSH, como user não-root)
```bash
# criar user não-root
adduser promo && usermod -aG sudo promo
# (logar como promo daqui pra frente)

# Node 24 (nodesource) + build tools
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential

# Google Chrome (renderizador) + libs headless
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt-get update && sudo apt-get install -y google-chrome-stable fonts-liberation fonts-dejavu-core

# Caddy (reverse proxy HTTPS)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# firewall local
sudo apt-get install -y ufw fail2ban
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

## PARTE D — Copiar o projeto + dados (máquina Windows → VPS)
No Windows, **parar o n8n primeiro** (`stop-promoliso.ps1` ou matar o pid). Depois:
1. Copiar o projeto `promoliso-n8n/` pro VPS em `/opt/promoliso/` (via scp/rsync/WinSCP).
   - Pode pular `node_modules/` (reinstalar no VPS) e `backups/` grandes.
   - **NÃO pular `data/`** — é o coração (DB + config + nodes editados + data tables).
   - **NÃO pular** `ig-set-token.cjs`, `design/`, `patches/`, os `.cjs`/`.ps1` (referência).
2. Copiar a pasta do **renderizador** → `/opt/promoliso/renderer/`.
3. Copiar `~/ig-token.json` (Windows) → `/home/promo/ig-token.json` (VPS). Conferir que o
   node do Instagram resolve o path pelo `os.homedir()`/`$HOME` (se hardcodar outro caminho,
   ajustar). O arquivo tem o token de 60 dias + refresh.
4. No VPS, instalar deps:
   ```bash
   cd /opt/promoliso && npm ci        # ou npm install (n8n 2.30.4 fixado no package.json)
   cd /opt/promoliso/renderer && npm install   # puppeteer-core + sharp (compila nativo Linux)
   ```
   ⚠️ Se `npm ci` reinstalar community nodes e apagar os edits → ver PARTE H (reaplicar).
   Copiar `data/.n8n/nodes` já traz os community nodes editados; conferir que ficaram.

## PARTE E — Configurar renderizador no VPS
`server.cjs` já lê `CHROME_EXECUTABLE_PATH` e `RENDERER_NO_SANDBOX`. No systemd (PARTE F) setar:
- `CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable`
- `RENDERER_NO_SANDBOX=1` (headless Linux precisa `--no-sandbox`)
- `RENDERER_HOST=127.0.0.1`, `RENDERER_PORT=5680`
Testar: `curl http://127.0.0.1:5680/healthz` → `{"status":"ok"}`.

## PARTE F — systemd (substitui os .ps1/.cmd do Windows)
`/etc/systemd/system/promo-renderer.service`:
```ini
[Unit]
Description=PromoLiso Renderer
After=network.target
[Service]
User=promo
WorkingDirectory=/opt/promoliso/renderer
Environment=CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
Environment=RENDERER_NO_SANDBOX=1
ExecStart=/usr/bin/node server.cjs
Restart=on-failure
[Install]
WantedBy=multi-user.target
```
`/etc/systemd/system/promo-n8n.service`:
```ini
[Unit]
Description=PromoLiso n8n
After=network.target promo-renderer.service
[Service]
User=promo
WorkingDirectory=/opt/promoliso
Environment=N8N_USER_FOLDER=/opt/promoliso/data
Environment=GENERIC_TIMEZONE=America/Sao_Paulo
Environment=TZ=America/Sao_Paulo
Environment=N8N_LISTEN_ADDRESS=127.0.0.1
Environment=N8N_EDITOR_BASE_URL=https://n8n.seudominio.com.br
Environment=N8N_WEBHOOK_URL=https://n8n.seudominio.com.br
Environment=N8N_SECURE_COOKIE=true
Environment=N8N_PUBLIC_API_DISABLED=true
Environment=N8N_DIAGNOSTICS_ENABLED=false
Environment=N8N_PERSONALIZATION_ENABLED=false
Environment=N8N_CONCURRENCY_PRODUCTION_LIMIT=1
Environment=EXECUTIONS_DATA_PRUNE=true
Environment=EXECUTIONS_DATA_MAX_AGE=336
Environment=EXECUTIONS_DATA_PRUNE_MAX_COUNT=500
ExecStart=/usr/bin/node node_modules/n8n/bin/n8n start
Restart=on-failure
[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now promo-renderer promo-n8n caddy
```

## PARTE G — Hardening Tier-1 (PLANO-MELHORIAS)
- **2FA** no owner do n8n (Settings → conta).
- `N8N_SECURE_COOKIE=true` (só via HTTPS — o domínio garante) — já no unit.
- `N8N_PUBLIC_API_DISABLED=true` — já no unit.
- **Fixar versão** dos community nodes (não auto-update — os edits sumiriam).
- SSH: só key (desabilitar `PasswordAuthentication`), fail2ban ativo, ufw só 22/80/443.
- **Backup**: cron diário do `data/.n8n/database.sqlite` (+ `config`) pra fora do VPS
  (ex. rclone → storage barato, ou scp pra outra máquina). Sem isso, um VPS morto = tudo perdido.

## PARTE H — Reaplicar patches SE reinstalar community nodes
Se copiou `data/.n8n/nodes` intacto, pular. Se reinstalou (perdeu os edits):
1. **Sharp q95 4:4:4**: editar
   `data/.n8n/nodes/node_modules/n8n-nodes-image-sharp/dist/nodes/ImageSharp/ImageSharpDefaults.js`
   → jpeg `{ mozjpeg:true, quality:95, chromaSubsampling:'4:4:4' }`. (Referência: memória "alta resolução".)
2. **Patch do token Instagram** (getAccessToken lendo `ig-token.json`) no
   `n8n-nodes-instagram-integrations` — ver [[instagram-token-fix]]. Reaplicar o mesmo patch.
3. **Renderizador** `server.cjs` (scale/deviceScaleFactor + PNG→sharp downscale + optimizeForSpeed:false)
   — vem se copiou a pasta; backup `server.cjs.pre-hires`.

## PARTE I — Validar (antes de aposentar o Windows)
1. `systemctl status promo-renderer promo-n8n caddy` — todos active.
2. `curl 127.0.0.1:5680/healthz` e `curl 127.0.0.1:5678/healthz` → ok.
3. Abrir `https://n8n.seudominio.com.br` → logar (credenciais do owner vêm no DB).
4. Conferir workflows ativos (`NL8eVLKErgnIXBQq` active=1, activeVersionId 5c22d155 ou o atual).
5. **Execute manual** de uma pauta → conferir render TITAN + upload Cloudinary + (se aprovar)
   publicação no Instagram. Publicação usa `ig-token.json` → deve funcionar direto.
6. Se o Instagram pedir reconexão OAuth: reconectar pelo domínio (agora o redirect é fixo).
7. Conferir que o **schedule** dispara nos horários BRT (TZ setado).

## PARTE J — Cutover
- Só depois de validar tudo no VPS: **desligar o túnel cloudflared + n8n no Windows**
  (não rodar os dois publicando ao mesmo tempo — risco de post duplicado!).
- Idealmente: parar o Windows ANTES de subir o n8n do VPS pela 1ª vez (evita 2 schedulers
  ativos na mesma conta). Ou seja: PARTE D copia o `data/` com Windows já parado → VPS assume.
- Aposentar a máquina Windows (não precisa mais ficar ligada 24/7).

## Gotchas / lembretes
- **Nunca 2 n8n publicando ao mesmo tempo** (Windows + VPS) → post duplicado. Cutover limpo.
- **encryptionKey** (`data/.n8n/config`) TEM que ir junto, senão credenciais quebram.
- **Mesma versão n8n** (2.30.4) no VPS — não deixar `npm install` puxar outra major.
- `writer.cjs` (deploy de design) tem **path Windows hardcoded** (`const DB='C:/Users/...'`) →
  no VPS, editar pra path relativo/Linux antes de rodar deploys de design lá. Os `patch_*.cjs`
  usam `path.join(__dirname,'..','data',...)` (relativo, ok).
- Os deploys agora são via **systemd** (`systemctl restart promo-n8n`), não pelos `.ps1`.
- Câmbio/IOF: cobrança em €; a linha CX não tem fidelidade (cancela quando quiser).
