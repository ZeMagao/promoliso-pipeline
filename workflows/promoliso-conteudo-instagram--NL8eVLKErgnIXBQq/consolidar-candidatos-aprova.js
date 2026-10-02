const selected =
  $('Preparar decisão manual da curadoria').item.json || {};
const noticia = selected.noticia || {};

return [{
  json: {
    candidatos: [{
      titulo: noticia.titulo,
      url: noticia.url_normalizada || noticia.url,
      publicado_em: noticia.data_publicacao || '',
      fonte: noticia.fonte || noticia.dominio_fonte || '',
      tipo_fonte: noticia.tipo_fonte || 'editorial',
      resumo: noticia.conteudo || '',
      autor: noticia.autor || '',
      imagem_principal: noticia.imagem_principal || '',
      imagens_oficiais:
        (Array.isArray(noticia.imagens_oficiais) && noticia.imagens_oficiais.length)
          ? noticia.imagens_oficiais
          : (noticia.imagem_principal ? [noticia.imagem_principal] : []),
      categoria_original: noticia.categoria_original || '',
      palavras_chave: noticia.palavras_chave || [],
      curation_key: noticia.curation_key,
      curadoria_id: selected.registro_id,
      pontuacao_curadoria: selected.registro?.pontuacao_total || 0,
      formato_recomendado:
        selected.registro?.formato_recomendado || 'nenhum',
    }],
    curadoria_aprovada: {
      id: selected.registro_id,
      curation_key: noticia.curation_key,
      decisao_manual: selected.decisao_manual,
      data_aprovacao: selected.data_aprovacao,
    },
  },
}];