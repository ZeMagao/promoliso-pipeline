// A CAPA PARA DE MATAR A RODADA: hosts que bloqueiam o Cloudinary passam pela nossa ponte.
//
// O SINTOMA: e-mails de "Bad request - please check your parameters" no produtor. Em 20/09 foram
// 4 rodadas mortas de 8 — e 3 em 18/09, 1 em 19/09.
//
// A CAUSA, com a mensagem do próprio Cloudinary (a nossa dizia só "Imagem remota respondeu HTTP
// 400", que esconde de quem é a culpa):
//
//   x-cld-error: Error in loading https://www.adrenaline.com.br/...jpeg - 403 Forbidden
//
// A capa é montada como `image/fetch`: quem busca a imagem no portal é o **Cloudinary**, não nós.
// Medido em 22 hosts de imagem colhidos de uma execução real, cada um testado dos dois lados:
//
//   www.adrenaline.com.br           do VPS 200 · via Cloudinary 400
//   blogger.googleusercontent.com   do VPS 200 · via Cloudinary 400   ← é o host do GameBlast
//   os outros 20 hosts              do VPS 200 · via Cloudinary 200
//
// Ou seja: dois dos nossos melhores feeds brasileiros passaram a derrubar a execução inteira.
// A imagem está lá, viva, e responde para nós — só não para o buscador do Cloudinary.
//
// O CONSERTO: quando o host é um desses, a URL entregue ao Cloudinary passa a ser a da NOSSA
// ponte (`/img?u=...`, no promo-cdn), que busca no portal com cara de navegador e serve. O
// Cloudinary transforma a partir do nosso host, que nunca o bloqueia.
//
// TRÊS CÓPIAS, TRÊS EDIÇÕES. A montagem da URL do Cloudinary vive em três nós — é a duplicação
// que a auditoria já tinha registrado e que ninguém consolidou. Enquanto ela existir, mexer em
// uma só deixa o bug vivo nas outras duas, então as três mudam aqui.
//
// O QUE ESTE PATCH NÃO FAZ: não conserta o fato de a capa falhada MATAR a rodada. O nó da capa
// tem retry mas não tem saída de erro, então qualquer host novo que bloqueie volta a derrubar
// tudo. Isso é outro patch, com decisão editorial junto (reprovar a peça? tentar outra pauta?).
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const PONTE = 'https://n8n.promoliso.com.br/img?u=';

// Mesma lista do serviço (vps/cdn/promo-cdn.cjs). Divergir as duas quebra em silêncio: a URL
// apontaria para a ponte e a ponte recusaria o host com 403.
const REGRA_PONTE = String.raw`  // PONTE (20/09): estes hosts respondem 403 ao buscador do Cloudinary e 200 para o nosso VPS —
  // medido em 22 hosts. Sem isto, a capa devolve 400 e a execução inteira do produtor morre.
  if (/^https:\/\/(?:[a-z0-9-]+\.)*(?:adrenaline\.com\.br|blogger\.googleusercontent\.com)\//i.test(source)) {
    source = '${PONTE}' + encodeURIComponent(source);
  }
`;

// ───────────────────────────────────────── cópias 1 e 2: `cloud()` da capa e dos slides
const ANCORA_CLOUD = String.raw`  if(source.startsWith('https://image.mux.com/')) return source+(source.includes('?')?'&':'?')+'width=1600';
  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/'+transform+'/'+encodeURIComponent(source);`;

const NOVO_CLOUD = String.raw`  if(source.startsWith('https://image.mux.com/')) return source+(source.includes('?')?'&':'?')+'width=1600';
` + REGRA_PONTE + String.raw`  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/'+transform+'/'+encodeURIComponent(source);`;

// ───────────────────────────────────────── cópia 3: `safeImage()` do fallback de capa
const ANCORA_FALLBACK = String.raw`  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/c_fit,w_1400,h_900,q_auto,f_auto/' +
    encodeURIComponent(source);`;

// ⚠️ Aqui `source` é `const` (no `cloud()` é parâmetro, e por isso lá dá para reatribuir). Trocar
// o valor direto estoura "Assignment to constant variable" em produção — o harness pegou isso
// antes do deploy. Por isso esta cópia usa uma variável nova em vez de reatribuir.
const NOVO_FALLBACK = String.raw`  // PONTE (20/09): estes hosts respondem 403 ao buscador do Cloudinary e 200 para o nosso VPS —
  // medido em 22 hosts. Sem isto, a capa devolve 400 e a execução inteira do produtor morre.
  const paraBuscar = /^https:\/\/(?:[a-z0-9-]+\.)*(?:adrenaline\.com\.br|blogger\.googleusercontent\.com)\//i.test(source)
    ? '${PONTE}' + encodeURIComponent(source)
    : source;
  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/c_fit,w_1400,h_900,q_auto,f_auto/' +
    encodeURIComponent(paraBuscar);`;

const EDICOES = [
  { no: 'Code in JavaScript1', nome: 'capa: hosts bloqueados passam pela ponte', de: ANCORA_CLOUD, para: NOVO_CLOUD },
  { no: 'Code in JavaScript', nome: 'slides: hosts bloqueados passam pela ponte', de: ANCORA_CLOUD, para: NOVO_CLOUD },
  { no: 'Usar capa como fallback', nome: 'fallback: hosts bloqueados passam pela ponte', de: ANCORA_FALLBACK, para: NOVO_FALLBACK },
];

const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, edicao, reverter) {
  const saida = lf(texto);
  const de = lf(reverter ? edicao.para : edicao.de);
  const para = lf(reverter ? edicao.de : edicao.para);
  const vezes = saida.split(de).length - 1;
  if (vezes !== 1) {
    throw new Error(`${edicao.no}: âncora "${edicao.nome}" apareceu ${vezes} vezes (esperava 1) `
      + '— patch já aplicado, ou o nó mudou');
  }
  return saida.split(de).join(para);
}

function aplicarNo(texto, nome, reverter) {
  const doNo = EDICOES.filter((e) => e.no === nome);
  const ordem = reverter ? doNo.slice().reverse() : doNo;
  return ordem.reduce((acc, e) => aplicar(acc, e, reverter), texto);
}

module.exports = { WF, EDICOES, aplicar, aplicarNo, lf, PONTE };

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
    if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId})`);
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != workflow_history — abortando');

    const nodes = JSON.parse(row.nodes);
    const alvos = [...new Set(EDICOES.map((e) => e.no))];
    for (const nome of alvos) {
      const no = nodes.find((x) => x.name === nome);
      if (!no) throw new Error('nó não achado: ' + nome);
      if (typeof no.parameters.jsCode !== 'string') throw new Error(`${nome}: jsCode não é string`);
      aplicarNo(no.parameters.jsCode, nome, REVERTER);   // só valida
    }
    for (const nome of alvos) {
      const no = nodes.find((x) => x.name === nome);
      const depois = aplicarNo(no.parameters.jsCode, nome, REVERTER);
      try { new Function(depois); } catch (e) { throw new Error(`${nome}: jsCode resultante não compila: ${e.message}`); }
      no.parameters.jsCode = depois;
      console.log(`OK  ${nome}`);
    }

    // A ponte tem que estar no ar ANTES: com ela fora, a capa aponta para um 502 e a rodada morre
    // igual — trocaríamos um defeito por outro.
    if (!REVERTER) {
      const alvo = 'https://www.adrenaline.com.br/wp-content/uploads/2026/09/Physint-Kojima-Productions-Cancelamento.jpeg';
      const r = await fetch(PONTE + encodeURIComponent(alvo));
      const tipo = String(r.headers.get('content-type') || '');
      if (!r.ok || !tipo.startsWith('image/')) {
        throw new Error(`a ponte não serviu a imagem: HTTP ${r.status} ${tipo} — suba o promo-cdn e a rota /img antes`);
      }
      const viaCloud = await fetch('https://res.cloudinary.com/fy2n2qvr/image/fetch/f_auto/'
        + encodeURIComponent(PONTE + encodeURIComponent(alvo)));
      if (!viaCloud.ok) {
        throw new Error('o Cloudinary não conseguiu buscar da ponte: HTTP ' + viaCloud.status
          + ' ' + (viaCloud.headers.get('x-cld-error') || ''));
      }
      console.log('OK  ponte serve a imagem e o Cloudinary busca dela (HTTP ' + viaCloud.status + ')');
    }

    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER
      ? 'Reverte a ponte de imagem para hosts que bloqueiam o Cloudinary'
      : 'Capa deixa de morrer: adrenaline e blogger passam pela ponte do promo-cdn';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }

    fs.writeFileSync(path.join(__dirname, '..', 'newversion-ponte-imagem.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
