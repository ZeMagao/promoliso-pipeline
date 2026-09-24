#!/usr/bin/env node
// RODA OS HARNESSES. Três categorias, e a diferença entre elas é o ponto.
//
// Este projeto muda código de produção por PATCH: um script que acha uma âncora no nó e troca o
// trecho. Cada patch nasce com um harness que roda o nó de verdade, offline, e prova o que a
// mudança faz e o que ela NÃO muda. São 50 patches e 41 harnesses até aqui.
//
// Só que um harness escrito para provar uma mudança específica envelhece: quando um patch
// POSTERIOR mexe no mesmo nó, a prova de época passa a comparar o código de hoje com o snapshot
// de um mês atrás e fica vermelha — sem que nada esteja quebrado em produção. Fingir que isso não
// acontece é o que transforma uma suíte em ruído que ninguém mais roda.
//
// Então a classificação é explícita:
//
//   vivos   — precisam ficar VERDES. Rodam nos dois estados (patch aplicado ou não), porque
//             detectam o estado e montam o "antes" revertendo o que está no ar.
//   epoca   — provaram uma mudança numa data. Ficam no repo como registro do raciocínio; não são
//             regressão e não devem ser cobrados como tal.
//   vps     — leem o banco do n8n ou caminhos de /opt/promoliso. Só rodam no servidor.
//
//   node tools/harness.cjs           roda os vivos (é o `npm test`)
//   node tools/harness.cjs --epoca   roda as provas de época, sem falhar o processo
//   node tools/harness.cjs --todos   roda tudo e mostra o mapa completo
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Lista explícita, não heurística: quem entra aqui é cobrado, e a escolha tem que ser de alguém.
const VIVOS = [
  'design/test_cdn_publicador.cjs',
  'design/test_fotos_do_jogo.cjs',
  'design/test_pauta_calendario.cjs',
  'design/test_ponte_imagem.cjs',
  'design/test_sem_repetir_imagem.cjs',
  'vps/bin/test_promo_vigia.cjs',
  'vps/cdn/test_promo_cdn_jogo.cjs',
  'vps/cdn/test_promo_cdn_ponte.cjs',
];

function todosOsHarnesses() {
  const achados = [];
  for (const dir of ['design', 'vps/bin', 'vps/cdn']) {
    const abs = path.join(RAIZ, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (/^test_.*\.cjs$/.test(f)) achados.push(dir + '/' + f);
    }
  }
  return achados.sort();
}

const precisaDoVps = (rel) => {
  const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  return /\/opt\/promoliso|sqlite3/.test(texto);
};

function rodar(rel) {
  try {
    const saida = execFileSync(process.execPath, [path.join(RAIZ, rel)], {
      encoding: 'utf8', timeout: 120000, cwd: RAIZ,
    });
    return { ok: /TUDO PASSOU/.test(saida), saida };
  } catch (e) {
    return { ok: false, saida: String((e.stdout || '') + (e.stderr || e.message || '')) };
  }
}

const resumo = (saida) => {
  const linha = saida.split('\n').reverse().find((l) => /FALHA/.test(l));
  return (linha || '').trim().slice(0, 100);
};

const args = process.argv.slice(2);
const todos = todosOsHarnesses();
const vps = todos.filter((f) => !VIVOS.includes(f) && precisaDoVps(f));
const epoca = todos.filter((f) => !VIVOS.includes(f) && !vps.includes(f));

if (args.includes('--todos')) {
  console.log(`mapa: ${VIVOS.length} vivos · ${epoca.length} provas de época · ${vps.length} só no VPS`
    + `  (total ${todos.length})`);
  console.log('');
}

const alvos = args.includes('--epoca') ? epoca : (args.includes('--todos') ? [...VIVOS, ...epoca] : VIVOS);
const cobrados = args.includes('--epoca') ? [] : VIVOS;

let falharam = 0;
for (const rel of alvos) {
  const r = rodar(rel);
  const etiqueta = VIVOS.includes(rel) ? 'vivo ' : 'época';
  if (r.ok) console.log(`ok    ${etiqueta}  ${rel}`);
  else {
    console.log(`FALHA ${etiqueta}  ${rel}   ${resumo(r.saida)}`);
    if (cobrados.includes(rel)) falharam += 1;
  }
}

if (!args.includes('--epoca') && !args.includes('--todos')) {
  console.log('');
  console.log(`${VIVOS.length - falharam}/${VIVOS.length} verdes`
    + `  ·  ${epoca.length} provas de época (node tools/harness.cjs --epoca)`
    + `  ·  ${vps.length} exigem o VPS`);
}

process.exit(falharam ? 1 : 0);
