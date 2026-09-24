// Code node "Avaliar saude" do watchdog. Lê os outputs de "Ler curadoria" e
// "Ler fila" (via $()), detecta falha SILENCIOSA e retorna [] (saudável) ou
// [{assunto,corpo}] (problema -> email dispara).
const now = Date.now();
const H = 3600 * 1000;
const WINDOW = 28 * H;
const parseT = (v) => { const t = Date.parse(v); return isNaN(t) ? null : t; };

const tsOf = (r) => parseT(r.data_avaliacao) || parseT(r.data_coleta) || parseT(r.updatedAt) || parseT(r.createdAt);
const cur = $('Ler curadoria').all().map((i) => i.json);
const recent = cur.filter((r) => { const t = tsOf(r); return t && (now - t) <= WINDOW; });
// Olhar SÓ o último run (registros dentro de ~20min do mais recente). Assim uma
// recuperação limpa o alerta e o incidente de ontem (já resolvido) não conta.
const RUN_SPAN = 20 * 60 * 1000;
const maxT = recent.reduce((m, r) => Math.max(m, tsOf(r) || 0), 0);
const lastRun = maxT ? recent.filter((r) => (tsOf(r) || 0) >= maxT - RUN_SPAN) : [];
// Campos que de fato carregam erro. As colunas resposta_bruta_ia e resultados_dos_agentes ficam
// de FORA daqui: elas guardam a pagina raspada inteira (56 KB de HTML no caso que quebrou), e
// procurar "429" ali casa com coordenada de SVG, preco, dimensao, ID.
const campoErro = (r) => [r.erro_processamento, r.alertas, r.status_processamento, r.motivo]
  .map((x) => String(x || '')).join(' ');
const payloadCru = (r) => [r.resposta_bruta_ia, r.resultados_dos_agentes]
  .map((x) => String(x || '')).join(' ');
// So descemos no payload cru quando o registro esta REALMENTE em erro: ai o ruido de HTML nao
// importa, porque o registro ja e um problema por outro motivo.
const emErro = (r) => /erro|falha|fail/i.test(String(r.status_processamento || ''))
  || String(r.erro_processamento || '').trim() !== '';
const blob = (r) => emErro(r) ? campoErro(r) + ' ' + payloadCru(r) : campoErro(r);
// Expressoes que so aparecem em mensagem de API valem em qualquer lugar. O 429 solto e ambiguo
// demais (em 11/08 casou com um path de SVG: "-.429.197") e passa a valer so nos campos de erro.
const rateRe = /rate.?limit|insufficient_quota|exceeded your current quota|too many requests/i;
const re429 = /\b429\b/;
const comRate = lastRun.filter((r) => rateRe.test(blob(r)) || (emErro(r) && re429.test(campoErro(r))));

const fila = $('Ler fila').all().map((i) => i.json);
const pubs = fila.filter((r) => String(r.status || '').toUpperCase() === 'PUBLISHED');
let lastPub = 0;
pubs.forEach((r) => {
  const t = parseT(r.published_at) || parseT(r.created_at) || parseT(r.updatedAt);
  if (t && t > lastPub) lastPub = t;
});
const staleH = lastPub ? Math.round((now - lastPub) / H) : 999;

const problemas = [];
if (comRate.length) {
  problemas.push('OpenAI/curador com erro de cota/limite no ULTIMO run da curadoria (' + comRate.length + ' de ' + lastRun.length + ' registros com rate limit / quota). Pipeline provavelmente parado por saldo/limite da OpenAI.');
}
if (staleH >= 26) {
  problemas.push('Sem publicacao ha ~' + staleH + 'h (ultimo post: ' + (lastPub ? new Date(lastPub).toISOString() : 'desconhecido') + '). Checar feeds/curadoria/token.');
}

if (!problemas.length) return [];

const corpo = 'Watchdog PromoLiso detectou possivel falha SILENCIOSA (nao gera status=error):\n\n- '
  + problemas.join('\n- ')
  + '\n\nUltimo run da curadoria: ' + lastRun.length + ' registros. Publicacoes na fila: ' + pubs.length + '. Ultimo post ha ~' + staleH + 'h.'
  + '\n\nAcao: conferir saldo/limite da OpenAI, feeds e token do Instagram.';
return [{ json: { assunto: 'PromoLiso: possivel falha silenciosa no pipeline', corpo } }];
