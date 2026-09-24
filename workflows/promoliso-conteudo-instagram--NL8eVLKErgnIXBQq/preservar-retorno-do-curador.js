const source =
  $('Preparar fila de curadoria').item.json || {};
const raw =
  $json.text ??
  $json.output ??
  $json.response ??
  '';
const error =
  $json.error?.message ??
  $json.error ??
  (!raw ? 'Agente Curador não retornou conteúdo' : '');

return {
  json: {
    ...source,
    resposta_bruta_curador:
      typeof raw === 'string' ? raw : JSON.stringify(raw),
    erro_curador: String(error || ''),
  },
};