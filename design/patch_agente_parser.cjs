// Liga o output parser ao agente — e alinha o esquema dele com o contrato de hoje.
//
// O QUE ESTAVA ERRADO. O nó "Estruturar Saída" é um outputParserStructured, com esquema
// preenchido... e **não está ligado a nada**. O "AI Agent" está com `hasOutputParser: false`. Ou
// seja: existe um parser configurado no workflow que nunca foi conectado.
//
// POR QUE ISSO EXPLICA O BUG. Medido em 13/08: mesmo depois de subir `maxIterations` 6->10 e a
// regra P0.15 no prompt, o agente continuou terminando com "Agora vou montar os 5 slides" e
// "Vou escrever os 5 slides agora". Então o teto NÃO era a causa — eu errei o mecanismo ontem.
// Num agente desse tipo o laço só continua enquanto o modelo CHAMA ferramenta; quando ele devolve
// uma mensagem sem chamada, o n8n entende que aquela é a resposta final. O modelo encerra o turno
// com um plano e o fluxo aceita o plano como resposta. Não há falha, não há estouro de limite —
// por isso nem retry nem teto pegariam.
//
// Com o parser ligado, duas coisas mudam: o n8n passa a anexar as instruções de formato ao prompt
// (o que empurra o modelo a responder JSON em vez de plano), e uma saída que não obedece ao formato
// vira ERRO explícito em vez de texto passando adiante disfarçado de resposta.
//
// A ARMADILHA QUE ESTE PATCH EVITA. O esquema do parser é uma TERCEIRA cópia do contrato editorial,
// e está velho: não tem `tipo`, `validade` nem `desconto`, os campos que a forma EVENTO passou a
// usar ontem. Ligar o parser sem mexer nisso empurraria o modelo de volta para o formato antigo e
// desfaria o trabalho de ontem em silêncio — a mesma classe de bug que custou semanas em 05/08.
// Por isso o patch alinha o esquema no mesmo movimento, e o harness compara as duas cópias.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
//
// Versiona igual aos outros patches. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const AGENTE = 'AI Agent';
const PARSER = 'Estruturar Saída';

// mesmas trocas que o patch_oferta_evento fez no prompt — o esquema tem que dizer a mesma coisa
const TROCAS_ESQUEMA = [
  {
    nome: 'campo tipo',
    de: '"oferta": {\n    "produto": "",',
    para: '"oferta": {\n    "tipo": "produto ou evento",\n    "produto": "",',
  },
  {
    nome: 'campos validade e desconto',
    de: '"loja": "",\n    "preco_atual": "",',
    para: '"loja": "",\n    "validade": "",\n    "desconto": "",\n    "preco_atual": "",',
  },
];

function trocarEsquema(exemplo) {
  if (exemplo.includes('"validade"')) throw new Error(`${PARSER}: esquema já tem os campos de evento — patch já aplicado?`);
  let saida = exemplo;
  for (const t of TROCAS_ESQUEMA) {
    const vezes = saida.split(t.de).length - 1;
    if (vezes !== 1) throw new Error(`${PARSER}: âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.de).join(t.para);
  }
  JSON.parse(saida); // esquema que não parseia derruba o agente inteiro
  return saida;
}

// Liga o parser ao agente. Recebe nodes+connections já parseados para o harness poder rodar isto
// contra uma topologia sintética.
function aplicar(nodes, connections) {
  const ag = nodes.find((n) => n.name === AGENTE);
  if (!ag) throw new Error('nó não achado: ' + AGENTE);
  const p = nodes.find((n) => n.name === PARSER);
  if (!p) throw new Error('nó não achado: ' + PARSER);
  if (!String(p.type).includes('outputParserStructured')) {
    throw new Error(`${PARSER}: esperava um outputParserStructured e achei ${p.type}`);
  }
  if (ag.parameters.hasOutputParser === true) throw new Error(`${AGENTE}: já tem output parser — patch já aplicado?`);
  if (connections[PARSER]) throw new Error(`${PARSER}: já sai para algum lugar — revisar antes`);

  // o agente precisa continuar com o que já tinha
  for (const chave of ['promptType', 'text', 'options']) {
    if (!(chave in ag.parameters)) throw new Error(`${AGENTE}: perdi o parâmetro ${chave} — abortando`);
  }
  const modeloLigado = Object.values(connections).some((s) => (s.ai_languageModel || [])
    .some((g) => (g || []).some((c) => c.node === AGENTE)));
  if (!modeloLigado) throw new Error(`${AGENTE}: não achei o modelo ligado — topologia inesperada`);

  p.parameters.jsonSchemaExample = trocarEsquema(String(p.parameters.jsonSchemaExample || ''));
  ag.parameters.hasOutputParser = true;
  connections[PARSER] = { ai_outputParser: [[{ node: AGENTE, type: 'ai_outputParser', index: 0 }]] };

  // conferências finais
  const ligacoes = (connections[PARSER].ai_outputParser[0] || []).length;
  if (ligacoes !== 1) throw new Error('esperava 1 ligação do parser e ficou com ' + ligacoes);
  if (!connections[AGENTE]) throw new Error(`${AGENTE}: perdeu a saída principal — abortando`);
  return { nodes, connections };
}

module.exports = { WF, AGENTE, PARSER, TROCAS_ESQUEMA, trocarEsquema, aplicar };

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
  const connections = JSON.parse(row.connections);
  aplicar(nodes, connections);
  console.log(`OK  ${PARSER} -> ${AGENTE} (ai_outputParser) e esquema alinhado com a forma evento`);

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const conStr = JSON.stringify(connections);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, conStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, conStr, row.name, 1,
       'liga o output parser ao agente (existia desconectado) e alinha o esquema com a forma evento', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-agente-parser.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
