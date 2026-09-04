-- Cria o histórico de conclusões e reaberturas do Cronograma.
-- Migração idempotente para ambientes que já possuem cronograma_entregas.

begin;

create table if not exists public.cronograma_historico (
  id uuid primary key default gen_random_uuid(),
  competencia text not null check (competencia ~ '^\d{4}-\d{2}$'),
  modulo text not null,
  setor text not null,
  acao text not null check (acao in ('liberado', 'reaberto')),
  usuario_id uuid references auth.users(id) on delete set null,
  usuario_email text not null,
  criado_em timestamptz not null default now()
);

alter table public.cronograma_historico enable row level security;

drop policy if exists "historico cronograma leitura autenticada"
  on public.cronograma_historico;
create policy "historico cronograma leitura autenticada"
on public.cronograma_historico for select
to authenticated
using (true);

drop policy if exists "historico cronograma registro por setor"
  on public.cronograma_historico;
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

grant select, insert on table public.cronograma_historico to authenticated;

create index if not exists cronograma_historico_competencia_data_idx
  on public.cronograma_historico (competencia, criado_em desc);

-- Recupera as conclusões atuais que ocorreram antes da criação do histórico.
-- O NOT EXISTS mantém esta carga segura caso a migração seja reaplicada.
insert into public.cronograma_historico (
  competencia,
  modulo,
  setor,
  acao,
  usuario_id,
  usuario_email,
  criado_em
)
select
  entrega.competencia,
  entrega.modulo,
  entrega.setor,
  'liberado',
  entrega.confirmado_por,
  entrega.confirmado_email,
  coalesce(entrega.confirmado_em, entrega.criado_em)
from public.cronograma_entregas entrega
where entrega.status = 'concluido'
  and entrega.confirmado_email is not null
  and not exists (
    select 1
    from public.cronograma_historico historico
    where historico.competencia = entrega.competencia
      and historico.modulo = entrega.modulo
      and historico.acao = 'liberado'
      and historico.criado_em = coalesce(entrega.confirmado_em, entrega.criado_em)
  );

commit;
