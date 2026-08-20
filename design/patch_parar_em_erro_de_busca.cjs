// O REDATOR PARA DE BUSCAR QUANDO A FERRAMENTA ESTÁ QUEBRADA.
//
// O QUE FOI MEDIDO EM 20/08. A cota do Tavily estourou em 18/08 23:00 e desde então TODA busca
// devolve erro. O agente não percebe que a ferramenta morreu: ele reformula a consulta e tenta de
// novo. Na execução 364 foram 17 buscas, todas com erro, todas a mesma pergunta reescrita:
//
//   #1  PS Plus setembro 2026 jogos saindo lista PlayStation Blog
//   #3  PlayStation Plus games leaving September 2026
//   #4  PlayStation Plus games leaving September 2026     (só mudou Start_Date)
//   #9  PS Plus setembro 2026
//   #15 PS Plus setembro 2026                             (de novo)
//   #17 PS Plus games leaving
//
// Custo: cada chamada reenvia a linha de base de ~15.800 tokens. 19 chamadas = 337 mil tokens de
// entrada numa peça. Rodada sadia custa $0,264; rodada nesse estado custa $0,427 — e a execução
// termina `success`, então nada alerta.
//
// A REGRA QUE FALTAVA, E POR QUE AS QUE EXISTEM NÃO PEGAM.
// O prompt já diz "no máximo dez passos de ferramenta por tentativa". É conselho: nada conta os
// passos. O nó Agent tem a opção `Max Iterations` com default 10, e no typeVersion 3 ela é CÓDIGO
// MORTO — `checkMaxIterations` está definido e exportado no pacote e não é chamado em lugar nenhum
// (no V2 o valor ia para o executor do LangChain, que cobrava). E a regra de saída honesta ("se o
// orçamento estiver acabando...") nunca dispara porque o agente não recebe a contagem.
//
// Esta regra é diferente das três: ela se ancora em algo que o agente REALMENTE VÊ — o campo `error`
// no resultado da ferramenta. E diz a coisa que ele errou 17 vezes: reformular não conserta
// ferramenta quebrada.
//
// ⚠️ O TEXTO QUE O AGENTE VÊ NÃO É O DA COTA. O erro de cota ("This request exceeds your plan's set
// usage limit") fica no metadado do nó, não no resultado devolvido ao modelo. Para o modelo chega
// `{"error": "Your request is invalid or could not be processed by the service"}`. Por isso a regra
// se ancora na PRESENÇA do campo `error`, e não na palavra "cota" ou "limit" — ancorar no texto da
// cota faria a regra nunca disparar.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'AI Agent';

// Quantas tentativas de busca valem a pena depois do primeiro erro. Uma: erro pode ser transitório,
// então uma segunda consulta diferente é razoável. Duas seguidas com erro é ferramenta fora do ar.
const TENTATIVAS_APOS_ERRO = 1;

const ANCORA = '- Você tem no máximo dez passos de ferramenta por tentativa, e a resposta final consome um deles.';

const REGRA = '\n'
  + '- SE A BUSCA DEVOLVER ERRO, A FERRAMENTA ESTÁ FORA DO AR — NÃO REFORMULE. Quando o resultado da\n'
  + '  busca vier com um campo `error` (por exemplo "Your request is invalid or could not be processed\n'
  + '  by the service"), o problema não é a sua consulta: é a ferramenta. Reformular a pergunta NÃO\n'
  + '  conserta ferramenta quebrada — só queima o orçamento. Faça no máximo '
  + (TENTATIVAS_APOS_ERRO === 1 ? 'UMA' : String(TENTATIVAS_APOS_ERRO)) + ' nova tentativa, com\n'
  + '  consulta claramente diferente. Se ela também vier com `error`, PARE DE BUSCAR e vá direto para\n'
  + '  a saída honesta: escreva o JSON com o que os candidatos recebidos já confirmam, ou devolva o\n'
  + '  JSON com aprovado_para_publicar false e o motivo "ferramenta de busca indisponível".\n'
  + '  Medido em 19-20/08: 17 buscas seguidas com erro na mesma pauta, todas a mesma pergunta\n'
  + '  reescrita. Nenhuma delas trouxe informação; as 17 foram cobradas.';

const TROCAS = [
  { nome: 'regra de parar em erro de busca', de: ANCORA, para: ANCORA + REGRA },
];

const lf = (s) => String(s).split('\r\n').join('\n');
const MARCA = 'A FERRAMENTA ESTÁ FORA DO AR';

function trocar(texto) {
  let saida = lf(texto);
  if (saida.includes(MARCA)) throw new Error(`${NO}: prompt já tem a regra — patch já aplicado?`);
  for (const t of TROCAS) {
    const vezes = saida.split(t.de).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.de).join(t.para);
  }
  return saida;
}

function destrocar(texto) {
  let saida = lf(texto);
  if (!saida.includes(MARCA)) throw new Error(`${NO}: prompt não tem a regra — nada a reverter`);
  for (const t of TROCAS) {
    const vezes = saida.split(t.para).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora invertida "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.para).join(t.de);
  }
  return saida;
}

module.exports = { WF, NO, ANCORA, REGRA, TROCAS, MARCA, trocar, destrocar, lf, TENTATIVAS_APOS_ERRO };

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
  const no = nodes.find((x) => x.name === NO);
  if (!no) throw new Error('nó não achado: ' + NO);
  const antes = no.parameters.options.systemMessage;
  if (typeof antes !== 'string') throw new Error(`${NO}: systemMessage não é string`);

  no.parameters.options.systemMessage = REVERTER ? destrocar(antes) : trocar(antes);
  const delta = no.parameters.options.systemMessage.length - lf(antes).length;
  console.log(`OK  ${NO}  (${REVERTER ? 'regra removida' : 'regra de parar em erro de busca'})`);
  console.log(`OK  prompt: ${lf(antes).length} -> ${no.parameters.options.systemMessage.length} bytes `
    + `(${delta > 0 ? '+' : ''}${delta}, ~${Math.round(delta / 4)} tokens por chamada)`);

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte a regra de parar quando a busca da erro'
    : 'Redator para de buscar quando a ferramenta devolve erro (era 17 tentativas)';
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-parar-erro-busca.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
