# PromoLiso — Automação de conteúdo Instagram (n8n)

Pipeline autônomo que **cura notícias/ofertas de games e tech, escreve o conteúdo, renderiza
os carrosséis e publica no Instagram** (@promoliso0) sozinho, em horários programados.

> ⚠️ **Segurança:** este repositório **NÃO** contém as credenciais nem o banco. A pasta `data/`
> (com `database.sqlite` cifrado + `encryptionKey`) e `backups/` estão no `.gitignore`. Nunca
> commite esses arquivos — eles vazam todas as chaves de API.

## Arquitetura

```
Feeds RSS (PS/Xbox/Nintendo/NVIDIA/Intel/Adrenaline/...)
        │
        ▼
[Curador IA] → [Verificador de confiabilidade] → pontuação determinística
        │
        ▼
[Redator IA] (Claude Sonnet) escreve título/destaque/texto/legenda
        │
        ▼
[Validar antes de publicar]  ← gate determinístico (fonte, imagem, hedge, estrutura)
        │
        ▼
[Renderizar carrossel] (HTML → JPEG via renderizador Chrome headless) → Cloudinary
        │
        ▼
[Fila] (DataTable promoliso_fila, status READY)
        │
        ▼
[Publicador] nos slots (12:30 / 16:30 ter-qua-sex / 20:00 BRT) → posta o melhor READY no Instagram
```

Dois workflows n8n principais:
- **Produtor** (`Conteúdo Instagram`): cura + escreve + renderiza + enfileira. Roda de 2 em 2h.
- **Publicador** (`Publicador (fila)`): lê a fila e publica nos slots.

Monitoramento:
- **Monitor de erros** (Error Trigger → email): alerta em erro DURO de qualquer workflow.
- **Watchdog de saúde** (agendado): alerta em falha SILENCIOSA (OpenAI sem saldo / sem publicar há ~26h).

## Stack

- **n8n 2.30.4** (self-hosted, SQLite) — orquestração
- **Node 24**
- **Renderizador** próprio: Chrome headless (puppeteer-core) + `sharp` — HTML → JPEG hi-res
- **Cloudinary** — hospedagem das imagens
- **OpenAI** (curador/verificador) + **Anthropic Claude** (redator)
- **Instagram Graph API** (Instagram Login / graph.instagram.com)
- Community nodes: `instagram-integrations` (com patch de token), `image-sharp` (patch q95), `cloudinary`

## Estrutura do repositório

| Pasta / arquivo | O que é |
|---|---|
| `design/` | Fonte de verdade reproduzível: templates de render (`redesignB.cjs`, `generate_nodes.cjs`), writers, scripts de patch/deploy do workflow, prompt (`new_systemMessage.txt`) |
| `patches/` | Histórico dos patches incrementais (semana1–2) |
| `deploy-*.ps1` | Orquestradores de deploy (param n8n → backup → patcha o DB → religa) |
| `assets/` | Fonte Barlow Condensed + template do story |
| `*.md` | Planos e runbooks (migração, buffer, melhorias, tutoriais) |
| `_arquivo/` | Scripts/one-shots já usados, guardados como referência |
| `data/` (ignorado) | n8n user folder: DB, encryptionKey, community nodes |

## Como o deploy funciona (importante)

O n8n 2.30 roda em modo **draft/published**: o schedule executa a versão **publicada**
(`activeVersionId`), não o draft. Todo patch no DB precisa gravar novo `versionId` +
`workflow_history` + setar `activeVersionId`. Os `patch_*.cjs` + `deploy-*.ps1` fazem isso
(param o n8n, fazem backup do DB, aplicam, religam). Ver `design/patch_*.cjs`.

## Rodar localmente (Windows)

```powershell
.\start-promoliso.ps1   # sobe n8n + renderizador + túnel
.\stop-promoliso.ps1    # para tudo
```

Pré-requisitos: Node 24, o renderizador rodando (`:5680`), `~/ig-token.json` com token válido,
e as credenciais cadastradas no n8n (não vêm no repo).

## Migração para VPS

Em andamento — ver `MIGRACAO-HETZNER.md`. VPS Hetzner já contratada; falta o cutover.
Objetivo: tirar a dependência da máquina Windows + túnel efêmero (endereço fixo via domínio + HTTPS).

## Status

Autônomo, publicando em produção. Ver o histórico de decisões e o estado atual nas notas do projeto.
