# Plano — evolução editorial dos carrosséis

**Base:** PRD (11/08/2026) + SDD (12/08/2026) de melhoria dos carrosséis.
**Auditoria (Fase 1):** feita em 12/08/2026. Este documento é o resultado dela — não refaça a
descoberta, comece do passo 1.
**Estado (20/08):** **quantidade variável NO AR nas duas metades.** O publicador aceita de 2 a 10
imagens (`4bb8c077`) e o produtor gera de 3 a 7 slides (`8cdad9a8`, deployado 20/08 11:09). A etapa 1
foi provada antes de subir a etapa 2, como o plano exigia: **6 publicações em 18–19/08**, 3 slots por
dia, todas `success` com o publicador novo já no caminho. Passo 2 **no ar** (`09b70099`, inerte até o
passo 4 existir). Passo 1 feito **para o CTA** — os outros tipos só têm limite depois que existirem
(passo 3).

> **A primeira peça de tamanho variável nasce na corrida do produtor de 20/08 12:00 BRT.** Ela não
> publica no mesmo dia: o publicador pega a fresca mais velha e há peça de 6 imagens na frente. O que
> conferir na primeira: quantos slides o agente escolheu, se `carousel_urls` tem `slides+1` URLs, e se
> o `total`/`pagina` do CTA batem com a quantidade real.

> **A lição que mudou o método:** as duas falhas (05/08, 17/08) vinham de testar mecanismo novo
> DENTRO do publicador, onde cada tentativa custa um post. A saída foi o **banco de provas**: um
> workflow temporário na instância real, que exercita as formas candidatas e não publica nada — só
> cria containers, que expiram em 24 h. `design/prova_carousel_children.cjs` e
> `design/prova_switch_quantidade.cjs`. Todo mecanismo novo passa por lá antes.

---

## 0. Como o sistema está hoje

Cinco deploys em 11/08, todos verificados e na `main`:

| hora | mudança | versionId |
|---|---|---|
| 12:15 | capa full-bleed, modelo "marca-texto" | `8193cedf` |
| 12:43 | fallback acha a origem por âncora | `808e6844` |
| 14:35 | watchdog para de varrer HTML atrás de `429` | `dfb31644` |
| 14:56 | retry no render da capa (3×5 s) | `303ad559` |
| 16:50 | piso de resolução da capa 800 → 675 | `50485fb4` |

Workflows: produtor `NL8eVLKErgnIXBQq` (117 nós, cron `0 0 8-22/2`), publicador `E27F7yVdsZRj`
(slots 12:30, 20:30, e 16:30 nas ter/qua/sex), monitor `PRMLERR20260725A`, watchdog `MJly91QFGKep`.

---

## 1. O que a auditoria achou (não re-descobrir)

### Fluxo real

```
Feeds → Curador → Verificador → Selecionar pauta → AI Agent (redator) → Estruturar Saída
  → Validar antes de publicar     ← contrato editorial é cobrado aqui
  → Edit Fields                   ← ⭐ monta a lista de renderização (expressão n8n)
  → Split Out (campo "slides") → Loop → Code in JavaScript (buildSlide/buildCta)
  → Convert HTML to JPEG image → Sharp → Cloudinary → Aggregate
  → Fila: montar row → Salvar na fila (READY)
[publicador] Selecionar READY → Create a carousel post (6 filhos) → Publish
```

### Contrato de hoje

`output.slides` tem **exatamente 5**: `capa`, `contexto`, `evidencia`, `impacto`, `acao`.
Campos por slide: `tipo`, `selo`, `titulo`, `destaque`, `texto`, `subtitulo`, `imagem`,
`fonte_imagem`.

O `Edit Fields` transforma isso em 6 imagens:

```js
[ ...output.slides.slice(1).map((s,i) => ({ ...s, pagina: i+2, total: 6, capaFallback: output.capa })),
  { tipo:'cta', selo:'FIQUE DE OLHO', titulo:'NÃO PERCA A PRÓXIMA.', … , pagina:6, total:6 } ]
```

### O PRD pede coisas que JÁ EXISTEM

| Requisito | Onde já está |
|---|---|
| "Por que importa" (RF-05) | `tipo:"impacto"`, selo `POR QUE IMPORTA`, página 04 |
| "O que muda pra você" | `tipo:"acao"`, selo `O QUE FAZER`, página 05 |
| Enquadramento diferente entre slides (RF-10) | `treatmentFor()`: alterna `full`/`detail` por papel |
| Reutilizar imagem sem buscar mais | prompt: "Se houver menos de cinco, reutilize as disponíveis" |
| Legenda com gancho/corpo/CTA/hashtags | `formatar-legenda.js`, determinístico, não confia no LLM |

**Falta de verdade:** formatos sem foto (timeline, dado, lista), sequência que dependa da pauta,
CTA contextual, séries editoriais.

### Falso alarme (verificado, não é problema)

- Slide só de texto **não** quebra o fallback de imagem: o IF `Imagem do slide válida?` testa
  `!!$binary?.data`, ou seja, se a renderização gerou imagem — não se o slide tem foto.
- Story e analytics **não** dependem da quantidade de slides.
- O `Create a carousel post` **do produtor** é código morto (sem conexão de entrada). Só o do
  publicador está vivo.

---

## 2. Armadilhas medidas (leia antes de codar)

1. **`media_type` some quando a coleção vira expressão.** Os filhos gravados não têm `media_type`;
   funciona porque o n8n aplica `default: 'IMAGE'` em parâmetro aninhado. Virando string de
   expressão, não há onde aplicar o default — e o nó faz
   `if (child.media_type === 'IMAGE') {…} else { video_url }`. Sem o campo explícito, todo filho
   vira VIDEO com url indefinida.
2. **Quantidade variável já derrubou a publicação por 3 dias** (05/08). Ver passo 0.
3. **O "5" está cravado em 3 lugares:** `validar-antes-de-publicar.js:375` e `:623`,
   `code-in-javascript1.js:370`. E `selecionar-ready.js` corta em `slice(1,6)`.
4. **`--dry` no Windows não vale nada.** O banco local parou em 04/08. Dry-run só no VPS —
   é o passo 2 do `deploy-vps.sh`. Ver `data/.n8n/LEIA-ANTES-DE-RODAR-PATCH.md`.
5. **Trocar o nó do Instagram por HTTP puro é armadilha.** O token vive em `~/ig-token.json`, é
   lido com `fs.readFileSync` dentro do nó e renovado a cada 60 dias. Nem Code node nem HTTP
   Request leem arquivo.
6. **A CLI `n8n execute` não funciona** nesta versão ("No active execution found"), e ignora o
   `N8N_USER_FOLDER` do serviço — cria banco novo em `~/.n8n` e roda migrações nele.
7. **Deploy de render não muda o próximo post.** A fila guarda `carousel_urls` já renderizadas e o
   publicador pega a fresca **mais velha**. Mudança de arte leva ~2 dias pra aparecer.

---

## 3. Passos, em ordem

### Passo 0 — provar a expressão de coleção — **RESPONDIDO: NÃO** (revertido 17/08 23:40)

**O n8n 2.30.4 NÃO resolve expressão no nível da coleção.** A leitura do código-fonte dizia que
sim; a execução disse que não. Leitura não é execução — e esta é a segunda vez que essa incógnita
custa um slot (a primeira foi 05/08, 3 dias).

Medido na execução 340 (17/08 20:30, publicador `caf17307`):

| evidência | valor |
|---|---|
| saída do nó `Create a carousel post` | ramo de erro, `"The service was not able to process your request"` |
| tempo do nó | **12,4 s** — 3 tentativas × ~0,46 s + 2 esperas de 5 s |
| token, no mesmo dia | válido às 07:23 (healthcheck) e publicou às 12:30 |
| API + imagem da peça, testadas na mão | `POST /me/media` com a 1ª url devolveu `{"id":"18102359591183918"}` |
| `POST /me/media` com `media_type=CAROUSEL&children=` (vazio) | `OAuthException code 1` em **0,46 s** |

O último item é o fecho: `code 1` é exatamente a assinatura de 05/08, e o tempo por tentativa bate
com os 12,4 s observados. Se a expressão tivesse resolvido, o nó teria criado 6 containers filhos
(~1–2 s cada) antes de falhar — não caberia em 12,4 s com 3 tentativas.

A causa mecânica está no código do nó comunitário
(`n8n-nodes-instagram-integrations/dist/nodes/Instagram/Instagram.node.js:2074`):

```js
const childrenData = this.getNodeParameter('carouselChildren', i);
...
if (childrenData.child && Array.isArray(childrenData.child)) { /* cria os filhos */ }
const carouselBody = { media_type: 'CAROUSEL', children: childIds.join(','), caption };
```

Sem `.child` array, ele **não avisa** — segue e posta o pai com `children: ""`. Falha silenciosa
virando erro genérico do Meta três nós adiante.

Consequências para o passo B:

- a peça voltou como **`RETRY`** (id 59 da fila) — o mecanismo de 13/08 funcionou, a pauta não se
  perdeu, só o slot;
- o caminho para quantidade variável agora é o **plano B** (`Switch` na quantidade → um nó Instagram
  por tamanho, coleção estática), ou **patch no `dist` do nó comunitário** para aceitar string/array
  em `carouselChildren` — mesma classe de mudança que já fazemos em `getAccessToken`, com a mesma
  ressalva de sumir se o nó for reinstalado;
- **não** tentar de novo a expressão de coleção. A pergunta está respondida.

<details><summary>registro original (antes do deploy)</summary>

**Objetivo:** descobrir se dá pra ter quantidade variável com 1 parâmetro ou se precisa de 6 nós.

Arquivos: `design/patch_carousel_expr_passoA.cjs`, `design/test_carousel_expr_passoA.cjs`
(23 asserções verdes, dry-run OK contra produção).

Troca os 6 filhos estáticos do publicador por **uma** expressão que devolve a coleção inteira,
com saída **idêntica** à de hoje. Se publicar, a resolução está provada.

```
./deploy-vps.sh design/patch_carousel_expr_passoA.cjs
# rollback:
sudo -u promo node design/patch_carousel_expr_passoA.cjs --reverter
```

Se falhar: a publicação de um slot falha, o monitor avisa, a row vai pra `FAILED` (devolver pra
`READY` com um UPDATE). **Plano B garantido:** `Switch` na quantidade → 4–5 nós Instagram com
coleção estática de tamanhos diferentes. Mais nós, zero incógnita.

> **Instagram aceita 2 a 10 imagens.** Post de 1 imagem não é carrossel — é outra operação do nó
> (`createSinglePost`), trabalho separado.


</details>

---

### Passo 1 — medir os limites de texto no template real

**Vem primeiro porque trava o prompt e o validador.** O SDD proíbe copiar limite arbitrário.

**FEITO PARA O CTA (12/08).** `design/medir_limites_cta.cjs` mede na página (Edge headless, sem
VPS) e grava `design/limites_cta.json`. Régua: R1 o bloco termina até y=1290; R2 nada passa de
x=610 (fim da coluna); R3 nada chega a 12 px da **tinta** do mascote — bbox de alfa no canvas, não
a caixa de 540×560.

| campo | LIMITES do validador | teto isolado do CTA | adotado |
|---|---|---|---|
| selo | 22 | 32 | **22** |
| titulo | 42 | 62 | **42** |
| destaque | 38 | 22 | **19** |
| texto | 300 | 450 | **300** |

Ou seja: o CTA aguenta os mesmos limites dos outros slides, **menos o destaque**. A strip do
destaque tem fonte 46 px e a tinta do mascote começa em x=580 — 22 caracteres já chegam a x=595 e
encostam nele assim que o corpo empurra a strip para baixo de y=807.

Três coisas que a medição ensinou e que valem para os tipos novos (passo 3):

1. **Caixa não é tinta.** A primeira régua usou a caixa do mascote e devolveu limite de corpo (60)
   **menor que o texto que já está no ar** (101). Limite abaixo do que já roda é assinatura de
   régua errada, não de layout apertado.
2. **Encolher o campo errado.** Com todos os campos no teto, quem viola é a strip; a primeira
   versão do algoritmo cortava o corpo, que era inocente. A régua encolhe **quem viola**.
3. **Caractere não é pixel.** O corte devolve `…` e para em fronteira de palavra: cortado em 20 o
   destaque mediu 575 px onde a string crua de 20 mediu 563 — e 575 encosta no mascote. O limite só
   vale depois de provado **contra a saída do próprio corte**.

4. **Contagem de caractere é proxy ruim de pixel — e por isso limite sozinho não basta.** Auditando
   a própria régua: 19 letras "W" no destaque mediam **753 px** (contra 556 de um destaque largo
   realista) e um token sem espaço no corpo — uma URL — media **8567 px**, porque nada quebrava a
   linha. Foram duas travas de CSS no `buildCta`, que viram **garantia de estrutura**:
   `overflow-wrap:anywhere` no bloco e `max-width:496px` na linha da strip (72+496 = 568, a folga
   dos 12 px do mascote). Com elas a strip não alcança o mascote com conteúdo nenhum. O que
   continua sendo aposta é a ALTURA: 300 caracteres de prosa dão 1287 px de bloco, 300 letras "W"
   dão 1959 — quem tem que recusar isso é o validador (passo 5).
5. **Não existe combinação única.** Os campos dividem a altura: `destaque 38 + texto 250` e
   `destaque 19 + texto 300` são as duas válidas. O código adota a segunda (a strip é um botão; com
   38 ela vira duas linhas). Por isso `limites_cta.json` grava as duas, e a régua só reprova se o
   adotado passar do teto **isolado** de algum campo.

Falta: os limites dos tipos novos (timeline, dado, lista), que só existem depois do passo 3.

**Fidelidade da régua local, verificada (não assumida):** comparando o slide 06 renderizado em
produção (`design/audit_slide6.jpg`, Chrome do VPS) com o render local, as faixas de tinta batem
dentro de **1 px** em tudo que usa a fonte embutida. Diverge só onde o texto usa a fonte do
sistema: o `@promoliso0` sai 7 px mais baixo e 14 px mais largo aqui (Arial no Windows vs Liberation
Sans no Linux). A folga de R3 é 15 px e a strip — o elemento que importa — divergiu 5 px. A régua
transfere, com essa ressalva escrita.

---

### Passo 2 — CTA contextual — **PRONTO, NÃO DEPLOYADO (12/08)**

**A entrega com mais valor por menos risco.**

O `Edit Fields` já injeta um slide `tipo:'cta'` com `titulo`, `destaque` e `texto` — e o
`buildCta()` **ignorava tudo isso**, renderizando texto literal próprio ("Entre no grupo de
OFERTAS / LINK NA BIO"). Metade do RF-07 era só reconectar código que já estava sendo passado.

Arquivos:

- `design/cta_contextual.src.js` — o `buildCta` novo (bloco versionado, igual ao da capa)
- `design/patch_cta_contextual.cjs` — costura: acha o `buildCta` por marcador, confere o **sha256**
  do que está em produção e troca nos dois nós; e tira os quatro campos mortos do `Edit Fields`
- `design/test_cta_contextual.cjs` — 30 asserções, **todas verdes**
- `design/medir_limites_cta.cjs`, `design/limites_cta.json` — a régua do passo 1
- `design/shot_cta_{hoje,agente,limite}.png` — as três situações no olho

O que muda: `buildCta()` lê `selo/titulo/destaque/texto` do slide, cai no texto institucional
quando vierem vazios, **escapa o corpo com `esc()`** (era interpolado cru, ou seja, HTML do agente
entraria no slide) e corta cada campo no limite medido. O `Edit Fields` para de mandar os quatro
campos mortos e passa a espalhar `output.cta`.

**Hoje não muda nada, e isso é provado duas vezes:** enquanto o agente não gerar `output.cta`, o
spread é `{}` e os defaults valem. O harness compara o código velho + slide velho contra o código
novo + slide novo e o HTML é igual **fora as duas travas de CSS**; e `medir_limites_cta.cjs` tira
foto dos dois e compara **pixel a pixel**. Quem liga a capacidade é o passo 4 (prompt), não este
patch.

Verificado também, porque era o risco herdado de 05/08: o **spread `...(output.cta || {})` roda no
motor de expressão do n8n** (testado contra o `@n8n/tournament` 1.6.0 instalado, não presumido). E
nenhum outro nó lê os 4 campos que saem do `Edit Fields` — o único consumidor de `$('Edit Fields')`
é o `Fila: montar row`, e só pela `legenda`.

Fica cravado de propósito: `@promoliso0` (identidade da conta) e o mascote. De carona, o
`tabPage('06', total)` cravado virou `slide.pagina` — hoje dá exatamente `'06'` e deixa de mentir
quando a quantidade variar (passo 6).

```bash
node design/test_cta_contextual.cjs                       # Windows, sem VPS
node design/medir_limites_cta.cjs --fotos                 # refaz a régua e as fotos
./deploy-vps.sh design/patch_cta_contextual.cjs           # no VPS
```

⚠️ Como todo deploy de render, **não muda o próximo post**: a fila guarda `carousel_urls` já
renderizadas (~2 dias de atraso).

---

### Passo 3 — tipos de slide sem foto

Adicionar em `buildSlide()`: `timeline`, `highlight_stat`, `short_list`. Reusar os componentes de
identidade que já existem (`titleMetal`, `kickerChip`, `stripDestaque`, `slash`, `footer`,
`grain`). Tipo desconhecido cai no `default`, que é o layout atual — o fallback é a própria
estrutura do `switch`.

Testar com `design/shot.cjs` antes de qualquer deploy.

---

### Passo 4 — planejamento editorial

O agente escolhe os tipos do meio conforme a pauta, dentro de uma lista fechada. Prompt versionado
(convenção existe: `Configuração PromoLiso AI` carrega `versao`, `prompt_curador`).

Regras que o prompt precisa carregar: quando cada tipo cabe, campos obrigatórios por tipo, e
proibição explícita de inventar timeline ou número que não esteja na fonte.

---

### Passo 5 — validador por tipo

`validar-antes-de-publicar.js`:

- `timeline` exige 2+ eventos com data presente na matéria;
- `highlight_stat` exige número presente no texto de entrada;
- tipo desconhecido → rebaixa para slide com foto, **não** derruba a execução;
- os `=== 5` viram faixa;
- **os limites do CTA entram no `LIMITES` do validador.** Hoje eles moram no `CTA_LIM` do nó de
  render (necessário: o corte é guarda de layout). Isso é uma terceira cópia dos números — o que
  custou semanas em 05/08. Por ora quem guarda é `test_cta_contextual.cjs`, que compara `CTA_LIM`
  com o `limites_cta.json`; quando o validador passar a cobrar o CTA, estender
  `design/verifica_limites.cjs` para cobrir os dois.

---

### Passo 6 — fila e publicador aceitam 2 a 10 — **NO AR 18/08** (`4bb8c077`)

Feito pelo plano B, que agora tem prova em vez de aposta: um `Switch` por quantidade e **um nó do
Instagram por tamanho** (`Carrossel 02` a `Carrossel 10`), todos gerados do mesmo molde.

Arquivos: `design/patch_carrossel_variavel_publicador.cjs`,
`design/test_carrossel_variavel_publicador.cjs` (100+ asserções),
`design/selecionar_ready_variavel.{src.js,gen.cjs}`, `design/selecionar_ready_antes_variavel.txt`.

**Não mudou nenhum post:** toda peça na fila tem 6 imagens (medido nas 61 rows), então ela segue
pelo `Carrossel 06`, cujas 6 urls são as mesmas, na mesma ordem, do nó de antes. O harness roda o
`Selecionar READY` contra a fila REAL e exige a mesma peça, a mesma capa e os mesmos slides.

Três decisões que valem para o resto:

1. **A conta de qual saída usar mora no código, não na expressão do Switch.** Índice fora da faixa
   faz o Switch lançar erro — bom, não é silencioso — mas o erro deixaria a row presa em
   `PUBLISHING`, o único estado que nem publica nem alerta. Então `Selecionar READY` garante a faixa
   antes de sair: menos de 2 é erro, mais de 10 é cortado no teto do Instagram.
2. **`media_type: 'IMAGE'` escrito à mão em todo filho.** Hoje ele não existe e funciona por um
   default que o n8n preenche em parâmetro aninhado — a mesma armadilha que teria virado todo filho
   em VIDEO no passo 0.
3. **O código novo é derivado do que estava no ar por substituições explícitas**
   (`selecionar_ready_variavel.gen.cjs`), então frescor, RETRY e nota ficam idênticos por
   construção. Diff real: 3 linhas removidas.

### Passo 6b — produtor gera de 3 a 7 slides — **NO AR 20/08** (`8cdad9a8`)

Arquivos: `design/patch_carrossel_variavel_produtor.cjs`,
`design/test_carrossel_variavel_produtor.cjs` (tudo verde).

**Faixa: 3 a 7 slides = 4 a 8 imagens.** Não é o teto do Instagram, e o motivo é medido: cada slide
do meio consome uma imagem única e a média é 3,4 por pauta (28 execuções). São dois números no patch
se o dono quiser outra faixa.

**Regra editorial:** primeiro slide sempre `capa`, último sempre `acao` (onde mora o pedido). No
meio, de 1 a 5 slides de tipo `contexto`, `evidencia` ou `impacto`, em qualquer ordem e podendo
repetir — o layout dos três é o mesmo, o que muda é o papel no texto.

**As SEIS cópias do mesmo número**, todas no mesmo patch (a lição de 05/08):

| onde | o que era |
|---|---|
| `Validar antes de publicar` | os dois `=== 5` |
| `Validar antes de publicar` | a lista fixa `tipos`, que só descrevia 5 slides |
| `Validar antes de publicar` | o `!== 6` das imagens → `slides.length + 1` |
| `Code in JavaScript1` | a guarda da capa |
| `Edit Fields` | `total: 6` e `pagina: 6` do CTA |
| `AI Agent` | o prompt ("exatamente cinco slides") |

O sexto **não estava na lista de ninguém** e era o pior: `Fila: montar row` montava
`[cover, agg[0]…agg[4]]`, cravado em 5. Isso truncaria a peça de 8 imagens de volta pra 6 **em
silêncio**, na gravação da fila — nada reprova e o post sai com slide faltando.

Conferido que **não** precisou mudar: `Split Out`, `Loop Over Items`, `Aggregate` e a recuperação de
imagem do validador (`index % imagens.length`) já são agnósticos à quantidade; `Estruturar Saída`
não constrange tamanho de array.

~~⚠️ **Deployar só depois de a publicação das 12:30 provar a etapa 1.**~~ Cumprido: as 6 publicações
de 18–19/08 (12:32, 16:32, 20:31 BRT nos dois dias, todas `success`) provaram o publicador novo antes
de o produtor subir. Deploy em 20/08 11:09 com `draft_igual_pub = 1` — a versão **publicada** é a
patchada, que é o que o cron roda.

---

### Passo 7 — flag e observabilidade

Flag em `Configuração PromoLiso AI` + um IF que desvia pro caminho atual. Logar: plano escolhido,
quantas imagens únicas havia, tipos usados, se houve fallback e por quê, versão do prompt.

---

## 4. Decisões que dependem do responsável

1. **A conta das imagens.** "3 slides" é 3 imagens no total, ou capa + 3 + CTA (= 5)? Muda o
   número em todo lugar.
2. **Shadow mode vale?** O SDD pede gerar v2 sem publicar. Dobra o trabalho do renderizador — que
   é justamente o componente que falhou 4× em 7 dias por timeout de 12 s. Alternativa: piloto
   direto com fallback, que o fluxo já sabe fazer.
3. **Mover a montagem do `Edit Fields` para um nó Code?** Recomendado: hoje é a peça mais crítica
   do fluxo e a única que não é código versionado nem testável.
4. **Passo 0 antes ou depois** de fechar as decisões acima (é independente).
5. **O agente pode reescrever o `destaque` do CTA?** O patch do passo 2 deixa ele reescrever os
   quatro campos. O `destaque` é onde mora o pedido de conversão ("LINK NA BIO ↗"); liberado, o
   modelo pode trocá-lo por uma frase bonita e sem pedido. As opções: (a) liberar e cobrar no
   validador (passo 5) que o destaque contenha um pedido de ação; (b) travar o `destaque` no
   literal e deixar o agente escrever só selo/titulo/texto — uma linha a menos no prompt. Só entra
   em jogo no passo 4; até lá o campo vem vazio e cai no literal.

---

## 5. Pendências herdadas (não são deste plano)

- A nota que entrou no `OPERACAO-VPS.md` foi pro GitHub público — reverter se quiser.
- O exportador não registra `retryOnFail`/`maxTries`, então o retry do render da capa é invisível
  no repo.
- Layout dos slides internos ainda é o antigo (hero recortado); só a capa virou full-bleed.
- Fundo borrado para imagem sub-piso: prototipado em `design/capa_mock_fallback.cjs`, não adotado.
- Watcher da fila (avisava quando nascia row nova) morreu com a sessão; rearmar se útil.

---

## 6. Comandos

```bash
# harnesses (rodam no Windows, sem VPS)
node design/test_capa_fullbleed.cjs --rede
node design/test_carousel_expr_passoA.cjs
node design/test_cta_contextual.cjs
node design/medir_limites_cta.cjs --fotos

# dry-run e deploy (SÓ no VPS)
ssh root@<vps> 'cd /opt/promoliso && sudo -u promo node design/patch_X.cjs --dry'
ssh root@<vps> 'cd /opt/promoliso && AUTO=1 ./deploy-vps.sh design/patch_X.cjs'

# depois de todo deploy: regerar o export
ssh root@<vps> 'cd /opt/promoliso && sudo -u promo node export-workflows.cjs'

# render local pra conferir arte
node design/capa_modelos.cjs && node design/shot.cjs noar_sh
```

Enviar arquivo pro VPS (`scp` falha mais que `ssh`):

```bash
ssh root@<vps> 'cat > /opt/promoliso/design/X && chown promo:promo /opt/promoliso/design/X' < design/X
```
