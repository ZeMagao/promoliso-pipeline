// Peça que falhou volta para a fila em vez de morrer.
//
// Ver design/preparar_falha_retry.src.js e design/selecionar_ready_retry.src.js para o porquê de
// cada trava. Resumo: em 13/08 o Meta devolveu um 400 passageiro e a row 38 foi aposentada com
// conteúdo perfeito — a mesma chamada, refeita minutos depois, respondeu 200. Não se perdeu um
// slot, perdeu-se a pauta.
//
// COMO FUNCIONA: falhou e ainda está fresca -> volta como `RETRY`, e o próximo slot tenta de novo.
// Falhou vindo de `RETRY`, ou já está fora das 48 h -> `FAILED`, como antes. No máximo duas
// tentativas por peça.
//
// POR QUE O LIMITE DE DUAS. O "Selecionar READY" publica a peça mais perto de vencer primeiro; uma
// peça devolvida é sempre a mais velha, então seria escolhida de novo no slot seguinte. Sem teto,
// uma peça genuinamente quebrada entupiria TODOS os slots até envelhecer — trocaríamos "perde uma
// pauta" por "perde o dia".
//
// DOIS NÓS, e os dois têm que subir juntos: o "Preparar FALHA" decide olhando `status_anterior` e
// `created_at`, e quem passa esses dois campos adiante é o "Selecionar READY". Um sem o outro é
// `undefined` — e `undefined` cairia sempre em FAILED, ou seja, o patch pela metade não quebra
// nada mas também não faz nada.
//
// O nó "Marcar FALHA" não é tocado: ele já grava `{{ $json.status }}`, o valor que vier.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
//
// Versiona igual aos outros patches. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'E27F7yVdsZRj';
const ALVOS = {
  'Selecionar READY': { arquivo: 'selecionar_ready_retry.src.js', sha: 'e60b4390886b144ef3c511e7471b38e7a7a8250351265b1d04d74752f27e16aa' },
  'Preparar FALHA': { arquivo: 'preparar_falha_retry.src.js', sha: '990900fd5f25b02a5ef5b5c4aa72377c691a606168d68d95b0eac2588744ffa8' },
};

const semCabecalho = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .split('\r\n').join('\n')
  .replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n|\n)*/, '')
  .trim();

function trocar(code, nomeNo) {
  const alvo = ALVOS[nomeNo];
  if (!alvo) throw new Error('nó fora do patch: ' + nomeNo);
  if (code.includes('RETRY')) throw new Error(`${nomeNo}: já fala de RETRY — patch já aplicado?`);
  const sha = crypto.createHash('sha256').update(code.split('\r\n').join('\n')).digest('hex');
  if (sha !== alvo.sha) throw new Error(`${nomeNo}: código em produção não é o esperado (sha ${sha}) — alguém mexeu; revisar antes`);
  const novo = semCabecalho(alvo.arquivo);
  new Function(novo);
  return novo;
}

// Os dois arquivos carregam o mesmo 48 — número duplicado é o bug que já custou semanas neste
// projeto, então aqui ele é conferido, não confiado.
function conferirFrescor() {
  const nums = Object.values(ALVOS).map((a) => {
    const m = semCabecalho(a.arquivo).match(/FRESCOR_MAX_H = (\d+)/);
    return m ? Number(m[1]) : null;
  });
  if (nums.some((n) => n === null)) throw new Error('não achei FRESCOR_MAX_H nos dois arquivos');
  if (new Set(nums).size !== 1) throw new Error('FRESCOR_MAX_H divergente entre os dois nós: ' + nums.join(' vs '));
  return nums[0];
}

module.exports = { WF, ALVOS, trocar, conferirFrescor, semCabecalho };

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
  console.log('frescor conferido nos dois nós:', conferirFrescor(), 'h');
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  for (const nomeNo of Object.keys(ALVOS)) {
    const n = nodes.find((x) => x.name === nomeNo);
    if (!n) throw new Error('nó não achado: ' + nomeNo);
    n.parameters.jsCode = trocar(n.parameters.jsCode, nomeNo);
    console.log(`OK  ${nomeNo}`);
  }

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
       'peca que falha volta para a fila como RETRY (uma vez, e so se ainda estiver fresca)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-devolver-fila.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
