// Gera o `Selecionar READY` novo a partir do que está NO AR, por substituições explícitas.
//
// POR QUE GERAR EM VEZ DE ESCREVER À MÃO. O nó de hoje carrega três regras que custaram medição pra
// existir: os degraus de frescor (14/08), o RETRY (13/08) e a nota que chega na fila (14/08). Se eu
// reescrever o arquivo inteiro, nada garante que não mudei uma delas de bobeira. Derivando do texto
// que está em produção, tudo que não está listado aqui embaixo é idêntico POR CONSTRUÇÃO — e o
// harness compara o resultado com `selecionar_ready_variavel.src.js`, então divergir vira falha.
//
//   node design/selecionar_ready_variavel.gen.cjs --escrever
const fs = require('fs');
const path = require('path');

const lf = (s) => String(s).split('\r\n').join('\n');
const ANTES = path.join(__dirname, 'selecionar_ready_antes_variavel.txt');
const DEPOIS = path.join(__dirname, 'selecionar_ready_variavel.src.js');

const TROCAS = [
  {
    nome: 'faixa de imagens do Instagram',
    de: "const JANELA_DO_DIA_H = 12;    // o que conta como \"notícia de hoje\"\n",
    para: "const JANELA_DO_DIA_H = 12;    // o que conta como \"notícia de hoje\"\n"
      + "\n"
      + "// O Instagram aceita de 2 a 10 imagens num carrossel. A conta de QUAL saída do\n"
      + "// \"Quantas imagens?\" recebe a peça vive aqui, em código testável, e não na expressão do\n"
      + "// Switch — de propósito: índice fora da faixa faz o Switch derrubar a execução, e aí a row\n"
      + "// fica presa em PUBLISHING, o único estado que nem publica nem alerta.\n"
      + "const MIN_IMAGENS = 2;\n"
      + "const MAX_IMAGENS = 10;\n",
  },
  {
    nome: 'leitura e conferência das urls',
    de: "let urls=[]; try{ urls=JSON.parse(r.carousel_urls||'[]'); }catch(e){ urls=[]; }\n"
      + "if(!Array.isArray(urls) || urls.length<2) throw new Error('carousel_urls insuficiente: '+r.carousel_urls);\n",
    para: "let urls=[]; try{ urls=JSON.parse(r.carousel_urls||'[]'); }catch(e){ urls=[]; }\n"
      + "if(!Array.isArray(urls)) urls=[];\n"
      + "// Só url https serve: é o Instagram que baixa a imagem, e um item quebrado no meio da coleção\n"
      + "// fazia o filho nascer sem image_url. Medido nas 61 rows da fila: nenhuma perde imagem por\n"
      + "// causa deste filtro — ele não muda nada hoje, só fecha a porta.\n"
      + "const validas = urls.filter((u) => typeof u === 'string' && /^https:\\/\\//.test(u));\n"
      + "if(validas.length < MIN_IMAGENS) throw new Error('carousel_urls insuficiente: '+r.carousel_urls);\n"
      + "const usadas = validas.slice(0, MAX_IMAGENS);\n",
  },
  {
    nome: 'capa e slides',
    de: "  cover: urls[0],\n  slides: urls.slice(1,6),\n",
    para: "  cover: usadas[0],\n"
      + "  // era slice(1,6): jogava fora a 7a imagem em diante e obrigava a peça a ter exatamente 6\n"
      + "  slides: usadas.slice(1),\n",
  },
  {
    nome: 'campos da quantidade',
    // Sem \n no fim: o jsCode em produção termina em "} }];" SEM quebra de linha (conferido nos
    // 1716 bytes do fixture). Ancorar com \n fazia a substituição não achar nada — e o guard de
    // contagem pegou isso na primeira rodada, que é exatamente pra isso que ele existe.
    de: "  idade_h: Math.round(idadeH(r) * 10) / 10,\n} }];",
    para: "  idade_h: Math.round(idadeH(r) * 10) / 10,\n"
      + "  n_imagens: usadas.length,\n"
      + "  // Saída do Switch, zero-based: 2 imagens -> 0, 6 -> 4, 10 -> 8. Dentro da faixa por\n"
      + "  // construção, porque menos de MIN_IMAGENS virou erro acima e o slice corta em MAX_IMAGENS.\n"
      + "  saida_carrossel: usadas.length - MIN_IMAGENS,\n"
      + "  imagens_ignoradas: validas.length - usadas.length,\n"
      + "} }];",
  },
];

function gerar(antes) {
  let saida = lf(antes);
  for (const t of TROCAS) {
    const vezes = saida.split(t.de).length - 1;
    if (vezes !== 1) throw new Error(`âncora "${t.nome}" apareceu ${vezes} vezes — abortando`);
    saida = saida.split(t.de).join(t.para);
  }
  new Function(saida);
  return saida;
}

module.exports = { gerar, TROCAS, ANTES, DEPOIS, lf };

if (require.main === module) {
  const saida = gerar(fs.readFileSync(ANTES, 'utf8'));
  if (process.argv.includes('--escrever')) {
    fs.writeFileSync(DEPOIS, saida);
    console.log('escrito ' + path.basename(DEPOIS) + ' (' + saida.length + ' bytes)');
  } else {
    process.stdout.write(saida);
  }
}
