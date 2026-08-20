// A NOTA PASSA A DECIDIR NO RAMO B DO SELETOR (12–48 h).
//
// O PROBLEMA, MEDIDO EM 20/08 nas 37 publicações da fila:
//
//   ramo A  (idade <= 12 h)  ordena por NOTA        18 publicações
//   ramo B  (12 h a 48 h)    ordena por MAIS NOVA   19 publicações   <-- aqui
//   ramo C  (> 48 h)         ordena por MAIS NOVA    0 publicações
//
// Ou seja: em 19 das 37 publicações (51%) a nota da curadoria foi calculada, gravada na fila e
// **jogada fora** na hora de escolher. O resultado aparece na fila de hoje: peça de nota 82
// apodreceu enquanto peça de nota 73 publicou. Nota média das publicadas 79,8 contra 76,3 das
// apodrecidas — 3,5 pontos de diferença para 40% da produção descartada. O torneio que justificaria
// esse desperdício não existia.
//
// A TROCA: no ramo B, ordenar por nota (idade como desempate, mais nova primeiro). Uma palavra.
//
// POR QUE O ARGUMENTO DE FRESCOR NÃO SE APLICA AQUI: quem protege a notícia do dia é o ramo A, que
// tem prioridade absoluta e já ordena por nota. O ramo B só é alcançado quando NADA tem menos de
// 12 h — tudo que está nele já é de ontem ou de anteontem, e entre duas peças velhas a idade não é
// critério editorial melhor do que a nota.
//
// EFEITO COLATERAL ACEITO: com nota decidindo, uma peça de 47 h e nota alta pode publicar na frente
// de uma de 13 h e nota baixa, o que aumenta a idade média do que sai. Medido: o ramo B já publicava
// entre 22,5 h e 46,5 h de idade, então a faixa não é nova — o que muda é qual peça dentro dela sai.
//
// O QUE ESTA TROCA NÃO FAZ: não reduz o desperdício de 40%. Ela faz o desperdício recair sobre a
// PIOR peça em vez de sobre a mais velha. Cortar o desperdício é o portão no produtor, que é outro
// patch — de propósito, porque aquele mexe em nó novo e este não mexe em nó nenhum.
//
// O ramo C fica como está: entre peças que já passaram das 48 h, a mais nova é a menos ruim, e a
// nota não salva notícia vencida. Ele nunca foi acionado (0 de 37) e continua sendo a única rede
// contra um dia de produção zero — como 13/08, quando o token caiu e nasceram 0 peças.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'E27F7yVdsZRj';
const NO = 'Selecionar READY';

// A âncora é o bloco inteiro da escolha, não só a palavra `maisNovaPrimeiro` — ela aparece duas
// vezes no arquivo (ramos B e C) e trocar a errada inverteria justamente o ramo que deve continuar
// publicando o mais novo.
const TROCAS = [
  {
    nome: 'ordem do ramo B',
    de: "const fila = doDia.length\n"
      + "  ? doDia.slice().sort(porNota)\n"
      + "  : (frescas.length ? frescas.slice().sort(maisNovaPrimeiro) : ready.slice().sort(maisNovaPrimeiro));",
    para: "// Ramo A (notícia do dia) e ramo B (12–48 h) ordenam os dois por NOTA. O ramo B ordenava por\n"
      + "// mais nova e respondia por 51% das publicações, o que jogava a nota no lixo em metade das\n"
      + "// escolhas: medido em 20/08, peça de nota 82 apodreceu e peça de nota 73 publicou. Quem\n"
      + "// protege a notícia fresca é o ramo A ter prioridade, não a ordem interna do ramo B — lá\n"
      + "// dentro tudo já é de ontem ou anteontem.\n"
      + "// O ramo C (> 48 h) continua por mais nova: nota não salva notícia vencida.\n"
      + "const fila = doDia.length\n"
      + "  ? doDia.slice().sort(porNota)\n"
      + "  : (frescas.length ? frescas.slice().sort(porNota) : ready.slice().sort(maisNovaPrimeiro));",
  },
];

const lf = (s) => String(s).split('\r\n').join('\n');
const MARCA = 'frescas.slice().sort(porNota)';

function trocar(codigo) {
  let saida = lf(codigo);
  if (saida.includes(MARCA)) throw new Error(`${NO}: ramo B já ordena por nota — patch já aplicado?`);
  for (const t of TROCAS) {
    const vezes = saida.split(t.de).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.de).join(t.para);
  }
  new Function(saida);
  return saida;
}

function destrocar(codigo) {
  let saida = lf(codigo);
  if (!saida.includes(MARCA)) throw new Error(`${NO}: ramo B não está por nota — nada a reverter`);
  for (const t of TROCAS) {
    const vezes = saida.split(t.para).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora invertida "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.para).join(t.de);
  }
  new Function(saida);
  return saida;
}

module.exports = { WF, NO, TROCAS, MARCA, trocar, destrocar, lf };

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

  if (REVERTER) {
    no.parameters.jsCode = destrocar(no.parameters.jsCode);
    console.log(`OK  ${NO}  (ramo B volta a ordenar por mais nova)`);
  } else {
    no.parameters.jsCode = trocar(no.parameters.jsCode);
    console.log(`OK  ${NO}  (ramo B ordena por nota, idade como desempate)`);
  }

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte: ramo B do seletor volta a ordenar por mais nova'
    : 'Ramo B do seletor (12-48h) ordena por nota, nao por idade';
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-ramo-b-nota.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
