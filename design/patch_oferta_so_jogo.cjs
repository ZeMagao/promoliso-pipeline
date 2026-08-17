// OFERTA passa a valer só para JOGO. Promoção de produto físico deixa de ser pauta.
//
// PEDIDO DO DONO (16/08/2026), depois de ver no ar: "fez um post de um monitor em promoção e eu não
// gostei, aí as promos de games assim pode deixar, só de produtos que não".
//
// O que estava saindo, medido em promoliso_publicacoes:
//   16/08  OFERTA  Monitor LG UltraGear 24G411A-B com preço reduzido
//   12/08  OFERTA  AMD Ryzen 9 9950X3D com 15% de desconto na Amazon Brasil
//
// A REGRA, deterministica: a URL da oferta tem de ser de uma LOJA DE JOGO. A lista de lojas que já
// existia no validador se separa em dois grupos sem esforço nenhum:
//   eletrônico  amazon, kabum, magazineluiza, mercadolivre, terabyteshop, pichau
//   jogo        steam, epic, playstation, xbox, nintendo, gog, nuuvem, greenmangaming
// Promoção com URL de loja de eletrônico reprova com mensagem própria, em vez de virar post.
//
// POR QUE PELA LOJA e não por palavra no título: "monitor", "teclado" e "placa de vídeo" numa lista
// de palavras proibidas erra nos dois sentidos — barra "Steam Deck" e passa "cadeira gamer com 40%
// off na Kabum". A loja é o sinal que não depende de redação.
//
// O QUE CONTINUA VALENDO: notícia de hardware segue sendo pauta (o post de maior alcance da W33 foi
// a crise de memória RAM). O corte é só na promoção de produto — categoria OFERTA.
//
// FICA PASSANDO DE PROPÓSITO: promoção de acessório vendido pela própria fabricante do console
// (um DualSense na PlayStation Store, por exemplo). É hardware, mas é hardware de jogo, e a loja
// diz isso. Se incomodar, o ajuste é tirar playstation/xbox/nintendo da lista de jogo — está a uma
// linha daqui.
//
// DUAS METADES no mesmo patch, que é a lição de 05/08: validador e prompt precisam dizer a mesma
// coisa, senão o agente escreve o que o validador vai recusar e a rodada morre por desencontro.
//
// ROLLBACK: pelo backup do deploy-vps.sh / workflow_history.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO_VALIDADOR = 'Validar antes de publicar';
const NO_AGENTE = 'AI Agent';

const LISTA_ANTIGA = `const dominiosLojas = [
  'amazon.com.br',
  'kabum.com.br',
  'magazineluiza.com.br',
  'mercadolivre.com.br',
  'terabyteshop.com.br',
  'pichau.com.br',
  'nuuvem.com',
  'greenmangaming.com',
  'gog.com',
  'steampowered.com',
  'playstation.com',
  'xbox.com',
  'nintendo.com',
  'epicgames.com',
];`;

const LISTA_NOVA = `// Loja de eletrônico: vende produto físico. Promoção daqui NÃO é pauta desta conta (pedido do
// dono em 16/08, depois de um post de monitor em promoção). Continuam na lista porque a URL ainda
// precisa ser reconhecida como loja — o que muda é o veredito, não o reconhecimento.
const lojasDeEletronicos = [
  'amazon.com.br',
  'kabum.com.br',
  'magazineluiza.com.br',
  'mercadolivre.com.br',
  'terabyteshop.com.br',
  'pichau.com.br',
];
// Loja de jogo: é daqui que sai promoção publicável.
const lojasDeJogos = [
  'nuuvem.com',
  'greenmangaming.com',
  'gog.com',
  'steampowered.com',
  'playstation.com',
  'xbox.com',
  'nintendo.com',
  'epicgames.com',
];
// União: quem só precisa saber "isto é uma loja?" continua usando esta.
const dominiosLojas = [...lojasDeEletronicos, ...lojasDeJogos];`;

const DE_GATE = `  // vale para as duas formas: é o que separa promoção de matéria FALANDO de promoção
  if (!urlOferta || !hostIn(urlOferta.host, dominiosLojas)) {
    erros.push('Oferta sem URL direta de uma loja conhecida');
  }`;

const PARA_GATE = `  // vale para as duas formas: é o que separa promoção de matéria FALANDO de promoção
  if (!urlOferta || !hostIn(urlOferta.host, dominiosLojas)) {
    erros.push('Oferta sem URL direta de uma loja conhecida');
  } else if (hostIn(urlOferta.host, lojasDeEletronicos)) {
    // Promoção de produto físico não é pauta desta conta. Notícia de hardware continua sendo —
    // o corte é só em OFERTA. Mensagem própria para o alerta não virar caça ao fantasma.
    erros.push('Promoção de produto físico não é pauta: ' + urlOferta.host + ' é loja de eletrônico, e OFERTA aqui é só de jogo');
  }`;

const PROMPT_TROCAS = [
  {
    nome: 'regra das duas formas',
    de: '- Use tipo "produto" quando a pauta for UM produto com preço: console, placa de vídeo, um jogo específico.',
    para: '- Use tipo "produto" quando a pauta for UM JOGO com preço, numa loja de jogos (Steam, Epic, PS Store, Xbox, Nintendo, GOG, Nuuvem, Green Man Gaming).\n'
      + '- NÃO existe OFERTA de produto físico nesta conta: monitor, teclado, mouse, cadeira, placa de vídeo, processador, memória, SSD, notebook e console em promoção NÃO são pauta, mesmo com desconto enorme. Promoção em Amazon, Kabum, Magazine Luiza, Mercado Livre, Terabyte ou Pichau é sempre recusada pelo fluxo — não gaste a rodada com ela.\n'
      + '- Hardware continua sendo pauta como NOTICIA ou ALERTA (lançamento, crise de preço, análise). O que saiu foi a PROMOÇÃO de produto físico, não o assunto hardware.',
  },
];

const semCabecalho = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

function trocarValidador(code) {
  const lf = String(code).split('\r\n').join('\n');
  if (lf.includes('lojasDeEletronicos')) throw new Error(`${NO_VALIDADOR}: já separa as lojas — patch já aplicado?`);
  for (const [de, quem] of [[LISTA_ANTIGA, 'lista de lojas'], [DE_GATE, 'gate da URL de oferta']]) {
    const vezes = lf.split(de).length - 1;
    if (vezes !== 1) throw new Error(`${NO_VALIDADOR}: ${quem} apareceu ${vezes} vezes — abortando`);
  }
  const novo = lf.split(LISTA_ANTIGA).join(LISTA_NOVA).split(DE_GATE).join(PARA_GATE);
  // nada do que já existia pode ter se perdido
  for (const marca of ['tipoOferta', 'fimDaPromocao', 'Evento promocional sem loja', 'Preço atual inválido',
    'Oferta sem todos os dados obrigatórios', 'dominiosLojas']) {
    if (!novo.includes(marca)) throw new Error(`${NO_VALIDADOR}: perdi "${marca}" — abortando`);
  }
  new Function(novo);
  return novo;
}

function trocarPrompt(texto) {
  if (texto.includes('NÃO existe OFERTA de produto físico')) throw new Error(`${NO_AGENTE}: prompt já corta produto físico — patch já aplicado?`);
  let saida = texto;
  for (const t of PROMPT_TROCAS) {
    const vezes = saida.split(t.de).length - 1;
    if (vezes !== 1) throw new Error(`${NO_AGENTE}: âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.de).join(t.para);
  }
  return saida;
}

module.exports = { WF, NO_VALIDADOR, NO_AGENTE, LISTA_ANTIGA, LISTA_NOVA, DE_GATE, PARA_GATE, trocarValidador, trocarPrompt };

if (require.main !== module) return;

const sqlite3 = require('sqlite3');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node ' + path.posix.join('design', path.basename(__filename)) + ' --dry');
  process.exit(1);
}
const DRY = process.argv.includes('--dry');
const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const val = nodes.find((x) => x.name === NO_VALIDADOR);
  if (!val) throw new Error('nó não achado: ' + NO_VALIDADOR);
  val.parameters.jsCode = trocarValidador(val.parameters.jsCode);
  console.log(`OK  ${NO_VALIDADOR}  (OFERTA só de loja de jogo)`);

  const ag = nodes.find((x) => x.name === NO_AGENTE);
  if (!ag) throw new Error('nó não achado: ' + NO_AGENTE);
  ag.parameters.options.systemMessage = trocarPrompt(String(ag.parameters.options.systemMessage || ''));
  console.log(`OK  ${NO_AGENTE}  (prompt avisa que promoção de produto físico não é pauta)`);

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'OFERTA so de loja de jogo: promocao de produto fisico deixa de ser pauta', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-oferta-so-jogo.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
