return [{
  json: {
    operational_status: 'NO_SAFE_TOPIC',
    published: false,
    publicacao_bloqueada: true,
    message: 'Duas pautas foram pesquisadas, mas nenhuma reuniu fontes e imagens suficientes. Nada foi publicado.',
    finished_at: new Date().toISOString(),
  },
}];