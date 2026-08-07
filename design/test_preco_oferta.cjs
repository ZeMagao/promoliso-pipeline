// Harness offline do patch_preco_oferta.cjs.
// Roda valorNumerico ANTIGA x NOVA contra TODAS as strings de preço que apareceram nas execuções
// guardadas + casos sintéticos, e verifica o gate `precoAtual <= 0` antes e depois.
// Só leitura. Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_preco_oferta.cjs
const { execSync } = require('child_process');
const flatted = require('/opt/promoliso/node_modules/flatted');
const DB = '/opt/promoliso/data/.n8n/database.sqlite';
const WF = 'NL8eVLKErgnIXBQq';

// ---------- ANTIGA (no ar hoje) ----------
function antiga(value) {
  const texto = String(value || '').replace(/[^\d,.-]/g, '').trim();
  if (!texto) return 0;
  const normalizado = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}
// ---------- NOVA (a do patch) ----------
function nova(value) {
  const texto = String(value || '');
  const NUM = '\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+,\\d{1,2}|\\d+\\.\\d{1,2}|\\d+';
  const comMoeda = texto.match(new RegExp('R\\$\\s*(' + NUM + ')', 'i'));
  const bruto = comMoeda ? comMoeda[1] : (texto.match(new RegExp(NUM)) || [])[0];
  if (!bruto) return 0;
  const soMilhar = /^\d{1,3}(?:\.\d{3})+$/.test(bruto);
  const normalizado = bruto.includes(',')
    ? bruto.replace(/\./g, '').replace(',', '.')
    : (soMilhar ? bruto.replace(/\./g, '') : bruto);
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}
const gratuita = (v) => /\b(?:gr[áa]tis|free|de\s+gra[çc]a|sem\s+custo)\b/i.test(String(v || ''));

// ---------- preços REAIS das execuções ----------
const execs = execSync(`sqlite3 "${DB}" "SELECT id FROM execution_entity WHERE workflowId='${WF}' AND status='success' ORDER BY id;"`)
  .toString().trim().split('\n').filter(Boolean);
const reais = [];
for (const id of execs) {
  let rd;
  try {
    const raw = execSync(`sqlite3 "${DB}" "SELECT data FROM execution_data WHERE executionId=${id};"`, { maxBuffer: 1024 * 1024 * 500 }).toString();
    if (!raw.trim()) continue;
    rd = flatted.parse(raw)?.resultData?.runData;
  } catch { continue; }
  if (!rd) continue;
  for (const r of (rd['Validar antes de publicar'] || [])) {
    const j = r?.data?.main?.[0]?.[0]?.json;
    const out = j?.output;
    if (!out || out.categoria !== 'OFERTA') continue;
    const of = out.oferta || {};
    for (const [campo, v] of [['preco_atual', of.preco_atual], ['preco_referencia', of.preco_referencia]]) {
      if (String(v || '').trim()) reais.push({ id, campo, texto: String(v) });
    }
  }
}

let falhas = 0;
console.log(`=== ${reais.length} strings de preço REAIS das execuções ===`);
for (const c of reais) {
  const a = antiga(c.texto), n = nova(c.texto);
  const marca = a === n ? '     ' : (n > 0 && a === 0 ? 'CURA ' : 'MUDA ');
  console.log(`${marca}exec ${String(c.id).padEnd(4)} ${c.campo.padEnd(16)} antiga=${String(a).padEnd(10)} nova=${String(n).padEnd(10)} ${c.texto.slice(0, 52)}`);
  // O invariante que importa: a nova NUNCA pode transformar preço que passava em preço que reprova.
  // Valor diferente num texto que nem é preço ("desconto de até 90%": antiga 0.9, nova 90) é ruído
  // em cima de ruído — o gate passa nos dois casos. Só falha se mudar valor de texto COM "R$".
  if (a > 0 && n <= 0) { falhas++; console.log('        >>> FALHA: a nova zerou um preço que passava'); }
  else if (a > 0 && n !== a && /R\$/.test(c.texto)) { falhas++; console.log('        >>> FALHA: mudou valor de texto COM R$'); }
}

// ---------- sintéticos: parsing ----------
console.log('');
console.log('=== casos sintéticos de parsing ===');
const casos = [
  ['R$ 99,96', 99.96],
  ['R$ 3.989,05 (ou 12x de R$ 332,43 sem juros)', 3989.05],
  ['R$ 4.499,90 (preço de lançamento oficial no Brasil)', 4499.9],
  ['12x de R$ 332,43 sem juros', 332.43],
  ['Grátis (R$ 0,00)', 0],
  ['R$ 1.299', 1299],
  ['1299.99', 1299.99],
  ['', 0],
  ['sem preço nenhum', 0],
  ['R$ 0,99', 0.99],
];
for (const [txt, esperado] of casos) {
  const n = nova(txt);
  const ok = Math.abs(n - esperado) < 0.001;
  if (!ok) falhas++;
  console.log(`   ${ok ? 'ok  ' : 'FALHA'} nova(${JSON.stringify(txt).slice(0, 46).padEnd(48)}) = ${n}${ok ? '' : `  esperava ${esperado}`}`);
}

// ---------- sintéticos: o gate precoAtual <= 0 ----------
console.log('');
console.log('=== gate "Preço atual inválido" (antes x depois) ===');
const gate = [
  { txt: 'Grátis (R$ 0,00)', esperaErro: false, nota: 'jogo grátis da Epic (exec 200)' },
  { txt: 'R$ 3.989,05 (ou 12x de R$ 332,43 sem juros)', esperaErro: false, nota: 'oferta legítima (exec 168)' },
  { txt: 'R$ 99,96', esperaErro: false, nota: 'oferta simples' },
  { txt: '', esperaErro: true, nota: 'preço vazio CONTINUA erro' },
  { txt: 'preço a combinar', esperaErro: true, nota: 'preço ilegível CONTINUA erro' },
  { txt: 'R$ 0,00', esperaErro: true, nota: 'zero SEM dizer grátis continua erro' },
];
for (const g of gate) {
  const erroAntes = antiga(g.txt) <= 0;
  const erroDepois = nova(g.txt) <= 0 && !gratuita(g.txt);
  const ok = erroDepois === g.esperaErro;
  if (!ok) falhas++;
  console.log(`   ${ok ? 'ok  ' : 'FALHA'} antes=${erroAntes ? 'ERRO ' : 'passa'} depois=${erroDepois ? 'ERRO ' : 'passa'}  ${g.nota}`);
}

console.log('');
console.log('#'.repeat(70));
console.log(falhas === 0
  ? 'TODOS OS CASOS OK — oferta legítima e jogo grátis passam; preço vazio ou ilegível continua reprovando.'
  : 'ATENCAO: ' + falhas + ' falha(s) — NÃO deployar.');
process.exit(falhas === 0 ? 0 : 1);
