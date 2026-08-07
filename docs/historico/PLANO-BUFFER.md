# Buffer/fila de publicação — plano

Objetivo: publicar em TODO horário definido (12:30 / 16:30 / 20:00 BRT) sem
nunca postar notícia não confirmada. Desacopla PRODUÇÃO (gerar+validar+renderizar
quando há boa notícia) de PUBLICAÇÃO (postar nos horários, puxando da fila).

## Por que
Hoje é um fluxo monolítico: schedule → curadoria → editorial → validação →
render → publica, tudo na mesma execução. Se no instante do slot não há pauta
confirmável, termina em "Encerrar sem pauta segura" e o slot fica vazio. Um
buffer resolve: dias/horas com boa notícia abastecem a fila; os slots consomem.

## Modelo de dados — DataTable nova `promoliso_fila` (colunas)
- `content_key` (dedup; mesma chave do fluxo atual)
- `topic`, `category`
- `caption` (legenda final)
- `carousel_urls` (JSON: as 5 URLs Cloudinary já renderizadas do carrossel)
- `story_url` (Cloudinary do story)
- `primary_url`, `sources` (pra auditoria)
- `status`: READY | PUBLISHING | PUBLISHED | FAILED | EXPIRED
- `created_at`, `published_at`, `execution_id`
- `score` (pontuação da curadoria, pra publicar o melhor primeiro)

Imagens ficam no Cloudinary (URLs persistentes) — a fila guarda só URLs+texto,
leve e durável.

## Duas trilhas

### Produtor (abastece a fila)
Roda com frequência MAIOR que os slots (ex.: de hora em hora, ou nos próprios
slots + extras). Reusa a cadeia atual até o render+upload Cloudinary. No fim, em
vez de publicar, **grava na fila** (status READY) se:
- passou na validação determinística (já garante fonte/imagem/dúvida/estrutura);
- não é `content_key` duplicado de algo READY/PUBLISHED (dedup);
- respeita um teto de fila (ex.: máx 10 READY, descarta o mais velho/fraco).
Se não há pauta segura, simplesmente não grava — sem efeito no slot.

### Publicador (consome nos horários)
Trigger nos 3 slots. Passos:
1. Ler `promoliso_fila` onde status=READY, ordenar por score desc, created_at desc.
2. Se houver item: marcar PUBLISHING → publicar carrossel+story no Instagram
   (mesma máquina de container/polling de hoje, mas alimentada pela fila) →
   marcar PUBLISHED (published_at, instagram_post_id).
3. Se a fila estiver vazia: rodar o Produtor inline como último recurso; se
   ainda assim nada, aí sim registrar slot vazio (raro, e explicável).
4. Descartar itens READY velhos (> N horas) como EXPIRED (notícia perde validade).

## Acoplamento a resolver (medido no fluxo atual)
A publicação de hoje lê por referência de nó:
- `Create a carousel post`: `$('Obter URL primeira imagem').url`,
  `$('Aggregate').url[0..4]`, `$('Edit Fields').legenda`.
- `Create a story`: `$json.url` (cadeia do story).
- `Preparar publicação concluída`: `$('Preparar registro pendente')`,
  `$('Create a carousel post')`, `$('Publish a post')`.
Para o Publicador, esses IG-nodes precisam ler da fila (`$json.carousel_urls[n]`,
`$json.caption`) em vez das referências de render. Solução: **duplicar** os
IG-nodes numa trilha Publicador própria, lendo da fila — sem tocar na trilha
atual até a virada final. Menos risco que reaproveitar as referências.

## Fases (cada uma testável, sem quebrar o que funciona)
1. **Aditiva (risco zero):** criar a DataTable `promoliso_fila`. Fazer o fluxo
   atual, no ponto pós-render/upload e pós-validação-OK, ALÉM de publicar,
   GRAVAR o post na fila (status READY). Assim a fila começa a encher sem mudar
   o comportamento de publicação atual. Observar alguns ciclos.
2. **Publicador:** trilha nova (trigger nos slots) que lê a fila e publica
   (IG-nodes duplicados alimentados pela fila) + marca PUBLISHED + expira velhos.
   Testar publicando 1 item da fila de verdade.
3. **Virada:** o Produtor para de publicar direto e só abastece a fila; o
   Publicador passa a ser o único que posta. Ajustar frequência do Produtor.
4. **Bordas:** teto/expiração da fila, dedup entre READY e histórico, fila vazia,
   falha de publicação (volta pra READY ou marca FAILED), horário extra 16:30.

## Riscos
- Mexer na máquina de publicação (container + polling do carrossel) é o ponto
  frágil — por isso duplicar em vez de religar referências.
- n8n precisa estar de pé nos horários (produtor e publicador). Mesma dependência
  de hoje; melhora real vem com VPS + domínio fixo.
