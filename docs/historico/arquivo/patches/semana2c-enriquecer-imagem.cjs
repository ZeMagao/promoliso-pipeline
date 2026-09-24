#!/usr/bin/env node
/*
 * semana2c-enriquecer-imagem.cjs — subfluxo de enriquecimento de imagem (og:image)
 *
 * Insere entre "Preparar candidatos" e "Configuração PromoLiso AI" (estágio do
 * pool; nenhum nó referencia $('Preparar candidatos'), Configuração lê $json →
 * injeção no fluxo propaga sem bypass). Para candidatos SEM imagem (primárias
 * primeiro, teto 8), busca a og:image da página do artigo e seta imagem_principal.
 * Feeds oficiais (news.xbox.com, newsroom.intel.com, nvidia...) não trazem imagem;
 * a og:image da página é a fonte oficial limpa. Combina com semana2b (validador
 * aceita host oficial + Consolidar faz fallback imagens_oficiais=[imagem_principal]).
 *
 * Cadeia: Preparar candidatos -> Enriquecer: separar -> Enriquecer: buscar og ->
 *         Enriquecer: aplicar -> Configuração PromoLiso AI
 * Robusto: HTTP onError=continue; separar/aplicar com try/catch e sentinela;
 * se algo falhar, candidatos seguem sem imagem (= comportamento de hoje). Zero
 * regressão no fluxo.
 *
 * DEPLOY: edita o DRAFT + novo versionId + history row. Publicar pelo editor
 * depois. Ver [[deploy-draft-vs-published]].
 * Uso: node patches/semana2c-enriquecer-imagem.cjs [--dry]  (idempotente)
 */
'use strict';
const path = require('path');
const sqlite3 = require(path.join(process.cwd(), 'node_modules', 'sqlite3'));
const DRY = process.argv.includes('--dry');
const DB = path.join(process.cwd(), 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const uuid = () => require('crypto').randomUUID();
const nowStr = () => new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);

const SEPARAR_JS = `
const pool = ($json.candidatos) || [];
const temImg = (c) => c && c.imagem_principal && /^https:\\/\\//i.test(c.imagem_principal);
const semImg = pool.map((c, i) => ({ c, i })).filter(({ c }) => !temImg(c));
// primárias primeiro; teto de 8 fetches por execução
semImg.sort((a, b) =>
  ((b.c.tipo_fonte === 'primaria') ? 1 : 0) - ((a.c.tipo_fonte === 'primaria') ? 1 : 0));
const alvos = semImg.slice(0, 8);
if (!alvos.length) return [{ json: { __idx: -1, url: 'https://example.com/', __sentinela: true } }];
return alvos.map(({ c, i }) => ({ json: { __idx: i, url: String(c.url || c.link || '') } }));
`.trim();

const APLICAR_JS = `
let pool;
try { pool = JSON.parse(JSON.stringify($('Preparar candidatos').first().json.candidatos || [])); }
catch (e) { pool = null; }
if (!Array.isArray(pool)) {
  // fallback duro: não perder o pool — reemite o original
  try { return [{ json: { candidatos: $('Preparar candidatos').first().json.candidatos || [] } }]; }
  catch (e2) { return [{ json: { candidatos: [] } }]; }
}
try {
  const ogRe = /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i;
  const twRe = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i;
  const temImg = (c) => c && c.imagem_principal && /^https:\\/\\//i.test(c.imagem_principal);
  for (const it of $input.all()) {
    const j = (it && it.json) || {};
    if (typeof j.__idx !== 'number' || j.__idx < 0) continue;
    const html = String(j.data || j.body || '');
    if (!html) continue;
    const m = html.match(ogRe) || html.match(twRe);
    const og = m ? String(m[1]).trim() : '';
    const cand = pool[j.__idx];
    if (cand && og && /^https:\\/\\//i.test(og) && !temImg(cand)) {
      cand.imagem_principal = og;
      cand.imagens_oficiais =
        (Array.isArray(cand.imagens_oficiais) && cand.imagens_oficiais.length)
          ? cand.imagens_oficiais : [og];
      cand.capa_enriquecida = true;
    }
  }
} catch (e) { /* mantém pool como está */ }
return [{ json: { candidatos: pool } }];
`.trim();

function buildNodes() {
  const sep = {
    id: uuid(), name: 'Enriquecer: separar', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [-1780, 620], onError: 'continueRegularOutput',
    parameters: { jsCode: SEPARAR_JS },
  };
  const http = {
    id: uuid(), name: 'Enriquecer: buscar og', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.4, position: [-1720, 760], onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: '={{ $json.url }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      ] },
      options: {
        response: { response: { responseFormat: 'text' } },
        timeout: 15000,
      },
    },
  };
  const apl = {
    id: uuid(), name: 'Enriquecer: aplicar', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [-1660, 900], onError: 'continueRegularOutput',
    parameters: { jsCode: APLICAR_JS },
  };
  return { sep, http, apl };
}

function open(ro) { return new sqlite3.Database(DB, ro ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE); }
const get = (db, sql, p = []) => new Promise((r, j) => db.get(sql, p, (e, x) => e ? j(e) : r(x)));
const run = (db, sql, p = []) => new Promise((r, j) => db.run(sql, p, function (e) { e ? j(e) : r(this); }));

(async () => {
  console.log(`\n=== semana2c ${DRY ? '(DRY)' : '(APLICANDO)'} ===\n`);
  const db = open(DRY);
  const wf = await get(db, 'SELECT versionId, name, nodes, connections, nodeGroups FROM workflow_entity WHERE id=?', [WF]);
  const nodes = JSON.parse(wf.nodes);
  const connections = JSON.parse(wf.connections);

  if (nodes.some((n) => n.name === 'Enriquecer: aplicar')) {
    console.log('  [skip] subfluxo já existe.'); db.close(); return;
  }
  if (!nodes.some((n) => n.name === 'Preparar candidatos')) { console.log('  ERRO: "Preparar candidatos" não existe.'); process.exit(1); }

  const { sep, http, apl } = buildNodes();
  console.log('  Adiciona: Enriquecer: separar / buscar og / aplicar');
  console.log('  Rewire: Preparar candidatos -> separar -> buscar og -> aplicar -> Configuração PromoLiso AI');

  if (DRY) { console.log('\n(nada gravado)'); db.close(); return; }

  nodes.push(sep, http, apl);
  // Preparar candidatos: [Configuração] -> [Enriquecer: separar]
  const pc = connections['Preparar candidatos'];
  const alvoAtual = pc.main[0][0].node; // "Configuração PromoLiso AI"
  pc.main[0] = [{ node: sep.name, type: 'main', index: 0 }];
  connections[sep.name] = { main: [[{ node: http.name, type: 'main', index: 0 }]] };
  connections[http.name] = { main: [[{ node: apl.name, type: 'main', index: 0 }]] };
  connections[apl.name] = { main: [[{ node: alvoAtual, type: 'main', index: 0 }]] };

  const newVer = uuid();
  const ts = nowStr();
  const nodesStr = JSON.stringify(nodes);
  const connStr = JSON.stringify(connections);
  await run(db, 'UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, updatedAt=? WHERE id=?',
    [nodesStr, connStr, newVer, ts, WF]);
  await run(db,
    'INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [newVer, WF, 'Promo Liso', ts, ts, nodesStr, connStr, wf.name, 1,
     'semana2c: subfluxo enriquecer og:image no pool (primarias primeiro, teto 8)', wf.nodeGroups || '[]']);
  console.log(`\nGravado. Novo versionId=${newVer}. Total nós=${nodes.length}.`);
  console.log('PRÓXIMO: editor → refresh → Publish.');
  db.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
