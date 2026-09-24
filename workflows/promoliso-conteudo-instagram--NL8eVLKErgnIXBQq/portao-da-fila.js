// PORTÃO DA FILA — encerra a rodada quando já há peça fresca suficiente esperando vaga.
//
// Medido em 20/08 (14 dias): 55 peças criadas, 30 publicadas, 22 apodrecidas = 40% do custo de
// produção no lixo. O publicador tem de 4 a 6 vagas por janela de 48 h; o produtor entrega ~4 por
// dia. Não é problema de escolha — é de vazão.
const FRESCOR_MAX_H = 48;   // MESMO valor do publicador ("Selecionar READY"). Divergir entope a fila.
const N_MAX_FRESCAS = 3;    // medido por replay dos 14 dias, não derivado do cron
const PUBLICAVEIS = ['READY', 'RETRY'];    // os mesmos estados que o publicador considera

const rows = $input.all().map((i) => i.json);
const idadeH = (row) => {
  const t = Date.parse(String(row.created_at || row.createdAt || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};
const frescas = rows.filter((r) => PUBLICAVEIS.includes(String(r.status || '').toUpperCase())
  && idadeH(r) <= FRESCOR_MAX_H);

// FAIL-OPEN: leitura vazia significa "não sei", não "fila vazia". O nó lê no máximo 500 rows e a
// tabela cresce; no dia em que truncar, o certo é produzir (comportamento de hoje) e não emudecer.
if (!rows.length) {
  return [{ json: { portao: 'aberto', motivo: 'fila veio vazia — fail-open', frescas: null, limite: N_MAX_FRESCAS, rows: 0 } }];
}

if (frescas.length >= N_MAX_FRESCAS) {
  // Retornar [] corta o ramo: os 13 feeds não rodam, o curador não é chamado, o redator não escreve
  // e o Chrome não renderiza. É o ponto todo do portão.
  return [];
}
return [{ json: {
  portao: 'aberto',
  motivo: frescas.length + ' fresca(s) na fila, limite ' + N_MAX_FRESCAS,
  frescas: frescas.length,
  limite: N_MAX_FRESCAS,
  rows: rows.length,
  idade_da_mais_nova_h: frescas.length ? Math.round(Math.min(...frescas.map(idadeH)) * 10) / 10 : null,
} }];
