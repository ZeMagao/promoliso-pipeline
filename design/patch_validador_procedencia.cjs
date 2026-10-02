// VALIDADOR: A PROCEDÊNCIA CONTA (02/10/2026). Duas reprovações que eram erro do validador.
//
// COMO FOI MEDIDO. Bancada que reexecuta o validador REAL sobre as 58 validações da semana (entrada
// do redator, contexto editorial e relógio de cada rodada — design/validador_casos_20261002.json).
// Controle de fidelidade antes de tudo: a bancada reproduz os 58 vereditos de produção (as 3
// diferenças são a allowlist corrigida às 16:52 de hoje, que o export já tem).
//
// 1. O CONTEXTO SUMIA CALADO. A relevância da FONTE lê o candidato com
//    `$('Montar contexto editorial').item`. O `.item` depende do rastreio de item pareado, que se
//    perde no laço "Tentar outra pauta" + AI Agent: lança erro, o `catch` devolvia `[]` e a fonte
//    ficava sem o material do candidato para provar relação. Prova: a produção só bate com a
//    bancada quando o `.item` é forçado a falhar — e então a exec 822 (Next Week on Xbox, fonte
//    PRIMÁRIA news.xbox.com, só "xbox" em comum) reprova igual à produção. A 30 linhas dali, o
//    `candidatoEditorialAprovado` já lia com `.all()` — que funciona. Agora as duas leem igual.
//
// 2. A FOTO OFICIAL DO JOGO NUNCA "TINHA RELAÇÃO". Desde 17/09 o /jogo/fotos põe no acervo da
//    pauta as screenshots da Steam do jogo CONFIRMADO (21/40 pautas, zero falso positivo). A URL
//    delas é opaca (`ss_<hash>.1920x1080.jpg`), e a regra de relação é palavra em comum entre URL
//    e texto: nunca casava. 14 fotos reprovadas na semana; E-Day e Forest of Deceit caíram nas
//    duas tentativas. Medido: as 32 imagens "sem relação" da semana estavam TODAS no acervo do
//    candidato. Mas só a foto da Steam passa a contar — as de gg.deals (1 imagem de 608 px por
//    matéria, repetida no carrossel inteiro) seguem reprovadas: ali o validador erra o motivo, não
//    o resultado.
//
// O QUE NÃO MUDA: nenhuma outra regra. A bancada lista, caso a caso, todo veredito que muda.
// ROLLBACK: `--reverter`. Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';
const NO = 'Validar antes de publicar';

const EDICOES = [
  {
    nome: 'contexto do candidato lido com .all(), como o resto do nó',
    de: `let candidatosContexto = [];
try {
  candidatosContexto =
    $('Montar contexto editorial').item.json.candidatos || [];
} catch (error) {
  candidatosContexto = [];
}`,
    para: `// \`.all()\` e nao \`.item\` (02/10/2026): o \`.item\` depende do rastreio de item pareado, que se
// perde no laco "Tentar outra pauta" + AI Agent. Ele lancava erro, o catch devolvia [] calado e a
// fonte perdia o material do candidato. Reexecutando as 58 validacoes da semana, producao so bate
// com \`.item\` quebrado; a exec 822 (fonte primaria news.xbox.com) reprovou por isso. E a mesma
// leitura que o \`candidatoEditorialAprovado\` acima ja fazia.
let candidatosContexto = [];
try {
  const refContexto = $('Montar contexto editorial');
  candidatosContexto = (typeof refContexto.all === 'function' ? refContexto.all() : [refContexto.item])
    .flatMap((item) => item?.json?.candidatos || [])
    .filter(Boolean);
} catch (error) {
  candidatosContexto = [];
}`,
  },
  {
    nome: 'acervo do candidato disponível na auditoria de imagem',
    de: `const imagensAuditadas = imagensValidas.map((imagem, index) => {`,
    para: `// Acervo que o proprio pipeline montou para ESTA pauta (materia + fotos oficiais do jogo).
const acervoDoCandidato = new Set(imagensOficiaisDoCandidato.map(urlCanonica));
const imagensAuditadas = imagensValidas.map((imagem, index) => {`,
  },
  {
    nome: 'foto oficial do jogo (Steam, no acervo) conta como relacionada',
    de: `  const imagemDeHostOficial =
    hostIn(imagem.host, dominiosPrimarios) &&
    fontesPrimariasRelevantes.length > 0;`,
    para: `  const imagemDeHostOficial =
    hostIn(imagem.host, dominiosPrimarios) &&
    fontesPrimariasRelevantes.length > 0;
  // FOTO OFICIAL DO JOGO (02/10/2026). O /jogo/fotos poe no acervo as screenshots da Steam do jogo
  // CONFIRMADO; a URL e opaca (ss_<hash>.1920x1080.jpg) e a regra de palavras nunca casava: 14
  // fotos reprovadas na semana. Foto da CDN da Steam que esta no acervo do candidato e da pauta
  // por construcao. So Steam: a imagem unica de 608 px do gg.deals continua reprovando.
  const fotoOficialDoJogo =
    hostIn(imagem.host, ['steamstatic.com']) &&
    acervoDoCandidato.has(urlCanonica(imagem.url));`,
  },
  {
    nome: 'a regra de relevância considera a foto oficial',
    de: `    relevante:
      imagemDeHostOficial ||
      cdnXboxWireOficial ||`,
    para: `    relevante:
      imagemDeHostOficial ||
      cdnXboxWireOficial ||
      fotoOficialDoJogo ||`,
  },
];
const MARCA = 'const acervoDoCandidato = new Set(';
const lf = (s) => String(s).split('\r\n').join('\n');

function aplicar(texto, reverter) {
  const ordem = reverter ? EDICOES.slice().reverse() : EDICOES;
  return ordem.reduce((acc, e) => {
    const de = lf(reverter ? e.para : e.de);
    const para = lf(reverter ? e.de : e.para);
    const vezes = acc.split(de).length - 1;
    if (vezes !== 1) throw new Error(`${NO}: âncora "${e.nome}" apareceu ${vezes} vezes (esperava 1) — patch já aplicado, ou o nó mudou`);
    return acc.split(de).join(para);
  }, lf(texto));
}
const normalizar = (texto) => (lf(texto).includes(MARCA) ? lf(texto) : aplicar(texto, false));

module.exports = { WF, NO, EDICOES, MARCA, lf, aplicar, normalizar };

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
    if (row.versionId !== row.activeVersionId) throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
    const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
    if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');
    const nodes = JSON.parse(row.nodes);
    const no = nodes.find((n) => n.name === NO);
    if (!no || typeof no.parameters.jsCode !== 'string') throw new Error('nó não achado ou sem jsCode: ' + NO);
    const depois = aplicar(no.parameters.jsCode, REVERTER);
    try { new Function('$', '$json', depois); } catch (e) { throw new Error(NO + ': jsCode resultante não compila: ' + e.message); }
    for (const e of EDICOES) console.log(`OK  ${NO}: ${e.nome}`);
    console.log('OK  conexões intocadas');
    if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
    no.parameters.jsCode = depois;
    const nodesStr = JSON.stringify(nodes);
    const V = crypto.randomUUID();
    const t = agora();
    const desc = REVERTER ? 'Reverte: validador volta a ler contexto com .item e a ignorar a foto oficial do jogo'
      : 'Validador: contexto com .all() e foto oficial da Steam no acervo conta como relacionada';
    await run('BEGIN');
    try {
      await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
        [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1, desc, '[]']);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }
    fs.writeFileSync(path.join(__dirname, '..', 'newversion-validador-procedencia.txt'), V);
    console.log('OK gravado. versionId =', V);
    db.close();
  })().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
}
