# Plano — evolução editorial dos carrosséis

**Base:** PRD (11/08/2026) + SDD (12/08/2026) de melhoria dos carrosséis.
**Auditoria (Fase 1):** feita em 12/08/2026. Este documento é o resultado dela — não refaça a
descoberta, comece do passo 1.
**Estado:** nada da camada editorial foi implementado. Um patch está pronto e **não deployado**
(passo 0).

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

### Passo 0 — provar a expressão de coleção (PRONTO, NÃO DEPLOYADO)

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

---

### Passo 1 — medir os limites de texto no template real

**Vem primeiro porque trava o prompt e o validador.** O SDD proíbe copiar limite arbitrário.

Hoje existem limites só para `selo` (22), `destaque` (38) e `subtitulo` (130). Não há teto para o
corpo, nem nada para os tipos novos.

Como: `design/shot.cjs` renderiza local com Edge/Chrome, sem VPS. Montar cada tipo novo em três
densidades (curto, médio, limite) e anotar onde estoura. Registrar os números num arquivo que o
prompt e o validador vão citar.

Entregável: tabela de limites por tipo, versionada.

---

### Passo 2 — CTA contextual (isolado, pode ir a qualquer momento)

**A entrega com mais valor por menos risco.**

O `Edit Fields` já injeta um slide `tipo:'cta'` com `titulo`, `destaque` e `texto` — e o
`buildCta()` **ignora tudo isso**, renderizando texto literal próprio ("Entre no grupo de
OFERTAS / LINK NA BIO"). Metade do RF-07 é só reconectar código que já está sendo passado.

Mudança: `buildCta()` lê `slide.titulo/destaque/texto`, caindo no texto atual quando vierem
vazios. Depois, o agente passa a gerar esses campos.

Arquivo: `Code in JavaScript` (nó), função `buildCta`.

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
- os `=== 5` viram faixa.

---

### Passo 6 — fila e publicador aceitam 2 a 10

`selecionar-ready.js`: `urls.slice(1,6)` → `urls.slice(1)`. Manter compatibilidade com as rows
antigas (16 `READY` hoje com 6 imagens cada).

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
