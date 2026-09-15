// IMAGEM DO BLOGGER DEIXA DE SER DESCARTADA EM SILÊNCIO.
//
// O QUE FOI MEDIDO EM 15/09/2026 (exec 598, primeira rodada depois de 26 dias de pausa).
// A execução terminou `success` sem produzir peça. O validador disse:
//
//   Esperava 6 imagens válidas (capa + 5 slides) e passaram 0
//   Nenhuma imagem válida
//
// O redator ENTREGOU as 6 URLs. HTTPS, terminando em .jpg, host blogger.googleusercontent.com.
// Elas morrem na PRIMEIRA linha de `imagemUtilizavel`:
//
//   if (hostIn(imagem.host, imagensBloqueadas)) return false;
//
// porque `dominiosBloqueados` traz 'googleusercontent.com' e `hostIn` casa por SUFIXO:
// 'blogger.googleusercontent.com'.endsWith('.googleusercontent.com') === true.
//
// A lista é de BUSCADORES E REDES SOCIAIS (google, bing, brave, instagram, facebook, tiktok,
// pinterest, x, twitter). A intenção era barrar imagem de resultado de busca. Só que
// googleusercontent.com é TAMBÉM a CDN do Blogger, e o GameBlast roda em Blogger — o próprio feed
// é .../feeds/posts/default?alt=rss, formato Blogger.
//
// RAIO MEDIDO (host dominante de imagem, por feed):
//   GameBlast    blogger.googleusercontent.com  150 de ~152   -> 100% BLOQUEADO
//   Flow Games   i.ytimg.com                    4             -> bloqueado, volume baixo
//   os outros 9  hosts próprios                               -> passam
// Um feed inteiro cego. Ele entrou em 12/08 pelo critério "% de itens com imagem": escolhido por
// ter imagem, e nenhuma delas jamais foi aceita.
//
// TRÊS MUDANÇAS, TRÊS DEFEITOS DIFERENTES:
//
//  1. EXCEÇÃO AO BLOQUEIO. blogger.googleusercontent.com é CDN de publisher, não de busca. Fica
//     liberado; o resto de googleusercontent.com (Google Fotos, lh3..., resultado de busca)
//     continua barrado. A exceção é por host EXATO, não por sufixo — 'x.googleusercontent.com'
//     inventado não passa.
//
//  2. DESCARTE DEIXA RASTRO. Hoje imagem morta pela lista de bloqueio não entra em balde nenhum:
//     `imagens_sem_relacao: []` e `imagens_baixa_resolucao: []` ficam vazios e a mensagem só diz
//     "passaram 0". Foi preciso abrir a execução no banco pra achar a causa. Passa a existir
//     `imagens_bloqueadas` no relatório, e o erro passa a nomear a causa.
//
//  3. THUMB DO BLOGGER VIRA ORIGINAL. A URL carrega o tamanho no caminho (/w640-h360/, /s680/,
//     /s72-w640-h360-c/). Trocar por /s0/ traz o original.
//     MEDIDO em 14 URLs reais do feed do GameBlast: 0 quebraram (todas HTTP 200).
//       - os 5 thumbs w640-h360: 52k->230k, 33k->109k, 52k->844k, 95k->270k, 84k->303k
//       - s680 e w320-h640: subiram
//       - MAS dois /s1920/ ficaram MENORES em bytes com /s0/ (342k->303k, 596k->274k)
//     Por isso a troca é CIRÚRGICA: só reescreve quando o segmento indica coisa pequena
//     (wNNN-hNNN, ou sNNN com NNN < 1200). Segmento grande fica como está. Reescrever tudo seria
//     regressão em 2 dos 14 casos medidos.
//
// FORA DE ESCOPO DE PROPÓSITO: ensinar `dimensaoNaUrl` a ler o tamanho do caminho do Blogger.
// Parece melhoria óbvia e é armadilha: em /sNNN/ o número é o LADO MAIOR, não largura×altura.
// Alimentar o gate com altura 0 reprovaria como "baixa resolução" toda imagem grande do Blogger.
// Depois da mudança 3 os thumbs viram /s0/ (sem dimensão na URL, igual à maioria), então o gate
// fica tão cego quanto já é em 76% dos casos — não mais cego do que antes.
//
// NÃO CONFUNDIR COM O PROBLEMA DE VARIEDADE. Na mesma peça o redator usou 2 fotos distintas para
// capa + 5 slides (/s1920/game pass.jpg e /w640-h360/game pass.jpg — o MESMO arquivo em dois
// tamanhos). Isso é oferta de imagem, não filtro, e este patch não trata disso.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Validar antes de publicar';

// Host EXATO liberado. Sufixo não: 'algo.blogger.googleusercontent.com' não é o Blogger.
const HOST_LIBERADO = 'blogger.googleusercontent.com';
// Abaixo disto o segmento é considerado thumb e vale trocar por /s0/. 1200 porque o gate de
// baixa resolução já reprova abaixo de 900 de largura, e /s1200/ com proporção 16:9 dá 675 de
// altura — acima do piso de 500. Escolhido com folga, não no limite.
const LADO_MIN_ORIGINAL = 1200;

// ---------------------------------------------------------------------------- MUDANÇA 1 + 2
const ANCORA_A = `function imagemUtilizavel(imagem) {
  if (!imagem || !imagem.url) return false;
  if (hostIn(imagem.host, imagensBloqueadas)) return false;`;

const NOVO_A = `// blogger.googleusercontent.com é a CDN do BLOGGER (o GameBlast roda nele), não a do Google
// Imagens. Ela casa com 'googleusercontent.com' por sufixo e morria aqui — 150 de ~152 imagens
// daquele feed, em silêncio. Liberada por host EXATO; lh3.googleusercontent.com e afins seguem
// bloqueados. Medido na exec 598 (15/09/2026).
const hostsImagemLiberados = ['${HOST_LIBERADO}'];
// Motivo do descarte em vez de um booleano: sem isto, imagem morta pela lista de bloqueio não
// deixa rastro nenhum no relatório e "passaram 0" não diz a causa.
function motivoDescarteImagem(imagem) {
  if (!imagem || !imagem.url) return 'sem URL utilizável';
  if (!hostsImagemLiberados.includes(imagem.host)
      && hostIn(imagem.host, imagensBloqueadas)) return 'host bloqueado';
  const caminho = imagem.url.split(/[?#]/)[0].toLowerCase();
  if (/\\.(?:html?|php|asp|aspx)$/.test(caminho)) return 'é página, não imagem';
  if (/\\/(?:search|busca)(?:\\/|$)/.test(caminho)) return 'veio de busca';
  if (!(pareceImagemUrl(imagem.url) || hostIn(imagem.host, hostsImagemConhecidos))) {
    return 'não parece URL de imagem';
  }
  return null;
}
function imagemUtilizavel(imagem) {
  return motivoDescarteImagem(imagem) === null;
}
function imagemUtilizavelAntiga(imagem) {
  if (!imagem || !imagem.url) return false;
  if (hostIn(imagem.host, imagensBloqueadas)) return false;`;

// ---------------------------------------------------------------------------- MUDANÇA 3
const ANCORA_B = `const imagemCapa = urlInfo(output.capa);
const imagens = [
  output.capa,
  ...(Array.isArray(output.slides)
    ? output.slides.map((slide) => slide?.imagem)
    : []),
].map(urlInfo);`;

const NOVO_B = `// O Blogger carrega o tamanho no CAMINHO (/w640-h360/, /s680/, /s72-w640-h360-c/). Trocar o
// segmento por /s0/ devolve o original. Medido em 14 URLs reais do feed do GameBlast: 0 quebram,
// e os 5 thumbs w640-h360 subiram de 52k para 230k, de 33k para 109k, de 52k para 844k.
// Só troca quando o segmento indica coisa PEQUENA: dois /s1920/ medidos ficaram MENORES com /s0/,
// então reescrever tudo seria regressão. Reescreve o próprio \`output\`, que é o que segue para o
// renderizador — trocar só na cópia da validação deixaria a peça renderizando o thumb.
const RE_TAMANHO_BLOGGER = /\\/(s\\d+(?:-[a-z0-9-]+)*|w\\d+-h\\d+(?:-[a-z0-9-]+)*)\\/([^/]+)$/i;
function blateralMaximo(segmento) {
  const numeros = String(segmento).match(/\\d+/g) || [];
  return numeros.reduce((maior, n) => Math.max(maior, Number(n)), 0);
}
function originalDoBlogger(url) {
  const bruta = String(url || '');
  if (!/^https:\\/\\/blogger\\.googleusercontent\\.com\\//i.test(bruta)) return bruta;
  const caminho = bruta.split(/[?#]/)[0];
  const casou = caminho.match(RE_TAMANHO_BLOGGER);
  if (!casou) return bruta;
  if (blateralMaximo(casou[1]) >= ${LADO_MIN_ORIGINAL}) return bruta;
  return caminho.replace(RE_TAMANHO_BLOGGER, '/s0/$2');
}
if (typeof output.capa === 'string') output.capa = originalDoBlogger(output.capa);
if (Array.isArray(output.slides)) {
  output.slides.forEach((slide) => {
    if (slide && typeof slide.imagem === 'string') {
      slide.imagem = originalDoBlogger(slide.imagem);
    }
  });
}
const imagemCapa = urlInfo(output.capa);
const imagens = [
  output.capa,
  ...(Array.isArray(output.slides)
    ? output.slides.map((slide) => slide?.imagem)
    : []),
].map(urlInfo);`;

// ---------------------------------------------------------------------------- MUDANÇA 2 (baldes)
const ANCORA_C = `const imagensBaixaResolucao = imagensAuditadas.filter(
  (imagem) => imagem.baixa_resolucao,
);`;

const NOVO_C = `const imagensBaixaResolucao = imagensAuditadas.filter(
  (imagem) => imagem.baixa_resolucao,
);
// Balde que faltava: imagem que o filtro matou antes de qualquer auditoria. Sem ele o relatório
// mostra os dois outros baldes vazios e ninguém descobre a causa sem abrir a execução no banco.
const imagensBloqueadasDetalhe = imagens
  .map((imagem) => ({ imagem, motivo: motivoDescarteImagem(imagem) }))
  .filter((x) => x.motivo !== null)
  .map((x) => ({
    url: (x.imagem && x.imagem.url) || '',
    host: (x.imagem && x.imagem.host) || '',
    motivo: x.motivo,
  }));`;

// ---------------------------------------------------------------------------- MUDANÇA 2 (erro)
const ANCORA_D = `if (urlsImagens.length === 0) {
  erros.push('Nenhuma imagem válida');
}`;

const NOVO_D = `if (urlsImagens.length === 0) {
  erros.push(
    imagensBloqueadasDetalhe.length
      ? 'Nenhuma imagem válida -> ' + imagensBloqueadasDetalhe
        .map((x) => (x.host || '(sem host)') + ': ' + x.motivo)
        .filter((texto, i, todas) => todas.indexOf(texto) === i)
        .join('; ')
      : 'Nenhuma imagem válida',
  );
}`;

// ---------------------------------------------------------------------------- MUDANÇA 2 (relatório)
const ANCORA_E = `      imagens_sem_relacao: imagensSemRelacao,
      imagens_baixa_resolucao: imagensBaixaResolucao,`;

const NOVO_E = `      imagens_sem_relacao: imagensSemRelacao,
      imagens_baixa_resolucao: imagensBaixaResolucao,
      imagens_bloqueadas: imagensBloqueadasDetalhe,`;

const TROCAS = [
  { nome: 'exceção do Blogger + motivo do descarte', de: ANCORA_A, para: NOVO_A },
  { nome: 'thumb do Blogger vira original', de: ANCORA_B, para: NOVO_B },
  { nome: 'balde imagens_bloqueadas', de: ANCORA_C, para: NOVO_C },
  { nome: 'erro nomeia a causa', de: ANCORA_D, para: NOVO_D },
  { nome: 'relatório expõe o balde', de: ANCORA_E, para: NOVO_E },
];

const lf = (s) => String(s).split('\r\n').join('\n');
const MARCA = 'motivoDescarteImagem';

function trocar(texto) {
  let saida = lf(texto);
  if (saida.includes(MARCA)) throw new Error(`${NO}: jsCode já tem a mudança — patch já aplicado?`);
  for (const t of TROCAS) {
    const vezes = saida.split(lf(t.de)).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(lf(t.de)).join(lf(t.para));
  }
  return saida;
}

function destrocar(texto) {
  let saida = lf(texto);
  if (!saida.includes(MARCA)) throw new Error(`${NO}: jsCode não tem a mudança — nada a reverter`);
  for (const t of [...TROCAS].reverse()) {
    const vezes = saida.split(lf(t.para)).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora invertida "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(lf(t.para)).join(lf(t.de));
  }
  return saida;
}

module.exports = {
  WF, NO, TROCAS, MARCA, trocar, destrocar, lf, HOST_LIBERADO, LADO_MIN_ORIGINAL,
};

if (require.main !== module) return;

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
  const no = nodes.find((x) => x.name === NO);
  if (!no) throw new Error('nó não achado: ' + NO);
  const antes = no.parameters.jsCode;
  if (typeof antes !== 'string') throw new Error(`${NO}: jsCode não é string`);

  const depois = REVERTER ? destrocar(antes) : trocar(antes);
  // o código tem que compilar — jsCode quebrado só aparece na próxima execução, tarde demais
  try { new Function(depois); } catch (e) { throw new Error('jsCode resultante não compila: ' + e.message); }
  no.parameters.jsCode = depois;

  const delta = depois.length - lf(antes).length;
  for (const t of TROCAS) console.log(`OK  mudança: ${t.nome}`);
  console.log(`OK  jsCode: ${lf(antes).length} -> ${depois.length} bytes (${delta > 0 ? '+' : ''}${delta})`);
  console.log(`OK  compila`);

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte a liberacao da imagem do Blogger'
    : 'Imagem do Blogger deixa de ser descartada em silencio (GameBlast estava 100% cego)';
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-imagem-blogger.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
