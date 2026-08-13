#!/usr/bin/env node
// Cria um banco de HOMOLOGAÇÃO do zero, com a mesma forma do banco do n8n em produção, mas com
// dados sintéticos. Serve para rodar migrations, coletores, relatório e testes SEM credencial real
// e SEM tocar em produção.
//
//   node analytics/homolog/seed.cjs [--saida=/caminho/homolog.sqlite] [--posts=12]
//   PROMO_DB=<saida> PROMO_ANALYTICS_MOCK=1 node analytics/migrate.cjs up
//
// O DDL abaixo é cópia do que existe no banco real (conferido em 2026-08-07); mudanças no schema
// do n8n aparecem como divergência aqui antes de aparecerem em produção.
const fs = require('fs');
const path = require('path');
const os = require('os');
const flatted = require('flatted');
const { abrirEnvolvido, agoraUtc } = require('../lib/db.cjs');

const saidaArg = (process.argv.find((a) => a.startsWith('--saida=')) || '').split('=')[1];
const POSTS = Number((process.argv.find((a) => a.startsWith('--posts=')) || '').split('=')[1] || 12);
const SAIDA = saidaArg || path.join(os.tmpdir(), 'promoliso-homolog.sqlite');

const PROJETO = 'HOMOLOGPROJ0001';
const T_PUB = 'FJFzDiOhgaT2ZOKv';
const T_CUR = 'PLAiCur8cTx26M1Q';
const T_FILA = 'i2e8ZwnL9kwOV6OG';
const WF_PRODUTOR = 'NL8eVLKErgnIXBQq';
const WF_PUBLICADOR = 'E27F7yVdsZRj';
const WF_WATCHDOG = 'MJly91QFGKep';
const WF_MONITOR = 'PRMLERR20260725A';

const DDL = [
  `CREATE TABLE "project" ("id" varchar(36) PRIMARY KEY NOT NULL, "name" varchar(255) NOT NULL, "type" varchar(36) NOT NULL, "createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "updatedAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "icon" text, "description" varchar(512), "creatorId" varchar, "customTelemetryTags" text NOT NULL DEFAULT ('[]'))`,
  `CREATE TABLE "workflow_entity" ("id" varchar(36) PRIMARY KEY NOT NULL, "name" varchar(128) NOT NULL, "active" boolean NOT NULL, "nodes" text, "connections" text, "settings" text, "staticData" text, "pinData" text, "versionId" varchar(36) NOT NULL, "triggerCount" integer DEFAULT (0), "meta" text, "parentFolderId" varchar(36), "createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "updatedAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "isArchived" boolean NOT NULL DEFAULT (FALSE), "versionCounter" integer NOT NULL DEFAULT (1), "description" text, "activeVersionId" varchar(36), "nodeGroups" text NOT NULL DEFAULT ('[]'), "sourceWorkflowId" varchar)`,
  `CREATE TABLE "workflow_history" ("versionId" varchar(36) PRIMARY KEY NOT NULL, "workflowId" varchar(36) NOT NULL, "authors" varchar(255) NOT NULL, "createdAt" datetime(3) NOT NULL, "updatedAt" datetime(3) NOT NULL, "nodes" text NOT NULL, "connections" text NOT NULL, "name" varchar(128), "autosaved" boolean NOT NULL DEFAULT (false), "description" text, "nodeGroups" text NOT NULL DEFAULT ('[]'))`,
  `CREATE TABLE "execution_entity" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "workflowId" varchar(36) NOT NULL, "finished" boolean NOT NULL, "mode" varchar NOT NULL, "retryOf" varchar, "retrySuccessId" varchar, "startedAt" datetime, "stoppedAt" datetime, "waitTill" datetime, "status" varchar NOT NULL, "deletedAt" datetime(3), "createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "storedAt" varchar(2) NOT NULL DEFAULT ('db'), "tracingContext" text, "deduplicationKey" varchar(255), "jsonSizeBytes" bigint NOT NULL DEFAULT (0), "workflowVersionId" varchar(36) DEFAULT (NULL), "binaryDataSizeBytes" bigint NOT NULL DEFAULT (0), "usedPrivateCredentials" BOOLEAN NOT NULL DEFAULT FALSE)`,
  `CREATE TABLE "execution_data" ("executionId" int PRIMARY KEY NOT NULL, "workflowData" text NOT NULL, "data" text NOT NULL, "workflowVersionId" VARCHAR(36), FOREIGN KEY("executionId") REFERENCES "execution_entity" ("id") ON DELETE CASCADE)`,
  `CREATE TABLE "data_table" ("id" varchar(36) PRIMARY KEY NOT NULL, "name" varchar(128) NOT NULL, "projectId" varchar(36) NOT NULL, "createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "updatedAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), CONSTRAINT "UQ_data_table" UNIQUE ("projectId","name"), CONSTRAINT "FK_data_table_project" FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE CASCADE)`,
  `CREATE TABLE "data_table_column" ("id" varchar(36) PRIMARY KEY NOT NULL, "name" varchar(128) NOT NULL, "type" varchar(32) NOT NULL, "index" integer NOT NULL, "dataTableId" varchar(36) NOT NULL, "createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "updatedAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), CONSTRAINT "UQ_data_table_column" UNIQUE ("dataTableId","name"), CONSTRAINT "FK_dtc_dt" FOREIGN KEY ("dataTableId") REFERENCES "data_table" ("id") ON DELETE CASCADE)`,
  `CREATE TABLE "data_table_user_${T_PUB}" ("id" integer PRIMARY KEY NOT NULL, "createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "updatedAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "content_key" TEXT, "topic" TEXT, "primary_url" TEXT, "category" TEXT, "operational_status" TEXT, "carousel_container_id" TEXT, "instagram_post_id" TEXT, "instagram_story_id" TEXT, "execution_id" TEXT, "published_at" TEXT, "error_message" TEXT)`,
  `CREATE TABLE "data_table_user_${T_FILA}" ("id" integer PRIMARY KEY NOT NULL, "createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "updatedAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "content_key" TEXT, "topic" TEXT, "category" TEXT, "caption" TEXT, "carousel_urls" TEXT, "story_url" TEXT, "primary_url" TEXT, "sources" TEXT, "status" TEXT, "created_at" TEXT, "published_at" TEXT, "execution_id" TEXT, "score" REAL)`,
  `CREATE TABLE "data_table_user_${T_CUR}" ("id" integer PRIMARY KEY NOT NULL, "createdAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "updatedAt" datetime(3) NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','NOW')), "curation_key" TEXT, "id_execucao" TEXT, "item_id" TEXT, "titulo_original" TEXT, "titulo_sugerido" TEXT, "url" TEXT, "url_normalizada" TEXT, "fonte" TEXT, "dominio_fonte" TEXT, "autor" TEXT, "data_publicacao" TEXT, "data_coleta" TEXT, "categoria_original" TEXT, "categoria_classificada" TEXT, "pontuacao_total" REAL, "relevancia" REAL, "engajamento" REAL, "atualidade" REAL, "confiabilidade" REAL, "originalidade" REAL, "utilidade" REAL, "prioridade" TEXT, "decisao_recomendada" TEXT, "decisao_final" TEXT, "formato_recomendado" TEXT, "urgencia" TEXT, "classificacao_conteudo" TEXT, "motivo" TEXT, "alertas" TEXT, "dados_ausentes" TEXT, "agentes_executados" TEXT, "status_aprovacao" TEXT, "aprovado_por" TEXT, "data_aprovacao" TEXT, "data_avaliacao" TEXT, "status_processamento" TEXT, "erro_processamento" TEXT, "dados_brutos" TEXT, "resposta_bruta_ia" TEXT, "resultados_dos_agentes" TEXT)`,
  `CREATE UNIQUE INDEX "idx_${T_CUR}_curation_key_unique" ON "data_table_user_${T_CUR}" ("curation_key") WHERE "curation_key" IS NOT NULL AND "curation_key" <> ''`,
];

const COLUNAS_PUB = ['content_key', 'topic', 'primary_url', 'category', 'operational_status',
  'carousel_container_id', 'instagram_post_id', 'instagram_story_id', 'execution_id', 'published_at', 'error_message'];
const COLUNAS_FILA = ['content_key', 'topic', 'category', 'caption', 'carousel_urls', 'story_url',
  'primary_url', 'sources', 'status', 'created_at', 'published_at', 'execution_id', 'score'];
const COLUNAS_CUR = ['curation_key', 'url', 'url_normalizada', 'dominio_fonte', 'pontuacao_total',
  'decisao_final', 'formato_recomendado', 'motivo', 'data_coleta', 'categoria_classificada'];

// Nós sintéticos: têm os MESMOS nomes de produção para que lib/versoes.cjs os encontre.
function nosProdutor() {
  return [
    { name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 2, parameters: { options: { systemMessage: 'PROMPT DE HOMOLOGACAO v1 — escreva o carrossel.' } } },
    // Curador e Verificador são `chainLlm`, que guarda o prompt em messages.messageValues —
    // formato DIFERENTE do `agent` acima. Copiado da produção de propósito: com os dois no seed,
    // o teste cobre os dois caminhos de leitura. Antes, o seed usava o formato do `agent` para
    // todos e o teste passava sem exercitar o `chainLlm` — foi assim que o bug chegou ao VPS.
    {
      name: 'Agente Curador PromoLiso AI',
      type: '@n8n/n8n-nodes-langchain.chainLlm',
      typeVersion: 1,
      parameters: {
        promptType: 'define',
        text: '=Avalie a notícia abaixo (homologacao)',
        messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: 'CURADOR HOMOLOG v1' }] },
      },
    },
    {
      name: 'Agente Verificador de Confiabilidade',
      type: '@n8n/n8n-nodes-langchain.chainLlm',
      typeVersion: 1,
      parameters: {
        promptType: 'define',
        text: '=Verifique a notícia recebida (homologacao)',
        messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: 'VERIFICADOR HOMOLOG v1' }] },
      },
    },
    // literal grande simulando a fonte em base64 embutida — exercita o hash de lógica
    { name: 'Code in JavaScript', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: `const FONTE='${'A'.repeat(1200)}';\n// builder de slide (homologacao)\nreturn [{json:{html:'<div/>'}}];` } },
    { name: 'Code in JavaScript1', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: `const MASCOTE='${'B'.repeat(1500)}';\n// builder de capa (homologacao)\nreturn [{json:{html:'<div/>'}}];` } },
    { name: 'Validar antes de publicar', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: '// validador (homologacao)\nreturn $input.all();' } },
    { name: 'Formatar legenda', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: '// legenda (homologacao)\nreturn $input.all();' } },
    { name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 0 8-22/2 * * *' }] } } },
  ];
}
function nosPublicador() {
  return [
    { name: 'Selecionar READY', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: '// selecao da fila (homologacao)\nreturn $input.all();' } },
    { name: 'Slots de publicação', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 30 12 * * *' }, { field: 'cronExpression', expression: '0 30 20 * * *' }] } } },
  ];
}

// runData no formato flatted que o n8n grava — é o que os coletores leem.
function runDataProdutor({ contentKey, urls, score, motivo }) {
  const item = (json) => ({ startTime: 0, executionTime: 1, data: { main: [[{ json }]] } });
  return flatted.stringify({
    resultData: {
      runData: {
        'Selecionar melhor pauta': [item({
          registro: { pontuacao_total: score, motivo, decisao_final: 'aprovar', formato_recomendado: 'carrossel', data_coleta: '2026-08-01T09:00:00.000Z' },
          noticia: { tipo_fonte: 'primaria' },
        })],
        'Validar antes de publicar': [item({ output: { tema: 'Tema de homologacao', categoria: 'NOTICIA', entidades: ['Xbox', 'Game Pass'] } })],
        'Fila: montar row': [item({ content_key: contentKey, carousel_urls: JSON.stringify(urls) })],
        'GPT 5.4 mini': [item({ ok: true })],
      },
    },
  });
}
function runDataPublicador({ contentKey, postId }) {
  const item = (json) => ({ startTime: 0, executionTime: 1, data: { main: [[{ json }]] } });
  return flatted.stringify({
    resultData: {
      runData: {
        'Selecionar READY': [item({ content_key: contentKey })],
        'Consultar status 1': [item({ status_code: 'FINISHED' })],
        'Publish a post': [item({ id: postId })],
        'Create a story': [item({ id: `${postId}-story` })],
      },
    },
  });
}

(async () => {
  if (fs.existsSync(SAIDA)) fs.rmSync(SAIDA);
  for (const sufixo of ['-wal', '-shm']) { const f = SAIDA + sufixo; if (fs.existsSync(f)) fs.rmSync(f); }
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, '');

  const w = await abrirEnvolvido(SAIDA, false);
  for (const sql of DDL) await w.run(sql);

  const t = agoraUtc();
  await w.run('INSERT INTO project (id,name,type,createdAt,updatedAt) VALUES (?,?,?,?,?)',
    [PROJETO, 'Homologacao', 'personal', t, t]);

  const wfs = [
    { id: WF_PRODUTOR, nome: 'PromoLiso - Conteúdo Instagram (homolog)', nos: nosProdutor() },
    { id: WF_PUBLICADOR, nome: 'PromoLiso - Publicador (fila) (homolog)', nos: nosPublicador() },
    { id: WF_WATCHDOG, nome: 'PromoLiso - Monitor de saude (homolog)', nos: [] },
    { id: WF_MONITOR, nome: 'PromoLiso - Monitor de erros (homolog)', nos: [] },
  ];
  for (const wf of wfs) {
    const v = `ver-${wf.id}`;
    const nodes = JSON.stringify(wf.nos);
    await w.run('INSERT INTO workflow_history (versionId,workflowId,authors,createdAt,updatedAt,nodes,connections,name,autosaved,description,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [v, wf.id, 'homolog', t, t, nodes, '{}', wf.nome, 0, 'seed', '[]']);
    await w.run('INSERT INTO workflow_entity (id,name,active,nodes,connections,settings,staticData,pinData,versionId,createdAt,updatedAt,activeVersionId,nodeGroups) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [wf.id, wf.nome, 1, nodes, '{}', '{}', null, null, v, t, t, v, '[]']);
  }

  // registra as 3 Data Tables que já existem em produção
  const registrar = async (id, nome, colunas) => {
    await w.run('INSERT INTO data_table (id,name,projectId,createdAt,updatedAt) VALUES (?,?,?,?,?)', [id, nome, PROJETO, t, t]);
    for (let i = 0; i < colunas.length; i++) {
      await w.run('INSERT INTO data_table_column (id,name,type,"index",dataTableId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',
        [`${id}-c${i}`, colunas[i], colunas[i] === 'score' || colunas[i] === 'pontuacao_total' ? 'number' : 'string', i, id, t, t]);
    }
  };
  await registrar(T_PUB, 'promoliso_publicacoes', COLUNAS_PUB);
  await registrar(T_FILA, 'promoliso_fila', COLUNAS_FILA);
  await registrar(T_CUR, 'promoliso_curadoria_ai', COLUNAS_CUR);

  // ---- dados sintéticos ------------------------------------------------------------------
  const DIA = 86400000;
  const agora = Date.now();
  let execId = 100;
  for (let i = 0; i < POSTS; i++) {
    const diasAtras = POSTS - i;                     // o mais antigo primeiro
    const quando = new Date(agora - diasAtras * DIA + (i % 3) * 3600000);
    const iso = quando.toISOString();
    const dominio = ['news.xbox.com', 'blog.playstation.com', 'adrenaline.com.br', 'gamevicio.com'][i % 4];
    const ck = `https://${dominio}/homolog/post-${i}`;
    const categoria = ['NOTICIA', 'HARDWARE', 'PROMOCAO'][i % 3];
    const urls = Array.from({ length: 6 }, (_, k) => `https://res.cloudinary.com/demo/p${i}-s${k}.jpg`);
    // um post de propósito com imagem repetida, para o relatório ter o que apontar
    if (i % 5 === 0) urls[4] = urls[3];
    const score = 70 + (i * 7) % 25;
    const publicado = i % 6 !== 5;                   // um em cada seis falhou
    const postId = publicado ? `1784${String(100000 + i)}` : '';

    const idProd = ++execId;
    await w.run('INSERT INTO execution_entity (id,workflowId,finished,mode,startedAt,stoppedAt,status,createdAt) VALUES (?,?,?,?,?,?,?,?)',
      [idProd, WF_PRODUTOR, 1, 'trigger', agoraUtc(new Date(quando.getTime() - 3600000)), agoraUtc(new Date(quando.getTime() - 3400000)), 'success', t]);
    await w.run('INSERT INTO execution_data (executionId,workflowData,data) VALUES (?,?,?)',
      [idProd, '{}', runDataProdutor({ contentKey: ck, urls, score, motivo: `homologacao pauta ${i}` })]);

    if (publicado) {
      const idPub = ++execId;
      await w.run('INSERT INTO execution_entity (id,workflowId,finished,mode,startedAt,stoppedAt,status,createdAt) VALUES (?,?,?,?,?,?,?,?)',
        [idPub, WF_PUBLICADOR, 1, 'trigger', agoraUtc(quando), agoraUtc(new Date(quando.getTime() + 120000)), 'success', t]);
      await w.run('INSERT INTO execution_data (executionId,workflowData,data) VALUES (?,?,?)',
        [idPub, '{}', runDataPublicador({ contentKey: ck, postId })]);
    }

    await w.run(`INSERT INTO "data_table_user_${T_PUB}" (createdAt,updatedAt,content_key,topic,primary_url,category,operational_status,carousel_container_id,instagram_post_id,instagram_story_id,execution_id,published_at,error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t, t, ck, `Pauta de homologacao ${i}`, ck, categoria,
        publicado ? 'PUBLISHED' : 'FAILED_CONTAINER', publicado ? `c${i}` : '', postId,
        publicado ? `${postId}-story` : '', String(idProd), publicado ? iso : '',
        publicado ? '' : 'contêiner não criado (dado sintético)']);

    await w.run(`INSERT INTO "data_table_user_${T_FILA}" (createdAt,updatedAt,content_key,topic,category,caption,carousel_urls,story_url,primary_url,sources,status,created_at,published_at,execution_id,score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t, t, ck, `Pauta de homologacao ${i}`, categoria, `legenda ${i}`, JSON.stringify(urls),
        `https://res.cloudinary.com/demo/story-${i}.jpg`, ck, JSON.stringify([{ url: ck }]),
        publicado ? 'PUBLISHED' : 'FAILED', new Date(quando.getTime() - 3600000).toISOString(),
        publicado ? iso : '', String(idProd), 0]);

    await w.run(`INSERT INTO "data_table_user_${T_CUR}" (createdAt,updatedAt,curation_key,url,url_normalizada,dominio_fonte,pontuacao_total,decisao_final,formato_recomendado,motivo,data_coleta,categoria_classificada) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t, t, ck, ck, ck, dominio, score, 'aprovar', 'carrossel', `homologacao pauta ${i}`,
        new Date(quando.getTime() - 7200000).toISOString(), categoria]);
  }

  await w.fechar();
  console.log(`banco de homologação criado: ${SAIDA}`);
  console.log(`  ${POSTS} pautas, ${POSTS - Math.floor(POSTS / 6)} publicadas, 3 Data Tables de produção, 4 workflows`);
  console.log('');
  console.log('Próximos passos (nenhuma credencial real necessária):');
  // PROMO_MARCO_ZERO finge que o módulo já rodava antes destes posts saírem; sem isso todas as
  // janelas dos dados sintéticos (que são retroativos) nasceriam como PRE_INSTALACAO.
  console.log(`  export PROMO_DB="${SAIDA}" PROMO_ANALYTICS_MOCK=1 PROMO_ALERTAS=0`);
  console.log(`  export PROMO_MARCO_ZERO="${new Date(Date.now() - 90 * DIA).toISOString()}"`);
  // tolerância alta pelo mesmo motivo: os dados são retroativos. Em produção o default (48 h) é
  // o correto — janela que passou disso não é mais coletável de verdade.
  console.log('  export PROMO_JANELA_TOLERANCIA_H=2400');
  console.log('  node analytics/migrate.cjs up');
  console.log('  node analytics/coletor-publicacoes.cjs');
  console.log('  node analytics/coletor-metricas.cjs');
  console.log('  node analytics/relatorio-semanal.cjs');
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
