// BANCO DE PROVAS: o nó de código do n8n consegue falar com a internet?
//
// POR QUE ISTO EXISTE. Para dar variedade de foto às peças, o fluxo precisa buscar as imagens
// oficiais do jogo (Steam) DEPOIS que a pauta foi escolhida — e nesse trecho não existe nó de
// HTTP livre. Ou o nó de código chama `fetch`, ou é cirurgia de conexão, que já quebrou a
// publicação por 3 dias em 05/08. Leitura de documentação não decide isso: em 17/08 eu li o
// código do n8n, concluí que expressão em fixedCollection resolvia, e custou um slot descobrir
// que não. Então: mede-se.
//
// Como: cria um workflow TEMPORÁRIO (webhook + um nó de código), ativa, e a resposta do webhook
// diz se `fetch` existe e se a chamada à Steam volta. Não publica nada, não toca no produtor nem
// no publicador.
//
//   node design/prova_fetch_code_node.cjs --criar      cria o temporário (precisa reiniciar o n8n)
//   node design/prova_fetch_code_node.cjs --apagar     remove o temporário
//
// CONTROLE POSITIVO embutido: o mesmo nó também faz uma conta simples e devolve o resultado. Se a
// conta vier e o fetch não, o problema é a rede/sandbox — não a bancada.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF_ID = 'PROVAFETCH0001';
const CAMINHO = 'prova-fetch-promoliso';

const CODIGO = `const r = { controle_positivo: 2 + 2, tem_fetch: typeof fetch };
try {
  const resposta = await fetch('https://store.steampowered.com/api/storesearch/?term=' +
    encodeURIComponent('Gears of War: E-Day') + '&cc=br&l=portuguese');
  const j = await resposta.json();
  const item = (j.items || [])[0] || null;
  r.steam_http = resposta.status;
  r.steam_nome = item ? item.name : null;
  r.steam_appid = item ? item.id : null;
} catch (e) {
  r.erro = String(e && e.message || e);
}
return [{ json: r }];`;

const NOS = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'Webhook da prova',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [0, 0],
    webhookId: 'b0000000-0000-4000-8000-000000000002',
    parameters: { httpMethod: 'GET', path: CAMINHO, responseMode: 'lastNode', options: {} },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    name: 'Tenta falar com a Steam',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [240, 0],
    parameters: { jsCode: CODIGO },
    onError: 'continueRegularOutput',
  },
];
const CONEXOES = { 'Webhook da prova': { main: [[{ node: 'Tenta falar com a Steam', type: 'main', index: 0 }]] } };

const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  rode no VPS: cd /opt/promoliso && sudo -u promo node design/' + path.basename(__filename) + ' --criar');
  process.exit(1);
}
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database(DB, sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));

function agora() {
  const d = new Date(); const p = (n, l) => String(n).padStart(l || 2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
    + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

(async () => {
  if (process.argv.includes('--apagar')) {
    await run('DELETE FROM workflow_history WHERE workflowId=?', [WF_ID]);
    await run('DELETE FROM shared_workflow WHERE workflowId=?', [WF_ID]);
    await run('DELETE FROM workflow_entity WHERE id=?', [WF_ID]);
    console.log('temporário removido — reinicie o n8n para ele sumir de verdade');
    db.close();
    return;
  }

  if (!process.argv.includes('--criar')) {
    console.log('use --criar ou --apagar');
    db.close();
    return;
  }

  const existente = await get('SELECT id FROM workflow_entity WHERE id=?', [WF_ID]);
  if (existente) throw new Error('o temporário já existe — rode --apagar antes');

  // O dono do workflow: reaproveita o mesmo projeto pessoal dos workflows de produção, senão ele
  // não aparece para ninguém e o n8n não o ativa.
  const dono = await get("SELECT projectId FROM shared_workflow WHERE workflowId='NL8eVLKErgnIXBQq' LIMIT 1");
  if (!dono) throw new Error('não achei o projeto dono do produtor');

  const V = crypto.randomUUID();
  const t = agora();
  const nodes = JSON.stringify(NOS);
  const conexoes = JSON.stringify(CONEXOES);
  await run('BEGIN');
  try {
    // Ordem importa: workflow_entity.activeVersionId aponta para workflow_history com ON DELETE
    // RESTRICT. Entra sem a versão, grava o histórico, e só então amarra os dois.
    await run('INSERT INTO workflow_entity (id,name,active,nodes,connections,createdAt,updatedAt,settings,staticData,pinData,versionId,activeVersionId,triggerCount,meta,parentFolderId,isArchived,versionCounter) '
      + "VALUES (?,?,1,?,?,?,?,'{\"executionOrder\":\"v1\"}',NULL,'{}',?,NULL,1,NULL,NULL,0,1)",
      [WF_ID, 'ZZ PROVA fetch no Code node (temporario)', nodes, conexoes, t, t, V]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF_ID, 'Promo Liso', t, t, nodes, conexoes, 'ZZ PROVA fetch no Code node (temporario)', 1, 'banco de provas', '[]']);
    await run('UPDATE workflow_entity SET activeVersionId=? WHERE id=?', [V, WF_ID]);
    await run('INSERT INTO shared_workflow (workflowId,projectId,role,createdAt,updatedAt) VALUES (?,?,?,?,?)',
      [WF_ID, dono.projectId, 'workflow:owner', t, t]);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  console.log('temporário criado. Agora:');
  console.log('  systemctl restart promo-n8n && sleep 25');
  console.log('  curl -s https://n8n.promoliso.com.br/webhook/' + CAMINHO);
  console.log('Depois: sudo -u promo node design/' + path.basename(__filename) + ' --apagar');
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch (x) {} process.exit(1); });
