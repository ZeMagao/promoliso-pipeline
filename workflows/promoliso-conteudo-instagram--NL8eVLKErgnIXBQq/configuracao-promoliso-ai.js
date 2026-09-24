const candidatos = Array.isArray($json.candidatos)
  ? $json.candidatos
  : [];

return [{
  json: {
    candidatos,
    promo_liso_ai: {
      fase: 'CURADORIA_INTELIGENTE',
      versao: '1.0.16',
      prompt_curador: 'curador-1.0.1',
      prompt_confiabilidade: 'confiabilidade-1.0.0',
      max_candidatos_ia: 5,
      janela_antiga_dias: 30,
      formatos_permitidos: [
        'imagem_unica',
        'carrossel',
        'story_estatico',
        'nenhum',
      ],
      dominios_primarios: ["blog.playstation.com","news.xbox.com","halowaypoint.com","nintendo.com","nvidia.com","amd.com","intel.com","steampowered.com","steamcommunity.com","epicgames.com","ubisoft.com","ea.com","konami.com","samsung.com","news.samsung.com","asus.com","msi.com","gigabyte.com"],
      dominios_editoriais: ["adrenaline.com.br","flowgames.gg","gamevicio.com","ign.com","gameblast.com.br","tecnoblog.net","gg.deals"],
    },
  },
}];