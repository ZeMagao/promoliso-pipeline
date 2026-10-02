// BANCADA DO VALIDADOR — reexecuta o jsCode REAL do "Validar antes de publicar" sobre as
// validações reais da semana (design/validador_casos_20261002.json: entrada do redator, contexto
// editorial e o relógio de cada rodada). Um módulo só, para todo harness que mexe no veredito
// medir com a mesma régua.
//
// `itemQuebrado`: em produção o `$('Montar contexto editorial').item` falha (pareamento perdido no
// laço "Tentar outra pauta" + AI Agent). A bancada só reproduz os 58 vereditos com ele quebrado.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CASOS = path.join(__dirname, 'validador_casos_20261002.json');
const carregarCasos = () => JSON.parse(fs.readFileSync(CASOS, 'utf8')).casos;

// `transformar(textoJson)` permite simular um acervo diferente (ex.: outra regra de URL de imagem)
// aplicando a mesma troca na entrada e no contexto, como faria o nó que monta o acervo.
function rodar(codigo, caso, opts) {
  const o = opts || {};
  const tr = o.transformar || ((s) => s);
  class D extends Date { constructor(...a) { super(...(a.length ? a : [caso.relogio])); } static now() { return caso.relogio; } }
  const entrada = JSON.parse(tr(JSON.stringify(caso.entrada)));
  const itens = JSON.parse(tr(JSON.stringify(caso.contexto))).map((json) => ({ json }));
  const ref = { all: () => itens, first: () => itens[0] };
  if (o.itemQuebrado !== false) Object.defineProperty(ref, 'item', { get() { throw new Error('Paired item data unavailable'); } });
  else ref.item = itens[0];
  const ctx = { $json: entrada, Date: D, console: { log() {}, warn() {}, error() {} },
    $: (nome) => { if (nome !== 'Montar contexto editorial') throw new Error('nó inesperado: ' + nome); return ref; } };
  vm.createContext(ctx);
  const j = vm.runInContext('(function(){' + codigo + '\n})()', ctx, { timeout: 5000 })[0].json;
  return { pauta_validada: j.pauta_validada, motivo_reprovacao: String(j.motivo_reprovacao || '') };
}

const chave = (c) => c.exec + '/' + c.tentativa;
const igual = (a, b) => a.pauta_validada === b.pauta_validada && a.motivo_reprovacao === b.motivo_reprovacao;

module.exports = { carregarCasos, rodar, chave, igual };
