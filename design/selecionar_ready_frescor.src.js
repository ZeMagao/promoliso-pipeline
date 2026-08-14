// Seleção da fila — publica a notícia de HOJE, não a que está morrendo.
//
// O QUE ESTAVA ERRADO (medido em 14/08/2026). A regra anterior publicava a peça mais perto de
// vencer ("earliest deadline first"), criada em 06/08 para resgatar pauta que ficava encalhada.
// Só que com a fila cheia isso deixou de ser resgate e virou regra: TODA publicação saía com
// ~46,5 h de atraso — 43, 42, 34 e 33 saíram todas com exatamente esse número. Não é coincidência,
// é o que a regra pede: publique o que está mais perto do teto de 48 h.
//
// Resultado prático: no dia 14/08 o post das 16:30 era de 12/08, enquanto cinco peças daquele
// mesmo dia esperavam na fila.
//
// A REGRA AGORA, em três degraus:
//   1. Se existe peça do DIA (até 12 h), publica a de melhor nota entre elas. Frescor primeiro,
//      qualidade para desempatar — não o contrário, senão uma nota alta de ontem ganha da notícia
//      de hoje, que é exatamente o que estamos consertando.
//   2. Senão, entre as que ainda estão dentro das 48 h, publica a MAIS NOVA.
//   3. Senão, a mais nova de todas. Pauta velha é pior que pauta nova, mas melhor que slot vazio —
//      e assim esta mudança nunca reduz a quantidade de publicações.
//
// O QUE ISSO CUSTA, dito na cara: peça que não for publicada em ~2 dias agora morre de vez. Ela já
// morria — 11 das 16 peças da fila em 14/08 já estavam fora da janela —, mas agora morre por
// desenho. O desperdício é real e o conserto dele é OUTRO: produzir menos (a produção faz ~4/dia
// e a publicação consome ~2,4/dia). Trocar a ordem aqui não resolve excesso de produção, e fingir
// que resolve seria pior que o problema.
const rows = $input.all().map(i=>i.json);
// READY = nunca tentada. RETRY = falhou uma vez e ganhou nova chance (ver "Preparar FALHA").
const PUBLICAVEIS = ['READY','RETRY'];
const ready = rows.filter(r=>PUBLICAVEIS.includes(String(r.status||'').toUpperCase()));
if(!ready.length) return [];

const FRESCOR_MAX_H = 48;      // teto do que ainda vale publicar
const JANELA_DO_DIA_H = 12;    // o que conta como "notícia de hoje"
const idadeH = (row) => {
  const t = Date.parse(String(row.created_at || row.createdAt || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};
const porNota = (a,b) =>
  (Number(b.score||0) - Number(a.score||0)) || (idadeH(a) - idadeH(b));
const maisNovaPrimeiro = (a,b) =>
  (idadeH(a) - idadeH(b)) || (Number(b.score||0) - Number(a.score||0));

const doDia = ready.filter((row) => idadeH(row) <= JANELA_DO_DIA_H);
const frescas = ready.filter((row) => idadeH(row) <= FRESCOR_MAX_H);
const fila = doDia.length
  ? doDia.slice().sort(porNota)
  : (frescas.length ? frescas.slice().sort(maisNovaPrimeiro) : ready.slice().sort(maisNovaPrimeiro));

const r = fila[0];
let urls=[]; try{ urls=JSON.parse(r.carousel_urls||'[]'); }catch(e){ urls=[]; }
if(!Array.isArray(urls) || urls.length<2) throw new Error('carousel_urls insuficiente: '+r.carousel_urls);
return [{ json: {
  content_key: String(r.content_key||''),
  topic: String(r.topic||''),
  cover: urls[0],
  slides: urls.slice(1,6),
  caption: String(r.caption||''),
  story_url: String(r.story_url||''),
  primary_url: String(r.primary_url||''),
  status_anterior: String(r.status||'').toUpperCase(),
  created_at: String(r.created_at || r.createdAt || ''),
  idade_h: Math.round(idadeH(r) * 10) / 10,
} }];
