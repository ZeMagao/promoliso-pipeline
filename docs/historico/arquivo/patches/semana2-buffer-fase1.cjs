#!/usr/bin/env node
/*
 * semana2-buffer-fase1.cjs — Buffer/fila FASE 1 (aditiva, risco zero)
 *
 * O que faz:
 *   A. Cria a DataTable `promoliso_fila` (data_table + data_table_column +
 *      tabela fisica data_table_user_<id>), replicando o padrao exato das
 *      DataTables existentes do n8n.
 *   B. Adiciona um ramo NOVO no workflow, saindo de "Edit Fields" (roda 1x por
 *      pauta, ja tem capa + carrossel + legenda), PARALELO ao publish
 *      (Split Out fica intacto). O ramo: render do story -> upload Cloudinary
 *      -> montar row -> inserir em promoliso_fila (status READY).
 *      Todos os nos novos com onError=continueRegularOutput -> qualquer falha
 *      na fila NUNCA quebra a publicacao.
 *
 * Uso:
 *   node patches/semana2-buffer-fase1.cjs --dry   (mostra o plano, nao grava)
 *   node patches/semana2-buffer-fase1.cjs         (aplica; PARE o n8n antes)
 *
 * Idempotente: se a DataTable ou o no "Salvar na fila" ja existirem, pula.
 */
'use strict';
const path = require('path');
const sqlite3 = require(path.join(process.cwd(), 'node_modules', 'sqlite3'));

const DRY = process.argv.includes('--dry');
const DB_PATH = path.join(process.cwd(), 'data', '.n8n', 'database.sqlite');
const WF_ID = 'NL8eVLKErgnIXBQq';
const PROJECT_ID = 'UMEgamUOb3MlN67m';
const TABLE_NAME = 'promoliso_fila';

// ---- helpers de id (espelham o n8n) ----
const NANO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function nanoid(n = 16) {
  let s = '';
  for (let i = 0; i < n; i++) s += NANO[Math.floor(Math.random() * NANO.length)];
  return s;
}
const uuid = () => require('crypto').randomUUID();
const nowStr = () => new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);

// ---- colunas da fila ----
const COLS = [
  { name: 'content_key', type: 'string' },
  { name: 'topic', type: 'string' },
  { name: 'category', type: 'string' },
  { name: 'caption', type: 'string' },
  { name: 'carousel_urls', type: 'string' },
  { name: 'story_url', type: 'string' },
  { name: 'primary_url', type: 'string' },
  { name: 'sources', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'created_at', type: 'string' },
  { name: 'published_at', type: 'string' },
  { name: 'execution_id', type: 'string' },
  { name: 'score', type: 'number' },
];
const sqlType = (t) => (t === 'number' ? 'REAL' : 'TEXT');

// ---- promisify ----
function open(readonly) {
  const mode = readonly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE;
  return new sqlite3.Database(DB_PATH, mode);
}
const get = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));
const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));

// ---- schema do node dataTable (para "Salvar na fila") ----
function fileSchema() {
  return COLS.map((c) => ({
    id: c.name, displayName: c.name, required: false,
    defaultMatch: c.name === 'content_key', display: true,
    type: c.type, canBeUsedToMatch: true, removed: false,
  }));
}
function fileValueMap() {
  const v = {};
  for (const c of COLS) v[c.name] = `={{ $json.${c.name} }}`;
  return v;
}

// ---- codigo do node "Fila: montar row" (runOnceForEachItem) ----
const MONTAR_JS = `
const val = ($('Validar antes de publicar').item.json.output) || {};
const prep = ($('Preparar registro pendente').item.json) || {};
const cover = ($('Obter URL primeira imagem').item.json.url) || '';
const agg = ($('Aggregate').item.json.url) || [];
const carousel = [cover, agg[0], agg[1], agg[2], agg[3], agg[4]].filter(Boolean);
const caption = ($('Edit Fields').item.json.legenda) || '';
const storyUrl = ($json.secure_url) || '';
const fontes = Array.isArray(val.fontes) ? val.fontes : [];
const score = Number(val.pontuacao ?? val.pontuacao_total ?? val.score ?? prep.score ?? 0) || 0;

const item = $input.item;
item.json = {
  content_key: String(prep.content_key || ''),
  topic: String(prep.topic || val.tema || ''),
  category: String(prep.category || val.categoria || ''),
  caption: String(caption),
  carousel_urls: JSON.stringify(carousel),
  story_url: String(storyUrl),
  primary_url: String(prep.primary_url || ''),
  sources: JSON.stringify(fontes),
  status: 'READY',
  created_at: new Date().toISOString(),
  published_at: '',
  execution_id: String($execution.id || ''),
  score: score,
};
return item;
`.trim();

// params clonados do "Criar imagem do story" (render do story a partir da capa)
const STORY_RENDER_PARAMS = {
  method: 'POST',
  url: 'http://127.0.0.1:5680/render',
  sendBody: true,
  specifyBody: 'json',
  jsonBody:
    '={{ { html: `<div style="width:1080px;height:1920px;position:relative;display:flex;overflow:hidden;background:#111111;font-family:Arial,sans-serif;"><img src="${$(\'Validar antes de publicar\').item.json.output.capa}" width="1080" height="1920" style="position:absolute;width:1080px;height:1920px;object-fit:cover;" /><div style="width:100%;height:100%;position:absolute;display:flex;background:linear-gradient(180deg,rgba(0,0,0,.05) 45%,rgba(0,0,0,.78) 100%);"></div><div style="position:absolute;left:64px;right:64px;bottom:140px;display:flex;justify-content:center;padding:34px 44px;color:#ffffff;background:rgba(0,0,0,.84);border:4px solid #93ff16;border-radius:28px;font-size:64px;font-weight:800;line-height:1.15;text-align:center;">Novo post no feed!</div></div>`, width: 1080, height: 1920, quality: 90 } }}',
  options: { response: { response: { responseFormat: 'file' } }, timeout: 30000 },
};

function buildNodes() {
  const y = 720;
  const n1 = {
    id: uuid(), name: 'Fila: render story', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.4, position: [1120, y], onError: 'continueRegularOutput',
    parameters: STORY_RENDER_PARAMS,
  };
  const n2 = {
    id: uuid(), name: 'Fila: upload story', type: 'n8n-nodes-cloudinary.cloudinary',
    typeVersion: 1, position: [1344, y], onError: 'continueRegularOutput',
    parameters: { operation: 'uploadFile', additionalFieldsFile: {} },
    credentials: { cloudinaryApi: { id: 'FYo5D1OowTaR9y4m', name: 'Cloudinary account' } },
  };
  const n3 = {
    id: uuid(), name: 'Fila: montar row', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [1568, y], onError: 'continueRegularOutput',
    parameters: { mode: 'runOnceForEachItem', jsCode: MONTAR_JS },
  };
  return { n1, n2, n3 };
}

function buildSalvarNode(tableId) {
  return {
    id: uuid(), name: 'Salvar na fila', type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1, position: [1792, 720], onError: 'continueRegularOutput',
    parameters: {
      dataTableId: { __rl: true, value: tableId, mode: 'id', cachedResultName: TABLE_NAME },
      columns: {
        mappingMode: 'defineBelow',
        value: fileValueMap(),
        matchingColumns: [],
        schema: fileSchema(),
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: {},
    },
  };
}

async function main() {
  console.log(`\n=== semana2-buffer-fase1 ${DRY ? '(DRY RUN)' : '(APLICANDO)'} ===\n`);
  const db = open(DRY);

  // ---------- PART A: DataTable ----------
  let tableId;
  const existing = await get(db, 'SELECT id FROM data_table WHERE name=?', [TABLE_NAME]);
  if (existing) {
    tableId = existing.id;
    console.log(`[A] DataTable "${TABLE_NAME}" ja existe (id=${tableId}) -> pula criacao.`);
  } else {
    tableId = nanoid(16);
    console.log(`[A] Criar DataTable "${TABLE_NAME}" id=${tableId}, ${COLS.length} colunas.`);
    const physical = `data_table_user_${tableId}`;
    const colDefs = COLS.map((c) => `"${c.name}" ${sqlType(c.type)}`).join(', ');
    const createSql =
      `CREATE TABLE "${physical}" ("id" integer PRIMARY KEY NOT NULL, ` +
      `"createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')), ` +
      `"updatedAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')), ${colDefs})`;
    console.log(`    CREATE: ${createSql}`);
    console.log(`    colunas: ${COLS.map((c) => c.name + ':' + c.type).join(', ')}`);
    if (!DRY) {
      const ts = nowStr();
      await run(db, 'INSERT INTO data_table (id,name,projectId,createdAt,updatedAt) VALUES (?,?,?,?,?)',
        [tableId, TABLE_NAME, PROJECT_ID, ts, ts]);
      for (let i = 0; i < COLS.length; i++) {
        const c = COLS[i];
        await run(db,
          'INSERT INTO data_table_column (id,name,type,"index",dataTableId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',
          [nanoid(16), c.name, c.type, i, tableId, ts, ts]);
      }
      await run(db, createSql);
      console.log('    [A] gravado.');
    }
  }

  // ---------- PART B: workflow ----------
  const wf = await get(db, 'SELECT nodes, connections FROM workflow_entity WHERE id=?', [WF_ID]);
  const nodes = JSON.parse(wf.nodes);
  const connections = JSON.parse(wf.connections);

  if (nodes.some((n) => n.name === 'Salvar na fila')) {
    console.log('[B] No "Salvar na fila" ja existe -> pula modificacao do workflow.');
  } else if (!nodes.some((n) => n.name === 'Edit Fields')) {
    console.log('[B] ERRO: no "Edit Fields" nao encontrado. Abortando parte B.');
  } else {
    const { n1, n2, n3 } = buildNodes();
    const n4 = buildSalvarNode(tableId);
    console.log(`[B] Adicionar 4 nos: "${n1.name}", "${n2.name}", "${n3.name}", "${n4.name}".`);
    console.log('    Ramo: Edit Fields --(alem de Split Out)--> Fila: render story -> upload -> montar row -> Salvar na fila');
    console.log('    Todos com onError=continueRegularOutput (falha na fila nao quebra publish).');

    if (!DRY) {
      nodes.push(n1, n2, n3, n4);
      // Edit Fields ganha um segundo destino (mantem Split Out)
      const ef = connections['Edit Fields'] || { main: [[]] };
      ef.main = ef.main || [[]];
      ef.main[0] = ef.main[0] || [];
      if (!ef.main[0].some((t) => t.node === n1.name)) {
        ef.main[0].push({ node: n1.name, type: 'main', index: 0 });
      }
      connections['Edit Fields'] = ef;
      connections[n1.name] = { main: [[{ node: n2.name, type: 'main', index: 0 }]] };
      connections[n2.name] = { main: [[{ node: n3.name, type: 'main', index: 0 }]] };
      connections[n3.name] = { main: [[{ node: n4.name, type: 'main', index: 0 }]] };

      const newVer = uuid();
      await run(db, 'UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, updatedAt=? WHERE id=?',
        [JSON.stringify(nodes), JSON.stringify(connections), newVer, nowStr(), WF_ID]);
      console.log(`    [B] gravado. Novo versionId=${newVer}. Total nos=${nodes.length}.`);
    }
  }

  db.close();
  console.log(`\n=== fim ${DRY ? '(nada gravado)' : '(aplicado)'} ===\n`);
}

main().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
