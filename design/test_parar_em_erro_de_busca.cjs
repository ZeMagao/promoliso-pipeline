// Harness da regra de parar em erro de busca. Offline, contra o prompt exportado.
//
//   node design/test_parar_em_erro_de_busca.cjs
const fs = require('fs');
const path = require('path');
const P = require('./patch_parar_em_erro_de_busca.cjs');

const WFDIR = path.join(__dirname, '..', 'workflows',
  'promoliso-conteudo-instagram--NL8eVLKErgnIXBQq');
const ARQ = path.join(WFDIR, 'ai-agent.prompt.md');

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? 'PASS  ' : 'FALHA ') + nome + (cond || !detalhe ? '' : '  -> ' + detalhe));
  if (!cond) falhas++;
}

const antigo = P.lf(fs.readFileSync(ARQ, 'utf8'));
const APLICADO = antigo.includes(P.MARCA);
console.log(APLICADO ? '# export JÁ tem a regra — verificando o que está no ar'
                     : '# export ainda não tem a regra — verificando a troca');

console.log('\n# A. o patch');
let novo;
if (APLICADO) {
  novo = antigo;
  let re = null;
  try { P.trocar(novo); } catch (e) { re = e.message; }
  ok('recusa reaplicação', /já tem a regra/.test(String(re)), re);
} else {
  let e1 = null;
  try { novo = P.trocar(antigo); } catch (e) { e1 = e.message; }
  ok('o patch aplica', Boolean(novo), e1);
  if (!novo) { console.log('\nFALHA'); process.exit(1); }
  ok('reverter devolve byte a byte', P.destrocar(novo) === antigo);
  let e2 = null;
  try { P.destrocar(antigo); } catch (e) { e2 = e.message; }
  ok('recusa reverter o que não foi aplicado', /não tem a regra/.test(String(e2)), e2);
}

console.log('\n# B. a regra diz o que precisa dizer');
ok('ancora no campo `error`, não na palavra cota', novo.includes('campo `error`'));
// Esta é a asserção que protege contra o erro mais fácil de cometer aqui: o texto da cota
// ("exceeds your plan's set usage limit") NÃO chega ao modelo, fica no metadado do nó. Uma regra
// ancorada nele nunca dispararia.
ok('NÃO se ancora no texto da cota, que o modelo não vê',
  !/exceeds your plan|usage limit|cota do Tavily/i.test(P.REGRA), 'a regra cita texto que o modelo não recebe');
ok('cita a mensagem que o modelo REALMENTE recebe',
  novo.includes('Your request is invalid or could not be processed'));
ok('proíbe reformular', /NÃO REFORMULE/.test(novo));
ok('limita a UMA nova tentativa', /UMA\s*\n?\s*nova tentativa/.test(novo) || /UMA nova tentativa/.test(novo));
ok('manda usar a saída honesta', /aprovado_para_publicar false/.test(P.REGRA));
ok('dá o motivo padronizado', /ferramenta de busca indisponível/.test(P.REGRA));

console.log('\n# C. não quebra o que já existia');
for (const [nome, trecho] of [
  ['orçamento de dez passos', 'no máximo dez passos de ferramenta por tentativa'],
  ['proibição de anunciar', 'NUNCA termine anunciando o que vai fazer'],
  ['última mensagem é o JSON', 'Sua última mensagem tem de ser o objeto JSON completo'],
  ['saída honesta original', 'Se o orçamento estiver acabando e faltar confirmação'],
  ['faixa de slides', 'de 3 a 7 slides'],
]) ok('preservado: ' + nome, novo.includes(trecho));

const secoes = (s) => (s.match(/^## /gm) || []).length;
ok('nenhuma seção criada ou perdida', secoes(novo) === secoes(antigo),
  secoes(antigo) + ' -> ' + secoes(novo));
ok('a regra entrou DENTRO do orçamento de pesquisa',
  novo.indexOf(P.MARCA) > novo.indexOf('## Orçamento de pesquisa')
  && novo.indexOf(P.MARCA) < novo.indexOf('## Decisão editorial por categoria'));

console.log('\n# D. o custo do próprio conserto');
const delta = novo.length - antigo.length;
const tokens = Math.round(delta / 4);
console.log(`  a regra pesa +${delta} bytes (~${tokens} tokens) na linha de base`);
// Sanidade: o conserto tem de custar MUITO menos do que economiza. Medido: uma busca inútil
// custa ~15.800 tokens de reenvio; cortar 15 delas economiza ~237.000. A regra pode pesar alguns
// centenas de tokens por chamada e ainda assim pagar 10x.
ok('a regra é pequena diante do que evita (< 500 tokens)', tokens < 500, String(tokens));
const porRodada = tokens * 10;
console.log(`  ~${porRodada} tokens por rodada (10 chamadas) contra ~237.000 evitados nas rodadas quebradas`);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO VERDE');
process.exit(falhas ? 1 : 0);
