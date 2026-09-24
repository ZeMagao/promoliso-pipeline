// Harness do "sem foto repetida". Offline, sobre o prompt REAL exportado do banco.
//
// O que precisa provar:
//   1. As DUAS cópias da regra mudam juntas. Divergir é o erro que já zerou pauta neste projeto
//      (o teto de nota morava em dois lugares e um mudou sozinho).
//   2. O texto antigo — que mandava repetir — some mesmo. Se sobrar, o agente recebe duas ordens
//      opostas na mesma página e obedece à que quiser.
//   3. O piso de 3 slides continua dito, nas duas cópias: 2 imagens não podem virar 2 slides,
//      porque o carrossel, o validador e a faixa 3–7 exigem 3.
//   4. Ida e volta byte a byte, e aplicar duas vezes é erro.
//
//   node design/test_sem_repetir_imagem.cjs
const fs = require('fs');
const path = require('path');
const { trocar, lf, TROCAS, MIN_SLIDES, MARCA } = require('./patch_sem_repetir_imagem.cjs');

const PROMPT = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq',
  'ai-agent.prompt.md');

let falhas = 0;
const ok = (nome, cond, detalhe) => {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas += 1;
};

const antigo = lf(fs.readFileSync(PROMPT, 'utf8'));
const jaTem = antigo.includes(MARCA);
const novo = jaTem ? antigo : trocar(antigo, false);
const base = jaTem ? trocar(antigo, true) : antigo;
console.log(jaTem ? '# o prompt exportado JÁ tem a regra — conferindo o que está no ar'
                  : '# o prompt exportado ainda manda repetir — conferindo a troca');

for (const t of TROCAS) {
  ok(`a âncora "${t.nome}" existe exatamente 1 vez no prompt real`,
    base.split(t.de).length - 1 === 1, String(base.split(t.de).length - 1));
}
ok('as duas cópias foram trocadas', TROCAS.every((t) => novo.includes(t.para)));

// O texto que mandava repetir não pode sobreviver em lugar nenhum.
const FRASES_MORTAS = [
  'Conteúdo vem primeiro; não repetir é preferência, não regra',
  'NUNCA corte um fato relevante só para evitar repetição',
  'reutilize as disponíveis em vez de reprovar a pauta',
  'Nunca remova um slide que a matéria sustenta só porque faltou imagem',
];
for (const frase of FRASES_MORTAS) {
  ok(`some do prompt: "${frase.slice(0, 44)}..."`, !novo.includes(frase));
}

// O piso tem que continuar dito nas duas cópias — senão 2 fotos viram 2 slides e o validador reprova.
const trechos = novo.split('\n').filter((l) => l.includes(MARCA) || l.includes('REDUZA O NÚMERO DE SLIDES'));
ok('as duas cópias falam do piso de ' + MIN_SLIDES,
  trechos.length === 2 && trechos.every((l) => l.includes(String(MIN_SLIDES))), String(trechos.length));

// O que NÃO pode mudar: a régua de quantos slides a matéria sustenta continua lá.
ok('a regra de "quantos a matéria sustenta" continua no prompt',
  novo.includes('use o número que a matéria SUSTENTA com fato próprio'));
ok('a faixa 3 a 7 continua no prompt', /3 slides/.test(novo) && /aguenta 7/.test(novo));

let doeu = false;
try { trocar(novo, false); } catch (e) { doeu = true; }
ok('aplicar duas vezes é erro', doeu);
ok('--reverter volta byte a byte', trocar(novo, true) === lf(base));

console.log('');
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO PASSOU');
process.exit(falhas ? 1 : 0);
