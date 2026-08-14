// Harness da nota na fila. Offline, rodando o nó de verdade.
//
//   node design/test_score_na_fila.cjs
const fs = require('fs');
const path = require('path');
const { trocar, NO } = require('./patch_score_na_fila.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram-v7-2-curadoria-inteligente-p1-0-4--NL8eVLKErgnIXBQq');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const lf = (s) => String(s).split('\r\n').join('\n');
const antigo = lf(fs.readFileSync(path.join(WFDIR, 'fila-montar-row.js'), 'utf8'));
const APLICADO = antigo.includes('pontuacao_total');
console.log(APLICADO ? '# export JÁ grava a nota — verificando o que está no ar'
                     : '# export ainda grava 0 — verificando a troca');

let novo;
if (APLICADO) {
  novo = antigo;
  let re = null;
  try { trocar(novo); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já lê a nota/.test(String(re)), re);
} else {
  let e1 = null;
  try { novo = trocar(antigo); } catch (e) { e1 = e.message; }
  ok('o patch aplica (sha bate)', Boolean(novo), e1);
  if (!novo) { console.log('\nFALHA'); process.exit(1); }
}

// roda o nó como o n8n roda
function montar(code, nota) {
  const nos = {
    'Preparar registro pendente': { content_key: 'ck', topic: 'Tema', category: 'OFERTA', primary_url: 'https://loja/x' },
    'Obter URL primeira imagem': { url: 'https://c/capa.jpg' },
    Aggregate: { url: ['https://c/1.jpg', 'https://c/2.jpg', 'https://c/3.jpg', 'https://c/4.jpg', 'https://c/5.jpg'] },
    'Edit Fields': { legenda: 'legenda' },
    'Selecionar melhor pauta': nota === undefined ? {} : { registro: { pontuacao_total: nota } },
  };
  const $ = (nome) => {
    if (!(nome in nos)) throw new Error('nó inesperado: ' + nome);
    return { first: () => ({ json: nos[nome] }) };
  };
  const $input = { first: () => ({ json: { secure_url: 'https://c/story.jpg' } }) };
  return new Function('$', '$input', '$execution', '$json', code)($, $input, { id: '999' }, {})[0].json;
}

// ---- o defeito ----
ok('ANTES a nota era 0 mesmo com curadoria 78', APLICADO || montar(antigo, 78).score === 0);
ok('AGORA a nota da curadoria chega na fila', montar(novo, 78).score === 78);

// ---- casos de borda ----
{
  ok('nota ausente vira 0 (e não NaN)', montar(novo, undefined).score === 0);
  ok('nota nula vira 0', montar(novo, null).score === 0);
  ok('nota como texto vira número', montar(novo, '66').score === 66);
  ok('nota quebrada vira 0', montar(novo, 'abc').score === 0);
  ok('nota zero continua zero', montar(novo, 0).score === 0);
}

// ---- o resto da row não pode ter mudado ----
{
  const a = montar(APLICADO ? novo : antigo, 78);
  const d = montar(novo, 78);
  for (const campo of ['content_key', 'topic', 'category', 'caption', 'carousel_urls',
    'story_url', 'primary_url', 'sources', 'status', 'execution_id']) {
    ok(`campo intacto: ${campo}`, JSON.stringify(a[campo]) === JSON.stringify(d[campo]));
  }
  ok('o carrossel continua com 6 imagens', JSON.parse(d.carousel_urls).length === 6);
  ok('a peça continua nascendo READY', d.status === 'READY');
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
