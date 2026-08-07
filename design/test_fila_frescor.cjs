// Harness offline do patch_fila_frescor.cjs.
// Compara a escolha ANTIGA (mais nova) com a NOVA (mais perto de vencer) contra a fila REAL do
// banco + cenários sintéticos, e verifica os invariantes que garantem "não gerou outro bug":
//   I1  a nova NUNCA devolve vazio quando a antiga devolvia algo  (não perder slot)
//   I2  a nova só escolhe row com status READY
//   I3  com uma row só, as duas escolhem a mesma
//   I4  se nada está fresco, a nova escolhe EXATAMENTE o que a antiga escolheria (fallback)
//   I5  drenando a fila em sequência, toda row fresca acaba publicada (nenhuma apodrece)
// Só leitura. Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_fila_frescor.cjs
const { execSync } = require('child_process');
const DB = '/opt/promoliso/data/.n8n/database.sqlite';
const TABELA = 'data_table_user_i2e8ZwnL9kwOV6OG';
const FRESCOR_MAX_H = 48;

const H = 3600000;
const idadeH = (row, agora) => {
  const t = Date.parse(String(row.created_at || row.createdAt || ''));
  return Number.isFinite(t) ? (agora - t) / H : Infinity;
};
const maisNovaPrimeiro = (a, b) =>
  (Number(b.score || 0) - Number(a.score || 0)) || String(b.created_at || '').localeCompare(String(a.created_at || ''));

// ---------- ANTIGA (no ar hoje) ----------
function antiga(rows) {
  const ready = rows.filter((r) => String(r.status || '').toUpperCase() === 'READY');
  if (!ready.length) return null;
  return ready.slice().sort(maisNovaPrimeiro)[0];
}
// ---------- NOVA (a do patch) ----------
function nova(rows, agora) {
  const ready = rows.filter((r) => String(r.status || '').toUpperCase() === 'READY');
  if (!ready.length) return null;
  const porVencerPrimeiro = (a, b) =>
    (idadeH(b, agora) - idadeH(a, agora)) || (Number(b.score || 0) - Number(a.score || 0));
  const frescas = ready.filter((r) => idadeH(r, agora) <= FRESCOR_MAX_H);
  const fila = frescas.length ? frescas.slice().sort(porVencerPrimeiro) : ready.slice().sort(maisNovaPrimeiro);
  return fila[0];
}

const linhas = execSync(
  `sqlite3 -json "${DB}" "SELECT id,status,topic,score,created_at FROM ${TABELA};"`,
).toString();
const reais = JSON.parse(linhas || '[]');
const agora = Date.now();
const readyReais = reais.filter((r) => String(r.status).toUpperCase() === 'READY');

console.log(`fila real: ${reais.length} rows, ${readyReais.length} READY`);
for (const r of readyReais.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
  console.log(`   id=${String(r.id).padEnd(3)} ${idadeH(r, agora).toFixed(1).padStart(6)}h  ${String(r.topic).slice(0, 42)}`);
}
const a0 = antiga(reais), n0 = nova(reais, agora);
console.log(`ANTIGA escolhe: id=${a0?.id} (${idadeH(a0, agora).toFixed(1)}h)`);
console.log(`NOVA   escolhe: id=${n0?.id} (${idadeH(n0, agora).toFixed(1)}h)`);

let falhas = 0;
const checa = (cond, msg) => { if (!cond) { falhas++; console.log('   >>> FALHA: ' + msg); } };

// ---------- invariantes nos dados reais ----------
console.log('');
console.log('== invariantes na fila real');
checa(!(a0 && !n0), 'I1 nova devolveu vazio onde a antiga escolheu algo');
checa(!n0 || String(n0.status).toUpperCase() === 'READY', 'I2 nova escolheu row que não é READY');
if (!falhas) console.log('   I1, I2 ok');

// ---------- I5: drenar a fila em sequência ----------
console.log('');
console.log('== I5 drenagem sequencial (cada slot publica e remove a escolhida)');
let fila = reais.map((r) => ({ ...r }));
const ordem = [];
for (let slot = 0; slot < 10; slot++) {
  const esc = nova(fila, agora);
  if (!esc) break;
  ordem.push(esc.id);
  fila = fila.map((r) => (r.id === esc.id ? { ...r, status: 'PUBLISHED' } : r));
}
console.log('   ordem de publicação: ' + ordem.join(' -> '));
const frescasReais = readyReais.filter((r) => idadeH(r, agora) <= FRESCOR_MAX_H).map((r) => r.id);
checa(frescasReais.every((id) => ordem.includes(id)), 'I5 alguma row fresca nunca é publicada');
const idades = ordem.map((id) => idadeH(readyReais.find((r) => r.id === id) || {}, agora));
checa(idades.every((v, i) => i === 0 || v <= idades[i - 1] + 0.001), 'I5 ordem não é da mais velha para a mais nova');
if (!falhas) console.log('   I5 ok — drena da mais velha para a mais nova, ninguém fica pra trás');

// ---------- cenários sintéticos ----------
const iso = (h) => new Date(agora - h * H).toISOString();
const cenarios = [
  { nome: 'uma row só', rows: [{ id: 1, status: 'READY', score: 0, created_at: iso(5) }], esperaId: 1 },
  { nome: 'nada fresco (todas > 48h) -> fallback pra mais nova', rows: [
    { id: 1, status: 'READY', score: 0, created_at: iso(100) },
    { id: 2, status: 'READY', score: 0, created_at: iso(60) },
  ], esperaId: 2, esperaIgualAntiga: true },
  { nome: 'mistura: velha fresca vence a novinha', rows: [
    { id: 1, status: 'READY', score: 0, created_at: iso(40) },
    { id: 2, status: 'READY', score: 0, created_at: iso(1) },
  ], esperaId: 1 },
  { nome: 'stale + fresca: escolhe a fresca, ignora a vencida', rows: [
    { id: 1, status: 'READY', score: 0, created_at: iso(100) },
    { id: 2, status: 'READY', score: 0, created_at: iso(10) },
  ], esperaId: 2 },
  { nome: 'created_at ilegível + fresca', rows: [
    { id: 1, status: 'READY', score: 0, created_at: 'lixo' },
    { id: 2, status: 'READY', score: 0, created_at: iso(3) },
  ], esperaId: 2 },
  { nome: 'só não-READY -> as duas vazias', rows: [
    { id: 1, status: 'FAILED', score: 0, created_at: iso(2) },
  ], esperaId: null },
  { nome: 'desempate por score entre mesma idade', rows: [
    { id: 1, status: 'READY', score: 1, created_at: iso(10) },
    { id: 2, status: 'READY', score: 5, created_at: iso(10) },
  ], esperaId: 2 },
];

console.log('');
console.log('== cenários sintéticos');
for (const c of cenarios) {
  const a = antiga(c.rows), n = nova(c.rows, agora);
  const idN = n ? n.id : null, idA = a ? a.id : null;
  let linha = `   ${c.nome}: antiga=${idA} nova=${idN}`;
  if (idN !== c.esperaId) { falhas++; linha += `  >>> FALHA: esperava ${c.esperaId}`; }
  if (c.esperaIgualAntiga && idN !== idA) { falhas++; linha += '  >>> FALHA: I4 fallback deveria bater com a antiga'; }
  if (idA !== null && idN === null) { falhas++; linha += '  >>> FALHA: I1 perdeu slot'; }
  console.log(linha);
}

console.log('');
console.log('#'.repeat(70));
console.log(falhas === 0
  ? 'TODOS OS INVARIANTES OK — drena por frescor, nunca perde slot, nunca escolhe row inválida.'
  : 'ATENCAO: ' + falhas + ' falha(s) — NÃO deployar.');
process.exit(falhas === 0 ? 0 : 1);
