// BANCO DE PROVAS 3 — um nó Code que retorna `[]` corta mesmo o ramo? E o `dataTable get` novo lê
// a fila de verdade?
//
// POR QUE ISTO EXISTE. O portão da fila (`patch_portao_da_fila.cjs`) depende de DOIS mecanismos que
// nenhum dos quatro workflows exercita hoje da forma como ele vai usar:
//
//   1. um nó Code que devolve `[]` para IMPEDIR o ramo de continuar (hoje todo desvio é feito com
//      nó IF, nunca com array vazio);
//   2. um `dataTable get` novo lendo `promoliso_fila` de dentro do PRODUTOR (o produtor só escreve
//      nessa tabela; quem lê é o watchdog).
//
// O histórico do projeto é que mecanismo não exercitado cobra um slot de publicação: 05/08 (3 dias
// perdidos) e 17/08 (um slot), as duas vezes com a leitura do código-fonte dizendo que ia funcionar.
// Leitura não é execução.
//
// O CONTROLE POSITIVO É O PONTO. Se só houvesse um portão e o eco não rodasse, "não rodou" seria
// indistinguível de "a bancada está quebrada". Então a prova tem TRÊS portões lado a lado,
// alimentados pela MESMA leitura da fila:
//
//   Ler fila --> Portão fechado  (o código do patch com N=0, FECHA sempre)   --> Eco fechado
//           |--> Portão controle (o MESMO código com N gigante, ABRE sempre) --> Eco controle
//           \--> Portão real     (o N que vai pra produção)                  --> Eco real
//
// O braço testado é o FORÇADO A FECHAR, não o real. Motivo: com o N real a prova só exercita o
// corte quando a fila por acaso estiver cheia, e num dia de fila magra ela sai inconclusiva sem
// avisar. O desconhecido aqui não é o valor de N — é se `return []` corta o ramo nesta versão do
// n8n. O N real já é coberto offline por `test_portao_da_fila.cjs`; o terceiro braço fica só para
// registrar o que ele decidiria HOJE, como informação, nunca como veredito.
//
// Combinações:
//   controle rodou + fechado não rodou  -> `[]` corta o ramo. É o que se quer provar.
//   controle rodou + fechado rodou      -> `[]` NÃO corta. O portão seria decorativo: não deployar.
//   controle NÃO rodou                  -> bancada quebrada (ou o dataTable não leu). Nada a concluir.
//
// Esta prova NÃO chama API nenhuma e NÃO publica nada: só um dataTable em modo leitura e nós de
// código. Roda de graça.
//
// Uso, no VPS:
//   sudo -u promo node design/prova_portao_da_fila.cjs --criar     # insere e ativa (pede restart)
//   sudo -u promo node design/prova_portao_da_fila.cjs --ver       # le a ultima execucao
//   sudo -u promo node design/prova_portao_da_fila.cjs --remover
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./patch_portao_da_fila.cjs');

const WF = 'PRMLPROVAPORTAO';
const NOME = 'PROVA - Portao da fila (temporario)';
const PROJETO_DE = 'NL8eVLKErgnIXBQq';
const NO_LER = P.NO_LER;
const NO_FECHADO = 'Portao fechado';
const NO_CONTROLE = 'Portao controle';
const NO_REAL = 'Portao real';
const ECO_FECHADO = 'Eco fechado';
const ECO_CONTROLE = 'Eco controle';
const ECO_REAL = 'Eco real';

// O portão real é o código do patch, IMPORTADO e não copiado: se o patch mudar e a prova não for
// refeita, ela passa a testar a versão nova — que é o que se quer de um banco de provas.
const CODIGO_REAL = P.CODIGO_PORTAO;

// Os outros dois braços são o MESMO código com o N trocado. A prova confere que o replace pegou —
// senão os três braços seriam cópias idênticas e nada estaria sendo controlado.
const LINHA_N = 'const N_MAX_FRESCAS = ' + P.N_MAX_FRESCAS + ';';
const comN = (n) => CODIGO_REAL.split(LINHA_N).join('const N_MAX_FRESCAS = ' + n + ';');
const CODIGO_FECHADO = comN(0);          // frescas.length >= 0 e sempre verdade -> devolve [] sempre
const CODIGO_CONTROLE = comN(999999);    // nunca alcanca -> abre sempre

const eco = (quem) => 'return [{ json: { eco: ' + JSON.stringify(quem) + ',\n'
  + '  recebeu: $input.all().map((i) => i.json) } }];';

function montar() {
  const nodes = [
    { id: crypto.randomUUID(), name: 'Disparo da prova', type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2, position: [0, 0],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 */5 * * * *' }] } } },
    // exatamente o nó que o patch cria — vem da mesma função, não de uma cópia
    { ...P.noLer([240, 0]) },
    { id: crypto.randomUUID(), name: NO_FECHADO, type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [480, -160], parameters: { jsCode: CODIGO_FECHADO } },
    { id: crypto.randomUUID(), name: NO_CONTROLE, type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [480, 0], parameters: { jsCode: CODIGO_CONTROLE } },
    { id: crypto.randomUUID(), name: NO_REAL, type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [480, 160], parameters: { jsCode: CODIGO_REAL } },
    { id: crypto.randomUUID(), name: ECO_FECHADO, type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [720, -160], parameters: { jsCode: eco('fechado') } },
    { id: crypto.randomUUID(), name: ECO_CONTROLE, type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [720, 0], parameters: { jsCode: eco('controle') } },
    { id: crypto.randomUUID(), name: ECO_REAL, type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [720, 160], parameters: { jsCode: eco('real') } },
  ];
  const connections = {
    'Disparo da prova': { main: [[{ node: NO_LER, type: 'main', index: 0 }]] },
    [NO_LER]: { main: [[
      { node: NO_FECHADO, type: 'main', index: 0 },
      { node: NO_CONTROLE, type: 'main', index: 0 },
      { node: NO_REAL, type: 'main', index: 0 },
    ]] },
    [NO_FECHADO]: { main: [[{ node: ECO_FECHADO, type: 'main', index: 0 }]] },
    [NO_CONTROLE]: { main: [[{ node: ECO_CONTROLE, type: 'main', index: 0 }]] },
    [NO_REAL]: { main: [[{ node: ECO_REAL, type: 'main', index: 0 }]] },
  };
  return { nodes, connections };
}

module.exports = { WF, NOME, montar, CODIGO_REAL, CODIGO_FECHADO, CODIGO_CONTROLE,
  NO_LER, NO_FECHADO, NO_CONTROLE, NO_REAL, ECO_FECHADO, ECO_CONTROLE, ECO_REAL };

if (require.main !== module) return;

// guarda de sanidade da própria prova: sem isto um replace que não pegou passaria batido
if (CODIGO_CONTROLE === CODIGO_REAL || CODIGO_FECHADO === CODIGO_REAL) {
  console.error('FAIL  os bracos ficaram iguais (o replace do N nao pegou) — prova invalida');
  process.exit(1);
}
if (!CODIGO_CONTROLE.includes('const N_MAX_FRESCAS = 999999;')
    || !CODIGO_FECHADO.includes('const N_MAX_FRESCAS = 0;')) {
  console.error('FAIL  os N dos bracos nao ficaram como esperado — prova invalida');
  process.exit(1);
}

const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n nao existe aqui: ' + DB + '\n      Este script so roda no VPS.');
  process.exit(1);
}
const sqlite3 = require('sqlite3');
const modo = process.argv.find((a) => /^--(criar|ver|remover)$/.test(a));
if (!modo) { console.error('uso: --criar | --ver | --remover'); process.exit(1); }
const db = new sqlite3.Database(DB, modo === '--ver' ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function agora() {
  const d = new Date(); const p = (n, l) => String(n).padStart(l || 2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
    + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

(async () => {
  if (modo === '--criar') {
    if (await get('SELECT id FROM workflow_entity WHERE id=?', [WF])) throw new Error('prova ja existe - rode --remover antes');
    const proj = await get('SELECT projectId FROM shared_workflow WHERE workflowId=?', [PROJETO_DE]);
    if (!proj) throw new Error('projeto do produtor nao achado');
    const m = montar();
    const V = crypto.randomUUID(); const t = agora();
    const nodesStr = JSON.stringify(m.nodes); const connStr = JSON.stringify(m.connections);
    const settings = JSON.stringify({ executionOrder: 'v1', timezone: 'America/Sao_Paulo' });
    await run('BEGIN');
    try {
      await run('INSERT INTO workflow_entity (id,name,active,nodes,connections,settings,staticData,pinData,versionId,triggerCount,meta,createdAt,updatedAt,isArchived,versionCounter,description,activeVersionId,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [WF, NOME, 0, nodesStr, connStr, settings, null, null, V, 1, null, t, t, 0, 1, 'banco de provas temporario', null, '[]']);
      await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [V, WF, 'Promo Liso', t, t, nodesStr, connStr, NOME, 1, 'banco de provas temporario', '[]']);
      await run('UPDATE workflow_entity SET active=1, activeVersionId=? WHERE id=?', [V, WF]);
      await run('INSERT INTO shared_workflow (workflowId,projectId,role,createdAt,updatedAt) VALUES (?,?,?,?,?)',
        [WF, proj.projectId, 'workflow:owner', t, t]);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }
    console.log('OK criado e ativo. Reinicie o n8n; dispara de 5 em 5 minutos.');
    console.log('   bracos: fechado N=0 | controle N=999999 | real N=' + P.N_MAX_FRESCAS);
  }

  if (modo === '--ver') {
    const ex = await get('SELECT id, status, datetime(startedAt,"-3 hours") AS inicio FROM execution_entity WHERE workflowId=? ORDER BY id DESC LIMIT 1', [WF]);
    if (!ex) { console.log('nenhuma execucao ainda'); db.close(); return; }
    console.log('execucao ' + ex.id + '  ' + ex.inicio + ' BRT  status=' + ex.status + '\n');
    const linha = await get('SELECT data FROM execution_data WHERE executionId=?', [ex.id]);
    const pool = JSON.parse(linha.data);
    // teto `< pool.length`: em `flatted` toda string e indice, e um numero comum e indistinguivel
    // de um indice. Sem o teto o leitor apaga chaves e inventa falha (ver prova_carousel_children).
    const un = (x, d) => {
      if (d > 60) return '[deep]';
      if (typeof x === 'string' && /^[0-9]+$/.test(x) && Number(x) < pool.length) return un(pool[+x], d + 1);
      if (Array.isArray(x)) return x.map((v) => un(v, d + 1));
      if (x && typeof x === 'object') { const o = {}; for (const k in x) o[k] = un(x[k], d + 1); return o; }
      return x;
    };
    const rd = un(pool[0], 0).resultData.runData;
    const itensDe = (nome) => {
      const c = rd[nome];
      if (!c) return null;
      return ((((c[0] || {}).data || {}).main || [])[0]) || [];
    };

    const lidos = itensDe(NO_LER);
    console.log((lidos ? 'ok ' : 'XX ') + NO_LER + ': '
      + (lidos ? lidos.length + ' rows lidas de promoliso_fila' : 'NAO EXECUTOU'));

    const fech = itensDe(NO_FECHADO);
    const ctrl = itensDe(NO_CONTROLE);
    const real = itensDe(NO_REAL);
    const ecoF = itensDe(ECO_FECHADO);
    const ecoC = itensDe(ECO_CONTROLE);
    const ecoR = itensDe(ECO_REAL);
    const decisao = (its) => (its === null ? 'nao executou'
      : (its.length === 0 ? 'FECHOU (devolveu [])' : 'abriu -> ' + JSON.stringify(its[0].json)));
    console.log('   ' + NO_FECHADO + ' (N=0): ' + decisao(fech)
      + '   | ' + ECO_FECHADO + ': ' + (ecoF ? 'RODOU' : 'nao rodou'));
    console.log('   ' + NO_CONTROLE + ' (N=999999): ' + decisao(ctrl)
      + '   | ' + ECO_CONTROLE + ': ' + (ecoC ? 'RODOU' : 'nao rodou'));
    console.log('   ' + NO_REAL + ' (N=' + P.N_MAX_FRESCAS + ', informativo): ' + decisao(real)
      + '   | ' + ECO_REAL + ': ' + (ecoR ? 'RODOU' : 'nao rodou'));

    console.log('');
    if (!lidos || !lidos.length) {
      console.log('INCONCLUSIVO — o dataTable nao leu a fila. Bancada quebrada, nao conclua nada.');
    } else if (!ecoC) {
      console.log('INCONCLUSIVO — o CONTROLE nao rodou. Ou o Code com N gigante fechou (impossivel),');
      console.log('               ou a bancada esta quebrada. Sem controle nao ha veredito.');
    } else if (!fech || fech.length !== 0) {
      console.log('INCONCLUSIVO — o braco fechado nao devolveu [] como devia (N=0). Ver acima.');
    } else if (!ecoF) {
      console.log('PROVADO — o portao devolveu [] e o ramo PAROU (eco fechado nao rodou), enquanto o');
      console.log('          controle, com o MESMO codigo e N gigante, abriu e o eco dele rodou.');
      console.log('          `return []` corta o ramo nesta instancia: o mecanismo funciona.');
      console.log('');
      console.log('          [informativo] com o N real (' + P.N_MAX_FRESCAS + ') a fila de agora '
        + (real && real.length ? 'ABRIRIA: ' + JSON.stringify(real[0].json) : 'FECHARIA o portao'));
    } else {
      console.log('FALHOU — o portao devolveu [] e o eco RODOU DE QUALQUER JEITO. Array vazio NAO');
      console.log('         corta o ramo nesta versao do n8n. NAO deployar: o portao seria decorativo.');
    }
  }

  if (modo === '--remover') {
    await run('BEGIN');
    try {
      await run('DELETE FROM shared_workflow WHERE workflowId=?', [WF]);
      await run('DELETE FROM workflow_entity WHERE id=?', [WF]);
      await run('DELETE FROM workflow_history WHERE workflowId=?', [WF]);
      await run('COMMIT');
    } catch (e) { await run('ROLLBACK'); throw e; }
    console.log('OK removido. Reinicie o n8n pra ele parar de disparar.');
  }
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
