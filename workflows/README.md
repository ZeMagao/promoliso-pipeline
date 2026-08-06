# Snapshot do código que roda no n8n

**Isto é uma cópia para leitura, review e diff. Não é a fonte de verdade.** O que executa em
produção é o blob JSON em `workflow_entity.nodes` no banco do n8n (`data/.n8n/database.sqlite`).
Editar arquivo aqui **não muda nada** — para mudar produção, escreva um `design/patch_*.cjs` e
deploye com `deploy-vps.sh` (ver `OPERACAO-VPS.md`).

## Por que existe

Os dois bugs de 2026-08-05/06 foram da mesma classe: **uma regra escrita em dois lugares que
precisavam concordar, divergindo sem ninguém ver.**

| bug | regra duplicada | como divergiu |
|---|---|---|
| caps do validador | `42/38/300` em `limitar()`, no check e no prompt do agente | um rollback reverteu só uma cópia — reprovou quase toda pauta por semanas |
| fallback de imagem | construção da URL do Cloudinary no builder do slide e no nó de fallback | transformações diferentes; o fallback nunca funcionou e matava a execução |

Enquanto o código vivia só dentro do banco não havia diff, histórico nem review — nada que
mostrasse esse drift. Com o snapshot versionado, ele aparece como diff.

## Como regenerar

```bash
ssh root@<IP-DO-VPS>
cd /opt/promoliso && sudo -u promo node export-workflows.cjs      # escreve em workflows/
# trazer pra máquina local:
ssh root@<IP-DO-VPS> 'cd /opt/promoliso && tar -cz workflows' > /tmp/wf.tgz
cd <repo> && rm -rf workflows && tar -xzf /tmp/wf.tgz
```

Rodar duas vezes sem deploy no meio **não** produz diff: não há timestamp de geração e tudo é
ordenado por nome. O que muda o `_manifest.json` é deploy de verdade (`activeVersionId`).

Vale regenerar **depois de cada deploy** — aí o diff mostra exatamente o que entrou em produção.

## O que tem em cada pasta

| arquivo | conteúdo |
|---|---|
| `<no>.js` | `parameters.jsCode` do Code node, **byte a byte igual ao banco** |
| `<no>.prompt.md` | `parameters.options.systemMessage` dos agentes de IA |
| `_manifest.json` | nós (nome/tipo/typeVersion), `onError`, cron, conexões, `activeVersionId` |

`parameters` cru **não** é exportado de propósito: ali moram headers, referências de credencial,
caminhos e o e-mail de alerta. Dump cego de parâmetros é como segredo vaza pro git.

## Dois avisos ao ler

- **`code-in-javascript.js` e `code-in-javascript1.js` têm ~387 KB cada** — são os builders de slide
  e de capa, com a fonte e o mascote embutidos em base64 na primeira linha. O código legível começa
  depois disso.
- **`onError` no manifest importa.** Nó com `onError` diferente de `stopWorkflow` **engole erro** —
  é a origem das falhas silenciosas do projeto. O produtor tem dezenas assim.
