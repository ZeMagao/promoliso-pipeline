# Próxima sessão — checklist (VS Code)

Duas frentes pendentes: **(1) subir pro GitHub** (rápido, faz primeiro = vira backup antes da migração)
e **(2) migração pro VPS Hetzner**. Contexto completo na memória do projeto (`estado-atual`, `migracao-hetzner`).

---

## FRENTE 1 — Subir pro GitHub (~10 min)

**Já preparado:** `.gitignore` criado e **verificado à prova de vazamento** (64 arquivos entram, 0 segredos —
`data/`, `backups/`, `node_modules/`, tokens, logs, `_arquivo/` todos fora). `README.md` pronto.

**Passos:**
```bash
cd C:\Users\Magal\Documents\Codex\promoliso-n8n
git init
git add -A
git status                      # CONFERIR: nada de data/ backups/ *.sqlite ig-token
git commit -m "PromoLiso: pipeline n8n de conteúdo Instagram (autônomo)"
```
Depois criar o repo no GitHub (**recomendo PRIVATE** — não tem segredo, mas tem a lógica de negócio) e:
```bash
git remote add origin git@github.com:SEU_USUARIO/promoliso-n8n.git
git branch -M main
git push -u origin main
```
> ⚠️ Antes do push, rodar `git status` e confirmar de novo que `data/`, `backups/`, `*.sqlite`, `ig-token.json`
> NÃO aparecem. Se aparecer qualquer um = PARAR e ajustar o `.gitignore`.

---

## FRENTE 2 — Migração pro VPS Hetzner

**Runbook completo:** `MIGRACAO-HETZNER.md` (Partes C a J). Pré-requisitos JÁ prontos:
- Servidor Hetzner CX23 (Falkenstein, Ubuntu 24.04): **IP `<IP-DO-VPS>`**, SSH por chave OK, swap 2GB, firewall 22/80/443
- Subdomínio **`n8n.promoliso.com.br`** → aponta pro IP (Cloudflare, DNS only / proxy OFF, propagado)

**Ordem (runbook):**
1. **Parte C** — no VPS (`ssh root@<IP-DO-VPS>`): instalar Node 24 + Google Chrome + Caddy + ufw/fail2ban
2. **Parte B** — Caddyfile pro `n8n.promoliso.com.br` → 127.0.0.1:5678 (HTTPS automático)
3. **Parte D** — no Windows: **PARAR o n8n** → copiar o projeto pro VPS (`/opt/promoliso/`), INCLUINDO `data/`
   (é o coração: DB + `encryptionKey` em `data/.n8n/config` + community nodes editados). Copiar também:
   - o **renderizador** (vive FORA do repo: `C:\...\2026-07-13\chat-eu-to-precisand\renderer`) → `/opt/promoliso/renderer/`
   - `~/ig-token.json` → `/home/promo/ig-token.json`
4. **Parte E/F** — configurar renderizador + systemd (renderer + n8n) com as env do runbook
5. **Parte G** — hardening + backup cron do DB
6. **Parte H** — SE reinstalou community nodes: reaplicar patch Sharp q95 + patch token IG
7. **Parte I** — validar (healthz, abrir o domínio, Execute manual, conferir post)
8. **Parte J** — cutover: desligar Windows (NUNCA 2 n8n publicando junto = post duplicado)

**Atenção (do audit):** o renderizador é dependência externa (repo não é auto-contido) — não esquecer de levar.
`writer.cjs` tem path Windows hardcoded → ajustar pra Linux se for rodar deploy de design no VPS (os `patch_*.cjs`
já usam path relativo).

---

## Estado atual do pipeline (para não quebrar)
- Produtor + Publicador + Monitor de erros + Watchdog: TODOS ativos e saudáveis no Windows.
- Publicando normal (carrossel de tamanho FIXO — o variável foi revertido, ver memória).
- Bug do "estranda row" já corrigido (publish que falha → FAILED + email).
- Fila: 6 PUBLISHED + 5 FAILED (as FAILED são pautas velhas descartadas, pode ignorar/apagar).
