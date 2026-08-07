create table if not exists public.cronograma_entregas (
  id uuid primary key default gen_random_uuid(),
  competencia text not null check (competencia ~ '^\d{4}-\d{2}$'),
  modulo text not null,
  setor text not null,
  status text not null default 'pendente' check (status in ('pendente', 'concluido')),
  confirmado_por uuid references auth.users(id) on delete set null,
  confirmado_email text,
  confirmado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (competencia, modulo)
);

alter table public.cronograma_entregas enable row level security;

drop policy if exists "cronograma leitura autenticada" on public.cronograma_entregas;
create policy "cronograma leitura autenticada"
on public.cronograma_entregas for select
to authenticated
using (true);

drop policy if exists "cronograma confirmacao autenticada" on public.cronograma_entregas;
create policy "cronograma confirmacao autenticada"
on public.cronograma_entregas for insert
to authenticated
with check (
  confirmado_por = auth.uid()
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and (
        lower(ue.perfil) = 'administrador'
        or (modulo = 'financeiro' and lower(ue.perfil) = 'financeiro')
        or (modulo = 'compras' and lower(ue.perfil) = 'compras')
        or (modulo = 'folha' and lower(ue.perfil) in ('folha', 'folha de pagamento'))
        or (modulo in ('contabil', 'book') and lower(ue.perfil) in ('contabil', 'contábil', 'contabilidade'))
      )
  )
);

drop policy if exists "cronograma atualizacao autenticada" on public.cronograma_entregas;
create policy "cronograma atualizacao autenticada"
on public.cronograma_entregas for update
to authenticated
using (true)
with check (
  confirmado_por = auth.uid()
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and (
        lower(ue.perfil) = 'administrador'
        or (modulo = 'financeiro' and lower(ue.perfil) = 'financeiro')
        or (modulo = 'compras' and lower(ue.perfil) = 'compras')
        or (modulo = 'folha' and lower(ue.perfil) in ('folha', 'folha de pagamento'))
        or (modulo in ('contabil', 'book') and lower(ue.perfil) in ('contabil', 'contábil', 'contabilidade'))
      )
  )
);

create index if not exists cronograma_entregas_competencia_idx
  on public.cronograma_entregas (competencia);

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

drop policy if exists "historico cronograma leitura autenticada" on public.cronograma_historico;
create policy "historico cronograma leitura autenticada"
on public.cronograma_historico for select
to authenticated
using (true);

drop policy if exists "historico cronograma registro por setor" on public.cronograma_historico;
create policy "historico cronograma registro por setor"
on public.cronograma_historico for insert
to authenticated
with check (
  usuario_id = auth.uid()
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and (
        lower(ue.perfil) = 'administrador'
        or (modulo = 'financeiro' and lower(ue.perfil) = 'financeiro')
        or (modulo = 'compras' and lower(ue.perfil) = 'compras')
        or (modulo = 'folha' and lower(ue.perfil) in ('folha', 'folha de pagamento'))
        or (modulo in ('contabil', 'book') and lower(ue.perfil) in ('contabil', 'contábil', 'contabilidade'))
      )
  )
);

create index if not exists cronograma_historico_competencia_data_idx
  on public.cronograma_historico (competencia, criado_em desc);

create table if not exists public.cronograma_configuracoes (
  competencia text primary key check (competencia ~ '^\d{4}-\d{2}$'),
  data_fechamento date not null,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_email text,
  atualizado_em timestamptz not null default now()
);

alter table public.cronograma_configuracoes enable row level security;

drop policy if exists "configuracao cronograma leitura autenticada" on public.cronograma_configuracoes;
create policy "configuracao cronograma leitura autenticada"
on public.cronograma_configuracoes for select
to authenticated
using (true);

drop policy if exists "configuracao cronograma gravacao autenticada" on public.cronograma_configuracoes;
create policy "configuracao cronograma gravacao autenticada"
on public.cronograma_configuracoes for insert
to authenticated
with check (atualizado_por = auth.uid());

drop policy if exists "configuracao cronograma atualizacao autenticada" on public.cronograma_configuracoes;
create policy "configuracao cronograma atualizacao autenticada"
on public.cronograma_configuracoes for update
to authenticated
using (true)
with check (atualizado_por = auth.uid());
