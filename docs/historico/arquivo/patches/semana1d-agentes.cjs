/**
 * Conserta os agentes que atrapalhavam a publicação (autonomia dada em
 * 2026-07-29). Baseado no diagnóstico da exec 79.
 *
 * Problemas medidos:
 *   1. AI Agent editorial recebe imagens_oficiais prontas e MESMO ASSIM caça
 *      imagem, cola URL .html no lugar da imagem, e — pior — quando "não acha"
 *      imagem, reprova a pauta E contamina o texto ("Espere a arte oficial").
 *      O system prompt de 13.5KB tem ~4 seções mandando caçar/avaliar/reprovar
 *      por imagem, em choque com a guarda que manda só copiar imagens_oficiais.
 *   2. O candidato carrega classificacao_conteudo="inconclusivo" (do
 *      Verificador) e o agente usa isso pra rejulgar a segurança do assunto e
 *      reprovar — sendo que a curadoria já aprovou a pauta.
 *   3. O Verificador rebaixa notícia factual de fonte primária para
 *      "inconclusivo" só porque não pode reabrir a página (o próprio prompt
 *      diz que ele não faz consulta externa) — cria dúvida artificial.
 *
 * Correções:
 *   A. AI Agent vira redator de TEXTO. Copia imagens_oficiais, nunca pesquisa
 *      imagem, nunca reprova por imagem, nunca escreve sobre imagem/arte/
 *      resolução/produção, e não rejulga a segurança do assunto. (imagem já é
 *      determinística no "Validar antes de publicar" — semana1c.)
 *   B. Remove a tool "Buscar capa" do AI Agent (não pode mais caçar imagem).
 *   C. Remove classificacao_conteudo do candidato que o agente/validação veem
 *      (a validação não usa; só a consolidação da curadoria usava, upstream).
 *   D. Verificador para de rebaixar anúncio factual de fonte primária/editorial
 *      para inconclusivo por não poder reabrir a página.
 *
 * Uso: node patches/semana1d-agentes.cjs [--dry] [caminho-do-sqlite]
 * Com o n8n PARADO para gravar (sem --dry).
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const RAIZ = path.resolve(__dirname, '..');
const DB = args.find((a) => !a.startsWith('--')) ||
  path.join(RAIZ, 'data', '.n8n', 'database.sqlite');
const WF = 'NL8eVLKErgnIXBQq';

function trocar(texto, de, para, rotulo) {
  if (!texto.includes(de)) throw new Error('alvo não encontrado (' + rotulo + ')');
  if (texto.split(de).length > 2) throw new Error('alvo ambíguo (' + rotulo + ')');
  return texto.split(de).join(para);
}
function remover(texto, de, rotulo) {
  return trocar(texto, de, '', rotulo);
}

function aplicar(nodes, connections) {
  const feito = [];
  const pegar = (nome) => {
    const n = nodes.find((x) => x.name === nome);
    if (!n) throw new Error('node não encontrado: ' + nome);
    return n;
  };

  // -------------------------------------------------------------------------
  // C. Remover classificacao_conteudo do candidato que o agente vê.
  // -------------------------------------------------------------------------
  const consolidar = pegar('Consolidar candidatos aprovados');
  let cc = String(consolidar.parameters.jsCode);
  cc = remover(
    cc,
    `      classificacao_conteudo:
        selected.registro?.classificacao_conteudo || '',
`,
    'C. classificacao_conteudo fora do candidato',
  );
  consolidar.parameters.jsCode = cc;
  feito.push('C. classificacao_conteudo removido do candidato do agente');

  // -------------------------------------------------------------------------
  // A. AI Agent — user prompt (text).
  // -------------------------------------------------------------------------
  const agent = pegar('AI Agent');
  let tx = String(agent.parameters.text);

  // A1. tira a caça de imagem do corpo.
  tx = trocar(
    tx,
    ` Use Buscar capa para encontrar imagens oficiais ou editoriais diretamente relacionadas à pauta. Busque imagens suficientes para que o carrossel tenha variedade visual.`,
    ``,
    'A1. remover caça de imagem (Buscar capa) do corpo',
  );

  // A2. fact-check sim, "pesquisar outras candidatas" não (conflita com guarda).
  tx = trocar(
    tx,
    `Use Busca detalhada para confirmar os fatos, complementar a fonte primária e pesquisar outras candidatas somente se os feeds não trouxerem uma pauta adequada.`,
    `Use Busca detalhada para confirmar os fatos e complementar a fonte primária.`,
    'A2. Busca detalhada só para confirmar fatos',
  );

  // A3. reescreve as bullets de imagem da guarda + anti-contaminação + não-rejulgar.
  tx = trocar(
    tx,
    `- candidatos.imagens_oficiais contém URLs HTTPS diretas extraídas da própria fonte primária; copie essas URLs para capa e slides antes de qualquer busca visual;
- não esvazie capa ou slide.imagem quando imagens_oficiais estiver preenchido;
- se houver menos de cinco imagens oficiais, reutilize-as em vez de reprovar a pauta;`,
    `- candidatos.imagens_oficiais traz URLs HTTPS diretas já extraídas da fonte; copie-as para capa e para cada slide.imagem. Se houver menos de cinco, reutilize as disponíveis;
- NUNCA pesquise imagens, NUNCA use a URL de uma página (.html) como imagem, NUNCA reprove a pauta por causa de imagem — o fluxo aplica as imagens oficiais de forma determinística;
- NUNCA escreva sobre imagem, arte, resolução, "aguardar arte oficial" ou sobre o processo de produção em título, destaque, texto ou legenda; os slides falam do ASSUNTO para o leitor;
- não rejulgue se o assunto é seguro nem use classificações internas de confiabilidade para reprovar — a curadoria já aprovou a pauta;`,
    'A3. guarda de imagem + anti-contaminação + não-rejulgar',
  );
  agent.parameters.text = tx;
  feito.push('A(text). caça de imagem removida; anti-contaminação e não-rejulgar adicionados');

  // -------------------------------------------------------------------------
  // A. AI Agent — system message.
  // -------------------------------------------------------------------------
  let sm = String(agent.parameters.options.systemMessage);

  // SM1. processo passo 6.
  sm = trocar(
    sm,
    `6. Pesquise imagens depois de confirmar a pauta. Prefira imagens oficiais do fabricante, desenvolvedor, publicadora, press kit ou página da notícia.`,
    `6. As imagens já vêm em candidatos.imagens_oficiais e são aplicadas pelo fluxo. Copie-as para capa e slides; não pesquise imagens.`,
    'SM1. processo passo 6 sem caça de imagem',
  );

  // SM2. campos visuais — parágrafo de imagem.
  sm = trocar(
    sm,
    `Use pelo menos três imagens diferentes no conjunto sempre que houver material oficial. A imagem deve ser diretamente relacionada ao fato, ter boa resolução e não conter preço falso, montagem enganosa, marca-d'água de loja ou conteúdo sem relação. Os campos capa e imagem precisam conter URL direta do arquivo de imagem, nunca a URL da página da notícia. Se houver apenas uma imagem oficial direta, reutilize a capa em todos os slides em vez de inventar URLs.`,
    `Preencha capa e cada slide.imagem copiando as URLs de candidatos.imagens_oficiais, na ordem em que vierem. Se houver menos de cinco, reutilize as disponíveis. Nunca use a URL de uma página (.html) como imagem e nunca invente URLs. As imagens oficiais são aplicadas de forma determinística pelo fluxo — você não precisa pesquisar nem avaliar imagens.`,
    'SM2. campos visuais determinísticos',
  );

  // SM3. regras de qualidade — desacopla aprovação de imagem + anti-contaminação.
  sm = trocar(
    sm,
    `- conteúdos que não sejam OFERTA devem deixar os campos de oferta vazios;
- aprovado_para_publicar só pode ser true quando pauta, fontes, imagens e textos estiverem completos e verificáveis.`,
    `- não reprove por causa de imagem, nem por classificação interna de confiabilidade: imagem é responsabilidade determinística do fluxo e a segurança do assunto já foi decidida na curadoria;
- nunca escreva sobre imagem, arte, resolução, disponibilidade de mídia ou sobre o processo de produção nos títulos, destaques, textos ou legenda — os slides falam do ASSUNTO para o leitor;
- conteúdos que não sejam OFERTA devem deixar os campos de oferta vazios;
- aprovado_para_publicar só pode ser true quando pauta, fontes e textos estiverem completos e verificáveis.`,
    'SM3. desacopla aprovação de imagem + anti-contaminação',
  );

  // SM4. remove seção inteira P0.6 (caça/reprova por imagem).
  sm = remover(
    sm,
    `

## Verificação visual PromoLiso P0.6
- Cada fonte deve aparecer uma única vez. Nunca duplique a mesma URL para simular uma segunda confirmação.
- A imagem deve mostrar diretamente o jogo, produto, serviço ou empresa da pauta. Nunca use arte de outra franquia apenas porque pertence à mesma plataforma.
- Não use imagens de Halo em uma pauta de Ubisoft, nem arte genérica de outro jogo, mesmo quando vier de um domínio confiável.
- Rejeite miniaturas pequenas. Prefira imagens com pelo menos 1200x675. Quando a mídia for oficial e diretamente relacionada, 960x540 ou maior é válida; 1024x576 é explicitamente válida. Rejeite dimensões abaixo de 900x500 e URLs marcadas como 150x110, 300x200 ou tamanhos semelhantes.
- Em fonte_imagem, escreva a marca, jogo ou produto realmente mostrado, como UBISOFT, ASSASSIN'S CREED, NVIDIA ou XBOX. Não use rótulos genéricos para esconder a origem.
- Se não encontrar imagens relevantes e nítidas, marque aprovado_para_publicar como false. É melhor trocar de pauta do que completar o carrossel com imagens erradas.`,
    'SM4. remove seção P0.6',
  );

  // SM5. remove seção inteira P0.8 (busca de imagens).
  sm = remover(
    sm,
    `

## Recuperação de imagens oficiais PromoLiso P0.8
- Nos resultados da busca de imagens, use properties.url como URL original. Nunca use thumbnail.src nem placeholder, pois são miniaturas da busca.
- Confira properties.width e properties.height. Uma properties.url oficial com pelo menos 1200x675 é preferencial, mas 960x540, 1024x576 e imagens quadradas oficiais com pelo menos 1024x1024 são válidas.
- A URL original pode não terminar em .jpg ou .png. Endpoints HTTPS de CDN oficial que retornam imagem são válidos, inclusive assets.nintendo.com.au e serviços oficiais equivalentes.
- Quando encontrar somente uma arte oficial grande e diretamente relacionada, use essa mesma properties.url em capa e nos cinco slides. Não reprove uma pauta confirmada apenas por não haver cinco artes diferentes.
- Antes de reprovar por falta de imagem, faça pelo menos duas buscas visuais específicas: uma por "[jogo ou produto] official key art" e outra por "[jogo ou produto] press kit screenshot".
- Em fonte_imagem, inclua o assunto específico e a marca, por exemplo "SPLATOON RAIDERS — NINTENDO" ou "ODYSSEY G4 — SAMSUNG". Isso permite comprovar que a imagem corresponde à pauta.
- Mesmo em domínio oficial, nunca troque a franquia: Mario não serve para Splatoon, Halo não serve para Ubisoft e Odyssey G7 não serve para Odyssey G4.`,
    'SM5. remove seção P0.8',
  );

  // SM6. remove seção inteira P0.10 (seleção visual por busca).
  sm = remover(
    sm,
    `

## Seleção visual oficial PromoLiso P0.10
- xboxwire.thesourcemediaassets.com é o servidor oficial de imagens da Xbox Wire. wpassets.halowaypoint.com e halowaypoint.com são oficiais para Halo. Trate essas URLs como mídia primária quando a imagem e a notícia forem da mesma pauta.
- Quando a busca retornar duas ou mais properties.url oficiais, grandes e diretamente relacionadas, use URLs diferentes entre capa e slides. Priorize key art, screenshot e arte variante oficiais antes de repetir imagens.
- Se existir somente uma properties.url oficial adequada, reutilize-a. Não defina aprovado_para_publicar como false apenas por falta de variedade visual quando a fonte, a pauta e essa imagem forem verificáveis.
- Uma properties.url HTTPS oficial com dimensões declaradas e assunto correspondente já é uma URL final utilizável, mesmo quando vem de CDN, contém parâmetros de transformação ou não termina em extensão.
- Nunca alegue que faltou imagem oficial depois de encontrar em resultados de imagem uma properties.url oficial com dimensões suficientes e título relacionado à pauta.
- Antes de concluir a resposta, confronte a lista de imagens escolhidas com todos os resultados visuais já obtidos e aproveite as artes oficiais distintas disponíveis.`,
    'SM6. remove seção P0.10',
  );

  // SM7. P0.5 — troca a bullet de imagem por instrução determinística.
  sm = trocar(
    sm,
    `- Use no mínimo duas URLs de imagens realmente diferentes. Só reutilize uma única imagem quando ela vier da fonte primária oficial da pauta.`,
    `- As imagens vêm de candidatos.imagens_oficiais e são aplicadas pelo fluxo; não pesquise nem avalie imagens aqui.`,
    'SM7. P0.5 bullet de imagem',
  );

  // SM8. P0.11 — tira a exigência de dimensão de mídia da aprovação.
  sm = trocar(
    sm,
    `- Uma notícia confirmada por fonte primária recente, com mídia oficial relacionada de 960x540 ou maior, deve usar aprovado_para_publicar true quando as demais regras estiverem completas.
- Nunca descreva uma imagem oficial de 1024x576 como resolução insuficiente.`,
    `- Uma notícia confirmada por fonte primária recente deve usar aprovado_para_publicar true quando pauta, fontes e textos estiverem completos. A imagem é responsabilidade do fluxo.`,
    'SM8. P0.11 sem exigência de dimensão de imagem',
  );

  // SM9. Barreiras determinísticas — bullet de imagem.
  sm = trocar(
    sm,
    `- Imagens devem ser URLs HTTPS do arquivo ou CDN, nunca página HTML, miniatura de busca ou rede social.`,
    `- As imagens são aplicadas pelo fluxo a partir de candidatos.imagens_oficiais; nunca use a URL de uma página HTML como imagem.`,
    'SM9. Barreiras determinísticas bullet de imagem',
  );

  agent.parameters.options.systemMessage = sm;
  feito.push('A(sysmsg). seções de caça de imagem removidas; aprovação desacoplada de imagem; anti-contaminação');

  // -------------------------------------------------------------------------
  // D. Verificador — parar de rebaixar factual primário para inconclusivo.
  // -------------------------------------------------------------------------
  const verif = pegar('Agente Verificador de Confiabilidade');
  const msgs = verif.parameters.messages.messageValues;
  const sys = msgs.find((m) => m.type === 'SystemMessagePromptTemplate');
  if (!sys) throw new Error('system message do Verificador não encontrado');
  sys.message = trocar(
    sys.message,
    `Fontes primárias configuradas têm peso maior, mas o conteúdo ainda deve ser coerente. Rumor e especulação nunca podem ser apresentados como fato.`,
    `Fontes primárias configuradas têm peso maior, mas o conteúdo ainda deve ser coerente. Rumor e especulação nunca podem ser apresentados como fato.
Quando a notícia vier de uma fonte primária configurada (fabricante, plataforma, desenvolvedora ou loja oficial) OU de um portal editorial que apenas reporta um anúncio factual dessas fontes, e as afirmações forem coerentes e datadas, classifique como oficial ou confirmado. Não rebaixe para inconclusivo só porque você não pôde reabrir a página nesta fase — a ausência de consulta externa não é motivo para dúvida. Reserve rumor, especulativo e inconclusivo para vazamentos, boatos, previsões ou afirmações realmente sem origem clara.`,
    'D. Verificador não rebaixa factual primário',
  );
  feito.push('D. Verificador para de rebaixar factual primário para inconclusivo');

  // -------------------------------------------------------------------------
  // B. Remover a tool "Buscar capa" do AI Agent (conexão ai_tool).
  // -------------------------------------------------------------------------
  const buscarCapa = connections['Buscar capa'];
  if (buscarCapa && buscarCapa.ai_tool) {
    const antes = JSON.stringify(buscarCapa.ai_tool);
    buscarCapa.ai_tool = buscarCapa.ai_tool
      .map((grp) => (grp || []).filter((c) => c.node !== 'AI Agent'))
      .filter((grp) => grp.length > 0);
    if (buscarCapa.ai_tool.length === 0) delete connections['Buscar capa'];
    const depois = JSON.stringify(connections['Buscar capa']?.ai_tool || null);
    if (antes === depois) throw new Error('B. conexão Buscar capa -> AI Agent não encontrada');
    feito.push('B. tool "Buscar capa" desconectada do AI Agent');
  } else {
    throw new Error('B. Buscar capa não tem conexão ai_tool');
  }

  return feito;
}

module.exports = { aplicar };

if (require.main === module) {
  const db = new DatabaseSync(DB);
  const row = db.prepare('select nodes, connections from workflow_entity where id=?').get(WF);
  if (!row) throw new Error('workflow não encontrado em ' + DB);
  const nodes = JSON.parse(row.nodes);
  const connections = JSON.parse(row.connections);

  const feito = aplicar(nodes, connections);

  if (DRY) {
    console.log('[DRY-RUN] todos os alvos casaram. Mudanças NÃO gravadas:\n');
    feito.forEach((f) => console.log('  ' + f));
    console.log('\nRode sem --dry (com n8n parado) para gravar.');
  } else {
    db.prepare('update workflow_entity set nodes=?, connections=?, updatedAt=? where id=?').run(
      JSON.stringify(nodes),
      JSON.stringify(connections),
      new Date().toISOString().replace('T', ' ').replace('Z', ''),
      WF,
    );
    console.log('Aplicado em ' + DB + ':\n');
    feito.forEach((f) => console.log('  ' + f));
  }
}
