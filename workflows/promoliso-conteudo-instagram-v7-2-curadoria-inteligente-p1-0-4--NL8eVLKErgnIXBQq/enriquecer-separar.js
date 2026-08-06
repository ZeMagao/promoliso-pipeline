const pool = ($json.candidatos) || [];
const temImg = (c) => c && c.imagem_principal && /^https:\/\//i.test(c.imagem_principal);
const semImg = pool.map((c, i) => ({ c, i })).filter(({ c }) => !temImg(c));
// primárias primeiro; teto de 8 fetches por execução
semImg.sort((a, b) =>
  ((b.c.tipo_fonte === 'primaria') ? 1 : 0) - ((a.c.tipo_fonte === 'primaria') ? 1 : 0));
const alvos = semImg.slice(0, 8);
if (!alvos.length) return [{ json: { __idx: -1, url: 'https://example.com/', __sentinela: true } }];
return alvos.map(({ c, i }) => ({ json: { __idx: i, url: String(c.url || c.link || '') } }));