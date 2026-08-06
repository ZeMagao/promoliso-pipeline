const items = $input
  .all()
  .map((item) => item.json || {});
const eligible = items
  .filter(
    (item) =>
      item.persistencia_ok &&
      item.elegivel_aprovacao &&
      item.registro?.status_aprovacao === 'CANDIDATO',
  )
  .sort((a, b) => {
    // Pauta que não renderiza vale 0: dá desempate pra quem tem arte suficiente pro
    // carrossel. 8 < 10 de propósito — arte não vence procedência.
    const imagensDistintas = (x) => {
      const noticia = x.noticia || {};
      const lista = Array.isArray(noticia.imagens_oficiais)
        ? noticia.imagens_oficiais
        : [];
      return new Set(
        [...lista, noticia.imagem_principal]
          .filter((u) => typeof u === 'string' && /^https:\/\//i.test(u))
          .map((u) => String(u).split(/[?#]/)[0].toLowerCase()),
      ).size;
    };
    const efetivo = (x) =>
      Number(x.registro?.pontuacao_total || 0) +
      (String(x.noticia?.tipo_fonte || '') === 'primaria' ? 10 : 0) +
      (imagensDistintas(x) >= 2 ? 8 : 0);
    const score = efetivo(b) - efetivo(a);
    if (score) return score;
    return (
      new Date(b.registro?.data_publicacao || 0) -
      new Date(a.registro?.data_publicacao || 0)
    );
  });

if (!eligible.length) {
  return [{
    json: {
      existe_pauta_aprovavel: false,
      total_avaliado: items.length,
      motivo: 'Nenhuma notícia atingiu 70 pontos com curadoria válida',
    },
  }];
}

return [{
  json: {
    ...eligible[0],
    existe_pauta_aprovavel: true,
    total_avaliado: items.length,
    total_aprovavel: eligible.length,
  },
}];