// Renderiza os TRÊS modelos de capa a partir do jsCode real do nó, pra escolha.
//
// Não existe cópia de layout aqui: cada modelo sai de blocoDoModelo() + trocar(), exatamente o que
// o patch grava. O que você vê é o que vai pro ar.
//
//   node design/capa_modelos.cjs                          (todas as amostras)
//   node design/capa_modelos.cjs silenthill_output.json   (uma só)
const fs = require('fs');
const path = require('path');
const { trocar, blocoDoModelo } = require('./patch_capa_fullbleed.cjs');

const OUT = __dirname;
const NO = path.join(OUT, '..', 'workflows',
  'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq',
  'code-in-javascript1.js');

const MODELOS = ['a', 'b', 'c'];
const AMOSTRAS = process.argv[2]
  ? [process.argv[2]]
  : ['silenthill_output.json', 'exec87_output.json', 'stress_output.json'];
const SUFIXO = { 'silenthill_output.json': 'sh', 'exec87_output.json': 'ex', 'stress_output.json': 'st' };

const antes = fs.readFileSync(NO, 'utf8');

// Depois do deploy o export já traz a capa nova: não há o que trocar, e insistir só faria o
// trocar() estourar no guard. Nesse estado o preview vira "o que está no ar".
const APLICADO = antes.includes('function capaImg(');
const codigo = APLICADO ? { noar: antes } : { atual: antes };
if (!APLICADO) for (const m of MODELOS) codigo[m] = trocar(antes, 'Code in JavaScript1', blocoDoModelo(m));
if (APLICADO) console.log('# export já tem a capa nova — renderizando o que está no ar');

function rodar(code, output) {
  const $input = { first: () => ({ json: { output } }), all: () => [{ json: { output } }] };
  const $ = () => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] });
  return new Function('$input', '$', '$json', 'require', code)($input, $, { output }, require)[0].json.html;
}

const gerados = [];
for (const arquivo of AMOSTRAS) {
  const bruto = JSON.parse(fs.readFileSync(path.join(OUT, arquivo), 'utf8'));
  const output = bruto.output || bruto;
  const sfx = SUFIXO[arquivo] || path.basename(arquivo, '.json');
  for (const chave of Object.keys(codigo)) {
    const nome = `capa_${chave}_${sfx}.html`;
    fs.writeFileSync(path.join(OUT, nome), `<!doctype html><meta charset="utf-8">${rodar(codigo[chave], output)}`);
    gerados.push(`${chave}_${sfx}`);
  }
}

console.log('WROTE ' + gerados.length + ' html');
console.log('shot: node design/shot.cjs ' + gerados.join(' '));
