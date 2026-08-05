// Troca o nó "GPT 5.4 mini" (lmChatOpenAi) -> Anthropic (lmChatAnthropic, claude-sonnet-5),
// mantendo nome/id/posição e a conexão ai_languageModel com o "AI Agent".
// AUTO-DESCOBRE a credencial anthropicApi (o usuário precisa criá-la no editor antes).
// --dry: só mostra o plano, não grava (na dry, se não achar cred, usa placeholder).
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const NODE = 'GPT 5.4 mini';
const MODEL = 'claude-sonnet-5';   // se o nó recusar, trocar p/ 'claude-sonnet-4-6' ou escolher no dropdown
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => e ? j(e) : r(x)));
const all = (q, p) => new Promise((r, j) => db.all(q, p || [], (e, x) => e ? j(e) : r(x)));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now(){const d=new Date();const p=(n,l=2)=>String(n).padStart(l,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;}

(async () => {
  const creds = await all("SELECT id,name FROM credentials_entity WHERE type='anthropicApi'");
  let cred = creds[0];
  if (!cred) {
    if (!DRY) throw new Error('Nenhuma credencial anthropicApi encontrada. Crie a credencial "Anthropic" no editor (Credentials -> Add -> Anthropic, cole a API key) e rode de novo.');
    cred = { id: '<CRIAR_CREDENCIAL_ANTHROPIC>', name: 'Anthropic account' };
    console.warn('AVISO(dry): credencial anthropicApi ainda não existe — usando placeholder.');
  }
  const row = await get("SELECT nodes, connections, versionCounter FROM workflow_entity WHERE id=?", [WF]);
  const nodes = JSON.parse(row.nodes);
  const n = nodes.find(x => x.name === NODE);
  if (!n) throw new Error('nó não encontrado: ' + NODE);
  if (n.type !== '@n8n/n8n-nodes-langchain.lmChatOpenAi') console.warn('AVISO: tipo atual inesperado: ' + n.type);

  n.type = '@n8n/n8n-nodes-langchain.lmChatAnthropic';
  n.typeVersion = 1.4;
  n.parameters = { model: { __rl: true, value: MODEL, mode: 'list', cachedResultName: MODEL }, options: {} };
  n.credentials = { anthropicApi: { id: cred.id, name: cred.name } };

  const nodesStr = JSON.stringify(nodes);
  console.log('nó "' + NODE + '" -> lmChatAnthropic | model=' + MODEL + ' | cred=' + JSON.stringify(n.credentials.anthropicApi));
  console.log('conexão ai_languageModel -> AI Agent: PRESERVADA (mesmo nome de nó)');

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const V = crypto.randomUUID(); const t = now();
  await run("BEGIN");
  try {
    await run("UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?",
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run("INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, 'PromoLiso - Conteúdo Instagram v7.2 - Curadoria Inteligente P1.0.4', 1, 'agente editorial: GPT 5.4 mini -> Claude ' + MODEL, '[]']);
    await run("COMMIT");
  } catch (e) { await run("ROLLBACK"); throw e; }
  fs.writeFileSync(path.join(__dirname, '..', 'newversion-claude.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch(e => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
