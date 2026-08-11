// CAPA FULL-BLEED — a capa deixa de usar o layout de notícia e passa a ser a própria imagem.
//
// Layout novo em design/capa_fullbleed.src.js (ali está o porquê de cada decisão). Este arquivo só
// costura: acha o buildCapa() atual dentro do jsCode do nó, confere que é exatamente o que
// esperamos (sha256 fixado) e troca pelo bloco novo.
//
// Por que sha em vez de string literal do código antigo: o buildCapa atual tem template literal
// com ${} dentro, e reescrever isso escapado dentro deste patch é convite a erro silencioso. O
// bloco é localizado por marcador e VERIFICADO pelo hash — se produção divergir do que a gente
// leu, o patch para em vez de sobrescrever algo que não conhece.
//
// DOIS nós carregam um buildCapa byte a byte idêntico:
//   - "Code in JavaScript1"  -> é o que roda (termina em `return buildCapa(data)`)
//   - "Code in JavaScript"   -> cópia MORTA (esse nó termina em `return buildSlide(slide)`)
// Os dois são trocados. Deixar a cópia morta pra trás criaria justamente a armadilha de regra
// duplicada que já mordeu neste repo (URL do Cloudinary montada em 3 arquivos).
//
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'NL8eVLKErgnIXBQq';

// Marcadores do bloco a substituir. INICIO é a assinatura da função; FIM_ANCORA é a última linha
// dela — o bloco vai da assinatura até o `\n}` que fecha logo depois dessa âncora.
const INICIO = 'function buildCapa(output){';
const FIM_ANCORA = 'return [{ json: { html, capaUsada';

// sha256 do buildCapa que está em produção hoje (conferido contra os dois nós exportados).
const SHA_ANTIGO = '760f511ffc16d469ac2f9b3fc52391159b1850f4711062d7d326c28a405e4448';

// Qual dos três modelos vai pro ar. `capa_base.src.js` (gate, trim, rodapé) é comum aos três;
// o arquivo do modelo traz só a composição visual e o buildCapa.
//
// A escolha mora em capa_modelo_escolhido.txt, versionado, NÃO em variável de ambiente: o
// deploy-vps.sh chama o patch com `sudo -u promo node`, e o sudo apaga o ambiente — um
// CAPA_MODELO=b na linha de comando chegaria aqui como undefined e deployaria o modelo errado
// em silêncio. A variável continua valendo pra teste local, onde não há sudo no caminho.
const ESCOLHA = path.join(__dirname, 'capa_modelo_escolhido.txt');
const MODELO = (process.env.CAPA_MODELO || fs.readFileSync(ESCOLHA, 'utf8')).trim().toLowerCase();
if (!['a', 'b', 'c'].includes(MODELO)) throw new Error('modelo inválido: ' + JSON.stringify(MODELO));

// o cabeçalho de comentário de cada arquivo explica a escolha pra quem lê o repo; dentro do nó
// só atrapalha, então sai na hora de montar
const semCabecalho = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n|\n)*/, '')
  .trim();

const NOVO = semCabecalho('capa_base.src.js') + '\n\n' + semCabecalho('capa_modelo_' + MODELO + '.src.js');

const ALVOS = ['Code in JavaScript1', 'Code in JavaScript'];

// Recorta o buildCapa de dentro do jsCode do nó. Devolve null se não achar.
function recortarBuildCapa(code) {
  const i = code.indexOf(INICIO);
  if (i < 0) return null;
  const ancora = code.indexOf(FIM_ANCORA, i);
  if (ancora < 0) return null;
  const j = code.indexOf('\n}\n', ancora);
  if (j < 0) return null;
  return { inicio: i, fim: j + 2, texto: code.slice(i, j + 2) };
}

function trocar(code, nomeNo, bloco) {
  bloco = bloco || NOVO;
  if (code.includes('function capaImg(')) {
    throw new Error(`${nomeNo}: capaImg já existe — patch já aplicado?`);
  }
  const vezes = code.split(INICIO).length - 1;
  if (vezes !== 1) throw new Error(`${nomeNo}: esperava 1 buildCapa e achei ${vezes} — abortando`);

  const antigo = recortarBuildCapa(code);
  if (!antigo) throw new Error(`${nomeNo}: não consegui delimitar o buildCapa`);

  const sha = crypto.createHash('sha256').update(antigo.texto).digest('hex');
  if (sha !== SHA_ANTIGO) {
    throw new Error(`${nomeNo}: buildCapa em produção não é o esperado (sha ${sha}) — alguém mexeu; revisar antes`);
  }

  const novo = code.slice(0, antigo.inicio) + bloco + code.slice(antigo.fim);

  // o contrato de saída do nó não pode mudar: quem consome espera html + capaUsada + output
  if (!/return \[\{ json: \{ html, capaUsada: source, output \} \}\];/.test(novo)) {
    throw new Error(`${nomeNo}: o retorno de buildCapa mudou de forma — abortando`);
  }
  if ((novo.match(/function buildCapa\(/g) || []).length !== 1) {
    throw new Error(`${nomeNo}: buildCapa declarado != 1 vez`);
  }
  new Function(novo); // não grava código que nem parseia
  return novo;
}

// Monta o bloco de um modelo específico sem depender da variável de ambiente — o preview e o
// harness pedem os três, o patch grava só o escolhido.
function blocoDoModelo(modelo) {
  return semCabecalho('capa_base.src.js') + '\n\n' + semCabecalho('capa_modelo_' + modelo + '.src.js');
}

module.exports = { ALVOS, NOVO, MODELO, SHA_ANTIGO, recortarBuildCapa, trocar, blocoDoModelo, INICIO };

// Nada de efeito colateral antes daqui: o harness importa este módulo e o sqlite3 é binário
// nativo que só existe no VPS.
if (require.main !== module) return;

const sqlite3 = require('sqlite3');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
// Sem isto o erro é um SQLITE_CANTOPEN cru, que não diz o principal: rodar patch fora do VPS
// valida contra um snapshot de 04/08 e responde com confiança sobre código que não existe mais.
if (!fs.existsSync(DB)) {
  console.error('FAIL  banco do n8n não existe aqui: ' + DB
    + '\n      Esta máquina não é mais fonte de verdade (n8n do Windows aposentado em 05/08).'
    + '\n      Ver data/.n8n/LEIA-ANTES-DE-RODAR-PATCH.md.'
    + '\n      Rode no VPS:  cd /opt/promoliso && sudo -u promo node ' + path.posix.join('design', path.basename(__filename)) + ' --dry');
  process.exit(1);
}
const DRY = process.argv.includes('--dry');
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
  let mudou = false;

  for (const nomeNo of ALVOS) {
    const n = nodes.find((x) => x.name === nomeNo);
    if (!n) throw new Error('nó não achado: ' + nomeNo);
    const antes = n.parameters.jsCode;
    const depois = trocar(antes, nomeNo);
    n.parameters.jsCode = depois;
    mudou = mudou || depois !== antes;
    console.log(`OK  ${nomeNo}  (${depois.length - antes.length} chars)`);
  }

  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
  if (!mudou) { console.log('nada a gravar.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'capa vira a propria imagem (full-bleed) com gate de resolucao no proprio Cloudinary', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-capa-fullbleed.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
