# PromoLiso n8n — Plano de melhorias

Auditoria de 2026-07-28. Quatro frentes em paralelo: bugs, segurança/desempenho,
experiência de uso, produto. Tudo somente-leitura, sobre `NL8eVLKErgnIXBQq`
(110 nodes), 74 execuções, `server.cjs` (406 linhas) e os scripts de boot.

Confiança:
- **[2x]** / **[3x]** = achado encontrado independentemente por 2 ou 3 auditores
- **[?]** = suspeita não comprovada, precisa verificação

---

## Diagnóstico central

**A conta nunca publicou.** As 7 linhas de `promoliso_publicacoes` têm
`instagram_post_id` vazio: 6 `REJECTED` pelo operador, 1 `FAILED_CONTAINER`.

As 6 rejeições são por defeito de renderização, não por curadoria:

> "Página 4 com rodapé/assinatura cortados e página 5 com destaque incompleto:
> 'Salve a cobertura da.'"
> "Página 6 ainda corta o rodapé institucional."
> "duas imagens em baixa resolução"

Execuções 65–71 = mesma pauta (Xbox gamescom 2026) re-rodada 6× em 40 min,
corrigindo layout por tentativa e erro. **O operador é o linter.**

Consequência para a ordem de trabalho: nada de otimizar curadoria antes de a
esteira entregar uma arte publicável.

---

## Tier 0 — Destravar a publicação

Sem isto, o resto não importa.

### 0.1 Fallback de imagem do slide é um no-op — e a segunda tentativa derruba o fluxo
**Crítico.** Nodes `Usar capa como fallback` → `Renderizar slide com fallback`.

`Code in JavaScript` embrulha a imagem em Cloudinary fetch com a URL
percent-encoded:
```js
'https://res.cloudinary.com/fy2n2qvr/image/fetch/c_fit,w_1400,h_900,q_auto,f_auto/'
  + encodeURIComponent(source)
```
Mas `Usar capa como fallback` procura a URL **crua** no HTML:
```js
const imagemOriginal = String(slide.imagem || '');
if (imagemOriginal) html = html.split(imagemOriginal).join(imagemFallback);
```
O HTML contém `...fetch/.../https%3A%2F%2Fnews.xbox.com%2F...` — `includes()`
dá **false**, o `split/join` devolve HTML idêntico. Simulado com dado real.

Cadeia de falha: imagem quebrada → renderer 404 → `Convert HTML to JPEG image`
(tem `onError=continueRegularOutput`) sai sem binário → `Imagem do slide
válida?` false → fallback devolve o mesmo HTML → `Renderizar slide com
fallback` reposta igual → 400 → **e esse node não tem `onError`** → execução
morre. O caminho de fallback nunca funcionou uma vez.

Agravante: se o `split` funcionasse, injetaria a URL crua do domínio oficial,
que `allowedResource` (só `res.cloudinary.com`) abortaria → screenshot 200 com
**imagem em branco** → `!!$binary?.data` true → slide vazio publicado.

**Correção:** regerar o `src` pela mesma `safeImage()` em vez de `split/join`:
`html.replace(/(<img[^>]+src=")[^"]+(")/, '$1'+safeImageDoFallback+'$2')`.
E `onError: continueErrorOutput` em `Renderizar slide com fallback`.

### 0.2 Wait do carrossel espera 1 HORA por tentativa (teto 12h) [2x]
**Alto.** Node `Aguardar processamento do carrossel`, `parameters: {}` vazio.

Defaults do Wait node (`n8n-nodes-base/dist/nodes/Wait/Wait.node.js`):
`amount: 1`, `unit: 'hours'`. E `Carrossel ainda processando?` permite
`verification_attempt < 12`.

Contêiner do IG fica pronto em ~10s. Post aprovado 12:31 sai 13:31 no melhor
caso; pior caso 12h, além da janela de 24h do contêiner. Errado por 3 ordens
de grandeza.

**Correção:** `amount: 15`, `unit: seconds`. Com 12 tentativas = ~3 min de teto.

### 0.3 `Execução automática?` é um IF sem efeito [2x]
**Alto.** Conexões:
```
Execução automática? [main 0] -> Aprovar publicação
Execução automática? [main 1] -> Aprovar publicação
```
Os dois ramos vão para o mesmo node. A condição `$execution.mode ===
'production'` foi escrita para pular aprovação no agendado, e não pula nada.
Toda execução do cron para em `Aprovar publicação` (`limitWaitTime: true`,
`resumeAmount: 4`, unidade default `hours`); se ninguém abre em 4h, expira e
grava `REJECTED`.

Bate com o dado: das 74 execuções, só **3** são `mode: trigger`. 61 são
`manual`. O fluxo só anda quando o operador está na frente dele.

**Correção:** ligar a saída `true` direto em `Create a carousel post`, ou
apagar o IF se a aprovação for sempre obrigatória.

### 0.4 Nada avisa que há algo esperando decisão [2x]
**Alto.** Varredura dos 110 nodes: `emailSend: 0, telegram: 0, slack: 0,
discord: 0`. Nenhum canal de saída. Os formulários de aprovação existem, geram
URL, e a URL não vai para lugar nenhum.

Execução 74 está `waiting` desde 19:30 e vai expirar sem que ninguém saiba que
existiu.

**Correção:** um node (Telegram Bot ou e-mail) antes de cada `wait`, mandando
`{{ $execution.resumeFormUrl }}`. Dois lugares, um node cada. Subir
`resumeAmount` de 4h para 12h.

### 0.5 Capa sem verificação de imagem nem fallback
**Médio-alto.** `Convert HTML to JPEG image1` não tem `onError` e não há IF de
validação depois. Capa com imagem inacessível → 400 → workflow aborta antes de
qualquer persistência: nada é gravado sobre a falha.

**Correção:** replicar o padrão dos slides (`onError=continueRegularOutput` +
IF `!!$binary?.data` + caminho que grave `FAILED_RENDER`).

### 0.6 Auto-QA de layout no renderizador
**Alto.** Não é bug, é a feature que impede o Tier 0 de voltar.

`/render` passa a devolver métricas (header ou `?inspect=1`): `scrollHeight` vs
`height` pedido, e por elemento `data-guard` se `scrollHeight > clientHeight`
(texto truncado) ou se o bounding box sai do viewport (rodapé cortado).
No n8n, um IF `Layout íntegro?` antes de `Aprovar publicação`: se estourou, um
Code reduz `font-size` 8% e reenvia. Máx. 2 tentativas.

Ataca diretamente 100% das rejeições registradas.

---

## Tier 1 — Antes de expor na VPS

O n8n hoje **já está** na internet pelo túnel Cloudflare — a premissa de que
"só escuta em 127.0.0.1" não se sustenta. Na VPS com domínio fixo vira alvo
permanente de scanner.

### 1.1 Zero hardening
**Crítico.** Estado comprovado:

| Proteção | Estado |
|---|---|
| 2FA | `user.mfaEnabled = 0`, `mfaSecret = NULL` (1 usuário, `global:owner`) |
| `N8N_SECURE_COOKIE` | não setado |
| `N8N_PUBLIC_API_DISABLED` | não setado → `/api/v1` ativo |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | não setado → 34 nodes Code leem `process.env` |
| `N8N_UNVERIFIED_PACKAGES_ENABLED` | ligado |
| Rate limit / WAF | nenhum |

Hostname `trycloudflare.com` é enumerável via Certificate Transparency. Quem
achar a URL tem só login/senha entre ele e as 5 credenciais. Com a UI aberta:
criar node Code → ler `process.env` → exfiltrar `data/.n8n/config` → decifrar
tudo.

**Correção — bloco mínimo no compose:**
```yaml
N8N_PROTOCOL: https
N8N_SECURE_COOKIE: "true"
N8N_HOST: promoliso.seudominio.com
N8N_EDITOR_BASE_URL: https://promoliso.seudominio.com
N8N_WEBHOOK_URL: https://promoliso.seudominio.com
N8N_PUBLIC_API_DISABLED: "true"
N8N_BLOCK_ENV_ACCESS_IN_NODE: "true"
N8N_UNVERIFIED_PACKAGES_ENABLED: "false"
N8N_TEMPLATES_ENABLED: "false"
N8N_PAYLOAD_SIZE_MAX: "16"
N8N_RESTRICT_FILE_ACCESS_TO: /data/files
N8N_BLOCK_FILE_ACCESS_TO_N8N_FILES: "true"
```
Mais: **ativar 2FA no owner** antes de expor, e reverse proxy com TLS +
rate-limit em `/rest/login`.

### 1.2 Chave de criptografia — e uma proteção que eu removi
**Crítico.** `data/.n8n/config`, permissões `-rw-r--r--`.

Correção de rumo: ao consolidar os `.cmd` eu tirei
`N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS` com o comentário de que não existe no
Windows. Verdade no Windows (10 linhas de warning no `n8n.stderr.log`), **mas
funciona no Linux**. Tem que voltar na VPS.

**Correção:** não usar o arquivo — `N8N_ENCRYPTION_KEY` via `.env` (chmod 600,
fora do repo) + `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true"`. Como o token
do Instagram já vai ser recadastrado, é o momento de rotacionar a chave.

### 1.3 `isLocalRequest` quebra em Docker — e o conserto óbvio é catastrófico
**Alto.** `server.cjs:98-105`:
```js
return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
```
Ponto positivo: **não dá para forjar por header** — é `socket.remoteAddress`
puro, não lê `X-Forwarded-For`.

O problema é o inverso: em Docker o n8n chega como `172.x.x.x` → 403 em tudo →
o caminho de menor resistência é trocar por `return true`. Com
`RENDERER_HOST=0.0.0.0` (necessário entre containers), `/render` fica aberto:
HTML arbitrário num Chromium, sem auth. Fila serial de 30s → 10 requests
travam a publicação por 5 min.

**Correção:** trocar IP por segredo compartilhado (`RENDERER_TOKEN` +
`timingSafeEqual`), renderer sem `ports:` no compose, só rede interna.

### 1.4 SSRF bloqueado hoje, mas por um fio
**Alto.** O que protege: `allowedResource` exige `https:` + host
`res.cloudinary.com`, com `setRequestInterception` abortando o resto.
`169.254.169.254` → abortado. `file:///etc/passwd` → abortado.

Fragilidades: a blocklist de `<script|<iframe|<object|<embed` é **decorativa**
(não cobre `<svg><use>`, `<link rel=prefetch>`, `<meta refresh>`, `<img
srcset>`) — a segurança inteira depende só do `allowedResource`. E
`RENDERER_NO_SANDBOX=1` adiciona `--no-sandbox`, que em imagem Docker padrão
como root vira: HTML arbitrário + Chromium sem sandbox = execução no host.

**Correção:** CSP no documento montado, `page.setJavaScriptEnabled(false)` (os
templates não usam JS), renderer como usuário não-root **sem** `--no-sandbox`,
IMDSv2 obrigatório no provedor.

### 1.5 Community nodes com versão flutuante
**Alto.** Os 7 pacotes usam `^`. Quatro são de mantenedor individual, não
verificados. E **dois não são usados em nenhum dos 110 nodes**:
`n8n-nodes-atoscapital-htmltoimage` e `n8n-nodes-image-editor-pro` — superfície
de ataque morta.

Community node roda no mesmo processo, com acesso a `process.env` e ao
filesystem. Um mantenedor comprometido publica `0.2.2`, o `^` puxa no próximo
`docker compose up --build`, e a chave de criptografia vaza.

**Correção:** fixar versão exata (sem `^`), desinstalar os dois não usados.

### 1.6 Prompt injection via RSS — parcialmente mitigado, com um furo real
**Médio.** `dados_brutos` vai para o LLM **sem tratamento** — o item RSS
inteiro, HTML cru. Medido na exec 71: string de **74 KB** começando com
`<p><em><em>Welcome to Next Week on XBOX!...`.

O que salva: `Validar e consolidar curadoria` não confia na nota da IA —
reclama cada campo, **recalcula** a pontuação, valida enums, deriva a decisão
deterministicamente, exige JSON estrito. Mais dupla aprovação humana. Injeção
**não publica sozinha**.

O furo concreto: `titulo_sugerido` e `motivo` são renderizados **como HTML** no
`formDescription` do node de aprovação (`<h2>{{ $json.registro.titulo_original
}}</h2>`). Um `<img src=x onerror=...>` num título de RSS executa no navegador
de quem aprova, com a sessão do owner.

**Correção:** (a) não mandar `dados_brutos` ao LLM; (b) delimitar o dado
externo no prompt como não-confiável; (c) escapar HTML no `formDescription` —
a função `esc()` já existe em `Code in JavaScript:3-10`, é só reusar.

### 1.7 Sem credencial vazada nos logs
**Boa notícia, registrada.** Varredura completa dos 8 logs: `sk-`, `sk-proj-`,
`IGAA`, `EAA`, `tvly-`, `cloudinary://`, `client_secret` → **zero
ocorrências**. A chave OpenAI aparece só como placeholder LangChain (nome da
variável, não o valor). **Nada a rotacionar por vazamento.**

O que está lá: 135 eventos `n8n.ai.llm.generated` com prompts completos em
texto claro. Bomba armada, não detonada — no dia em que um segredo passar por
uma expressão, vai para o log sem redação.

---

## Tier 2 — Custo, tamanho e tempo

### 2.1 Mascote PNG de 248 KB em base64, embutido em cada slide
**Maior ganho isolado de tamanho.** Medido:
- data-URI de **253.846 chars (248 KB)**
- `Code in JavaScript` tem 263.115 bytes — **96% do node é a imagem**
- os dois nodes de template = 496 KB dos 677 KB do JSON do workflow (**73%**)
- o n8n grava snapshot do workflow por execução → `execution_data.workflowData`
  soma **30,9 MB em 74 execuções**
- o mascote é interpolado em **cada slide**: exec 71 tem ~1,77 MB de HTML dos
  4,82 MB totais, e esse HTML trafega 6× para o renderer

**Correção:** subir o mascote uma vez para o Cloudinary, trocar a constante por
URL. `allowedResource` já libera `res.cloudinary.com`. **Uma linha em cada
node.** Workflow 677 KB → ~180 KB; HTML por slide 254 KB → ~6 KB.

### 2.2 Retenção não dá conta do tamanho por execução
Média de **1,78 MB por execução**. `PRUNE_MAX_COUNT=500` autoriza ~890 MB de
SQLite e nunca vai agir (o schedule gera ~17 execuções/semana; em 14 dias são
~34). Só o `MAX_AGE` opera.

**Correção:**
```yaml
EXECUTIONS_DATA_MAX_AGE: "168"
EXECUTIONS_DATA_PRUNE_MAX_COUNT: "50"
EXECUTIONS_DATA_SAVE_ON_SUCCESS: none   # maior ganho isolado, ~90%
EXECUTIONS_DATA_SAVE_ON_ERROR: all
N8N_DEFAULT_BINARY_DATA_MODE: filesystem
N8N_BINARY_DATA_TTL: "60"
```
Combinado com 2.1, o banco fica abaixo de 15 MB. **Não copiar o
`database.sqlite` de 160 MB para a VPS** — exportar workflow + data tables.

### 2.3 LLM domina o tempo, com trabalho refeito
Exec 71: 203,7s de wall clock, 81s somando nodes, **~50s (62%) em LLM**. Os
122s restantes são fila do runner, `delayBetweenBatches: 3000` e Waits.

Redundância comprovada: o `AI Agent` recebe pauta **já curada, já verificada e
já aprovada** — o próprio system prompt admite *"Você atua somente depois da
aprovação manual da pauta"* — mas ainda manda *"Avalie pelo menos três
candidatas"*, `maxIterations: 6` e duas tools de busca. Refaz o trabalho do
Curador. System prompt medido: **41 KB**, reenviado a cada iteração.

**Correção:** `maxIterations` 6→2, cortar do prompt as seções de seleção de
pauta (~30 KB), `delayBetweenBatches` 3000→500, desconectar `Buscar capa`
quando já houver imagem oficial.

### 2.4 `Image Sharp` é no-op [?]
Dois nodes com `{"formats":["jpeg"]}` sobre entrada já JPEG. O `server.cjs` já
entrega `type:'jpeg'`. Custo medido: 1,5s.
**Não confirmado:** pode haver strip de EXIF exigido pelo Instagram. Remover só
depois de uma publicação de teste.

### 2.5 Renderizador — timeout que não existe e fila que trava
**Alto.** `MAX_RENDER_MS` só alimenta o timeout interno do `page.evaluate`. Não
há `Promise.race` em volta de `render()`, e `page.screenshot()` não tem limite.
Se o Chrome travar num slide, o job nunca resolve — e como `renderQueue` é
encadeada, **todo POST /render seguinte fica pendurado para sempre**.
Head-of-line blocking; só restart destrava. O registro id=2 documenta uma
renderização de *6min22s*.

Junto: `imageCache` conta **entradas** (60), não bytes. Pior caso teórico
60 × 12 MB × 1,33 ≈ 960 MB retidos sem TTL.

**Correção:** `Promise.race` com `MAX_RENDER_MS` fechando a página, `timeout`
explícito no `screenshot`, cache com teto em bytes (~64 MB) e expiração.

### 2.6 Dimensionamento da VPS
Chromium base 150-250 MB + ~80-120 MB por página 1080×1350 + Node ~60 MB +
cache. **Pico realista ~450 MB, teto ~1,2 GB.**

Total: n8n (~400 MB) + Postgres (~150 MB) + renderer (~450 MB) + SO =
**2 GB mínimo, 4 GB confortável**. Com 2 GB o OOM killer leva o Chromium no
meio de uma publicação. Compose precisa de `shm_size: 512mb` e
`--disable-dev-shm-usage` (default do Docker é 64 MB, o Chromium trava).

---

## Tier 3 — Qualidade do que é publicado

### 3.1 Corpo de texto ilegível no feed
**Alto.** No feed, 1080px viram ~390px num celular (fator 0,36):

| elemento | HTML | no feed | veredito |
|---|---|---|---|
| título Barlow | 82-116px | 30-42px | ótimo |
| corpo (até 190 chars) | **21px** | **7,6px** | ilegível |
| crédito da imagem | 10px | 3,6px | textura |
| `GAMES • HARDWARE • OFERTAS` | **8px** | **2,9px** | invisível |

Contraste está impecável (~15:1). O problema é só escala.
**Correção:** corpo 21px → 38px, e `limitar(slide.texto, 190)` → ~110.

### 3.2 A fonte Manrope é embutida e nunca usada
**Médio.** `fontsCss` embute dois TTFs em base64 em **toda** requisição.
`grep -c Manrope` nos templates = **0**. O contêiner declara
`font-family:Arial,Helvetica,sans-serif`.

Barlow Black vs Arial é um contraste bem mais fraco que Barlow vs Manrope.
**Correção:** trocar a string por `Manrope,Arial,sans-serif`. Dois lugares.

### 3.3 Rodapé remendado só nas páginas 2-6
**Alto — é o motivo das duas últimas rejeições.** Nas páginas internas o rodapé
virou `position:fixed`. **A capa não recebeu o mesmo tratamento** — ainda usa
`margin-top:auto` sem `overflow:hidden`. E nas páginas 2-6, como o rodapé saiu
do fluxo, o texto agora passa *por baixo* dele: trocou corte por sobreposição.

**Correção:** `overflow:hidden` no contêiner de texto dos dois templates.

### 3.4 `titulo_sugerido` sem limite no prompt
**Médio.** O prompt do Curador limita tudo (notas, enums) **exceto**
`titulo_sugerido`. Medido nas 44 linhas: min 25, **máx 59**, média 37 chars. O
layout foi calibrado para 18/26 e o `limitar()` corta em 34.

Ele aprova um título no formulário de curadoria e vê outro na arte.
**Correção:** *"titulo_sugerido: máximo 34 caracteres, sem ponto final."*

### 3.5 O system prompt do redator se contradiz
**Alto — fonte estrutural da variância.** Seções datadas empilhadas: `P0.5`,
`P0.6`, `P0.8`, `P0.10`, `P0.11`, `P0.12`, `P0.13`, `Fase 1`. Brigam entre si:

- **P0.6:** *"Se não encontrar imagens relevantes e nítidas, marque
  aprovado_para_publicar como false."*
- **Fase 1:** *"se houver menos de cinco imagens oficiais, reutilize-as em vez
  de reprovar a pauta."*

Mais três parágrafos com resoluções mínimas diferentes (1200x675 / 900x500 /
960x540 / 1024x576), cada um afrouxando o anterior. O modelo sorteia uma por
execução — é isso que faz 65 a 71, quase idênticas, darem resultados
diferentes.

A voz editorial em si é boa e consistente. O problema é estar soterrada por
regras de depuração.
**Correção:** consolidar as sete seções `P0.x` numa só, com **uma** resolução
mínima e **uma** política de reuso. Não é reescrever — é deletar duplicatas.

### 3.6 `decisao_recomendada` é campo morto
**Médio.** Nas 47 linhas: `aprovar` 43×, `arquivar` 3×, `aprovado` 1× (fora do
enum). As 3 de `arquivar` são justamente as com `pontuacao_total = 0` por
timeout. **Quando a IA responde, ela aprova 100% das vezes** — de 62 a 90
pontos. O prompt lista os valores mas não dá régua de quando usar cada um.

Elogio devido: o campo `motivo` é genuinamente bom, específico, com ressalva
editorial real. E os `alertas` são concretos.

**Correção:** *"use `aprovar` só com pontuacao_parcial >= 70; `arquivar` entre
40 e 69; `descartar` abaixo de 40."*

### 3.7 O story é um afterthought
**Médio.** 6 linhas de HTML: a capa com `object-fit:cover` e texto **fixo**
`"Novo post no feed!"`. Sem assunto, sem `@promoliso0`, sem mascote, sem
Barlow. E aplicar `cover` de 16:9 para 9:16 descarta ~78% da largura num crop
central cego.

**Correção:** interpolar o `titulo` do slide 1 e o `@promoliso0`. Duas
interpolações.

---

## Tier 4 — Funcionalidades novas

### 4.1 Renovação automática do token do Instagram
**P / alto.** Exec 39 (24/07) e 73 (28/07) morreram com `OAuthException 190`.
A credencial só foi corrigida em 28/07 — **6 dias falhando em silêncio**.
Vence a cada 60 dias, com data marcada.

Sub-workflow separado, schedule semanal: `GET /debug_token` → se faltar < 10
dias, `GET /oauth/access_token?grant_type=fb_exchange_token` → grava.
Junto: forçar `family: 4` nos nodes Instagram (exec 72 falhou com
`connect EACCES 2a03:2880:...` — IPv6 do Facebook inalcançável).

### 4.2 Banco de pautas (fila editorial persistente)
**P / alto — melhor ratio da lista.** O fluxo queima pauta boa. `Selecionar
melhor pauta` retorna `eligible[0]` — uma por execução. Na tabela: **12 linhas
com `decisao_recomendada = aprovar` que viraram `arquivar`** (pontuações 62 a
84) e **18 paradas em `CANDIDATO`**.

E nunca voltam: `Preparar fila de curadoria` filtra contra um `Set` de
`curation_key` da própria tabela. Pauta boa entra uma vez, perde para uma
melhor, e é banida para sempre. Hoje paga-se LLM para pontuar 5 e joga-se 4
fora.

**Correção:** excluir só `status_aprovacao IN ('APROVADO','REJEITADO')`, e em
`Selecionar melhor pauta` ranquear junto com as `CANDIDATO` dos últimos 30
dias, com decaimento por idade. Efeito colateral bom: estoque para dia de feed
fraco.

### 4.3 Captação de imagem — soltar a allowlist
**M / alto.** `imagem_principal` é o **único** valor em `dados_ausentes`, em
**16 das 47** linhas (34%). Doze travadas em
`REPROCESSAR_APOS_CORRECAO_IMAGENS`.

Causa: `collectOfficialImages` só aceita host do próprio domínio ou um
`officialCdnDomains` com **duas** entradas. Adrenaline (14), GameVicio (9) e
Flow Games (6) — **62% do volume** — servem de CDN de terceiro e caem fora.

**Correção:** trocar allowlist por denylist curta + validação real (HEAD para
`content-type`, dimensões via Cloudinary `fl_getinfo`, descartar < 800px). E
exigir URL distinta por slide — o operador rejeitou por *"repetição da mesma
imagem nos cinco slides"*.

### 4.4 Categoria normalizada + cota de fonte
**P / médio.** `categoria_classificada` é texto livre: `Games` (22), `games`
(17), vazio (3), `tecnologia`, `hardware`, `Tecnologia/Hardware`, `Hardware`,
`Animes`. Balanceamento é impossível de calcular.

E o desequilíbrio existe: Xbox 13 linhas (média 76,1), Adrenaline 14 (média
61,8), **Nintendo 0 e NVIDIA 0** — o feed da Nintendo aponta para
`nintendo.co.jp/news/whatsnew.xml`, o *site japonês*. **2 dos 8 feeds nunca
produziram um candidato.**

**Correção:** enum fechado no output parser; trocar o feed da Nintendo; em
`Selecionar melhor pauta`, penalizar (não banir) domínio/categoria das últimas
3 publicações.

### 4.5 Fundir Curador + Verificador
**M / médio-alto.** Os `alertas` mostram o custo do pipeline em série:
`divergencia_curador_confiabilidade` **7×**, `curador: decisão não permitida`
4×, timeouts 6×, "fora do limite" 3× cada em 5 variações. Resultado: 3 linhas
`ERRO_CURADORIA`.

Ambos rodam `gpt-5.4-mini`, `reasoningEffort: low`, sobre até 5 candidatos =
até 10 chamadas por execução.

**Correção:** um `chainLlm` devolvendo tudo num JSON, com enums fechados (mata
"fora do limite" e "decisão não permitida"). Verificador vira segunda passada
**condicional**, só quando `confiabilidade < 10` ou domínio editorial. Remove
~4 nodes.

### 4.6 Boletim diário de saúde
**P / médio.** Sub-workflow diário, ~8 nodes: execuções, erros, pautas
pontuadas/aprovadas/publicadas, estoque `CANDIDATO`, `debug_token` do
Instagram, HEAD no renderer. Mesmo canal do 0.4. Sem dashboard.

### 4.7 Não fazer agora
- **Métricas da Graph API realimentando a curadoria.** `instagram_post_id`
  está vazio nas 7 linhas — não há um post para consultar. Precisa de ~20-30
  posts. O que dá para preparar de graça: garantir que o campo seja de fato
  gravado.
- **Canais além do Instagram.** Com 6 rejeições por layout no canal principal,
  um segundo canal multiplica retrabalho, não alcance.
- **Trocar Puppeteer por render sem browser (satori).** Reavaliado: os slides
  usam gradiente, `object-fit:cover`, `border-radius` e sobreposição.
  Reescrever é refazer o layout do zero — e mata o Auto-QA (0.6), que depende
  do DOM. **Recomendação revista: manter Puppeteer.**

---

## Tier 5 — Higiene operacional

- **5.1** `Parar PromoLiso.cmd` não para o n8n em modo foreground — o
  `n8n.pid` só é escrito no ramo `-Background`. Explica os dois
  `port 5678 is already in use` no log. Fallback: `Get-NetTCPConnection
  -LocalPort 5678 -State Listen | ...`
- **5.2** `npm start` no `package.json` roda sem `N8N_USER_FOLDER` → abre um
  n8n vazio, sem workflow nem credencial. Trocar por chamada ao
  `start-promoliso.ps1`.
- **5.3** Logs sem timestamp, sem separador de boot, sem rotação. 12 boots
  concatenados. **499 das 958 linhas (52%)** são `Skipping execution data
  push`. O sinal real está soterrado: `port 5678 already in use` (2×),
  `connect EACCES` (2×), `Converting circular structure to JSON` (5×).
- **5.4** Monitor de erros `PRMLERR20260725A` está desativado — e mesmo ligado
  só **grava** numa tabela, não notifica. Pior: escreve na mesma tabela das
  publicações, misturando falha de sistema com histórico editorial. O vínculo
  já existe (`settings.errorWorkflow`), basta ativar + acrescentar notificação.
- **5.5** `content_key` tem **três formatos** nas mesmas 7 linhas:
  `released:rejected:1:<url>`, `rejected:65:<url>`,
  `retry:FAILED_CONTAINER:71:<url>`. Como o prefixo carrega estado e número de
  execução, `Verificar pauta repetida` nunca casa. A URL da gamescom aparece em
  3 linhas com 3 chaves. Fixar `content_key = urlCanonica(primary_url)` e
  deixar o estado em `operational_status`.
- **5.6** Linha `PREPARED` órfã bloqueia o `content_key` para sempre.
  `Montar contexto editorial` usa janela de 6h; `Verificar pauta repetida` **não
  tem janela**. Exec 36 (`crashed`, OOM) é o cenário: passadas 6h a IA escolhe
  de novo, bate em `Resultado DUPLICADO` — que é **dead-end sem persistência e
  sem notificação**. A pauta nunca mais pode ser publicada.
- **5.7** `Executar n8n.cmd` é duplicata declarada de `Iniciar PromoLiso
  n8n.cmd`. Os 4 `.bak` poluem a pasta. Mover para `_antigo/`.
- **5.8** Nodes Postgres/PGVector desabilitados sobrando no canvas.
- **5.9** Sem git.

---

## Ordem de execução sugerida

**Semana 1 — fazer a esteira publicar UMA vez**
0.1 (fallback no-op) → 0.2 (wait 1h→15s) → 0.3 (IF morto) → 0.5 (capa sem
guarda) → 3.3 (`overflow:hidden`) → 3.1 (corpo 38px). Depois: rodar até sair
um post real no Instagram. **Esse é o marco.**

**Semana 2 — parar de depender do operador**
0.4 (notificação) → 4.1 (renovação do token) → 5.4 (monitor de erros ligado e
notificando) → 3.5 (consolidar o system prompt).

**Semana 3 — VPS**
2.1 (mascote fora do base64) + 2.2 (retenção) **antes** de migrar, para levar
um banco de ~15 MB em vez de 235 MB. Depois todo o Tier 1. Não copiar o
`database.sqlite`.

**Semana 4+ — qualidade e economia**
0.6 (Auto-QA) → 4.2 (banco de pautas) → 4.3 (captação de imagem) →
2.3 (cortar LLM redundante) → 4.5 (fundir agentes).

---

## Pendências de verificação

- `Converting circular structure to JSON` (5× no log): não aparece em nenhum
  `execution_data` dos 16 registros de erro. Suspeita nos dois form-Waits, sem
  prova. Falta stack trace com o processo em execução.
- Custo em R$/US$ por execução: não estimado. Medido é o tempo (50s de 81s em
  LLM) e o tamanho do prompt (41 KB).
- RAM do renderer: derivada do código, não medida. Confirmar com `docker
  stats` sob carga.
- `N8N_UNVERIFIED_PACKAGES_ENABLED=false` pode quebrar os 4 community nodes em
  uso. Testar antes de aplicar.
- `Image Sharp` como no-op: verificar se faz strip de EXIF exigido pelo
  Instagram antes de remover.

---

## Verificado e SEM defeito

Para não gastar tempo:

- **Loop de retry de pauta** (`Preparar 2 tentativas` → `Tentar outra pauta`):
  índices `done`/`loop` corretos, não roda infinito.
- **Loop de slides** (`Split Out` → `Loop Over Items`): consistente. 5 slides
  entram, `Aggregate` produz 5 URLs, carrossel monta 6 filhos.
- **Consistência das data tables**: todas as colunas escritas existem no
  schema real.
- **`Story publicado?`**: `$json.status === 'published'` bate com o retorno do
  community node.
- **Dedup de notícia**: `curation_key` normalizada com strip de
  `utm_*`/`fbclid`/`gclid`/`igshid`. Sólido.
- **Proporções do Instagram**: carrossel 1080×1350 (4:5), story 1080×1920
  (9:16), `quality: 90`, 6 páginas. Tudo correto.
- **Contraste da paleta**: `#d5dae2` sobre `#050607` ≈ 15:1. Impecável.
- **`isLocalRequest`**: não é forjável por header.
- **Validação determinística da curadoria**: arquitetura certa — não confia na
  nota da IA, recalcula tudo.
- **Nenhuma credencial vazada em log.**
