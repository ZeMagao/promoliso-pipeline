const historico = Array.isArray($json.historico) ? $json.historico : [];
const candidatos = Array.isArray($json.candidatos) ? $json.candidatos : [];
const diretrizes = [
  'Escolha primeiro uma pauta verificável dos feeds, publicada nos últimos 7 dias. Considere games de todas as plataformas, PC, GPUs, CPUs, notebooks, periféricos e serviços; confirme os fatos centrais em fonte oficial.',
  'Última tentativa: escolha outra pauta verificável ainda não tentada. Pode ser notícia de games, hardware, periféricos, consoles ou serviços. Exija preço, estoque e URL direta somente se a categoria escolhida for OFERTA.',
];

return diretrizes.map((diretriz, index) => ({
  json: {
    historico,
    candidatos,
    tentativa: index + 1,
    max_tentativas: diretrizes.length,
    diretriz,
  },
}));