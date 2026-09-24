#!/usr/bin/env node
/*
 * semana2f-fonte-display.cjs — embute Barlow Condensed (display) nos slides
 *
 * O renderizador (:5680) não tem NENHUMA fonte display; o template pedia
 * 'Barlow Condensed' mas caía em Arial (títulos genéricos, quebrando feio).
 * Testado: @import do Google Fonts NÃO carrega (renderizador offline p/ fonte);
 * @font-face com data-URI base64 FUNCIONA. Este patch embute a fonte (de
 * assets/BarlowCondensed-ExtraBold.ttf) via @font-face nos 2 nós de render e troca
 * a font-family dos títulos, com pequeno tuning de tamanho/leading (refino pontual).
 *
 * Nós afetados: "Code in JavaScript" (slides de conteúdo + CTA) e
 * "Code in JavaScript1" (capa). DEPLOY: edita DRAFT + versionId + history → PUBLISH.
 * Uso: node patches/semana2f-fonte-display.cjs [--dry]   (idempotente)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const sqlite3 = require(path.join(process.cwd(), 'node_modules', 'sqlite3'));
const DRY = process.argv.includes('--dry');
const DB = path.join(process.cwd(), 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const FONT_TTF = path.join(process.cwd(), 'assets', 'BarlowCondensed-ExtraBold.ttf');
const uuid = () => require('crypto').randomUUID();
const nowStr = () => new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);

const B64 = fs.readFileSync(FONT_TTF).toString('base64');
const FACE = "<style>@font-face{font-family:PLDisplay;src:url(data:font/ttf;base64," + B64 +
  ") format('truetype');font-weight:100 900;}</style>";
const OLD_FF = "'Barlow Condensed',Impact,sans-serif";
const NEW_FF = "PLDisplay,'Barlow Condensed',Impact,sans-serif";
const MARK = 'font-family:PLDisplay';

function embed(js) {
  if (!js.includes('const html = `\n<div')) throw new Error('template html inesperado');
  js = js.replace('const html = `\n<div', 'const html = `\n' + FACE + '\n<div');
  js = js.split(OLD_FF).join(NEW_FF);
  return js;
}
function tuneContent(js) {
  js = js.replace('font-size:${tituloSize}px;line-height:.8;',
    'font-size:${tituloSize}px;line-height:.92;letter-spacing:-1px;');
  js = js.replace(
    "margin-top:10px;color:#9BFF25;font-family:" + NEW_FF + ";font-size:${destaqueSize}px;line-height:.8;",
    "margin-top:16px;color:#9BFF25;font-family:" + NEW_FF + ";font-size:${destaqueSize}px;line-height:.92;letter-spacing:-1px;");
  // CTA hero "GAMES./HARDWARE./OFERTAS." ganha a fonte display
  js = js.replace(
    'color:#fff;font-size:58px;line-height:.92;font-weight:900;letter-spacing:-2px;',
    'color:#fff;font-family:' + NEW_FF + ';font-size:64px;line-height:.9;font-weight:900;letter-spacing:-1px;');
  return js;
}

function open(ro) { return new sqlite3.Database(DB, ro ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE); }
const get = (db, sql, p = []) => new Promise((r, j) => db.get(sql, p, (e, x) => e ? j(e) : r(x)));
const run = (db, sql, p = []) => new Promise((r, j) => db.run(sql, p, function (e) { e ? j(e) : r(this); }));

(async () => {
  console.log(`\n=== semana2f ${DRY ? '(DRY)' : '(APLICANDO)'} === (font b64 ${B64.length} chars)\n`);
  const db = open(DRY);
  const wf = await get(db, 'SELECT versionId, name, nodes, connections, nodeGroups FROM workflow_entity WHERE id=?', [WF]);
  const nodes = JSON.parse(wf.nodes);

  let changed = 0;
  for (const [nm, isContent] of [['Code in JavaScript', true], ['Code in JavaScript1', false]]) {
    const n = nodes.find((x) => x.name === nm);
    if (!n) { console.log(`  ERRO: nó ${nm} não existe`); process.exit(1); }
    if (n.parameters.jsCode.includes(MARK)) { console.log(`  [skip] "${nm}" já tem a fonte`); continue; }
    let js = embed(n.parameters.jsCode);
    if (isContent) js = tuneContent(js);
    n.parameters.jsCode = js;
    changed++;
    console.log(`  [ok] "${nm}" fonte display embutida${isContent ? ' + tuning conteúdo/CTA' : ''}`);
  }

  if (DRY) { console.log(`\n${changed} nós a atualizar (nada gravado).`); db.close(); return; }
  if (!changed) { console.log('\nNada a mudar.'); db.close(); return; }

  const newVer = uuid();
  const ts = nowStr();
  const nodesStr = JSON.stringify(nodes);
  await run(db, 'UPDATE workflow_entity SET nodes=?, versionId=?, updatedAt=? WHERE id=?', [nodesStr, newVer, ts, WF]);
  await run(db,
    'INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [newVer, WF, 'Promo Liso', ts, ts, nodesStr, wf.connections, wf.name, 1,
     'semana2f: fonte display Barlow Condensed embutida (capa+slides+CTA) + tuning', wf.nodeGroups || '[]']);
  console.log(`\nGravado. Novo versionId=${newVer}. PRÓXIMO: editor → refresh → Publish.`);
  db.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
