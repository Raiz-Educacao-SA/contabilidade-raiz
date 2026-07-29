create extension if not exists "pgcrypto";

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  codcoligada text,
  razao_social text not null,
  cnpj text,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create unique index if not exists empresas_cnpj_unico
  on public.empresas (cnpj) where cnpj is not null;

create unique index if not exists empresas_codcoligada_unico
  on public.empresas (codcoligada) where codcoligada is not null;

create table if not exists public.usuarios_empresas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  perfil text not null default 'Consulta',
  unique(usuario_id, empresa_id)
);

create table if not exists public.contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  banco text not null,
  agencia text,
  conta_bancaria text not null,
  conta_contabil text,
  descricao text,
  ativa boolean not null default true
);

create table if not exists public.saldos_bancarios (
  id uuid primary key default gen_random_uuid(),
  conta_bancaria_id uuid not null references public.contas_bancarias(id) on delete cascade,
  competencia text not null,
  saldo_inicial numeric(18,2) not null default 0,
  saldo_final numeric(18,2) not null default 0,
  fixar_mes_seguinte boolean not null default false,
  usuario_id uuid references auth.users(id),
  unique(conta_bancaria_id, competencia)
);

create table if not exists public.arquivos_importados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia text not null,
  conta_bancaria_id uuid references public.contas_bancarias(id) on delete set null,
  tipo_arquivo text not null,
  caminho_storage text not null,
  nome_original text not null,
  usuario_id uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

alter table public.empresas enable row level security;
alter table public.usuarios_empresas enable row level security;
alter table public.contas_bancarias enable row level security;
alter table public.saldos_bancarios enable row level security;
alter table public.arquivos_importados enable row level security;

create policy "empresas autorizadas"
on public.empresas for select
using (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = empresas.id and ue.usuario_id = auth.uid()
  )
);

create policy "vinculos do usuario"
on public.usuarios_empresas for select
using (usuario_id = auth.uid());

drop policy if exists "contas autorizadas" on public.contas_bancarias;
drop policy if exists "leitura de contas autorizadas" on public.contas_bancarias;
drop policy if exists "alteracao de contas autorizadas" on public.contas_bancarias;

create policy "leitura de contas autorizadas"
on public.contas_bancarias for select
using (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = contas_bancarias.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de contas autorizadas"
on public.contas_bancarias for all
using (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = contas_bancarias.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(ue.perfil) <> 'consulta'
  )
)
with check (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = contas_bancarias.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(ue.perfil) <> 'consulta'
  )
);

drop policy if exists "saldos autorizados" on public.saldos_bancarios;
drop policy if exists "leitura de saldos autorizados" on public.saldos_bancarios;
drop policy if exists "alteracao de saldos autorizados" on public.saldos_bancarios;

create policy "leitura de saldos autorizados"
on public.saldos_bancarios for select
using (
  exists (
    select 1
    from public.contas_bancarias cb
    join public.usuarios_empresas ue on ue.empresa_id = cb.empresa_id
    where cb.id = saldos_bancarios.conta_bancaria_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de saldos autorizados"
on public.saldos_bancarios for all
using (
  exists (
    select 1
    from public.contas_bancarias cb
    join public.usuarios_empresas ue on ue.empresa_id = cb.empresa_id
    where cb.id = saldos_bancarios.conta_bancaria_id
      and ue.usuario_id = auth.uid()
      and lower(ue.perfil) <> 'consulta'
  )
)
with check (
  exists (
    select 1
    from public.contas_bancarias cb
    join public.usuarios_empresas ue on ue.empresa_id = cb.empresa_id
    where cb.id = saldos_bancarios.conta_bancaria_id
      and ue.usuario_id = auth.uid()
      and lower(ue.perfil) <> 'consulta'
  )
);

drop policy if exists "arquivos autorizados" on public.arquivos_importados;
drop policy if exists "leitura de arquivos autorizados" on public.arquivos_importados;
drop policy if exists "alteracao de arquivos autorizados" on public.arquivos_importados;

create policy "leitura de arquivos autorizados"
on public.arquivos_importados for select
using (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = arquivos_importados.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de arquivos autorizados"
on public.arquivos_importados for all
using (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = arquivos_importados.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(ue.perfil) <> 'consulta'
  )
)
with check (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = arquivos_importados.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(ue.perfil) <> 'consulta'
  )
);

insert into storage.buckets (id, name, public)
values ('extratos-bancarios', 'extratos-bancarios', false)
on conflict (id) do nothing;

drop policy if exists "upload extratos" on storage.objects;
create policy "upload extratos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'extratos-bancarios'
  and exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id::text = (storage.foldername(name))[1]
      and lower(ue.perfil) <> 'consulta'
  )
);

drop policy if exists "leitura extratos" on storage.objects;
create policy "leitura extratos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'extratos-bancarios'
  and exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id::text = (storage.foldername(name))[1]
  )
);

