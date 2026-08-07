// BUG #3 da lista de 2026-08-06: `promoliso_publicacoes` parou de ser atualizado desde a virada.
//
// Medido: a tabela tem 1 linha com operational_status='PUBLISHED' (de 29/07, era do publish inline)
// contra 16 em 'PREPARED' — incluindo a MSI que publicou em 04/08 e a Monsters que publicou em
// 06/08. O publicador só escreve na FILA (`Marcar PUBLISHED`); ninguém escreve nessa tabela.
//
// Duas consequências reais:
//  (a) `blocksTopic()` do "Montar contexto editorial" bloqueia tema por operational_status
//      'PUBLISHED' OU 'PREPARED com <= 6 h'. Como nada vira PUBLISHED, um tema publicado deixa de
//      bloquear depois de 6 h — a trava contra republicar virou uma janela de 6 h.
//  (b) o instagram_post_id não existe em lugar durável: só dentro do execution_data, que é podado
//      em 7 dias. Sem ele não dá pra auditar nem apagar um post ruim depois.
//
// POR QUE SCRIPT EXTERNO E NÃO UM NÓ NOVO
// Escrever de volta a partir do publicador exigiria inserir nó + religar conexões. Cirurgia de
// workflow é exatamente o que quebrou a publicação por 3 dias no carrossel variável (05/08).
// Este script roda de fora, só faz UPDATE, e rodando de hora em hora captura o post_id bem dentro
// da janela de retenção do execution_data.
//
// O QUE FAZ
//  1. lê a FILA e junta os content_key com status PUBLISHED (prova de que publicou)
//  2. lê as execuções do publicador e extrai, por content_key, o id do post, do story e do container
//  3. faz UPDATE nas linhas de promoliso_publicacoes desses content_key
//
// TRAVAS
//  - só UPDATE; nunca INSERT, nunca DELETE
//  - só toca linha cujo content_key está PUBLISHED na fila
//  - nunca sobrescreve instagram_post_id que já tenha valor
//  - --dry mostra tudo sem gravar
//
// Uso:  sudo -u promo node /opt/promoliso/promo-fila-writeback.cjs [--dry]
const sqlite3 = require('sqlite3');
const path = require('path');
const { execSync } = require('child_process');

const RAIZ = __dirname;
const DB = path.join(RAIZ, 'data', '.n8n', 'database.sqlite');
const FILA = 'data_table_user_i2e8ZwnL9kwOV6OG';
const PUBS = 'data_table_user_FJFzDiOhgaT2ZOKv';
const PUBLICADOR = 'E27F7yVdsZRj';
const DRY = process.argv.includes('--dry');

let flatted;
try { flatted = require(path.join(RAIZ, 'node_modules', 'flatted')); } catch { flatted = null; }

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const all = (q, p) => new Promise((r, j) => db.all(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));

// o n8n grava as datas dessa tabela em UTC; seguimos a mesma convenção
function agoraUtc() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

// Extrai (content_key -> ids do Instagram) das execuções do publicador que ainda estão no banco.
function idsPorContentKey() {
  const mapa = new Map();
  if (!flatted) { console.log('AVISO: flatted não encontrado — sem extrair post_id do execution_data'); return mapa; }
  let ids = [];
  try {
    ids = execSync(`sqlite3 "${DB}" "SELECT id FROM execution_entity WHERE workflowId='${PUBLICADOR}' AND status='success' ORDER BY id;"`)
      .toString().trim().split('\n').filter(Boolean);
  } catch (e) { console.log('AVISO: não consegui listar execuções do publicador: ' + e.message.slice(0, 80)); return mapa; }

  for (const execId of ids) {
    let rd;
    try {
      const raw = execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=${execId};"`, { maxBuffer: 1024 * 1024 * 500 }).toString();
      if (!raw.trim()) continue;
      rd = flatted.parse(raw)?.resultData?.runData;
    } catch { continue; }
    if (!rd) continue;
    const ck = String(rd['Selecionar READY']?.[0]?.data?.main?.[0]?.[0]?.json?.content_key || '').trim();
    if (!ck) continue;
    const post = rd['Publish a post']?.slice(-1)[0]?.data?.main?.[0]?.[0]?.json?.id;
    const container = rd['Create a carousel post']?.slice(-1)[0]?.data?.main?.[0]?.[0]?.json?.id;
    const story = rd['Create a story']?.slice(-1)[0]?.data?.main?.[0]?.[0]?.json?.id;
    if (!post) continue; // sem post publicado não há o que registrar
    // execução mais recente vence (se a mesma pauta foi republicada, o id atual é o que vale)
    mapa.set(ck, {
      execId,
      post: String(post),
      container: container ? String(container) : '',
      story: story ? String(story) : '',
    });
  }
  return mapa;
}

(async () => {
  if (!DRY) await run('PRAGMA busy_timeout=8000');

  const filaPub = await all(`SELECT content_key, topic, published_at FROM ${FILA} WHERE UPPER(status)='PUBLISHED' AND TRIM(COALESCE(content_key,''))<>''`);
  console.log(`fila: ${filaPub.length} rows PUBLISHED com content_key`);
  const publicadoNaFila = new Map(filaPub.map((r) => [String(r.content_key).trim(), r]));

  const ids = idsPorContentKey();
  console.log(`execuções do publicador com post id: ${ids.size}`);

  const pubs = await all(`SELECT id, content_key, topic, operational_status, instagram_post_id, instagram_story_id, carousel_container_id, published_at FROM ${PUBS}`);
  console.log(`promoliso_publicacoes: ${pubs.length} linhas`);

  const planejado = [];
  for (const p of pubs) {
    const ck = String(p.content_key || '').trim();
    if (!ck) continue;
    const naFila = publicadoNaFila.get(ck);
    if (!naFila) continue; // sem prova de publicação, não mexe

    const ig = ids.get(ck) || null;
    const campos = {};
    if (String(p.operational_status || '').toUpperCase() !== 'PUBLISHED') campos.operational_status = 'PUBLISHED';
    if (!String(p.published_at || '').trim() && naFila.published_at) campos.published_at = naFila.published_at;
    // nunca sobrescreve id que já existe
    if (ig && !String(p.instagram_post_id || '').trim()) campos.instagram_post_id = ig.post;
    if (ig && ig.story && !String(p.instagram_story_id || '').trim()) campos.instagram_story_id = ig.story;
    if (ig && ig.container && !String(p.carousel_container_id || '').trim()) campos.carousel_container_id = ig.container;

    if (Object.keys(campos).length) planejado.push({ id: p.id, topic: p.topic, de: p.operational_status, campos, temIds: Boolean(ig) });
  }

  if (!planejado.length) { console.log('nada a atualizar — tudo já consistente.'); db.close(); return; }

  console.log('');
  console.log(`${planejado.length} linha(s) a atualizar:`);
  for (const p of planejado) {
    const detalhe = Object.entries(p.campos)
      .map(([k, v]) => `${k}=${k.includes('instagram') || k.includes('carousel') ? v : JSON.stringify(v)}`)
      .join(' ');
    console.log(`  id=${String(p.id).padEnd(3)} [${String(p.de).padEnd(9)}] ${String(p.topic).slice(0, 38).padEnd(38)} ${detalhe}${p.temIds ? '' : '  (sem post_id: execução já podada)'}`);
  }

  if (DRY) { console.log(''); console.log('DRY — nada gravado.'); db.close(); return; }

  let ok = 0;
  for (const p of planejado) {
    const campos = { ...p.campos, updatedAt: agoraUtc() };
    const sets = Object.keys(campos).map((k) => `${k}=?`).join(', ');
    const vals = [...Object.values(campos), p.id];
    await run(`UPDATE ${PUBS} SET ${sets} WHERE id=?`, vals);
    ok++;
  }
  console.log('');
  console.log(`OK ${ok} linha(s) atualizada(s).`);

  const resumo = await all(`SELECT operational_status, COUNT(*) n, SUM(CASE WHEN TRIM(COALESCE(instagram_post_id,''))<>'' THEN 1 ELSE 0 END) com_post_id FROM ${PUBS} GROUP BY operational_status`);
  console.log('estado final:');
  for (const r of resumo) console.log(`  ${String(r.operational_status).padEnd(18)} ${String(r.n).padStart(3)}  com post_id: ${r.com_post_id}`);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
