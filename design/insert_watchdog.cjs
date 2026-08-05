// Monitor de erros — Parte B: watchdog de falha SILENCIOSA. Insere workflow novo.
// Agendado 13:00 e 21:30 BRT -> lê promoliso_curadoria_ai + promoliso_fila -> Code avalia:
//   (a) rate limit/quota da OpenAI nos registros recentes da curadoria, OU
//   (b) todos os registros recentes com pontuacao 0 (curador degradado), OU
//   (c) sem publicação há ~26h (fila).
// Se problema -> email (mesma cred SMTP). Saudável -> Code retorna [] -> email não roda.
// RODAR COM n8n PARADO (deploy-watchdog.ps1). --dry só valida sem inserir.
const sqlite3 = require('sqlite3');
const path = require('path');
const crypto = require('crypto');
const DB = process.env.CARROSSEL_DB || 'C:/Users/Magal/Documents/Codex/promoliso-n8n/data/.n8n/database.sqlite';
const PROJECT = 'UMEgamUOb3MlN67m';
const CUR_TBL = 'PLAiCur8cTx26M1Q';   // promoliso_curadoria_ai
const FILA_TBL = 'i2e8ZwnL9kwOV6OG';  // promoliso_fila
const MON = 'PRMLERR20260725A';
const ALERT = process.env.ALERT_EMAIL || '';
const FROM = ALERT, TO = ALERT;
const NAME = 'PromoLiso - Monitor de saude (watchdog)';
const DRY = process.argv.includes('--dry');
if (!DRY && !ALERT) { console.error('FAIL: defina a env ALERT_EMAIL'); process.exit(1); }

const fs = require('fs');
const uid = () => crypto.randomUUID();
const rlId = (v, name) => ({ __rl: true, value: v, mode: 'id', cachedResultName: name });

// código do Code node lido CRU de arquivo (sem escaping aninhado)
const avaliarCode = fs.readFileSync(path.join(__dirname, 'watchdog_avaliar.js'), 'utf8');

(async () => {
  const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
  const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => e ? j(e) : r(x)));
  const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
  function fmt(d) { const p = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`; }

  const cred = await get("SELECT id,name FROM credentials_entity WHERE type='smtp' LIMIT 1");
  if (!cred) throw new Error('sem credencial SMTP');
  console.log('cred SMTP:', cred.id, cred.name);

  const nSchedule = { id: uid(), name: 'Checagem de saude', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0],
    parameters: { rule: { interval: [ { field: 'cronExpression', expression: '0 0 13 * * *' }, { field: 'cronExpression', expression: '0 30 21 * * *' } ] } } };
  const nCur = { id: uid(), name: 'Ler curadoria', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [220, 0],
    parameters: { operation: 'get', dataTableId: rlId(CUR_TBL, 'promoliso_curadoria_ai'), limit: 500, orderBy: true } };
  const nColapsar = { id: uid(), name: 'Colapsar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 0],
    parameters: { mode: 'runOnceForAllItems', jsCode: 'return [{ json: {} }];' } };
  const nFila = { id: uid(), name: 'Ler fila', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [660, 0],
    parameters: { operation: 'get', dataTableId: rlId(FILA_TBL, 'promoliso_fila'), limit: 500, orderBy: true } };
  const nAvaliar = { id: uid(), name: 'Avaliar saude', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 0],
    parameters: { mode: 'runOnceForAllItems', jsCode: avaliarCode } };
  const nEmail = { id: uid(), name: 'Enviar alerta saude', type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [1100, 0],
    parameters: { fromEmail: FROM, toEmail: TO, subject: '={{ $json.assunto }}', emailFormat: 'text', text: '={{ $json.corpo }}', options: {} },
    credentials: { smtp: { id: cred.id, name: cred.name } } };

  const wf = {
    name: NAME,
    nodes: [nSchedule, nCur, nColapsar, nFila, nAvaliar, nEmail],
    connections: {
      'Checagem de saude': { main: [[{ node: 'Ler curadoria', type: 'main', index: 0 }]] },
      'Ler curadoria': { main: [[{ node: 'Colapsar', type: 'main', index: 0 }]] },
      'Colapsar': { main: [[{ node: 'Ler fila', type: 'main', index: 0 }]] },
      'Ler fila': { main: [[{ node: 'Avaliar saude', type: 'main', index: 0 }]] },
      'Avaliar saude': { main: [[{ node: 'Enviar alerta saude', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', errorWorkflow: MON },
  };

  const exists = await get('SELECT id FROM workflow_entity WHERE name=?', [NAME]);
  if (exists) { console.log('JÁ EXISTE:', NAME, 'id=' + exists.id, '— nada inserido'); db.close(); return; }

  console.log('workflow montado:', wf.nodes.length, 'nós | cron 13:00 + 21:30 BRT | errorWorkflow=PRMLERR');
  if (DRY) { console.log('\nDRY — nada inserido.'); db.close(); return; }

  const WFID = Array.from(crypto.randomBytes(12)).map(b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('').slice(0, 16);
  const VER = uid(); const now = fmt(new Date());
  await run('BEGIN');
  try {
    await run(`INSERT INTO workflow_entity (id,name,active,nodes,connections,settings,staticData,pinData,versionId,triggerCount,meta,parentFolderId,createdAt,updatedAt,isArchived,versionCounter,description,activeVersionId,nodeGroups,sourceWorkflowId)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [WFID, NAME, 1, JSON.stringify(wf.nodes), JSON.stringify(wf.connections), JSON.stringify(wf.settings), null, null, VER, 1, null, null, now, now, 0, 1, null, VER, '[]', null]);
    await run('INSERT INTO shared_workflow (workflowId,projectId,role,createdAt,updatedAt) VALUES (?,?,?,?,?)', [WFID, PROJECT, 'workflow:owner', now, now]);
    await run(`INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [VER, WFID, 'Promo Liso', now, now, JSON.stringify(wf.nodes), JSON.stringify(wf.connections), NAME, 0, null, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }
  require('fs').writeFileSync(path.join(__dirname, '..', 'newversion-watchdog.txt'), WFID + ' ' + VER);
  console.log('\nOK inserido. workflowId =', WFID, '| versionId =', VER, '| active=1');
  db.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
