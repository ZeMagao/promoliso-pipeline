// CARROSSEL DE QUANTIDADE VARIÁVEL — metade do produtor (etapa 2 de 2).
//
// A etapa 1 (publicador, versão 4bb8c077) já aceita de 2 a 10 imagens e está inerte, porque o
// produtor só sabe gerar 6. Esta etapa é a que faz a quantidade variar de verdade.
//
// A FAIXA ESCOLHIDA: de 3 a 7 slides, que dão de 4 a 8 imagens (capa + slides + a página
// institucional). Não é o máximo que o Instagram aceita (10), e o motivo é medido: cada slide do
// meio consome uma imagem única, e a média medida é de 3,4 imagens únicas por pauta (28 execuções).
// Com 7 slides a repetição de arte já domina o carrossel. Se o dono quiser outra faixa, são dois
// números aqui — e o harness cobra que todas as cópias concordem.
//
// -- AS SEIS CÓPIAS DO MESMO NÚMERO --
//
// Este é o patch onde o erro de 05/08 pode se repetir: lá um teto que morava em dois lugares
// divergiu e zerou a pauta por semanas. O "5" mora em SEIS lugares, e todos entram no mesmo patch:
//
//   1. `Validar antes de publicar`  os dois `=== 5` e o `!== 6` das imagens
//   2. `Validar antes de publicar`  a lista fixa `tipos`, que só descreve 5 slides
//   3. `Code in JavaScript1`        a guarda da capa (`slides.length !== 5`), que derruba a
//                                  execução de uma pauta que o validador aprovou
//   4. `Edit Fields`               `total: 6` e `pagina: 6` do CTA, cravados
//   5. `Fila: montar row`          `[cover, agg[0], agg[1], agg[2], agg[3], agg[4]]` — este não
//                                  estava na lista de ninguém, e é o pior deles: truncaria a peça
//                                  de 8 imagens de volta pra 6 EM SILÊNCIO, na gravação da fila
//   6. `AI Agent`                  o prompt ("exatamente cinco slides")
//
// O que NÃO precisou mudar, conferido: o `Split Out`, o `Loop Over Items`, o `Aggregate` e a
// recuperação de imagem do validador (`index % imagens.length`) já são agnósticos à quantidade. E o
// `Estruturar Saída` não constrange tamanho de array — o exemplo com 5 slides é só a forma.
//
// -- A REGRA EDITORIAL --
// Primeiro slide é sempre `capa`, último é sempre `acao` (é onde mora o pedido). No meio, de 1 a 5
// slides de tipo `contexto`, `evidencia` ou `impacto`, na ordem que a história pedir e podendo
// repetir tipo — o layout dos três é o mesmo, o que muda é o papel no texto. Quem escolhe quantos é
// o agente, pela matéria que tem em mão.
//
// ROLLBACK: `--reverter` desfaz as seis trocas (cada uma é uma substituição exata e reversível).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO_VALIDADOR = 'Validar antes de publicar';
const NO_CAPA = 'Code in JavaScript1';
const NO_EDIT = 'Edit Fields';
const NO_ROW = 'Fila: montar row';
const NO_AGENTE = 'AI Agent';

// A ÚNICA fonte destes dois números neste patch. Tudo abaixo é derivado deles, e o harness confere
// que o texto gravado em cada nó fala o mesmo número.
const MIN_SLIDES = 3;
const MAX_SLIDES = 7;
const MIN_IMAGENS = MIN_SLIDES + 1;
const MAX_IMAGENS = MAX_SLIDES + 1;

const VALIDA = '$(\'Validar antes de publicar\').item.json.output';

// ============================================================================ 1. o validador
const VALIDADOR_TROCAS = [
  {
    nome: 'faixa de slides declarada',
    de: "const LIMITES = { selo: 22, titulo: 42, destaque: 38, texto: 300, legenda: 1800 };",
    para: "const LIMITES = { selo: 22, titulo: 42, destaque: 38, texto: 300, legenda: 1800 };\n"
      + "// Quantos slides o carrossel pode ter. O publicador aceita de 2 a 10 IMAGENS (versão\n"
      + "// 4bb8c077, um nó por tamanho); aqui a faixa é mais estreita por motivo editorial: cada\n"
      + `// slide do meio come uma imagem única, e a média medida é 3,4 por pauta.\n`
      + `const MIN_SLIDES = ${MIN_SLIDES};\n`
      + `const MAX_SLIDES = ${MAX_SLIDES};\n`
      + "const slidesNaFaixa = (n) => n >= MIN_SLIDES && n <= MAX_SLIDES;",
  },
  {
    nome: 'estrutura editorial completa',
    de: "  output.slides.length === 5 &&",
    para: "  slidesNaFaixa(output.slides.length) &&",
  },
  {
    nome: 'lista fixa de tipos',
    de: "const tipos = ['capa', 'contexto', 'evidencia', 'impacto', 'acao'];",
    para: "// A ordem deixou de ser fixa. Obrigatório: o PRIMEIRO slide é a capa e o ÚLTIMO é a ação\n"
      + "// (onde mora o pedido ao leitor). No meio, qualquer um destes três, em qualquer ordem e\n"
      + "// podendo repetir — o layout dos três é o mesmo, o que muda é o papel no texto.\n"
      + "const TIPO_PRIMEIRO = 'capa';\n"
      + "const TIPO_ULTIMO = 'acao';\n"
      + "const TIPOS_DO_MEIO = ['contexto', 'evidencia', 'impacto'];\n"
      + "const tiposAceitos = (index, total) => (index === 0\n"
      + "  ? [TIPO_PRIMEIRO]\n"
      + "  : (index === total - 1 ? [TIPO_ULTIMO] : TIPOS_DO_MEIO));",
  },
  {
    nome: 'contagem e tipo de cada slide',
    de: "} else if (output.slides.length !== 5) {\n"
      + "  problemasSlides.push('esperava 5 slides e vieram ' + output.slides.length);\n"
      + "} else {\n"
      + "  output.slides.forEach((slide, index) => {\n"
      + "    const onde = 'slide ' + (index + 1) + ' (' + tipos[index] + ')';\n"
      + "    if (slide?.tipo !== tipos[index]) {\n"
      + "      problemasSlides.push(onde + ': tipo veio \"' + (slide?.tipo ?? 'ausente') + '\"');\n"
      + "    }",
    para: "} else if (!slidesNaFaixa(output.slides.length)) {\n"
      + "  problemasSlides.push('esperava de ' + MIN_SLIDES + ' a ' + MAX_SLIDES + ' slides e vieram ' + output.slides.length);\n"
      + "} else {\n"
      + "  output.slides.forEach((slide, index) => {\n"
      + "    const aceitos = tiposAceitos(index, output.slides.length);\n"
      + "    const onde = 'slide ' + (index + 1) + ' (' + aceitos.join('|') + ')';\n"
      + "    if (!aceitos.includes(slide?.tipo)) {\n"
      + "      problemasSlides.push(onde + ': tipo veio \"' + (slide?.tipo ?? 'ausente') + '\"');\n"
      + "    }",
  },
  {
    nome: 'mensagem da estrutura',
    de: "  erros.push('Estrutura dos cinco slides inválida -> ' + problemasSlides.join('; '));",
    para: "  erros.push('Estrutura dos slides inválida -> ' + problemasSlides.join('; '));",
  },
  {
    nome: 'quantidade de imagens',
    de: "if (imagensValidas.length !== 6) {\n"
      + "  erros.push(\n"
      + "    'Esperava 6 imagens válidas (capa + 5 slides) e passaram ' + imagensValidas.length,\n"
      + "  );\n"
      + "}",
    para: "// Uma imagem por slide, mais a capa. Antes era 6 cravado, que só valia pra 5 slides.\n"
      + "const imagensEsperadas = Array.isArray(output.slides) ? output.slides.length + 1 : 0;\n"
      + "if (imagensValidas.length !== imagensEsperadas) {\n"
      + "  erros.push(\n"
      + "    'Esperava ' + imagensEsperadas + ' imagens válidas (capa + ' + output.slides.length\n"
      + "      + ' slides) e passaram ' + imagensValidas.length,\n"
      + "  );\n"
      + "}",
  },
];

// ============================================================================ 2. a capa
const CAPA_TROCAS = [
  {
    nome: 'guarda da capa',
    de: "const data = $input.first().json.output;\n"
      + "if (!data || !Array.isArray(data.slides) || data.slides.length !== 5) {\n"
      + "  throw new Error('Saída editorial incompleta');\n"
      + "}",
    para: "const data = $input.first().json.output;\n"
      + "// A MESMA faixa do validador. Se divergir, a capa derruba a execução de uma pauta que o\n"
      + "// validador aprovou — o desencontro de números que custou semanas em 05/08. O harness\n"
      + "// compara estes dois valores com os do validador.\n"
      + `const MIN_SLIDES = ${MIN_SLIDES};\n`
      + `const MAX_SLIDES = ${MAX_SLIDES};\n`
      + "if (!data || !Array.isArray(data.slides) || data.slides.length < MIN_SLIDES || data.slides.length > MAX_SLIDES) {\n"
      + "  // a mensagem diz QUANTOS vieram: 'incompleta' sozinha manda a gente caçar fantasma\n"
      + "  throw new Error('Saída editorial incompleta: '\n"
      + "    + (data && Array.isArray(data.slides) ? data.slides.length + ' slides, fora de ' + MIN_SLIDES + '..' + MAX_SLIDES : 'sem slides'));\n"
      + "}",
  },
];

// ============================================================================ 3. a fila
const ROW_TROCAS = [
  {
    nome: 'montagem do carousel_urls',
    de: "const carousel = [cover, agg[0], agg[1], agg[2], agg[3], agg[4]].filter(Boolean);",
    para: "// Era [cover, agg[0]..agg[4]]: cravado em 5 slides. Com quantidade variável isso truncaria a\n"
      + "// peça de 7 ou 8 imagens de volta pra 6 EM SILÊNCIO, aqui na gravação da fila — o pior lugar\n"
      + "// possível, porque nada reprova e o post sai com slide faltando.\n"
      + "const carousel = [cover, ...(Array.isArray(agg) ? agg : [])].filter(Boolean);",
  },
];

// ============================================================================ 4. o Edit Fields
const EDIT_DE = "={{ [..." + VALIDA + ".slides.slice(1).map((slide, index) => ({ ...slide, pagina: index + 2, total: 6, capaFallback: " + VALIDA + ".capa })), { ...(" + VALIDA + ".cta || {}), tipo: 'cta', imagem: '', fonte_imagem: 'PROMOLISO', pagina: 6, total: 6, capaFallback: " + VALIDA + ".capa }] }}";

// `total` = quantas páginas o carrossel tem (slides do meio + capa + institucional) = slides+1.
// O CTA é sempre a última página, então pagina = total. Nada de `arr.length` do 3º argumento do
// map: quanto menos coisa nova o motor de expressão precisa suportar, menos incógnita — e incógnita
// em expressão foi exatamente o que derrubou 05/08 e 17/08.
const TOTAL = VALIDA + '.slides.length + 1';
const EDIT_PARA = "={{ [..." + VALIDA + ".slides.slice(1).map((slide, index) => ({ ...slide, pagina: index + 2, total: " + TOTAL + ", capaFallback: " + VALIDA + ".capa })), { ...(" + VALIDA + ".cta || {}), tipo: 'cta', imagem: '', fonte_imagem: 'PROMOLISO', pagina: " + TOTAL + ", total: " + TOTAL + ", capaFallback: " + VALIDA + ".capa }] }}";

// ============================================================================ 5. o prompt
const PROMPT_TROCAS = [
  {
    nome: 'estrutura dos slides',
    de: "## Estrutura: exatamente cinco slides\n"
      + "1. capa: gancho principal.\n"
      + "2. contexto: o que aconteceu.\n"
      + "3. evidencia: data, número, recurso ou fato confirmado.\n"
      + "4. impacto: por que isso importa.\n"
      + "5. acao: recomendação ou próximo passo.\n"
      + "\n"
      + "A sexta página institucional é criada automaticamente. Não escreva essa página.",
    para: `## Estrutura: de ${MIN_SLIDES} a ${MAX_SLIDES} slides — VOCÊ escolhe quantos\n`
      + "\n"
      + "O primeiro slide é sempre `capa` (o gancho) e o último é sempre `acao` (a recomendação ou o\n"
      + "próximo passo). Entre eles vão de 1 a " + (MAX_SLIDES - 2) + " slides, cada um de um destes tipos:\n"
      + "\n"
      + "- contexto: o que aconteceu.\n"
      + "- evidencia: data, número, recurso ou fato confirmado.\n"
      + "- impacto: por que isso importa.\n"
      + "\n"
      + "Escolha a ordem pela história, não pela lista. Pode repetir um tipo (duas evidências, por\n"
      + "exemplo) quando a matéria pedir.\n"
      + "\n"
      + "QUANTOS: use o número que a matéria SUSTENTA com fato próprio, e nada além. Notícia de uma\n"
      + `linha só — uma data confirmada, um preço — vira ${MIN_SLIDES} slides. Assunto com histórico,\n`
      + `números e consequência aguenta ${MAX_SLIDES}. Encher o carrossel para chegar a um número é o\n`
      + "erro pior: slide sem fato próprio repete o anterior, e slide repetido faz o leitor sair.\n"
      + "Preferir menos é sempre permitido.\n"
      + "\n"
      + "A última página, institucional, é criada automaticamente. Não escreva essa página.",
  },
  {
    nome: 'imagens: menos que slides',
    de: "Se houver menos de cinco, reutilize as disponíveis.",
    para: "Se houver menos imagens que slides, reutilize as disponíveis.",
  },
  {
    nome: 'quando parar de pesquisar',
    de: "- Pare de pesquisar assim que tiver fato, fonte e números suficientes para os cinco slides.",
    para: "- Pare de pesquisar assim que tiver fato, fonte e números suficientes para os slides que a\n"
      + "  matéria sustenta. Se o material só dá para " + MIN_SLIDES + ", escreva " + MIN_SLIDES + " e pronto — não pesquise mais para\n"
      + "  encher o carrossel.",
  },
  {
    nome: 'reuso de imagem na nota final',
    de: "Se houver menos de cinco imagens, reutilize as imagens oficiais disponíveis em vez de reprovar a pauta ou inventar URLs.",
    para: "Se houver menos imagens oficiais que slides, reutilize as disponíveis em vez de reprovar a pauta ou inventar URLs.",
  },
];

const lf = (s) => String(s).split('\r\n').join('\n');

function trocar(texto, trocas, quem, marcaDeJaFeito) {
  let saida = lf(texto);
  if (marcaDeJaFeito && saida.includes(marcaDeJaFeito)) {
    throw new Error(`${quem}: já tem "${marcaDeJaFeito}" — patch já aplicado?`);
  }
  for (const t of trocas) {
    const vezes = saida.split(t.de).length - 1;
    if (vezes !== 1) throw new Error(`${quem}: âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.de).join(t.para);
  }
  return saida;
}
function destrocar(texto, trocas, quem) {
  let saida = lf(texto);
  for (const t of trocas) {
    const vezes = saida.split(t.para).length - 1;
    if (vezes !== 1) throw new Error(`${quem}: âncora invertida "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.para).join(t.de);
  }
  return saida;
}

const trocarValidador = (c) => { const s = trocar(c, VALIDADOR_TROCAS, NO_VALIDADOR, 'MAX_SLIDES'); new Function(s); return s; };
const trocarCapa = (c) => { const s = trocar(c, CAPA_TROCAS, NO_CAPA, 'fora de '); new Function(s); return s; };
const trocarRow = (c) => { const s = trocar(c, ROW_TROCAS, NO_ROW, '...(Array.isArray(agg)'); new Function(s); return s; };
const trocarPrompt = (t) => trocar(t, PROMPT_TROCAS, NO_AGENTE, 'VOCÊ escolhe quantos');
function trocarEdit(valor) {
  if (lf(valor) === lf(EDIT_PARA)) throw new Error(`${NO_EDIT}: já é a forma nova — patch já aplicado?`);
  if (lf(valor) !== lf(EDIT_DE)) throw new Error(`${NO_EDIT}: a expressão em produção não é a que este patch conhece — alguém mexeu; revisar antes`);
  return EDIT_PARA;
}

const voltarValidador = (c) => { const s = destrocar(c, VALIDADOR_TROCAS, NO_VALIDADOR); new Function(s); return s; };
const voltarCapa = (c) => { const s = destrocar(c, CAPA_TROCAS, NO_CAPA); new Function(s); return s; };
const voltarRow = (c) => { const s = destrocar(c, ROW_TROCAS, NO_ROW); new Function(s); return s; };
const voltarPrompt = (t) => destrocar(t, PROMPT_TROCAS, NO_AGENTE);
function voltarEdit(valor) {
  if (lf(valor) !== lf(EDIT_PARA)) throw new Error(`${NO_EDIT}: não está na forma nova — nada a reverter`);
  return EDIT_DE;
}

module.exports = {
  WF, NO_VALIDADOR, NO_CAPA, NO_EDIT, NO_ROW, NO_AGENTE,
  MIN_SLIDES, MAX_SLIDES, MIN_IMAGENS, MAX_IMAGENS,
  VALIDADOR_TROCAS, CAPA_TROCAS, ROW_TROCAS, PROMPT_TROCAS, EDIT_DE, EDIT_PARA,
  trocarValidador, trocarCapa, trocarRow, trocarPrompt, trocarEdit,
  voltarValidador, voltarCapa, voltarRow, voltarPrompt, voltarEdit, lf,
};

if (require.main !== module) return;

const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --dry');
  process.exit(1);
}
const sqlite3 = require('sqlite3');
const DRY = process.argv.includes('--dry');
const REVERTER = process.argv.includes('--reverter');
const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function agora() {
  const d = new Date(); const p = (n, l) => String(n).padStart(l || 2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
    + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const achar = (nome) => {
    const n = nodes.find((x) => x.name === nome);
    if (!n) throw new Error('nó não achado: ' + nome);
    return n;
  };
  const val = achar(NO_VALIDADOR);
  const capa = achar(NO_CAPA);
  const rowNo = achar(NO_ROW);
  const edit = achar(NO_EDIT);
  const ag = achar(NO_AGENTE);
  const campoEdit = edit.parameters.assignments.assignments.find((a) => a.name === 'slides');
  if (!campoEdit) throw new Error(`${NO_EDIT}: campo "slides" não achado`);

  if (REVERTER) {
    val.parameters.jsCode = voltarValidador(val.parameters.jsCode);
    capa.parameters.jsCode = voltarCapa(capa.parameters.jsCode);
    rowNo.parameters.jsCode = voltarRow(rowNo.parameters.jsCode);
    campoEdit.value = voltarEdit(campoEdit.value);
    ag.parameters.options.systemMessage = voltarPrompt(ag.parameters.options.systemMessage);
    console.log('OK  revertido: os cinco nós voltaram a exigir 5 slides');
  } else {
    val.parameters.jsCode = trocarValidador(val.parameters.jsCode);
    console.log(`OK  ${NO_VALIDADOR}  (faixa ${MIN_SLIDES}..${MAX_SLIDES}, tipos por posição, imagens = slides + 1)`);
    capa.parameters.jsCode = trocarCapa(capa.parameters.jsCode);
    console.log(`OK  ${NO_CAPA}  (guarda na mesma faixa)`);
    rowNo.parameters.jsCode = trocarRow(rowNo.parameters.jsCode);
    console.log(`OK  ${NO_ROW}  (não trunca mais em 6 imagens)`);
    campoEdit.value = trocarEdit(campoEdit.value);
    console.log(`OK  ${NO_EDIT}  (total e página do CTA dinâmicos)`);
    ag.parameters.options.systemMessage = trocarPrompt(ag.parameters.options.systemMessage);
    console.log(`OK  ${NO_AGENTE}  (o agente escolhe de ${MIN_SLIDES} a ${MAX_SLIDES} slides)`);
  }

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte o carrossel variavel no produtor (volta pra 5 slides fixos)'
    : `Produtor gera de ${MIN_SLIDES} a ${MAX_SLIDES} slides: carrossel de quantidade variavel`;
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-carrossel-produtor.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
