-- Solicitação, aprovação e autorização de usuários do Contabilidade Raiz.
-- A liberação é feita por módulo e sempre abrange todas as empresas ativas.

create table if not exists public.usuarios_modulos (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  modulo text not null check (modulo in ('financeiro', 'fiscal', 'compras', 'folha', 'contabil', 'book', 'cronograma')),
  concedido_por uuid references auth.users(id) on delete set null,
  concedido_em timestamptz not null default now(),
  primary key (usuario_id, modulo)
);

create table if not exists public.solicitacoes_acesso (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email))),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'rejeitado')),
  usuario_id uuid references auth.users(id) on delete set null,
  modulos text[] not null default '{}',
  empresa_ids uuid[] not null default '{}',
  solicitado_em timestamptz not null default now(),
  analisado_por uuid references auth.users(id) on delete set null,
  analisado_em timestamptz,
  convite_enviado_em timestamptz
);

create index if not exists solicitacoes_acesso_status_data_idx
  on public.solicitacoes_acesso (status, solicitado_em);

create or replace function public.usuario_e_administrador(p_usuario_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = coalesce(p_usuario_id, auth.uid())
      and lower(trim(ue.perfil)) = 'administrador'
  );
$$;

create or replace function public.usuario_tem_modulo(
  p_modulo text,
  p_usuario_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with contexto as (
    select coalesce(p_usuario_id, auth.uid()) as usuario_id, lower(trim(p_modulo)) as modulo
  )
  select
    public.usuario_e_administrador(contexto.usuario_id)
    or exists (
      select 1
      from public.usuarios_modulos um
      where um.usuario_id = contexto.usuario_id
        and um.modulo = contexto.modulo
    )
    or (
      not exists (
        select 1 from public.usuarios_modulos um
        where um.usuario_id = contexto.usuario_id
      )
      and exists (
        select 1
        from public.usuarios_empresas ue
        where ue.usuario_id = contexto.usuario_id
          and (
            (contexto.modulo = 'cronograma')
            or (contexto.modulo = 'financeiro' and lower(trim(ue.perfil)) = 'financeiro')
            or (contexto.modulo = 'fiscal' and lower(trim(ue.perfil)) = 'fiscal')
            or (contexto.modulo = 'compras' and lower(trim(ue.perfil)) = 'compras')
            or (contexto.modulo = 'folha' and lower(trim(ue.perfil)) in ('folha', 'folha de pagamento'))
            or (contexto.modulo in ('contabil', 'book') and lower(trim(ue.perfil)) in ('contabil', 'contábil', 'contabilidade'))
          )
      )
    )
  from contexto;
$$;

revoke all on function public.usuario_e_administrador(uuid) from public;
revoke all on function public.usuario_tem_modulo(text, uuid) from public;
grant execute on function public.usuario_e_administrador(uuid) to authenticated, service_role;
grant execute on function public.usuario_tem_modulo(text, uuid) to authenticated, service_role;

alter table public.usuarios_modulos enable row level security;
alter table public.solicitacoes_acesso enable row level security;

drop policy if exists "modulos do proprio usuario" on public.usuarios_modulos;
create policy "modulos do proprio usuario"
on public.usuarios_modulos for select
to authenticated
using (usuario_id = auth.uid() or public.usuario_e_administrador(auth.uid()));

drop policy if exists "solicitacoes para administradores" on public.solicitacoes_acesso;
create policy "solicitacoes para administradores"
on public.solicitacoes_acesso for select
to authenticated
using (public.usuario_e_administrador(auth.uid()));

revoke all on public.solicitacoes_acesso from anon;
grant select on public.usuarios_modulos to authenticated;

create or replace function public.solicitar_acesso_contabilidade(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@[:space:]]+@raizeducacao\.com\.br$' then
    raise exception 'Somente e-mails corporativos da Raiz podem solicitar acesso.';
  end if;

  insert into public.solicitacoes_acesso (
    email, status, solicitado_em, usuario_id, modulos, empresa_ids,
    analisado_por, analisado_em, convite_enviado_em
  )
  values (v_email, 'pendente', now(), null, '{}', '{}', null, null, null)
  on conflict (email) do update
  set
    status = case when solicitacoes_acesso.status = 'aprovado' then 'aprovado' else 'pendente' end,
    solicitado_em = case when solicitacoes_acesso.status = 'aprovado' then solicitacoes_acesso.solicitado_em else now() end,
    analisado_por = case when solicitacoes_acesso.status = 'aprovado' then solicitacoes_acesso.analisado_por else null end,
    analisado_em = case when solicitacoes_acesso.status = 'aprovado' then solicitacoes_acesso.analisado_em else null end;

  return 'ok';
end;
$$;

revoke all on function public.solicitar_acesso_contabilidade(text) from public;
grant execute on function public.solicitar_acesso_contabilidade(text) to anon, authenticated, service_role;

create or replace function public.vincular_nova_empresa_a_membros()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ativa then
    insert into public.usuarios_empresas (usuario_id, empresa_id, perfil)
    select distinct ue.usuario_id, new.id, 'Membro'
    from public.usuarios_empresas ue
    where lower(trim(ue.perfil)) = 'membro'
    on conflict (usuario_id, empresa_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists vincular_nova_empresa_a_membros_trigger on public.empresas;
create trigger vincular_nova_empresa_a_membros_trigger
after insert or update of ativa on public.empresas
for each row execute function public.vincular_nova_empresa_a_membros();

-- A conciliação bancária exige empresa vinculada e acesso ao Módulo Financeiro.
drop policy if exists "leitura de contas autorizadas" on public.contas_bancarias;
drop policy if exists "alteracao de contas autorizadas" on public.contas_bancarias;
create policy "leitura de contas autorizadas"
on public.contas_bancarias for select
to authenticated
using (
  public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = contas_bancarias.empresa_id and ue.usuario_id = auth.uid()
  )
);
create policy "alteracao de contas autorizadas"
on public.contas_bancarias for all
to authenticated
using (
  public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = contas_bancarias.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = contas_bancarias.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de saldos autorizados" on public.saldos_bancarios;
drop policy if exists "alteracao de saldos autorizados" on public.saldos_bancarios;
create policy "leitura de saldos autorizados"
on public.saldos_bancarios for select
to authenticated
using (
  public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1
    from public.contas_bancarias cb
    join public.usuarios_empresas ue on ue.empresa_id = cb.empresa_id
    where cb.id = saldos_bancarios.conta_bancaria_id and ue.usuario_id = auth.uid()
  )
);
create policy "alteracao de saldos autorizados"
on public.saldos_bancarios for all
to authenticated
using (
  public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1
    from public.contas_bancarias cb
    join public.usuarios_empresas ue on ue.empresa_id = cb.empresa_id
    where cb.id = saldos_bancarios.conta_bancaria_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1
    from public.contas_bancarias cb
    join public.usuarios_empresas ue on ue.empresa_id = cb.empresa_id
    where cb.id = saldos_bancarios.conta_bancaria_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura de arquivos autorizados" on public.arquivos_importados;
drop policy if exists "alteracao de arquivos autorizados" on public.arquivos_importados;
create policy "leitura de arquivos autorizados"
on public.arquivos_importados for select
to authenticated
using (
  public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = arquivos_importados.empresa_id and ue.usuario_id = auth.uid()
  )
);
create policy "alteracao de arquivos autorizados"
on public.arquivos_importados for all
to authenticated
using (
  public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = arquivos_importados.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
)
with check (
  public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.empresa_id = arquivos_importados.empresa_id
      and ue.usuario_id = auth.uid()
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "upload extratos" on storage.objects;
create policy "upload extratos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'extratos-bancarios'
  and public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id::text = (storage.foldername(name))[1]
      and lower(trim(ue.perfil)) <> 'consulta'
  )
);

drop policy if exists "leitura extratos" on storage.objects;
create policy "leitura extratos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'extratos-bancarios'
  and public.usuario_tem_modulo('financeiro', auth.uid())
  and exists (
    select 1 from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id::text = (storage.foldername(name))[1]
  )
);

-- As etapas do cronograma aceitam o módulo explicitamente liberado.
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
