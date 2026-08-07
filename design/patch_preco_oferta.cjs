// BUG #4 da lista de 2026-08-06: "Preço atual inválido" reprovando oferta LEGÍTIMA.
// Levantando todas as ofertas das execuções guardadas, o erro apareceu por DUAS causas distintas:
//
//   exec 168  preco_atual = "R$ 3.989,05 (ou 12x de R$ 332,43 sem juros)"   <- oferta real
//   exec 200  preco_atual = "Grátis (R$ 0,00)"                              <- jogo grátis da Epic
//
// CAUSA A — valorNumerico() não sabe ler preço com texto em volta.
// Ela fazia `replace(/[^\d,.-]/g,'')`, o que COLA números distintos:
//   "R$ 3.989,05 (ou 12x de R$ 332,43 sem juros)" -> "3.989,0512332,43"
//   -> includes(',') -> replace(/\./g,'') + replace(',','.') (só a 1ª vírgula!)
//   -> "3989.0512332,43" -> Number -> NaN -> return 0 -> "Preço atual inválido"
// Parcelamento é formato normal de preço no Brasil, então isso descarta oferta boa em silêncio.
// Agora: pega o primeiro valor logo depois de um "R$" (e, sem R$, o primeiro número do texto),
// entendendo o formato BR (ponto = milhar, vírgula = decimal). Preferir o valor colado no R$ evita
// pegar o "12" de "12x de R$ 332,43".
//
// CAUSA B — jogo grátis é oferta legítima e recorrente (Epic toda semana), mas preço 0 caía em
// `precoAtual <= 0`. Agora aceita quando o texto DIZ que é grátis. Preço vazio ou ilegível continua
// sendo erro — senão falha de extração passaria disfarçada de promoção.
//
// NÃO afrouxa a auditoria: `camposObrigatorios`, URL de loja conhecida, referência menor que o
// atual e "indisponível" seguem valendo igual.
//
// Versiona igual aos outros patches (draft + workflow_history + activeVersionId). Aceita --dry.
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';
const NODE = 'Validar antes de publicar';
const DRY = process.argv.includes('--dry');

const db = new sqlite3.Database(DB, DRY ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE);
const get = (q, p) => new Promise((r, j) => db.get(q, p || [], (e, x) => (e ? j(e) : r(x))));
const run = (q, p) => new Promise((r, j) => db.run(q, p || [], function (e) { e ? j(e) : r(this); }));
function now() {
  const d = new Date(); const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// ---------- A: valorNumerico entende preço com texto em volta ----------
const A_RE = /function valorNumerico\(value\) \{[\s\S]*?\n\}/;
const A_NOVO = `function valorNumerico(value) {
  const texto = String(value || '');
  // Antes: replace(/[^\\d,.-]/g,'') colava números distintos —
  // "R$ 3.989,05 (ou 12x de R$ 332,43 sem juros)" virava "3.989,0512332,43" -> NaN -> 0, e a
  // oferta legítima da exec 168 foi reprovada com "Preço atual inválido".
  // Agora pega UM valor: de preferência o que vem logo depois de um "R$" (assim "12x de R$ 332,43"
  // não devolve 12). Formato BR: ponto separa milhar, vírgula é decimal.
  const NUM = '\\\\d{1,3}(?:\\\\.\\\\d{3})+(?:,\\\\d{1,2})?|\\\\d+,\\\\d{1,2}|\\\\d+\\\\.\\\\d{1,2}|\\\\d+';
  const comMoeda = texto.match(new RegExp('R\\\\$\\\\s*(' + NUM + ')', 'i'));
  const bruto = comMoeda
    ? comMoeda[1]
    : (texto.match(new RegExp(NUM)) || [])[0];
  if (!bruto) return 0;
  // Com vírgula, o ponto é separador de milhar. SEM vírgula, "1.299" também é milhar e não
  // 1,299 — tratar como decimal devolvia 1.299 para "R$ 1.299" (pego pelo harness).
  const soMilhar = /^\\d{1,3}(?:\\.\\d{3})+$/.test(bruto);
  const normalizado = bruto.includes(',')
    ? bruto.replace(/\\./g, '').replace(',', '.')
    : (soMilhar ? bruto.replace(/\\./g, '') : bruto);
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}`;

// ---------- B: oferta grátis deixa de ser "preço inválido" ----------
const B_RE = /  if \(precoAtual <= 0\) erros\.push\('Preço atual inválido'\);/;
const B_NOVO = `  // Jogo grátis é oferta legítima e recorrente (Epic toda semana), mas caía aqui: a exec 200
  // reprovou "Epic Games Store libera Beacon Pines" com preco_atual "Grátis (R$ 0,00)".
  // Só aceita quando o texto DIZ que é grátis — preço vazio ou ilegível continua sendo erro,
  // senão uma falha de extração passaria disfarçada de promoção.
  const ofertaGratuita =
    /\\b(?:gr[áa]tis|free|de\\s+gra[çc]a|sem\\s+custo)\\b/i.test(String(oferta.preco_atual || ''));
  if (precoAtual <= 0 && !ofertaGratuita) erros.push('Preço atual inválido');`;

(async () => {
  const row = await get('SELECT nodes, connections, versionCounter, versionId, activeVersionId, name FROM workflow_entity WHERE id=?', [WF]);
  if (!row) throw new Error('workflow não achado: ' + WF);
  if (row.versionId !== row.activeVersionId) {
    throw new Error(`draft (${row.versionId}) != publicado (${row.activeVersionId}) — resolver no editor antes`);
  }
  const pub = await get('SELECT nodes FROM workflow_history WHERE versionId=?', [row.activeVersionId]);
  if (!pub || pub.nodes !== row.nodes) throw new Error('nodes do draft != nodes do workflow_history — abortando');

  const nodes = JSON.parse(row.nodes);
  const n = nodes.find((x) => x.name === NODE);
  if (!n) throw new Error('nó não achado: ' + NODE);
  let code = n.parameters.jsCode;
  const antes = code;

  for (const [nome, re, novo] of [
    ['A (valorNumerico lê preço com texto em volta)', A_RE, A_NOVO],
    ['B (oferta grátis não é preço inválido)', B_RE, B_NOVO],
  ]) {
    const achou = (code.match(new RegExp(re.source, (re.flags || '') + 'g')) || []).length;
    if (achou !== 1) throw new Error(`mudança ${nome}: esperava 1 trecho e achei ${achou} — abortando (já aplicado?)`);
    code = code.replace(re, novo);
    console.log('OK  mudança ' + nome);
  }

  // o resto da auditoria de oferta continua igual
  for (const p of [
    "erros.push('Oferta sem todos os dados obrigatórios')",
    "erros.push('Oferta sem URL direta de uma loja conhecida')",
    "erros.push('Preço de referência menor que o preço atual')",
    "erros.push('Oferta marcada como indisponível')",
    'ofertaAuditada',
  ]) {
    if (!code.includes(p)) throw new Error('sumiu algo que deveria continuar: ' + p);
  }
  if ((code.match(/function valorNumerico/g) || []).length !== 1) throw new Error('valorNumerico duplicada');
  new Function(code);

  n.parameters.jsCode = code;
  console.log('diff de chars:', code.length - antes.length, '| mudou:', code !== antes);
  if (DRY) { console.log('DRY — nada gravado.'); db.close(); return; }
  if (code === antes) { console.log('nada a gravar.'); db.close(); return; }

  const nodesStr = JSON.stringify(nodes);
  const V = crypto.randomUUID();
  const t = now();
  await run('BEGIN');
  try {
    await run('UPDATE workflow_entity SET nodes=?, versionId=?, activeVersionId=?, versionCounter=?, updatedAt=? WHERE id=?',
      [nodesStr, V, V, (row.versionCounter || 0) + 1, t, WF]);
    await run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [V, WF, 'Promo Liso', t, t, nodesStr, row.connections, row.name, 1,
       'preco de oferta: valorNumerico le preco com parcelamento/texto em volta + oferta gratis deixa de ser preco invalido', '[]']);
    await run('COMMIT');
  } catch (e) { await run('ROLLBACK'); throw e; }

  fs.writeFileSync(path.join(__dirname, '..', 'newversion-preco.txt'), V);
  console.log('OK gravado. versionId =', V);
  db.close();
})().catch((e) => { console.error('FAIL', e.message); try { db.close(); } catch {} process.exit(1); });
