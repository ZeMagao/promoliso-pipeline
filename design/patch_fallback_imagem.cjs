// Conserta o nó "Usar capa como fallback" do produtor, que transformava a falha de UM
// slide em ERRO FATAL da execução inteira (matou a exec 197 de 2026-08-06 14:00).
//
// O QUE ACONTECIA
// O builder do slide ("Code in JavaScript") monta a URL do Cloudinary com a transformação
// DELE, e as dimensões variam por tipo de slide. Medido na exec 197:
//   builder  (no HTML):  c_fill,g_auto,w_1498,h_723,f_auto,q_auto:best,e_sharpen:60
//   fallback (procurava): c_fit,w_1400,h_900,q_auto,f_auto
// O fallback RECONSTRUÍA a URL inteira com a sua própria transformação e depois exigia
// encontrá-la no HTML. Nunca casa — nenhuma transformação fixa pode casar, porque as
// dimensões mudam por slide. A guarda (criada pra evitar falha silenciosa) então estourava
// e derrubava a execução: pauta aprovada, render de 1 slide com imagem 404, execução morta.
//
// O CONSERTO
// Trocar apenas a URL de ORIGEM dentro do fetch que JÁ ESTÁ no HTML, preservando a
// transformação que o builder escolheu. Assim o fallback funciona para qualquer slide.
// Casos cobertos:
//   - fallback normal            -> prefixo do builder + encodeURIComponent(capa)
//   - fallback mux/cloudinary    -> substitui o fetch inteiro (Cloudinary não busca mux)
//   - slide servido direto (mux) -> troca a URL crua no HTML
//   - HTML com mais de um fetch  -> troca só o da imagem que falhou
// A guarda continua, mas agora só dispara quando realmente não há o que trocar.
//
// EFEITO: imagem 404 passa a virar slide com a capa e a execução COMPLETA, em vez de morrer.
// Não muda nada quando o render dá certo — este nó só roda no ramo de falha.
//
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const NODE = 'Usar capa como fallback';
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const RE = /const alvo = safeImage\(imagemOriginal, imagemFallback\);[\s\S]*?throw new Error\('Fallback não aplicado: a URL da imagem não foi encontrada no HTML do slide'\);\s*\}/;

const NOVO = `const substituto = safeImage(imagemFallback);
if (!substituto) throw new Error('Capa de fallback não produziu uma URL utilizável');

const htmlOriginal = String(original.html || '');
let html = htmlOriginal;
let trocou = false;

// O builder do slide escolhe a transformação do Cloudinary e as dimensões mudam por tipo
// de slide (ex.: c_fill,g_auto,w_1498,h_723,f_auto,q_auto:best,e_sharpen:60). Reconstruir a
// URL aqui com outra transformação NUNCA casa com o HTML — era por isso que este nó só
// sabia estourar, virando erro fatal da execução. Trocamos só a URL de ORIGEM dentro do
// fetch que já está no HTML, preservando a transformação do builder.
const RE_FETCH = /(https:\\/\\/res\\.cloudinary\\.com\\/fy2n2qvr\\/image\\/fetch\\/[^/]+\\/)([^"'\\s)]+)/;
// Cloudinary image/fetch não consegue buscar image.mux.com, e refetchar uma URL que já é
// Cloudinary é desperdício: nesses casos o fetch inteiro é substituído.
const fallbackDireto =
  /^https:\\/\\/(?:res\\.cloudinary\\.com\\/fy2n2qvr|image\\.mux\\.com)\\//i.test(imagemFallback);

if (RE_FETCH.test(htmlOriginal)) {
  const reGlobal = new RegExp(RE_FETCH.source, 'g');
  const fetches = htmlOriginal.match(reGlobal) || [];
  html = htmlOriginal.replace(reGlobal, (todo, prefixo, origem) => {
    let cru = origem;
    try { cru = decodeURIComponent(origem); } catch (e) { cru = origem; }
    // troca só o fetch da imagem que falhou; outros assets do template ficam intactos
    const eADoSlide = cru === imagemOriginal || fetches.length === 1;
    if (!eADoSlide) return todo;
    trocou = true;
    return fallbackDireto ? substituto : prefixo + encodeURIComponent(imagemFallback);
  });
} else if (/^https:\\/\\//i.test(imagemOriginal) && htmlOriginal.includes(imagemOriginal)) {
  // slide servido direto pelo renderizador (bypass do image.mux.com): troca a URL crua
  html = htmlOriginal.split(imagemOriginal).join(substituto);
  trocou = true;
}

html = html.replace(/IMAGEM OFICIAL \\/ [^<]*/, 'IMAGEM OFICIAL / CAPA CONFIRMADA');

// Guarda mantida — falha silenciosa é pior (re-renderizaria o mesmo HTML e tomaria o mesmo
// erro). Mas agora ela só dispara quando de fato não há URL de imagem pra trocar, não por
// divergência de transformação.
if (!trocou) {
  throw new Error('Fallback não aplicado: não achei URL de imagem no HTML do slide');
}`;

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

  // pré-condições: as peças que o código novo usa têm que existir
  for (const p of ['function safeImage', 'const imagemOriginal', 'const imagemFallback', "$('Code in JavaScript')"]) {
    if (!code.includes(p)) throw new Error('pré-requisito faltando no nó: ' + p);
  }
  const achou = (code.match(new RegExp(RE.source, 'g')) || []).length;
  if (achou !== 1) throw new Error(`esperava 1 trecho e achei ${achou} — abortando (já aplicado?)`);

  code = code.replace(RE, NOVO);
  console.log('OK  bloco de substituição trocado');

  // o que tem que continuar existindo
  for (const p of ['fallback_aplicado: true', "fonte_imagem: 'CAPA CONFIRMADA'", 'IMAGEM OFICIAL / CAPA CONFIRMADA', 'não existe capa de fallback']) {
    if (!code.includes(p)) throw new Error('sumiu algo que deveria continuar: ' + p);
  }
  // o `alvo` antigo não pode ter sobrado solto
  if (/\balvo\b/.test(code)) throw new Error('sobrou referência ao `alvo` antigo — abortando');
  new Function(code); // não grava código que nem compila

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
       'fallback de imagem: troca so a URL de origem dentro do fetch do builder (antes reconstruia com outra transformacao e derrubava a execucao)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-fallback.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
