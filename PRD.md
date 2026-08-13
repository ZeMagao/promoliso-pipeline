# PRD - Evolução da Automação e Crescimento da PromoLiso

**Responsável:** João Pedro Sampaio  
**Instagram:** @promoliso0  
**Versão:** 0.1  
**Data:** 07/08/2026  
**Status:** Pronto para validação técnica

## 1. Resumo executivo

A PromoLiso já possui uma operação automatizada capaz de pesquisar pautas e publicar conteúdo no Instagram. O próximo estágio não deve ser aumentar o volume de publicações, mas transformar o sistema em uma operação que mede resultados, aprende com o histórico e melhora a qualidade editorial sem exigir trabalho manual frequente.

Este PRD propõe uma evolução por camadas:

1. Instrumentação, analytics e observabilidade.
2. Melhoria da curadoria, dos títulos, das imagens e dos templates.
3. Relatórios automáticos e aprendizado baseado no desempenho.
4. Atribuição de afiliados e automação de ofertas.

> **Decisão central:** o núcleo dos dois workflows atuais não será reconstruído. As melhorias serão adicionadas como módulos independentes, com versionamento, monitoramento e possibilidade de reversão.

## 2. Contexto e estado atual

- **Objetivo de negócio:** construir uma marca concreta, aumentar seguidores e alcance, gerar cliques e vendas de afiliados e desenvolver autoridade.
- **Público:** pessoas de 18 a 45 anos interessadas em games, hardware e tecnologia, incluindo gamers e streamers.
- **Operação:** dois workflows no n8n, hospedados em VPS. Um pesquisa pautas e o outro publica.
- **Banco de dados:** existe, mas a tecnologia e o esquema ainda precisam ser mapeados.
- **Publicação:** totalmente automática.
- **Frequência informada:** três posts às segundas, terças e quintas; dois posts nos demais dias.
- **Conteúdo:** notícias, hardware, promoções e curiosidades.
- **Fontes atuais:** Adrenaline, GameVicio, Flow Games, Xbox e PlayStation.
- **Coleta:** mistura de métodos.
- **Formato:** carrossel de cinco páginas, com uma imagem por página.
- **Design:** um template em HTML/CSS, com adaptação parcial para títulos longos.
- **IA editorial:** agente redator usando GPT e Claude, prompt fixo, CTA e hashtags automáticos.
- **Desempenho informado:** 84 seguidores e média aproximada de 15 visualizações ou alcance nos posts recentes.
- **Afiliados:** Amazon, Shopee, Magalu, AliExpress, Mercado Livre e KaBuM!.
- **Limitação operacional:** quase nenhum tempo disponível para trabalho manual.
- **Orçamento:** existe orçamento para APIs e ferramentas, mas o valor ainda não foi definido.
- **Restrição principal:** não reconstruir todo o workflow.

## 3. Diagnóstico

### 3.1 Ausência de ciclo de aprendizado

O fluxo publica conteúdo, mas não registra de forma estruturada por que um post performou melhor que outro. Sem dados históricos associados a tema, título, template, horário e imagens, a automação não consegue aprender.

### 3.2 Desempenho abaixo do desejado

A média informada é baixa para o volume de publicações. Antes de aumentar a frequência, é necessário melhorar seleção de pautas, apresentação editorial, qualidade visual e distribuição.

### 3.3 Repetição de imagens

O carrossel depende de cinco imagens e frequentemente repete a mesma imagem quando não encontra opções suficientes. Isso reduz variedade e percepção de qualidade.

### 3.4 Repetição visual

Existe apenas um template, com adaptação parcial para títulos maiores. Isso deixa o feed visualmente repetitivo e pode gerar títulos pouco legíveis ou pouco impactantes.

### 3.5 Falta de atribuição de afiliados

Não é possível identificar qual post gerou clique ou venda. A PromoLiso possui diversos programas de afiliados, mas ainda não consegue comparar a rentabilidade de temas, produtos, formatos e campanhas.

### 3.6 Lacunas técnicas

Ainda precisam ser mapeados:

- tecnologia e esquema do banco de dados;
- APIs e serviços utilizados;
- tempo entre a publicação da fonte e a postagem;
- regra atual de escolha das imagens;
- permissões disponíveis na API da Meta;
- pontos frágeis dos workflows;
- logs, alertas e procedimentos de recuperação existentes.

## 4. Visão do produto

A PromoLiso deve funcionar como uma pequena operação editorial autônoma: descobrir pautas e ofertas relevantes, selecionar imagens adequadas, criar conteúdo visual variado, publicar, medir o resultado e recomendar ajustes.

O responsável deve atuar principalmente como monitor e auditor do sistema, intervindo apenas em exceções, falhas ou decisões relevantes.

## 5. Objetivos

- Preservar a estabilidade dos workflows atuais.
- Criar uma base confiável de métricas por publicação.
- Aumentar alcance, seguidores e engajamento.
- Melhorar curadoria, títulos, imagens e variedade visual.
- Permitir atribuição de cliques e vendas aos posts.
- Reduzir a necessidade de intervenção manual.
- Criar um ciclo contínuo de medição, aprendizado e otimização.

## 6. Restrições

- Não reconstruir integralmente os dois workflows existentes.
- Novos componentes devem ser adicionados antes, depois ou paralelamente ao fluxo atual.
- Uma falha em analytics ou relatórios não pode impedir uma publicação.
- Toda mudança deve possuir logs, versão e estratégia de rollback.
- Credenciais e tokens não podem ser gravados diretamente no código ou nos workflows.
- A tecnologia atual do banco deve ser descoberta antes da criação de migrations.
- Não substituir tecnologias existentes sem justificativa e aprovação explícita.
- Não aumentar o volume de posts antes de existir uma linha de base confiável.
- Manter a identidade visual da PromoLiso, permitindo evolução sem descaracterização.
- Priorizar operação automática e auditoria por exceção.

## 7. Fora da versão inicial

- Reconstrução completa dos workflows.
- Resposta automática a comentários.
- Troca completa da identidade visual.
- Aumento automático da quantidade de posts.
- Decisões editoriais irreversíveis sem logs ou rollback.
- Aprendizado autônomo que altere regras de produção sem limites e aprovação.
- Automação completa de ofertas antes da conclusão da instrumentação e da atribuição.

## 8. Princípios de implementação

1. **Acoplar, não substituir:** preservar o núcleo existente.
2. **Medir antes de otimizar:** registrar uma linha de base de pelo menos 30 dias.
3. **Alterar uma variável por vez:** testar separadamente template, prompt, CTA, horário ou tema.
4. **Manter rollback simples:** versionar prompts, templates e regras.
5. **Operar por exceção:** alertar o responsável apenas quando houver falha, risco ou decisão necessária.
6. **Implementar de forma idempotente:** reexecuções não podem duplicar registros ou publicações.
7. **Preservar rastreabilidade:** cada publicação deve poder ser reconstruída a partir dos dados salvos.

## 9. Funcionalidades principais da versão inicial

### 9.1 Analytics por publicação

- Registrar cada publicação com tema, formato, fonte, horário, template, versão do prompt, CTA e imagens utilizadas.
- Coletar métricas inicialmente em D+1, D+3 e D+7.
- Armazenar alcance, visualizações, curtidas, comentários, compartilhamentos, salvamentos, visitas ao perfil e seguidores atribuíveis quando disponíveis.
- Registrar tentativas, falhas e indisponibilidade de métricas.

### 9.2 Relatório semanal

- Gerar relatório automático com volume publicado.
- Exibir os cinco melhores e os cinco piores posts.
- Comparar temas, formatos, fontes, horários e templates.
- Identificar padrões observados.
- Sugerir ações objetivas para a semana seguinte.
- Entregar o relatório em um canal configurável.

### 9.3 Observabilidade

- Monitorar execução dos workflows e integrações.
- Registrar etapa, horário, duração, resultado e erro.
- Emitir alertas com impacto e ação recomendada.
- Isolar falhas dos módulos adicionais para não bloquear a publicação.

### 9.4 Versionamento

- Versionar prompts, templates e regras editoriais.
- Registrar em cada post as versões utilizadas.
- Permitir rollback para uma versão estável.
- Manter histórico das alterações e resultados.

### 9.5 Curadoria e score de pautas

- Calcular relevância antes da publicação.
- Considerar afinidade com o público, impacto, novidade, tendência, potencial de compartilhamento e duplicidade.
- Salvar score e justificativa.
- Permitir configuração dos limiares de publicar, arquivar ou descartar.

### 9.6 Imagens

- Detectar imagens idênticas ou quase idênticas por hash perceptual.
- Buscar imagens por entidades relacionadas à pauta.
- Criar banco de apoio para temas recorrentes.
- Registrar origem e regras de uso das imagens.
- Acionar fallback quando não houver imagens suficientes.
- Variar composição, recorte e enquadramento quando a repetição for inevitável.
- Não repetir exatamente o mesmo slide sem decisão registrada.

### 9.7 Templates

Evoluir de um para três templates:

1. Notícia padrão.
2. Notícia de alto impacto ou urgente.
3. Hardware ou oferta.

Todos os templates devem:

- manter a identidade atual;
- adaptar-se ao tamanho do título;
- impedir overflow;
- registrar a versão usada;
- permitir retorno ao template anterior.

### 9.8 Títulos e conteúdo editorial

- Produzir títulos curtos, impactantes e precisos.
- Usar regras diferentes por tipo de conteúdo.
- Evitar títulos genéricos ou excessivamente longos.
- Manter CTA contextual e coerente com o conteúdo.
- Registrar modelo de IA, prompt e versão utilizados.

### 9.9 Atribuição de afiliados

- Padronizar links com identificadores por plataforma, campanha e post.
- Registrar cliques, conversões e receita quando os programas disponibilizarem os dados.
- Permitir comparação por produto, tema, formato e origem.
- Não publicar credenciais ou informações sensíveis nos links.

## 10. Requisitos funcionais

| ID | Requisito | Prioridade | Critério de aceite |
|---|---|---:|---|
| RF-01 | Registrar os metadados de todos os posts publicados. | P0 | O post pode ser consultado pelo ID interno e pelo ID do Instagram. |
| RF-02 | Coletar métricas em D+1, D+3 e D+7. | P0 | Pelo menos 95% das coletas são concluídas ou registradas como erro. |
| RF-03 | Executar analytics sem alterar a lógica central de publicação. | P0 | Uma falha no módulo não impede a publicação. |
| RF-04 | Gerar relatório semanal automático. | P0 | O relatório contém volume, top 5, bottom 5, temas, formatos e ações. |
| RF-05 | Versionar prompts e templates. | P0 | Cada post registra as versões usadas e existe rollback. |
| RF-06 | Aplicar score de pauta antes da publicação. | P1 | Score, justificativa e decisão ficam gravados. |
| RF-07 | Detectar duplicidade visual no carrossel. | P1 | Uma repetição aciona fallback antes da renderização. |
| RF-08 | Buscar imagens por entidades e banco de apoio. | P1 | O fallback é auditável e registra a origem da imagem. |
| RF-09 | Selecionar entre três templates por tipo de conteúdo. | P1 | Nenhum título fica ilegível ou ultrapassa os limites. |
| RF-10 | Atribuir links de afiliados por post. | P1 | Todos os links publicados possuem identificador rastreável. |
| RF-11 | Monitorar a saúde dos workflows e integrações. | P1 | Alertas informam falha, etapa, impacto e ação recomendada. |
| RF-12 | Automatizar ofertas em fluxo independente. | P2 | Ofertas vencidas ou indisponíveis não são publicadas. |

## 11. Dados mínimos por publicação

### Identificação

- ID interno.
- ID da mídia no Instagram.
- Data e horário.
- Status da publicação.

### Dados editoriais

- Tipo de conteúdo.
- Tema.
- Entidades detectadas.
- Fonte.
- Score e justificativa.
- Decisão editorial.

### Dados de criação

- Título.
- Legenda.
- CTA.
- Hashtags.
- Modelo de IA.
- Versão do prompt.

### Dados visuais

- Template e versão.
- Imagens utilizadas.
- Origem das imagens.
- Hash perceptual.
- Quantidade de imagens únicas.

### Dados operacionais

- Horário de coleta.
- Horário de publicação.
- Duração do processamento.
- Número de tentativas.
- Erros e avisos.

### Métricas

- Alcance.
- Visualizações.
- Curtidas.
- Comentários.
- Compartilhamentos.
- Salvamentos.
- Visitas ao perfil.
- Seguidores atribuíveis, quando disponíveis.

### Monetização

- Plataforma afiliada.
- Identificador do link.
- Cliques.
- Conversões.
- Receita, quando disponível.

## 12. Entidades conceituais

Os nomes físicos das tabelas devem seguir a convenção já existente no projeto.

### Publicação

Representa um post ou carrossel publicado ou preparado para publicação.

### Pauta

Representa a notícia, oferta ou assunto coletado antes da criação do conteúdo.

### Fonte

Representa o portal, API, RSS ou origem utilizada para coletar a pauta.

### Métrica da publicação

Representa uma captura de métricas de uma publicação em uma determinada janela.

### Imagem

Representa um asset utilizado ou candidato, incluindo origem, entidade relacionada e hash.

### Template

Representa uma versão de layout HTML/CSS disponível para renderização.

### Versão de prompt

Representa o texto e as configurações utilizadas pelo agente redator.

### Execução do workflow

Representa uma execução, suas etapas, duração, status, tentativas e erros.

### Link de afiliado

Representa um link rastreável associado a plataforma, campanha, produto e publicação.

### Relatório semanal

Representa o período analisado, dados agregados, insights e recomendações produzidas.

## 13. Métricas de sucesso

| Dimensão | Indicador | Meta | Janela |
|---|---|---:|---|
| Cobertura | Posts com registro completo | 100% | Imediato |
| Confiabilidade | Coletas de métricas concluídas | Pelo menos 95% | Primeiros 30 dias |
| Estabilidade | Publicações sem erro | Não piorar a linha de base; alvo de 98% | Contínuo |
| Qualidade visual | Repetição exata não planejada em carrosséis | 0 | Após RF-07 |
| Layout | Posts com overflow ou título ilegível | 0 | Após RF-09 |
| Aprendizado | Relatórios semanais entregues | 100% | Após RF-04 |
| Atribuição | Links afiliados rastreáveis | 100% | Após RF-10 |
| Crescimento | Mediana de alcance por post | Aumento de 100% sobre a linha de base | Meta provisória de 90 dias |
| Marca | Seguidores líquidos | Crescimento positivo por oito semanas | Meta provisória |

As metas de crescimento devem ser revisadas após 30 dias de instrumentação.

## 14. Roadmap

### Fase 0 - Mapeamento técnico

**Estimativa:** uma semana.

- Inventariar nodes, integrações, APIs, banco, custos e credenciais necessárias.
- Exportar e versionar os workflows atuais.
- Mapear logs, falhas e procedimentos de recuperação.
- Confirmar permissões da API da Meta.
- Registrar a linha de base inicial.

### Fase 1 - Analytics e observabilidade

**Estimativa:** duas a três semanas.

- Implementar RF-01 a RF-05.
- Criar migrations compatíveis com o banco existente.
- Implementar coletas D+1, D+3 e D+7.
- Criar relatório semanal.
- Configurar alertas básicos.

### Fase 2 - Qualidade editorial e visual

**Estimativa:** três a quatro semanas.

- Implementar RF-06 a RF-09.
- Criar os três templates.
- Implementar score de pautas.
- Detectar duplicidade de imagens.
- Adicionar busca por entidades e banco de apoio.
- Executar testes controlados.

### Fase 3 - Atribuição e ofertas

**Estimativa:** duas a quatro semanas.

- Implementar RF-10.
- Integrar rastreamento por plataforma afiliada.
- Priorizar plataformas com maior potencial.
- Implementar RF-12 somente após validação da atribuição.

### Fase 4 - Aprendizado contínuo

- Analisar histórico.
- Ajustar regras e prompts com base em evidências.
- Revisar mensalmente temas, templates, horários e CTAs.
- Automatizar somente decisões que possuam dados e limites claros.

## 15. Riscos e mitigação

### Regressão no fluxo atual

Usar módulos isolados, ambiente de teste, feature flags, backup e rollback.

### Dados insuficientes

Aguardar uma linha de base mínima antes de automatizar decisões agressivas.

### Dependência de APIs

Registrar limites, permissões, custos, indisponibilidade e alternativas por integração.

### Direitos de imagem

Armazenar origem e regras de uso, priorizando assets oficiais ou licenciados.

### Otimização para métricas erradas

Equilibrar alcance com seguidores, compartilhamentos, salvamentos e conversão.

### Excesso de automação

Manter revisão por exceção e limites para temas sensíveis, preços e afirmações.

## 16. Pendências para validação técnica

1. Qual tecnologia e esquema de banco de dados estão em uso?
2. Quais APIs, credenciais e serviços estão ativos e qual o custo de cada um?
3. Qual é a programação exata de publicação para sexta, sábado e domingo?
4. Qual é a latência real entre a publicação da fonte e a postagem da PromoLiso?
5. Qual regra atual escolhe as cinco imagens?
6. Como o carrossel é renderizado e armazenado?
7. Quais permissões da API da Meta estão aprovadas?
8. Como os links de afiliados chegam ao usuário?
9. Qual é o orçamento mensal disponível?
10. Quais plataformas afiliadas devem ser priorizadas?
11. Quais fontes de imagem podem ser reutilizadas com segurança?
12. Quais logs, alertas e procedimentos de recuperação já existem?

## 17. Critérios para início da implementação

- Inventário dos dois workflows exportado e documentado.
- Backup e rollback testados.
- Acesso de leitura ao banco, logs e API da Meta confirmado.
- Linha de base inicial registrada.
- Orçamento, responsáveis e canal de alertas definidos.
- Fase a ser implementada aprovada.
- Critérios de aceite revisados com o responsável.

## 18. Critério de conclusão da versão inicial

A versão inicial será considerada concluída quando:

- os workflows originais continuarem publicando normalmente;
- todos os posts forem registrados;
- as coletas D+1, D+3 e D+7 funcionarem;
- o relatório semanal for entregue automaticamente;
- prompts e templates possuírem versionamento e rollback;
- logs e alertas permitirem identificar falhas;
- as migrations e instruções de execução estiverem documentadas;
- não houver credenciais expostas;
- os critérios P0 estiverem atendidos e os P1 aprovados para implantação.

## 19. Visão do responsável

> A PromoLiso deve funcionar quase sozinha, exigindo apenas monitoramento e auditoria para confirmar que os processos estão sendo executados como desejado.

