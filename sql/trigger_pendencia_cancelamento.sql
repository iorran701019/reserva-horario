-- Trigger que cria a pendência de "cancelamento pelo cliente" na aba
-- Pendentes do /admin. Roda de forma síncrona, dentro da mesma transação
-- do UPDATE que cancela o agendamento -- por isso é a fonte confiável
-- (ao contrário do antigo insert redundante em app/api/notificacoes/route.js,
-- removido em 27/08/2026 por gerar pendência duplicada quando o webhook
-- conseguia responder a tempo).
--
-- Guard: só dispara se o cancelamento for do cliente (cancelado_por_cliente
-- = true) e o status estava diferente de 'cancelado' antes -- o que também
-- blinda contra duplicação se o agendamento já estivesse cancelado por
-- outro caminho.
--
-- SECURITY DEFINER é necessário: sem isso, a função roda como o papel que
-- disparou o UPDATE (anon, no fluxo público de cancelamento), que não tem
-- permissão de INSERT em pendencias_admin (ver o bug 42501 corrigido no
-- pacote Pix de 26/08/2026).

CREATE OR REPLACE FUNCTION public.criar_pendencia_cancelamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.status = 'cancelado' AND NEW.cancelado_por_cliente = true AND OLD.status IS DISTINCT FROM 'cancelado' THEN
    INSERT INTO pendencias_admin (estabelecimento_id, tipo, agendamento_id, titulo, descricao)
    VALUES (
      NEW.estabelecimento_id, 'cancelamento_cliente', NEW.id, 'Cancelado pelo cliente',
      NEW.nome_cliente || ' cancelou o agendamento de ' || to_char(NEW.data, 'DD/MM') || ' às ' || to_char(NEW.horario, 'HH24:MI')
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_criar_pendencia_cancelamento
AFTER UPDATE ON public.agendamentos
FOR EACH ROW EXECUTE FUNCTION criar_pendencia_cancelamento();
