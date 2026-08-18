// BANCO DE PROVAS 2 — o Switch em `mode: 'expression'` roteia como eu acho que roteia?
//
// POR QUE ISTO EXISTE. O `Switch` é o único mecanismo NOVO do patch do carrossel variável: nenhum
// dos quatro workflows usa Switch hoje, só IF. E o histórico deste projeto é que mecanismo não
// testado em produção cobra um slot: 05/08 (3 dias) e 17/08 (um slot), as duas vezes eu tinha lido
// o código-fonte e concluído que funcionava.
//
// Esta prova NÃO chama API nenhuma — só nós de código. Roda de graça e não pode quebrar nada.
//
// O QUE É TESTADO, e é o exato objeto que vai pro publicador: `SWITCH_PARAMS` é importado de
// `patch_carrossel_variavel_publicador.cjs`, não copiado. Se o patch mudar e esta prova não for
// refeita, ela testa a versão nova — que é o que se quer de um banco de provas.
//
// O nó de dados se chama `Selecionar READY` de propósito: assim a expressão do Switch é byte a byte
// a mesma que vai rodar em produção, incluindo o nome entre parênteses.
//
// Uso, no VPS:
//   sudo -u promo node design/prova_switch_quantidade.cjs --criar    # insere e ativa (pede restart)
//   sudo -u promo node design/prova_switch_quantidade.cjs --ver      # lê a última execução
//   sudo -u promo node design/prova_switch_quantidade.cjs --remover
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./patch_carrossel_variavel_publicador.cjs');

const WF = 'PRMLPROVASWITCH';
const NOME = 'PROVA - Switch por quantidade de imagens (temporario)';
const PROJETO_DE = 'E27F7yVdsZRj';
const NO_DADOS = P.NO_SELECIONAR;
const ecoNome = (n) => 'Eco ' + String(n).padStart(2, '0');

// Um item por tamanho possível, todos de uma vez: uma rodada cobre as 9 saídas.
const DADOS = '// Um item por tamanho de carrossel. `saida_carrossel` sai da mesma conta do nó real:\n'
  + '// n_imagens - MIN_IMAGENS, com MIN_IMAGENS = ' + P.MIN_IMAGENS + '.\n'
  + 'return ' + JSON.stringify(P.TAMANHOS.map((n) => ({
    json: { n_imagens: n, saida_carrossel: n - P.MIN_IMAGENS },
  })), null, 1) + ';';

// Cada eco devolve para qual saída ele foi chamado e o que recebeu. Se o roteamento errar, o eco
// errado recebe o item e a comparação abaixo aponta exatamente qual.
const eco = (n) => 'return $input.all().map((i) => ({ json: {\n'
  + '  eco_esperava: ' + n + ',\n'
  + '  recebeu_n_imagens: i.json.n_imagens,\n'
  + '  recebeu_saida: i.json.saida_carrossel,\n'
  + '} }));';

function montar() {
  const nodes = [
    { id: crypto.randomUUID(), name: 'Disparo da prova', type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2, position: [0, 0],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 */5 * * * *' }] } } },
    { id: crypto.randomUUID(), name: NO_DADOS, type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [240, 0], parameters: { jsCode: DADOS } },
    { id: crypto.randomUUID(), name: P.NO_SWITCH, type: 'n8n-nodes-base.switch',
      typeVersion: 3.4, position: [480, 0],
      parameters: JSON.parse(JSON.stringify(P.SWITCH_PARAMS)) },
  ];
  const connections = {
    'Disparo da prova': { main: [[{ node: NO_DADOS, type: 'main', index: 0 }]] },
    [NO_DADOS]: { main: [[{ node: P.NO_SWITCH, type: 'main', index: 0 }]] },
    [P.NO_SWITCH]: { main: [] },
  };
  P.TAMANHOS.forEach((n, i) => {
    nodes.push({ id: crypto.randomUUID(), name: ecoNome(n), type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [740, (i - 4) * 130], parameters: { jsCode: eco(n) },
      onError: 'continueRegularOutput' });
    connections[P.NO_SWITCH].main[i] = [{ node: ecoNome(n), type: 'main', index: 0 }];
  });
  return { nodes, connections };
}

module.exports = { WF, NOME, montar, ecoNome, DADOS };

if (require.main !== module) return;

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
    if (!proj) throw new Error('projeto do publicador nao achado');
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
    console.log('OK criado e ativo. Reinicie o n8n; dispara de 5 em 5 minutos. Nao chama API nenhuma.');
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
    const sw = rd[P.NO_SWITCH];
    let erros = 0;
    if (!sw) { console.log('XX o Switch nao executou'); erros++; }
    else {
      const saidas = ((sw[0] || {}).data || {}).main || [];
      console.log('o Switch abriu ' + saidas.length + ' saidas (esperado ' + P.TAMANHOS.length + ')');
      if (saidas.length !== P.TAMANHOS.length) erros++;
    }
    for (let i = 0; i < P.TAMANHOS.length; i++) {
      const n = P.TAMANHOS[i];
      const corrida = rd[ecoNome(n)];
      if (!corrida) { console.log('XX ' + ecoNome(n) + ': nao recebeu nada (saida ' + i + ' vazia)'); erros++; continue; }
      const itens = (((corrida[0] || {}).data || {}).main || [])[0] || [];
      const js = itens.map((x) => x.json);
      const certo = js.length === 1 && js[0].recebeu_saida === i && js[0].recebeu_n_imagens === n;
      if (!certo) erros++;
      console.log((certo ? 'ok ' : 'XX ') + ecoNome(n) + '  saida ' + i
        + '  recebeu ' + JSON.stringify(js));
    }
    console.log(erros ? '\n' + erros + ' problema(s) — NAO deployar' : '\nSwitch roteia certo nas '
      + P.TAMANHOS.length + ' saidas.');
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
