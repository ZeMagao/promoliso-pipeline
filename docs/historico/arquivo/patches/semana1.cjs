/**
 * Semana 1 — correções para destravar a primeira publicação.
 *
 * Rode com o n8n PARADO: ele mantém o SQLite aberto e cacheia o workflow em
 * memória, então uma escrita com o processo no ar é sobrescrita no próximo save.
 *
 * Cada substituição é verificada antes de aplicar. Qualquer alvo que não bata
 * aborta o script inteiro sem gravar nada — melhor não aplicar do que aplicar
 * pela metade.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const DB = path.join(RAIZ, 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';

const db = new DatabaseSync(DB);
const linha = db.prepare('select nodes, connections from workflow_entity where id=?').get(WF);
if (!linha) throw new Error('workflow ' + WF + ' não encontrado');

const nodes = JSON.parse(linha.nodes);
const connections = JSON.parse(linha.connections);
const feito = [];

const pegar = (nome) => {
  const n = nodes.find((x) => x.name === nome);
  if (!n) throw new Error('node não encontrado: ' + nome);
  return n;
};

/** Troca `de` por `para` em `texto`, exigindo pelo menos uma ocorrência. */
function trocar(texto, de, para, rotulo) {
  if (!texto.includes(de)) throw new Error('alvo não encontrado (' + rotulo + ')');
  return texto.split(de).join(para);
}

// ---------------------------------------------------------------------------
// 1. O fallback de imagem nunca funcionou.
//
// "Code in JavaScript" embrulha toda imagem em Cloudinary fetch com a URL
// percent-encoded, mas este node procurava a URL CRUA no HTML — nunca achava,
// devolvia o mesmo HTML, e o render repetia o mesmo 400 até matar a execução.
// Agora replica a mesma transformação e troca as URLs já transformadas.
// ---------------------------------------------------------------------------
pegar('Usar capa como fallback').parameters.jsCode = `const original = $('Code in JavaScript').item.json;
const slide = original.slide || {};
const imagemOriginal = String(slide.imagem || '');
const imagemFallback = String(slide.capaFallback || '');

if (!imagemFallback) throw new Error('A imagem do slide falhou e não existe capa de fallback');

// Mesma transformação de "Code in JavaScript": o HTML contém a URL já embrulhada
// pelo Cloudinary fetch e percent-encoded, não a URL crua. Procurar a crua aqui
// era o motivo de o fallback nunca trocar nada.
function safeImage(value, fallback) {
  const source = /^https:\\/\\//i.test(String(value || ''))
    ? String(value)
    : String(fallback || '');
  if (!source) return '';
  if (/^https:\\/\\/res\\.cloudinary\\.com\\/fy2n2qvr\\//i.test(source)) {
    return source;
  }
  return 'https://res.cloudinary.com/fy2n2qvr/image/fetch/c_fit,w_1400,h_900,q_auto,f_auto/' +
    encodeURIComponent(source);
}

const alvo = safeImage(imagemOriginal, imagemFallback);
const substituto = safeImage(imagemFallback);
if (!substituto) throw new Error('Capa de fallback não produziu uma URL utilizável');

const htmlOriginal = String(original.html || '');
let html = htmlOriginal;
if (alvo && alvo !== substituto) html = html.split(alvo).join(substituto);
html = html.replace(/IMAGEM OFICIAL \\/ [^<]*/, 'IMAGEM OFICIAL / CAPA CONFIRMADA');

// Sem esta guarda a falha era silenciosa: re-renderizava o HTML idêntico e
// tomava o mesmo erro, sem pista de que a troca não tinha acontecido.
if (html.split(substituto).length < 2) {
  throw new Error('Fallback não aplicado: a URL da imagem não foi encontrada no HTML do slide');
}

return [{
  json: {
    ...original,
    html,
    slide: {
      ...slide,
      imagem: imagemFallback,
      fonte_imagem: 'CAPA CONFIRMADA',
    },
    fallback_aplicado: true,
  },
}];`;
feito.push('1. "Usar capa como fallback" agora troca a URL já transformada (era no-op)');

// ---------------------------------------------------------------------------
// 2. O Wait do carrossel estava com parâmetros vazios, e o default do node é
//    1 HORA. O contêiner do Instagram fica pronto em ~10s; com 12 tentativas o
//    teto era 12h, além da validade do próprio contêiner.
// ---------------------------------------------------------------------------
const wait = pegar('Aguardar processamento do carrossel');
if (Object.keys(wait.parameters).length !== 0) {
  throw new Error('Wait do carrossel não está mais vazio — revisar à mão antes de sobrescrever');
}
wait.parameters = { resume: 'timeInterval', amount: 15, unit: 'seconds' };
feito.push('2. Wait do carrossel: 1 hora (default) -> 15 segundos');

// ---------------------------------------------------------------------------
// 3. "Execução automática?" testava $execution.mode mas os DOIS ramos iam para
//    "Aprovar publicação" — um IF sem efeito. Removido; a entrada passa direto.
//    A aprovação manual continua obrigatória de propósito: publicar no
//    Instagram é irreversível e a conta ainda não publicou nada.
// ---------------------------------------------------------------------------
const ifMorto = 'Execução automática?';
pegar(ifMorto);
const origem = connections['Registrar preparação'];
if (!origem?.main?.[0]?.some((c) => c.node === ifMorto)) {
  throw new Error('"Registrar preparação" não aponta mais para o IF — revisar à mão');
}
origem.main[0] = origem.main[0].map((c) =>
  c.node === ifMorto ? { node: 'Aprovar publicação', type: 'main', index: 0 } : c,
);
delete connections[ifMorto];
const antes = nodes.length;
nodes.splice(nodes.findIndex((n) => n.name === ifMorto), 1);
if (nodes.length !== antes - 1) throw new Error('falha ao remover o IF');
feito.push('3. IF morto "Execução automática?" removido; aprovação manual mantida');

// ---------------------------------------------------------------------------
// 4. Slides 2-6: corpo em 21px vira ~7,6px no feed (ilegível) e o contêiner sem
//    overflow deixava o texto passar por baixo do rodapé position:fixed.
//    38px + overflow:hidden conferidos renderizando contra o :5680.
// ---------------------------------------------------------------------------
const slides = pegar('Code in JavaScript');
let cs = String(slides.parameters.jsCode);
cs = trocar(
  cs,
  'top:735px;bottom:42px;display:flex;flex-direction:column;padding-bottom:100px;',
  'top:735px;bottom:42px;display:flex;overflow:hidden;flex-direction:column;padding-bottom:100px;',
  'contêiner dos slides',
);
cs = trocar(
  cs,
  'margin-top:28px;color:#d5dae2;font-size:21px;line-height:1.45;',
  'margin-top:28px;color:#d5dae2;font-size:38px;line-height:1.35;',
  'corpo dos slides',
);
slides.parameters.jsCode = cs;
feito.push('4. Slides 2-6: corpo 21px -> 38px, contêiner com overflow:hidden');

// ---------------------------------------------------------------------------
// 5. Capa: só a proteção de overflow. Subir o corpo para 38px aqui empurra o
//    rodapé para fora do quadro — testado, reproduz a rejeição do operador.
//    Título e destaque em Barlow já carregam a leitura no feed.
// ---------------------------------------------------------------------------
const capa = pegar('Code in JavaScript1');
capa.parameters.jsCode = trocar(
  String(capa.parameters.jsCode),
  'top:728px;bottom:42px;display:flex;flex-direction:column;',
  'top:728px;bottom:42px;display:flex;overflow:hidden;flex-direction:column;',
  'contêiner da capa',
);
feito.push('5. Capa: contêiner com overflow:hidden (corpo segue em 22px, de propósito)');

// ---------------------------------------------------------------------------
// 6. Com o corpo em 38px, 190 caracteres passam de 4 linhas e somem por baixo
//    do rodapé. 110 fecha em 3 linhas com folga nos dois templates.
// ---------------------------------------------------------------------------
const validar = pegar('Validar antes de publicar');
validar.parameters.jsCode = trocar(
  String(validar.parameters.jsCode),
  'texto: limitar(slide.texto, 190),',
  'texto: limitar(slide.texto, 110),',
  'limite de caracteres do texto',
);
feito.push('6. limitar(texto): 190 -> 110 caracteres');

// ---------------------------------------------------------------------------
// 7. A aprovação expira no default do node (1 hora), mas o texto do formulário
//    promete 4 horas. Fixa em 12h e alinha o texto — evita perder uma execução
//    de teste por não estar na frente do computador.
// ---------------------------------------------------------------------------
const aprovar = pegar('Aprovar publicação');
if (aprovar.parameters.limitWaitTime !== true) {
  throw new Error('"Aprovar publicação" não tem limitWaitTime — revisar à mão');
}
aprovar.parameters.resumeAmount = 12;
aprovar.parameters.resumeUnit = 'hours';
aprovar.parameters.formDescription = trocar(
  String(aprovar.parameters.formDescription),
  'expira em 4 horas',
  'expira em 12 horas',
  'texto do formulário de aprovação',
);
feito.push('7. Aprovação: janela explícita de 12h (era o default de 1h) e texto corrigido');

// ---------------------------------------------------------------------------
db.prepare('update workflow_entity set nodes=?, connections=?, updatedAt=? where id=?').run(
  JSON.stringify(nodes),
  JSON.stringify(connections),
  new Date().toISOString().replace('T', ' ').replace('Z', ''),
  WF,
);

console.log('Aplicado em ' + WF + ':\n');
feito.forEach((f) => console.log('  ' + f));
console.log('\nnodes: ' + antes + ' -> ' + nodes.length);
