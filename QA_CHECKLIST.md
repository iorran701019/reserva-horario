# QA Checklist — pós-merge

Rodar antes de mergear pra main (staging) e de novo depois do deploy (produção).
Passo 0 é obrigatório sempre; o resto, completo em merges que tocam schema/vários
arquivos, ou só a área tocada em mudanças pontuais.

## 0. Schema
```sql
select column_name, data_type from information_schema.columns
where table_name = '<tabela>';
```
-- confirma que toda coluna nova da sessão existe no ambiente antes de testar a tela.

## /admin
- [ ] Pendentes/Confirmados/Cancelados — criar, confirmar, cancelar 1 agendamento de teste
- [ ] Painel: abas Dia, Lista e Mês abrem sem erro; clique no evento abre modal
- [ ] Clientes — busca, detalhe, histórico, anamnese (se aplicável), anotação livre
- [ ] Serviços — abre sem erro de coluna; criar/reordenar/apagar categoria
- [ ] Profissionais — horários e exceções (se mais de 1 profissional ativo)
- [ ] Regras de negócio — sinal/Pix, manutenção, fidelidade, Mensagens de WhatsApp
- [ ] Login — logout + login de novo

## /agendar
- [ ] Identificação por WhatsApp (número novo e já cadastrado)
- [ ] Cadastro completo ou simplificado, conforme o tenant
- [ ] Wizard serviço → data/hora → confirmação, sinal via Pix
- [ ] Painel do cliente — cancelar, confirmar pagamento, novo agendamento, histórico

## Lição fixa do projeto
Toda coluna nova em `estabelecimentos` precisa entrar em DOIS selects, não um:
lib/estabelecimento.js (buscarEstabelecimento, usado por /agendar e por contas 'global')
E lib/perfil.js (buscarPerfil, usado por contas 'dono' no /admin). Esquecer o segundo
foi a causa raiz de um bug real (fidelidade não aparecia pra conta dono).
