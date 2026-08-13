# Prompt para implementar o plano de melhorias da PromoLiso

Copie o texto abaixo e envie à IA que terá acesso ao projeto atual.

---

Leia integralmente o arquivo `PRD.md` para entender o projeto PromoLiso e implemente o plano de melhorias de forma incremental.

Este não é um projeto novo. Já existem dois workflows do n8n em produção, hospedados em uma VPS: um pesquisa pautas e outro publica automaticamente no Instagram. O objetivo é evoluir o sistema sem reconstruir ou desestabilizar o que já funciona.

## Antes de implementar

1. Audite o repositório, os workflows, a estrutura do banco, as integrações e os arquivos de configuração existentes.
2. Identifique as tecnologias realmente utilizadas. Não presuma a tecnologia do banco ou invente componentes que não estejam no projeto.
3. Exporte ou registre uma cópia dos workflows atuais e confirme que existe uma estratégia segura de rollback.
4. Mapeie credenciais necessárias, variáveis de ambiente, APIs, custos, logs e pontos de falha sem exibir valores secretos.
5. Compare o estado atual com o `PRD.md` e apresente um plano curto de execução por fases.
6. Se uma informação indispensável não puder ser descoberta no projeto, registre a pendência e solicite apenas a decisão necessária. Não escolha silenciosamente uma nova tecnologia.

## Regras da implementação

- Preserve o núcleo dos dois workflows atuais.
- Adicione as melhorias antes, depois ou paralelamente aos fluxos existentes.
- Use exatamente as tecnologias já presentes no projeto e as restrições definidas no `PRD.md`.
- Não substitua banco, framework, hospedagem, serviços ou integrações sem aprovação explícita.
- Implemente primeiro a Fase 0 e a Fase 1 do roadmap.
- Implemente todos os requisitos P0 da seção `Requisitos funcionais`.
- Só implemente requisitos P1 quando as dependências P0 estiverem concluídas e houver dados suficientes para validá-los.
- Não implemente RF-12 nem itens da seção `Fora da versão inicial` nesta etapa.
- Não aumente a quantidade de publicações.
- Não implemente resposta automática a comentários.
- Não altere completamente a identidade visual.
- Não crie cadastro ou login, pois autenticação de usuários não faz parte deste PRD.
- Crie as entidades necessárias seguindo a seção `Entidades conceituais` e as convenções já existentes no banco.
- Crie migrations compatíveis com a tecnologia de banco encontrada no projeto.
- Todas as migrations devem possuir estratégia de rollback quando a tecnologia permitir.
- Garanta idempotência: reexecutar um workflow ou coletor não pode duplicar publicações, métricas ou relatórios.
- Uma falha em analytics, relatórios ou observabilidade não pode impedir a publicação no Instagram.
- Registre logs estruturados, tentativas, erros e duração das etapas.
- Versione prompts, templates e regras editoriais.
- Associe cada publicação às versões usadas.
- Armazene segredos somente em credenciais do n8n, variáveis de ambiente ou mecanismo seguro já adotado pelo projeto.
- Não grave tokens, senhas ou chaves no código, nos commits, nos exemplos ou nos logs.
- Preserve os dados existentes.
- Crie testes ou verificações automatizadas proporcionais ao risco de cada mudança.
- Deixe o projeto e os workflows prontos para execução em ambiente local ou de homologação, sem depender de credenciais reais.
- Use mocks ou variáveis de exemplo para integrações externas quando necessário.
- Não adicione funcionalidades que não estejam previstas no PRD.

## Entregas mínimas da Fase 0

- Inventário da arquitetura atual.
- Lista dos workflows e responsabilidade de cada um.
- Mapa do banco e das integrações.
- Lista das variáveis de ambiente necessárias, sem valores secretos.
- Registro da linha de base disponível.
- Plano de backup, teste e rollback.
- Lista objetiva das pendências que impedem alguma implementação.

## Entregas mínimas da Fase 1

- Registro dos metadados de todas as publicações.
- Coleta de métricas em D+1, D+3 e D+7.
- Isolamento entre publicação e analytics.
- Relatório semanal automático.
- Logs e alertas básicos.
- Versionamento de prompts e templates.
- Migrations do banco.
- Configuração local ou de homologação.
- Documentação das decisões técnicas.

## Critérios obrigatórios de aceite

- O fluxo atual continua publicando normalmente.
- Uma falha no novo módulo não bloqueia a publicação.
- As execuções são idempotentes.
- Todos os posts novos possuem registro interno.
- Pelo menos 95% das coletas são concluídas ou registradas claramente como erro.
- O relatório semanal contém volume, top 5, bottom 5, temas, formatos e ações sugeridas.
- Cada post registra as versões de prompt e template utilizadas.
- Nenhuma credencial é exposta.
- As migrations podem ser aplicadas de forma previsível.
- Existe procedimento documentado de rollback.

## Forma de trabalho

Implemente em etapas pequenas e verificáveis. Antes de cada alteração relevante:

1. Informe qual requisito do PRD será atendido.
2. Explique resumidamente quais arquivos, nodes ou entidades serão alterados.
3. Preserve alterações existentes que não façam parte desta tarefa.
4. Execute as verificações adequadas após a mudança.
5. Registre qualquer desvio do PRD e a justificativa.

Se encontrar conflito entre o PRD e o projeto real, não reconstrua o sistema por conta própria. Apresente o conflito, o impacto e a menor solução compatível com a arquitetura atual.

## Ao final, mostre

- Resumo executivo do que foi implementado.
- Requisitos atendidos, identificados por ID.
- Requisitos não implementados e o motivo.
- Arquivos, workflows, nodes, entidades e migrations criados ou alterados.
- Decisões técnicas e eventuais desvios do PRD.
- Testes e verificações executados, com os resultados.
- Riscos ou pendências restantes.
- Variáveis de ambiente necessárias, sem valores secretos.
- Comandos para instalar dependências e rodar o projeto localmente.
- Procedimento para importar e testar os workflows do n8n.
- Comandos para aplicar e reverter as migrations.
- Procedimento de rollback da implantação.

Não declare a implementação como concluída se algum requisito obrigatório não tiver sido atendido ou verificado.

