// Monitor de erros — Parte A (erros duros).
//  1. PRMLERR: + nó "Enviar alerta por email" (emailSend v2.1, cred SMTP) entre
//     "Registrar erro operacional" e "Resultado ERRO_REGISTRADO"; ativa (active=1); versiona.
//  2. Publicador (E27F7yVdsZRj): settings.errorWorkflow = PRMLERR (hoje não aponta).
// Assim erro DURO (status=error) em qualquer um dos 2 workflows -> loga na tabela + email.
// Falha SILENCIOSA (success sem post) é Parte B (watchdog agendado), à parte. --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = process.env.CARROSSEL_DB || path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const MON = 'PRMLERR20260725A';
const PUB = 'E27F7yVdsZRj';
const ALERT = process.env.ALERT_EMAIL || '';
const FROM = ALERT, TO = ALERT;
const DRY = process.argv.includes('--dry');
if (!DRY && !ALERT) { console.error('FAIL: defina a env ALERT_EMAIL'); process.exit(1); }

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => e ? j(e) : r(x)));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() { const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`; }

(async () => {
  // localizar cred SMTP
  const cred = await get("SELECT id,name FROM credentials_entity WHERE type='smtp' LIMIT 1");
  if (!cred) throw new Error('nenhuma credencial SMTP no n8n — crie antes (Credentials > Add > SMTP)');
  console.log('cred SMTP:', cred.id, '|', cred.name);

  // ---- 1. PRMLERR ----
  const mrow = await get('SELECT nodes,connections,versionCounter,name,active FROM workflow_entity WHERE id=?', [MON]);
  const nodes = JSON.parse(mrow.nodes);
  const conns = JSON.parse(mrow.connections);
  if (nodes.find(n => n.name === 'Enviar alerta por email')) { console.log('AVISO: nó de email já existe — nada a adicionar no PRMLERR'); }
  else {
    const resultNode = nodes.find(n => n.name === 'Resultado ERRO_REGISTRADO');
    const pos = resultNode ? [resultNode.position[0], resultNode.position[1] + 180] : [900, 500];
    const emailNode = {
      parameters: {
        fromEmail: FROM,
        toEmail: TO,
        subject: "=[PromoLiso ERRO] {{ $('Preparar erro operacional').item.json.topic }}",
        emailFormat: 'text',
        text: "=Falha operacional no PromoLiso.\n\nWorkflow: {{ $('Preparar erro operacional').item.json.topic }}\nExecucao: {{ $('Preparar erro operacional').item.json.execution_id }}\nQuando: {{ $now.setZone('America/Sao_Paulo').toFormat('dd/LL/yyyy HH:mm:ss') }}\n\nErro:\n{{ $('Preparar erro operacional').item.json.error_message }}",
        options: {},
      },
      type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1,
      position: pos,
      id: crypto.randomUUID(),
      name: 'Enviar alerta por email',
      credentials: { smtp: { id: cred.id, name: cred.name } },
    };
    nodes.push(emailNode);
    // rewire: Registrar -> Email -> Resultado (antes: Registrar -> Resultado)
    conns['Registrar erro operacional'] = { main: [[{ node: 'Enviar alerta por email', type: 'main', index: 0 }]] };
    conns['Enviar alerta por email'] = { main: [[{ node: 'Resultado ERRO_REGISTRADO', type: 'main', index: 0 }]] };
    console.log('PRMLERR: nó de email adicionado + rewire Registrar->Email->Resultado; active', mrow.active, '-> 1');
  }

  // ---- 2. Publicador errorWorkflow ----
  const prow = await get('SELECT name,settings FROM workflow_entity WHERE id=?', [PUB]);
  const pset = JSON.parse(prow.settings || '{}');
  const antesEW = pset.errorWorkflow || '(nenhum)';
  pset.errorWorkflow = MON;
  console.log('Publicador errorWorkflow:', antesEW, '->', MON);

  if (DRY) { console.log('\nDRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const connStr = JSON.stringify(conns);
  const V = crypto.randomUUID(); const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, activeVersionId=?, versionCounter=?, active=1, updatedAt=? WHERE id=?',
      [nodesStr, connStr, V, V, (mrow.versionCounter || 0) + 1, t, MON]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, MON, 'Promo Liso', t, t, nodesStr, connStr, mrow.name, 1, 'monitor: alerta por email + ativado', '[]']);
    await run('UPDATE workflow_entity SET settings=?, updatedAt=? WHERE id=?', [JSON.stringify(pset), t, PUB]);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }
  fs.writeFileSync(path.join(__dirname, '..', 'newversion-monitor.txt'), V);
  console.log('\nOK gravado. PRMLERR versionId =', V, '| active=1 | publicador.errorWorkflow=PRMLERR');
  db.close();
})().catch(e => { console.error('FAIL', e.message); try { db.close(); } catch { } process.exit(1); });
