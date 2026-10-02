// Harness do validador por procedência (02/10/2026). Offline, com o validador REAL.
//
// Reexecuta o jsCode do "Validar antes de publicar" sobre as 58 validações reais da semana
// (design/validador_casos_20261002.json: entrada do redator, contexto editorial e o relógio de
// cada rodada). Mede o veredito, não a função isolada — e por isso precisa de um controle de
// fidelidade antes de qualquer conclusão:
//
//   1. FIDELIDADE: com o código de ANTES (sem esta mudança e sem a allowlist de 16:52) e com o
//      `.item` falhando como falha em produção, a bancada reproduz os 58 vereditos, motivo por
//      motivo. Se isto quebrar, nenhuma linha abaixo vale.
//   2. O que muda é EXATAMENTE a lista esperada, e só de reprovado para aprovado.
//   3. As imagens de 608 px do gg.deals continuam reprovando.
//   4. Com a mudança, o resultado não depende mais de o `.item` funcionar.
//   5. Ida e volta byte a byte.
//
//   node design/test_validador_procedencia.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const proc = require('./patch_validador_procedencia.cjs');
const citaveis = require('./patch_dominios_citaveis.cjs');

const VALIDADOR = path.join(__dirname, '..', 'workflows', 'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq', 'validar-antes-de-publicar.js');
const { casos } = JSON.parse(fs.readFileSync(path.join(__dirname, 'validador_casos_20261002.json'), 'utf8'));

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

const noAr = proc.lf(fs.readFileSync(VALIDADOR, 'utf8'));
const novo = proc.normalizar(citaveis.normalizar(noAr));
const semProcedencia = proc.aplicar(novo, true);
const daSemana = citaveis.aplicar(semProcedencia, true);   // o que rodou entre 25/09 e 02/10 16:52
console.log(noAr.includes(proc.MARCA) ? '# o export JÁ tem a mudança — conferindo o que está no ar' : '# o export ainda não tem — conferindo a troca');

function rodar(codigo, c, itemQuebrado) {
  class D extends Date { constructor(...a) { super(...(a.length ? a : [c.relogio])); } static now() { return c.relogio; } }
  const itens = c.contexto.map((json) => ({ json: JSON.parse(JSON.stringify(json)) }));
  const ref = { all: () => itens, first: () => itens[0] };
  if (itemQuebrado) Object.defineProperty(ref, 'item', { get() { throw new Error('Paired item data unavailable'); } });
  else ref.item = itens[0];
  const ctx = { $json: JSON.parse(JSON.stringify(c.entrada)), Date: D, console: { log() {}, warn() {}, error() {} },
    $: (nome) => { if (nome !== 'Montar contexto editorial') throw new Error('nó inesperado: ' + nome); return ref; } };
  vm.createContext(ctx);
  const j = vm.runInContext('(function(){' + codigo + '\n})()', ctx, { timeout: 5000 })[0].json;
  return { pauta_validada: j.pauta_validada, motivo_reprovacao: String(j.motivo_reprovacao || '') };
}
const chave = (c) => c.exec + '/' + c.tentativa;
const igual = (a, b) => a.pauta_validada === b.pauta_validada && a.motivo_reprovacao === b.motivo_reprovacao;

// 1. fidelidade
const fieis = casos.filter((c) => igual(rodar(daSemana, c, true), c.producao));
ok(`fidelidade: a bancada reproduz ${fieis.length}/${casos.length} vereditos de produção`, fieis.length === casos.length,
  casos.filter((c) => !fieis.includes(c)).map(chave).join(','));
// contraprova: com `.item` funcionando, a 822 NÃO bate — é o que mostra que em produção ele falha
const r822 = casos.find((c) => c.exec === 822);
ok('contraprova: com .item funcionando a 822 diverge da produção (logo, lá ele falha)',
  r822 && !igual(rodar(daSemana, r822, false), r822.producao));

// 2. o que muda
const ESPERADO = ['746/1', '765/2', '770/1', '770/2', '782/1', '782/2', '822/1'];
const mudou = casos.filter((c) => !igual(rodar(novo, c, true), c.producao));
ok(`mudam exatamente ${ESPERADO.length} vereditos: ${ESPERADO.join(' ')}`,
  JSON.stringify(mudou.map(chave).sort()) === JSON.stringify(ESPERADO.slice().sort()), mudou.map(chave).join(' '));
ok('todos mudam de reprovado para aprovado (nenhum aprovado cai)',
  mudou.every((c) => c.producao.pauta_validada === false && rodar(novo, c, true).pauta_validada === true));
const soEsta = casos.filter((c) => !igual(rodar(novo, c, true), rodar(semProcedencia, c, true))).map(chave).sort();
ok('desta mudança (fora a allowlist): E-Day 765/2, Forest of Deceit 770/1 e 770/2, Next Week on Xbox 822/1',
  JSON.stringify(soEsta) === JSON.stringify(['765/2', '770/1', '770/2', '822/1']), soEsta.join(' '));

// 3. gg.deals segue reprovando
for (const k of ['752/1', '765/1', '790/1', '790/2', '818/1']) {
  const c = casos.find((x) => chave(x) === k);
  if (!c) { ok('caso ' + k + ' existe na amostra', false); continue; }
  const r = rodar(novo, c, true);
  ok(`gg.deals (608 px, imagem única) continua reprovado: ${k}`, r.pauta_validada === false && /relação verificável/.test(r.motivo_reprovacao), r.motivo_reprovacao);
}

// 4. não depende mais do .item
ok('com a mudança, .item quebrado ou não dá o mesmo veredito em todos os casos',
  casos.every((c) => igual(rodar(novo, c, true), rodar(novo, c, false))));

// 5. ida e volta
ok('reverter e reaplicar volta byte a byte', proc.aplicar(proc.aplicar(novo, true), false) === novo);
let doeu = false; try { proc.aplicar(novo, false); } catch (e) { doeu = true; }
ok('aplicar duas vezes é erro', doeu);

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
