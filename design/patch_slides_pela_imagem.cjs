// O REDATOR PARA DE REPETIR IMAGEM: PREFERE MENOS SLIDES.
//
// O QUE FOI MEDIDO EM 15/09/2026. A peça 71 (exec 601, "Sony anuncia nova geração de headsets
// Pulse") saiu com SEIS slots de imagem preenchidos por UMA foto só:
//
//   e292ca6cd503363bbe4274d7777e38b7-scaled.jpg        slides 0, 2, 4
//   e292ca6cd503363bbe4274d7777e38b7-2048x1365.jpg     slides 1, 3
//
// Mesmo hash, duas variantes de tamanho do WordPress. É a queixa do dono, literal: "a mesma
// imagem e só muda o zoom".
//
// A CAUSA NÃO É O AGENTE INVENTANDO — É O PROMPT MANDANDO. Linha 54:
//
//   "Se houver menos imagens que slides, reutilize as disponíveis."
//
// Essa frase foi escrita quando o carrossel era FIXO em 5 slides: repetir era a única saída.
// Desde 20/08 o produtor faz de 3 a 7 slides (8cdad9a8) e a faixa NUNCA foi exercitada em
// produção — o produtor foi desligado 40 min depois do deploy. A instrução ficou para trás.
//
// ⚠️ A REGRA ESTÁ EM DOIS LUGARES: linha 54 e linha 277 (a seção do candidato aprovado). Este
// patch troca AS DUAS. Divergir as cópias é o defeito que já mordeu este projeto duas vezes —
// caps do validador (42/38 num lado, 34/30 no outro, reprovou quase toda pauta por semanas) e a
// URL do Cloudinary montada em três arquivos.
//
// POR QUE ESTE CAMINHO E NÃO A CONTAGEM HONESTA. A alternativa era fazer `imagens_unicas` parar
// de contar duas variantes da mesma foto como duas. Medido em 437 itens reais: 31 pautas
// passariam de 2+ para 1 imagem única, e AS 31 SÃO DO GAMEBLAST — a fonte desbloqueada há duas
// horas (81c54175). Apertar a contagem poderia barrá-la no gate de variedade antes de ela ter
// publicado uma peça sequer. Aquilo reprova peça feia; isto a deixa bonita e menor.
//
// O GANHO É REAL E PARCIAL, e vale dizer o tamanho certo: `output.capa` espelha a imagem do
// slide 0, então K fotos distintas comportam K slides sem repetição, com piso de 3 (mínimo da
// faixa, do Instagram e do validador). Na peça 71, com 2 fotos: de 6 slots com cada foto 3x para
// 3 slots com uma repetição. Numa pauta de fonte primária (8,1 imagens/item no PlayStation,
// 9,2 no Xbox — medido) não muda nada, porque lá já sobra imagem.
//
// TROCA EDITORIAL ASSUMIDA: uma pauta com 7 fatos e 3 imagens passa a virar 3 slides. Perde-se
// conteúdo para ganhar estética. É a direção que o dono pediu explicitamente ("objetivo é ganho
// estético"), e a seção de estrutura do prompt já dizia "preferir menos é sempre permitido" —
// esta regra só acrescenta a imagem como segundo teto.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'AI Agent';
const MIN_SLIDES = 3;

// ───────────────────────────────────────────── cópia 1 (seção "Campos visuais de cada slide")
const ANCORA_A = 'Se houver menos imagens que slides, reutilize as disponíveis.';

const NOVO_A = 'NUNCA repita a mesma imagem em slides diferentes: o número de slides é o MENOR '
  + 'entre o que a matéria sustenta e quantas imagens DISTINTAS você recebeu. Com 4 imagens, no '
  + 'máximo 4 slides. Só quando houver menos de ' + MIN_SLIDES + ' imagens distintas — e aí é '
  + 'obrigatório, porque ' + MIN_SLIDES + ' é o mínimo do carrossel — repita a de melhor '
  + 'enquadramento. Duas URLs do mesmo arquivo em tamanhos diferentes (…-scaled.jpg e '
  + '…-2048x1365.jpg, ou /s1920/ e /w640-h360/) são a MESMA imagem, não duas.';

// ───────────────────────────────────────────── cópia 2 (seção do candidato aprovado)
const ANCORA_B = 'Se houver menos imagens oficiais que slides, reutilize as disponíveis em vez de reprovar a pauta ou inventar URLs.';

const NOVO_B = 'Se houver menos imagens oficiais que slides, REDUZA O NÚMERO DE SLIDES até caber '
  + 'uma imagem distinta por slide — nunca reprove a pauta por isso e nunca invente URLs. Abaixo '
  + 'de ' + MIN_SLIDES + ' slides não dá: aí, e só aí, repita a imagem de melhor enquadramento.';

const TROCAS = [
  { nome: 'campos visuais: slides limitados pelas imagens distintas', de: ANCORA_A, para: NOVO_A },
  { nome: 'candidato aprovado: reduzir slides em vez de repetir', de: ANCORA_B, para: NOVO_B },
];

const lf = (s) => String(s).split('\r\n').join('\n');
const MARCA = 'NUNCA repita a mesma imagem em slides diferentes';

function trocar(texto) {
  let saida = lf(texto);
  if (saida.includes(MARCA)) throw new Error(`${NO}: prompt já tem a regra — patch já aplicado?`);
  for (const t of TROCAS) {
    const vezes = saida.split(lf(t.de)).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(lf(t.de)).join(lf(t.para));
  }
  return saida;
}

function destrocar(texto) {
  let saida = lf(texto);
  if (!saida.includes(MARCA)) throw new Error(`${NO}: prompt não tem a regra — nada a reverter`);
  for (const t of [...TROCAS].reverse()) {
    const vezes = saida.split(lf(t.para)).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora invertida "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(lf(t.para)).join(lf(t.de));
  }
  return saida;
}

module.exports = { WF, NO, TROCAS, MARCA, trocar, destrocar, lf, MIN_SLIDES, ANCORA_A, ANCORA_B };

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
  const antes = no.parameters.options.systemMessage;
  if (typeof antes !== 'string') throw new Error(`${NO}: systemMessage não é string`);

  const depois = REVERTER ? destrocar(antes) : trocar(antes);
  // as duas cópias têm que continuar dizendo a mesma coisa — divergir é o defeito que este
  // patch existe para não repetir
  if (!REVERTER) {
    const temA = depois.includes(NOVO_A);
    const temB = depois.includes(NOVO_B);
    if (!temA || !temB) throw new Error('as duas cópias da regra não ficaram ambas presentes');
    if (depois.includes(ANCORA_A) || depois.includes(ANCORA_B)) {
      throw new Error('sobrou instrução antiga de repetir imagem no prompt');
    }
  }
  no.parameters.options.systemMessage = depois;

  const delta = depois.length - lf(antes).length;
  for (const t of TROCAS) console.log(`OK  ${t.nome}`);
  console.log(`OK  as 2 cópias da regra ficaram coerentes`);
  console.log(`OK  prompt: ${lf(antes).length} -> ${depois.length} bytes `
    + `(${delta > 0 ? '+' : ''}${delta}, ~${Math.round(delta / 4)} tokens por chamada)`);

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte o teto de slides pela quantidade de imagens'
    : 'Redator reduz slides em vez de repetir imagem (era a mesma foto 5x)';
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-slides-pela-imagem.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
