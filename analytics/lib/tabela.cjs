// Escrita idempotente em Data Table. TODA gravação do módulo passa por aqui — é o único lugar
// onde existe INSERT/UPDATE, então a garantia de idempotência do PRD é verificável num lugar só.
//
// `upsert` casa pela coluna-chave (que tem índice UNIQUE parcial criado na migration). Reexecutar
// o mesmo coletor com os mesmos dados não cria linha nova e não muda `createdAt`.
//
// `somenteVazios: true` é a trava herdada do promo-fila-writeback.cjs: nunca sobrescreve valor que
// já existe. É o que impede um coletor de apagar um `instagram_post_id` bom porque a execução foi
// podada e ele leu vazio.
const { agoraUtc } = require('./db.cjs');
const dt = require('./datatable.cjs');

function vazio(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

async function colunas(w, dataTableId) {
  const info = await w.all(`PRAGMA table_info("${dt.prefixoFisico(dataTableId)}")`);
  return new Set(info.map((c) => c.name));
}

// Filtra campos que a tabela não tem. Sem isto, um coletor mais novo que o banco derrubaria a
// gravação inteira com "no such column" — com isto ele grava o que dá e avisa.
function filtrar(campos, permitidas, aviso) {
  const out = {};
  const descartados = [];
  for (const [k, v] of Object.entries(campos)) {
    if (permitidas.has(k)) out[k] = v; else descartados.push(k);
  }
  if (descartados.length && aviso) aviso(descartados);
  return out;
}

// `carimbos` são colunas que mudam a cada execução por natureza (ex.: analytics_atualizado_em).
// Elas NÃO contam como mudança: senão toda rodada gravaria todas as linhas e a idempotência
// ficaria impossível de observar no log — que foi exatamente o que apareceu no primeiro teste.
async function upsert(w, { dataTableId, chave, valorChave, campos, somenteVazios = false, carimbos = [], aviso }) {
  const tabela = dt.prefixoFisico(dataTableId);
  const permitidas = await colunas(w, dataTableId);
  const dados = filtrar({ ...campos, [chave]: valorChave }, permitidas, aviso);
  const t = agoraUtc();

  const existente = await w.get(`SELECT * FROM "${tabela}" WHERE "${chave}"=?`, [valorChave]);
  if (!existente) {
    const linha = { ...dados, createdAt: t, updatedAt: t };
    const cols = Object.keys(linha).map((k) => `"${k}"`).join(',');
    const phs = Object.keys(linha).map(() => '?').join(',');
    const r = await w.run(`INSERT INTO "${tabela}" (${cols}) VALUES (${phs})`, Object.values(linha));
    return { acao: 'insert', id: r.lastID, mudou: Object.keys(dados) };
  }

  const mudar = {};
  for (const [k, v] of Object.entries(dados)) {
    if (k === chave || carimbos.includes(k)) continue;
    if (somenteVazios && !vazio(existente[k])) continue;
    // gravação sem mudança é ruído: polui updatedAt e o log
    if (String(existente[k] ?? '') === String(v ?? '')) continue;
    mudar[k] = v;
  }
  if (!Object.keys(mudar).length) return { acao: 'sem-mudanca', id: existente.id, mudou: [] };
  for (const c of carimbos) if (dados[c] !== undefined) mudar[c] = dados[c];

  mudar.updatedAt = t;
  const sets = Object.keys(mudar).map((k) => `"${k}"=?`).join(', ');
  await w.run(`UPDATE "${tabela}" SET ${sets} WHERE id=?`, [...Object.values(mudar), existente.id]);
  return { acao: 'update', id: existente.id, mudou: Object.keys(mudar).filter((k) => k !== 'updatedAt') };
}

async function ler(w, dataTableId, where = '', params = []) {
  const tabela = dt.prefixoFisico(dataTableId);
  return w.all(`SELECT * FROM "${tabela}" ${where ? 'WHERE ' + where : ''}`, params);
}

async function existeTabela(w, dataTableId) {
  const r = await w.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [dt.prefixoFisico(dataTableId)]);
  return Boolean(r);
}

module.exports = { upsert, ler, colunas, existeTabela, vazio };
