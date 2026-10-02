// O NÓ QUE MENTIA O NOME: "GPT 5.4 mini" VIRA "Modelo do Redator PromoLiso AI" (02/10/2026).
//
// O nó é `@n8n/n8n-nodes-langchain.lmChatAnthropic` com `claude-sonnet-5` — o modelo que escreve as
// legendas e os slides. O nome dizia OpenAI. Nome que mente já custou horas de diagnóstico neste
// projeto. O novo segue o padrão dos irmãos ("Modelo do Curador PromoLiso AI", "Modelo de
// Confiabilidade PromoLiso AI") e diz o PAPEL, não o modelo — trocar de modelo não volta a mentir.
// (O "GPT auxiliar de estruturacao" fica: ele é OpenAI gpt-5.4-mini de verdade.)
//
// QUEM LIA O NOME ANTIGO: só o analytics (`coletor-publicacoes.cjs`, modeloDoAgente), que já foi
// atualizado ANTES deste patch para reconhecer os dois nomes. Nenhum nó cita o nome.
//
// O QUE MUDA: o `name` do nó e as ligações que o citam (ele é sub-nó: ai_languageModel -> AI Agent).
// Nada mais: id, tipo, parâmetros, credencial e posição iguais. ROLLBACK: `--reverter`. --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const ANTIGO = 'GPT 5.4 mini';
const NOVO = 'Modelo do Redator PromoLiso AI';

function renomear(nodes, connections, de, para) {
  const no = nodes.find((n) => n.name === de);
  if (!no) throw new Error(`nó "${de}" não achado — patch já aplicado?`);
  if (nodes.some((n) => n.name === para)) throw new Error(`já existe nó "${para}"`);
  if (no.type && !/lmChatAnthropic/.test(no.type)) throw new Error(`"${de}" não é lmChatAnthropic (${no.type}) — abortando`);
  for (const n of nodes) {
    if (n === no) continue;
    if (JSON.stringify(n.parameters || {}).includes(de)) throw new Error(`"${n.name}" cita "${de}" pelo nome — renomear quebraria`);
  }
  const novosNos = nodes.map((n) => (n === no ? Object.assign({}, n, { name: para }) : n));
  const novasConexoes = {};
  for (const [orig, tipos] of Object.entries(connections)) {
    novasConexoes[orig === de ? para : orig] = JSON.parse(JSON.stringify(tipos, (k, v) => (k === 'node' && v === de ? para : v)));
  }
  return { nodes: novosNos, connections: novasConexoes };
}
const aplicar = (nodes, connections, reverter) => (reverter
  ? renomear(nodes, connections, NOVO, ANTIGO) : renomear(nodes, connections, ANTIGO, NOVO));

module.exports = { WF, ANTIGO, NOVO, renomear, aplicar };

if (require.main === module) {
  const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
  if (!fs.existsSync(DB)) {
    console.error('FAIL  rode no VPS: cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --dry');
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
    const r = aplicar(JSON.parse(row.nodes), JSON.parse(row.connections), REVERTER);
    const alvo = REVERTER ? ANTIGO : NOVO;
    const ligacoes = JSON.stringify(r.connections).split(`"${alvo}"`).length - 1;
    console.log(`OK  nó renomeado para "${alvo}" (${ligacoes} ligação(ões) com o nome novo)`);
    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
    const nodesStr = JSON.stringify(r.nodes);
    const connStr = JSON.stringify(r.connections);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER ? `Reverte: "${NOVO}" volta a se chamar "${ANTIGO}"` : `"${ANTIGO}" (claude-sonnet-5) vira "${NOVO}"`;
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, connStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, connStr, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }
    fs.writeFileSync(path.join(__dirname, '..', 'newversion-renomear-modelo.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
