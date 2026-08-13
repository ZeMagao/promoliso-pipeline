# Fase 0 — Inventário técnico (PRD §14)

**Data da auditoria:** 2026-08-07
**Fonte:** leitura do repositório + do `database.sqlite` (cópia local de 2026-08-04, pré-migração
para o VPS) + dos snapshots em `workflows/`. **Não houve acesso SSH ao VPS nesta sessão** — o que
depende dele está marcado como pendência.

---

## 1. Arquitetura real (medida, não presumida)

```
Feeds RSS (Xbox, PlayStation, Nintendo, NVIDIA, Intel, Adrenaline, GameVicio, Flow Games)
      │
[Produtor NL8eVLKErgnIXBQq]  cron 0 0 8-22/2  (08,10,...,22h BRT)
      │   Curador (OpenAI) → Verificador (OpenAI) → pontuação determinística
      │   Redator (Anthropic) → "Validar antes de publicar" (gate)
      │   builders HTML → renderizador Chrome headless :5680 → Cloudinary
      ▼
promoliso_fila (status READY)
      │
[Publicador E27F7yVdsZRj]  12:30 / 20:30 diário + 16:30 ter-qua-sex
      │   Instagram Graph (community node com token de ~/ig-token.json)
      ▼
Instagram @promoliso0  +  promoliso_fila (PUBLISHED)
      │
[promo-fila-writeback.cjs]  timer horário, FORA do n8n
      ▼
promoliso_publicacoes (operational_status, instagram_post_id, ...)
```

**Hospedagem:** VPS Hetzner CX23, Ubuntu 24.04, `/opt/promoliso`, user `promo`,
`https://n8n.promoliso.com.br` (Caddy + Let's Encrypt + basic auth).

**Stack confirmada:** n8n **2.30.4** (pinado), Node 24, **SQLite** como banco do n8n,
puppeteer-core + sharp no renderizador, Cloudinary para imagens.

> ⚠️ **Postgres/pgvector NÃO é o banco do projeto.** O produtor tem os nós `Obter noticias`
> (vectorStorePGVector), `Memória Postgres` e `Delete table or rows` (postgres), mas eles estão
> **desconectados do fluxo** (sem entrada e sem saída no grafo) e **não há credencial `postgres`
> no banco**. São resíduo de um experimento. Toda persistência de negócio é **n8n Data Table sobre
> SQLite** — foi essa a tecnologia usada na Fase 1.

---

## 2. Workflows e responsabilidade de cada um

| id | nome | ativo | responsabilidade | gatilho |
|---|---|---|---|---|
| `NL8eVLKErgnIXBQq` | Conteúdo Instagram v7.2 | sim | cura pauta, escreve, renderiza, enfileira | cron `0 0 8-22/2 * * *` |
| `E27F7yVdsZRj` | Publicador (fila) | sim | lê a fila, publica carrossel + story | 12:30, 20:30 diário; 16:30 ter/qua/sex |
| `MJly91QFGKep` | Monitor de saúde (watchdog) | sim | falha **silenciosa** (sem saldo OpenAI, sem publicar há ~26 h) → e-mail | 13:00 e 21:30 |
| `PRMLERR20260725A` | Monitor de erros operacionais | sim | Error Trigger → e-mail em erro **duro** | sob demanda |
| `PLRetryExec71` | Publicar execução aprovada 71 | **não** | one-shot histórico de retry | manual |

O produtor tem **117 nós**, dos quais **dezenas com `onError` diferente de `stopWorkflow`** — o
manifest em `workflows/*/_manifest.json` registra isso porque é a origem documentada das falhas
silenciosas do projeto.

---

## 3. Mapa do banco

`/opt/promoliso/data/.n8n/database.sqlite` (~800 MB em regime; `execution_data` é ~95% disso,
~8 MB por execução do produtor; retenção 168 h / 150 execuções).

### Data Tables **que já existiam** (project `UMEgamUOb3MlN67m`, pessoal)

| nome | id | tabela física | papel | colunas |
|---|---|---|---|---|
| `promoliso_publicacoes` | `FJFzDiOhgaT2ZOKv` | `data_table_user_FJFzDiOhgaT2ZOKv` | entidade **Publicação** | 11 + id/createdAt/updatedAt |
| `promoliso_curadoria_ai` | `PLAiCur8cTx26M1Q` | `data_table_user_PLAiCur8cTx26M1Q` | entidade **Pauta** (score, decisão, fonte) | 39 + 3 |
| `promoliso_fila` | `i2e8ZwnL9kwOV6OG` | `data_table_user_i2e8ZwnL9kwOV6OG` | buffer entre produtor e publicador | 13 + 3 |

Chave de junção entre as três: a URL normalizada (`content_key` ↔ `url_normalizada`), com a regra
`minúscula → tira ?/# → tira barra final`. Reimplementada em `analytics/lib/chaves.cjs` e
**testada contra o snapshot de produção** em `analytics/test/test_chaves.cjs`.

### Data Tables **criadas na Fase 1** (migration `001`)

| nome | id (determinístico) | papel / RF |
|---|---|---|
| `promoliso_metricas` | `4nzZfZ9Ktg8ffSVG` | entidade **Métrica da publicação** — RF-02 |
| `promoliso_versoes` | `Y29XnzBXGm68E4LX` | entidades **Template** e **Versão de prompt** — RF-05 |
| `promoliso_execucoes` | `waiHfNhcTlkN56MC` | entidade **Execução do workflow** — RF-11 (básico) |
| `promoliso_relatorios` | `Q64z8YfQmbr6UjIv` | entidade **Relatório semanal** — RF-04 |
| `promoliso_fontes` | `mWmG0iW4HZS1JueE` | entidade **Fonte** |

Mais **22 colunas novas** em `promoliso_publicacoes` (migration `002`) para os "Dados mínimos por
publicação" do PRD §11 que não existiam.

Tabela de controle `promoliso_analytics_migrations` (SQLite comum, não Data Table — precisa existir
antes de qualquer Data Table poder ser criada).

---

## 4. Integrações e credenciais (**sem valores**)

| credencial n8n | tipo | usada por | custo |
|---|---|---|---|
| `OpenAI account` | `openAiApi` | Curador, Verificador, estruturação | **pendência #2** |
| `Anthropic account` | `anthropicApi` | Redator (`GPT 5.4 mini` — nó com nome enganoso, é `lmChatAnthropic`) | **pendência #2** |
| `Instagram account` | `instagramOAuth2Api` | reconexão da conta (publicar usa `~/ig-token.json`) | grátis |
| `Cloudinary account` | `cloudinaryApi` | upload de slides/story | **pendência #2** |
| `Tavily account` | `tavilyApi` | busca detalhada (tool do agente) | **pendência #2** |
| `Brave Search account` | `braveSearchApi` | busca de capa (nó **órfão** hoje) | **pendência #2** |
| `SMTP account` | `smtp` | alertas e relatório | grátis |

Outras integrações **não credenciadas no n8n**:
- **Renderizador próprio** `127.0.0.1:5680` (Chrome headless + sharp), systemd `promo-renderer`
- **Instagram Graph API** via token em `/home/promo/ig-token.json` (600, dono `promo`) — o
  community node `instagram-integrations` foi patcheado para ler dali
- **Cloudflare R2** (`promoliso-backups`) via rclone 1.75, config em
  `/home/promo/.config/rclone/rclone.conf`

> ⚠️ **A Hetzner bloqueia saída em 25 e 465.** A credencial SMTP **tem** que estar em 587 com
> SSL/TLS desligado (STARTTLS), senão todo alerta some sem barulho. Já corrigido em 05/08.

---

## 5. Variáveis de ambiente (nomes, **nunca valores**)

### Já existentes (no unit `promo-n8n.service`)

`N8N_USER_FOLDER`, `N8N_EDITOR_BASE_URL`, `N8N_WEBHOOK_URL`, `TZ=America/Sao_Paulo`,
`N8N_SECURE_COOKIE`, `N8N_PUBLIC_API_DISABLED`, `EXECUTIONS_DATA_PRUNE`,
`EXECUTIONS_DATA_MAX_AGE`, `EXECUTIONS_DATA_MAX_COUNT`.

### Acrescentadas pela Fase 1 (todas com default seguro — ver `analytics/config.cjs`)

| variável | default | para quê |
|---|---|---|
| `PROMO_RAIZ` | `..` do módulo | raiz do projeto |
| `PROMO_DB` | `$PROMO_RAIZ/data/.n8n/database.sqlite` | banco do n8n |
| `PROMO_PROJECT_ID` | descoberto no banco | project onde as Data Tables vivem |
| `PROMO_IG_TOKEN_FILE` | `~/ig-token.json` | **caminho** do token (nunca o token) |
| `PROMO_IG_USER_ID` | vazio | id da conta IG; só para métricas de **perfil** |
| `PROMO_IG_GRAPH_BASE` | `https://graph.instagram.com` | base da API |
| `PROMO_IG_GRAPH_VERSION` | `v23.0` | versão da API |
| `PROMO_IG_TIMEOUT_MS` | `20000` | timeout por chamada |
| `PROMO_JANELAS` | `D1:1,D3:3,D7:7` | janelas de coleta |
| `PROMO_JANELA_TOLERANCIA_H` | `48` | até quando retentar uma janela |
| `PROMO_MAX_TENTATIVAS` | `4` | tentativas por janela |
| `PROMO_MARCO_ZERO` | derivado da migration 001 | janela anterior a isto é incoletável |
| `PROMO_ALERTA_CMD` | `/usr/local/bin/promo-alerta.sh` | canal de alerta/relatório |
| `PROMO_ALERTAS` | `1` | liga/desliga alerta |
| `PROMO_ANALYTICS_MOCK` | `0` | `1` = zero rede (homologação) |
| `PROMO_ANALYTICS_LOG_DIR` | `analytics/logs` | JSONL estruturado |
| `PROMO_TZ` | `America/Sao_Paulo` | fuso para hora/slot |

**Nenhum segredo é lido de variável de ambiente.** O token vem de arquivo; a senha de SMTP nunca é
lida por este módulo (o envio delega em `promo-alerta.sh`, que decifra a credencial do próprio n8n
com a encryptionKey local — não existe senha duplicada).

---

## 6. Linha de base

Registrada por `analytics/linha-de-base.cjs` (grava em `promoliso_relatorios` com
`tipo='LINHA_DE_BASE'`). Ela separa **MEDIDO** de **DECLARADO** de propósito.

Medição contra a cópia local de **2026-08-04** (para valer, precisa rodar no VPS — pendência #1):

| item | valor |
|---|---|
| publicações registradas | 28 (12 `PREPARED`, 6 `REJECTED`, 6 `WORKFLOW_ERROR`, 3 `FAILED_CONTAINER`, 1 `PUBLISHED`) |
| fila | 6 `PUBLISHED`, 5 `FAILED` |
| pautas avaliadas pela curadoria | 354, com 51,1% aprovadas |
| taxa de sucesso do produtor (na retenção) | 83,2% (114/137) |
| taxa de sucesso do publicador | 62,5% (15/24) |
| **alcance / visualizações** | **NÃO MEDIDO** — nenhuma métrica existia no banco antes da Fase 1 |
| declarado no PRD | 84 seguidores, ~15 visualizações/post (lido da UI, não do sistema) |

> A divergência "1 `PUBLISHED` em publicações contra 6 na fila" é o bug que o
> `promo-fila-writeback.cjs` foi criado para resolver, em 06/08 — depois desta cópia local. Rodar
> a linha de base no VPS dará o número correto.

**Metas do PRD §13 são provisórias e devem ser revistas depois de 30 dias de coleta**, porque a
meta de "+100% de alcance mediano" está ancorada num número que o sistema ainda não mediu.

---

## 7. Plano de backup, teste e rollback

### Backup
Já existe e foi **testado de verdade** (restauração completa provada em 05/08):
`promo-backup.sh` → `/opt/promoliso/backups/` + Cloudflare R2 (30 d). Timer diário 03:30 BRT.
O `instalar.sh` da Fase 1 **chama o backup como passo 1**, antes de qualquer migration.

### Teste
`node analytics/test/rodar-todos.cjs` — 7 arquivos, 504 verificações, banco de homologação
descartável, zero credencial real. Roda no passo 2 do `instalar.sh` e aborta a instalação se falhar.

### Rollback (três níveis, do mais leve ao mais pesado)

1. **Desligar o módulo** — `sudo bash analytics/systemd/desinstalar.sh`. Para os timers; o banco
   fica como está. Efeito imediato, sem risco.
2. **Reverter o banco** — `sudo REVERTER_BANCO=1 bash analytics/systemd/desinstalar.sh`, que roda
   `migrate.cjs down`: apaga as 5 tabelas novas e remove as 22 colunas novas. As colunas e linhas
   **originais** ficam intactas (verificado por `test_migrations.cjs`, invariantes M2/M3/M4).
3. **Restaurar o banco inteiro** — procedimento já documentado em `OPERACAO-VPS.md` §Restaurar.

Os **workflows não são tocados** pela Fase 1, então não há rollback de workflow a fazer.

---

## 8. Pendências

### Bloqueiam alguma implementação

| # | pendência | o que trava | como resolver |
|---|---|---|---|
| **1** | **Sem acesso SSH ao VPS nesta sessão** | instalar, medir a linha de base real e carimbar a linha de base de versões (`--adotar`) | rodar `analytics/systemd/instalar.sh` no VPS |
| **2** | **Permissões aprovadas na API da Meta** (PRD §16.7) | quais métricas de `insights` a conta pode ler | o cliente já **degrada sozinho** (descarta métrica recusada e grava o resto), mas a lista final só se sabe rodando com o token real. Ver `promoliso_metricas.erro` depois da 1ª coleta |
| **3** | **`PROMO_IG_USER_ID`** | métricas de **perfil**: visitas ao perfil e seguidores atribuíveis | informar o id da conta IG; sem ele, as métricas de **mídia** funcionam normalmente |

### Não bloqueiam a Fase 1, mas o PRD pede

| # | pendência | onde entra |
|---|---|---|
| 4 | **Custo mensal de cada API** (§16.2, §16.9) | não é mensurável a partir do projeto — nenhum dado de billing está no banco |
| 5 | **Programação de sexta/sábado/domingo** (§16.3) | os crons dizem 12:30 e 20:30 todo dia + 16:30 ter/qua/sex. Confirmar se é a intenção |
| 6 | **Como os links de afiliados chegam ao usuário** (§16.8) | necessário para RF-10 (P1) |
| 7 | **Plataformas de afiliado a priorizar** (§16.10) | necessário para RF-10 (P1) |
| 8 | **Fontes de imagem reutilizáveis com segurança** (§16.11) | necessário para RF-08 (P1) |
| 9 | **Latência fonte → post** (§16.4) | o script `linha-de-base.cjs` **já calcula**, mas depende de `data_coleta` preenchido; rodar no VPS |

### Já respondidas por esta auditoria

§16.1 (tecnologia do banco → **SQLite + n8n Data Tables**), §16.5 (regra de escolha das imagens →
`Selecionar melhor pauta` + gate de resolução em `Validar antes de publicar`), §16.6 (renderização
→ HTML → renderizador Chrome :5680 → Cloudinary), §16.12 (logs e alertas → journald + monitor de
erros + watchdog + `promo-alerta.sh`).
