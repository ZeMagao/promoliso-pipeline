// Normalização de chave e de domínio, num lugar só.
//
// A regra abaixo é a MESMA de "Preparar registro pendente" (workflows/.../preparar-registro-pendente.js):
//   minúscula -> tira query/fragmento -> tira barra final
// Ela está reescrita aqui em vez de importada porque aquele código roda dentro do n8n e não é
// importável de fora. Se a regra mudar lá, `test/test_chaves.cjs` acusa a divergência — é a mesma
// classe de bug que já mordeu este projeto duas vezes, então ela é testada de propósito.
function normalizarUrl(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

// Chave de conteúdo comparável entre promoliso_publicacoes, promoliso_fila e promoliso_curadoria_ai.
// Chaves sintéticas (error:171, tema:algo, rejected:65:https://...) passam intactas a menos que
// carreguem uma URL no fim — nesse caso a URL é o que interessa.
function chaveDeConteudo(valor) {
  const s = String(valor || '').trim();
  if (!s) return '';
  const m = s.match(/https?:\/\/\S+$/i);
  if (m) return normalizarUrl(m[0]);
  return s.toLowerCase();
}

function dominioDe(url) {
  const s = String(url || '').trim();
  const m = s.match(/^https?:\/\/([^/?#]+)/i);
  if (!m) return '';
  return m[1].toLowerCase().replace(/^www\./, '');
}

// Slot de publicação a partir da hora local (BRT). Os slots reais estão em OPERACAO-VPS.md:
// 12:30 diário, 20:30 diário, 16:30 ter/qua/sex. Publicação fora deles = execução manual/retry.
const SLOTS = ['12:30', '16:30', '20:30'];
function slotDe(horaLocal) {
  const s = String(horaLocal || '').trim();
  if (!/^\d{2}:\d{2}$/.test(s)) return '';
  const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const alvo = min(s);
  for (const slot of SLOTS) {
    // 45 min de folga: o publicador leva alguns minutos entre ler a fila e o post sair
    if (Math.abs(alvo - min(slot)) <= 45) return slot;
  }
  return 'FORA-DE-SLOT';
}

// Hora local (America/Sao_Paulo) a partir de um timestamp em ms. Sem depender de o processo estar
// com TZ certo — o systemd unit define TZ, mas script rodado à mão pode não estar.
function horaLocal(ms, tz) {
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz || 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ms));
  } catch { return ''; }
}

function dataLocal(ms, tz) {
  if (!Number.isFinite(ms)) return '';
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ms));
    return p; // en-CA dá YYYY-MM-DD
  } catch { return ''; }
}

module.exports = { normalizarUrl, chaveDeConteudo, dominioDe, slotDe, horaLocal, dataLocal, SLOTS };
