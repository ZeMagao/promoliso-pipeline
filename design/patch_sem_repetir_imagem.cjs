// SEM FOTO REPETIDA: o número de slides passa a caber nas fotos distintas (17/09/2026, noite).
//
// O PEDIDO, LITERAL: "esse último post do Gears pegou a mesma imagem nas 5. Eu não quero isso."
// E, na sequência, a decisão sobre as pautas onde nem a Steam tem foto (hardware, promoção, leva
// de Game Pass): **menos slides, sem repetir**.
//
// ⚠️ ISTO INVERTE UMA DECISÃO ANTERIOR, e é bom que fique escrito. O patch 80288ef colocou no
// prompt, com todas as letras, que "conteúdo vem primeiro; não repetir é preferência, não regra"
// e "NUNCA corte um fato relevante só para evitar repetição". O dono reviu essa troca hoje,
// olhando o resultado publicado. Quem decide estética aqui é ele; o texto abaixo passa a dizer o
// contrário do que dizia, de propósito.
//
// A REGRA NOVA: slides = MENOR entre (fatos que a matéria sustenta) e (fotos distintas). Piso de
// 3, que é o mínimo do carrossel, do validador e da faixa 3–7 que o produtor faz desde 20/08.
// Abaixo de 3 fotos distintas a repetição volta a ser permitida — não há alternativa: 2 slides
// não é carrossel.
//
// O QUE ISSO CUSTA, medido na peça 71 (exec 601): com 2 fotos distintas, a peça ia de 6 slots
// (cada foto 3×) para 3 slides com uma repetição. Numa pauta de fonte primária não muda nada —
// PlayStation entrega 8,1 imagens por item e Xbox 9,2, medido. E, desde hoje, pauta com jogo
// identificável ganha até 8 fotos oficiais da Steam por cima disso (patch b990d5f2), então o
// caso "3 slides" ficou bem mais raro do que era em 15/09.
//
// DUAS CÓPIAS DA MESMA REGRA, as duas trocadas aqui: a seção de campos visuais (linha 54) e a do
// candidato aprovado (linha 277). Divergir as duas é como o projeto já se enganou antes — o teto
// de nota morava em dois lugares e zerou a pauta quando um lado mudou sozinho.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'AI Agent';
const MIN_SLIDES = 3;

// ───────────────────────────────────────────── cópia 1: campos visuais de cada slide
const ANCORA_A = 'Mas NUNCA corte um fato relevante só para evitar repetição: se a matéria sustenta o slide, o slide existe, e aí repita a imagem de melhor enquadramento. Conteúdo vem primeiro; não repetir é preferência, não regra.';

const NOVO_A = 'NÃO repita: o número de slides é o MENOR entre o que a matéria sustenta e quantas '
  + 'imagens DISTINTAS você recebeu. Com 4 imagens distintas, no máximo 4 slides — corte o fato '
  + 'mais fraco, não a variedade. Só abaixo de ' + MIN_SLIDES + ' imagens distintas a repetição é '
  + 'permitida, porque ' + MIN_SLIDES + ' é o mínimo do carrossel; aí repita a de melhor '
  + 'enquadramento.';

// ───────────────────────────────────────────── cópia 2: seção do candidato aprovado
const ANCORA_B = 'Se houver menos imagens oficiais que slides, reutilize as disponíveis em vez de reprovar a pauta ou inventar URLs — e prefira a de melhor enquadramento na repetição. Nunca remova um slide que a matéria sustenta só porque faltou imagem.';

const NOVO_B = 'Se houver menos imagens oficiais que slides, REDUZA O NÚMERO DE SLIDES até caber '
  + 'uma imagem distinta por slide — nunca reprove a pauta por isso e nunca invente URLs. O piso é '
  + MIN_SLIDES + ' slides: com menos de ' + MIN_SLIDES + ' imagens distintas, e só aí, repita a de '
  + 'melhor enquadramento.';

const TROCAS = [
  { nome: 'campos visuais: slides cabem nas fotos distintas', de: ANCORA_A, para: NOVO_A },
  { nome: 'candidato aprovado: reduzir slides em vez de repetir', de: ANCORA_B, para: NOVO_B },
];

const MARCA = 'NÃO repita: o número de slides é o MENOR';
const lf = (s) => String(s).split('\r\n').join('\n');

function trocar(texto, reverter) {
  let saida = lf(texto);
  if (!reverter && saida.includes(MARCA)) throw new Error(`${NO}: o prompt já tem a regra — patch já aplicado?`);
  if (reverter && !saida.includes(MARCA)) throw new Error(`${NO}: o prompt não tem a regra — nada a reverter`);
  const ordem = reverter ? [...TROCAS].reverse() : TROCAS;
  for (const t of ordem) {
    const de = lf(reverter ? t.para : t.de);
    const para = lf(reverter ? t.de : t.para);
    const vezes = saida.split(de).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${t.nome}" apareceu ${vezes} vezes (esperava 1) — o prompt mudou`);
    saida = saida.split(de).join(para);
  }
  return saida;
}

module.exports = { WF, NO, TROCAS, trocar, lf, MIN_SLIDES, MARCA };

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
    const no = nodes.find((x) => x.name === NO);
    if (!no) throw new Error('nó não achado: ' + NO);

    // ⚠️ O prompt NÃO está em parameters.text. Medido no banco: `text` tem 3507 caracteres (a
    // instrução da rodada) e o prompt de sistema, com 20793, vive em `options.systemMessage`.
    // Escolher o campo pelo NOME fez o patch abortar dizendo que "o prompt mudou"; por isso aqui
    // o campo é escolhido pelo CONTEÚDO — quem tiver a âncora é o certo, hoje e depois.
    const marcaDoCampo = REVERTER ? MARCA : TROCAS[0].de;
    const candidatos = [
      ['text', no.parameters.text],
      ['options.systemMessage', no.parameters.options && no.parameters.options.systemMessage],
    ].filter(([, v]) => typeof v === 'string' && v.includes(marcaDoCampo));
    if (candidatos.length !== 1) {
      throw new Error('esperava exatamente 1 campo com o prompt e achei ' + candidatos.length
        + ' — conferir o nó no editor antes de insistir');
    }
    const [campo, antes] = candidatos[0];
    const depois = trocar(antes, REVERTER);
    if (campo === 'text') no.parameters.text = depois;
    else no.parameters.options.systemMessage = depois;
    console.log('OK  campo do prompt: ' + campo);
    for (const t of TROCAS) console.log(`OK  ${t.nome}`);
    console.log(`OK  piso de ${MIN_SLIDES} slides preservado  (${depois.length - lf(antes).length > 0 ? '+' : ''}${depois.length - lf(antes).length} bytes)`);

    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER
      ? 'Reverte: volta a permitir imagem repetida para manter slides'
      : 'Slides cabem nas fotos distintas: peca deixa de repetir imagem';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }

    fs.writeFileSync(path.join(__dirname, '..', 'newversion-sem-repetir.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
