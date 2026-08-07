// BUG #2 da lista de 2026-08-06: a fila nunca drena as pautas antigas.
//
// `Selecionar READY` do publicador ordenava por `score DESC` e `created_at DESC` — ou seja, sempre
// a MAIS NOVA. Enquanto a fila vivia vazia isso era inofensivo. Agora que há estoque, condena as
// antigas: entre um slot e o próximo o produtor (8 execuções/dia) quase sempre cria uma row mais
// nova, então a de ontem nunca chega a ser escolhida. Medido em 06/08 22:50:
//   row 12  26.8 h  READY   (de 05/08, nunca publicada)
//   row 13  14.8 h  READY
//   row 16   2.8 h  READY
//   row 17   0.8 h  READY   <- esta publicaria, e as outras seguiriam envelhecendo
//
// MUDANÇA: entre as rows ainda FRESCAS (<= FRESCOR_MAX_H), publica a que está mais PERTO DE VENCER.
// É "earliest deadline first": posta o que se perderia, e deixa esperando o que continua válido no
// próximo slot. Assim a fila drena em ordem e nada apodrece.
//
// SEGURANÇA — nunca perder slot: se NADA estiver fresco, cai no comportamento antigo (publica a
// mais nova). Pauta velha publicada é pior que pauta nova, mas é melhor que slot vazio, e essa
// decisão fica explícita em vez de emergente.
//
// `score` continua no desempate. Hoje é 0.0 em todas as rows, então não decide nada — mas se
// voltar a ter valor, o frescor tem precedência de propósito: é o que expira.
//
// NÃO INCLUÍDO neste patch: expirar/arquivar row que passa do frescor. Com o fallback acima ela
// ainda serve como último recurso, então não é lixo morto; e marcar status exigiria nó novo no
// publicador (cirurgia de workflow, que já quebrou este projeto antes) ou escrita externa no banco.
// Fica como passo separado.
//
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'E27F7yVdsZRj';
const NODE = 'Selecionar READY';
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// âncoras por string EXATA (o trecho é curto e denso de parênteses; regex aqui só adiciona risco)
const ALVO = `ready.sort((a,b)=> (Number(b.score||0)-Number(a.score||0)) || String(b.created_at||'').localeCompare(String(a.created_at||'')));
const r = ready[0];`;

const NOVO = `// Antes: score DESC + created_at DESC = sempre a MAIS NOVA. Com a fila tendo estoque isso
// condena as antigas — entre dois slots quase sempre nasce uma row mais nova, então a de ontem
// nunca era escolhida (06/08: row 12 parada desde 05/08 com 3 mais novas na frente).
// Agora: entre as FRESCAS, publica a que está mais perto de vencer (earliest deadline first).
// Posta o que se perderia e deixa esperando o que continua válido no próximo slot.
const FRESCOR_MAX_H = 48;
const idadeH = (row) => {
  const t = Date.parse(String(row.created_at || row.createdAt || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};
const porVencerPrimeiro = (a,b) =>
  (idadeH(b) - idadeH(a)) || (Number(b.score||0) - Number(a.score||0));
const maisNovaPrimeiro = (a,b) =>
  (Number(b.score||0)-Number(a.score||0)) || String(b.created_at||'').localeCompare(String(a.created_at||''));
const frescas = ready.filter((row) => idadeH(row) <= FRESCOR_MAX_H);
// Se nada está fresco, mantém o comportamento antigo. Pauta velha é pior que pauta nova, mas
// melhor que slot vazio — e assim esta mudança nunca reduz publicação.
const fila = frescas.length
  ? frescas.slice().sort(porVencerPrimeiro)
  : ready.slice().sort(maisNovaPrimeiro);
const r = fila[0];`;

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) {
    throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  }
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const n = nodes.find((x) => x.name === NODE);
  if (!n) throw new Error('nó não achado: ' + NODE);
  let code = n.parameters.jsCode;
  const antes = code;

  const vezes = code.split(ALVO).length - 1;
  if (vezes !== 1) throw new Error(`esperava 1 trecho e achei ${vezes} — abortando (já aplicado?)`);
  code = code.split(ALVO).join(NOVO);
  console.log('OK  ordenação trocada por frescor (earliest deadline first)');

  // o que tem que continuar existindo
  for (const p of ["status||'').toUpperCase()==='READY'", 'carousel_urls insuficiente', 'content_key', 'story_url', 'urls.slice(1,6)']) {
    if (!code.includes(p)) throw new Error('sumiu algo que deveria continuar: ' + p);
  }
  if (code.includes('ready[0]')) throw new Error('sobrou ready[0] — a troca não pegou');
  new Function(code);

  n.parameters.jsCode = code;
  console.log('diff de chars:', code.length - antes.length, '| mudou:', code !== antes);
  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
  if (code === antes) { console.log('nada a gravar.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'fila drena por frescor: publica a row mais perto de vencer em vez da mais nova (fallback pra mais nova se nada estiver fresco)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-fila.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
