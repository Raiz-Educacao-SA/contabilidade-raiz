-- Compartilha o lote gerado pelo Almoxarifado entre os usuários da plataforma.

begin;

create table if not exists public.almoxarifado_lotes (
  competencia text primary key check (competencia ~ '^\d{4}-\d{2}$'),
  arquivo_nome text not null,
  resultado jsonb not null,
  atualizado_em timestamptz not null default now()
);

alter table public.almoxarifado_lotes enable row level security;

drop policy if exists "lotes almoxarifado leitura autenticada"
  on public.almoxarifado_lotes;
create policy "lotes almoxarifado leitura autenticada"
on public.almoxarifado_lotes for select
to authenticated
using (true);

drop policy if exists "lotes almoxarifado inclusao contabil"
  on public.almoxarifado_lotes;
create policy "lotes almoxarifado inclusao contabil"
on public.almoxarifado_lotes for insert
to authenticated
with check (public.usuario_tem_modulo('contabil', auth.uid()));

drop policy if exists "lotes almoxarifado atualizacao contabil"
  on public.almoxarifado_lotes;
create policy "lotes almoxarifado atualizacao contabil"
on public.almoxarifado_lotes for update
to authenticated
using (public.usuario_tem_modulo('contabil', auth.uid()))
with check (public.usuario_tem_modulo('contabil', auth.uid()));

drop policy if exists "lotes almoxarifado exclusao contabil"
  on public.almoxarifado_lotes;
create policy "lotes almoxarifado exclusao contabil"
on public.almoxarifado_lotes for delete
to authenticated
using (public.usuario_tem_modulo('contabil', auth.uid()));

grant select, insert, update, delete on table public.almoxarifado_lotes to authenticated;

commit;
