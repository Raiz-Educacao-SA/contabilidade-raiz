-- Estrutura isolada do módulo Ativo Fixo. Execute somente após homologação.
create table if not exists public.ativo_fixo_grupos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  descricao text not null,
  vida_util_contabil_meses integer not null check (vida_util_contabil_meses > 0),
  vida_util_fiscal_meses integer check (vida_util_fiscal_meses > 0),
  percentual_residual numeric(8,4) not null default 0,
  conta_ativo text,
  conta_depreciacao_acumulada text,
  conta_despesa_depreciacao text,
  inicio_depreciacao text not null default 'MES_SEGUINTE' check (inicio_depreciacao in ('MES_AQUISICAO','MES_SEGUINTE')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create table if not exists public.ativo_fixo_bens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  grupo_id uuid references public.ativo_fixo_grupos(id),
  codigo_patrimonial text not null,
  codcoligada text not null,
  codfilial text not null,
  descricao text not null,
  numero_nf text,
  chave_nf text,
  zeev_referencia text,
  unidade text,
  centro_custo text,
  codigo_fornecedor text,
  fornecedor text,
  data_aquisicao date not null,
  data_baixa date,
  quantidade numeric(18,6) not null default 1,
  valor_unitario numeric(18,6) not null default 0,
  valor_custo numeric(18,2) not null,
  valor_residual numeric(18,2) not null default 0,
  vida_util_contabil_meses integer not null check (vida_util_contabil_meses > 0),
  vida_util_fiscal_meses integer check (vida_util_fiscal_meses > 0),
  status text not null default 'ATIVO' check (status in ('EM_VALIDACAO','ATIVO','BAIXADO','BLOQUEADO')),
  linha_origem integer,
  importacao_id uuid,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, codigo_patrimonial)
);

create table if not exists public.ativo_fixo_movimentacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  bem_id uuid not null references public.ativo_fixo_bens(id) on delete cascade,
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  tipo text not null check (tipo in ('SALDO_INICIAL','ADICAO','BAIXA','TRANSFERENCIA','AJUSTE','IMPAIRMENT','REVERSAO')),
  valor numeric(18,2) not null,
  justificativa text,
  documento_referencia text,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create table if not exists public.ativo_fixo_calculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  bem_id uuid not null references public.ativo_fixo_bens(id) on delete cascade,
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  versao integer not null default 1,
  base_depreciavel numeric(18,2) not null,
  quota_mensal_contabil numeric(18,2) not null,
  depreciacao_mes_contabil numeric(18,2) not null,
  depreciacao_acumulada_contabil numeric(18,2) not null,
  saldo_contabil numeric(18,2) not null,
  quota_mensal_fiscal numeric(18,2),
  depreciacao_acumulada_fiscal numeric(18,2),
  saldo_fiscal numeric(18,2),
  status text not null default 'PREVIA' check (status in ('PREVIA','APROVADO','CANCELADO')),
  calculado_em timestamptz not null default now(),
  unique (bem_id, competencia, versao)
);

create table if not exists public.ativo_fixo_conciliacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  codfilial text not null,
  conta_contabil text not null,
  valor_controle numeric(18,2) not null default 0,
  valor_razao numeric(18,2) not null default 0,
  valor_balancete numeric(18,2) not null default 0,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','CONCILIADO','DIVERGENTE')),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, competencia, codfilial, conta_contabil)
);

alter table public.ativo_fixo_grupos enable row level security;
alter table public.ativo_fixo_bens enable row level security;
alter table public.ativo_fixo_movimentacoes enable row level security;
alter table public.ativo_fixo_calculos enable row level security;
alter table public.ativo_fixo_conciliacoes enable row level security;

do $$
declare tabela text;
begin
  foreach tabela in array array['ativo_fixo_grupos','ativo_fixo_bens','ativo_fixo_movimentacoes','ativo_fixo_calculos','ativo_fixo_conciliacoes']
  loop
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = %I.empresa_id and ue.usuario_id = auth.uid()))', 'leitura_' || tabela, tabela, tabela);
    execute format('create policy %I on public.%I for all using (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = %I.empresa_id and ue.usuario_id = auth.uid() and lower(ue.perfil) <> ''consulta'')) with check (exists (select 1 from public.usuarios_empresas ue where ue.empresa_id = %I.empresa_id and ue.usuario_id = auth.uid() and lower(ue.perfil) <> ''consulta''))', 'alteracao_' || tabela, tabela, tabela, tabela);
  end loop;
end $$;
