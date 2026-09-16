// Harness offline do patch_slides_pela_imagem.cjs.
// Rodar NO VPS: cd /opt/promoliso && sudo -u promo node design/test_slides_pela_imagem.cjs
// (só leitura; não grava nada)
//
// Patch de PROMPT não se prova por execução — o que o modelo faz com a instrução só se vê em
// produção. O que ESTE harness prova é o que dá para provar, e que é onde mora o risco:
//
//   a) as duas cópias da regra são trocadas, e nenhuma instrução antiga de repetir sobra;
//   b) o VALIDADOR aceita as peças menores que a nova regra vai produzir — se 3 slides
//      reprovasse, a regra trocaria "peça feia" por "peça nenhuma";
//   c) a contabilidade de imagem fecha nos casos-limite (3 fotos em 3 slides, e 2 fotos no piso).

const { execSync } = require('child_process');
const patch = require('./patch_slides_pela_imagem.cjs');

const DB = '/opt/promoliso/data/.n8n/database.sqlite';
let falhas = 0;
const checa = (cond, texto) => { if (!cond) falhas++; console.log((cond ? 'OK     ' : 'FALHA  ') + texto); };

// ───────────────────────────────── réplica da regra de estrutura do validador no ar
const MIN_SLIDES = 3;
const MAX_SLIDES = 7;
const slidesNaFaixa = (n) => n >= MIN_SLIDES && n <= MAX_SLIDES;
const TIPOS_DO_MEIO = ['contexto', 'evidencia', 'impacto'];
const tiposAceitos = (i, total) => (i === 0 ? ['capa'] : (i === total - 1 ? ['acao'] : TIPOS_DO_MEIO));

function estruturaValida(slides) {
  if (!Array.isArray(slides)) return false;
  if (!slidesNaFaixa(slides.length)) return false;
  return slides.every((s, i) => tiposAceitos(i, slides.length).includes(s && s.tipo));
}
const montar = (n) => Array.from({ length: n }, (_, i) => ({
  tipo: i === 0 ? 'capa' : (i === n - 1 ? 'acao' : 'evidencia'),
  titulo: 'T', destaque: 'D', texto: 'x',
}));

console.log('--- b) o validador aceita as peças menores? ---');
for (const n of [2, 3, 4, 5, 6, 7, 8]) {
  const ok = estruturaValida(montar(n));
  const esperado = n >= MIN_SLIDES && n <= MAX_SLIDES;
  checa(ok === esperado, `${n} slides -> ${ok ? 'aceita' : 'reprova'} (esperado ${esperado ? 'aceita' : 'reprova'})`);
}

console.log('\n--- c) a conta de imagem fecha nos casos-limite ---');
// imagens = [capa, ...slides.map(imagem)]; imagensEsperadas = slides.length + 1
// output.capa espelha a imagem do slide 0, então K fotos distintas cobrem K slides.
function conta(fotosDistintas, nSlides) {
  const fotos = Array.from({ length: fotosDistintas }, (_, i) => 'https://x.com/f' + i + '.jpg');
  const slides = montar(nSlides).map((s, i) => ({ ...s, imagem: fotos[i % fotos.length] }));
  const capa = slides[0].imagem;
  const imagens = [capa, ...slides.map((s) => s.imagem)];
  return {
    esperadas: slides.length + 1,
    validas: imagens.length,
    unicas: new Set(imagens).size,
    estrutura: estruturaValida(slides),
  };
}
{
  const r = conta(3, 3);
  checa(r.validas === r.esperadas, `3 fotos em 3 slides: válidas ${r.validas} == esperadas ${r.esperadas}`);
  checa(r.unicas === 3, `3 fotos em 3 slides: imagens_unicas = ${r.unicas} (sem repetição)`);
  checa(r.estrutura, '3 fotos em 3 slides: estrutura válida');
}
{
  // piso: 2 fotos ainda obrigam UMA repetição, porque 3 é o mínimo do carrossel
  const r = conta(2, 3);
  checa(r.validas === r.esperadas, `2 fotos no piso: válidas ${r.validas} == esperadas ${r.esperadas}`);
  checa(r.unicas === 2, `2 fotos no piso: imagens_unicas = ${r.unicas} — passa da regra de variedade (>1)`);
  checa(r.estrutura, '2 fotos no piso: estrutura válida');
}
{
  // o caso da peça 71 como está HOJE, para contraste
  const hoje = conta(2, 6);
  checa(hoje.unicas === 2 && hoje.validas === 7,
    `peça 71 hoje: 6 slides, 7 slots, ${hoje.unicas} fotos — cada foto aparece ~3x`);
}
{
  // pauta de fonte primária: sobra imagem, nada muda
  const r = conta(8, 7);
  checa(r.unicas === 7, `8 fotos disponíveis em 7 slides: ${r.unicas} distintas, zero repetição`);
}

console.log('\n--- a) as duas cópias da regra, no prompt REAL ---');
try {
  const live = execSync(`sqlite3 "${DB}" "SELECT nodes FROM workflow_entity WHERE id='${patch.WF}';"`,
    { maxBuffer: 1024 * 1024 * 200 }).toString();
  const nodes = JSON.parse(live);
  const prompt = nodes.find((x) => x.name === patch.NO).parameters.options.systemMessage;

  const vezesA = prompt.split(patch.ANCORA_A).length - 1;
  const vezesB = prompt.split(patch.ANCORA_B).length - 1;
  checa(vezesA === 1, `âncora 1 (campos visuais) aparece 1x (achei ${vezesA})`);
  checa(vezesB === 1, `âncora 2 (candidato aprovado) aparece 1x (achei ${vezesB})`);
  checa(/reutilize as dispon/i.test(prompt), 'o prompt no ar REALMENTE manda repetir hoje — é o defeito');

  const depois = patch.trocar(prompt);
  checa(!depois.includes(patch.ANCORA_A) && !depois.includes(patch.ANCORA_B),
    'depois do patch não sobra nenhuma das duas instruções antigas');
  const sobrouRepetir = (depois.match(/reutilize as dispon[ií]veis/gi) || []).length;
  checa(sobrouRepetir === 0, `nenhum "reutilize as disponíveis" sobrou (achei ${sobrouRepetir})`);
  checa(depois.includes(patch.MARCA), 'a regra nova está presente');
  const dizReduzir = (depois.match(/REDUZA O NÚMERO DE SLIDES|número de slides é o MENOR/g) || []).length;
  checa(dizReduzir === 2, `as DUAS cópias mandam reduzir em vez de repetir (achei ${dizReduzir})`);
  checa(depois.includes('de 3 a 7 slides'), 'a seção de estrutura (3 a 7) segue intacta — regras não se contradizem');

  const delta = depois.length - prompt.length;
  checa(delta < 900, `custo do texto novo: ${delta > 0 ? '+' : ''}${delta} bytes (~${Math.round(delta / 4)} tokens/chamada)`);

  // reversível
  const revertido = patch.destrocar(depois);
  checa(revertido === patch.lf(prompt), '--reverter devolve o prompt byte a byte');
} catch (e) {
  console.log('AVISO  não deu para ler o prompt no banco (' + e.message.split('\n')[0] + ')');
  falhas++;
}

console.log('');
if (falhas === 0) {
  console.log('RESULTADO ESPERADO EM TODOS OS CASOS — patch pode ir pro ar');
  console.log('⚠️  Lembrete: isto prova a INSTRUÇÃO e o gate, não o comportamento do modelo.');
  console.log('    Só a primeira rodada diz se ele passou a escolher menos slides.');
  process.exit(0);
}
console.log(`FALHOU: ${falhas} caso(s) — NÃO deployar`);
process.exit(1);
