#!/usr/bin/env node
/*
 * semana2g-story-capa-e-refinos.cjs
 *
 * 1) STORY = CAPA DO POST: usuário pediu que o story use a foto de capa do post.
 *    Reescreve o jsonBody de "Criar imagem do story" e "Fila: render story" p/ um
 *    layout que mostra a CAPA renderizada do post (via $('Obter URL primeira
 *    imagem').item.json.url — Cloudinary jpeg, carrega no renderizador) emoldurada,
 *    com header PromoLiso, tag "NOVO POST" e CTA "SAIU NO FEED / ARRASTE PRA VER".
 *    Fonte Barlow embutida. Some o problema do story preto (não usa mais capa webp crua).
 * 2) REFINOS pontuais no slide de conteúdo ("Code in JavaScript"): contraste dos
 *    labels cinza (#7f8996/#737d8a/#8d96a2 -> mais claros) + corpo com leading/cor
 *    um tico melhores.
 *
 * Lê assets/BarlowCondensed-ExtraBold.ttf + assets/story_template.html.
 * DEPLOY: edita DRAFT + versionId + history -> PUBLISH. Uso: [--dry]. Idempotente.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const sqlite3 = require(path.join(process.cwd(), 'node_modules', 'sqlite3'));
const DRY = process.argv.includes('--dry');
const DB = path.join(process.cwd(), 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const uuid = () => require('crypto').randomUUID();
const nowStr = () => new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);

const B64 = fs.readFileSync(path.join(process.cwd(), 'assets', 'BarlowCondensed-ExtraBold.ttf')).toString('base64');
const STORY_HTML = fs.readFileSync(path.join(process.cwd(), 'assets', 'story_template.html'), 'utf8').replace(/\r?\n$/, '');
const FACE = "<style>@font-face{font-family:PLDisplay;src:url(data:font/ttf;base64," + B64 +
  ") format('truetype');font-weight:100 900;}</style>";
// jsonBody como expressão n8n: mantém ${$('Obter URL primeira imagem')...} literal (concat single-quote)
const STORY_JSONBODY = "={{ { html: `" + FACE + STORY_HTML + "`, width: 1080, height: 1920, quality: 92 } }}";
const STORY_MARK = 'SAIU NO FEED';  // sentinela de idempotência (via texto? o template usa "Saiu no feed")
const STORY_MARK2 = "Obter URL primeira imagem').item.json.url";

function open(ro) { return new sqlite3.Database(DB, ro ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE); }
const get = (db, sql, p = []) => new Promise((r, j) => db.get(sql, p, (e, x) => e ? j(e) : r(x)));
const run = (db, sql, p = []) => new Promise((r, j) => db.run(sql, p, function (e) { e ? j(e) : r(this); }));

(async () => {
  console.log(`\n=== semana2g ${DRY ? '(DRY)' : '(APLICANDO)'} ===\n`);
  const db = open(DRY);
  const wf = await get(db, 'SELECT versionId, name, nodes, connections, nodeGroups FROM workflow_entity WHERE id=?', [WF]);
  const nodes = JSON.parse(wf.nodes);
  let changed = 0;

  // 1) story = capa
  for (const nm of ['Criar imagem do story', 'Fila: render story']) {
    const n = nodes.find((x) => x.name === nm);
    if (!n) { console.log(`  ERRO: nó ${nm} não existe`); process.exit(1); }
    if ((n.parameters.jsonBody || '').includes(STORY_MARK2)) { console.log(`  [skip] "${nm}" já usa a capa`); continue; }
    n.parameters.jsonBody = STORY_JSONBODY;
    changed++;
    console.log(`  [ok] "${nm}" story = capa do post`);
  }

  // 2) refinos no slide de conteúdo
  const cn = nodes.find((x) => x.name === 'Code in JavaScript');
  if (!cn) { console.log('  ERRO: "Code in JavaScript" não existe'); process.exit(1); }
  let js = cn.parameters.jsCode;
  if (js.includes('#aab4c1')) {
    console.log('  [skip] refinos de contraste já aplicados');
  } else {
    js = js.split('#7f8996').join('#aab4c1');
    js = js.split('#737d8a').join('#9aa4b2');
    js = js.split('#8d96a2').join('#aab4c1');
    js = js.replace('margin-top:28px;color:#d5dae2;font-size:38px;line-height:1.35;',
      'margin-top:30px;color:#e2e7ee;font-size:38px;line-height:1.4;');
    cn.parameters.jsCode = js;
    changed++;
    console.log('  [ok] refinos de contraste/espaçamento no slide de conteúdo');
  }

  if (DRY) { console.log(`\n${changed} mudanças (nada gravado). jsonBody story ${STORY_JSONBODY.length} chars.`); db.close(); return; }
  if (!changed) { console.log('\nNada a mudar.'); db.close(); return; }

  const newVer = uuid();
  const ts = nowStr();
  const nodesStr = JSON.stringify(nodes);
  await run(db, 'UPDATE workflow_entity SET nodes=?, versionId=?, updatedAt=? WHERE id=?', [nodesStr, newVer, ts, WF]);
  await run(db,
    'INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [newVer, WF, 'Promo Liso', ts, ts, nodesStr, wf.connections, wf.name, 1,
     'semana2g: story usa a capa do post (emoldurada) + refinos contraste no slide', wf.nodeGroups || '[]']);
  console.log(`\nGravado. Novo versionId=${newVer}. PRÓXIMO: editor → refresh → Publish.`);
  db.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
