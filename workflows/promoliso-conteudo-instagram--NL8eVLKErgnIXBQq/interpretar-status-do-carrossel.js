const previous =
  $('Aguardar processamento do carrossel').item.json || {};
const response = $json || {};
const status = String(
  response.status_code ||
  (response.error ? 'ERROR' : previous.status_code) ||
  'IN_PROGRESS',
).toUpperCase();

return [{
  json: {
    ...previous,
    status_code: status,
    verification_attempt:
      Number(previous.verification_attempt || 0) + 1,
    status_error: String(
      response?.error?.message ||
      response?.message ||
      '',
    ).slice(0, 900),
  },
}];