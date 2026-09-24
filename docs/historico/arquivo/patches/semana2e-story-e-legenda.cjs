#!/usr/bin/env node
/*
 * semana2e-story-e-legenda.cjs — 2 fixes de qualidade do post (reportados na exec 87)
 *
 * 1) STORY PRETO: o render do story usava ${output.capa} CRU. Adrenaline (e outros)
 *    servem webp mesmo com extensão .jpg; o renderizador (:5680) não decodifica webp
 *    → fundo preto. O carrossel funciona porque passa a capa pelo Cloudinary
 *    (safeImage). FIX: envolve a capa no mesmo wrap Cloudinary (ternário puro, com
 *    bypass Mux) nos 2 nós de story: "Criar imagem do story" e "Fila: render story".
 *
 * 2) LEGENDA MAL FORMATADA: vinha tudo num parágrafo, com hashtags no meio. FIX: nó
 *    Code "Formatar legenda" (determinístico, try/catch) entre "Obter URL primeira
 *    imagem" e "Edit Fields" → hook / corpo / CTA em blocos + hashtags juntas no fim.
 *    Edit Fields passa a ler $json.legenda_formatada (com fallback pra crua).
 *
 * Lê os trechos de arquivos no scratchpad (evita escape). DEPLOY: edita DRAFT +
 * versionId + history → PUBLISH no editor. Ver [[deploy-draft-vs-published]].
 * Uso: node patches/semana2e-story-e-legenda.cjs [--dry] --frag <dir_scratchpad>
 */
'use strict';
const path = require('path');
const fs = require('fs');
const sqlite3 = require(path.join(process.cwd(), 'node_modules', 'sqlite3'));
const DRY = process.argv.includes('--dry');
const fi = process.argv.indexOf('--frag');
const FRAG = fi >= 0 ? process.argv[fi + 1] : null;
if (!FRAG) { console.error('faltou --frag <dir com capa_old.txt/capa_new.txt/fmt_legenda.js>'); process.exit(1); }
const DB = path.join(process.cwd(), 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const uuid = () => require('crypto').randomUUID();
const nowStr = () => new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
const rd = (f) => fs.readFileSync(path.join(FRAG, f), 'utf8').replace(/\r?\n$/, '');

const CAPA_OLD = rd('capa_old.txt');
const CAPA_NEW = rd('capa_new.txt');
const FMT_JS = fs.readFileSync(path.join(FRAG, 'fmt_legenda.js'), 'utf8');
const LEGENDA_EXPR = "={{ $json.legenda_formatada || $('Validar antes de publicar').item.json.output.legenda }}";

function open(ro) { return new sqlite3.Database(DB, ro ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE); }
const get = (db, sql, p = []) => new Promise((r, j) => db.get(sql, p, (e, x) => e ? j(e) : r(x)));
const run = (db, sql, p = []) => new Promise((r, j) => db.run(sql, p, function (e) { e ? j(e) : r(this); }));

(async () => {
  console.log(`\n=== semana2e ${DRY ? '(DRY)' : '(APLICANDO)'} ===\n`);
  const db = open(DRY);
  const wf = await get(db, 'SELECT versionId, name, nodes, connections, nodeGroups FROM workflow_entity WHERE id=?', [WF]);
  const nodes = JSON.parse(wf.nodes);
  const connections = JSON.parse(wf.connections);

  // ---- fix 1: story capa wrap ----
  for (const nm of ['Criar imagem do story', 'Fila: render story']) {
    const n = nodes.find((x) => x.name === nm);
    if (!n) { console.log(`  ERRO: nó ${nm} não existe`); process.exit(1); }
    const jb = n.parameters.jsonBody;
    if (jb.includes(CAPA_NEW)) { console.log(`  [skip] "${nm}" já tem capa wrap`); continue; }
    if (!jb.includes(CAPA_OLD)) { console.log(`  ERRO: "${nm}" não tem o trecho da capa esperado`); process.exit(1); }
    n.parameters.jsonBody = jb.replace(CAPA_OLD, CAPA_NEW);
    console.log(`  [ok] "${nm}" capa envolvida no Cloudinary`);
  }

  // ---- fix 2: formatar legenda ----
  const jaTem = nodes.some((x) => x.name === 'Formatar legenda');
  if (jaTem) {
    console.log('  [skip] "Formatar legenda" já existe');
  } else {
    const fmt = {
      id: uuid(), name: 'Formatar legenda', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [768, 240], onError: 'continueRegularOutput',
      parameters: { mode: 'runOnceForEachItem', jsCode: FMT_JS },
    };
    nodes.push(fmt);
    // rewire: Obter URL primeira imagem -> Formatar legenda -> Edit Fields
    const src = connections['Obter URL primeira imagem'];
    if (!src || !src.main[0] || src.main[0][0].node !== 'Edit Fields') {
      console.log('  ERRO: conexão Obter URL primeira imagem -> Edit Fields não encontrada'); process.exit(1);
    }
    src.main[0] = [{ node: 'Formatar legenda', type: 'main', index: 0 }];
    connections['Formatar legenda'] = { main: [[{ node: 'Edit Fields', type: 'main', index: 0 }]] };
    console.log('  [ok] "Formatar legenda" inserido entre Obter URL primeira imagem e Edit Fields');
  }
  // Edit Fields legenda -> lê legenda_formatada
  const ef = nodes.find((x) => x.name === 'Edit Fields');
  const asg = ef.parameters.assignments.assignments.find((a) => a.name === 'legenda');
  if (!asg) { console.log('  ERRO: assignment legenda não encontrado em Edit Fields'); process.exit(1); }
  if (asg.value === LEGENDA_EXPR) { console.log('  [skip] Edit Fields.legenda já aponta pro formatada'); }
  else { asg.value = LEGENDA_EXPR; console.log('  [ok] Edit Fields.legenda -> $json.legenda_formatada (fallback crua)'); }

  if (DRY) { console.log('\n(nada gravado)'); db.close(); return; }

  const newVer = uuid();
  const ts = nowStr();
  const nodesStr = JSON.stringify(nodes);
  const connStr = JSON.stringify(connections);
  await run(db, 'UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, updatedAt=? WHERE id=?',
    [nodesStr, connStr, newVer, ts, WF]);
  await run(db,
    'INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [newVer, WF, 'Promo Liso', ts, ts, nodesStr, connStr, wf.name, 1,
     'semana2e: story capa via Cloudinary (fim do story preto) + Formatar legenda (blocos+hashtags no fim)', wf.nodeGroups || '[]']);
  console.log(`\nGravado. Novo versionId=${newVer}. Total nós=${nodes.length}.`);
  console.log('PRÓXIMO: editor → refresh → Publish → Execute.');
  db.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
