// BUG #1 da lista de 2026-08-06: o bloco de recuperação de mídia do "Validar antes de publicar"
// escolhia imagens SEM consultar a regra de validade que o próprio nó aplica logo depois.
//
// Exec 199 (produtor 06/08 16:00), medido:
//   recuperacao_midias_oficiais: true
//   output.capa        = https://i.ytimg.com/vi/RxGU05VEc1I/hqdefault.jpg   <- host BLOQUEADO
//   erros: ["Esperava 6 imagens válidas (capa + 5 slides) e passaram 4"]
// `i.ytimg.com` está em `imagensBloqueadas`. O recovery pôs como capa uma imagem que o gate
// rejeita, e a pauta (com 4 fotos boas do Flickr disponíveis) foi reprovada.
//
// É a 3ª instância da mesma classe de bug em dois dias — regra escrita em dois lugares que
// precisavam concordar (caps: limitar() x check; fallback: URL do builder x do fallback; aqui:
// "imagem válida" no recovery x em imagensValidas). Por isso o conserto NÃO é duplicar o filtro:
// é extrair UMA definição e fazer os dois lados usarem.
//
// MUDANÇA A: declara `hostsImagemConhecidos`, `pareceImagemUrl` e `imagemUtilizavel()` logo depois
//   de `imagensBloqueadas` — antes de todo mundo que precisa deles.
// MUDANÇA B: `imagensOficiaisDoCandidato` (a piscina do recovery) passa por `urlUtilizavel`.
//   Na exec 199 a piscina viraria as 4 fotos do Flickr, o ciclo preencheria os 6 slots com imagem
//   válida e a contagem daria 6 -> APROVA.
// MUDANÇA C: `imagensValidas` passa a chamar `imagemUtilizavel` e as declarações duplicadas de
//   `hostsImagemConhecidos`/`pareceImagemUrl` são removidas (senão é SyntaxError por redeclaração
//   de const — o new Function() no fim pega isso).
//
// NÃO afrouxa nada: a regra de validade é a MESMA, só passa a ser aplicada nos dois lados.
//
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const NODE = 'Validar antes de publicar';
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// ---------- A: definição única, declarada cedo ----------
const A_RE = /const imagensBloqueadas = \[\s*\.\.\.dominiosBloqueados,\s*'ytimg\.com',\s*'twimg\.com',\s*'fbcdn\.net',\s*\];/;
const A_NOVO = `const imagensBloqueadas = [
  ...dominiosBloqueados,
  'ytimg.com',
  'twimg.com',
  'fbcdn.net',
];

// Regra ÚNICA de "imagem utilizável". Antes ela existia só lá embaixo, dentro do filtro de
// imagensValidas, e o bloco de recuperação de mídia (mais acima) escolhia imagens sem consultá-la:
// foi assim que a exec 199 recebeu uma thumbnail de i.ytimg.com como capa e em seguida se reprovou
// por ela. Declarada aqui pra que os DOIS lados usem a mesma definição.
const hostsImagemConhecidos = [
  'image.mux.com', 'res.cloudinary.com', 'thesourcemediaassets.com',
];
const pareceImagemUrl = (u) =>
  /\\.(?:jpe?g|png|webp|gif|avif)$/.test(String(u).split(/[?#]/)[0].toLowerCase());
function imagemUtilizavel(imagem) {
  if (!imagem || !imagem.url) return false;
  if (hostIn(imagem.host, imagensBloqueadas)) return false;
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  if (/\\.(?:html?|php|asp|aspx)$/.test(caminho)) return false;
  if (/\\/(?:search|busca)(?:\\/|$)/.test(caminho)) return false;
  // precisa parecer imagem (extensao) OU vir de host de imagem conhecido —
  // barra capa fabricada tipo xbox.com/games/... (pagina HTML, nao imagem)
  return pareceImagemUrl(imagem.url) || hostIn(imagem.host, hostsImagemConhecidos);
}
const urlUtilizavel = (url) => imagemUtilizavel(urlInfo(url));`;

// ---------- B: a piscina do recovery passa pela mesma regra ----------
const B_RE = /  \.map\(\(url\) => String\(url \|\| ''\)\.trim\(\)\)\s*\.filter\(\(url\) => \/\^https:\\\/\\\/\/i\.test\(url\)\)\s*\.filter\(\(url, index, array\) => array\.indexOf\(url\) === index\);/;
const B_NOVO = `  .map((url) => String(url || '').trim())
  .filter((url) => /^https:\\/\\//i.test(url))
  // MESMA regra que o gate aplica. Sem isto o recovery distribuía imagem que o próprio
  // validador rejeita depois (exec 199: i.ytimg.com virou capa e reprovou a pauta).
  .filter(urlUtilizavel)
  .filter((url, index, array) => array.indexOf(url) === index);`;

// ---------- C: o gate usa a definição única e as cópias saem ----------
const C_RE = /const hostsImagemConhecidos = \[\s*'image\.mux\.com', 'res\.cloudinary\.com', 'thesourcemediaassets\.com',\s*\];\s*const pareceImagemUrl = \(u\) =>\s*\/\\\.\(\?:jpe\?g\|png\|webp\|gif\|avif\)\$\/\.test\(String\(u\)\.split\(\/\[\?#\]\/\)\[0\]\.toLowerCase\(\)\);\s*const imagensValidas = imagens\.filter\(\(imagem\) => \{[\s\S]*?\}\);/;
const C_NOVO = `// usa a definição única declarada no topo (antes havia uma cópia da regra aqui, e o
// bloco de recuperação de mídia não a consultava)
const imagensValidas = imagens.filter(imagemUtilizavel);`;

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

  // pré-condições
  for (const p of ['function urlInfo', 'function hostIn', 'const imagensOficiaisDoCandidato', 'problemasSlides']) {
    if (!code.includes(p)) throw new Error('pré-requisito faltando: ' + p);
  }
  // a definição única tem que vir ANTES da piscina do recovery, senão é TDZ em runtime
  const posBloqueadas = code.search(A_RE);
  const posPiscina = code.indexOf('const imagensOficiaisDoCandidato');
  if (posBloqueadas === -1) throw new Error('não achei o bloco imagensBloqueadas');
  if (posBloqueadas > posPiscina) throw new Error('imagensBloqueadas vem DEPOIS da piscina do recovery — abortando');

  for (const [nome, re, novo] of [
    ['A (definição única de imagem utilizável)', A_RE, A_NOVO],
    ['B (piscina do recovery filtrada)', B_RE, B_NOVO],
    ['C (gate usa a definição única)', C_RE, C_NOVO],
  ]) {
    const achou = (code.match(new RegExp(re.source, (re.flags || '') + 'g')) || []).length;
    if (achou !== 1) throw new Error(`mudança ${nome}: esperava 1 trecho e achei ${achou} — abortando (já aplicado?)`);
    code = code.replace(re, novo);
    console.log('OK  mudança ' + nome);
  }

  // nenhuma const pode ter ficado declarada duas vezes
  for (const v of ['hostsImagemConhecidos', 'pareceImagemUrl']) {
    const vezes = (code.match(new RegExp('const ' + v + '\\b', 'g')) || []).length;
    if (vezes !== 1) throw new Error(`${v} declarada ${vezes}x — esperava 1`);
  }
  // o que tem que continuar existindo
  for (const p of ['imagensValidas', 'imagensBaixaResolucao', 'imagemUnicaOficial', 'pautaBemConfirmada', "erros.push('Nenhuma imagem válida')"]) {
    if (!code.includes(p)) throw new Error('sumiu algo que deveria continuar: ' + p);
  }
  new Function(code); // pega redeclaração de const e qualquer erro de sintaxe

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
       'imagem utilizavel vira definicao unica: recovery e gate passam a usar a MESMA regra (recovery escolhia i.ytimg.com que o gate bloqueia)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-recovery.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
