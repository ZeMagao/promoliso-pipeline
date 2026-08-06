const original =
  $('Unir resultados da curadoria').item.json || {};
const error =
  $json.error?.message ??
  $json.error ??
  '';
const persistedId = $json.id;
const ok = !error && persistedId !== undefined && persistedId !== null;

return {
  json: {
    ...original,
    registro_banco: $json,
    registro_id: ok ? persistedId : null,
    persistencia_ok: ok,
    erro_persistencia: ok
      ? ''
      : String(error || 'Banco não confirmou o registro da curadoria'),
  },
};