// CARROSSEL DE QUANTIDADE VARIÁVEL — metade do publicador (etapa 1 de 2).
//
// PEDIDO DO DONO (17/08, depois de o passo 0 falhar): "eu quero que o carrossel variável funcione,
// não quero mais erros, certifique-se que irá fazer funcionar e não irá criar outros bugs".
//
// ESTE PATCH NÃO MUDA NENHUM POST. Toda peça na fila hoje tem 6 imagens (medido: 61 rows, 54 com 6
// e 2 FAILED com 5), então a peça continua indo pelo caminho de 6 — que sai byte a byte igual ao de
// hoje, com as mesmas urls na mesma ordem. O que este patch faz é abrir os outros tamanhos, que só
// passam a ser usados quando a etapa 2 (produtor) existir.
//
// -- POR QUE ASSIM, E NÃO COM UMA EXPRESSÃO --
//
// Medido no banco de provas (`design/prova_carousel_children.cjs`, execução 347 de 18/08, dentro da
// instância de produção, sem publicar nada — só containers, que expiram em 24 h):
//
//   V1 coleção inteira como expressão   FALHA   "service was not able to process your request"
//   V2 `child` como expressão           FALHA   "Bad request - please check your parameters"
//   V5 6 filhos estáticos (produção)    OK      container 18102415064183918   <- controle positivo
//   V4 4 filhos estáticos               OK      container 18102415193183918
//   V3 4 filhos estáticos + media_type  OK      container 18102415289183918
//
// Ou seja: expressão no parâmetro de coleção não resolve de forma nenhuma, e coleção estática
// resolve em qualquer tamanho. Sobra um caminho: um nó por tamanho, com um Switch escolhendo. É o
// plano B que estava escrito no plano desde 12/08 — agora com prova em vez de aposta.
//
// O controle positivo (V5) existe porque na primeira leitura os três estáticos pareceram falhar,
// devolvendo `{}`. Era bug do MEU leitor: `execution_data` é um pool `flatted` onde toda string é
// índice, e um id do Instagram é só dígitos — o id virava índice, caía fora do pool e a chave
// desaparecia. Sem o controle positivo eu teria "concluído" que estático de 4 não funciona.
//
// -- O QUE ENTRA --
//
//  1. `Selecionar READY` passa a devolver TODAS as imagens (`slice(1)` em vez de `slice(1,6)`),
//     mais `n_imagens` e `saida_carrossel`. A faixa 2..10 é garantida ali dentro.
//  2. `Quantas imagens?` — Switch em `mode: 'expression'`, 9 saídas. O índice é uma expressão de
//     string comum, forma que já roda em produção (é como o `carouselCaption` funciona).
//  3. `Carrossel 02` .. `Carrossel 10` — nove nós do Instagram, gerados do MESMO molde, diferindo
//     só na quantidade de filhos. Cada um herda credencial, retry e onError do nó de hoje.
//  4. O `Create a carousel post` sai. Nenhum código o cita por nome: `Preparar verificação` lê
//     `$json` e `Preparar FALHA` lê `$('Selecionar READY')` — por isso o leque de 9 nós pode
//     desaguar nos mesmos dois nós sem tocar em nenhum deles.
//
// `media_type: 'IMAGE'` vai escrito à mão em todo filho. Hoje ele não existe e funciona por um
// default que o n8n preenche em parâmetro aninhado — a mesma armadilha que teria transformado todo
// filho em VIDEO no passo 0. Escrito, não herdado (V3 provou que passa).
//
// -- O QUE FICA PARA A ETAPA 2 (produtor) --
// prompt, `Estruturar Saída`, `Validar antes de publicar` (os `=== 5` e o `!== 6`), a guarda da
// capa e o `Edit Fields` (que hoje crava `total: 6`). Enquanto isso não existir, o produtor segue
// gerando 6 e este patch fica inerte de propósito.
//
// ROLLBACK: `--reverter` volta o `Selecionar READY`, apaga os 10 nós novos e recria o
// `Create a carousel post` exatamente como estava.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'E27F7yVdsZRj';
const NO_SELECIONAR = 'Selecionar READY';
const NO_ANTIGO = 'Create a carousel post';
const NO_SWITCH = 'Quantas imagens?';
const NO_VERIFICACAO = 'Preparar verificação';
const NO_FALHA = 'Preparar FALHA';
const NO_ANTES = 'Marcar PUBLISHING';

const MIN_IMAGENS = 2;
const MAX_IMAGENS = 10;
const TAMANHOS = Array.from({ length: MAX_IMAGENS - MIN_IMAGENS + 1 }, (_, i) => i + MIN_IMAGENS);
const nomeCarrossel = (n) => 'Carrossel ' + String(n).padStart(2, '0');

// A referência de cada imagem, na ORDEM: capa primeiro, depois os slides.
const REF = (i) => (i === 0
  ? "$('" + NO_SELECIONAR + "').item.json.cover"
  : "$('" + NO_SELECIONAR + "').item.json.slides[" + (i - 1) + ']');

const filhos = (n) => ({
  child: Array.from({ length: n }, (_, i) => ({
    media_type: 'IMAGE',
    image_url: '={{ ' + REF(i) + ' }}',
  })),
});

// A forma exata que roda hoje: 6 filhos, sem media_type. Serve de âncora — se o que está no ar não
// for isto, alguém mexeu e o patch aborta em vez de sobrescrever.
const FILHOS_HOJE = {
  child: Array.from({ length: 6 }, (_, i) => ({ image_url: '={{ ' + REF(i) + ' }}' })),
};

const SWITCH_PARAMS = {
  mode: 'expression',
  numberOutputs: TAMANHOS.length,
  // Índice zero-based já calculado e validado no "Selecionar READY". Deixar a conta lá e não aqui
  // é o que impede índice fora da faixa: fora da faixa o Switch LANÇA erro (bom, não é silencioso),
  // mas o erro deixaria a row presa em PUBLISHING — o estado que nem publica nem alerta.
  output: "={{ $('" + NO_SELECIONAR + "').item.json.saida_carrossel }}",
  options: {},
};

const mesmo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Um molde só para os dois lados (aplicar e reverter), na MESMA ordem de chaves que o nó de
// produção tem. Ordem de chave não muda o comportamento do n8n, mas com um molde único o harness
// pode exigir igualdade byte a byte na volta — e igualdade frouxa esconde campo perdido.
function noDoCarrossel(id, nome, modelo, criancas, posicao) {
  const no = {
    id, name: nome, type: modelo.type, typeVersion: modelo.typeVersion, position: posicao,
    parameters: {
      resource: 'post', operation: 'createCarouselPost',
      carouselChildren: criancas,
      carouselCaption: modelo.parameters.carouselCaption,
      carouselAdditionalOptions: {},
    },
  };
  if (modelo.credentials) no.credentials = JSON.parse(JSON.stringify(modelo.credentials));
  no.onError = modelo.onError;
  no.retryOnFail = modelo.retryOnFail;
  no.maxTries = modelo.maxTries;
  no.waitBetweenTries = modelo.waitBetweenTries;
  return no;
}
const lf = (s) => String(s).split('\r\n').join('\n');
const fonte = (nome) => lf(fs.readFileSync(path.join(__dirname, nome), 'utf8'));

// ---------------------------------------------------------------------------------------------
// A costura, separada do banco pra poder ser testada sem VPS.
// ---------------------------------------------------------------------------------------------
function aplicar(nodes, connections, novoCodigo, uuid) {
  const gerarId = uuid || (() => crypto.randomUUID());
  if (nodes.some((n) => n.name === NO_SWITCH)) throw new Error(`${NO_SWITCH}: já existe — patch já aplicado?`);

  const antigo = nodes.find((n) => n.name === NO_ANTIGO);
  if (!antigo) throw new Error(`nó não achado: ${NO_ANTIGO}`);
  if (!mesmo(antigo.parameters.carouselChildren, FILHOS_HOJE)) {
    throw new Error(`${NO_ANTIGO}: os filhos em produção não são os que este patch conhece — alguém mexeu; revisar antes`);
  }
  const sel = nodes.find((n) => n.name === NO_SELECIONAR);
  if (!sel) throw new Error(`nó não achado: ${NO_SELECIONAR}`);
  for (const nome of [NO_VERIFICACAO, NO_FALHA, NO_ANTES]) {
    if (!nodes.some((n) => n.name === nome)) throw new Error(`nó não achado: ${nome}`);
  }
  // O leque de 9 nós vai desaguar nestes dois. Se algum deles lesse o nó do carrossel PELO NOME,
  // a fan-in quebraria em silêncio — então isso é conferido, não presumido.
  for (const nome of [NO_VERIFICACAO, NO_FALHA]) {
    const codigo = String((nodes.find((n) => n.name === nome).parameters || {}).jsCode || '');
    if (codigo.includes(NO_ANTIGO)) throw new Error(`${nome}: cita "${NO_ANTIGO}" pelo nome — a fan-in de 9 nós quebraria; revisar antes`);
  }

  // 1. o código novo do Selecionar READY
  sel.parameters.jsCode = novoCodigo;

  // 2. o Switch, no lugar onde o nó antigo estava
  const [x, y] = antigo.position;
  nodes.push({
    id: gerarId(), name: NO_SWITCH, type: 'n8n-nodes-base.switch', typeVersion: 3.4,
    position: [x - 80, y], parameters: JSON.parse(JSON.stringify(SWITCH_PARAMS)),
  });

  // 3. um nó por tamanho, todos do mesmo molde
  TAMANHOS.forEach((n) => {
    // o de 6 fica na altura do antigo; os outros abrem em leque, sem pisar em ninguém
    nodes.push(noDoCarrossel(gerarId(), nomeCarrossel(n), antigo, filhos(n), [x + 160, y + (n - 6) * 130]));
    connections[nomeCarrossel(n)] = { main: [
      [{ node: NO_VERIFICACAO, type: 'main', index: 0 }],
      [{ node: NO_FALHA, type: 'main', index: 0 }],
    ] };
  });

  // 4. o Switch aponta pra cada tamanho, na saída de índice n-2
  connections[NO_SWITCH] = { main: TAMANHOS.map((n) => [{ node: nomeCarrossel(n), type: 'main', index: 0 }]) };

  // 5. quem apontava pro nó antigo passa a apontar pro Switch
  let religados = 0;
  for (const origem of Object.keys(connections)) {
    for (const ramo of (connections[origem].main || [])) {
      for (const lig of (ramo || [])) {
        if (lig.node === NO_ANTIGO) { lig.node = NO_SWITCH; religados++; }
      }
    }
  }
  if (religados !== 1) throw new Error(`esperava 1 ligação chegando em ${NO_ANTIGO} e achei ${religados} — abortando`);

  // 6. fora o nó antigo
  delete connections[NO_ANTIGO];
  const i = nodes.findIndex((n) => n.name === NO_ANTIGO);
  nodes.splice(i, 1);

  // 7. o nó de verificação sai da frente do leque (só estética, mas o dono lê este canvas)
  const ver = nodes.find((n) => n.name === NO_VERIFICACAO);
  ver.position = [x + 400, y];

  conferir(nodes, connections);
  return { nodes, connections };
}

function reverter(nodes, connections, codigoAntigo, uuid) {
  const gerarId = uuid || (() => crypto.randomUUID());
  const sw = nodes.find((n) => n.name === NO_SWITCH);
  if (!sw) throw new Error(`${NO_SWITCH}: não existe — nada a reverter`);
  const modelo = nodes.find((n) => n.name === nomeCarrossel(6));
  if (!modelo) throw new Error(`${nomeCarrossel(6)}: não existe — reverter cegamente seria pior`);

  const [x, y] = sw.position;
  nodes.push(noDoCarrossel(gerarId(), NO_ANTIGO, modelo,
    JSON.parse(JSON.stringify(FILHOS_HOJE)), [x + 80, y]));
  connections[NO_ANTIGO] = { main: [
    [{ node: NO_VERIFICACAO, type: 'main', index: 0 }],
    [{ node: NO_FALHA, type: 'main', index: 0 }],
  ] };

  for (const origem of Object.keys(connections)) {
    for (const ramo of (connections[origem].main || [])) {
      for (const lig of (ramo || [])) if (lig.node === NO_SWITCH) lig.node = NO_ANTIGO;
    }
  }
  const fora = [NO_SWITCH].concat(TAMANHOS.map(nomeCarrossel));
  for (const nome of fora) delete connections[nome];
  for (const nome of fora) {
    const i = nodes.findIndex((n) => n.name === nome);
    if (i >= 0) nodes.splice(i, 1);
  }
  nodes.find((n) => n.name === NO_SELECIONAR).parameters.jsCode = codigoAntigo;
  nodes.find((n) => n.name === NO_VERIFICACAO).position = [x + 320, y];
  return { nodes, connections };
}

// Confere o que dá pra conferir sem rodar: ninguém órfão, ninguém apontando pro vazio, saída certa.
function conferir(nodes, connections) {
  const nomes = new Set(nodes.map((n) => n.name));
  for (const origem of Object.keys(connections)) {
    if (!nomes.has(origem)) throw new Error(`ligação saindo de nó que não existe: ${origem}`);
    for (const ramo of (connections[origem].main || [])) {
      for (const lig of (ramo || [])) {
        if (!nomes.has(lig.node)) throw new Error(`ligação apontando pro vazio: ${origem} -> ${lig.node}`);
      }
    }
  }
  const sw = connections[NO_SWITCH];
  if (!sw || sw.main.length !== TAMANHOS.length) throw new Error(`${NO_SWITCH}: esperava ${TAMANHOS.length} saídas`);
  TAMANHOS.forEach((n, i) => {
    const alvo = (sw.main[i] || [])[0];
    if (!alvo || alvo.node !== nomeCarrossel(n)) throw new Error(`saída ${i} do Switch deveria ir pra ${nomeCarrossel(n)}`);
    const no = nodes.find((x) => x.name === nomeCarrossel(n));
    if (no.parameters.carouselChildren.child.length !== n) throw new Error(`${nomeCarrossel(n)}: ${no.parameters.carouselChildren.child.length} filhos`);
  });
  const posicoes = nodes.map((n) => n.position.join(','));
  if (new Set(posicoes).size !== posicoes.length) throw new Error('dois nós na mesma posição');
}

module.exports = {
  WF, NO_SELECIONAR, NO_ANTIGO, NO_SWITCH, NO_VERIFICACAO, NO_FALHA, NO_ANTES,
  MIN_IMAGENS, MAX_IMAGENS, TAMANHOS, nomeCarrossel, REF, filhos, FILHOS_HOJE, SWITCH_PARAMS,
  aplicar, reverter, conferir, fonte, noDoCarrossel,
};

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
  const connections = JSON.parse(row.connections);
  if (REVERTER) {
    // O fixture é o jsCode COPIADO DO BANCO antes deste patch (1716 bytes), não o .src.js do patch
    // de frescor: aquele traz um cabeçalho de comentário que produção não tem, e reverter para ele
    // gravaria um texto diferente do que estava no ar.
    reverter(nodes, connections, fonte('selecionar_ready_antes_variavel.txt'));
    console.log('OK  revertido: um nó de carrossel de 6, Switch e leque removidos');
  } else {
    const novo = fonte('selecionar_ready_variavel.src.js');
    new Function(novo);
    aplicar(nodes, connections, novo);
    console.log(`OK  ${NO_SELECIONAR}  (devolve todas as imagens + saida_carrossel)`);
    console.log(`OK  ${NO_SWITCH}  (${TAMANHOS.length} saídas, índice por expressão)`);
    console.log(`OK  ${TAMANHOS.map(nomeCarrossel).join(', ')}`);
    console.log(`OK  ${NO_ANTIGO} removido`);
  }

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const connStr = JSON.stringify(connections);
  const V = crypto.randomUUID();
  const t = agora();
  const desc = REVERTER
    ? 'Reverte o carrossel variavel no publicador (volta pro no unico de 6)'
    : 'Publicador aceita carrossel de 2 a 10 imagens: Switch por quantidade + um no por tamanho';
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, connections=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, connStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, connStr, row.name, 1, desc, '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-carrossel-variavel.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
