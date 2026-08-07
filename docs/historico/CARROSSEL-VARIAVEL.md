# Carrossel de tamanho variável (plano de execução)

Escrito 2026-08-02. Objetivo: carrossel varia com a substância da pauta (oferta/notícia
simples = menos páginas; complexa = mais), **CTA sempre na última página**. Investigação
COMPLETA feita — abaixo os 6 pontos com a mudança exata. Fazer numa sessão focada, com o
usuário disponível pra dar **Execute no publicador** (o publish no IG eu não consigo testar).

## Alcance decidido
- `output.slides` = **2 a 5 itens** (slides[0]=capa + **1 a 4** slides de conteúdo).
- Páginas do carrossel = `slides.length + 1` (capa + conteúdo + CTA). Mín 3, máx 6.
- CTA (tipo='cta') **sempre** adicionado pelo Edit Fields como última página.

## Os 6 pontos (tudo em NL8eVLKErgnIXBQq, exceto o publicador)

### 1. Prompt — `design/new_systemMessage.txt` (deploy: patch_systemMessage.cjs)
- Seção "## Estrutura: exatamente cinco slides" → permitir variável:
  "capa (slides[0]) + **1 a 4** slides de conteúdo conforme a substância; oferta/notícia
  simples usa menos, complexa usa mais. Use os tipos (contexto/evidencia/impacto/acao) MAIS
  relevantes — não precisa usar todos. A 6ª página (CTA) é automática, não escreva."
- Ajustar o "## Formato JSON obrigatório" (o array slides pode ter 2 a 5).

### 2. buildCapa — `design/generate_nodes.cjs` (o template capaNode)
- Trocar `data.slides.length !== 5` por `data.slides.length < 2 || data.slides.length > 5`.
- Regenerar (`node generate_nodes.cjs`) + deploy `writer.cjs` (deploy-titan.ps1 serve).

### 3. Edit Fields (nó set, monta o array `slides` de render) — total dinâmico
Valor ATUAL (assignment "slides"):
```
={{ [...$('Validar antes de publicar').item.json.output.slides.slice(1).map((slide, index) => ({ ...slide, pagina: index + 2, total: 6, capaFallback: ...capa })), { tipo: 'cta', selo: 'FIQUE DE OLHO', titulo: 'NÃO PERCA A PRÓXIMA.', destaque: 'SIGA @PROMOLISO0.', texto: '...', imagem: '', fonte_imagem: 'PROMOLISO', pagina: 6, total: 6, capaFallback: ...capa }] }}
```
NOVO (total = slides.length+1; CTA pagina = total):
```
={{ (() => { const o=$('Validar antes de publicar').item.json.output; const T=o.slides.length+1; return [...o.slides.slice(1).map((s,i)=>({...s,pagina:i+2,total:T,capaFallback:o.capa})), {tipo:'cta',selo:'FIQUE DE OLHO',titulo:'NÃO PERCA A PRÓXIMA.',destaque:'SIGA @PROMOLISO0.',texto:'Notícias, promoções e alertas para comprar melhor e pagar menos.',imagem:'',fonte_imagem:'PROMOLISO',pagina:T,total:T,capaFallback:o.capa}]; })() }}
```

### 4. Validador "Validar antes de publicar" (⚠️ ponto delicado — errar rejeita TUDO)
Três travas do "5 fixo":
- **linha ~332** e **~570**: `output.slides.length === 5` → `output.slides.length >= 2 && output.slides.length <= 5`.
- **linha ~715**: `imagensValidas.length !== 6` → `imagensValidas.length !== output.slides.length + 1`.
  ⚠️ ANTES de editar, RELER como `imagensValidas` é montado (~linhas 640-715) e CONFIRMAR que
  a contagem esperada é `slides.length + 1` (capa + 1 imagem por slide). Testar com harness
  (dado real de exec) antes de deployar — esse é o que mais quebra.
- **linha ~437** `const tipos = ['capa','contexto','evidencia','impacto','acao']`: RELER como é
  usado. Se mapeia slide→tipo por índice fixo, quebra com variável → validar que `slide.tipo`
  ∈ tipos, sem exigir todos os 5. Se é só lista de referência, deixar.

### 5. Estruturar Saída (outputParserStructured) — opcional
O exemplo tem 5 slides. Parser estruturado por exemplo infere tipo (não trava tamanho de array),
então provavelmente NÃO precisa mexer. Se o agente insistir em 5, reduzir o exemplo pra 3 slides.

### 6. Publicador "Create a carousel post" (workflow E27F7yVdsZRj) — ⚠️ untestable por mim
ATUAL: `carouselChildren.child` = lista FIXA de 6 (cover + slides[0..4]).
NOVO: setar `carouselChildren` como EXPRESSÃO (array dinâmico). O nó itera `childrenData.child`
e trata child SEM `media_type:'IMAGE'` como VÍDEO → **incluir media_type:'IMAGE' explícito**:
```
={{ { child: [{ media_type:'IMAGE', image_url: $('Selecionar READY').item.json.cover }].concat(($('Selecionar READY').item.json.slides||[]).map(u=>({ media_type:'IMAGE', image_url:u }))) } }}
```
`Selecionar READY` JÁ é variável: `cover=urls[0]`, `slides=urls.slice(1,6)`. ✅
**TESTE OBRIGATÓRIO:** após deploy, usuário dá **Execute no "Executar Publicador"** numa row
READY (idealmente de carrossel curto) → confirmar que o IG posta. Se a API do IG recusar o
array dinâmico (fixedCollection via expressão pode não resolver em toda versão do nó), REVERTER
só esse nó (backup) e pensar plano B (ex: manter 6 filhos mas com image_url condicional, ou
node Code montando os containers via API direto).

## Ordem de execução recomendada
1. Pontos 1-4 no principal (prompt + buildCapa + Edit Fields + validador) + testar validador
   offline com dado real (harness) → deploy.
2. Rodar produtor (Execute) até aprovar uma pauta simples → conferir que rendeu carrossel CURTO
   (3-4 páginas) + gravou fila READY com carousel_urls variável.
3. SÓ ENTÃO ponto 6 (publicador dinâmico) → deploy → **Execute publicador** → confirmar post no IG.
4. Backups antes de cada deploy. Reverter é restaurar o backup do DB + religar.

## Contexto
Frases pequenas (cap 110) JÁ resolvido 2026-08-01 (deploy-frases.ps1, caps 42/38/300).
Ver [[estado-atual]]. Render loop já é dinâmico (Split Out em slides + Loop Over Items).
