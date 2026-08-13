// OFERTA ganha a forma EVENTO — "produto único" deixa de ser exigência.
//
// Ver design/oferta_evento.src.js para o porquê e o desenho. Resumo: medido em 40 execuções, pauta
// de promoção reprova 73% (média geral 48%), e o agente recusa dizendo que é "catálogo de
// descontos, sem um produto único". Ele estava certo em relação ao contrato — o contrato é que
// estava errado para o que a conta anuncia.
//
// DUAS METADES, e as duas TÊM que subir juntas. Esta é exatamente a armadilha que custou semanas em
// 05/08: prompt e validador desalinhados, um truncando num limite e o outro reprovando em outro.
//   A) validador: bloco de OFERTA aceita `tipo: "evento"` com loja, validade, disponibilidade,
//      desconto/cupom e URL de loja conhecida — e recusa promoção que já nasceu vencida.
//   B) prompt do agente: o JSON ganha `tipo`, `validade` e `desconto`, e as regras dizem quando
//      cada forma vale. Sem isto o agente continua achando que precisa de produto único.
//
// O harness (design/test_oferta_evento.cjs) cobra os dois lados: roda o validador REAL contra
// pautas de evento e de produto, e confere que o prompt cita os mesmos campos que o código exige.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
//
// Versiona igual aos outros patches. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO_VALIDADOR = 'Validar antes de publicar';
const NO_AGENTE = 'AI Agent';

const INICIO = 'let ofertaAuditada = null;';
const FIM_ANCORA = 'ofertaAuditada = {';
const SHA_ANTIGO = 'b9d99841fb57b0302fb6dde7bceff55c58603f63c1a9ec5ac56ffe1c8771dbb4';

const semCabecalho = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .split('\r\n').join('\n')
  .replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n|\n)*/, '')
  .trim();

const NOVO = semCabecalho('oferta_evento.src.js');

// ---- metade A: validador ----
function recortarBloco(code) {
  const i = code.indexOf(INICIO);
  if (i < 0) return null;
  const ancora = code.indexOf(FIM_ANCORA, i);
  if (ancora < 0) return null;
  const j = code.indexOf('\n}', ancora);
  if (j < 0) return null;
  return { inicio: i, fim: j + 2, texto: code.slice(i, j + 2) };
}

function trocarValidador(code) {
  if (code.includes('function fimDaPromocao(')) throw new Error(`${NO_VALIDADOR}: fimDaPromocao já existe — patch já aplicado?`);
  const vezes = code.split(INICIO).length - 1;
  if (vezes !== 1) throw new Error(`${NO_VALIDADOR}: esperava 1 bloco de oferta e achei ${vezes} — abortando`);
  const antigo = recortarBloco(code);
  if (!antigo) throw new Error(`${NO_VALIDADOR}: não consegui delimitar o bloco de oferta`);
  const sha = crypto.createHash('sha256').update(antigo.texto).digest('hex');
  if (sha !== SHA_ANTIGO) throw new Error(`${NO_VALIDADOR}: bloco de oferta em produção não é o esperado (sha ${sha}) — alguém mexeu; revisar antes`);

  const novo = code.slice(0, antigo.inicio) + NOVO + code.slice(antigo.fim);
  // as peças que o bloco novo usa têm que existir no arquivo
  for (const dep of ['function urlInfo(', 'function valorNumerico(', 'const dominiosLojas', 'function hostIn(']) {
    if (!novo.includes(dep)) throw new Error(`${NO_VALIDADOR}: dependência ausente: ${dep}`);
  }
  // a forma PRODUTO não pode ter perdido nenhuma regra de hoje
  for (const regra of ['Oferta sem todos os dados obrigatórios', 'Preço atual inválido',
    'Preço de referência menor que o preço atual', 'Oferta sem URL direta de uma loja conhecida',
    'Oferta marcada como indisponível']) {
    if (!novo.includes(regra)) throw new Error(`${NO_VALIDADOR}: a regra "${regra}" sumiu — abortando`);
  }
  new Function(novo);
  return novo;
}

// ---- metade B: prompt ----
const PROMPT_TROCAS = [
  {
    nome: 'campos do JSON',
    de: '  "oferta": {\n    "produto": "",\n    "variante": "",\n    "loja": "",',
    para: '  "oferta": {\n    "tipo": "produto ou evento",\n    "produto": "",\n    "variante": "",\n    "loja": "",\n    "validade": "",\n    "desconto": "",',
  },
  {
    nome: 'passo 5 do processo',
    de: '5. Para ofertas, confirme produto, variante, preço em reais, condição, loja, disponibilidade e URL direta na própria loja.',
    para: '5. Para ofertas de PRODUTO, confirme produto, variante, preço em reais, condição, loja, disponibilidade e URL direta na própria loja.\n'
      + '5b. Para ofertas de EVENTO (promoção sazonal de loja, cupom geral, "até X% off" em catálogo), confirme loja, validade, faixa de desconto ou cupom, disponibilidade e a URL da página da promoção na própria loja.',
  },
  {
    nome: 'barreira da URL de oferta',
    de: '- Em OFERTA, a URL precisa ser a página direta do produto em uma loja brasileira conhecida, com disponibilidade e condições atuais.',
    para: '- Em OFERTA de produto, a URL precisa ser a página direta do produto em uma loja brasileira conhecida, com disponibilidade e condições atuais.\n'
      + '- Em OFERTA de evento, a URL precisa ser a página da promoção na própria loja, e a validade precisa dizer até quando vale.',
  },
  {
    nome: 'regras das duas formas',
    de: '## Decisão editorial por categoria PromoLiso P0.11',
    para: '## Duas formas de OFERTA PromoLiso P0.14\n'
      + '- Use tipo "produto" quando a pauta for UM produto com preço: console, placa de vídeo, um jogo específico.\n'
      + '- Use tipo "evento" quando a pauta for uma promoção de catálogo: promoção sazonal de loja, cupom geral, "até X% off" em vários jogos. Catálogo de descontos É pauta válida; não recuse por não ter um produto único.\n'
      + '- Em tipo "evento" deixe produto, variante, preco_atual, preco_referencia e condicao_pagamento vazios, e preencha loja, validade, desconto (ou cupom), disponibilidade e url.\n'
      + '- validade precisa dizer até quando a promoção vale, com data sempre que a fonte informar ("até 26 de agosto", "até 26/08").\n'
      + '- Prefira eventos com pelo menos três dias restantes: a peça entra numa fila e pode ser publicada até 48 horas depois. Promoção que termina hoje ou amanhã não vale a vaga.\n'
      + '- No corpo dos slides, cite dois ou três exemplos concretos com preço. Evento sem exemplo vira propaganda vazia.\n'
      + '- Continua valendo recusar quando o evento for o MESMO já publicado no histórico recente.\n\n'
      + '## Decisão editorial por categoria PromoLiso P0.11',
  },
];

function trocarPrompt(texto) {
  if (texto.includes('P0.14')) throw new Error(`${NO_AGENTE}: prompt já tem as duas formas — patch já aplicado?`);
  let saida = texto;
  for (const t of PROMPT_TROCAS) {
    const vezes = saida.split(t.de).length - 1;
    if (vezes !== 1) throw new Error(`${NO_AGENTE}: âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.de).join(t.para);
  }
  return saida;
}

module.exports = { WF, NO_VALIDADOR, NO_AGENTE, NOVO, SHA_ANTIGO, recortarBloco, trocarValidador, trocarPrompt, PROMPT_TROCAS };

if (require.main !== module) return;

const sqlite3 = require('sqlite3');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
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
  if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);

  const val = nodes.find((x) => x.name === NO_VALIDADOR);
  if (!val) throw new Error('nó não achado: ' + NO_VALIDADOR);
  val.parameters.jsCode = trocarValidador(val.parameters.jsCode);
  console.log(`OK  ${NO_VALIDADOR}  (OFERTA aceita tipo evento; validade vira exigência)`);

  const ag = nodes.find((x) => x.name === NO_AGENTE);
  if (!ag) throw new Error('nó não achado: ' + NO_AGENTE);
  const antesPrompt = String(ag.parameters?.options?.systemMessage || '');
  if (!antesPrompt) throw new Error(`${NO_AGENTE}: systemMessage vazio`);
  ag.parameters.options.systemMessage = trocarPrompt(antesPrompt);
  console.log(`OK  ${NO_AGENTE}  (prompt descreve as duas formas)`);

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
       'OFERTA ganha a forma evento: produto unico deixa de ser exigencia, validade passa a ser', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-oferta-evento.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
