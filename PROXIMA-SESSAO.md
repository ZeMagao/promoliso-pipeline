# Próxima sessão — checklist

As duas frentes anteriores (**GitHub** e **migração pro VPS**) foram concluídas em 2026-08-05.
Operação do VPS: **`OPERACAO-VPS.md`**. Repo: https://github.com/ZeMagao/promoliso-n8n (privado).

---

## VALIDAÇÃO PENDENTE (fazer primeiro)

A migração foi validada em tudo que dá pra provar fora de uma execução real:
7/7 credenciais descriptografam, sharp Linux gera JPEG q95 4:4:4, renderizador Chrome
renderiza (988 ms), token do Instagram responde `promoliso0`/BUSINESS a partir do IP do VPS,
banco com `integrity_check` ok, 4 workflows ativos, reboot do VPS recupera tudo sozinho.

**Falta a execução ponta-a-ponta real:**

1. Conferir a execução automática do produtor das **08:00 BRT** (primeira natural após o cutover):
   ```bash
   ssh root@<IP-DO-VPS> 'sqlite3 -header -column /opt/promoliso/data/.n8n/database.sqlite \
     "SELECT id,workflowId,status,mode,datetime(startedAt,\"localtime\") FROM execution_entity ORDER BY id DESC LIMIT 5;"'
   ```
   Esperado: `NL8eVLKErgnIXBQq` / `success` / `trigger`, e um item **READY** na fila.
2. Conferir a publicação do slot das **12:30 BRT** → post no @promoliso0.
3. Se quiser antecipar: abrir https://n8n.promoliso.com.br, logar e dar **Execute workflow**
   no produtor. (`n8n execute` pelo CLI **não** funciona — ver gotchas em `OPERACAO-VPS.md`.)

> Ruído conhecido: as execuções **177 e 178** estão como `error`/`mode=cli` — foram minhas
> tentativas de teste via CLI que bateram na limitação do módulo `data-table`. Cada uma
> disparou o Monitor de erros, então devem ter saído **2 e-mails de alerta** pra
> `<email-de-alerta>` por volta de 00:10 e 00:17. Não é falha do pipeline.

---

## PENDÊNCIAS REAIS

1. **Backup externo** — hoje o backup diário (03:30 BRT) grava só em `/opt/promoliso/backups`
   no próprio VPS. VPS morto = tudo perdido, inclusive a encryptionKey. Escolher destino
   (rclone → object storage barato, ou `scp` pra outra máquina) e plugar no
   `/usr/local/bin/promo-backup.sh`.
2. **Redirect URI no app do Meta** — cadastrar **uma vez**:
   `https://n8n.promoliso.com.br/rest/oauth2-credential/callback`.
   Publicar não depende disso (usa `~/ig-token.json`), só reconectar a conta por OAuth.
   Agora que o domínio é fixo, nunca mais muda.
3. **2FA no owner do n8n** — Settings → conta. A UI está exposta na internet.
4. **Banco em 917 MB** de histórico de execuções. O prune está ligado (336 h / 500 execuções);
   depois que ele rodar, vale um `VACUUM` pra devolver o espaço.
5. **`writer.cjs`** (em `design/`) tem path Windows hardcoded — ajustar pra Linux se for
   rodar deploy de design no VPS. Os `patch_*.cjs` já usam path relativo.
6. **Token do Instagram** vence em ~2026-09-27 (53 dias em 05/08). Tem auto-refresh, mas vale
   confirmar que o refresh roda no VPS antes de contar com ele.
7. **Carrossel variável** — segue revertido (5 slides fixos). Ver memória do projeto.

---

## Estado do pipeline

- Produtor + Publicador + Monitor de erros + Watchdog: **ativos no VPS**.
- Windows: n8n e túnel parados, renderizador parado, autostart desativado
  (`PromoLiso n8n.lnk.DESATIVADO-MIGRADO-VPS` na pasta Startup). Não religar sem antes
  parar o VPS — dois schedulers na mesma conta = post duplicado.
- Fila: 6 PUBLISHED + 5 FAILED, **nenhum READY** — o próximo produtor é que vai reabastecer.
