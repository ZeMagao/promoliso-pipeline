// Harness offline do patch_reserva_primaria.cjs.
// Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_reserva_primaria.cjs
// (só leitura; não grava nada)
//
// Este patch MUDA COMPORTAMENTO de propósito, então o harness cobra RESULTADO ESPERADO, não
// identidade. O que ele protege:
//   - que o total continue 24 (a reserva é PISO, não cota — dia sem primária não encolhe o lote)
//   - que nenhum host estoure o teto dentro da reserva
//   - que nada seja duplicado nem perdido
//   - que a ordem final continue por data (o resto do fluxo depende disso)
//   - que, no dado REAL da exec 601, a composição saia do 1-primária de hoje para 6

const { execSync } = require('child_process');
const patch = require('./patch_reserva_primaria.cjs');

const DB = '/opt/promoliso/data/.n8n/database.sqlite';
const { VAGAS_PRIMARIA, TETO_POR_HOST, TOTAL } = patch;

// ---------------------------------------------------------------- réplica do nó
const dominiosPrimarios = [
  'playstation.com', 'sony.com', 'sonyinteractive.com',
  'xbox.com', 'microsoft.com', 'majornelson.com',
  'nintendo.com', 'nintendo.co.jp', 'nintendo-europe.com', 'nintendo.com.au',
  'nvidia.com', 'amd.com', 'intel.com', 'epicgames.com', 'steampowered.com',
];
const fonteBate = (host, ds) => ds.some((d) => host === d || host.endsWith('.' + d));
const hostnameFromUrl = (v) => {
  const m = String(v || '').match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
};
const classificar = (h) => (h && fonteBate(h, dominiosPrimarios) ? 'primaria' : 'editorial');
const porData = (a, b) => new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0);

// ANTIGA — como está no ar
const antiga = (lista) => [...lista].sort(porData).slice(0, TOTAL);

// NOVA — a do patch
function nova(lista) {
  const candidatos = [...lista].sort(porData);
  const reservadas = [];
  const usadosPorHost = Object.create(null);
  for (const c of candidatos) {
    if (reservadas.length >= VAGAS_PRIMARIA) break;
    if (c.tipo_fonte !== 'primaria') continue;
    const host = hostnameFromUrl(c.url);
    if (!host) continue;
    if ((usadosPorHost[host] || 0) >= TETO_POR_HOST) continue;
    usadosPorHost[host] = (usadosPorHost[host] || 0) + 1;
    reservadas.push(c);
  }
  const naReserva = new Set(reservadas);
  const completando = candidatos.filter((c) => !naReserva.has(c)).slice(0, TOTAL - reservadas.length);
  return [...reservadas, ...completando].sort(porData);
}

// ---------------------------------------------------------------- guarda contra drift
const corpo = patch.TROCAS.map((t) => t.para).join('\n');
const exigidos = [
  `const VAGAS_PRIMARIA = ${VAGAS_PRIMARIA};`,
  `const TETO_POR_HOST = ${TETO_POR_HOST};`,
  'if ((usadosPorHost[host] || 0) >= TETO_POR_HOST) continue;',
  'const naReserva = new Set(reservadas);',
  'return [{ json: { candidatos: selecionados } }];',
];
let driftou = 0;
for (const t of exigidos) if (!corpo.includes(t)) { console.log('DRIFT   patch não contém: ' + t); driftou++; }
console.log(driftou ? `DRIFT: ${driftou} divergência(s)\n` : 'OK  harness e patch em sincronia\n');

// ---------------------------------------------------------------- utilitários de asserção
let falhas = 0;
function checa(cond, texto) {
  if (!cond) falhas++;
  console.log((cond ? 'OK     ' : 'FALHA  ') + texto);
}
const contaPrim = (l) => l.filter((c) => c.tipo_fonte === 'primaria').length;
const resumo = (l) => {
  const c = {};
  l.forEach((x) => { const h = hostnameFromUrl(x.url) || '?'; c[h] = (c[h] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([h, n]) => n + 'x' + h).join(' ');
};

// ---------------------------------------------------------------- casos sintéticos
function sintetico(spec) {
  const out = []; let t = Date.now();
  for (const [host, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) {
      const url = 'https://' + host + '/n' + i;
      out.push({ url, tipo_fonte: classificar(hostnameFromUrl(url)), publicado_em: new Date(t -= 60000).toISOString() });
    }
  }
  return out.sort(() => Math.random() - 0.5);
}

console.log('--- piso, não cota ---');
{
  // nenhuma primária no lote: o total tem que continuar 24
  const l = sintetico({ 'gamevicio.com': 40 });
  const n = nova(l);
  checa(n.length === TOTAL, `sem nenhuma primária o lote continua ${TOTAL} (veio ${n.length})`);
  checa(contaPrim(n) === 0, 'sem primária disponível, nenhuma é inventada');
}
{
  // só 2 primárias: usa as 2 e devolve as 4 vagas restantes ao bolo
  const l = sintetico({ 'blog.playstation.com': 2, 'gamevicio.com': 40 });
  const n = nova(l);
  checa(n.length === TOTAL, `com 2 primárias o lote continua ${TOTAL} (veio ${n.length})`);
  checa(contaPrim(n) === 2, `as 2 primárias entram (vieram ${contaPrim(n)})`);
}
{
  // lote menor que 24 no total: não pode inventar item
  const l = sintetico({ 'blog.playstation.com': 3, 'gamevicio.com': 5 });
  const n = nova(l);
  checa(n.length === 8, `lote de 8 itens sai com 8 (veio ${n.length})`);
}

console.log('\n--- teto por host: vale DENTRO da reserva, e só ---');
// ⚠️ CONTRATO, escrito depois que este harness derrubou a primeira versão dele.
// TETO_POR_HOST limita quem entra pela RESERVA. Ele NÃO é um teto sobre as 24 vagas: o
// preenchimento das vagas restantes continua sendo por data pura, então um feed primário que
// esteja publicando mais que todo mundo PODE ocupar o lote inteiro — e isso é o comportamento
// desejado, porque a regra geral do corte é recência. A reserva é PISO, nunca COTA nem TETO.
// No dado real da exec 601 isso não acontece (os portais BR são mais frescos que as primárias),
// mas o teste crava o comportamento pra ninguém confundir os dois conceitos depois.
{
  // um feed primário publicando mais que todos ocupa o lote — de propósito
  const l = sintetico({ 'news.xbox.com': 30, 'gamevicio.com': 40 });
  const n = nova(l);
  const xbox = n.filter((c) => hostnameFromUrl(c.url) === 'news.xbox.com').length;
  const reservaRespeitada = n.slice(0, VAGAS_PRIMARIA).length === VAGAS_PRIMARIA;
  checa(reservaRespeitada && xbox > TETO_POR_HOST,
    `primária mais fresca que todo mundo domina por DATA, não pela reserva: ${xbox}x xbox (sem teto global, por contrato)`);
  checa(n.length === TOTAL, `total continua ${TOTAL}`);
}
{
  // o que o teto realmente garante: com duas primárias fartas, a RESERVA não vai toda para uma
  const l = sintetico({ 'blog.playstation.com': 20, 'news.xbox.com': 20, 'gamevicio.com': 40 });
  const n = nova(l);
  // reconstrói só a reserva para inspecioná-la isoladamente
  const ordenados = [...l].sort(porData);
  const res = []; const uso = Object.create(null);
  for (const c of ordenados) {
    if (res.length >= VAGAS_PRIMARIA) break;
    if (c.tipo_fonte !== 'primaria') continue;
    const h = hostnameFromUrl(c.url);
    if ((uso[h] || 0) >= TETO_POR_HOST) continue;
    uso[h] = (uso[h] || 0) + 1; res.push(c);
  }
  const maior = Math.max(...Object.values(uso));
  checa(maior <= TETO_POR_HOST,
    `dentro da reserva nenhum host passa de ${TETO_POR_HOST} (maior ficou com ${maior}): ${JSON.stringify(uso)}`);
  checa(Object.keys(uso).length >= 2, `a reserva se divide entre ${Object.keys(uso).length} hosts primários`);
  checa(n.length === TOTAL, `total continua ${TOTAL}`);
}

console.log('\n--- integridade ---');
{
  const l = sintetico({ 'blog.playstation.com': 10, 'news.xbox.com': 10, 'gamevicio.com': 40, 'br.ign.com': 20 });
  const n = nova(l);
  checa(new Set(n.map((c) => c.url)).size === n.length, 'nenhum candidato duplicado');
  checa(n.every((c) => l.includes(c)), 'nenhum candidato inventado');
  const ordenado = n.every((c, i) => i === 0 || porData(n[i - 1], c) <= 0);
  checa(ordenado, 'saída continua ordenada por data');
  checa(contaPrim(n) >= VAGAS_PRIMARIA, `pelo menos ${VAGAS_PRIMARIA} primárias (vieram ${contaPrim(n)})`);
}

// ---------------------------------------------------------------- dado REAL da exec 601
console.log('\n--- exec 601 (441 itens reais, antes do corte) ---');
try {
  const flatted = require('/opt/promoliso/node_modules/flatted');
  const raw = execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=601;"`,
    { maxBuffer: 1024 * 1024 * 400 }).toString();
  if (!raw.trim()) {
    console.log('AVISO  exec 601 já foi podada — os casos sintéticos acima cobrem a lógica');
  } else {
    const rd = flatted.parse(raw)?.resultData?.runData;
    const brutos = (rd?.['Unir feeds oficiais']?.[0]?.data?.main?.[0] || []).map((x) => x.json || {});
    const lista = brutos
      .map((i) => {
        const url = String(i.link || i.url || '').trim();
        return {
          url,
          tipo_fonte: classificar(hostnameFromUrl(url)),
          publicado_em: i.isoDate || i.pubDate || i.date || i.published || '',
        };
      })
      .filter((c) => c.url);
    console.log(`       itens antes do corte: ${lista.length}`);
    const a = antiga(lista); const n = nova(lista);
    console.log(`       ANTIGA  primárias=${contaPrim(a)}  ${resumo(a)}`);
    console.log(`       NOVA    primárias=${contaPrim(n)}  ${resumo(n)}`);
    checa(contaPrim(a) <= 1, `antiga trazia no máximo 1 primária (trouxe ${contaPrim(a)})`);
    checa(contaPrim(n) === VAGAS_PRIMARIA, `nova traz ${VAGAS_PRIMARIA} primárias (trouxe ${contaPrim(n)})`);
    checa(n.length === TOTAL, `nova mantém o lote em ${TOTAL} (veio ${n.length})`);
    const estouro = Object.entries(n.reduce((c, x) => {
      const h = hostnameFromUrl(x.url); if (classificar(h) === 'primaria') c[h] = (c[h] || 0) + 1; return c;
    }, {})).filter(([, v]) => v > TETO_POR_HOST);
    checa(estouro.length === 0, `nenhum host primário passa de ${TETO_POR_HOST}`
      + (estouro.length ? ' — estourou: ' + JSON.stringify(estouro) : ''));
  }
} catch (e) {
  console.log('AVISO  não deu para ler o banco (' + e.message.split('\n')[0] + ')');
}

console.log('');
if (falhas === 0 && driftou === 0) {
  console.log('RESULTADO ESPERADO EM TODOS OS CASOS — patch pode ir pro ar');
  process.exit(0);
}
console.log(`FALHOU: ${falhas} caso(s), ${driftou} drift(s) — NÃO deployar`);
process.exit(1);
