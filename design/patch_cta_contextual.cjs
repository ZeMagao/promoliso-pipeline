// PASSO 2 do plano editorial — CTA CONTEXTUAL. O slide 06 passa a renderizar os campos do slide.
//
// O QUE ESTÁ ERRADO HOJE. O `Edit Fields` injeta o 6º slide com `tipo:'cta'` e os campos
// selo/titulo/destaque/texto preenchidos ('FIQUE DE OLHO', 'NÃO PERCA A PRÓXIMA.',
// 'SIGA @PROMOLISO0.', 'Notícias, promoções e alertas...') — e o `buildCta()` **ignora os quatro**,
// renderizando literais próprios ('SÓ QUEM SEGUE VÊ 1º', 'Entre no grupo de OFERTAS',
// 'LINK NA BIO ↗'). O carrossel real da row 36 confirma quem vence: o literal. Metade do RF-07 é
// só reconectar dado que já chega no nó.
//
// DUAS METADES:
//
//   A) `buildCta()` (bloco novo em design/cta_contextual.src.js) lê os campos, caindo no texto de
//      hoje quando vierem vazios, escapa o corpo com esc() (hoje é interpolado cru) e corta cada
//      campo no limite MEDIDO (design/limites_cta.json).
//
//   B) `Edit Fields` para de mandar os quatro campos mortos e passa a espalhar `output.cta` — o
//      objeto que o agente vai gerar no passo 4. Enquanto o agente não gerar, `output.cta` é
//      undefined -> `|| {}` -> buildCta cai nos defaults -> **saída byte a byte idêntica à de
//      hoje**. É isso que design/test_cta_contextual.cjs prova, inclusive avaliando a expressão do
//      Edit Fields como o n8n avaliaria.
//
// FORA DE PROPÓSITO: o prompt do agente não é tocado. Sem isso o patch é inerte — muda a
// capacidade, não a arte. O `@promoliso0` também fica cravado: é identidade da conta, não texto
// editorial.
//
// DE CARONA, um pavio apagado: `tabPage('06', total)` era número cravado; vira `slide.pagina`
// (default 6). Hoje dá exatamente '06' e deixa de mentir quando a quantidade variar (passo 6).
//
// POR QUE sha256 em vez de literal do código antigo: o buildCta atual é template literal com ${}
// dentro; reescrever isso escapado aqui é convite a erro silencioso. O bloco é localizado por
// marcador e VERIFICADO por hash — se produção divergir, o patch para.
//
// DOIS nós carregam um buildCta byte a byte idêntico ("Code in JavaScript" é o que roda o slide;
// "Code in JavaScript1" tem a cópia morta). Os dois são trocados — deixar um pra trás é a armadilha
// de regra duplicada que já mordeu neste repo.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history, como no patch_capa_fullbleed.
//
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const ALVOS = ['Code in JavaScript', 'Code in JavaScript1'];

const INICIO = 'function buildCta(slide){';
const FIM_ANCORA = 'return [{ json: { html, slide } }];';

// sha256 do buildCta em produção hoje (idêntico nos dois nós exportados, 1304 chars).
const SHA_ANTIGO = '065ce8406a3d78ee2d406547d5ecf5d44540bb523f09cafb490eb9318a88c1b5';

// o cabeçalho de comentário do .src.js explica a escolha pra quem lê o repo; dentro do nó só
// atrapalha, então sai na hora de montar (mesma regra do patch_capa_fullbleed)
const semCabecalho = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n|\n)*/, '')
  .trim();

const NOVO = semCabecalho('cta_contextual.src.js');

// Recorta o buildCta de dentro do jsCode do nó. Devolve null se não achar.
function recortarBuildCta(code) {
  const i = code.indexOf(INICIO);
  if (i < 0) return null;
  const ancora = code.indexOf(FIM_ANCORA, i);
  if (ancora < 0) return null;
  const j = code.indexOf('\n}', ancora);
  if (j < 0) return null;
  return { inicio: i, fim: j + 2, texto: code.slice(i, j + 2) };
}

function trocarRender(code, nomeNo, bloco) {
  bloco = bloco || NOVO;
  if (code.includes('function ctaCampo(')) throw new Error(`${nomeNo}: ctaCampo já existe — patch já aplicado?`);
  const vezes = code.split(INICIO).length - 1;
  if (vezes !== 1) throw new Error(`${nomeNo}: esperava 1 buildCta e achei ${vezes} — abortando`);

  const antigo = recortarBuildCta(code);
  if (!antigo) throw new Error(`${nomeNo}: não consegui delimitar o buildCta`);
  const sha = crypto.createHash('sha256').update(antigo.texto).digest('hex');
  if (sha !== SHA_ANTIGO) {
    throw new Error(`${nomeNo}: buildCta em produção não é o esperado (sha ${sha}) — alguém mexeu; revisar antes`);
  }

  const novo = code.slice(0, antigo.inicio) + bloco + code.slice(antigo.fim);

  // contrato de saída do nó não muda: quem consome espera { html, slide }
  if (!/return \[\{ json: \{ html, slide \} \}\];/.test(novo)) {
    throw new Error(`${nomeNo}: o retorno de buildCta mudou de forma — abortando`);
  }
  if ((novo.match(/function buildCta\(/g) || []).length !== 1) {
    throw new Error(`${nomeNo}: buildCta declarado != 1 vez`);
  }
  // as peças que o CTA novo usa têm que existir no arquivo, senão o slide nasce quebrado em runtime
  for (const dep of ['function esc(', 'function kickerChip(', 'function titleMetal(', 'function stripDestaque(', 'function tabPage(']) {
    if (!novo.includes(dep)) throw new Error(`${nomeNo}: dependência ausente: ${dep}`);
  }
  new Function(novo); // não grava código que nem parseia
  return novo;
}

// ---- metade B: o Edit Fields ----
// Regex e não literal porque o valor em produção tem acento, e encoding de quem edita não pode
// derrubar deploy. `[^}]` é seguro: o objeto do cta não tem chave aninhada.
const EF_DE = /\{ tipo: 'cta',[^}]*?imagem: ''/;
const EF_PARA = "{ ...($('Validar antes de publicar').item.json.output.cta || {}), tipo: 'cta', imagem: ''";

function trocarEditFields(valor) {
  if (valor.includes('output.cta ||')) throw new Error('Edit Fields: já espalha output.cta — patch já aplicado?');
  const achados = valor.match(new RegExp(EF_DE.source, 'g')) || [];
  if (achados.length !== 1) throw new Error(`Edit Fields: esperava 1 objeto de cta e achei ${achados.length} — abortando`);
  for (const chave of ['selo:', 'titulo:', 'destaque:', 'texto:']) {
    if (!achados[0].includes(chave)) throw new Error(`Edit Fields: o objeto de cta não tem ${chave} — revisar antes`);
  }
  const novo = valor.replace(EF_DE, EF_PARA);
  // o resto da expressão não pode ter sido tocado
  for (const marca of ['.slice(1).map(', 'capaFallback', "fonte_imagem: 'PROMOLISO'", 'total: 6']) {
    if (!novo.includes(marca)) throw new Error(`Edit Fields: perdi "${marca}" na troca — abortando`);
  }
  // o spread não pode vir depois de tipo/imagem/pagina/total, senão o agente sobrescreveria a
  // estrutura em vez de só o texto
  if (novo.indexOf('output.cta ||') > novo.indexOf("tipo: 'cta'")) {
    throw new Error('Edit Fields: spread de output.cta caiu depois de tipo — abortando');
  }
  return novo;
}

module.exports = { WF, ALVOS, NOVO, INICIO, SHA_ANTIGO, recortarBuildCta, trocarRender, trocarEditFields, EF_DE, EF_PARA };

// Nada de efeito colateral antes daqui: o harness importa este módulo e o sqlite3 é binário nativo
// que só existe no VPS.
if (require.main !== module) return;

const sqlite3 = require('sqlite3');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Esta máquina não é mais fonte de verdade (n8n do Windows aposentado em 05/08).'
    + '\n      Ver data/.n8n/LEIA-ANTES-DE-RODAR-PATCH.md.'
    + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node ' + path.posix.join('design', path.basename(__filename)) + ' --dry');
  process.exit(1);
}
const DRY = process.argv.includes('--dry');
const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) {
    throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  }
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);

  for (const nomeNo of ALVOS) {
    const n = nodes.find((x) => x.name === nomeNo);
    if (!n) throw new Error('nó não achado: ' + nomeNo);
    n.parameters.jsCode = trocarRender(n.parameters.jsCode, nomeNo);
    console.log(`OK  ${nomeNo}  (buildCta lê os campos do slide)`);
  }

  const ef = nodes.find((x) => x.name === 'Edit Fields');
  if (!ef) throw new Error('nó não achado: Edit Fields');
  const a = (ef.parameters?.assignments?.assignments || []).find((x) => x.name === 'slides');
  if (!a) throw new Error('Edit Fields: assignment "slides" não achado');
  a.value = trocarEditFields(a.value);
  console.log('OK  Edit Fields  (campos mortos saem, output.cta entra)');

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'CTA contextual: buildCta le selo/titulo/destaque/texto do slide (default = texto de hoje)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-cta-contextual.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
