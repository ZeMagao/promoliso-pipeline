// O CORTE DE 24 CANDIDATOS PASSA A RESERVAR VAGA PARA FONTE PRIMÁRIA.
//
// O QUE FOI MEDIDO EM 15/09/2026 (exec 601). `Preparar candidatos` ordena os candidatos SÓ por
// data de publicação e corta em 24. O peso de fonte (primaria 2 · editorial 1) existe, mas mora em
// `Preparar fila de curadoria`, que roda DEPOIS do corte — quem morre no corte não é pesado por
// nada. Composição real dos 24 naquela rodada:
//
//    6x gamevicio.com      5x adrenaline.com.br   4x gameblast.com.br
//    4x br.ign.com         3x tecnoblog.net       1x flowgames.gg
//    1x blog.playstation.com   <- ÚNICA primária
//
//    Xbox, Nintendo, NVIDIA: zero.   com imagem já no candidato: 4 de 24.
//
// A causa é vazão, não critério: feeds primários publicam ~10 itens/dia; os portais BR publicam
// 35-50. Os 24 primeiros por data são todos das últimas horas, e o portal BR ocupa a janela. O
// Xbox daquela rodada saiu 19:23 e perdeu a vaga por ~2h para itens de portal.
//
// POR QUE ISSO IMPORTA PARA IMAGEM: a primária traz 5 a 11 imagens por artigo; o portal traz UMA
// (medido em 28 execuções, ver plano-imagens-medido). Foi exatamente assim que a peça 71 saiu com
// a mesma foto em 5 slides — a pauta escolhida era de portal.
//
// ⚠️ E É POR ISSO QUE AMPLIAR FONTES VINHA PRIMEIRO NA LISTA E FOI DESPROMOVIDO. Testados vivos em
// 15/09: TechPowerUp 100 itens/dia, Rock Paper Shotgun 91, PC Gamer 50, Tom's 50, Canaltech 50.
// Qualquer um deles entra por data e expulsa a última primária que ainda sobrevive. Sem esta
// reserva, adicionar feed faz o CONTRÁRIO do que se quer.
//
// OS DOIS NÚMEROS, ESCOLHIDOS POR REPLAY DOS 441 ITENS REAIS DA EXEC 601 (não chutados):
//
//   vagas  teto/host  primárias   composição
//   -----  ---------  ---------   ----------------------------------------------------
//     0        -          1       (hoje) 6x gamevicio 5x adrenaline 4x gameblast ...
//     4        -          4       3x news.xbox 1x playstation        <- Xbox domina
//     6        -          6       4x news.xbox 2x playstation        <- idem
//     8        -          8       5x news.xbox 3x playstation        <- idem
//     6        3          6       3x playstation 3x news.xbox        <- ESCOLHIDO
//     8        3          8       3x playstation 3x news.xbox 2x nintendo
//
// 6 com teto 3 equilibra as duas primárias vivas e deixa 18 das 24 vagas para os portais BR, que
// são quem traz relevância local. Sem o teto por host, um único feed primário leva a reserva
// inteira — o que trocaria um desequilíbrio por outro.
//
// É PISO, NÃO COTA: se houver menos primárias que VAGAS_PRIMARIA, as vagas sobrando voltam para o
// bolo geral. Nunca sai com menos de 24 por causa da reserva.
//
// FORA DE ESCOPO, MEDIDO E REGISTRADO: as datas da NVIDIA chegam erradas. Nesta mesma execução,
// blogs.nvidia.com tem item mais novo de 2016-08-22 e nvidianews.nvidia.com de 2019-06-11,
// enquanto o feed ao vivo mostra 15/09/2026. Com data de 2016 a NVIDIA fica no fundo da ordenação
// e a reserva não a salva — ela entra depois de playstation/xbox/nintendo de qualquer jeito. É
// outro bug, de leitura de feed, e exige medição própria.
//
// ROLLBACK: `--reverter`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Preparar candidatos';

const VAGAS_PRIMARIA = 6;
const TETO_POR_HOST = 3;
const TOTAL = 24;

const ANCORA = `  .sort(
    (a, b) =>
      new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0),
  )
  .slice(0, 24);

return [{ json: { candidatos } }];`;

const NOVO = `  .sort(
    (a, b) =>
      new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0),
  );

// RESERVA DE VAGA PARA FONTE PRIMÁRIA.
// Antes daqui era \`.slice(0, 24)\` direto sobre a ordem por data, e o resultado medido na exec 601
// foi 23 portais e 1 primária — Xbox, Nintendo e NVIDIA zerados. O peso de fonte que existe em
// "Preparar fila de curadoria" roda DEPOIS do corte e não alcança quem já morreu aqui.
// A primária importa por imagem: traz 5-11 por artigo contra 1 do portal.
const VAGAS_PRIMARIA = ${VAGAS_PRIMARIA};   // replay dos 441 itens reais da exec 601
const TETO_POR_HOST = ${TETO_POR_HOST};    // sem ele, news.xbox sozinho leva a reserva inteira
const TOTAL = ${TOTAL};

const reservadas = [];
const usadosPorHost = Object.create(null);
for (const candidato of candidatos) {
  if (reservadas.length >= VAGAS_PRIMARIA) break;
  if (candidato.tipo_fonte !== 'primaria') continue;
  const host = hostnameFromUrl(candidato.url);
  if (!host) continue;
  if ((usadosPorHost[host] || 0) >= TETO_POR_HOST) continue;
  usadosPorHost[host] = (usadosPorHost[host] || 0) + 1;
  reservadas.push(candidato);
}
// PISO, NÃO COTA: vaga de primária que sobrou volta pro bolo geral, então o total continua 24
// mesmo num dia em que nenhuma primária publique.
const naReserva = new Set(reservadas);
const completando = candidatos
  .filter((candidato) => !naReserva.has(candidato))
  .slice(0, TOTAL - reservadas.length);
const selecionados = [...reservadas, ...completando].sort(
  (a, b) => new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0),
);

return [{ json: { candidatos: selecionados } }];`;

const TROCAS = [
  { nome: 'reserva de vaga para fonte primária no corte de 24', de: ANCORA, para: NOVO },
];

const lf = (s) => String(s).split('\r\n').join('\n');
const MARCA = 'VAGAS_PRIMARIA';

function trocar(texto) {
  let saida = lf(texto);
  if (saida.includes(MARCA)) throw new Error(`${NO}: jsCode já tem a reserva — patch já aplicado?`);
  for (const t of TROCAS) {
    const vezes = saida.split(lf(t.de)).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(lf(t.de)).join(lf(t.para));
  }
  return saida;
}

function destrocar(texto) {
  let saida = lf(texto);
  if (!saida.includes(MARCA)) throw new Error(`${NO}: jsCode não tem a reserva — nada a reverter`);
  for (const t of [...TROCAS].reverse()) {
    const vezes = saida.split(lf(t.para)).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora invertida "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(lf(t.para)).join(lf(t.de));
  }
  return saida;
}

module.exports = { WF, NO, TROCAS, MARCA, trocar, destrocar, lf, VAGAS_PRIMARIA, TETO_POR_HOST, TOTAL };

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
  try { new Function(depois); } catch (e) { throw new Error('jsCode resultante não compila: ' + e.message); }
  no.parameters.jsCode = depois;

  const delta = depois.length - lf(antes).length;
  for (const t of TROCAS) console.log(`OK  mudança: ${t.nome}`);
  console.log(`OK  ${VAGAS_PRIMARIA} vagas reservadas, teto de ${TETO_POR_HOST} por host, total ${TOTAL}`);
  console.log(`OK  jsCode: ${lf(antes).length} -> ${depois.length} bytes (${delta > 0 ? '+' : ''}${delta})`);
  console.log('OK  compila');

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte a reserva de vaga para fonte primaria'
    : 'Corte de 24 reserva vaga para fonte primaria (era 23 portais e 1 primaria)';
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-reserva-primaria.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
