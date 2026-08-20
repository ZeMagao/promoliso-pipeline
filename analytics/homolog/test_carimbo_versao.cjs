#!/usr/bin/env node
// Harness do carimbo de versão nas publicações. Roda em banco de homologação descartável, sem
// nenhuma credencial e sem tocar produção.
//
//   node analytics/homolog/test_carimbo_versao.cjs
//
// O QUE ELE TRAVA. O `coletor-publicacoes.cjs` espalhava `versaoAtual` no mesmo objeto de campos do
// upsert que roda com `somenteVazios` no default (false). Resultado: a cada coleta o carimbo de
// versão da publicação era REESCRITO com a versão viva naquele momento — e o comentário no código
// afirmava justamente o contrário ("só preenchem quando ainda estão vazias").
//
// O efeito medido em produção (20/08): as 15 publicações da semana W33 estavam todas estampadas com
// a MESMA versão de template. A seção "por template" do relatório semanal, que existe para provar
// que uma mudança de arte mudou o alcance, comparava um rótulo com ele mesmo. Toda a evolução visual
// de 11 a 20/08 ficou inatribuível.
//
// O TESTE É O CICLO INTEIRO, não a unidade: semeia, coleta, SIMULA UM DEPLOY (troca o jsCode do
// builder de slide no workflow_entity, como um patch faria), coleta de novo, e cobra que o carimbo
// do post antigo não mexeu — e que um post novo, nascido depois do deploy, receba o carimbo NOVO.
// Sem essa segunda metade o teste passaria com um coletor que simplesmente nunca carimba nada.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..');
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'promo-homolog-')), 'homolog.sqlite');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const node = (rel, args) => execFileSync(process.execPath, [path.join(RAIZ, rel), ...(args || [])], {
  cwd: RAIZ, env: { ...process.env, PROMO_DB: DB }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

const sqlite3 = require('sqlite3');
const abrir = () => new sqlite3.Database(DB, sqlite3.OPEN_READWRITE);
const all = (db, q, p) => new Promise((r, j) => db.all(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (db, q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
const fechar = (db) => new Promise((r) => db.close(() => r()));

// a mesma tabela que o resto do analytics usa
const T_PUB = 'data_table_user_FJFzDiOhgaT2ZOKv';
const WF_PRODUTOR = 'NL8eVLKErgnIXBQq';

(async () => {
  console.log('# banco de homologação: ' + DB + '\n');
  node('analytics/homolog/seed.cjs', ['--saida=' + DB, '--posts=6']);
  try { node('analytics/migrate.cjs', ['up']); } catch (e) { /* seed já pode trazer o schema */ }

  // --- 1a coleta
  node('analytics/coletor-publicacoes.cjs');
  let db = abrir();
  const depois1 = await all(db, `SELECT content_key, template_versao FROM ${T_PUB} ORDER BY content_key`);
  await fechar(db);
  ok('a 1ª coleta carimbou template_versao', depois1.length > 0 && depois1.every((r) => r.template_versao),
    JSON.stringify(depois1.slice(0, 2)));
  const antes = new Map(depois1.map((r) => [r.content_key, r.template_versao]));
  const primeiro = depois1[0] && depois1[0].template_versao;
  console.log('  carimbo inicial: ' + String(primeiro).slice(0, 70));

  // --- simula um deploy: troca o builder de slide, exatamente como um design/patch_*.cjs faria
  db = abrir();
  const [wf] = await all(db, 'SELECT nodes FROM workflow_entity WHERE id=?', [WF_PRODUTOR]);
  ok('o produtor existe no banco de homologação', Boolean(wf));
  const nodes = JSON.parse(wf.nodes);
  const alvo = nodes.find((n) => n.name === 'Code in JavaScript');
  ok('o nó do builder de slide existe', Boolean(alvo));
  alvo.parameters.jsCode = alvo.parameters.jsCode + '\n// DEPLOY SIMULADO: arte nova\n';
  await run(db, 'UPDATE workflow_entity SET nodes=? WHERE id=?', [JSON.stringify(nodes), WF_PRODUTOR]);
  await fechar(db);
  console.log('  (deploy simulado: jsCode do builder de slide mudou)');

  // --- 2a coleta: o carimbo dos posts ANTIGOS não pode mexer
  node('analytics/coletor-publicacoes.cjs');
  db = abrir();
  const depois2 = await all(db, `SELECT content_key, template_versao FROM ${T_PUB} ORDER BY content_key`);
  await fechar(db);

  const mexeram = depois2.filter((r) => antes.has(r.content_key)
    && String(antes.get(r.content_key)) !== String(r.template_versao));
  ok('nenhum carimbo antigo foi reescrito depois do deploy', mexeram.length === 0,
    mexeram.length + ' mexeu(ram): ' + JSON.stringify(mexeram.slice(0, 2)));

  // --- e um post NOVO tem de receber o carimbo novo, senão o coletor só parou de carimbar
  db = abrir();
  const agora = new Date().toISOString().slice(0, 19).replace('T', ' ') + '.000';
  await run(db, `INSERT INTO ${T_PUB} (content_key, createdAt, updatedAt, published_at, primary_url)
    VALUES (?,?,?,?,?)`, ['posdeploy-teste', agora, agora, agora, 'https://exemplo.com/x']);
  await fechar(db);
  node('analytics/coletor-publicacoes.cjs');
  db = abrir();
  const [novo] = await all(db, `SELECT template_versao FROM ${T_PUB} WHERE content_key=?`, ['posdeploy-teste']);
  await fechar(db);
  ok('post novo recebeu carimbo', Boolean(novo && novo.template_versao),
    JSON.stringify(novo));
  ok('e o carimbo do post novo é DIFERENTE do de antes do deploy',
    Boolean(novo && novo.template_versao && novo.template_versao !== primeiro),
    'novo=' + String(novo && novo.template_versao).slice(0, 50) + ' antigo=' + String(primeiro).slice(0, 50));

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
  try { fs.rmSync(path.dirname(DB), { recursive: true, force: true }); } catch (e) { /* tmp */ }
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('FAIL', e.message);
  try { fs.rmSync(path.dirname(DB), { recursive: true, force: true }); } catch (x) { /* tmp */ }
  process.exit(1);
});
