// Guarda contra a TERCEIRA cópia dos limites de texto.
//
// Depois do patch_limites_unicos.cjs, truncagem e checagem leem do mesmo `LIMITES` no validador.
// Sobra uma cópia que não dá pra unificar em runtime: o `systemMessage` do nó "AI Agent", que é
// texto estático de outro nó e é o que instrui o modelo ("titulo: ... até 42 caracteres").
//
// Este script compara os dois e falha se divergirem. Rodar SEMPRE depois de mexer no prompt ou nos
// limites — é a diferença entre um erro de deploy e semanas sem publicar (foi o que aconteceu em
// 2026-08-05, quando um rollback reverteu só uma das cópias).
//
// Só leitura. Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/verifica_limites.cjs
const { execSync } = require('child_process');
const path = require('path');

const DB = path.join(__dirname, '..', 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';

const nodes = JSON.parse(
  execSync(`sqlite3 "${DB}" "SELECT nodes FROM workflow_entity WHERE id='${WF}';"`, { maxBuffer: 1024 * 1024 * 200 }).toString(),
);
const validador = nodes.find((x) => x.name === 'Validar antes de publicar');
const agente = nodes.find((x) => x.name === 'AI Agent');
if (!validador) throw new Error('nó "Validar antes de publicar" não achado');
if (!agente) throw new Error('nó "AI Agent" não achado');

const codigo = validador.parameters.jsCode;
const decl = codigo.match(/const LIMITES = \{([^}]*)\}/);
if (!decl) {
  console.error('FAIL: não achei `const LIMITES` no validador — patch_limites_unicos.cjs não está aplicado?');
  process.exit(1);
}
const LIMITES = Function('return {' + decl[1] + '}')();
console.log('LIMITES no validador: ' + JSON.stringify(LIMITES));

const prompt = String(agente.parameters?.options?.systemMessage || '');
if (!prompt) { console.error('FAIL: systemMessage do "AI Agent" está vazio'); process.exit(1); }
console.log('prompt do agente: ' + prompt.length + ' chars');
console.log('');

// o que o prompt promete para cada campo, lido da linha que descreve o campo
const alvos = [
  { campo: 'selo', re: /^-\s*selo:.*?até\s+(\d+)\s+caracteres/im },
  { campo: 'titulo', re: /^-\s*titulo:.*?até\s+(\d+)\s+caracteres/im },
  { campo: 'destaque', re: /^-\s*destaque:.*?até\s+(\d+)\s+caracteres/im },
  { campo: 'texto', re: /^-\s*texto:.*?de\s+\d+\s+a\s+(\d+)\s+caracteres/im },
  { campo: 'legenda', re: /Máximo de\s+([\d.]+)\s+caracteres/i },
];

let falhas = 0;
for (const a of alvos) {
  const m = prompt.match(a.re);
  if (!m) {
    falhas++;
    console.log(`FALHA  ${a.campo.padEnd(9)} não achei o limite no prompt (a redação mudou? ajuste este script)`);
    continue;
  }
  const noPrompt = Number(String(m[1]).replace(/\./g, ''));
  const noCodigo = LIMITES[a.campo];
  const ok = noPrompt === noCodigo;
  if (!ok) falhas++;
  console.log(`${ok ? 'ok    ' : 'FALHA '} ${a.campo.padEnd(9)} validador=${String(noCodigo).padEnd(6)} prompt=${noPrompt}`);
}

console.log('');
console.log('#'.repeat(66));
if (falhas === 0) {
  console.log('LIMITES E PROMPT DE ACORDO — as duas cópias dizem a mesma coisa.');
} else {
  console.log(`ATENCAO: ${falhas} divergência(s). Foi exatamente isso que causou semanas sem publicar em 05/08:`);
  console.log('o validador truncava num limite e reprovava por outro. Alinhe antes de seguir.');
}
process.exit(falhas === 0 ? 0 : 1);
