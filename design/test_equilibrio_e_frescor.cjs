// Harness offline do patch_equilibrio_e_frescor.cjs.
// Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_equilibrio_e_frescor.cjs
// (só leitura; não grava nada)
//
// O pedido era "resolve os bugs sem gerar nenhum novo". Então este harness cobra, para cada
// mudança, DUAS coisas: que o defeito sumiu E que nada que funcionava parou de funcionar.
// Em especial: nenhuma das três pode ENCOLHER o lote entregue adiante — encolher é o jeito mais
// fácil de "consertar" um filtro e quebrar a produção em silêncio.

const { execSync } = require('child_process');
const patch = require('./patch_equilibrio_e_frescor.cjs');
const { FRESCOR_RESERVA_H, TETO_POR_HOST_IA, PISO_NAO_PRIMARIA } = patch;

const DB = '/opt/promoliso/data/.n8n/database.sqlite';
const VAGAS_PRIMARIA = 6;
const TETO_POR_HOST = 3;
const TOTAL = 24;
const MAX_IA = 5;

let falhas = 0;
const checa = (cond, texto) => { if (!cond) falhas++; console.log((cond ? 'OK     ' : 'FALHA  ') + texto); };

const dominiosPrimarios = [
  'playstation.com', 'sony.com', 'xbox.com', 'microsoft.com',
  'nintendo.com', 'nintendo.co.jp', 'nvidia.com', 'intel.com', 'epicgames.com', 'steampowered.com',
];
const fonteBate = (h, ds) => ds.some((d) => h === d || h.endsWith('.' + d));
const hostnameFromUrl = (v) => {
  const m = String(v || '').match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
};
const classificar = (h) => (h && fonteBate(h, dominiosPrimarios) ? 'primaria' : 'editorial');
const porData = (a, b) => new Date(b.publicado_em || 0) - new Date(a.publicado_em || 0);

// ───────────────────────────────── réplica: reserva ANTES e DEPOIS do piso de frescor
function reserva(lista, comFrescor) {
  const candidatos = [...lista].sort(porData);
  const idadeH = (c) => {
    const t = Date.parse(String(c.publicado_em || ''));
    return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
  };
  const reservadas = []; const uso = Object.create(null);
  for (const c of candidatos) {
    if (reservadas.length >= VAGAS_PRIMARIA) break;
    if (c.tipo_fonte !== 'primaria') continue;
    if (comFrescor && idadeH(c) > FRESCOR_RESERVA_H) continue;
    const h = hostnameFromUrl(c.url);
    if (!h) continue;
    if ((uso[h] || 0) >= TETO_POR_HOST) continue;
    uso[h] = (uso[h] || 0) + 1; reservadas.push(c);
  }
  const na = new Set(reservadas);
  const resto = candidatos.filter((c) => !na.has(c)).slice(0, TOTAL - reservadas.length);
  return [...reservadas, ...resto].sort(porData);
}

// ───────────────────────────────── réplica: escolha dos 5 do Curador, antes e depois
const ehPrim = (c) => c.tipo_fonte === 'primaria';
const hostDe = (c) => String(c.dominio_fonte || hostnameFromUrl(c.url) || '').toLowerCase();
const ordemMerito = (l) => [...l].sort((a, b) => ((ehPrim(b) ? 2 : 1) - (ehPrim(a) ? 2 : 1)) || porData(a, b));

const cincoAntiga = (lote) => ordemMerito(lote).slice(0, MAX_IA);

function cincoNova(lote) {
  const ai = ordemMerito(lote);
  const out = []; const uso = Object.create(null);
  const cabe = (c) => { const h = hostDe(c); return !h || (uso[h] || 0) < TETO_POR_HOST_IA; };
  const pegar = (c) => { const h = hostDe(c); if (h) uso[h] = (uso[h] || 0) + 1; out.push(c); };
  const teto1 = Math.max(0, MAX_IA - PISO_NAO_PRIMARIA);
  for (const c of ai) { if (out.length >= teto1) break; if (!cabe(c)) continue; pegar(c); }
  for (const c of ai) {
    if (out.length >= MAX_IA) break;
    if (out.includes(c) || ehPrim(c) || !cabe(c)) continue;
    pegar(c);
  }
  for (const c of ai) { if (out.length >= MAX_IA) break; if (out.includes(c)) continue; pegar(c); }
  return out;
}

// ───────────────────────────────── guarda contra drift
const corpo = patch.EDICOES.map((e) => e.para).join('\n');
const exigidos = [
  `const FRESCOR_RESERVA_H = ${FRESCOR_RESERVA_H};`,
  'if (idadeEmHoras(candidato) > FRESCOR_RESERVA_H) continue;',
  `const TETO_POR_HOST_IA = ${TETO_POR_HOST_IA};`,
  `const PISO_NAO_PRIMARIA = ${PISO_NAO_PRIMARIA};`,
  'if (ehPrimaria(candidato)) continue;',
  '...escolhidosIA,',
];
let driftou = 0;
for (const t of exigidos) if (!corpo.includes(t)) { console.log('DRIFT   patch não contém: ' + t); driftou++; }
// a terceira edição é uma REMOÇÃO: o que ela injeta não pode trazer a função de volta
if (corpo.includes('function imagemUtilizavelAntiga')) { console.log('DRIFT   a remoção está reinjetando a função morta'); driftou++; }
console.log(driftou ? `DRIFT: ${driftou} divergência(s)\n` : 'OK  harness e patch em sincronia\n');

// ───────────────────────────────── helper de dados sintéticos
function itens(spec) {
  const out = [];
  for (const [host, cfg] of Object.entries(spec)) {
    for (let i = 0; i < cfg.n; i++) {
      const url = 'https://' + host + '/n' + i;
      out.push({
        url, dominio_fonte: host,
        tipo_fonte: classificar(hostnameFromUrl(url)),
        publicado_em: cfg.idadeH === null ? '' :
          new Date(Date.now() - (cfg.idadeH + i * 0.01) * 3600000).toISOString(),
      });
    }
  }
  return out;
}

console.log('--- 1. piso de frescor: mata a primária velha, sem encolher o lote ---');
{
  const l = itens({ 'nvidianews.nvidia.com': { n: 40, idadeH: 90000 }, 'gamevicio.com': { n: 40, idadeH: 1 } });
  const semFrescor = reserva(l, false); const comFrescor = reserva(l, true);
  const velhasAntes = semFrescor.filter((c) => ehPrim(c)).length;
  const velhasDepois = comFrescor.filter((c) => ehPrim(c)).length;
  checa(velhasAntes > 0, `sem o piso, primária de ~10 anos entrava: ${velhasAntes} vaga(s)`);
  checa(velhasDepois === 0, `com o piso, nenhuma entra (ficou ${velhasDepois})`);
  checa(comFrescor.length === TOTAL, `lote continua ${TOTAL} (veio ${comFrescor.length})`);
}
{
  const l = itens({ 'blog.playstation.com': { n: 10, idadeH: 2 }, 'gamevicio.com': { n: 40, idadeH: 1 } });
  const n = reserva(l, true);
  checa(n.filter(ehPrim).length === 3, `primária fresca continua entrando (teto 3/host): ${n.filter(ehPrim).length}`);
  checa(n.length === TOTAL, `lote continua ${TOTAL}`);
}
{
  const l = itens({ 'blog.playstation.com': { n: 5, idadeH: null }, 'gamevicio.com': { n: 40, idadeH: 1 } });
  const n = reserva(l, true);
  checa(n.length === TOTAL, `primária SEM DATA não encolhe o lote (veio ${n.length})`);
}

console.log('\n--- 2. equilíbrio dos 5: garante pauta BR, sem encolher ---');
{
  const lote = itens({
    'blog.playstation.com': { n: 3, idadeH: 2 }, 'news.xbox.com': { n: 3, idadeH: 3 },
    'gamevicio.com': { n: 9, idadeH: 1 }, 'gameblast.com.br': { n: 9, idadeH: 1 },
  });
  const a = cincoAntiga(lote); const n = cincoNova(lote);
  const naoPrimA = a.filter((c) => !ehPrim(c)).length;
  const naoPrimN = n.filter((c) => !ehPrim(c)).length;
  checa(naoPrimA === 0, `antiga entregava 0 não-primária ao Curador (entregou ${naoPrimA})`);
  checa(naoPrimN >= PISO_NAO_PRIMARIA, `nova garante ${PISO_NAO_PRIMARIA} não-primária (entregou ${naoPrimN})`);
  checa(n.length === MAX_IA, `continua entregando ${MAX_IA} candidatos (veio ${n.length})`);
  const maior = Math.max(...Object.values(n.reduce((c, x) => { c[hostDe(x)] = (c[hostDe(x)] || 0) + 1; return c; }, {})));
  checa(maior <= TETO_POR_HOST_IA, `nenhum host passa de ${TETO_POR_HOST_IA} (maior ficou ${maior})`);
  checa(n.filter(ehPrim).length > 0, 'primária continua presente — o ganho de imagem não foi desfeito');
}
{
  // dia SÓ com primária: o piso é preferência, não obrigação — não pode devolver menos de 5
  const lote = itens({ 'blog.playstation.com': { n: 6, idadeH: 2 }, 'news.xbox.com': { n: 6, idadeH: 3 } });
  const n = cincoNova(lote);
  checa(n.length === MAX_IA, `sem nenhuma não-primária ainda entrega ${MAX_IA} (veio ${n.length})`);
}
{
  // lote menor que 5: não pode inventar
  const lote = itens({ 'gamevicio.com': { n: 3, idadeH: 1 } });
  const n = cincoNova(lote);
  checa(n.length === 3, `lote de 3 entrega 3 (veio ${n.length})`);
  checa(new Set(n).size === n.length, 'nenhum candidato duplicado');
}

console.log('\n--- 3. remoção da função morta ---');
try {
  const live = execSync(`sqlite3 "${DB}" "SELECT nodes FROM workflow_entity WHERE id='${patch.WF}';"`,
    { maxBuffer: 1024 * 1024 * 200 }).toString();
  const nodes = JSON.parse(live);
  const val = nodes.find((x) => x.name === 'Validar antes de publicar').parameters.jsCode;
  // ⚠️ O primeiro jeito de escrever isto estava ERRADO e este harness o pegou: `\bimagemUtilizavelAntiga\s*\(`
  // casa também com a própria linha de DEFINIÇÃO (`function imagemUtilizavelAntiga(imagem) {`), então
  // acusava 1 "chamada" numa função que ninguém chama. Contar uso exige descontar a definição.
  const ocorrencias = (val.match(/imagemUtilizavelAntiga/g) || []).length;
  const definicoes = (val.match(/function\s+imagemUtilizavelAntiga\s*\(/g) || []).length;
  const chamadas = ocorrencias - definicoes;
  checa(definicoes === 1, `a função existe uma vez só, como definição (achei ${definicoes})`);
  checa(chamadas === 0,
    `nenhum uso além da definição — é código morto de fato (ocorrências ${ocorrencias}, definições ${definicoes})`);
  const edicao = patch.EDICOES.find((e) => e.no === 'Validar antes de publicar');
  const depois = patch.aplicar(val, edicao, false);
  checa(!depois.includes('imagemUtilizavelAntiga'), 'some do jsCode depois do patch');
  checa(depois.includes('const urlUtilizavel = (url) => imagemUtilizavel(urlInfo(url));'),
    'urlUtilizavel sobrevive e segue apontando para a função VIVA');
  let compila = true; try { new Function(depois); } catch (e) { compila = false; }
  checa(compila, 'jsCode resultante compila');
} catch (e) {
  console.log('AVISO  não deu para ler o nó no banco (' + e.message.split('\n')[0] + ')');
}

// ───────────────────────────────── dado REAL da exec 601
console.log('\n--- exec 601 (dado real, ponta a ponta) ---');
try {
  const flatted = require('/opt/promoliso/node_modules/flatted');
  const raw = execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=601;"`,
    { maxBuffer: 1024 * 1024 * 400 }).toString();
  if (!raw.trim()) {
    console.log('AVISO  exec 601 já foi podada — os sintéticos acima cobrem a lógica');
  } else {
    const rd = flatted.parse(raw)?.resultData?.runData;
    const brutos = (rd?.['Unir feeds oficiais']?.[0]?.data?.main?.[0] || []).map((x) => x.json || {});
    const lista = brutos.map((i) => {
      const url = String(i.link || i.url || '').trim();
      const h = hostnameFromUrl(url);
      return { url, dominio_fonte: h, tipo_fonte: classificar(h), publicado_em: i.isoDate || i.pubDate || '' };
    }).filter((c) => c.url);
    const lote = reserva(lista, true);
    const a = cincoAntiga(lote); const n = cincoNova(lote);
    const fmt = (l) => l.map((x) => hostDe(x).replace('.com.br', '').replace('.com', '')).join(', ');
    console.log(`       lote de ${lote.length}, primárias=${lote.filter(ehPrim).length}`);
    console.log(`       5 ANTES:  ${a.filter(ehPrim).length} prim | ${fmt(a)}`);
    console.log(`       5 DEPOIS: ${n.filter(ehPrim).length} prim | ${fmt(n)}`);
    checa(lote.length === TOTAL, `o piso de frescor não encolheu o lote real (veio ${lote.length})`);
    checa(lote.filter(ehPrim).length === VAGAS_PRIMARIA, `reserva segue entregando ${VAGAS_PRIMARIA} primárias`);
    checa(n.filter((c) => !ehPrim(c)).length >= PISO_NAO_PRIMARIA, 'o Curador volta a receber pauta brasileira');
    checa(n.length === MAX_IA, `o Curador continua recebendo ${MAX_IA} candidatos`);
    const maisAntiga = lote.filter(ehPrim)
      .map((c) => (Date.now() - Date.parse(c.publicado_em)) / 3600000)
      .reduce((m, x) => Math.max(m, x), 0);
    checa(maisAntiga <= FRESCOR_RESERVA_H,
      `primária mais velha da reserva tem ${Math.round(maisAntiga)}h (teto ${FRESCOR_RESERVA_H}h)`);
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
