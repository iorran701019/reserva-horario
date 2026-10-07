## Catálogo e avisos do serviço (acrescentado na Sessão 82)

- [ ] Manutenções: conferir a pergunta de pés e o aviso dos 30 dias (`{valor_manutencao_30}` no serviço-base; a manutenção vinculada precisa de `servico_origem_id`, `prazo_inicio_dias` e preço, e não pode estar oculta).
- [ ] Categoria com serviço de pés e serviço só de mãos: aviso "Só mãos: este serviço não inclui os pés. Para incluir, escolha um serviço com pedicure." nos de mãos (não nos que já incluem pedicure nem nas manutenções).
- [ ] Alertas com mais de um popup: separar por linha `---` e dar título na primeira linha de cada pedaço; testar em aba anônima.
- [ ] Serviço sem categoria só se for intencional (aparece por último no público).
- [ ] Conferir se nenhum texto padrão aparece com termo de outro segmento: etapa anterior ("Teste") e reativação ("barbearia") até a varredura neutralizar; preencher `msg_reativacao` e `nome_etapa_anterior` quando houver.
- [ ] Qualquer ajuste feito só por SQL para este tenant entra no `INVENTARIO_RECURSOS.md` com o destino definitivo (dona ou painel global).
- [ ] Etiquetas padrão por nome ("Cliente Fixo", "Lista de Bloqueio", "Cliente Nova") — conferir grafia exata até as etiquetas passarem a ter papel por id.