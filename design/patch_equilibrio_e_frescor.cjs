// TRÊS CORREÇÕES DA REVISÃO PÓS-DEPLOY DE 15/09, NUM PATCH SÓ (um restart em vez de três).
//
// Contexto: os patches 52ab6c5f (reserva de primária) e 81c54175 (imagem do Blogger) subiram às
// 22:24 e 22:26 de 15/09. A revisão adversarial que veio depois achou três coisas. Duas são
// defeitos meus, introduzidos por aqueles patches; a terceira é limpeza.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// 1. `Preparar fila de curadoria` — O CURADOR FICOU SEM PAUTA BRASILEIRA. (defeito que EU criei)
//
// Este é o mais sério, e não estava previsto. O Curador de IA avalia só 5 candidatos, e a
// ordenação já existente põe primária na frente. Com 1 primária no lote isso era inofensivo. Com
// 6, as 5 vagas viram 5 primárias. Medido sobre os 440 itens reais da exec 601:
//
//   ANTES (sem reserva)      1 primária, 5 hosts: playstation, gamevicio, gameblast, gamevicio, adrenaline
//   COM O PATCH DE 22:24     5 primárias, 2 hosts: playstation, news.xbox, news.xbox, news.xbox, playstation
//
// Numa conta BRASILEIRA, isso desloca a pauta para anúncio internacional e ainda repete o mesmo
// host três vezes. Reduzir VAGAS_PRIMARIA não resolve: medido com 4 vagas, ainda dá 4 de 5.
//
// A correção age onde o problema está — na escolha dos 5, não na reserva dos 24:
//
//   teto/host  piso não-prim   composição dos 5
//   ---------  -------------   ----------------------------------------------------------
//       -           -          5 prim, 2 hosts   (o que está no ar agora)
//       2           -          4 prim, 3 hosts
//       -           2          3 prim, 4 hosts
//       2           2          3 prim, 4 hosts: playstation, news.xbox, news.xbox, gamevicio, gameblast
//
// Escolhido TETO 2 + PISO 2. Neste lote o teto não muda o resultado sozinho, mas protege a
// distribuição em dias com outra composição — custo zero aqui, seguro nos outros dias.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// 2. `Preparar candidatos` — A RESERVA PODIA PUXAR PRIMÁRIA DE 2016. (defeito que EU criei)
//
// A reserva percorre a lista ordenada por data e pega as 6 primeiras primárias. Não há piso de
// frescor. Medido no lote da exec 601:
//
//   241 primárias no total — mas só 10 com menos de 24 h e 14 com menos de 48 h
//   a primária MAIS ANTIGA do lote é de 2016-03-16 (nvidianews.nvidia.com)
//
// Hoje sobra folga (10 frescas para 6 vagas). Num fim de semana parado, não: a reserva desceria a
// lista e ocuparia vaga dos 24 com item de 2016 — justamente no dia em que o lote já está pobre.
// Não publicaria lixo (o Curador filtra por recência), mas queimaria vaga em silêncio.
//
// 48 h porque é o número que o resto do projeto já usa para frescor, e porque dá 14 candidatas
// para 6 vagas. A vaga que sobrar volta pro bolo geral: continua PISO, não cota.
//
// ⚠️ Item sem data legível fica FORA da reserva (idade Infinity). Ele ainda pode entrar pelo bolo
// geral — o que muda é que não ganha vaga PRIVILEGIADA sem ninguém saber a idade dele.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// 3. `Validar antes de publicar` — REMOVE `imagemUtilizavelAntiga`. (limpeza)
//
// O patch 81c54175 deixou a função original definida e nunca chamada — sobra da âncora. Não muda
// comportamento hoje (é código morto comprovado: nenhuma chamada no jsCode inteiro). Mas é a
// armadilha que já mordeu este projeto duas vezes: alguém edita a função "antiga" achando que
// está no ar, e a divergência não aparece em lugar nenhum.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// O QUE ESTE PATCH DELIBERADAMENTE **NÃO** FAZ, e por quê:
//
//  - NÃO conserta a contagem de variantes da mesma foto (`-2048x1365` vs `-scaled`,
//    `/s1920/` vs `/w640-h360/`). Contagem honesta faria `imagens_unicas` cair para 1 em peças que
//    hoje contam 2, e a regra de variedade pode REPROVAR com isso. É aperto de porta, não conserto
//    de bug — e o pedido era não criar problema novo. Fica para um patch próprio, com medição de
//    quantas peças passariam a reprovar.
//  - NÃO mexe nas datas erradas da NVIDIA (itens de 2016/2019). É bug de leitura de feed, em outro
//    ponto, e não foi medido.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';

const FRESCOR_RESERVA_H = 48;
const TETO_POR_HOST_IA = 2;
const PISO_NAO_PRIMARIA = 2;

// ───────────────────────────────────────────────────────── 1. equilíbrio dos 5 do Curador
const ANCORA_FILA = `const selected = [
  ...deterministic.slice(0, 3),
  ...aiCandidates.slice(0, Number(config.max_candidatos_ia || 5)),
];`;

const NOVO_FILA = `// EQUILÍBRIO DOS CANDIDATOS DE IA.
// Antes daqui era \`aiCandidates.slice(0, 5)\` sobre uma lista já ordenada com primária na frente.
// Isso era inofensivo enquanto o lote tinha 1 primária; depois da reserva de vagas (52ab6c5f) o
// lote passou a ter 6, e os 5 viravam 5 primárias em 2 hosts — conta brasileira recebendo só
// anúncio internacional, com o mesmo host repetido três vezes. Medido na exec 601.
const MAX_IA = Number(config.max_candidatos_ia || 5);
const TETO_POR_HOST_IA = ${TETO_POR_HOST_IA};
const PISO_NAO_PRIMARIA = ${PISO_NAO_PRIMARIA};

const hostDoCandidato = (c) =>
  String((c && c.noticia && c.noticia.dominio_fonte) || '').toLowerCase();
const ehPrimaria = (c) =>
  String((c && c.noticia && c.noticia.tipo_fonte) || '') === 'primaria';

const escolhidosIA = [];
const usoPorHostIA = Object.create(null);
const cabeNoHost = (c) => {
  const host = hostDoCandidato(c);
  return !host || (usoPorHostIA[host] || 0) < TETO_POR_HOST_IA;
};
const pegar = (c) => {
  const host = hostDoCandidato(c);
  if (host) usoPorHostIA[host] = (usoPorHostIA[host] || 0) + 1;
  escolhidosIA.push(c);
};

// 1ª passada: preenche na ordem de mérito, deixando PISO_NAO_PRIMARIA vagas guardadas.
const tetoDaPrimeiraPassada = Math.max(0, MAX_IA - PISO_NAO_PRIMARIA);
for (const candidato of aiCandidates) {
  if (escolhidosIA.length >= tetoDaPrimeiraPassada) break;
  if (!cabeNoHost(candidato)) continue;
  pegar(candidato);
}
// 2ª passada: as vagas guardadas só aceitam NÃO-primária — é o que garante pauta brasileira.
for (const candidato of aiCandidates) {
  if (escolhidosIA.length >= MAX_IA) break;
  if (escolhidosIA.includes(candidato)) continue;
  if (ehPrimaria(candidato)) continue;
  if (!cabeNoHost(candidato)) continue;
  pegar(candidato);
}
// 3ª passada: se não houver não-primária suficiente, completa com o que sobrou, IGNORANDO o teto.
// De propósito: melhor 5 candidatos com host repetido do que 3 candidatos. O piso é preferência,
// não obrigação — num dia em que só exista fonte primária, o Curador continua recebendo 5.
for (const candidato of aiCandidates) {
  if (escolhidosIA.length >= MAX_IA) break;
  if (escolhidosIA.includes(candidato)) continue;
  pegar(candidato);
}

const selected = [
  ...deterministic.slice(0, 3),
  ...escolhidosIA,
];`;

// ───────────────────────────────────────────────────────── 2. piso de frescor na reserva
const ANCORA_PREP = `const reservadas = [];
const usadosPorHost = Object.create(null);
for (const candidato of candidatos) {
  if (reservadas.length >= VAGAS_PRIMARIA) break;
  if (candidato.tipo_fonte !== 'primaria') continue;
  const host = hostnameFromUrl(candidato.url);
  if (!host) continue;`;

const NOVO_PREP = `// PISO DE FRESCOR NA RESERVA. Sem ele a reserva desce a lista inteira atrás de primária: o lote
// da exec 601 tinha 241 primárias, mas só 10 com menos de 24 h — e a mais antiga era de 2016-03-16
// (nvidianews). Num dia parado, a vaga privilegiada iria para notícia de 2016 sem ninguém ver.
// Item sem data legível dá Infinity e fica fora da reserva; ainda pode entrar pelo bolo geral.
const FRESCOR_RESERVA_H = ${FRESCOR_RESERVA_H};
const idadeEmHoras = (candidato) => {
  const t = Date.parse(String(candidato.publicado_em || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};

const reservadas = [];
const usadosPorHost = Object.create(null);
for (const candidato of candidatos) {
  if (reservadas.length >= VAGAS_PRIMARIA) break;
  if (candidato.tipo_fonte !== 'primaria') continue;
  if (idadeEmHoras(candidato) > FRESCOR_RESERVA_H) continue;
  const host = hostnameFromUrl(candidato.url);
  if (!host) continue;`;

// ───────────────────────────────────────────────────────── 3. remove a função morta
const ANCORA_VAL = `function imagemUtilizavelAntiga(imagem) {
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

const NOVO_VAL = `const urlUtilizavel = (url) => imagemUtilizavel(urlInfo(url));`;

const EDICOES = [
  { no: 'Preparar fila de curadoria', nome: 'equilíbrio dos 5 candidatos do Curador', de: ANCORA_FILA, para: NOVO_FILA, marca: 'PISO_NAO_PRIMARIA' },
  { no: 'Preparar candidatos', nome: 'piso de frescor na reserva de primária', de: ANCORA_PREP, para: NOVO_PREP, marca: 'FRESCOR_RESERVA_H' },
  { no: 'Validar antes de publicar', nome: 'remove imagemUtilizavelAntiga (código morto)', de: ANCORA_VAL, para: NOVO_VAL, marca: 'imagemUtilizavelAntiga', marcaInvertida: true },
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

module.exports = { WF, EDICOES, aplicar, lf, FRESCOR_RESERVA_H, TETO_POR_HOST_IA, PISO_NAO_PRIMARIA };

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

  // Uma passada de checagem ANTES de escrever qualquer coisa: as três âncoras têm que existir.
  // Sem isto, um patch parcial deixaria o workflow num estado que nenhum dos dois lados descreve.
  for (const edicao of EDICOES) {
    const no = nodes.find((x) => x.name === edicao.no);
    if (!no) throw new Error('nó não achado: ' + edicao.no);
    if (typeof no.parameters.jsCode !== 'string') throw new Error(`${edicao.no}: jsCode não é string`);
    aplicar(no.parameters.jsCode, edicao, REVERTER);   // só valida; descarta o resultado
  }

  for (const edicao of EDICOES) {
    const no = nodes.find((x) => x.name === edicao.no);
    const antes = no.parameters.jsCode;
    const depois = aplicar(antes, edicao, REVERTER);
    try { new Function(depois); } catch (e) {
      throw new Error(`${edicao.no}: jsCode resultante não compila: ${e.message}`);
    }
    no.parameters.jsCode = depois;
    const delta = depois.length - lf(antes).length;
    console.log(`OK  ${edicao.no.padEnd(28)} ${edicao.nome}  (${delta > 0 ? '+' : ''}${delta} bytes)`);
  }
  console.log(`OK  frescor da reserva ${FRESCOR_RESERVA_H}h · teto ${TETO_POR_HOST_IA}/host no Curador · piso ${PISO_NAO_PRIMARIA} não-primária`);
  console.log('OK  os 3 nós compilam');

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte equilibrio do Curador, frescor da reserva e limpeza'
    : 'Curador volta a ver pauta BR, reserva ganha piso de frescor, remove funcao morta';
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-equilibrio-frescor.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
