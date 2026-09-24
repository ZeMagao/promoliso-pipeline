// SEGURANÇA — fecha a fuga do atributo `src="..."` no HTML do carrossel (reancorado em 24/09/2026).
//
// ORIGEM: auditoria de 07/08. Escrito, provado e nunca deployado; as âncoras envelheceram quando a
// ponte de imagem entrou no `cloud()` em 20/09. Esta é a mesma blindagem, reancorada.
//
// O DEFEITO: o texto dos slides é escapado por `esc()`, mas a URL da imagem não — ela é
// considerada segura porque `cloud()` passa a origem por `encodeURIComponent`. Só que `cloud()`
// tem dois atalhos que devolvem a URL CRUA: quando ela já é do nosso Cloudinary e quando é do
// `image.mux.com`. URL crua entra dentro de `src="..."`, e uma URL que carregue aspas fecha o
// atributo — o que vier depois vira HTML executando dentro do Chrome headless do renderizador,
// no servidor.
//
// Como uma URL dessas chegaria ali: `slide.imagem` é escrito pelo agente redator, que lê 12 feeds
// RSS de terceiros. É a última etapa de uma cadeia de prompt injection — improvável, e com custo
// de fechar perto de zero.
//
// A CORREÇÃO percent-encoda, na entrada do atributo, apenas os caracteres que a RFC 3986 já
// proíbe crus numa URI: aspas, `<`, `>`, crase, barra invertida, controles e 0x7F. URL legítima
// não muda um byte — e é isso que o harness mede, comparando as URLs reais antes e depois. O `&`
// fica intacto, então URL assinada do Mux com querystring continua idêntica.
//
// TRÊS NÓS montam ou remendam esse HTML, e os três recebem a mesma função — a duplicação é do
// desenho atual do fluxo, não desta correção:
//   - `Code in JavaScript`       (builder do slide)
//   - `Code in JavaScript1`      (builder da capa)
//   - `Usar capa como fallback`  (costura a URL crua no HTML já pronto)
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';

// A MESMA string vai para os três nós e para o harness, para não divergirem.
const URLATTR = `function urlAttr(u){
  // Blindagem de atributo: os dois atalhos do cloud() devolvem a URL CRUA (sem encodeURIComponent)
  // direto pra dentro de src="...". URL com aspas fecha o atributo e vira HTML executando no
  // Chrome do renderizador. Estes caracteres sao proibidos crus numa URI (RFC 3986), entao
  // percent-encoda-los nao altera nenhuma URL legitima — so fecha a fuga. '&' fica intacto.
  return String(u||'').replace(/["'<>\\\`\\\\]|[\\u0000-\\u0020]|\\u007f/g,
    (c)=>'%'+c.charCodeAt(0).toString(16).toUpperCase().padStart(2,'0'));
}`;

// ── os dois builders de HTML ────────────────────────────────────────────────
const ANCORA_DEF = `function cloud(source, transform){`;
const NOVO_DEF = `${URLATTR}
function cloud(source, transform){`;

const ANCORA_ATALHOS = `  if(/^https:\\/\\/res\\.cloudinary\\.com\\/fy2n2qvr\\//i.test(source)) return source;
  if(source.startsWith('https://image.mux.com/')) return source+(source.includes('?')?'&':'?')+'width=1600';`;

const NOVO_ATALHOS = `  if(/^https:\\/\\/res\\.cloudinary\\.com\\/fy2n2qvr\\//i.test(source)) return urlAttr(source);
  if(source.startsWith('https://image.mux.com/')) return urlAttr(source+(source.includes('?')?'&':'?')+'width=1600');`;

// ── o nó de fallback ────────────────────────────────────────────────────────
// ⚠️ Aqui a blindagem vai DENTRO do safeImage, não na chamada. A primeira versão embrulhava
// `safeImage(imagemFallback)` no ponto de uso — e o harness mostrou o buraco: o nó chama
// safeImage em dois lugares, então o segundo caller continuaria devolvendo URL crua. Proteger na
// origem deixa os três nós com a mesma semântica.
const ANCORA_FB_DEF = `function safeImage(value, fallback) {`;
const NOVO_FB_DEF = `${URLATTR}
function safeImage(value, fallback) {`;

const ANCORA_FB_ATALHOS = String.raw`  if (/^https:\/\/res\.cloudinary\.com\/fy2n2qvr\//i.test(source)) {
    return source;
  }`;

const NOVO_FB_ATALHOS = String.raw`  if (/^https:\/\/res\.cloudinary\.com\/fy2n2qvr\//i.test(source)) {
    return urlAttr(source);
  }`;

const ANCORA_FB_MUX = `  if (source.startsWith('https://image.mux.com/')) {
    return source + (source.includes('?') ? '&' : '?') + 'width=1400';
  }`;

const NOVO_FB_MUX = `  if (source.startsWith('https://image.mux.com/')) {
    return urlAttr(source + (source.includes('?') ? '&' : '?') + 'width=1400');
  }`;

const EDICOES = [
  { no: 'Code in JavaScript', nome: 'slide: define urlAttr', de: ANCORA_DEF, para: NOVO_DEF },
  { no: 'Code in JavaScript', nome: 'slide: blinda os atalhos do cloud()', de: ANCORA_ATALHOS, para: NOVO_ATALHOS },
  { no: 'Code in JavaScript1', nome: 'capa: define urlAttr', de: ANCORA_DEF, para: NOVO_DEF },
  { no: 'Code in JavaScript1', nome: 'capa: blinda os atalhos do cloud()', de: ANCORA_ATALHOS, para: NOVO_ATALHOS },
  { no: 'Usar capa como fallback', nome: 'fallback: define urlAttr', de: ANCORA_FB_DEF, para: NOVO_FB_DEF },
  { no: 'Usar capa como fallback', nome: 'fallback: blinda o atalho do Cloudinary', de: ANCORA_FB_ATALHOS, para: NOVO_FB_ATALHOS },
  { no: 'Usar capa como fallback', nome: 'fallback: blinda o atalho do Mux', de: ANCORA_FB_MUX, para: NOVO_FB_MUX },
];

const MARCA = 'function urlAttr(u){';
const lf = (s) => String(s).split('\r\n').join('\n');

function aplicarNo(texto, nome, reverter) {
  let saida = lf(texto);
  if (!reverter && saida.includes(MARCA)) throw new Error(nome + ': já tem urlAttr — patch aplicado?');
  if (reverter && !saida.includes(MARCA)) throw new Error(nome + ': não tem urlAttr — nada a reverter');
  const doNo = EDICOES.filter((e) => e.no === nome);
  for (const e of (reverter ? doNo.slice().reverse() : doNo)) {
    const de = lf(reverter ? e.para : e.de);
    const para = lf(reverter ? e.de : e.para);
    const vezes = saida.split(de).length - 1;
    if (vezes !== 1) throw new Error(`${nome}: âncora "${e.nome}" apareceu ${vezes} vezes (esperava 1)`);
    saida = saida.split(de).join(para);
  }
  return saida;
}

module.exports = { WF, EDICOES, aplicarNo, lf, URLATTR, MARCA };

if (require.main === module) {
  const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
  if (!fs.existsSync(DB)) {
    console.error('FAIL  rode no VPS: cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --dry');
    process.exit(1);
  }
  const sqlite3 = require('sqlite3');
  const DRY = process.argv.includes('--dry');
  const REVERTER = process.argv.includes('--reverter');
  const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
  const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
  const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
  function agora() {
    const d = new Date(); const p = (n, l) => String(n).padStart(l || 2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
      + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }

  (async () => {
    const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
    if (!row) throw new Error('workflow não achado: ' + WF);
    if (row.versionId !== row.activeVersionId) throw new Error('draft != publicado — resolver no editor antes');
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != workflow_history — abortando');

    const nodes = JSON.parse(row.nodes);
    const alvos = [...new Set(EDICOES.map((e) => e.no))];
    for (const nome of alvos) {
      const no = nodes.find((x) => x.name === nome);
      if (!no) throw new Error('nó não achado: ' + nome);
      aplicarNo(no.parameters.jsCode, nome, REVERTER);   // só valida
    }
    for (const nome of alvos) {
      const no = nodes.find((x) => x.name === nome);
      const depois = aplicarNo(no.parameters.jsCode, nome, REVERTER);
      try { new Function(depois); } catch (e) { throw new Error(nome + ': jsCode resultante não compila: ' + e.message); }
      no.parameters.jsCode = depois;
      console.log('OK  ' + nome);
    }

    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
          REVERTER ? 'Reverte a blindagem de atributo nas URLs de imagem'
            : 'Seguranca: URL de imagem nao pode fechar o atributo src', '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }

    fs.writeFileSync(path.join(__dirname, '..', 'newversion-url-attr.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
