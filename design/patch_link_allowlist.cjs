// SEGURANÇA — a legenda publicada passa a ter allowlist de link (reancorado em 24/09/2026).
//
// ORIGEM: auditoria de 07/08. O patch foi escrito, provado e NUNCA deployado; sete semanas depois
// as âncoras não casavam mais o código vivo e o harness antigo falhava contra ele. Este arquivo é
// a mesma regra, reancorada no validador de hoje, com a prova refeita.
//
// O DEFEITO: a legenda vai para o Instagram verbatim e é escrita pelo agente, que lê 12 feeds RSS
// de terceiros. A URL da oferta já passava por allowlist de loja e as fontes por denylist — mas
// ninguém olhava link escrito DENTRO do texto. Não depende de nenhuma outra falha para acontecer:
// é só texto, e texto é o que o agente foi feito para escrever.
//
// A REGRA pega as duas formas: link explícito (`https://` ou `www.`) e domínio solto no meio da
// frase, que é como alguém escaparia de um filtro que só procura esquema. Mensagens separadas,
// para o alerta dizer qual das duas disparou. Permitido: domínios primários, lojas conhecidas, os
// hosts das fontes JÁ VALIDADAS da própria pauta, e o nosso domínio.
//
// FALSO POSITIVO MEDIDO, não estimado: contra as peças reais da amostra versionada, a regra
// bloquearia ZERO. O prompt manda citar fonte pelo nome ("segundo o PlayStation Blog"), não por
// URL. `design/test_link_allowlist.cjs` refaz a medição a cada rodada.
//
// ONDE ENTRA: logo depois da validação da legenda, antes da auditoria de oferta. As variáveis de
// que a regra depende (`fontes`, `dominiosLojas`, `dominiosPrimarios`, `hostIn`) já estão em
// escopo nesse ponto — conferido no código de hoje, não presumido.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Validar antes de publicar';

// Sentinelas: o harness fatia exatamente este bloco do código patchado e o executa. Sem elas o
// teste teria que reimplementar a regra — e reimplementação diverge do que roda.
const BLOCO = `// >>> LINK ALLOWLIST (seguranca 2026-08-07, no ar em 2026-09-24)
// Allowlist do que pode aparecer como link/dominio no texto publicado: dominios primarios, lojas
// conhecidas, os hosts das fontes JA VALIDADAS desta pauta, e o proprio dominio. Qualquer outro
// host escrito na legenda ou nos slides reprova a pauta.
//
// Por que isto existe: a legenda vai pro Instagram verbatim e e escrita pelo agente, que le feeds
// RSS de terceiros. Sem esta checagem, uma injecao no feed publica o link que quiser no perfil.
// Medido contra as pecas reais da amostra: zero bloqueios no conteudo legitimo de hoje.
const hostsPermitidosNoTexto = [
  ...dominiosPrimarios,
  ...dominiosLojas,
  ...fontes.map((fonte) => fonte.host),
  'promoliso.com.br',
];
const hostDoToken = (token) => String(token || '')
  .replace(/^https?:\\/\\//i, '')
  .replace(/^www\\./i, '')
  .split(/[/?#]/)[0]
  .toLowerCase()
  .replace(/:\\d+$/, '');
const textoPublicado = [
  output.legenda,
  ...(Array.isArray(output.slides)
    ? output.slides.flatMap((slide) => [
        slide?.selo,
        slide?.titulo,
        slide?.destaque,
        slide?.texto,
        slide?.subtitulo,
      ])
    : []),
].map((valor) => String(valor || '')).join('\\n');
const linksExplicitos = [...new Set(
  (textoPublicado.match(/(?:https?:\\/\\/|www\\.)[^\\s<>"')\\]]+/gi) || []).map(hostDoToken),
)].filter(Boolean);
// dominio sem esquema ("aproveite em promo-falsa.com.br") — exige TLD conhecido pra nao confundir
// com numero ("1.999,00") nem com versao ("v1.5.0"). A lista inclui TLD de encurtador (ly, gd,
// to, me): o harness pegou que "bit.ly/xyz" passava batido, e encurtador e justamente o que
// alguem usaria pra esconder o destino. Remedido depois de ampliar: zero falso positivo nas
// legendas reais.
const dominiosSoltos = [...new Set(
  (textoPublicado.match(/\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:com\\.br|co\\.uk|com|net|org|io|gg|store|shop|link|xyz|top|site|online|ly|gd|to|me|app|dev|info|biz|vip|club|page|live|fun|icu)\\b/gi) || [])
    // mesma normalizacao dos explicitos (tira www., minusculas), senao "www.x.com" seria
    // reportado duas vezes: uma como link explicito e outra como dominio solto
    .map(hostDoToken),
)].filter((host) => host && !linksExplicitos.includes(host));
const linksNoTexto = [...new Set([...linksExplicitos, ...dominiosSoltos])];
const explicitosFora = linksExplicitos.filter((host) => !hostIn(host, hostsPermitidosNoTexto));
const soltosFora = dominiosSoltos.filter((host) => !hostIn(host, hostsPermitidosNoTexto));
const linksForaAllowlist = [...explicitosFora, ...soltosFora];
if (explicitosFora.length) {
  erros.push('Legenda/slides com link fora da allowlist: ' + explicitosFora.join(', '));
}
if (soltosFora.length) {
  erros.push('Legenda/slides citam dominio fora da allowlist: ' + soltosFora.join(', '));
}
// <<< LINK ALLOWLIST`;

// ⚠️ ÂNCORA REANCORADA: em 07/08 o trecho seguinte era `let ofertaAuditada = null;`. Hoje é a
// declaração de `fimDaPromocao` — um patch posterior entrou no meio. É exatamente assim que um
// patch escrito e não deployado apodrece.
const ANCORA_REGRA = `  erros.push('Legenda ausente, longa demais ou com Markdown');
}

function fimDaPromocao(texto) {`;

const NOVO_REGRA = `  erros.push('Legenda ausente, longa demais ou com Markdown');
}

${BLOCO}

function fimDaPromocao(texto) {`;

// O que foi barrado vai para a auditoria da peça: sem isso o alerta diz "reprovou" e não diz o quê.
const ANCORA_AUDIT = `      oferta: ofertaAuditada,
      erros,`;

const NOVO_AUDIT = `      oferta: ofertaAuditada,
      links_no_texto: linksNoTexto,
      links_fora_allowlist: linksForaAllowlist,
      erros,`;

const EDICOES = [
  { nome: 'regra de allowlist no texto publicado', de: ANCORA_REGRA, para: NOVO_REGRA },
  { nome: 'links barrados entram na auditoria', de: ANCORA_AUDIT, para: NOVO_AUDIT },
];

const MARCA = '>>> LINK ALLOWLIST';
const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, reverter) {
  let saida = lf(texto);
  if (!reverter && saida.includes(MARCA)) throw new Error(NO + ': já tem a allowlist — patch aplicado?');
  if (reverter && !saida.includes(MARCA)) throw new Error(NO + ': não tem a allowlist — nada a reverter');
  for (const e of (reverter ? [...EDICOES].reverse() : EDICOES)) {
    const de = lf(reverter ? e.para : e.de);
    const para = lf(reverter ? e.de : e.para);
    const vezes = saida.split(de).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${e.nome}" apareceu ${vezes} vezes (esperava 1)`);
    saida = saida.split(de).join(para);
  }
  return saida;
}

// O harness fatia o bloco entre as sentinelas e o executa — sem reimplementar a regra.
function extrairBloco(codigo) {
  const i = codigo.indexOf('// >>> LINK ALLOWLIST');
  const f = codigo.indexOf('// <<< LINK ALLOWLIST');
  if (i < 0 || f < 0) throw new Error('sentinelas da allowlist não encontradas');
  return codigo.slice(i, f + '// <<< LINK ALLOWLIST'.length);
}

module.exports = { WF, NO, EDICOES, aplicar, lf, MARCA, extrairBloco, BLOCO };

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
    const no = nodes.find((x) => x.name === NO);
    if (!no) throw new Error('nó não achado: ' + NO);
    const depois = aplicar(no.parameters.jsCode, REVERTER);
    try { new Function(depois); } catch (e) { throw new Error('jsCode resultante não compila: ' + e.message); }
    no.parameters.jsCode = depois;
    for (const e of EDICOES) console.log('OK  ' + e.nome);
    console.log('OK  jsCode compila');

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
          REVERTER ? 'Reverte a allowlist de link no texto publicado'
            : 'Seguranca: legenda e slides so citam link/dominio da allowlist', '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }

    fs.writeFileSync(path.join(__dirname, '..', 'newversion-link-allowlist.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
