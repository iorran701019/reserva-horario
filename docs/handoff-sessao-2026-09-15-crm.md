# Handoff — Sessão 63 (15/09/2026) — CRM Comercial, fase 1

## Contexto
Primeira fase do CRM comercial do Acolhe, dentro do `/painel-global`, pra acompanhar leads (manicures/podólogas) do primeiro contato até a conversão. A demonstração vira agendamento real no tenant `acolhe-comercial` (staging), que já aparece no Painel sem mudança de código.

## Decisões de negócio (vindas do prompt, não revistas)
1. Demonstração grava `telefone: null` no agendamento: a RLS de `agendamentos` é mais aberta que a do CRM. O card fica âmbar/"não vinculado" no Painel, e isso é aceito.
2. Tirar um lead de `demonstracao` sem converter **não** cancela o agendamento. O cancelamento é manual, no Painel.
3. Reabrir um lead perdido mantém `motivo_perda`/`observacao_perda` como histórico.
4. Login do Iorran continua só `papel = 'global'`, sem segundo vínculo em `perfis`.

## Decisões de implementação tomadas nesta sessão (conferir)
- **Trecho do card:** descrição da interação mais recente; se não tiver, cai em `leads.observacoes`.
- **Nova interação empurra `ultimo_contato_em`** quando a data da interação é mais nova que o valor atual.
- **Mudar pra `convertido`** grava `data_conversao = hoje`, só se ainda estiver vazia.
- **Follow-up** lista todos os leads fora de Perdidos, inclusive Convertidos, desde que tenham `proximo_contato_em`.
- **Status inicial no cadastro rápido** não oferece `demonstracao`, porque ela exige o agendamento. O lead é criado e depois movido no quadro.
- **`atualizado_em`** é gravado pelo app em todo update, porque não se sabe se existe trigger no banco.
- **`tags.cor`** guarda a mesma chave de paleta das etiquetas de cliente (`CORES_ETIQUETA`: violeta, azul…), não hex.

## Mudanças de código (branch feat/crm-comercial, não commitado)
- `lib/crm.js`: listas espelhando os check constraints (status, origem, motivo_perda, canal), `hojeISO`, `SLUG_TENANT_COMERCIAL` e `criarDemonstracao`. Sequência de `criarDemonstracao`: resolve estabelecimento/profissional pelo slug → insert em `agendamentos` com status `pendente` → 23P01 vira "Esse horário já está ocupado. Escolha outro." → update do lead com o uuid (se falhar, apaga o agendamento) → promove o agendamento a `confirmado` (se falhar, apaga o agendamento e reverte o lead). Toda falha de delete/reversão é avisada na mensagem, com o id do agendamento.
- `app/painel-global/crm/page.js`: guarda `global`, abas Quadro / Perdidos (com contagem) / Follow-up, carga das 4 tabelas e o `mudarStatus` único usado pelo arraste, pelo select do card e pelo detalhe.
- `app/painel-global/crm/CardLead.js`: card arrastável (drag and drop nativo) com `<select>` de status como alternativa pro toque no celular.
- `app/painel-global/crm/ModalNovoLead.js`, `DetalheLead.js`, `ModalDemonstracao.js`, `ModalPerda.js`, `SeletorTags.js`, `ui.js`.
- `app/painel-global/page.js`: link "CRM" no header.

## Mudanças de banco
Nenhuma nesta sessão. O schema do CRM já estava aplicado em staging antes (4 tabelas + RLS `papel = 'global'`).

## Conferência SQL staging → produção
- `leads`, `tags`, `lead_tags`, `interacoes` (+ RLS): **só em staging**. O tenant `acolhe-comercial` e o profissional também existem só em staging. Nada disso foi replicado pra produção. Enquanto não houver réplica, o CRM não pode ir pra `main`/produção.

## Validações feitas
- `eslint` limpo nos arquivos novos; `next build` ok, com `/painel-global/crm` gerada como rota estática.

## Não verificado
- Nenhuma tela testada no browser: o preview não tem login e o dev server não subiu (porta 3000 já ocupada).
- Não confirmado ao vivo: gatilho de demonstração (insert, 23P01, rollback), arraste entre colunas, select de status no celular, criação de tag, autocomplete de indicação.
- **Rollback da demonstração (ajuste pós-revisão):** a policy `agendamentos_admin_delete` só apaga com `status <> 'confirmado'`. Por isso o agendamento nasce `pendente`, é promovido a `confirmado` só depois do update do lead, e se essa promoção falhar o fluxo apaga o agendamento e devolve o lead ao status/vínculo anteriores. Nenhum dos caminhos de falha foi exercitado ao vivo.
- Efeito colateral do insert `pendente`: o webhook `/api/notificacoes` manda push "Pendente: {nome}" pra quem tiver notificação ativa no tenant `acolhe-comercial`. Nenhum trigger do banco reage a INSERT, e o `/admin` não tem realtime, então o card não pisca em Pendentes pra quem está com a tela aberta.

## Estado final
Branch `feat/crm-comercial` com diff não commitado, aguardando revisão.
