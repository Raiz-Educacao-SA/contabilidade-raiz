-- Habilita finalizar/reabrir tarefas detalhadas por módulo e coligada.
-- Execute após controle_acesso.sql e cronograma_fechamento.sql.

begin;

drop policy if exists "cronograma confirmacao autenticada" on public.cronograma_entregas;
create policy "cronograma confirmacao autenticada"
on public.cronograma_entregas for insert
to authenticated
with check (
  confirmado_por = auth.uid()
  and public.usuario_tem_modulo(
    case
      when modulo = 'financeiro' or modulo like 'financeiro:%' then 'financeiro'
      when modulo = 'fiscal' or modulo like 'fiscal:%' then 'fiscal'
      when modulo = 'compras' or modulo like 'compras:%' then 'compras'
      when modulo = 'folha' or modulo like 'folha:%' then 'folha'
      when modulo = 'book' or modulo like 'book:%' then 'book'
      else 'contabil'
    end,
    auth.uid()
  )
);

drop policy if exists "cronograma atualizacao autenticada" on public.cronograma_entregas;
create policy "cronograma atualizacao autenticada"
on public.cronograma_entregas for update
to authenticated
using (true)
with check (
  confirmado_por = auth.uid()
  and public.usuario_tem_modulo(
    case
      when modulo = 'financeiro' or modulo like 'financeiro:%' then 'financeiro'
      when modulo = 'fiscal' or modulo like 'fiscal:%' then 'fiscal'
      when modulo = 'compras' or modulo like 'compras:%' then 'compras'
      when modulo = 'folha' or modulo like 'folha:%' then 'folha'
      when modulo = 'book' or modulo like 'book:%' then 'book'
      else 'contabil'
    end,
    auth.uid()
  )
);

drop policy if exists "historico cronograma registro por setor" on public.cronograma_historico;
create policy "historico cronograma registro por setor"
on public.cronograma_historico for insert
to authenticated
with check (
  usuario_id = auth.uid()
  and public.usuario_tem_modulo(
    case
      when modulo = 'financeiro' or modulo like 'financeiro:%' then 'financeiro'
      when modulo = 'fiscal' or modulo like 'fiscal:%' then 'fiscal'
      when modulo = 'compras' or modulo like 'compras:%' then 'compras'
      when modulo = 'folha' or modulo like 'folha:%' then 'folha'
      when modulo = 'book' or modulo like 'book:%' then 'book'
      else 'contabil'
    end,
    auth.uid()
  )
);

commit;
