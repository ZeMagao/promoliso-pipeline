# Nó do Instagram — cópia do que roda em produção

`n8n-nodes-instagram-integrations` **1.6.0** (licença MIT, conforme o `package.json` do pacote),
instalado no VPS em `/opt/promoliso/data/.n8n/nodes/node_modules/n8n-nodes-instagram-integrations/`.

| arquivo | estado | sha256 em 02/10/2026 |
|---|---|---|
| `Instagram.node.js` | idêntico ao 1.6.0 do npm, **antes** do retry por filho | `13efc8ad80149f13debc99ab2387b434b579f139016adfb44597c55fb8add8f2` |
| `GenericFunctions.js` | 1.6.0 **com o patch do token** (`~/ig-token.json`, renovação), antes da mensagem do Meta | `0921cb881b76983cfac44ff37e2006977a71397f6ff8d0acc3c58ba1068f5c24` |

Existem aqui por dois motivos:

1. **O código do nó vivia só no disco do VPS.** Reinstalar o pacote apaga os patches em silêncio
   (o do token já foi escrito direto no `dist`, sem script). Com a cópia, dá para reconstruir.
2. **O harness `design/test_dist_instagram.cjs` roda o nó de verdade, offline**, a partir destes
   arquivos — aplica `design/patch_dist_instagram.cjs` e confere o que muda e o que não muda.

São o "antes". O "depois" é sempre o patch aplicado sobre eles; não edite estes arquivos à mão.
