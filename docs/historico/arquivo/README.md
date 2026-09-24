# _arquivo — histórico (NÃO rodar)

Arquivos aposentados na organização de 2026-07-30. Guardados por referência; **não são usados
pelo fluxo em produção**.

- `*.cmd.bak` — versões antigas dos atalhos de inicialização (substituídos pelos `.cmd` da raiz).
- `Executar n8n.cmd` — duplicata de `Iniciar PromoLiso n8n.cmd` (mesma função).
- `link-aprovacao.cjs` — gerava link de aprovação manual; sem uso desde o fluxo autônomo
  (os gates de aprovação viraram nós Set na semana1g).
- `logs/` — snapshots antigos de log (`n8n.current.*`). Os logs vivos ficam na raiz
  (`n8n.stdout.log` / `n8n.stderr.log`).
- `deploys/` — scripts PowerShell one-shot usados pra aplicar cada mudança no workflow ao vivo
  (redesign, virada, capa fix, etc.). Já rodaram. Referenciam arquivos do scratchpad (efêmero),
  então **não re-executam como estão** — a lógica reproduzível está em `../design/`.

## Como aplicar mudanças no workflow (referência)
O método usado: parar só o n8n → backup do DB → rodar um writer `.cjs` (patch no
`workflow_entity` + novo `versionId` + `activeVersionId` + INSERT em `workflow_history`) →
religar reusando o túnel. Fontes dos writers e templates em `../design/`.
