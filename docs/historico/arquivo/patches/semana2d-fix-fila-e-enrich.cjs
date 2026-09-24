#!/usr/bin/env node
/*
 * semana2d-fix-fila-e-enrich.cjs — conserta 2 bugs achados na exec 87
 *
 * Bug 1: "Fila: montar row" (runOnceForEachItem) usava $('Aggregate').item etc. —
 *   pairing quebrado no ramo do story (lineage != carrossel) → "Invalid expression"
 *   → row da fila toda null. FIX: runOnceForAllItems + .first() (nós single-run),
 *   sem referenciar "Validar antes de publicar" (multi-run).
 * Bug 2: "Enriquecer: aplicar" mapeava por __idx, mas o nó HTTP DESCARTA campos de
 *   entrada (__idx vira undefined). FIX: zip por POSIÇÃO com $('Enriquecer: separar')
 *   .all() (ordem HTTP preservada 1:1). A extração de og:image já funciona (7/8 na
 *   exec 87: Intel/Xbox ESO/Adrenaline/FlowGames/GameVicio).
 * Também apaga a row null (id=1) da promoliso_fila.
 *
 * DEPLOY: edita o DRAFT + novo versionId + history row → PUBLICAR no editor.
 * Uso: node patches/semana2d-fix-fila-e-enrich.cjs [--dry]   (idempotente por conteúdo)
 */
'use strict';
const path = require('path');
const sqlite3 = require(path.join(process.cwd(), 'node_modules', 'sqlite3'));
const DRY = process.argv.includes('--dry');
const DB = path.join(process.cwd(), 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const FILA = 'i2e8ZwnL9kwOV6OG';
const uuid = () => require('crypto').randomUUID();
const nowStr = () => new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);

const MONTAR_JS = `
// runOnceForAllItems: usa .first() em nós single-run (sem depender de pairing do
// ramo do story). Story vem do upload (input atual). Nada de $('Validar...') (multi-run).
const prep = ($('Preparar registro pendente').first().json) || {};
const cover = (($('Obter URL primeira imagem').first().json) || {}).url || '';
const agg = (($('Aggregate').first().json) || {}).url || [];
const carousel = [cover, agg[0], agg[1], agg[2], agg[3], agg[4]].filter(Boolean);
const caption = (($('Edit Fields').first().json) || {}).legenda || '';
const storyUrl = (($input.first().json) || {}).secure_url || '';
const primary = String(prep.primary_url || '');
return [{
  json: {
    content_key: String(prep.content_key || ''),
    topic: String(prep.topic || ''),
    category: String(prep.category || ''),
    caption: String(caption),
    carousel_urls: JSON.stringify(carousel),
    story_url: String(storyUrl),
    primary_url: primary,
    sources: JSON.stringify(primary ? [{ url: primary }] : []),
    status: 'READY',
    created_at: new Date().toISOString(),
    published_at: '',
    execution_id: String($execution.id || ''),
    score: 0,
  },
}];
`.trim();

const APLICAR_JS = `
// zip por POSIÇÃO: o nó HTTP descarta __idx, mas preserva a ordem 1:1 dos itens.
// alvos vêm de $('Enriquecer: separar'); respostas de $input (mesma ordem).
let pool;
try { pool = JSON.parse(JSON.stringify($('Preparar candidatos').first().json.candidatos || [])); }
catch (e) { pool = null; }
if (!Array.isArray(pool)) {
  try { return [{ json: { candidatos: $('Preparar candidatos').first().json.candidatos || [] } }]; }
  catch (e2) { return [{ json: { candidatos: [] } }]; }
}
try {
  const ogRe = /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i;
  const twRe = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i;
  const temImg = (c) => c && c.imagem_principal && /^https:\\/\\//i.test(c.imagem_principal);
  const alvos = $('Enriquecer: separar').all().map((it) => (it && it.json) || {});
  const respostas = $input.all().map((it) => (it && it.json) || {});
  for (let k = 0; k < alvos.length; k++) {
    const idx = alvos[k].__idx;
    if (typeof idx !== 'number' || idx < 0) continue;
    const html = String((respostas[k] && respostas[k].data) || '');
    if (!html) continue;
    const m = html.match(ogRe) || html.match(twRe);
    const og = m ? String(m[1]).trim() : '';
    const cand = pool[idx];
    if (cand && og && /^https:\\/\\//i.test(og) && !temImg(cand)) {
      cand.imagem_principal = og;
      cand.imagens_oficiais =
        (Array.isArray(cand.imagens_oficiais) && cand.imagens_oficiais.length)
          ? cand.imagens_oficiais : [og];
      cand.capa_enriquecida = true;
    }
  }
} catch (e) { /* mantém pool */ }
return [{ json: { candidatos: pool } }];
`.trim();

const NEW_CODE = { 'Fila: montar row': MONTAR_JS, 'Enriquecer: aplicar': APLICAR_JS };

function open(ro) { return new sqlite3.Database(DB, ro ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE); }
const get = (db, sql, p = []) => new Promise((r, j) => db.get(sql, p, (e, x) => e ? j(e) : r(x)));
const run = (db, sql, p = []) => new Promise((r, j) => db.run(sql, p, function (e) { e ? j(e) : r(this); }));

(async () => {
  console.log(`\n=== semana2d ${DRY ? '(DRY)' : '(APLICANDO)'} ===\n`);
  const db = open(DRY);
  const wf = await get(db, 'SELECT versionId, name, nodes, connections, nodeGroups FROM workflow_entity WHERE id=?', [WF]);
  const nodes = JSON.parse(wf.nodes);

  let changed = 0;
  for (const [nm, code] of Object.entries(NEW_CODE)) {
    const n = nodes.find((x) => x.name === nm);
    if (!n) { console.log(`  ERRO: nó não encontrado: ${nm}`); process.exit(1); }
    if (n.parameters.jsCode === code) { console.log(`  [skip] "${nm}" já atualizado`); continue; }
    n.parameters.jsCode = code;
    // garante modo runOnceForAllItems (remove mode do montar row que era perItem)
    if (n.parameters.mode) delete n.parameters.mode;
    changed++;
    console.log(`  [ok] "${nm}" jsCode atualizado (mode=runOnceForAllItems)`);
  }

  if (DRY) { console.log(`\n${changed} nós a atualizar (nada gravado). Também apagaria fila row id=1.`); db.close(); return; }
  if (!changed) { console.log('\nNada a mudar.'); db.close(); return; }

  const newVer = uuid();
  const ts = nowStr();
  const nodesStr = JSON.stringify(nodes);
  await run(db, 'UPDATE workflow_entity SET nodes=?, versionId=?, updatedAt=? WHERE id=?', [nodesStr, newVer, ts, WF]);
  await run(db,
    'INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [newVer, WF, 'Promo Liso', ts, ts, nodesStr, wf.connections, wf.name, 1,
     'semana2d: fix montar row (.first, runOnceForAllItems) + aplicar (zip por posicao)', wf.nodeGroups || '[]']);
  // limpa a row null da fila
  const del = await run(db, `DELETE FROM data_table_user_${FILA} WHERE id=1 AND status IS NULL`);
  console.log(`\nGravado. Novo versionId=${newVer}. Rows null apagadas: ${del.changes}.`);
  console.log('PRÓXIMO: editor → refresh → Publish → Execute.');
  db.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
