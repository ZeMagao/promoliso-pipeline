// AS IMAGENS DO CARROSSEL PASSAM A SER SERVIDAS DE UM HOST NOSSO (17/09/2026).
//
// O PROBLEMA, MEDIDO. Desde 16/09 nenhum slot publica. As três tentativas do dia (12:30, 16:30 e
// 20:30) falharam no `Carrossel 06`, que só guarda "Bad request - please check your parameters".
// Reproduzindo a chamada à mão, a mensagem real do Meta é:
//
//   code 9004 · error_subcode 2207052
//   "Media download has failed. The media URI doesn't meet our requirements."
//
// O buscador de mídia do Meta não consegue baixar do `res.cloudinary.com` de forma confiável.
// Não é token (válido, conta BUSINESS), não é cota (0 de 100), não é formato: as mesmas imagens
// respondem 200 em 0,3 s do próprio VPS, 1080×1350, `image/jpeg`. Taxa medida em 16/09:
//
//   imagem nova, no Cloudinary .......................... 3/8   (38%)
//   imagem da peça 70, que PUBLICOU em 20/08 ............ 3/6   (50%)
//   imagem fora do Cloudinary (blog.playstation.com) .... 8/8  (100%)
//
// Com 6 filhos e `retryOnFail` que refaz os SEIS, publicar virava ~0,8%. Por isso o conserto não é
// mexer no retry: é tirar o Cloudinary do caminho do buscador do Meta.
//
// O QUE MUDA. Só o nó `Selecionar READY`, e só nas URLs que ele entrega:
//
//   antes   https://res.cloudinary.com/fy2n2qvr/image/upload/v1789570897/ijg9phpzidoymtkkwe0n.jpg
//   depois  https://n8n.promoliso.com.br/cdn/v1789570897/ijg9phpzidoymtkkwe0n.jpg
//
// Do outro lado está o serviço `promo-cdn` (vps/cdn/promo-cdn.cjs): ele baixa a imagem do
// Cloudinary UMA vez, guarda em disco e serve do disco. Quando o Meta vier buscar, é leitura de
// arquivo local — o buscador do Meta não fala mais com o Cloudinary.
//
// ⚠️ ORDEM OBRIGATÓRIA: o `promo-cdn` e a rota do Caddy têm que estar no ar ANTES deste patch.
// Se o patch subir antes, a peça aponta para uma URL que ainda não responde e o slot falha igual.
// O `--dry` confere isso sozinho: ele busca uma imagem real pela URL nova antes de liberar.
//
// O QUE NÃO MUDA: a escolha da peça (ramo A/B/C, nota, frescor), a contagem de imagens, a saída do
// Switch, a legenda, o alerta, a devolução para a fila. Uma URL que não seja exatamente uma imagem
// `upload` do nosso cloud passa intacta — medido: das 418 URLs das 60 rows da fila, 418 casam o
// padrão, então hoje não existe esse caso, mas a porta fica fechada em vez de aberta.
//
// ROLLBACK: `--reverter` (volta a apontar para o Cloudinary; não mexe no serviço).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'E27F7yVdsZRj';
const CDN_BASE = 'https://n8n.promoliso.com.br';
const CLOUD = 'fy2n2qvr';

// ───────────────────────────────────────────────────── 1. as URLs do carrossel
const ANCORA_URLS = `const usadas = validas.slice(0, MAX_IMAGENS);`;

const NOVO_URLS = `// HOST PRÓPRIO PARA A IMAGEM (17/09). O buscador do Meta falha ao baixar de res.cloudinary.com —
// medido em 16/09: 3/8 e 3/6 por imagem lá, 8/8 fora de lá. Com 6 filhos, publicar virava 0,8% e
// os três slots do dia falharam com "Bad request". Aqui a URL vira a do nosso host, que serve a
// mesma imagem de disco (serviço promo-cdn). O que não casa o padrão do nosso cloud passa intacto.
const CDN_BASE = '${CDN_BASE}';
const RE_CLOUDINARY = /^https:\\/\\/res\\.cloudinary\\.com\\/${CLOUD}\\/image\\/upload\\/(v[0-9]+)\\/([A-Za-z0-9_-]{4,128})\\.jpg$/;
const paraCdn = (url) => {
  const m = RE_CLOUDINARY.exec(String(url || ''));
  return m ? CDN_BASE + '/cdn/' + m[1] + '/' + m[2] + '.jpg' : String(url || '');
};
const usadas = validas.slice(0, MAX_IMAGENS).map(paraCdn);`;

// ───────────────────────────────────────────────────── 2. a imagem do story
// O `Create a story` sofre do mesmo problema — é o mesmo buscador do Meta na mesma URL.
const ANCORA_STORY = `  story_url: String(r.story_url||''),`;
const NOVO_STORY = `  story_url: paraCdn(r.story_url),`;

const EDICOES = [
  { no: 'Selecionar READY', nome: 'carrossel sai pelo host nosso', de: ANCORA_URLS, para: NOVO_URLS, marca: 'paraCdn' },
  { no: 'Selecionar READY', nome: 'story sai pelo host nosso', de: ANCORA_STORY, para: NOVO_STORY, marca: 'paraCdn(r.story_url)' },
];

const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, edicao, reverter) {
  const saida = lf(texto);
  const de = lf(reverter ? edicao.para : edicao.de);
  const para = lf(reverter ? edicao.de : edicao.para);
  const vezes = saida.split(de).length - 1;
  if (vezes !== 1) {
    throw new Error(`${edicao.no}: âncora "${edicao.nome}" apareceu ${vezes} vezes `
      + `(esperava 1) — patch já aplicado, ou o nó mudou`);
  }
  return saida.split(de).join(para);
}

function aplicarTodas(texto, reverter) {
  const ordem = reverter ? EDICOES.slice().reverse() : EDICOES;
  return ordem.reduce((acc, edicao) => aplicar(acc, edicao, reverter), texto);
}

// Converte uma URL do Cloudinary na nossa — a MESMA regra do patch, exportada para o harness e
// para a conferência do --dry não dependerem de copiar o regex.
const RE_CLOUDINARY = new RegExp(
  '^https://res\\.cloudinary\\.com/' + CLOUD + '/image/upload/(v[0-9]+)/([A-Za-z0-9_-]{4,128})\\.jpg$');
const paraCdn = (url) => {
  const m = RE_CLOUDINARY.exec(String(url || ''));
  return m ? CDN_BASE + '/cdn/' + m[1] + '/' + m[2] + '.jpg' : String(url || '');
};

module.exports = { WF, EDICOES, aplicar, aplicarTodas, lf, paraCdn, CDN_BASE, CLOUD };

if (require.main === module) {
  const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
  if (!fs.existsSync(DB)) {
    console.error('FAIL  banco do n8n não existe aqui: ' + DB
      + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --dry');
    process.exit(1);
  }
  const sqlite3 = require('sqlite3');
  const DRY = process.argv.includes('--dry');
  const REVERTER = process.argv.includes('--reverter');
  const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
  const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
  const all = (q, p) => new Promise((r, j) => db.all(q, p || [], (e, x) => (e ? j(e) : r(x))));
  const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
  function agora() {
    const d = new Date(); const p = (n, l) => String(n).padStart(l || 2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
      + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }

  (async () => {
    const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
    if (!row) throw new Error('workflow não achado: ' + WF);
    if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

    const nodes = JSON.parse(row.nodes);
    const no = nodes.find((x) => x.name === 'Selecionar READY');
    if (!no) throw new Error('nó não achado: Selecionar READY');
    if (typeof no.parameters.jsCode !== 'string') throw new Error('Selecionar READY: jsCode não é string');

    const antes = no.parameters.jsCode;
    const depois = aplicarTodas(antes, REVERTER);
    try { new Function(depois); } catch (e) {
      throw new Error('Selecionar READY: jsCode resultante não compila: ' + e.message);
    }
    for (const edicao of EDICOES) {
      console.log(`OK  ${edicao.nome}`);
    }
    console.log(`OK  jsCode compila  (${depois.length - lf(antes).length > 0 ? '+' : ''}${depois.length - lf(antes).length} bytes)`);

    // O host novo TEM que estar respondendo antes de a fila apontar para ele. Buscamos uma imagem
    // real de uma row publicável, pela URL nova, do jeito que o Meta vai buscar.
    if (!REVERTER) {
      const amostra = await all(
        'SELECT carousel_urls FROM data_table_user_i2e8ZwnL9kwOV6OG '
        + 'WHERE status IN ("READY","RETRY") ORDER BY id DESC LIMIT 1');
      const urls = amostra.length ? JSON.parse(amostra[0].carousel_urls || '[]') : [];
      const alvo = urls.map(paraCdn).find((u) => u.startsWith(CDN_BASE));
      if (!alvo) throw new Error('nenhuma URL publicável para conferir o host novo');
      const r = await fetch(alvo, { redirect: 'follow' });
      const tipo = String(r.headers.get('content-type') || '');
      const bytes = (await r.arrayBuffer()).byteLength;
      if (!r.ok || !/^image\//.test(tipo) || bytes < 1024) {
        throw new Error(`host novo não serve a imagem: ${alvo} -> HTTP ${r.status} ${tipo} ${bytes} bytes`
          + '\n      Suba o promo-cdn e a rota /cdn do Caddy ANTES deste patch.');
      }
      console.log(`OK  host novo serve a imagem: HTTP ${r.status} ${tipo} ${bytes} bytes`);
      console.log(`    ${alvo}`);
    }

    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    no.parameters.jsCode = depois;
    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER
      ? 'Reverte: carrossel volta a apontar para o res.cloudinary.com'
      : 'Carrossel e story saem pelo host proprio (Meta nao baixa do Cloudinary)';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }

    fs.writeFileSync(path.join(__dirname, '..', 'newversion-cdn-publicador.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
