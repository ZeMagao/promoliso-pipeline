// CORRIGE UM NÚMERO ERRADO NO COMENTÁRIO DO `Selecionar READY`.
//
// O patch `patch_ramo_b_por_nota.cjs` subiu em 20/08 (`9f058291`) carregando esta frase:
//
//   "O ramo B ordenava por mais nova e respondia por 51% das publicações"
//
// **O 51% está errado e eu já sabia disso quando o deploy aconteceu.** O número veio de classificar
// as 23 publicações ANTIGAS nos três ramos do seletor — ramos que não existiam antes de `a3b37bc`
// (14/08, "publicador escolhe a notícia do DIA"). Até ali o publicador pegava a mais perto de vencer,
// então aquelas execuções rodaram OUTRO código e não podem ser classificadas por estes ramos.
//
// O número medido no regime atual é **3 de 14 publicações desde 14/08**, ou seja o ramo B é minoria e
// esta mudança é quase inerte hoje — ela vale como seguro para quando a produção cair e o ramo B
// voltar a decidir. O comentário como está vende a mudança como conserto de metade das publicações,
// que é o oposto.
//
// POR QUE ISTO MERECE UM DEPLOY SÓ PARA COMENTÁRIO: neste projeto número errado em comentário já
// direcionou trabalho por semanas. O comentário de um nó é a primeira coisa que se lê ao voltar nele,
// e este contradiz o doc (`docs/FILA-VAZAO.md`), o harness e o próprio patch que o gerou. Deixar
// significa plantar a hipótese derrubada de volta no lugar onde ela vai ser lida como verdade.
//
// Não muda UMA LINHA de lógica: a troca é dentro do bloco de comentário.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'E27F7yVdsZRj';
const NO = 'Selecionar READY';

const TROCAS = [
  {
    nome: 'o 51% que não existe',
    de: "// Ramo A (notícia do dia) e ramo B (12–48 h) ordenam os dois por NOTA. O ramo B ordenava por\n"
      + "// mais nova e respondia por 51% das publicações, o que jogava a nota no lixo em metade das\n"
      + "// escolhas: medido em 20/08, peça de nota 82 apodreceu e peça de nota 73 publicou. Quem\n"
      + "// protege a notícia fresca é o ramo A ter prioridade, não a ordem interna do ramo B — lá\n"
      + "// dentro tudo já é de ontem ou anteontem.",
    para: "// Ramo A (notícia do dia) e ramo B (12–48 h) ordenam os dois por NOTA. O ramo B ordenava por\n"
      + "// mais nova, o que jogava a nota da curadoria no lixo: medido em 20/08, peça de nota 82\n"
      + "// apodreceu e peça de nota 73 publicou. Quem protege a notícia fresca é o ramo A ter\n"
      + "// prioridade, não a ordem interna do ramo B — lá dentro tudo já é de ontem ou anteontem.\n"
      + "//\n"
      + "// QUANTO ISSO PESA HOJE: pouco. O ramo B decidiu 3 das 14 publicações desde 14/08 — com 3\n"
      + "// slots por dia e ~4 peças produzidas, quase sempre existe peça de hoje e o ramo A resolve.\n"
      + "// Esta ordenação é SEGURO para quando a produção cair (feed morto, token fora, dia sem\n"
      + "// pauta): aí o ramo B volta a decidir e a nota volta a importar. Ela NÃO reduz o\n"
      + "// apodrecimento da fila — isso é vazão, e quem trata é o portão no produtor.\n"
      + "//\n"
      + "// (Uma versão anterior deste comentário dizia \"51% das publicações\". Era erro de medição:\n"
      + "// vinha de classificar as 23 publicações ANTIGAS nestes ramos, que não existiam antes de\n"
      + "// a3b37bc, em 14/08. Aquelas execuções rodaram outro código. Ver docs/FILA-VAZAO.md.)",
  },
];

const lf = (s) => String(s).split('\r\n').join('\n');
const MARCA = 'QUANTO ISSO PESA HOJE';

function trocar(codigo) {
  let saida = lf(codigo);
  if (saida.includes(MARCA)) throw new Error(`${NO}: comentário já corrigido — patch já aplicado?`);
  if (!saida.includes('51% das publicações')) {
    throw new Error(`${NO}: o comentário em produção não tem o 51% — alguém mexeu; revisar antes`);
  }
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
  if (!saida.includes(MARCA)) throw new Error(`${NO}: não está corrigido — nada a reverter`);
  for (const t of TROCAS) {
    const vezes = saida.split(t.para).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora invertida "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.para).join(t.de);
  }
  new Function(saida);
  return saida;
}

// A guarda que importa neste patch: só comentário muda. Comparar o código com os comentários
// removidos antes e depois — se diferir um caractere, algo além de comentário foi tocado.
const semComentarios = (s) => lf(s).split('\n')
  .filter((l) => !/^\s*\/\//.test(l))
  .join('\n');

module.exports = { WF, NO, TROCAS, MARCA, trocar, destrocar, lf, semComentarios };

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
  no.parameters.jsCode = REVERTER ? destrocar(antes) : trocar(antes);

  // só comentário pode ter mudado
  if (semComentarios(antes) !== semComentarios(no.parameters.jsCode)) {
    throw new Error('ALGO FORA DE COMENTÁRIO mudou — abortando (este patch não deve tocar lógica)');
  }
  console.log(`OK  ${NO}  (${REVERTER ? 'comentário revertido' : 'o 51% saiu; fica o 3 de 14 medido'})`);
  console.log('OK  conferido: nenhuma linha de lógica mudou');

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte a correcao do comentario do ramo B'
    : 'Corrige o comentario do ramo B: o 51% era erro de medicao (era 3 de 14)';
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-comentario-ramo-b.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
