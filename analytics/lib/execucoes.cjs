// Leitura das execuções do n8n. É daqui que sai quase todo o metadado da publicação — e é por isso
// que os coletores precisam rodar DENTRO da janela de retenção.
//
// PRAZO DE VALIDADE: `EXECUTIONS_DATA_PRUNE` está em 168 h / 150 execuções (ver OPERACAO-VPS.md).
// Depois disso o `execution_data` some. O coletor de publicações roda de hora em hora justamente
// para copiar o que interessa para uma Data Table, que é durável.
//
// TAMANHO: uma execução do produtor pesa ~8 MB (309 itens de feed com conteúdo inteiro). Ler todas
// de uma vez estoura memória. Por isso a leitura é uma por vez, e o `runData` é descartado logo
// depois de extrair os campos — nada de acumular payload em memória.
const { paraMs } = require('./db.cjs');

let flatted = null;
try { flatted = require('flatted'); } catch { flatted = null; }

function temFlatted() { return Boolean(flatted); }

// Devolve o runData de uma execução, ou null. Nunca lança: execução podada / corrompida é fato
// normal aqui, não erro.
async function runData(w, execucaoId) {
  if (!flatted) return null;
  let row;
  try { row = await w.get('SELECT data FROM execution_data WHERE executionId=?', [execucaoId]); } catch { return null; }
  if (!row || !row.data) return null;
  try { return flatted.parse(row.data)?.resultData?.runData || null; } catch { return null; }
}

// Primeiro item json de um nó. `qual` = 'primeiro' | 'ultimo' (nós que rodam N vezes, como os
// de retry, só interessam na última passada).
function saidaDoNo(rd, nome, qual = 'ultimo') {
  const runs = rd && rd[nome];
  if (!Array.isArray(runs) || !runs.length) return null;
  const run = qual === 'primeiro' ? runs[0] : runs[runs.length - 1];
  return run?.data?.main?.[0]?.[0]?.json || null;
}

// Todos os itens json de um nó (para pegar as N imagens do carrossel, por exemplo).
function itensDoNo(rd, nome, qual = 'ultimo') {
  const runs = rd && rd[nome];
  if (!Array.isArray(runs) || !runs.length) return [];
  const run = qual === 'primeiro' ? runs[0] : runs[runs.length - 1];
  return (run?.data?.main?.[0] || []).map((i) => i && i.json).filter(Boolean);
}

// Quantas vezes um nó rodou = quantas tentativas houve naquele ponto.
function tentativasDoNo(rd, nome) {
  const runs = rd && rd[nome];
  return Array.isArray(runs) ? runs.length : 0;
}

// Erro do nó, se houver. É o que vira `avisos`/`erro` na Data Table.
function errosDaExecucao(rd) {
  const out = [];
  for (const nome of Object.keys(rd || {})) {
    for (const run of rd[nome] || []) {
      if (run && run.error) {
        out.push({ no: nome, mensagem: String(run.error.message || run.error.description || 'erro sem mensagem').slice(0, 300) });
      }
    }
  }
  return out;
}

// Execuções de um workflow, mais novas primeiro, já com duração calculada.
async function listar(w, workflowId, { status, limite = 500 } = {}) {
  const cond = ['workflowId=?', 'deletedAt IS NULL'];
  const p = [workflowId];
  if (status) { cond.push('status=?'); p.push(status); }
  const rows = await w.all(
    `SELECT id, workflowId, status, startedAt, stoppedAt, mode FROM execution_entity ` +
    `WHERE ${cond.join(' AND ')} ORDER BY id DESC LIMIT ${Number(limite)}`, p);
  return rows.map((r) => {
    const ini = paraMs(r.startedAt);
    const fim = paraMs(r.stoppedAt);
    return { ...r, duracao_ms: Number.isFinite(ini) && Number.isFinite(fim) ? fim - ini : null };
  });
}

module.exports = { temFlatted, runData, saidaDoNo, itensDoNo, tentativasDoNo, errosDaExecucao, listar };
