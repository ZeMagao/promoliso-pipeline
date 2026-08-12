// PASSO A — provar, em produção, que o n8n resolve expressão no NÍVEL DA COLEÇÃO.
//
// Troca `carouselChildren` do nó "Create a carousel post" (publicador E27F7yVdsZRj) de lista
// estática para UMA expressão que devolve o objeto inteiro. O resultado é DELIBERADAMENTE
// idêntico ao de hoje: as mesmas 6 urls, na mesma ordem. Nada muda no post.
//
// POR QUE ISTO EXISTE. O carrossel de tamanho variável já foi tentado em 05/08 e derrubou a
// publicação por 3 dias: expressão em fixedCollection não resolveu, os children vieram vazios e o
// Instagram devolveu code 1. A leitura do código-fonte do n8n 2.30.4 diz que expressão no nível da
// coleção RESOLVE (getNodeParameter pega o valor cru, getParameterValue avalia string e devolve
// o objeto, cleanupParameterData só normaliza tipos e validateCollection não toca em caminho de um
// nível). Mas leitura não é execução, e quatro tentativas de reproduzir o ambiente fora de
// produção falharam por encanamento de instância nova. Então a prova vem daqui: mesma saída,
// forma nova. Se publicar, a resolução está provada e o passo B (quantidade variável) fica livre.
//
// ⚠️ A ARMADILHA QUE ESTE PATCH FECHA. Os filhos gravados hoje NÃO têm `media_type`. Funciona
// porque a descrição do nó declara `default: 'IMAGE'` e o n8n preenche defaults nos parâmetros
// aninhados ao carregar o workflow. Com a coleção virando string, não há mais onde descer pra
// aplicar esse default — e o nó faz `if (child.media_type === 'IMAGE') {...} else { video_url }`.
// Sem `media_type` explícito, TODO filho vira VIDEO com url indefinida e a publicação quebra.
// Por isso a expressão emite `media_type: 'IMAGE'` em cada filho.
//
// SE FALHAR: a publicação do slot falha, o monitor manda email e a row vai pra FAILED. Recuperar =
// rodar este patch com --reverter e devolver a row pra READY. Perde-se um slot, não a pauta.
//
// Uso:
//   node design/patch_carousel_expr_passoA.cjs --dry        (no VPS)
//   node design/patch_carousel_expr_passoA.cjs --reverter   (volta pra lista estática)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'E27F7yVdsZRj';
const NO = 'Create a carousel post';

// Forma atual: lista estática de 6, media_type vindo do default do nó.
const ANTES = {
  child: [
    { image_url: "={{ $('Selecionar READY').item.json.cover }}" },
    { image_url: "={{ $('Selecionar READY').item.json.slides[0] }}" },
    { image_url: "={{ $('Selecionar READY').item.json.slides[1] }}" },
    { image_url: "={{ $('Selecionar READY').item.json.slides[2] }}" },
    { image_url: "={{ $('Selecionar READY').item.json.slides[3] }}" },
    { image_url: "={{ $('Selecionar READY').item.json.slides[4] }}" },
  ],
};

// Forma nova: a coleção inteira como expressão. As mesmas 6 referências, na mesma ordem, sem
// filtro nem condicional — a intenção do passo A é que a saída seja indistinguível da de hoje.
const DEPOIS = "={{ ({ child: ["
  + "$('Selecionar READY').item.json.cover, "
  + "$('Selecionar READY').item.json.slides[0], "
  + "$('Selecionar READY').item.json.slides[1], "
  + "$('Selecionar READY').item.json.slides[2], "
  + "$('Selecionar READY').item.json.slides[3], "
  + "$('Selecionar READY').item.json.slides[4]"
  + "].map(u => ({ media_type: 'IMAGE', image_url: u })) }) }}";

const mesmo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function trocar(parametros, reverter) {
  const p = JSON.parse(JSON.stringify(parametros));
  if (reverter) {
    if (typeof p.carouselChildren !== 'string') throw new Error(`${NO}: já está na forma estática — nada a reverter`);
    p.carouselChildren = ANTES;
    return p;
  }
  if (typeof p.carouselChildren === 'string') throw new Error(`${NO}: já é expressão — patch já aplicado?`);
  if (!mesmo(p.carouselChildren, ANTES)) {
    throw new Error(`${NO}: os filhos em produção não são os que este patch conhece — alguém mexeu; revisar antes`);
  }
  p.carouselChildren = DEPOIS;
  return p;
}

// Avalia o corpo da expressão com as mesmas semânticas do n8n, pra provar que a SAÍDA é a mesma.
function avaliar(expr, dados) {
  const corpo = String(expr).replace(/^=\{\{/, '').replace(/\}\}$/, '');
  const $ = (nome) => {
    if (nome !== 'Selecionar READY') throw new Error('nó inesperado: ' + nome);
    return { item: { json: dados } };
  };
  return new Function('$', 'return (' + corpo + ');')($);
}

// O que o nó do Instagram faria com um conjunto de filhos (inclusive o ramo VIDEO).
function simularNo(children) {
  const corpos = [];
  if (children && Array.isArray(children.child)) {
    for (const child of children.child) {
      corpos.push(child.media_type === 'IMAGE'
        ? { is_carousel_item: true, media_type: 'IMAGE', image_url: child.image_url }
        : { is_carousel_item: true, media_type: 'VIDEO', video_url: child.video_url });
    }
  }
  return corpos;
}

module.exports = { WF, NO, ANTES, DEPOIS, trocar, avaliar, simularNo };

if (require.main !== module) return;

const sqlite3 = require('sqlite3');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Esta máquina não é mais fonte de verdade (n8n do Windows aposentado em 05/08).'
    + '\n      Ver data/.n8n/LEIA-ANTES-DE-RODAR-PATCH.md.'
    + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node ' + path.posix.join('design', path.basename(__filename)) + ' --dry');
  process.exit(1);
}
const DRY = process.argv.includes('--dry');
const REVERTER = process.argv.includes('--reverter');
const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) {
    throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  }
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const n = nodes.find((x) => x.name === NO);
  if (!n) throw new Error('nó não achado: ' + NO);

  const antes = JSON.parse(JSON.stringify(n.parameters));
  n.parameters = trocar(antes, REVERTER);

  // legenda e opções não podem ter sido tocadas
  if (n.parameters.carouselCaption !== antes.carouselCaption) throw new Error('a legenda mudou — abortando');
  if (!mesmo(n.parameters.carouselAdditionalOptions, antes.carouselAdditionalOptions)) throw new Error('as opções mudaram — abortando');
  console.log(`OK  ${NO}  ${REVERTER ? '(revertido para lista estática)' : '(coleção vira expressão)'}`);
  console.log('    carouselChildren agora é:', typeof n.parameters.carouselChildren === 'string' ? 'expressão' : 'lista estática');

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       REVERTER ? 'rollback: carrossel volta para lista estatica de 6 filhos'
                : 'passo A: children do carrossel viram expressao de colecao (mesma saida de hoje)', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-carousel-expr.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
