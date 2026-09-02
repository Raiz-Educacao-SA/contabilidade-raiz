create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

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
insert into storage.buckets (id, name, public)
values ('irpj-csll-dossiers', 'irpj-csll-dossiers', false)
on conflict (id) do update set public = false;

drop policy if exists "upload dossies irpj csll" on storage.objects;
create policy "upload dossies irpj csll"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'irpj-csll-dossiers'
  and (storage.foldername(name))[1] = 'IRPJ-CSLL'
  and exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id::text = (storage.foldername(name))[2]
      and lower(trim(ue.perfil)) <> 'consulta'
  )
  and public.usuario_tem_modulo('contabil', auth.uid())
);

drop policy if exists "leitura dossies irpj csll" on storage.objects;
create policy "leitura dossies irpj csll"
on storage.objects for select
to authenticated
using (
  bucket_id = 'irpj-csll-dossiers'
  and (storage.foldername(name))[1] = 'IRPJ-CSLL'
  and exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id::text = (storage.foldername(name))[2]
  )
  and public.usuario_tem_modulo('contabil', auth.uid())
);

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

create table if not exists public.fiscal_year_profiles (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  exercicio integer not null,
  regime text not null default 'REAL_PROFIT',
  periodicidade text not null,
  vigencia_inicio date not null,
  vigencia_fim date,
  versao integer not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint fiscal_year_profiles_exercicio_valido check (exercicio between 1900 and 9999),
  constraint fiscal_year_profiles_regime_valido check (regime in ('REAL_PROFIT')),
  constraint fiscal_year_profiles_periodicidade_valida check (periodicidade in ('ANNUAL', 'QUARTERLY')),
  constraint fiscal_year_profiles_vigencia_valida check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint fiscal_year_profiles_versao_valida check (versao >= 1),
  constraint fiscal_year_profiles_empresa_exercicio_versao_unico unique (empresa_id, exercicio, versao),
  constraint fiscal_year_profiles_id_empresa_exercicio_unico unique (id, empresa_id, exercicio)
);

create table if not exists public.tax_periods (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fiscal_year_profile_id uuid,
  exercicio integer not null,
  codigo_periodo text not null,
  data_inicial date not null,
  data_final date not null,
  tipo_periodo text not null,
  status text not null default 'DRAFT',
  upstream_stale boolean not null default false,
  closed_manifest_id uuid,
  closed_manifest jsonb not null default '{}'::jsonb,
  fechado_em timestamptz,
  fechado_por uuid references auth.users(id),
  replaced_by_tax_period_id uuid references public.tax_periods(id),
  versao integer not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint tax_periods_exercicio_valido check (exercicio between 1900 and 9999),
  constraint tax_periods_intervalo_valido check (data_final >= data_inicial),
  constraint tax_periods_tipo_valido check (tipo_periodo in ('MONTHLY_ESTIMATE', 'ANNUAL_ADJUSTMENT', 'QUARTERLY_REAL')),
  constraint tax_periods_status_valido check (status in ('DRAFT', 'CALCULATED', 'CALCULATED_WITH_PENDING_ITEMS', 'REVIEWED', 'CLOSED_CURRENT', 'CLOSED_SUPERSEDED')),
  constraint tax_periods_versao_valida check (versao >= 1),
  constraint tax_periods_closed_manifest_objeto check (jsonb_typeof(closed_manifest) = 'object'),
  constraint tax_periods_profile_empresa_exercicio_fk foreign key (fiscal_year_profile_id, empresa_id, exercicio)
    references public.fiscal_year_profiles(id, empresa_id, exercicio) on delete restrict,
  constraint tax_periods_empresa_exercicio_codigo_versao_unico unique (empresa_id, exercicio, codigo_periodo, versao),
  constraint tax_periods_id_empresa_unico unique (id, empresa_id)
);

create table if not exists public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  empresa_referencia_externa text not null,
  tax_period_id uuid not null,
  periodo_identidade jsonb not null,
  fonte text not null,
  tipo_fonte text not null,
  provedor text not null,
  versao_adapter integer not null default 1,
  versao_schema_conteudo integer not null default 1,
  extraido_em timestamptz not null,
  parametros jsonb not null default '{}'::jsonb,
  quantidade_registros integer not null,
  conteudo jsonb not null default '[]'::jsonb,
  total_debito numeric(18,2) not null default 0,
  total_credito numeric(18,2) not null default 0,
  saldos jsonb not null default '{}'::jsonb,
  hash text not null,
  versao_snapshot integer not null default 1,
  criado_em timestamptz not null default now(),
  constraint source_snapshots_periodo_empresa_fk foreign key (tax_period_id, empresa_id)
    references public.tax_periods(id, empresa_id) on delete restrict,
  constraint source_snapshots_empresa_ref_externa_obrigatoria check (length(trim(empresa_referencia_externa)) > 0),
  constraint source_snapshots_periodo_identidade_objeto check (jsonb_typeof(periodo_identidade) = 'object'),
  constraint source_snapshots_periodo_identidade_campos check (
    periodo_identidade ? 'fiscalYear'
    and periodo_identidade ? 'periodCode'
    and periodo_identidade ? 'startDate'
    and periodo_identidade ? 'endDate'
  ),
  constraint source_snapshots_fonte_obrigatoria check (length(trim(fonte)) > 0),
  constraint source_snapshots_tipo_fonte_valido check (tipo_fonte in ('TRIAL_BALANCE')),
  constraint source_snapshots_provedor_obrigatorio check (length(trim(provedor)) > 0),
  constraint source_snapshots_versao_adapter_valida check (versao_adapter >= 1),
  constraint source_snapshots_versao_schema_conteudo_valida check (versao_schema_conteudo >= 1),
  constraint source_snapshots_quantidade_valida check (quantidade_registros >= 0),
  constraint source_snapshots_conteudo_array check (jsonb_typeof(conteudo) = 'array'),
  constraint source_snapshots_quantidade_conteudo check (jsonb_array_length(conteudo) = quantidade_registros),
  constraint source_snapshots_totais_validos check (total_debito >= 0 and total_credito >= 0),
  constraint source_snapshots_hash_valido check (hash ~ '^[a-f0-9]{64}$'),
  constraint source_snapshots_versao_valida check (versao_snapshot >= 1),
  constraint source_snapshots_periodo_fonte_versao_unico unique (tax_period_id, fonte, versao_snapshot),
  constraint source_snapshots_id_empresa_unico unique (id, empresa_id)
);
create table if not exists public.fiscal_natures (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  nome text not null,
  descricao text not null default '',
  metadados_origem jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint fiscal_natures_codigo_unico unique (codigo),
  constraint fiscal_natures_codigo_obrigatorio check (length(trim(codigo)) > 0),
  constraint fiscal_natures_nome_obrigatorio check (length(trim(nome)) > 0),
  constraint fiscal_natures_metadados_origem_objeto check (jsonb_typeof(metadados_origem) = 'object')
);

create table if not exists public.accounting_charts (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  nome text not null,
  descricao text not null default '',
  ativo boolean not null default true,
  versao integer not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint accounting_charts_codigo_unico unique (codigo),
  constraint accounting_charts_codigo_obrigatorio check (length(trim(codigo)) > 0),
  constraint accounting_charts_nome_obrigatorio check (length(trim(nome)) > 0),
  constraint accounting_charts_versao_valida check (versao >= 1)
);

create table if not exists public.company_accounting_charts (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  accounting_chart_id uuid not null references public.accounting_charts(id) on delete restrict,
  exercicio integer,
  vigencia_inicio date not null,
  vigencia_fim date,
  versao integer not null default 1,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint company_accounting_charts_exercicio_valido check (exercicio is null or exercicio between 1900 and 9999),
  constraint company_accounting_charts_vigencia_valida check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint company_accounting_charts_versao_valida check (versao >= 1),
  constraint company_accounting_charts_vigencia_sem_sobreposicao exclude using gist (
    empresa_id with =,
    (coalesce(exercicio, 0)) with =,
    daterange(vigencia_inicio, coalesce(vigencia_fim, 'infinity'::date), '[]') with &&
  ) where (ativo)
);

create table if not exists public.account_fiscal_mappings (
  id uuid primary key default gen_random_uuid(),
  accounting_chart_id uuid not null references public.accounting_charts(id) on delete cascade,
  codigo_conta text not null,
  codigo_reduzido text,
  fiscal_nature_id uuid not null references public.fiscal_natures(id) on delete restrict,
  metadados_origem jsonb not null default '{}'::jsonb,
  vigencia_inicio date not null,
  vigencia_fim date,
  versao integer not null default 1,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint account_fiscal_mappings_codigo_conta_obrigatorio check (length(trim(codigo_conta)) > 0),
  constraint account_fiscal_mappings_vigencia_valida check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint account_fiscal_mappings_versao_valida check (versao >= 1),
  constraint account_fiscal_mappings_metadados_origem_objeto check (jsonb_typeof(metadados_origem) = 'object'),
  constraint account_fiscal_mappings_vigencia_sem_sobreposicao exclude using gist (
    accounting_chart_id with =,
    codigo_conta with =,
    (coalesce(codigo_reduzido, '')) with =,
    daterange(vigencia_inicio, coalesce(vigencia_fim, 'infinity'::date), '[]') with &&
  ) where (ativo)
);

create table if not exists public.company_account_mapping_overrides (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  accounting_chart_id uuid not null references public.accounting_charts(id) on delete restrict,
  codigo_conta text not null,
  codigo_reduzido text,
  fiscal_nature_id uuid not null references public.fiscal_natures(id) on delete restrict,
  vigencia_inicio date not null,
  vigencia_fim date,
  versao integer not null default 1,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint company_account_mapping_overrides_codigo_conta_obrigatorio check (length(trim(codigo_conta)) > 0),
  constraint company_account_mapping_overrides_vigencia_valida check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint company_account_mapping_overrides_versao_valida check (versao >= 1),
  constraint company_account_mapping_overrides_vigencia_sem_sobreposicao exclude using gist (
    empresa_id with =,
    accounting_chart_id with =,
    codigo_conta with =,
    (coalesce(codigo_reduzido, '')) with =,
    daterange(vigencia_inicio, coalesce(vigencia_fim, 'infinity'::date), '[]') with &&
  ) where (ativo)
);

create table if not exists public.fiscal_rules (
  id uuid primary key default gen_random_uuid(),
  codigo_regra text not null,
  fiscal_nature_id uuid not null references public.fiscal_natures(id) on delete restrict,
  tratamento_irpj text not null,
  tratamento_csll text not null,
  metodo_execucao text not null,
  nivel_automacao text not null,
  criterios jsonb not null default '{}'::jsonb,
  metadados_origem jsonb not null default '{}'::jsonb,
  vigencia_inicio date not null,
  vigencia_fim date,
  versao integer not null default 1,
  status text not null default 'DRAFT',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint fiscal_rules_codigo_regra_obrigatorio check (length(trim(codigo_regra)) > 0),
  constraint fiscal_rules_tratamento_irpj_valido check (tratamento_irpj in ('NO_ADJUSTMENT', 'ADDITION', 'EXCLUSION', 'CONDITIONAL', 'AUTOMATIC_SPECIAL')),
  constraint fiscal_rules_tratamento_csll_valido check (tratamento_csll in ('NO_ADJUSTMENT', 'ADDITION', 'EXCLUSION', 'CONDITIONAL', 'AUTOMATIC_SPECIAL')),
  constraint fiscal_rules_metodo_execucao_valido check (metodo_execucao in ('FULL_ACCOUNT', 'TRANSACTION_FILTER', 'BALANCE_FORMULA', 'EXTERNAL_SOURCE', 'MANUAL_EXCEPTION')),
  constraint fiscal_rules_nivel_automacao_valido check (nivel_automacao in ('AUTOMATIC', 'SEMI_AUTOMATIC', 'MANUAL')),
  constraint fiscal_rules_status_valido check (status in ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED')),
  constraint fiscal_rules_metadados_origem_objeto check (jsonb_typeof(metadados_origem) = 'object'),
  constraint fiscal_rules_vigencia_valida check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint fiscal_rules_versao_valida check (versao >= 1),
  constraint fiscal_rules_vigencia_sem_sobreposicao exclude using gist (
    fiscal_nature_id with =,
    daterange(vigencia_inicio, coalesce(vigencia_fim, 'infinity'::date), '[]') with &&
  ) where (status = 'ACTIVE')
);

create table if not exists public.company_rule_overrides (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fiscal_nature_id uuid not null references public.fiscal_natures(id) on delete restrict,
  tratamento_irpj text,
  tratamento_csll text,
  metodo_execucao text,
  nivel_automacao text,
  criterios jsonb,
  vigencia_inicio date not null,
  vigencia_fim date,
  versao integer not null default 1,
  status text not null default 'DRAFT',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint company_rule_overrides_tratamento_irpj_valido check (tratamento_irpj is null or tratamento_irpj in ('NO_ADJUSTMENT', 'ADDITION', 'EXCLUSION', 'CONDITIONAL', 'AUTOMATIC_SPECIAL')),
  constraint company_rule_overrides_tratamento_csll_valido check (tratamento_csll is null or tratamento_csll in ('NO_ADJUSTMENT', 'ADDITION', 'EXCLUSION', 'CONDITIONAL', 'AUTOMATIC_SPECIAL')),
  constraint company_rule_overrides_metodo_execucao_valido check (metodo_execucao is null or metodo_execucao in ('FULL_ACCOUNT', 'TRANSACTION_FILTER', 'BALANCE_FORMULA', 'EXTERNAL_SOURCE', 'MANUAL_EXCEPTION')),
  constraint company_rule_overrides_nivel_automacao_valido check (nivel_automacao is null or nivel_automacao in ('AUTOMATIC', 'SEMI_AUTOMATIC', 'MANUAL')),
  constraint company_rule_overrides_status_valido check (status in ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED')),
  constraint company_rule_overrides_vigencia_valida check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint company_rule_overrides_versao_valida check (versao >= 1),
  constraint company_rule_overrides_vigencia_sem_sobreposicao exclude using gist (
    empresa_id with =,
    fiscal_nature_id with =,
    daterange(vigencia_inicio, coalesce(vigencia_fim, 'infinity'::date), '[]') with &&
  ) where (status = 'ACTIVE')
);

create table if not exists public.pending_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tax_period_id uuid not null,
  source_snapshot_id uuid not null,
  tipo text not null,
  status text not null default 'OPEN',
  bloqueante boolean not null default true,
  chave_logica text not null,
  descricao text not null,
  dados_origem jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id),
  resolvido_em timestamptz,
  resolvido_por uuid references auth.users(id),
  observacao_resolucao text,
  constraint pending_items_periodo_empresa_fk foreign key (tax_period_id, empresa_id)
    references public.tax_periods(id, empresa_id) on delete restrict,
  constraint pending_items_snapshot_empresa_fk foreign key (source_snapshot_id, empresa_id)
    references public.source_snapshots(id, empresa_id) on delete restrict,
  constraint pending_items_tipo_valido check (tipo in ('NEW_ACCOUNT_UNMAPPED', 'NEW_ACCOUNT_AUTO_CLASSIFIED', 'CONDITIONAL_TAX_DECISION')),
  constraint pending_items_status_valido check (status in ('OPEN', 'RESOLVED', 'DISMISSED')),
  constraint pending_items_chave_logica_unica unique (chave_logica),
  constraint pending_items_chave_logica_obrigatoria check (length(trim(chave_logica)) > 0),
  constraint pending_items_descricao_obrigatoria check (length(trim(descricao)) > 0),
  constraint pending_items_resolucao_status check (
    (status = 'OPEN' and resolvido_em is null)
    or (status in ('RESOLVED', 'DISMISSED') and resolvido_em is not null)
  )
);

create table if not exists public.rule_execution_results (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tax_period_id uuid not null,
  source_snapshot_id uuid not null,
  accounting_chart_id uuid not null references public.accounting_charts(id) on delete restrict,
  company_accounting_chart_id uuid not null references public.company_accounting_charts(id) on delete restrict,
  codigo_conta text not null,
  codigo_reduzido text,
  descricao_conta text not null default '',
  fiscal_nature_id uuid not null references public.fiscal_natures(id) on delete restrict,
  account_fiscal_mapping_id uuid not null references public.account_fiscal_mappings(id) on delete restrict,
  account_fiscal_mapping_version integer not null,
  company_account_mapping_override_id uuid references public.company_account_mapping_overrides(id) on delete restrict,
  company_account_mapping_override_version integer,
  fiscal_rule_id uuid not null references public.fiscal_rules(id) on delete restrict,
  fiscal_rule_version integer not null,
  company_rule_override_id uuid references public.company_rule_overrides(id) on delete restrict,
  company_rule_override_version integer,
  metodo_execucao text not null,
  nivel_automacao text not null,
  amount_basis text,
  valor_contabil_bruto numeric(18,2) not null default 0,
  valor_calculado numeric(18,2) not null default 0,
  status text not null,
  metadados_execucao jsonb not null default '{}'::jsonb,
  chave_logica text not null,
  criado_em timestamptz not null default now(),
  constraint rule_execution_results_periodo_empresa_fk foreign key (tax_period_id, empresa_id)
    references public.tax_periods(id, empresa_id) on delete restrict,
  constraint rule_execution_results_snapshot_empresa_fk foreign key (source_snapshot_id, empresa_id)
    references public.source_snapshots(id, empresa_id) on delete restrict,
  constraint rule_execution_results_id_empresa_unico unique (id, empresa_id),
  constraint rule_execution_results_chave_logica_unica unique (chave_logica),
  constraint rule_execution_results_codigo_conta_obrigatorio check (length(trim(codigo_conta)) > 0),
  constraint rule_execution_results_mapping_versao_valida check (account_fiscal_mapping_version >= 1),
  constraint rule_execution_results_mapping_override_versao_valida check (company_account_mapping_override_version is null or company_account_mapping_override_version >= 1),
  constraint rule_execution_results_rule_versao_valida check (fiscal_rule_version >= 1),
  constraint rule_execution_results_rule_override_versao_valida check (company_rule_override_version is null or company_rule_override_version >= 1),
  constraint rule_execution_results_metodo_execucao_valido check (metodo_execucao in ('FULL_ACCOUNT', 'TRANSACTION_FILTER', 'BALANCE_FORMULA', 'EXTERNAL_SOURCE', 'MANUAL_EXCEPTION')),
  constraint rule_execution_results_nivel_automacao_valido check (nivel_automacao in ('AUTOMATIC', 'SEMI_AUTOMATIC', 'MANUAL')),
  constraint rule_execution_results_amount_basis_valida check (amount_basis is null or amount_basis in ('NET_DEBIT_MOVEMENT', 'NET_CREDIT_MOVEMENT')),
  constraint rule_execution_results_status_valido check (status in ('EXECUTED', 'REQUIRES_REVIEW', 'SKIPPED')),
  constraint rule_execution_results_valor_calculado_nao_negativo check (valor_calculado >= 0),
  constraint rule_execution_results_chave_logica_obrigatoria check (length(trim(chave_logica)) > 0)
);

create table if not exists public.tax_adjustments (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tax_period_id uuid not null,
  source_snapshot_id uuid not null,
  rule_execution_result_id uuid not null,
  tributo text not null,
  tipo_ajuste text not null,
  codigo_conta text not null,
  codigo_reduzido text,
  fiscal_nature_id uuid not null references public.fiscal_natures(id) on delete restrict,
  fiscal_rule_id uuid not null references public.fiscal_rules(id) on delete restrict,
  fiscal_rule_version integer not null,
  valor numeric(18,2) not null,
  origem text not null default 'RULE_EXECUTION_RESULT',
  status text not null default 'DRAFT',
  chave_logica text not null,
  criado_em timestamptz not null default now(),
  constraint tax_adjustments_periodo_empresa_fk foreign key (tax_period_id, empresa_id)
    references public.tax_periods(id, empresa_id) on delete restrict,
  constraint tax_adjustments_snapshot_empresa_fk foreign key (source_snapshot_id, empresa_id)
    references public.source_snapshots(id, empresa_id) on delete restrict,
  constraint tax_adjustments_result_empresa_fk foreign key (rule_execution_result_id, empresa_id)
    references public.rule_execution_results(id, empresa_id) on delete restrict,
  constraint tax_adjustments_tributo_valido check (tributo in ('IRPJ', 'CSLL')),
  constraint tax_adjustments_tipo_ajuste_valido check (tipo_ajuste in ('ADDITION', 'EXCLUSION')),
  constraint tax_adjustments_origem_valida check (origem in ('RULE_EXECUTION_RESULT')),
  constraint tax_adjustments_status_valido check (status in ('DRAFT', 'READY', 'SUPERSEDED')),
  constraint tax_adjustments_codigo_conta_obrigatorio check (length(trim(codigo_conta)) > 0),
  constraint tax_adjustments_rule_versao_valida check (fiscal_rule_version >= 1),
  constraint tax_adjustments_valor_nao_negativo check (valor >= 0),
  constraint tax_adjustments_chave_logica_unica unique (chave_logica),
  constraint tax_adjustments_chave_logica_obrigatoria check (length(trim(chave_logica)) > 0)
);


create table if not exists public.tax_calculations (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tax_period_id uuid not null,
  source_snapshot_id uuid not null,
  source_snapshot_hash text not null,
  fiscal_year_profile_id uuid not null references public.fiscal_year_profiles(id) on delete restrict,
  motor text not null,
  model_version integer not null,
  calculation_version integer not null default 1,
  version_status text not null default 'DRAFT',
  status text not null,
  periodo_identidade jsonb not null default '{}'::jsonb,
  accounting_result_source jsonb not null default '{}'::jsonb,
  matrix_version text not null,
  rule_versions jsonb not null default '[]'::jsonb,
  tax_adjustment_ids jsonb not null default '[]'::jsonb,
  prior_calculation_ids jsonb not null default '[]'::jsonb,
  fiscal_balance_usages jsonb not null default '[]'::jsonb,
  credit_usages jsonb not null default '[]'::jsonb,
  irpj jsonb not null default '{}'::jsonb,
  csll jsonb not null default '{}'::jsonb,
  validation_issues jsonb not null default '[]'::jsonb,
  memoria jsonb not null default '{}'::jsonb,
  chave_logica text not null,
  criado_em timestamptz not null default now(),
  constraint tax_calculations_periodo_empresa_fk foreign key (tax_period_id, empresa_id)
    references public.tax_periods(id, empresa_id) on delete restrict,
  constraint tax_calculations_snapshot_empresa_fk foreign key (source_snapshot_id, empresa_id)
    references public.source_snapshots(id, empresa_id) on delete restrict,
  constraint tax_calculations_id_empresa_unico unique (id, empresa_id),
  constraint tax_calculations_chave_logica_unica unique (chave_logica),
  constraint tax_calculations_motor_valido check (motor = 'ANNUAL_MONTHLY'),
  constraint tax_calculations_model_version_valida check (model_version >= 1),
  constraint tax_calculations_calculation_version_valida check (calculation_version >= 1),
  constraint tax_calculations_version_status_valido check (version_status in ('DRAFT', 'REVIEW', 'CLOSED_CURRENT', 'CLOSED_SUPERSEDED')),
  constraint tax_calculations_status_valido check (status in ('CALCULATED', 'CALCULATED_WITH_PENDING_ITEMS', 'VALIDATION_REQUIRED')),
  constraint tax_calculations_hash_valido check (source_snapshot_hash ~ '^[a-f0-9]{64}$'),
  constraint tax_calculations_matrix_version_obrigatoria check (length(trim(matrix_version)) > 0),
  constraint tax_calculations_chave_logica_obrigatoria check (length(trim(chave_logica)) > 0),
  constraint tax_calculations_periodo_identidade_objeto check (jsonb_typeof(periodo_identidade) = 'object'),
  constraint tax_calculations_accounting_source_objeto check (jsonb_typeof(accounting_result_source) = 'object'),
  constraint tax_calculations_rule_versions_array check (jsonb_typeof(rule_versions) = 'array'),
  constraint tax_calculations_tax_adjustment_ids_array check (jsonb_typeof(tax_adjustment_ids) = 'array'),
  constraint tax_calculations_prior_calculation_ids_array check (jsonb_typeof(prior_calculation_ids) = 'array'),
  constraint tax_calculations_fiscal_balance_usages_array check (jsonb_typeof(fiscal_balance_usages) = 'array'),
  constraint tax_calculations_credit_usages_array check (jsonb_typeof(credit_usages) = 'array'),
  constraint tax_calculations_irpj_objeto check (jsonb_typeof(irpj) = 'object'),
  constraint tax_calculations_csll_objeto check (jsonb_typeof(csll) = 'object'),
  constraint tax_calculations_validation_issues_array check (jsonb_typeof(validation_issues) = 'array'),
  constraint tax_calculations_memoria_objeto check (jsonb_typeof(memoria) = 'object')
);

create table if not exists public.tax_workflow_human_decisions (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tax_period_id uuid not null,
  source_snapshot_id uuid not null,
  pending_item_id uuid not null,
  tipo_decisao text not null,
  usuario_id uuid not null references auth.users(id),
  usuario_email text,
  justificativa text not null,
  estado_anterior jsonb not null default '{}'::jsonb,
  estado_posterior jsonb not null default '{}'::jsonb,
  contexto_snapshot jsonb not null default '{}'::jsonb,
  matrix_version_before integer not null,
  matrix_version_after integer not null,
  tax_adjustment_ids jsonb not null default '[]'::jsonb,
  chave_logica text not null,
  criado_em timestamptz not null default now(),
  constraint tax_workflow_decisions_periodo_empresa_fk foreign key (tax_period_id, empresa_id)
    references public.tax_periods(id, empresa_id) on delete restrict,
  constraint tax_workflow_decisions_snapshot_empresa_fk foreign key (source_snapshot_id, empresa_id)
    references public.source_snapshots(id, empresa_id) on delete restrict,
  constraint tax_workflow_decisions_pending_empresa_fk foreign key (pending_item_id, empresa_id)
    references public.pending_items(id, empresa_id) on delete restrict,
  constraint tax_workflow_decisions_tipo_valido check (tipo_decisao in ('NEW_ACCOUNT_CLASSIFICATION', 'CONDITIONAL_OCCURRENCE')),
  constraint tax_workflow_decisions_justificativa_obrigatoria check (length(trim(justificativa)) >= 8),
  constraint tax_workflow_decisions_matrix_versao_valida check (matrix_version_before >= 1 and matrix_version_after >= matrix_version_before),
  constraint tax_workflow_decisions_estado_anterior_objeto check (jsonb_typeof(estado_anterior) = 'object'),
  constraint tax_workflow_decisions_estado_posterior_objeto check (jsonb_typeof(estado_posterior) = 'object'),
  constraint tax_workflow_decisions_contexto_snapshot_objeto check (jsonb_typeof(contexto_snapshot) = 'object'),
  constraint tax_workflow_decisions_adjustments_array check (jsonb_typeof(tax_adjustment_ids) = 'array'),
  constraint tax_workflow_decisions_chave_logica_unica unique (chave_logica),
  constraint tax_workflow_decisions_chave_logica_obrigatoria check (length(trim(chave_logica)) > 0)
);

create table if not exists public.tax_dossiers (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tax_period_id uuid not null,
  tax_period_version integer not null,
  status text not null default 'AVAILABLE',
  storage_bucket text not null default 'irpj-csll-dossiers',
  storage_prefix text not null,
  manifest jsonb not null default '{}'::jsonb,
  manifest_hash text not null,
  generated_at timestamptz not null default now(),
  generated_by uuid not null references auth.users(id),
  artifact_metadata jsonb not null default '[]'::jsonb,
  integrity_status text not null default 'OK',
  failure_code text,
  failure_message text,
  comparison_source_versions jsonb not null default '[]'::jsonb,
  chave_logica text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint tax_dossiers_periodo_empresa_fk foreign key (tax_period_id, empresa_id)
    references public.tax_periods(id, empresa_id) on delete restrict,
  constraint tax_dossiers_chave_logica_unica unique (chave_logica),
  constraint tax_dossiers_periodo_unico unique (tax_period_id),
  constraint tax_dossiers_version_valida check (tax_period_version >= 1),
  constraint tax_dossiers_status_valido check (status in ('AVAILABLE', 'GENERATION_FAILED')),
  constraint tax_dossiers_integrity_status_valido check (integrity_status in ('OK', 'FAILED')),
  constraint tax_dossiers_bucket_privado check (storage_bucket = 'irpj-csll-dossiers'),
  constraint tax_dossiers_storage_prefix_obrigatorio check (storage_prefix like 'IRPJ-CSLL/%'),
  constraint tax_dossiers_manifest_objeto check (jsonb_typeof(manifest) = 'object'),
  constraint tax_dossiers_artifact_metadata_array check (jsonb_typeof(artifact_metadata) = 'array'),
  constraint tax_dossiers_comparison_versions_array check (jsonb_typeof(comparison_source_versions) = 'array'),
  constraint tax_dossiers_manifest_hash_sha256 check (manifest_hash = '' or manifest_hash ~ '^[a-f0-9]{64}$'),
  constraint tax_dossiers_chave_logica_obrigatoria check (length(trim(chave_logica)) > 0)
);
create index if not exists accounting_charts_codigo_idx
  on public.accounting_charts (codigo);

create index if not exists company_accounting_charts_empresa_vigencia_idx
  on public.company_accounting_charts (empresa_id, exercicio, vigencia_inicio, vigencia_fim);

create index if not exists account_fiscal_mappings_chart_conta_idx
  on public.account_fiscal_mappings (accounting_chart_id, codigo_conta, codigo_reduzido);

create index if not exists company_account_mapping_overrides_empresa_chart_conta_idx
  on public.company_account_mapping_overrides (empresa_id, accounting_chart_id, codigo_conta, codigo_reduzido);

create index if not exists fiscal_rules_natureza_idx
  on public.fiscal_rules (fiscal_nature_id);

create index if not exists company_rule_overrides_empresa_natureza_idx
  on public.company_rule_overrides (empresa_id, fiscal_nature_id);

create index if not exists pending_items_empresa_periodo_status_idx
  on public.pending_items (empresa_id, tax_period_id, status);

create index if not exists rule_execution_results_empresa_periodo_status_idx
  on public.rule_execution_results (empresa_id, tax_period_id, status);

create index if not exists rule_execution_results_snapshot_idx
  on public.rule_execution_results (source_snapshot_id);

create index if not exists tax_adjustments_empresa_periodo_idx
  on public.tax_adjustments (empresa_id, tax_period_id, tributo, status);

create index if not exists tax_adjustments_rule_execution_result_idx
  on public.tax_adjustments (rule_execution_result_id);

create index if not exists tax_calculations_empresa_periodo_status_idx
  on public.tax_calculations (empresa_id, tax_period_id, status, version_status);

create index if not exists tax_calculations_snapshot_idx
  on public.tax_calculations (source_snapshot_id);
create index if not exists fiscal_year_profiles_empresa_exercicio_idx
  on public.fiscal_year_profiles (empresa_id, exercicio);

create unique index if not exists fiscal_year_profiles_vigencia_aberta_unica
  on public.fiscal_year_profiles (empresa_id, exercicio)
  where vigencia_fim is null;

create index if not exists tax_periods_empresa_exercicio_idx
  on public.tax_periods (empresa_id, exercicio);

create index if not exists tax_periods_profile_idx
  on public.tax_periods (fiscal_year_profile_id);

create unique index if not exists tax_periods_fechado_corrente_unico
  on public.tax_periods (empresa_id, exercicio, codigo_periodo)
  where status = 'CLOSED_CURRENT';

create index if not exists tax_periods_upstream_stale_idx
  on public.tax_periods (empresa_id, exercicio, upstream_stale)
  where upstream_stale;

create index if not exists source_snapshots_empresa_periodo_idx
  on public.source_snapshots (empresa_id, tax_period_id);
create index if not exists tax_dossiers_empresa_periodo_idx
  on public.tax_dossiers (empresa_id, tax_period_id, tax_period_version);

create index if not exists tax_dossiers_manifest_hash_idx
  on public.tax_dossiers (manifest_hash);

alter table public.fiscal_year_profiles enable row level security;
alter table public.tax_periods enable row level security;
alter table public.source_snapshots enable row level security;
alter table public.fiscal_natures enable row level security;
alter table public.accounting_charts enable row level security;
alter table public.company_accounting_charts enable row level security;
alter table public.account_fiscal_mappings enable row level security;
alter table public.company_account_mapping_overrides enable row level security;
alter table public.fiscal_rules enable row level security;
alter table public.company_rule_overrides enable row level security;
alter table public.pending_items enable row level security;
alter table public.rule_execution_results enable row level security;
alter table public.tax_adjustments enable row level security;
alter table public.tax_calculations enable row level security;
alter table public.tax_workflow_human_decisions enable row level security;
alter table public.tax_dossiers enable row level security;

drop policy if exists "leitura de perfis fiscais autorizados" on public.fiscal_year_profiles;
drop policy if exists "alteracao de perfis fiscais autorizados" on public.fiscal_year_profiles;

create policy "leitura de perfis fiscais autorizados"
on public.fiscal_year_profiles for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = fiscal_year_profiles.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de perfis fiscais autorizados"
on public.fiscal_year_profiles for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = fiscal_year_profiles.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = fiscal_year_profiles.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de periodos fiscais autorizados" on public.tax_periods;
drop policy if exists "alteracao de periodos fiscais autorizados" on public.tax_periods;

create policy "leitura de periodos fiscais autorizados"
on public.tax_periods for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_periods.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de periodos fiscais autorizados"
on public.tax_periods for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_periods.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_periods.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de snapshots fiscais autorizados" on public.source_snapshots;
drop policy if exists "alteracao de snapshots fiscais autorizados" on public.source_snapshots;

create policy "leitura de snapshots fiscais autorizados"
on public.source_snapshots for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = source_snapshots.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de snapshots fiscais autorizados"
on public.source_snapshots for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = source_snapshots.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = source_snapshots.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de naturezas fiscais autorizadas" on public.fiscal_natures;
drop policy if exists "alteracao de naturezas fiscais administradores" on public.fiscal_natures;

create policy "leitura de naturezas fiscais autorizadas"
on public.fiscal_natures for select
to authenticated
using (public.usuario_tem_modulo('contabil', auth.uid()));

create policy "alteracao de naturezas fiscais administradores"
on public.fiscal_natures for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and public.usuario_e_administrador(auth.uid())
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and public.usuario_e_administrador(auth.uid())
);

drop policy if exists "leitura de planos contabeis fiscais autorizados" on public.accounting_charts;
drop policy if exists "alteracao de planos contabeis fiscais administradores" on public.accounting_charts;

create policy "leitura de planos contabeis fiscais autorizados"
on public.accounting_charts for select
to authenticated
using (public.usuario_tem_modulo('contabil', auth.uid()));

create policy "alteracao de planos contabeis fiscais administradores"
on public.accounting_charts for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and public.usuario_e_administrador(auth.uid())
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and public.usuario_e_administrador(auth.uid())
);

drop policy if exists "leitura de mapeamentos fiscais autorizados" on public.account_fiscal_mappings;
drop policy if exists "alteracao de mapeamentos fiscais administradores" on public.account_fiscal_mappings;
drop policy if exists "alteracao de mapeamentos fiscais autorizados" on public.account_fiscal_mappings;

create policy "leitura de mapeamentos fiscais autorizados"
on public.account_fiscal_mappings for select
to authenticated
using (public.usuario_tem_modulo('contabil', auth.uid()));

create policy "alteracao de mapeamentos fiscais administradores"
on public.account_fiscal_mappings for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and public.usuario_e_administrador(auth.uid())
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and public.usuario_e_administrador(auth.uid())
);

drop policy if exists "leitura de regras fiscais autorizadas" on public.fiscal_rules;
drop policy if exists "alteracao de regras fiscais administradores" on public.fiscal_rules;

create policy "leitura de regras fiscais autorizadas"
on public.fiscal_rules for select
to authenticated
using (public.usuario_tem_modulo('contabil', auth.uid()));

create policy "alteracao de regras fiscais administradores"
on public.fiscal_rules for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and public.usuario_e_administrador(auth.uid())
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and public.usuario_e_administrador(auth.uid())
);

drop policy if exists "leitura de vinculos empresa plano autorizados" on public.company_accounting_charts;
drop policy if exists "alteracao de vinculos empresa plano autorizados" on public.company_accounting_charts;

create policy "leitura de vinculos empresa plano autorizados"
on public.company_accounting_charts for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = company_accounting_charts.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de vinculos empresa plano autorizados"
on public.company_accounting_charts for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = company_accounting_charts.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = company_accounting_charts.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de overrides de mapeamento autorizados" on public.company_account_mapping_overrides;
drop policy if exists "alteracao de overrides de mapeamento autorizados" on public.company_account_mapping_overrides;

create policy "leitura de overrides de mapeamento autorizados"
on public.company_account_mapping_overrides for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = company_account_mapping_overrides.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de overrides de mapeamento autorizados"
on public.company_account_mapping_overrides for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = company_account_mapping_overrides.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = company_account_mapping_overrides.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de overrides fiscais autorizados" on public.company_rule_overrides;
drop policy if exists "alteracao de overrides fiscais autorizados" on public.company_rule_overrides;

create policy "leitura de overrides fiscais autorizados"
on public.company_rule_overrides for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = company_rule_overrides.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de overrides fiscais autorizados"
on public.company_rule_overrides for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = company_rule_overrides.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = company_rule_overrides.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de pendencias fiscais autorizadas" on public.pending_items;
drop policy if exists "alteracao de pendencias fiscais autorizadas" on public.pending_items;

create policy "leitura de pendencias fiscais autorizadas"
on public.pending_items for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = pending_items.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de pendencias fiscais autorizadas"
on public.pending_items for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = pending_items.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = pending_items.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de resultados de regras fiscais autorizados" on public.rule_execution_results;
drop policy if exists "alteracao de resultados de regras fiscais autorizados" on public.rule_execution_results;

create policy "leitura de resultados de regras fiscais autorizados"
on public.rule_execution_results for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = rule_execution_results.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de resultados de regras fiscais autorizados"
on public.rule_execution_results for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = rule_execution_results.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = rule_execution_results.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de ajustes fiscais autorizados" on public.tax_adjustments;
drop policy if exists "alteracao de ajustes fiscais autorizados" on public.tax_adjustments;

create policy "leitura de ajustes fiscais autorizados"
on public.tax_adjustments for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_adjustments.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de ajustes fiscais autorizados"
on public.tax_adjustments for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_adjustments.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_adjustments.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);
drop policy if exists "leitura de calculos fiscais autorizados" on public.tax_calculations;
drop policy if exists "alteracao de calculos fiscais autorizados" on public.tax_calculations;

create policy "leitura de calculos fiscais autorizados"
on public.tax_calculations for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_calculations.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de calculos fiscais autorizados"
on public.tax_calculations for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_calculations.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_calculations.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);
drop policy if exists "leitura de decisoes humanas fiscais autorizadas" on public.tax_workflow_human_decisions;
drop policy if exists "alteracao de decisoes humanas fiscais autorizadas" on public.tax_workflow_human_decisions;

create policy "leitura de decisoes humanas fiscais autorizadas"
on public.tax_workflow_human_decisions for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_workflow_human_decisions.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de decisoes humanas fiscais autorizadas"
on public.tax_workflow_human_decisions for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and usuario_id = auth.uid()
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_workflow_human_decisions.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and usuario_id = auth.uid()
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_workflow_human_decisions.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);


drop policy if exists "leitura de dossies fiscais autorizados" on public.tax_dossiers;
drop policy if exists "alteracao de dossies fiscais autorizados" on public.tax_dossiers;

create policy "leitura de dossies fiscais autorizados"
on public.tax_dossiers for select
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_dossiers.empresa_id
      and ue.usuario_id = auth.uid()
  )
);

create policy "alteracao de dossies fiscais autorizados"
on public.tax_dossiers for all
to authenticated
using (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_dossiers.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('contabil', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = tax_dossiers.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);
create or replace function public.close_irpj_csll_period(
  p_empresa_id uuid,
  p_tax_period_id uuid,
  p_tax_calculation_id uuid,
  p_closed_manifest_id uuid,
  p_closed_manifest jsonb,
  p_schedule_competencia text,
  p_schedule_modulo text,
  p_schedule_setor text,
  p_usuario_id uuid,
  p_usuario_email text,
  p_fechado_em timestamptz,
  p_superseded_tax_period_ids uuid[] default '{}'::uuid[],
  p_stale_tax_period_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_period public.tax_periods%rowtype;
  v_current_count integer;
begin
  if p_usuario_id <> auth.uid() then
    raise exception 'Usuário do fechamento diverge da sessão autenticada.';
  end if;

  if not public.usuario_tem_modulo('contabil', auth.uid()) then
    raise exception 'Usuário sem acesso ao módulo contabil.';
  end if;

  if exists (
    select 1 from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = p_empresa_id
      and lower(trim(ue.perfil)) = 'consulta'
  ) then
    raise exception 'Perfil Consulta não pode fechar período fiscal.';
  end if;

  select * into v_period
  from public.tax_periods
  where id = p_tax_period_id
    and empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Período fiscal não encontrado para fechamento.';
  end if;

  update public.tax_periods
  set status = 'CLOSED_SUPERSEDED',
      replaced_by_tax_period_id = p_tax_period_id,
      atualizado_em = p_fechado_em
  where empresa_id = p_empresa_id
    and id = any(coalesce(p_superseded_tax_period_ids, '{}'::uuid[]))
    and id <> p_tax_period_id;

  update public.tax_calculations
  set version_status = 'CLOSED_SUPERSEDED'
  where empresa_id = p_empresa_id
    and tax_period_id = any(coalesce(p_superseded_tax_period_ids, '{}'::uuid[]))
    and version_status = 'CLOSED_CURRENT';

  update public.tax_periods
  set upstream_stale = true,
      atualizado_em = p_fechado_em
  where empresa_id = p_empresa_id
    and id = any(coalesce(p_stale_tax_period_ids, '{}'::uuid[]));

  update public.tax_periods
  set status = 'CLOSED_CURRENT',
      upstream_stale = false,
      closed_manifest_id = p_closed_manifest_id,
      closed_manifest = p_closed_manifest,
      fechado_por = p_usuario_id,
      fechado_em = p_fechado_em,
      atualizado_em = p_fechado_em
  where id = p_tax_period_id
    and empresa_id = p_empresa_id;

  update public.tax_calculations
  set version_status = 'CLOSED_CURRENT'
  where id = p_tax_calculation_id
    and empresa_id = p_empresa_id
    and tax_period_id = p_tax_period_id;

  if not found then
    raise exception 'Cálculo fiscal não encontrado para fechamento.';
  end if;

  select count(*) into v_current_count
  from public.tax_periods
  where empresa_id = p_empresa_id
    and exercicio = v_period.exercicio
    and codigo_periodo = v_period.codigo_periodo
    and status = 'CLOSED_CURRENT';

  if v_current_count <> 1 then
    raise exception 'Fechamento fiscal exige exatamente uma versão CLOSED_CURRENT.';
  end if;

  insert into public.cronograma_entregas (competencia, modulo, setor, status, confirmado_por, confirmado_email, confirmado_em)
  values (p_schedule_competencia, p_schedule_modulo, p_schedule_setor, 'concluido', p_usuario_id, p_usuario_email, p_fechado_em)
  on conflict (competencia, modulo)
  do update set
    setor = excluded.setor,
    status = excluded.status,
    confirmado_por = excluded.confirmado_por,
    confirmado_email = excluded.confirmado_email,
    confirmado_em = excluded.confirmado_em;

  insert into public.cronograma_historico (competencia, modulo, setor, acao, usuario_id, usuario_email, criado_em)
  values (p_schedule_competencia, p_schedule_modulo, p_schedule_setor, 'liberado', p_usuario_id, p_usuario_email, p_fechado_em);

  return jsonb_build_object(
    'closed', true,
    'taxPeriodId', p_tax_period_id,
    'taxCalculationId', p_tax_calculation_id,
    'closedManifestId', p_closed_manifest_id,
    'scheduleModule', p_schedule_modulo
  );
end;
$$;

grant execute on function public.close_irpj_csll_period(
  uuid, uuid, uuid, uuid, jsonb, text, text, text, uuid, text, timestamptz, uuid[], uuid[]
) to authenticated;
