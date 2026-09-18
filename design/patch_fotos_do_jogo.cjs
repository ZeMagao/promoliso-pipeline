// VARIEDADE DE FOTO: a peça passa a puxar as imagens OFICIAIS do jogo (17/09/2026, noite).
//
// A QUEIXA, LITERAL. O post do Gears (peça 75) saiu com a mesma foto em todos os slides. Medido na
// exec 621: a matéria do Xbox Wire entregou 4 URLs que viram **2 fotos distintas** — e uma delas é
// `xpalogo_black.png`, o logo da loja. Sobrou UMA foto real, que ainda por cima é um card de
// especificações de PC. O prompt manda repetir quando falta imagem, então o agente obedeceu: o
// defeito é de OFERTA, não de comportamento do modelo.
//
// O QUE MUDA. Quando a manchete é sobre um jogo identificável, o fluxo busca as fotos oficiais
// dele no nosso serviço (`/jogo/fotos`, que fala com a Steam) e junta ao acervo da pauta.
//
// Medido em 40 pautas reais: **21 identificadas, 19 recusadas, zero falso positivo**. As recusas
// são hardware, promoção de loja, leva de Game Pass e exclusivo de PS que não existe na Steam —
// exatamente onde puxar foto seria mentir. A trava é exigir que o nome devolvido pela Steam
// apareça na manchete, com fronteira de palavra (sem ela, "Control" casava dentro de "Controle
// do PS5" e traria fotos do jogo errado).
//
// POR QUE A BUSCA MORA NO NOSSO SERVIÇO, E NÃO NUM NÓ DE CÓDIGO: o Code node do n8n **não tem
// `fetch`**. Medido em workflow temporário nesta instância, com controle positivo na mesma
// resposta: `{"controle_positivo":4,"tem_fetch":"undefined","erro":"fetch is not defined"}`.
// A alternativa seria criar nó de HTTP e religar conexões — a cirurgia que quebrou a publicação
// por 3 dias em 05/08. Aqui não entra nó nenhum: o nó de HTTP que já existe no enriquecimento
// passa a receber também as URLs do nosso serviço, e o zip por posição continua igual.
//
// AS TRÊS EDIÇÕES:
//   1. `Enriquecer: separar`  — além das páginas sem imagem, pede fotos do jogo para as 6
//      candidatas mais promissoras (primária e fresca na frente).
//   2. `Enriquecer: aplicar`  — guarda o que voltou em `fotos_do_jogo` da candidata.
//   3. `Normalizar notícias`  — inclui `fotos_do_jogo` no acervo E descarta logo/badge/sprite.
//      O descarte é o conserto do `xpalogo_black.png`: medido nas 3332 URLs da exec 621, pega 21,
//      e as 21 são cromo de site (logo da Sony, do GameBlast, do Xbox Wire, da loja).
//
// ORDEM DE PREFERÊNCIA PRESERVADA: a foto da matéria continua na frente (o campo `oficial` já
// ordena assim). A foto da Steam entra como reforço, não como substituta.
//
// O QUE ESTE PATCH NÃO FAZ: não mexe em quantos slides a peça tem. Pauta que continuar sem
// variedade (hardware, promoção) precisa do patch de reduzir slides — é outro arquivo.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const SERVICO = 'https://n8n.promoliso.com.br/jogo/fotos';
const ALVOS_JOGO = 6;     // candidatas que ganham consulta por rodada
const MAX_FOTOS_JOGO = 8; // teto por pauta; o serviço já devolve no máximo 10

// ───────────────────────────────────────────── 1. Enriquecer: separar
const ANCORA_SEP = `const alvos = semImg.slice(0, 8);
if (!alvos.length) return [{ json: { __idx: -1, url: 'https://example.com/', __sentinela: true } }];
return alvos.map(({ c, i }) => ({ json: { __idx: i, url: String(c.url || c.link || '') } }));`;

const NOVO_SEP = `const alvos = semImg.slice(0, 8);

// FOTOS OFICIAIS DO JOGO. Alvo diferente, mesmo nó de HTTP: aqui a URL é do NOSSO serviço, que
// identifica o jogo da manchete e devolve as fotos oficiais dele. Existe porque a peça do Gears
// saiu com a mesma foto em 6 slides — a matéria tinha 2 imagens e uma era o logo da loja.
// Só as 6 mais promissoras (primária e fresca na frente): é a pauta escolhida que vai usar isso,
// e ela sai quase sempre desse topo.
const SERVICO_JOGO = '${SERVICO}';
const ALVOS_JOGO = ${ALVOS_JOGO};
const idadeH = (c) => {
  const t = Date.parse(String((c && c.publicado_em) || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};
const promissoras = pool.map((c, i) => ({ c, i }))
  .filter(({ c }) => c && String(c.titulo || '').trim().length >= 8)
  .sort((a, b) => ((b.c.tipo_fonte === 'primaria') ? 1 : 0) - ((a.c.tipo_fonte === 'primaria') ? 1 : 0)
    || (idadeH(a.c) - idadeH(b.c)))
  .slice(0, ALVOS_JOGO);
const alvosJogo = promissoras.map(({ c, i }) => ({
  json: { __idx: i, __tipo: 'jogo', url: SERVICO_JOGO + '?titulo=' + encodeURIComponent(String(c.titulo).slice(0, 160)) },
}));

const todos = [
  ...alvos.map(({ c, i }) => ({ json: { __idx: i, __tipo: 'og', url: String(c.url || c.link || '') } })),
  ...alvosJogo,
];
if (!todos.length) return [{ json: { __idx: -1, url: 'https://example.com/', __sentinela: true } }];
return todos;`;

// ───────────────────────────────────────────── 2. Enriquecer: aplicar
const ANCORA_APL = `    const html = String((respostas[k] && respostas[k].data) || '');
    if (!html) continue;`;

const NOVO_APL = `    const html = String((respostas[k] && respostas[k].data) || '');
    if (!html) continue;

    // Resposta do nosso serviço de fotos do jogo: JSON, não HTML. Guardamos a lista na candidata;
    // quem decide o que fazer com ela é o "Normalizar notícias", junto das fotos da matéria.
    if (alvos[k].__tipo === 'jogo') {
      try {
        const ficha = JSON.parse(html);
        const fotos = (ficha && Array.isArray(ficha.fotos)) ? ficha.fotos.filter((u) => /^https:\\/\\//i.test(u)) : [];
        const cand = pool[idx];
        if (cand && fotos.length) {
          cand.fotos_do_jogo = fotos.slice(0, ${MAX_FOTOS_JOGO});
          cand.jogo_identificado = String((ficha && ficha.jogo) || '');
        }
      } catch (e) { /* serviço fora do ar ou resposta estranha: a pauta segue com o que tem */ }
      continue;
    }`;

// ───────────────────────────────────────────── 3. Normalizar: acervo + descarte de logo
// ⚠️ ARMADILHA MEDIDA AQUI: `collectOfficialImages` NÃO recebe a candidata — recebe
// `item.dados_brutos ?? item`, ou seja, o item cru do feed. Escrever o campo novo na candidata e
// esperar que a função o veja não funciona (o harness pegou isso: acervo voltava vazio). Por isso
// a lista entra pela ASSINATURA, explícita, em vez de viajar escondida no objeto.
const ANCORA_ASSINATURA = `function collectOfficialImages(item, sourceDomain) {`;
const NOVO_ASSINATURA = `function collectOfficialImages(item, sourceDomain, fotosDoJogo) {`;

const ANCORA_NORM = `  const values = [
    item.imagem_principal,`;

const NOVO_NORM = `  const values = [
    // As fotos oficiais do jogo entram no fim da ordenação de propósito: o \`oficial\` da matéria
    // continua na frente, e a Steam é reforço, não substituta.
    ...(Array.isArray(fotosDoJogo) ? fotosDoJogo : []),
    item.imagem_principal,`;

const ANCORA_CHAMADA = `  const officialImages = collectOfficialImages(
    item.dados_brutos ?? item,
    url.domain,
  );`;

const NOVO_CHAMADA = `  const officialImages = collectOfficialImages(
    item.dados_brutos ?? item,
    url.domain,
    item.fotos_do_jogo,
  );`;

// String.raw de propósito: dentro de template literal comum, "\/" vira "/" e a âncora deixa de
// casar o arquivo — foi o que aconteceu na primeira tentativa deste patch.
const ANCORA_LIXO = String.raw`    const caminhoDescartavel =
      /(?:\/avatars?\/|\/emoji\/|\/icons?\/|spacer|tracking|\/ads?\/|1x1)/i.test(direct);`;

const NOVO_LIXO = String.raw`    // LOGO NÃO É FOTO. A peça do Gears contou xpalogo_black.png (logo da Microsoft Store) como
    // uma das suas 2 "imagens distintas" — e aí sobrou UMA foto de verdade para 6 slides. Medido
    // nas 3332 URLs da exec 621: este padrão pega 21, e as 21 são cromo de site (logo da Sony, do
    // GameBlast, do Xbox Wire, da loja).
    const caminhoDescartavel =
      /(?:\/avatars?\/|\/emoji\/|\/icons?\/|spacer|tracking|\/ads?\/|1x1|logo|badge|sprite|placeholder)/i.test(direct);`;

const EDICOES = [
  { no: 'Enriquecer: separar', nome: 'pede fotos do jogo para as 6 mais promissoras', de: ANCORA_SEP, para: NOVO_SEP },
  { no: 'Enriquecer: aplicar', nome: 'guarda as fotos do jogo na candidata', de: ANCORA_APL, para: NOVO_APL },
  { no: 'Normalizar notícias PromoLiso AI', nome: 'assinatura recebe as fotos do jogo', de: ANCORA_ASSINATURA, para: NOVO_ASSINATURA },
  { no: 'Normalizar notícias PromoLiso AI', nome: 'fotos do jogo entram no acervo', de: ANCORA_NORM, para: NOVO_NORM },
  { no: 'Normalizar notícias PromoLiso AI', nome: 'a chamada passa as fotos do jogo', de: ANCORA_CHAMADA, para: NOVO_CHAMADA },
  { no: 'Normalizar notícias PromoLiso AI', nome: 'logo/badge deixam de contar como foto', de: ANCORA_LIXO, para: NOVO_LIXO },
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

function aplicarNo(texto, nome, reverter) {
  const doNo = EDICOES.filter((e) => e.no === nome);
  const ordem = reverter ? doNo.slice().reverse() : doNo;
  return ordem.reduce((acc, edicao) => aplicar(acc, edicao, reverter), texto);
}

module.exports = { WF, EDICOES, aplicar, aplicarNo, lf, SERVICO, ALVOS_JOGO, MAX_FOTOS_JOGO };

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
    if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

    const nodes = JSON.parse(row.nodes);
    const alvosNos = [...new Set(EDICOES.map((e) => e.no))];
    for (const nome of alvosNos) {
      const no = nodes.find((x) => x.name === nome);
      if (!no) throw new Error('nó não achado: ' + nome);
      if (typeof no.parameters.jsCode !== 'string') throw new Error(`${nome}: jsCode não é string`);
      aplicarNo(no.parameters.jsCode, nome, REVERTER);   // só valida
    }
    for (const nome of alvosNos) {
      const no = nodes.find((x) => x.name === nome);
      const antes = no.parameters.jsCode;
      const depois = aplicarNo(antes, nome, REVERTER);
      try { new Function(depois); } catch (e) {
        throw new Error(`${nome}: jsCode resultante não compila: ${e.message}`);
      }
      no.parameters.jsCode = depois;
      const delta = depois.length - lf(antes).length;
      console.log(`OK  ${nome.padEnd(34)} (${delta > 0 ? '+' : ''}${delta} bytes)`);
    }

    // O serviço tem que estar respondendo ANTES de a fila apontar para ele — senão o nó de HTTP
    // gasta 6 requisições por rodada para receber erro.
    if (!REVERTER) {
      const r = await fetch(SERVICO + '?titulo=' + encodeURIComponent('Gears of War: E-Day vai ouro'));
      const j = await r.json();
      if (!r.ok || !j.jogo || !Array.isArray(j.fotos) || !j.fotos.length) {
        throw new Error('o serviço /jogo/fotos não respondeu com fotos — suba o promo-cdn primeiro');
      }
      console.log(`OK  serviço responde: "${j.jogo}" com ${j.fotos.length} fotos`);
    }

    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER
      ? 'Reverte as fotos oficiais do jogo no acervo da pauta'
      : 'Pauta ganha fotos oficiais do jogo; logo de loja deixa de contar como foto';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }

    fs.writeFileSync(path.join(__dirname, '..', 'newversion-fotos-do-jogo.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
