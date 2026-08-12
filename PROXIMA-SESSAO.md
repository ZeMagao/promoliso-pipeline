# Próxima sessão — checklist

> **12/08/2026 — o trabalho corrente é a evolução editorial dos carrosséis (PRD + SDD).**
> A auditoria (Fase 1) está feita; o plano passo a passo, as armadilhas medidas e as decisões em
> aberto estão em **`docs/PLANO-CARROSSEL-EDITORIAL.md`**. Comece por lá, não por este arquivo —
> o conteúdo abaixo é da migração pro VPS, já concluída.

Migração pro VPS **concluída e validada** em 2026-08-05, e as 4 pendências de infra **fechadas**.
Operação: **`OPERACAO-VPS.md`**. Repo: https://github.com/ZeMagao/promoliso-n8n (privado).

**O próximo trabalho não é mais infra — é o gate do validador de slides** (seção "Gargalo real"
mais abaixo). A infra está estável: serviços no ar, HTTPS, alerta por e-mail funcionando, backup
externo com restauração testada, 2FA, reboot resiliente.

---

## AÇÕES SUAS

### ~~1. Porta do SMTP~~ ✅ FEITO 2026-08-05 11:50
A **Hetzner bloqueia saída nas portas 25 e 465**; só a **587** passa. A credencial `smtp` não tinha
porta → n8n usava o default 465 → todo alerta dava timeout calado. Corrigido na UI
(Port 587, SSL/TLS off) e **testado com envio real**. O aviso de falha do backup
(`promo-backup-falhou.service`) também foi testado ponta a ponta.

### ~~2. Backup externo no Cloudflare R2~~ ✅ FEITO 2026-08-05 12:23
Bucket `promoliso-backups`, prefixo `n8n/`, retenção 30 dias, upload no fim do backup diário.
Primeira cópia no ar: 163 MiB. **Restauração testada de verdade** (md5 igual, banco íntegro,
7 credenciais decifram com a encryptionKey de dentro do backup). Detalhes em `OPERACAO-VPS.md`.

### ~~3. Redirect URI no app do Meta~~ ✅ FEITO 2026-08-05
`https://n8n.promoliso.com.br/rest/oauth2-credential/callback` cadastrado. Confirmado que o
caminho responde HTTP 200 pelo domínio e que bate com o `N8N_EDITOR_BASE_URL` do unit.

> ⚠️ Sobrou pendente: **remover as duas entradas `*.trycloudflare.com`** da lista de OAuth
> Redirect URIs. Não é só limpeza — aqueles hostnames são sorteados e voltam pro pool da
> Cloudflare; enquanto forem redirect URI válido, quem receber o hostname pode capturar um code
> de OAuth da conta.

### ~~4. 2FA no owner do n8n~~ ✅ FEITO 2026-08-05
`<conta-owner-do-n8n>` com `mfaEnabled=1`, secret e códigos de recuperação gravados.
Se perder o autenticador **e** os códigos, destrava pelo VPS:
```bash
cd /opt/promoliso && sudo -u promo node node_modules/n8n/bin/n8n mfa:disable --email=<conta-owner-do-n8n>
```

---

## O QUE FOI VALIDADO NO VPS

Execuções **179 (08:00)** e **180 (10:00)** de 05/08 rodaram `success`/`trigger` — o pipeline
inteiro no VPS: 9 feeds RSS → curador (OpenAI) → verificador → DataTable → redator (Anthropic) →
validador. Zero erro de ambiente. Também provado: 7/7 credenciais decifram, sharp Linux q95 4:4:4,
Chrome renderiza (988 ms), token IG responde `promoliso0`/BUSINESS do IP do VPS, reboot recupera
tudo, HTTPS 200 no domínio.

**Ainda não exercitado em produção:** render → Cloudinary → fila → publish. Porque o validador
reprovou as duas pautas antes de chegar lá (ver abaixo). Renderizador e sharp foram testados
isolados e funcionam.

---

## ✅ DEPLOYADO 2026-08-05 14:54 BRT — mensagens do validador

`versionId = 24acccfa-fe68-43a1-9697-b882f5a53d26`. Harness rodou **6/6 veredito idêntico**
(inclusive contra os slides reais das execs 179/180, que agora **passam**), dry-run OK, os 4
workflows reativaram, zero erro no journal. Caps preservados em 42/38.

> O harness `design/test_validador_mensagens.cjs` **não estava no VPS** (só o patch tinha sido
> copiado). Foi copiado nesta sessão com `ssh host 'cat > arquivo' < local`.

Registro do que estava escrito antes do deploy:

**O quê:** as mensagens de reprovação do validador são genéricas demais. `'Estrutura dos cinco
slides inválida'` cobre 5 falhas diferentes (contagem, ordem, título vazio, destaque vazio,
tamanho) e não diz qual slide nem qual campo — foi isso que escondeu o bug dos caps por semanas.
E `if (!imagemCapa || imagensValidas.length !== 6)` dispara a mensagem de **HTTPS** mesmo quando o
problema é **contagem**, ou seja, mente sobre a causa. Essas mensagens vão pro e-mail do Monitor de
erros e do watchdog — mensagem boa = alerta útil.

**Arquivos (já no repo e já copiados pro VPS):**
- `design/patch_mensagens_validador.cjs` — o patch
- `design/test_validador_mensagens.cjs` — harness offline que compara lógica antiga × nova

**Não muda o que passa ou reprova.** Provado pelo harness contra os slides REAIS das execs 179/180
+ 4 casos sintéticos: veredito idêntico em 6/6. Exemplo do ganho:

```
antes:  Estrutura dos cinco slides inválida
depois: Estrutura dos cinco slides inválida -> slide 3 (evidencia): destaque vazio
depois: Estrutura dos cinco slides inválida -> esperava 5 slides e vieram 4
depois: Esperava 6 imagens válidas (capa + 5 slides) e passaram 5
```

**Como rodar (no VPS):**

```bash
ssh root@<IP-DO-VPS>
cd /opt/promoliso

# 1. harness (só leitura) — tem que terminar com "VEREDITO IDENTICO EM TODOS OS CASOS"
sudo -u promo node design/test_validador_mensagens.cjs

# 2. dry-run — tem que dar "OK mudança A" e "OK mudança B"
sudo -u promo node design/patch_mensagens_validador.cjs --dry

# 3. deploy (backup + para n8n + aplica + religa + valida)
AUTO=1 bash deploy-vps.sh design/patch_mensagens_validador.cjs
```

O patch aborta sozinho se: draft ≠ published, nodes divergindo do `workflow_history`, âncora não
encontrada ou encontrada mais de uma vez (ex.: já aplicado), caps não estiverem em 42/38, ou se o
código resultante não compilar.

**Fica de fora de propósito** (muda comportamento, decidir à parte): aceitar os tipos de slide
**fora de ordem**. Hoje L573 exige a sequência exata `capa, contexto, evidencia, impacto, acao`;
se o agente inverter dois, reprova. O patch do carrossel variável já tinha trocado isso por
`tipos.includes(tipo)` + exigir `slides[0]==='capa'`, e o rollback reverteu junto — mesma história
dos caps. Vale decidir se volta.

---

## 🎯 CAUSA RAIZ ENCONTRADA (2026-08-05 12:40) — bug de 2 linhas

O nó **`Validar antes de publicar`** (produtor `NL8eVLKErgnIXBQq`) **se contradiz**:

| linha do `jsCode` | o que faz |
|---|---|
| L429-431 | `limitar(slide.titulo, 42)` · `limitar(slide.destaque, 38)` · `limitar(slide.texto, 300)` |
| L576-581 | valida `slide.titulo.length <= 34` · `slide.destaque.length <= 30` · `texto <= 300` |

Trunca em **42/38** e reprova acima de **34/30**. Título de 35-42 chars ou destaque de 31-38 chars
= `Estrutura dos cinco slides inválida`, sempre. São 10 campos por pauta (5 títulos + 5 destaques),
então quase toda pauta estoura pelo menos um. **É a explicação do "quase nunca publica".**

Medido nas execuções reais (o agente entregou 5 slides na ordem certa `capa, contexto, evidencia,
impacto, acao` nas duas — não é problema do agente):

```
exec 179  titulos 40, 33, 39, 39, 32    destaques 25, 31, 38, 38, 36
exec 180  titulos 38, 42, 32, 34, 34    destaques 31, 32, 30, 37, 33
```

**Origem:** o rollback do carrossel variável (05/08) reverteu duas coisas de uma vez — a contagem
de slides (certo) **e** o fix dos caps (que era independente e correto). O prompt do agente e o
`limitar()` usam 42/38; só a checagem ficou no valor velho.

**Correção:** L576 `34` → `42` e L579 `30` → `38`. Deploy pelo padrão do projeto
(`patch_*.cjs` + novo `versionId` + `workflow_history` + `activeVersionId` — ver
[[deploy-draft-vs-published]]); no VPS o restart é `systemctl restart promo-n8n`, não os `.ps1`.

**Cuidado ao validar o fix:** a exec 181 reprovou por motivos diferentes e legítimos (categoria
inválida, sem fonte primária, nenhuma imagem válida). Corrigir os caps não faz toda pauta passar —
só para de reprovar as boas. Confirmar com uma pauta que só tenha o erro de estrutura.
Pendente também: `imagens_baixa_resolucao` (thumb 768x480 do adrenaline) barrou a exec 180 junto.

## ⏳ O FIX DOS CAPS AINDA NÃO FOI EXERCITADO (medido 2026-08-05 14:50)

**Nenhuma execução do produtor rodou com os caps 42/38 ainda.** O fix subiu às **14:30 BRT** e a
última rodada do produtor foi a **exec 184, às 14:00–14:03 BRT** — 27 min antes. A primeira
rodada de verdade sob o fix é a das **16:00 BRT**.

A exec 184 reprovou com **só um erro**, e ele desaparece com o fix:

```
erros: ["Estrutura dos cinco slides inválida"]
categoria NOTICIA · fontes_primarias 1 · imagens_validas 6 · imagens_baixa_resolucao []
run 0  titulos 42,40,32,41,30   destaques 30,32,32,36,33   textos 214,243,255,218,238
run 1  titulos 36,36,38,38,42   destaques 31,31,35,36,26   textos 179,237,247,282,232
```

Tudo ≤42/≤38/≤300 — reprovou porque a checagem no ar naquele momento ainda era 34/30. Rodando o
predicado real contra esses dados: `slidesValidos = true` nos dois runs. Ou seja: **assinatura
exata do bug dos caps, e o fix cobre**. Fila continua **0 READY** (5 FAILED + 6 PUBLISHED) porque
184 foi a última tentativa.

### ⚠️ Armadilha que quase inverteu o diagnóstico: dois fusos no mesmo banco

| coluna | fuso |
|---|---|
| `execution_entity.startedAt/stoppedAt`, `data_table_*.published_at` (n8n escreve) | **UTC** |
| `workflow_entity.updatedAt`, `workflow_history.createdAt` (nossos `patch_*.cjs`) | **local (BRT)** |

Os `patch_*.cjs` têm um `now()` que monta a string com `getHours()` — hora local. O n8n grava UTC.
Então `updatedAt = 14:30:19` é **11:30 se você assumir UTC** e conclui (errado) que o fix já estava
no ar na exec 184. Confira sempre contra o `journalctl` (que é local) e contra o horário do cron.
Conversões úteis: produtor 08–22h BRT = 11–01h UTC; `datetime(col,'localtime')` só está certo pras
colunas que o n8n escreveu.

## GARGALO REAL — sintomas observados

As execuções 179 e 180 morreram no gate `Pauta validada? → falso`:

| exec | motivo |
|---|---|
| 179 | `Estrutura dos cinco slides inválida` (fontes ok: 1 primária blog.playstation.com; **imagens_validas: 6**) |
| 180 | idem + `Uma ou mais imagens são miniaturas de baixa resolução` (thumb 768x480 do adrenaline.com.br) |

`imagens_validas: 6` prova que a busca/checagem de imagem **funciona do VPS** — não é rede nem
migração. É o validador exigindo **exatamente 5 slides** (o carrossel variável foi revertido) e o
agente entregando outra quantidade. Este é o "quase nunca publica" já conhecido —
ver memória `diagnostico-imagens-primarias` e `PLANO-MELHORIAS.md`.

Consequência prática: fila com **0 READY**, então o slot das 12:30 não publica e o watchdog das
13:00 deve alertar "sem publicação há ~26h" (correto — mas só chega depois de consertar o SMTP).

**Próximo trabalho de verdade:** atacar esse gate. Duas frentes candidatas:
(a) afrouxar/corrigir a checagem de estrutura de slides no "Validar antes de publicar";
(b) melhorar a seleção de imagem (rejeitar thumb antes, preferir a maior variante).

---

## Estado do pipeline

- Produtor + Publicador + Monitor de erros + Watchdog: **ativos no VPS**.
- Retenção de execuções: **7 dias / 150**. Banco em ~824 MB, estável ~800 MB (~8 MB por execução).
- Windows: tudo parado e autostart desativado (`PromoLiso n8n.lnk.DESATIVADO-MIGRADO-VPS`).
  **Não religar sem parar o VPS** — dois schedulers na mesma conta = post duplicado.
- Fila: 6 PUBLISHED + 5 FAILED, **0 READY**.
