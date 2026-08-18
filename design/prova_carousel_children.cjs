// BANCO DE PROVAS — descobrir, na instância REAL, qual forma de `carouselChildren` o n8n resolve.
//
// POR QUE ISTO EXISTE. Em 05/08 e de novo em 17/08 a mesma incógnita custou publicação: expressão
// no nível da coleção NÃO resolve, os filhos vêm vazios e o Instagram devolve `code 1`. As duas
// vezes a resposta veio de um slot perdido. Ler o código-fonte do n8n não bastou — errei o
// prognóstico lendo. E quatro tentativas de reproduzir o ambiente FORA de produção falharam.
//
// A saída é testar DENTRO da instância de produção, mas fora do publicador: um workflow próprio,
// temporário, que exercita as formas candidatas e NÃO publica nada. Ele só cria "containers" no
// Instagram — rascunhos que expiram em 24 h sozinhos. Nenhum post sai daqui.
//
// AS FORMAS TESTADAS (as urls são as 6 reais da peça 59 da fila, então imagem e proporção são as
// de produção):
//   V1 colecao-string   controle NEGATIVO — a forma que falhou em 17/08. TEM que falhar de novo; se
//                       passar, o diagnóstico daquele dia estava errado e nada aqui vale.
//   V5 estatico-6       controle POSITIVO — a forma EXATA que roda em produção agora, mesma
//                       quantidade, sem `media_type` (herdado do default do nó). Se este falhar, o
//                       banco de provas não é fiel e nenhum outro resultado vale nada. Esta linha
//                       existe porque na 1ª rodada um estático de 4 devolveu `{}` e eu não tinha
//                       como saber se a culpa era do tamanho, do campo explícito ou da bancada.
//   V4 estatico-4       o tijolo do plano B (Switch -> um nó por tamanho), na forma de produção.
//   V3 estatico-4-mt    igual ao V4 mas com `media_type: 'IMAGE'` escrito à mão — separa "tamanho
//                       diferente" de "campo explícito" como suspeito.
//   V2 child-string     a coleção continua objeto, mas `child` é UMA expressão que devolve o array.
//                       Seria a forma barata: um nó só, quantidade variável.
//
// COMO LER O RESULTADO: `--ver` resolve a execução e diz, por variante, se saiu id de container
// (resolveu) ou erro (não resolveu). Sem adivinhação de tempo, sem inferência.
//
// Uso, no VPS:
//   sudo -u promo node design/prova_carousel_children.cjs --criar    # insere e ativa (pede restart)
//   sudo -u promo node design/prova_carousel_children.cjs --ver      # lê a última execução
//   sudo -u promo node design/prova_carousel_children.cjs --remover  # apaga o workflow de prova
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'PRMLPROVACHILD1';
const NOME = 'PROVA - resolucao de carouselChildren (temporario)';
const PROJETO_DE = 'E27F7yVdsZRj';   // herda projeto e credencial do publicador

// As 6 urls reais da peça 59 (alerta da Bethesda), a mesma que o slot das 20:30 tentou publicar.
const URLS = [
  'https://res.cloudinary.com/fy2n2qvr/image/upload/v1787000506/xrg2ctdqtt7vjregla4m.jpg',
  'https://res.cloudinary.com/fy2n2qvr/image/upload/v1787000517/bxhdqb5zln4zaamqeqck.jpg',
  'https://res.cloudinary.com/fy2n2qvr/image/upload/v1787000519/a8b7qnuymciwd79es9od.jpg',
  'https://res.cloudinary.com/fy2n2qvr/image/upload/v1787000520/zgmevzcgdxk5qdxpygne.jpg',
  'https://res.cloudinary.com/fy2n2qvr/image/upload/v1787000521/ajzoycmmezyd5xtykr0x.jpg',
  'https://res.cloudinary.com/fy2n2qvr/image/upload/v1787000523/ktquyglr3lplwnbs8vpu.jpg',
];

const REF = (i) => (i === 0
  ? "$('Selecionar READY').item.json.cover"
  : "$('Selecionar READY').item.json.slides[" + (i - 1) + "]");

// V1: a coleção INTEIRA como expressão (a forma que falhou em 17/08).
const V1 = '={{ ({ child: [' + URLS.map((_, i) => REF(i)).join(', ')
  + "].map(u => ({ media_type: 'IMAGE', image_url: u })) }) }}";

// V2: coleção é objeto de verdade; só o array `child` é expressão. Quatro imagens.
const V2 = { child: '={{ [' + [0, 1, 2, 3].map(REF).join(', ')
  + "].map(u => ({ media_type: 'IMAGE', image_url: u })) }}" };

// Filhos estáticos, cada url em sua própria expressão — a forma que roda hoje. `semMt` reproduz
// produção ao pé da letra: sem `media_type`, que vem do default do nó ao carregar o workflow.
const estatico = (n, comMt) => ({
  child: Array.from({ length: n }, (_, i) => (comMt
    ? { media_type: 'IMAGE', image_url: '={{ ' + REF(i) + ' }}' }
    : { image_url: '={{ ' + REF(i) + ' }}' })),
});
const V5 = estatico(6, false);   // controle positivo: idêntico a produção
const V4 = estatico(4, false);   // plano B
const V3 = estatico(4, true);    // plano B com media_type escrito à mão

// Ordem importa: os controles primeiro, pra leitura não depender do que vem depois.
const VARIANTES = [
  { nome: 'V1 colecao-string', params: V1, espero: 'falhar' },
  { nome: 'V5 estatico-6', params: V5, espero: 'passar' },
  { nome: 'V4 estatico-4', params: V4, espero: 'passar' },
  { nome: 'V3 estatico-4-mt', params: V3, espero: 'passar' },
  { nome: 'V2 child-string', params: V2, espero: 'passar' },
];

const DADOS = '// imita o "Selecionar READY" do publicador: mesmos nomes de campo, mesmas urls reais.\n'
  + 'return [{ json: {\n'
  + '  cover: ' + JSON.stringify(URLS[0]) + ',\n'
  + '  slides: ' + JSON.stringify(URLS.slice(1)) + ',\n'
  + '} }];';

function montar(credencial) {
  const nodes = [
    { id: crypto.randomUUID(), name: 'Disparo da prova', type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2, position: [0, 0],
      // De 10 em 10 minutos: sao 5 nos e ~22 chamadas por rodada. Uma rodada basta; remover depois.
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 */10 * * * *' }] } } },
    { id: crypto.randomUUID(), name: 'Selecionar READY', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [240, 0], parameters: { jsCode: DADOS } },
  ];
  const connections = {
    'Disparo da prova': { main: [[{ node: 'Selecionar READY', type: 'main', index: 0 }]] },
    'Selecionar READY': { main: [[]] },
  };
  VARIANTES.forEach((v, i) => {
    nodes.push({
      id: crypto.randomUUID(), name: v.nome, type: 'n8n-nodes-instagram-integrations.instagram',
      typeVersion: 1, position: [520, i * 200 - 400],
      parameters: {
        resource: 'post', operation: 'createCarouselPost',
        carouselChildren: v.params,
        carouselCaption: 'PROVA TECNICA - este container nunca e publicado',
        carouselAdditionalOptions: {},
      },
      credentials: credencial,
      // continueRegularOutput: uma variante que falha não pode impedir as outras de rodar.
      // retryOnFail fica FORA de propósito: aqui o erro é o dado, não um problema a contornar.
      onError: 'continueRegularOutput',
    });
    connections['Selecionar READY'].main[0].push({ node: v.nome, type: 'main', index: 0 });
  });
  return { nodes, connections };
}

module.exports = { WF, NOME, VARIANTES, URLS, montar, V1, V2, V3, V4, V5, estatico };

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
    if (await get('SELECT id FROM workflow_entity WHERE id=?', [WF])) throw new Error('workflow de prova ja existe - rode --remover antes');
    const base = await get('SELECT nodes, settings FROM workflow_entity WHERE id=?', [PROJETO_DE]);
    const proj = await get('SELECT projectId FROM shared_workflow WHERE workflowId=?', [PROJETO_DE]);
    if (!base || !proj) throw new Error('publicador nao achado - de onde herdar credencial e projeto?');
    const cred = (JSON.parse(base.nodes).find((n) => n.type === 'n8n-nodes-instagram-integrations.instagram') || {}).credentials;
    if (!cred) throw new Error('credencial do Instagram nao achada no publicador');
    console.log('credencial herdada:', JSON.stringify(cred));

    const m = montar(cred);
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
    console.log('OK criado e ativo. Reinicie o n8n; dispara de 2 em 2 minutos.');
    console.log('    ATENCAO: ele NAO publica - so cria containers, que expiram em 24 h.');
  }

  if (modo === '--ver') {
    const ex = await get('SELECT id, status, datetime(startedAt,"-3 hours") AS inicio FROM execution_entity WHERE workflowId=? ORDER BY id DESC LIMIT 1', [WF]);
    if (!ex) { console.log('nenhuma execucao ainda - o n8n foi reiniciado? esperou 2 min?'); db.close(); return; }
    console.log('execucao ' + ex.id + '  ' + ex.inicio + ' BRT  status=' + ex.status + '\n');
    const linha = await get('SELECT data FROM execution_data WHERE executionId=?', [ex.id]);
    const pool = JSON.parse(linha.data);
    // ARMADILHA MEDIDA: `execution_data` e um pool `flatted` — TODA string virou indice. E um id do
    // Instagram e so digitos ("18102287780183918"), igualzinho a um indice. A 1a versao deste
    // leitor tratava o id como indice, caia fora do pool, virava undefined e o JSON.stringify
    // APAGAVA a chave: o no aparecia devolvendo `{}` mesmo nas publicacoes que deram certo. Por
    // isso o teto `< pool.length` — sem ele o leitor mente exatamente onde importa.
    const un = (x, d) => {
      if (d > 60) return '[deep]';
      if (typeof x === 'string' && /^[0-9]+$/.test(x) && Number(x) < pool.length) return un(pool[+x], d + 1);
      if (Array.isArray(x)) return x.map((v) => un(v, d + 1));
      if (x && typeof x === 'object') { const o = {}; for (const k in x) o[k] = un(x[k], d + 1); return o; }
      return x;
    };
    const rd = un(pool[0], 0).resultData.runData;
    let erros = 0;
    for (const v of VARIANTES) {
      const corrida = rd[v.nome];
      if (!corrida) { console.log('?  ' + v.nome + ': nao executou'); erros++; continue; }
      const saida = ((((corrida[0] || {}).data || {}).main || [])[0] || [])[0] || {};
      const j = saida.json || {};
      const ms = (corrida[0] || {}).executionTime;
      const passou = Boolean(j.id) && !j.error;
      // O tempo entra no relatorio de proposito: e ele que separa "nao chamou a API" de "chamou e
      // a API recusou". Sem isso a leitura de 17/08 teria ficado no achismo.
      const veredito = passou ? 'container=' + j.id
        : 'SEM ID  ' + JSON.stringify(j.error || j).slice(0, 150);
      const combina = (v.espero === 'passar') === passou;
      if (!combina) erros++;
      console.log((combina ? 'ok ' : 'XX ') + v.nome.padEnd(18) + ' espero=' + v.espero.padEnd(7)
        + String(ms).padStart(6) + 'ms  ' + veredito);
    }
    console.log(erros ? '\n' + erros + ' variante(s) fora do esperado - LER antes de decidir' : '\nTudo como esperado.');
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
