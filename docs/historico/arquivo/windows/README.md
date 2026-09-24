# Era Windows — NÃO EXECUTE NADA AQUI

O pipeline roda no VPS desde **2026-08-05** (ver `OPERACAO-VPS.md`). Estes arquivos estão guardados
como registro, não como ferramenta.

## ⚠️ Por que estão fora da raiz

`Iniciar PromoLiso n8n.cmd` e `start-promoliso.ps1` sobem um n8n **com os mesmos workflows e a mesma
conta do Instagram** que o VPS já está rodando. Dois schedulers ativos = **post duplicado no
Instagram**. Na raiz do repo, um duplo-clique distraído bastava. Aqui, não.

Se algum dia for preciso reativar o Windows, **pare o VPS primeiro**:

```bash
ssh root@167.233.138.221 'systemctl stop promo-n8n promo-renderer'
```

## O que tem aqui

| arquivo | o que era |
|---|---|
| `*.cmd`, `start-promoliso.ps1`, `stop-promoliso.ps1` | launchers do n8n + túnel Cloudflare + renderizador na máquina Windows |
| `deploy-*.ps1` (11) | orquestradores de deploy one-shot, um por mudança (carrossel, monitor, frases, titan, render hi-res, rollback…) |

Os `deploy-*.ps1` foram **substituídos por `deploy-vps.sh`** na raiz, que faz o mesmo no Linux
(backup → dry-run → para o n8n → aplica → religa → valida). Os antigos têm caminhos Windows
hardcoded e backup de nome fixo, então não servem mais nem como molde.

O `start-promoliso.ps1` também chamava o renderizador de **outro projeto** — o repo não era
auto-contido nessa época. No VPS o renderizador é `promo-renderer.service`.
