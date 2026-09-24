const pool = ($json.candidatos) || [];
const temImg = (c) => c && c.imagem_principal && /^https:\/\//i.test(c.imagem_principal);
const semImg = pool.map((c, i) => ({ c, i })).filter(({ c }) => !temImg(c));
// primárias primeiro; teto de 8 fetches por execução
semImg.sort((a, b) =>
  ((b.c.tipo_fonte === 'primaria') ? 1 : 0) - ((a.c.tipo_fonte === 'primaria') ? 1 : 0));
const alvos = semImg.slice(0, 8);

// FOTOS OFICIAIS DO JOGO. Alvo diferente, mesmo nó de HTTP: aqui a URL é do NOSSO serviço, que
// identifica o jogo da manchete e devolve as fotos oficiais dele. Existe porque a peça do Gears
// saiu com a mesma foto em 6 slides — a matéria tinha 2 imagens e uma era o logo da loja.
// Só as 6 mais promissoras (primária e fresca na frente): é a pauta escolhida que vai usar isso,
// e ela sai quase sempre desse topo.
const SERVICO_JOGO = 'https://n8n.promoliso.com.br/jogo/fotos';
const ALVOS_JOGO = 6;
const idadeH = (c) => {
  const t = Date.parse(String((c && c.publicado_em) || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
};
const promissoras = pool.map((c, i) => ({ c, i }))
  .filter(({ c }) => c && String(c.titulo || '').trim().length >= 8)
  .sort((a, b) => ((b.c.tipo_fonte === 'primaria') ? 1 : 0) - ((a.c.tipo_fonte === 'primaria') ? 1 : 0)
    || (idadeH(a.c) - idadeH(b.c)))
  .slice(0, ALVOS_JOGO);
const alvosJogo = promissoras.map(({ c, i }) => ({
  json: { __idx: i, __tipo: 'jogo', url: SERVICO_JOGO + '?titulo=' + encodeURIComponent(String(c.titulo).slice(0, 160)) },
}));

const todos = [
  ...alvos.map(({ c, i }) => ({ json: { __idx: i, __tipo: 'og', url: String(c.url || c.link || '') } })),
  ...alvosJogo,
];
if (!todos.length) return [{ json: { __idx: -1, url: 'https://example.com/', __sentinela: true } }];
return todos;