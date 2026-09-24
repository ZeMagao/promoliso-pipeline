#!/usr/bin/env node
/*
 * semana2b-validador-e-score.cjs — edits de código (sem novos nós)
 *
 * Contexto: exec 86 CRASHOU no render porque o agente, sem imagem, fabricou a
 * capa = "https://www.xbox.com/en-US/games/gears-of-war-eday" (página HTML, não
 * imagem); o validador aprovou (host primário, URL sem extensão) e o render bateu
 * 404. Este patch:
 *   1. Validador V1: só aceita imagem que PARECE imagem (extensão jpg/png/webp/gif/
 *      avif) OU vem de host de imagem conhecido (mux/cloudinary/thesourcemediaassets).
 *      Barra capa fabricada tipo /games/... → reprova limpo em vez de crashar.
 *   2. Validador V2: imagem servida por host oficial de fonte primária confirmada
 *      é relevante mesmo com URL opaca (ex.: AdobeStock_123.jpeg da intel.com).
 *   3. Selecionar melhor pauta: bônus +10 pra tipo_fonte=primaria (nudge de score;
 *      primária passa a poder vencer editorial).
 *   4. Consolidar candidatos aprovados: fallback imagens_oficiais = [imagem_principal]
 *      quando imagens_oficiais vazio (ponte pro agente usar a capa enriquecida).
 *
 * DEPLOY: edita o DRAFT (workflow_entity.nodes) + novo versionId + row em
 * workflow_history. Depois PUBLICAR pelo editor (refresh + Publish) pra o schedule
 * usar. Ver [[deploy-draft-vs-published]].
 *
 * Uso: node patches/semana2b-validador-e-score.cjs [--dry]
 * Idempotente: se as marcas novas já existem, pula.
 */
'use strict';
const path = require('path');
const sqlite3 = require(path.join(process.cwd(), 'node_modules', 'sqlite3'));
const DRY = process.argv.includes('--dry');
const DB = path.join(process.cwd(), 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const uuid = () => require('crypto').randomUUID();
const nowStr = () => new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);

// ---- edições (old -> new), com asserção de match ----
const EDITS = [
  {
    node: 'Selecionar melhor pauta',
    marker: 'const efetivo =',
    old:
`    const score =
      Number(b.registro?.pontuacao_total || 0) -
      Number(a.registro?.pontuacao_total || 0);
    if (score) return score;`,
    new:
`    const efetivo = (x) =>
      Number(x.registro?.pontuacao_total || 0) +
      (String(x.noticia?.tipo_fonte || '') === 'primaria' ? 10 : 0);
    const score = efetivo(b) - efetivo(a);
    if (score) return score;`,
  },
  {
    node: 'Consolidar candidatos aprovados',
    marker: 'noticia.imagem_principal ? [noticia.imagem_principal]',
    old: `      imagens_oficiais: noticia.imagens_oficiais || [],`,
    new:
`      imagens_oficiais:
        (Array.isArray(noticia.imagens_oficiais) && noticia.imagens_oficiais.length)
          ? noticia.imagens_oficiais
          : (noticia.imagem_principal ? [noticia.imagem_principal] : []),`,
  },
  {
    node: 'Validar antes de publicar',
    marker: 'const pareceImagemUrl =',
    old:
`const imagensValidas = imagens.filter((imagem) => {
  if (!imagem || hostIn(imagem.host, imagensBloqueadas)) return false;
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  return !/\\.(?:html?|php|asp|aspx)$/.test(caminho) &&
    !/\\/(?:search|busca)(?:\\/|$)/.test(caminho);
});`,
    new:
`const hostsImagemConhecidos = [
  'image.mux.com', 'res.cloudinary.com', 'thesourcemediaassets.com',
];
const pareceImagemUrl = (u) =>
  /\\.(?:jpe?g|png|webp|gif|avif)$/.test(String(u).split(/[?#]/)[0].toLowerCase());
const imagensValidas = imagens.filter((imagem) => {
  if (!imagem || hostIn(imagem.host, imagensBloqueadas)) return false;
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  if (/\\.(?:html?|php|asp|aspx)$/.test(caminho)) return false;
  if (/\\/(?:search|busca)(?:\\/|$)/.test(caminho)) return false;
  // precisa parecer imagem (extensao) OU vir de host de imagem conhecido —
  // barra capa fabricada tipo xbox.com/games/... (pagina HTML, nao imagem)
  return pareceImagemUrl(imagem.url) || hostIn(imagem.host, hostsImagemConhecidos);
});`,
  },
  {
    node: 'Validar antes de publicar',
    marker: 'const imagemDeHostOficial =',
    old:
`  const cdnXboxWireOficial =
    hostIn(imagem.host, ['xboxwire.thesourcemediaassets.com']) &&
    fontesPrimariasRelevantes.some((fonte) =>
      hostIn(fonte.host, ['xbox.com'])
    );`,
    new:
`  const cdnXboxWireOficial =
    hostIn(imagem.host, ['xboxwire.thesourcemediaassets.com']) &&
    fontesPrimariasRelevantes.some((fonte) =>
      hostIn(fonte.host, ['xbox.com'])
    );
  // imagem servida por host oficial de fonte primaria confirmada e' confiavel como
  // relevante mesmo com URL opaca (ex.: AdobeStock_123.jpeg da newsroom.intel.com)
  const imagemDeHostOficial =
    hostIn(imagem.host, dominiosPrimarios) &&
    fontesPrimariasRelevantes.length > 0;`,
  },
  {
    node: 'Validar antes de publicar',
    marker: 'imagemDeHostOficial ||',
    old:
`    relevante:
      cdnXboxWireOficial ||
      coincidencias.length >= 2 ||
      coincidenciaEspecifica,`,
    new:
`    relevante:
      imagemDeHostOficial ||
      cdnXboxWireOficial ||
      coincidencias.length >= 2 ||
      coincidenciaEspecifica,`,
  },
];

function open(ro) { return new sqlite3.Database(DB, ro ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE); }
const get = (db, sql, p = []) => new Promise((r, j) => db.get(sql, p, (e, x) => e ? j(e) : r(x)));
const run = (db, sql, p = []) => new Promise((r, j) => db.run(sql, p, function (e) { e ? j(e) : r(this); }));

(async () => {
  console.log(`\n=== semana2b ${DRY ? '(DRY)' : '(APLICANDO)'} ===\n`);
  const db = open(DRY);
  const wf = await get(db, 'SELECT versionId, name, nodes, connections, nodeGroups FROM workflow_entity WHERE id=?', [WF]);
  const nodes = JSON.parse(wf.nodes);

  let changed = 0;
  for (const ed of EDITS) {
    const n = nodes.find((x) => x.name === ed.node);
    if (!n) { console.log(`  ERRO: nó não encontrado: ${ed.node}`); process.exit(1); }
    let code = n.parameters.jsCode;
    if (code.includes(ed.marker)) { console.log(`  [skip] "${ed.node}" já tem: ${ed.marker}`); continue; }
    if (!code.includes(ed.old)) { console.log(`  ERRO: trecho não bateu em "${ed.node}" (marker ${ed.marker}).`); process.exit(1); }
    code = code.replace(ed.old, ed.new);
    n.parameters.jsCode = code;
    changed++;
    console.log(`  [ok] "${ed.node}" <- ${ed.marker}`);
  }

  if (!changed) { console.log('\nNada a mudar (idempotente).'); db.close(); return; }

  if (DRY) { console.log(`\n${changed} edições prontas (nada gravado).`); db.close(); return; }

  const newVer = uuid();
  const ts = nowStr();
  await run(db, 'UPDATE workflow_entity SET nodes=?, versionId=?, updatedAt=? WHERE id=?',
    [JSON.stringify(nodes), newVer, ts, WF]);
  // history row pro novo versionId (senão o Publish do editor dá "Version not found")
  await run(db,
    'INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [newVer, WF, 'Promo Liso', ts, ts, JSON.stringify(nodes), wf.connections, wf.name, 1,
     'semana2b: validador rejeita capa nao-imagem + relevancia host oficial + nudge score primaria + fallback imagens_oficiais', wf.nodeGroups || '[]']);
  console.log(`\n${changed} edições gravadas. Novo versionId=${newVer} (+ history row).`);
  console.log('PRÓXIMO: no editor → refresh → Publish (pra o schedule usar).');
  db.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
