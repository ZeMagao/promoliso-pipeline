// O detector de cota do watchdog para de varrer HTML raspado atrás de "429".
//
// EM 11/08 O WATCHDOG MANDOU UM ALARME FALSO dizendo "OpenAI/curador com erro de cota/limite no
// ULTIMO run da curadoria (1 de 5 registros)". Não havia erro de cota nenhum. O registro apontado
// era o `257:6:1dr2qt1`, status `CURADO_APROVAVEL` — a curadoria tinha APROVADO o item.
//
// O que casou foi um trecho de path de SVG que veio no HTML do PlayStation Blog:
//
//     a.524.524 0 0 1-.429.197.783.783 0 0 1-.386-.099
//                    ^^^
//
// `\b429\b` casa aí porque, em regex, o ponto é fronteira de palavra: em `-.429.197` o 429 está
// cercado por `.` dos dois lados. O `blob()` varria `resposta_bruta_ia` e `resultados_dos_agentes`,
// que guardam a página raspada inteira — 56 KB de HTML no caso desse registro. Procurar um número
// de três dígitos ali dentro casa com coordenada de SVG, preço, dimensão de imagem, ID, data.
// `\bquota\b` solto tem o mesmo defeito: uma notícia sobre cota de armazenamento dispara o alerta.
//
// O CUSTO REAL: alerta falso ensina a ignorar alerta. E este mandava conferir SALDO da OpenAI —
// ou seja, empurrava pra gastar dinheiro por causa de um desenho vetorial.
//
// A CORREÇÃO tem duas camadas:
//
//   1. Onde procurar. Os campos que carregam erro (`erro_processamento`, `alertas`,
//      `status_processamento`) são sempre varridos. O payload cru só entra quando o registro
//      está DE FATO em estado de erro — aí o ruído de HTML não importa, porque o registro já é
//      um problema por outro motivo.
//   2. O que procurar. As expressões que só existem em mensagem de API (`insufficient_quota`,
//      `rate limit`, `too many requests`, `exceeded your current quota`) continuam valendo em
//      qualquer lugar. O `429` solto, que é ambíguo, passa a valer SÓ nos campos de erro.
//
// Cota de verdade continua sendo pega: a OpenAI grava `insufficient_quota` / `Rate limit reached`
// na mensagem, e o n8n põe isso em `erro_processamento` — o harness cobre os dois formatos.
//
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WF = 'MJly91QFGKep';
const NO = 'Avaliar saude';

const DE = String.raw`const blob = (r) => [r.erro_processamento, r.resposta_bruta_ia, r.resultados_dos_agentes, r.status_processamento, r.motivo, r.alertas]
  .map((x) => String(x || '')).join(' ');
const rateRe = /rate.?limit|insufficient_quota|\bquota\b|exceeded your current quota|\b429\b|too many requests/i;
const comRate = lastRun.filter((r) => rateRe.test(blob(r)));`;

const PARA = String.raw`// Campos que de fato carregam erro. As colunas resposta_bruta_ia e resultados_dos_agentes ficam
// de FORA daqui: elas guardam a pagina raspada inteira (56 KB de HTML no caso que quebrou), e
// procurar "429" ali casa com coordenada de SVG, preco, dimensao, ID.
const campoErro = (r) => [r.erro_processamento, r.alertas, r.status_processamento, r.motivo]
  .map((x) => String(x || '')).join(' ');
const payloadCru = (r) => [r.resposta_bruta_ia, r.resultados_dos_agentes]
  .map((x) => String(x || '')).join(' ');
// So descemos no payload cru quando o registro esta REALMENTE em erro: ai o ruido de HTML nao
// importa, porque o registro ja e um problema por outro motivo.
const emErro = (r) => /erro|falha|fail/i.test(String(r.status_processamento || ''))
  || String(r.erro_processamento || '').trim() !== '';
const blob = (r) => emErro(r) ? campoErro(r) + ' ' + payloadCru(r) : campoErro(r);
// Expressoes que so aparecem em mensagem de API valem em qualquer lugar. O 429 solto e ambiguo
// demais (em 11/08 casou com um path de SVG: "-.429.197") e passa a valer so nos campos de erro.
const rateRe = /rate.?limit|insufficient_quota|exceeded your current quota|too many requests/i;
const re429 = /\b429\b/;
const comRate = lastRun.filter((r) => rateRe.test(blob(r)) || (emErro(r) && re429.test(campoErro(r))));`;

function trocar(code) {
  if (code.includes('const re429')) throw new Error(`${NO}: patch já aplicado?`);
  const vezes = code.split(DE).length - 1;
  if (vezes !== 1) throw new Error(`${NO}: esperava 1 bloco do detector e achei ${vezes} — abortando`);
  const novo = code.split(DE).join(PARA);
  if ((novo.match(/const comRate =/g) || []).length !== 1) throw new Error(`${NO}: comRate declarado != 1 vez`);
  if (/resultados_dos_agentes[^\n]*rateRe/.test(novo)) throw new Error(`${NO}: payload cru ainda entra no detector`);
  new Function(novo); // não grava código que nem parseia
  return novo;
}

module.exports = { NO, WF, DE, PARA, trocar };

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
  const n = nodes.find((x) => x.name === NO);
  if (!n) throw new Error('nó não achado: ' + NO);
  const antes = n.parameters.jsCode;
  const depois = trocar(antes);
  n.parameters.jsCode = depois;
  console.log(`OK  ${NO}  (${depois.length - antes.length} chars)`);

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
       'watchdog: detector de cota para de varrer HTML raspado atras de 429', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-watchdog-ruido.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
