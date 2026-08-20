// RF-01/02/04/05/11 — cria as Data Tables novas do módulo de analytics.
//
// Não toca em nenhuma tabela existente. `down` apaga só o que este arquivo criou.
// A forma das tabelas vem de lib/schema.cjs (fonte única).
const { NOVAS } = require('../lib/schema.cjs');
const dt = require('../lib/datatable.cjs');

exports.descricao = 'cria promoliso_metricas, _versoes, _execucoes, _relatorios, _fontes';

exports.up = async ({ w, projectId, dry }) => {
  const plano = [];
  for (const chave of Object.keys(NOVAS)) {
    const t = NOVAS[chave];
    const ja = await dt.existe(w, t.id);
    plano.push({ tabela: t.nome, id: t.id, fisica: dt.prefixoFisico(t.id), colunas: t.colunas.length, acao: ja ? 'ja-existe' : 'criar' });
    if (dry || ja) continue;
    await dt.criar(w, { id: t.id, nome: t.nome, projectId, colunas: t.colunas });
  }
  return plano;
};

exports.down = async ({ w, dry }) => {
  const plano = [];
  // ordem inversa por simetria; não há FK entre elas, então a ordem não muda o resultado
  for (const chave of Object.keys(NOVAS).reverse()) {
    const t = NOVAS[chave];
    const ja = await dt.existe(w, t.id);
    plano.push({ tabela: t.nome, id: t.id, acao: ja ? 'remover' : 'nao-existe' });
    if (dry || !ja) continue;
    await dt.remover(w, t.id);
  }
  return plano;
};
