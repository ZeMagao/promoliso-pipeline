// PUBLICADOR: STORY GANHA RETRY E PEÇA SEM IMAGEM PARA DE TRAVAR A FILA (02/10/2026).
//
// O QUE FOI MEDIDO ANTES (02/10, no VPS). O carrossel está saudável: 36 publicações seguidas desde
// 17/09, e nas 17 execuções que o banco ainda guarda o retry do carrossel NUNCA disparou (cada
// filho leva ~10 s; um retry somaria ~65 s e não aparece). O que falha hoje é outra coisa:
//
//   exec 780 (29/09 12:31 BRT)  Create a story -> {"error":"Bad request - please check your parameters"}
//
// O post saiu, a story não, e ninguém soube: o nó está em `continueRegularOutput` e SEM retry. O log
// do promo-cdn mostra que o Meta nem chegou a pedir a imagem da story — recusou antes de buscar.
// 1 de 17 (~6%) bate com a taxa de falha passageira do Meta medida em 17/09 (17/18 por imagem).
//
// DUAS MUDANÇAS, NENHUMA MEXE EM CONEXÃO (cirurgia de conexão foi o que derrubou a publicação por
// 3 dias em 05/08):
//
//  1. `Create a story` ganha retry 3× com 5 s — exatamente o que `Publish a post` e os
//     `Carrossel NN` têm desde 13/08. O retry funciona com `continueRegularOutput`: o motor do n8n
//     repete enquanto o item sair com `json.error` (`checkFailure` em n8n-core
//     workflow-execute.js), e é assim que o nó do Instagram devolve a falha.
//     `onError` NÃO muda: story que falha 3× continua sem derrubar o post, que já saiu.
//     Risco aceito: se o Meta publicar a story e mesmo assim devolver erro no `media_publish`, a
//     2ª tentativa duplica a story. O caso medido (780) falhou na CRIAÇÃO do contêiner, onde
//     repetir é inofensivo.
//
//  2. `Selecionar READY` tira da disputa a peça com menos de 2 imagens https, ANTES de escolher.
//     Hoje ela era escolhida e o nó lançava erro antes do `Marcar PUBLISHING`: a row continuava
//     READY, ganhava de novo no slot seguinte e travava TODOS os slots enquanto fosse a melhor da
//     fila. Medido: nenhuma peça da fila tem menos de 4 imagens hoje — a escolha não muda em nada,
//     é porta fechada. O aviso de que essa peça existe sai do promo-vigia.
//
// O QUE NÃO MUDA: ramos A/B/C, nota, frescor, saída do Switch, URLs do host próprio, legenda,
// devolução para a fila, alerta. As âncoras do patch do host próprio (`const usadas = ...` e a
// linha do `story_url`) não são tocadas, então o `test_cdn_publicador` segue revertendo o dele.
//
// ROLLBACK: `--reverter` devolve o jsCode byte a byte e tira as 3 chaves de retry da story.
// Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'E27F7yVdsZRj';
const NO_SELECIONAR = 'Selecionar READY';
const NO_STORY = 'Create a story';
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

// ───────────────────────────────────────────── Selecionar READY: peça sem imagem sai da disputa
const EDICOES = [
  {
    nome: 'publicáveis viram candidatas (o filtro de imagem vem depois)',
    de: `const ready = rows.filter(r=>PUBLICAVEIS.includes(String(r.status||'').toUpperCase()));
if(!ready.length) return [];`,
    para: `const candidatas = rows.filter(r=>PUBLICAVEIS.includes(String(r.status||'').toUpperCase()));
if(!candidatas.length) return [];`,
  },
  {
    nome: 'peça com menos de 2 imagens sai antes da escolha',
    de: `const MIN_IMAGENS = 2;
const MAX_IMAGENS = 10;
`,
    para: `const MIN_IMAGENS = 2;
const MAX_IMAGENS = 10;
// Só url https serve: é o Instagram que baixa a imagem, e um item quebrado no meio da coleção
// fazia o filho nascer sem image_url. Medido nas 61 rows da fila: nenhuma perde imagem por
// causa deste filtro — ele não muda nada hoje, só fecha a porta.
const validasDe = (row) => {
  let urls=[]; try{ urls=JSON.parse(row.carousel_urls||'[]'); }catch(e){ urls=[]; }
  if(!Array.isArray(urls)) urls=[];
  return urls.filter((u) => typeof u === 'string' && /^https:\\/\\//.test(u));
};
// PEÇA SEM IMAGEM NÃO ENTRA NA DISPUTA (02/10). Antes ela era escolhida e o nó lançava erro
// ANTES do "Marcar PUBLISHING": a row seguia READY, ganhava de novo no slot seguinte e travava
// TODOS os slots enquanto fosse a melhor da fila. Agora ela fica de fora e a próxima publica;
// quem avisa que ela existe é o promo-vigia ("peça fresca com menos de 2 imagens").
const ready = candidatas.filter((row) => validasDe(row).length >= MIN_IMAGENS);
if(!ready.length) return [];
`,
  },
  {
    nome: 'a escolhida usa a mesma regra de imagem válida',
    de: `const r = fila[0];
let urls=[]; try{ urls=JSON.parse(r.carousel_urls||'[]'); }catch(e){ urls=[]; }
if(!Array.isArray(urls)) urls=[];
// Só url https serve: é o Instagram que baixa a imagem, e um item quebrado no meio da coleção
// fazia o filho nascer sem image_url. Medido nas 61 rows da fila: nenhuma perde imagem por
// causa deste filtro — ele não muda nada hoje, só fecha a porta.
const validas = urls.filter((u) => typeof u === 'string' && /^https:\\/\\//.test(u));
if(validas.length < MIN_IMAGENS) throw new Error('carousel_urls insuficiente: '+r.carousel_urls);`,
    para: `const r = fila[0];
const validas = validasDe(r);
// Inalcançável depois do filtro acima; fica como trava se alguém mexer nele.
if(validas.length < MIN_IMAGENS) throw new Error('carousel_urls insuficiente: '+r.carousel_urls);`,
  },
];
const MARCA = 'const ready = candidatas.filter(';

const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, edicao, reverter) {
  const saida = lf(texto);
  const de = lf(reverter ? edicao.para : edicao.de);
  const para = lf(reverter ? edicao.de : edicao.para);
  const vezes = saida.split(de).length - 1;
  if (vezes !== 1) {
    throw new Error(`${NO_SELECIONAR}: âncora "${edicao.nome}" apareceu ${vezes} vezes `
      + '(esperava 1) — patch já aplicado, ou o nó mudou');
  }
  return saida.split(de).join(para);
}

function aplicarCodigo(texto, reverter) {
  const ordem = reverter ? EDICOES.slice().reverse() : EDICOES;
  return ordem.reduce((acc, edicao) => aplicar(acc, edicao, reverter), texto);
}

// ───────────────────────────────────────────── Create a story: retry 3×5s
function aplicarStory(nodes, reverter) {
  const no = nodes.find((n) => n.name === NO_STORY);
  if (!no) throw new Error('nó não achado: ' + NO_STORY);
  if (!/instagram/i.test(String(no.type))) throw new Error(`${NO_STORY}: não é nó do Instagram (${no.type})`);
  const onErrorAntes = no.onError;
  if (reverter) {
    if (no.retryOnFail !== true) throw new Error(`${NO_STORY}: não tem retry — nada a reverter`);
    for (const k of Object.keys(RETRY)) delete no[k];
  } else {
    if (no.retryOnFail === true) throw new Error(`${NO_STORY}: já tem retry — patch já aplicado?`);
    if (no.onError !== 'continueRegularOutput') {
      throw new Error(`${NO_STORY}: onError é "${no.onError}", esperava continueRegularOutput — revisar antes`);
    }
    Object.assign(no, RETRY);
  }
  // story que falha não pode passar a derrubar o post, que já saiu
  if (no.onError !== onErrorAntes) throw new Error(`${NO_STORY}: onError mudou — abortando`);
  return no;
}

function aplicarTudo(nodes, reverter) {
  const sel = nodes.find((n) => n.name === NO_SELECIONAR);
  if (!sel) throw new Error('nó não achado: ' + NO_SELECIONAR);
  if (typeof sel.parameters.jsCode !== 'string') throw new Error(`${NO_SELECIONAR}: jsCode não é string`);
  const depois = aplicarCodigo(sel.parameters.jsCode, reverter);
  try { new Function('$input', depois); } catch (e) {
    throw new Error(`${NO_SELECIONAR}: jsCode resultante não compila: ${e.message}`);
  }
  sel.parameters.jsCode = depois;
  aplicarStory(nodes, reverter);
  return nodes;
}

module.exports = { WF, NO_SELECIONAR, NO_STORY, RETRY, EDICOES, MARCA, lf, aplicarCodigo, aplicarStory, aplicarTudo };

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
    const antes = JSON.stringify(nodes.map((n) => n.name).sort());
    aplicarTudo(nodes, REVERTER);
    // nenhum nó entra nem sai: este patch não toca a topologia
    if (JSON.stringify(nodes.map((n) => n.name).sort()) !== antes) throw new Error('lista de nós mudou — abortando');
    for (const e of EDICOES) console.log(`OK  ${NO_SELECIONAR}: ${e.nome}`);
    const st = nodes.find((n) => n.name === NO_STORY);
    console.log(`OK  ${NO_STORY}: retryOnFail=${st.retryOnFail} maxTries=${st.maxTries} waitBetweenTries=${st.waitBetweenTries} onError=${st.onError}`);
    console.log('OK  conexões intocadas (o patch não lê nem grava `connections`)');

    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER
      ? 'Reverte: story sem retry; peca sem imagem volta a ser escolhida'
      : 'Story ganha retry 3x5s; peca com menos de 2 imagens sai da disputa em vez de travar a fila';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }

    fs.writeFileSync(path.join(__dirname, '..', 'newversion-publicador-robustez.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
