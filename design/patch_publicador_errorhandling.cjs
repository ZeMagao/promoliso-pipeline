// Fix bug #1: publicador estranda row em PUBLISHING quando "Create a carousel post" ou
// "Publish a post" lançam (ex. IG code 1) — nunca vira FALHA, pauta perdida no silêncio.
// Correção:
//  1. "Preparar FALHA" passa a ler content_key de "Selecionar READY" (sempre roda),
//     não de "Preparar verificação" (que só roda DEPOIS do Create — some se o Create falha).
//  2. "Create a carousel post" e "Publish a post" -> onError=continueErrorOutput; saída de
//     erro (main[1]) ligada a "Preparar FALHA" -> Marcar FALHA (row vira FAILED, não zumbi).
//  3. + nó "Enviar alerta FALHA" (email) depois de "Marcar FALHA" -> falha de publish deixa
//     de ser silenciosa (email na hora, além da row visível + watchdog).
// Versiona o publicador. --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = process.env.CARROSSEL_DB || path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'E27F7yVdsZRj';
const ALERT = process.env.ALERT_EMAIL || '';
const FROM = ALERT, TO = ALERT;
const DRY = process.argv.includes('--dry');
if (!DRY && !ALERT) { console.error('FAIL: defina a env ALERT_EMAIL (email de alerta)'); process.exit(1); }

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => e ? j(e) : r(x)));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() { const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`; }

(async () => {
  const cred = await get("SELECT id,name FROM credentials_entity WHERE type='smtp' LIMIT 1");
  if (!cred) throw new Error('sem credencial SMTP');

  const row = await get('SELECT nodes,connections,versionCounter,name FROM workflow_entity WHERE id=?', [WF]);
  const nodes = JSON.parse(row.nodes);
  const conns = JSON.parse(row.connections);
  const byName = (n) => nodes.find(x => x.name === n);
  const report = [];

  // --- 1. Preparar FALHA lê de Selecionar READY ---
  const pf = byName('Preparar FALHA');
  if (!pf) throw new Error('nó "Preparar FALHA" não achado');
  const antes = pf.parameters.jsCode;
  pf.parameters.jsCode = "return [{ json: { content_key: $('Selecionar READY').item.json.content_key, status: 'FAILED' } }];";
  report.push('Preparar FALHA: content_key ' + (/Preparar verifica/.test(antes) ? 'Preparar verificação -> Selecionar READY' : '(já lia de outro; sobrescrito p/ Selecionar READY)'));

  // --- 2. onError + saída de erro nos 2 nós de publish ---
  for (const nm of ['Create a carousel post', 'Publish a post']) {
    const n = byName(nm);
    if (!n) throw new Error('nó não achado: ' + nm);
    n.onError = 'continueErrorOutput';
    // garantir main[0] preservado, main[1] = erro -> Preparar FALHA
    const cur = conns[nm] && conns[nm].main ? conns[nm].main : [[]];
    conns[nm] = { main: [cur[0] || [], [{ node: 'Preparar FALHA', type: 'main', index: 0 }]] };
    report.push(nm + ': onError=continueErrorOutput + erro -> Preparar FALHA');
  }

  // --- 3. nó de email na FALHA ---
  if (byName('Enviar alerta FALHA')) { report.push('Enviar alerta FALHA: já existe (pulado)'); }
  else {
    const mf = byName('Marcar FALHA');
    const pos = mf ? [mf.position[0] + 220, mf.position[1]] : [1400, 600];
    nodes.push({
      parameters: {
        fromEmail: FROM, toEmail: TO,
        subject: "=[PromoLiso] Falha ao publicar: {{ $('Selecionar READY').item.json.topic }}",
        emailFormat: 'text',
        text: "=A publicacao falhou e a pauta foi marcada FAILED na fila (nao ficou presa em PUBLISHING).\n\nPauta: {{ $('Selecionar READY').item.json.topic }}\ncontent_key: {{ $json.content_key }}\nQuando: {{ $now.setZone('America/Sao_Paulo').toFormat('dd/LL/yyyy HH:mm:ss') }}\n\nProvavel causa: token/IG/imagem. Conferir.",
        options: {},
      },
      type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: pos,
      id: crypto.randomUUID(), name: 'Enviar alerta FALHA',
      credentials: { smtp: { id: cred.id, name: cred.name } },
    });
    conns['Marcar FALHA'] = { main: [[{ node: 'Enviar alerta FALHA', type: 'main', index: 0 }]] };
    report.push('Enviar alerta FALHA: adicionado; Marcar FALHA -> email');
  }

  console.log(report.join('\n'));
  if (DRY) { console.log('\nDRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes), connStr = JSON.stringify(conns);
  const V = crypto.randomUUID(); const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, connStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, connStr, row.name, 1, 'fix: publicador nao estranda row (erro publish -> FAILED + email)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }
  fs.writeFileSync(path.join(__dirname, '..', 'newversion-pub-errorhandling.txt'), V);
  console.log('\nOK gravado. publicador versionId =', V);
  db.close();
})().catch(e => { console.error('FAIL', e.message); try { db.close(); } catch { } process.exit(1); });
