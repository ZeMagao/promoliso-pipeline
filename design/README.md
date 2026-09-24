# `design/` — os patches e as provas

Esta pasta é o histórico de **como** o sistema mudou. São 50 patches e 41 harnesses. Cada patch é
um script que edita um nó do n8n por âncora exata, com `--dry` e `--reverter`; cada harness roda o
código real do nó e prova o efeito. O método está em [../docs/METODO.md](../docs/METODO.md).

**Comece por um destes três** se quiser ver o formato:

| arquivo | por que ler |
|---|---|
| `patch_pauta_calendario.cjs` | medição (1549 títulos) derrubando a explicação intuitiva, e uma regra que se desliga sozinha |
| `patch_ponte_imagem.cjs` | diagnóstico de um 400 que parecia nosso e era de terceiro, com 22 hosts testados dos dois lados |
| `test_promo_vigia.cjs` | harness cujas asserções são, uma a uma, incidentes que já aconteceram |

## Por tema

### Publicação e fila
| patch | harness | o que resolve |
|---|---|---|
| `patch_publish_retry` | ✅ | um HTTP 400 passageiro do Meta aposentava a pauta inteira |
| `patch_devolver_para_fila` | ✅ | peça que falhou volta à fila uma vez, em vez de morrer |
| `patch_portao_da_fila` | ✅ | encerra a rodada quando já há peça fresca esperando (40% menos desperdício) |
| `patch_publicar_o_fresco` | ✅ | publica a notícia de hoje, não a que está morrendo |
| `patch_ramo_b_por_nota` | ✅ | entre 12 e 48 h, quem decide é a nota |
| `patch_fila_frescor`, `patch_score_na_fila` | ✅ | frescor e nota chegam à fila |
| `patch_cdn_publicador` | ✅ | imagens servidas de host próprio, com log de quem as pediu |
| `patch_slot_2030`, `patch_publicador_errorhandling` | — | slots em conflito; row presa em `PUBLISHING` |

### Imagem e render
| patch | harness | o que resolve |
|---|---|---|
| `patch_ponte_imagem` | ✅ | hosts que respondem 403 ao buscador do Cloudinary (a capa parava a rodada) |
| `patch_fotos_do_jogo` | ✅ | fotos oficiais do jogo entram no acervo; logo de loja deixa de contar como foto |
| `patch_sem_repetir_imagem` | ✅ | slides cabem nas fotos distintas em vez de repetir a mesma |
| `patch_capa_fullbleed`, `patch_piso_capa_675` | ✅ | capa vira a própria imagem; piso de altura corrigido depois de medir o estoque |
| `patch_upgrade_imagem`, `patch_variedade_imagem` | ✅ | foto deixa de vir encolhida pelo CDN do site; destrava estoque |
| `patch_fallback_imagem`, `patch_fallback_multitransform`, `patch_retry_render_capa` | ✅ | falha de uma imagem deixa de derrubar a peça |
| `patch_imagem_pesa_na_escolha`, `patch_imagem_blogger` | ✅ | imagem pesa na escolha da pauta; imagem do Blogger para de sumir em silêncio |

### Curadoria e pauta
| patch | harness | o que resolve |
|---|---|---|
| `patch_pauta_calendario` | ✅ | Game Pass e PS Plus garantidos 4×/mês, com cota que se desliga |
| `patch_reserva_primaria`, `patch_equilibrio_e_frescor` | ✅ | fonte primária tem vaga no corte dos 24, sem sufocar a pauta brasileira |
| `patch_oferta_evento`, `patch_oferta_so_jogo`, `patch_preco_oferta` | ✅ | o que conta como oferta, e por que promoção de catálogo reprovava |
| `patch_feeds_novos`, `patch_feed_epic` | ✅ | fontes novas, escolhidas por % de itens com imagem |

### Agente e prompt
| patch | harness | o que resolve |
|---|---|---|
| `patch_agente_entrega`, `patch_agente_parser` | ✅ | o agente anunciava "vou escrever agora" e não entregava: faltava output parser ligado |
| `patch_parar_em_erro_de_busca` | ✅ | com a ferramenta de busca quebrada, o agente reformulava 17× por pauta e escrevia sem pesquisa |
| `patch_cta_contextual`, `patch_frases`, `patch_limites_unicos` | parcial | régua de texto dos slides, que vivia em três lugares |
| `patch_recovery_imagem_valida`, `patch_caps_validador`, `patch_mensagens_validador` | parcial | o gate determinístico e suas mensagens (mensagem ruim escondeu um bug por semanas) |

### Infraestrutura e monitoramento
| patch | harness | o que resolve |
|---|---|---|
| `patch_monitor` | — | monitor de erro duro |
| `patch_watchdog_ruido` | ✅ | o detector de cota casava `429` com coordenada de SVG em HTML raspado |
| `patch_render_hires` | — | escala e qualidade nos 5 nós de render |

### Carrossel de tamanho variável (e o rollback)
`patch_carousel_expr_passoA` provou, em produção, que o n8n **não** resolve expressão no nível da
coleção — o que derrubou o desenho original. `patch_rollback_carrossel` restaurou o estado bom, e
`patch_carrossel_variavel_produtor` / `_publicador` entregaram a faixa de 3 a 10 imagens pelo plano
B (um nó por tamanho), em duas etapas separadas para nunca subir as duas metades no mesmo slot.

## Também aqui

Mockups de capa (`capa_*.html`), protótipos de texto (`writer*.cjs`), amostras reais usadas pelos
harnesses (`*_amostra*.json`) e medições pontuais. É material de trabalho — o que virou produção
está em `../workflows/`.
