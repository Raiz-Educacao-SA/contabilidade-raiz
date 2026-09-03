-- Quadro de movimentações da nota explicativa — carga inicial 07/2026.
-- Estrutura isolada do módulo Ativo Fixo e execução idempotente.
begin;

alter table public.ativo_fixo_grupos
  add column if not exists nota_explicativa_codigo text;

create table if not exists public.ativo_fixo_nota_explicativa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  secao text not null check (secao in ('IMOBILIZADO','INTANGIVEL')),
  ordem integer not null,
  codigo_ne text not null,
  descricao text not null,
  taxa_anual numeric(8,6) not null default 0,
  saldo_inicial numeric(18,2) not null default 0,
  adicoes numeric(18,2) not null default 0,
  transferencias numeric(18,2) not null default 0,
  afac numeric(18,2) not null default 0,
  baixas numeric(18,2) not null default 0,
  depreciacao numeric(18,2) not null default 0,
  saldo_final numeric(18,2) not null default 0,
  saldo_balancete numeric(18,2) not null default 0,
  diferenca numeric(18,2) generated always as (saldo_balancete - saldo_final) stored,
  origem text not null default 'CALCULADO',
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, competencia, codigo_ne)
);

alter table public.ativo_fixo_nota_explicativa enable row level security;
drop policy if exists leitura_ativo_fixo_nota_explicativa on public.ativo_fixo_nota_explicativa;
drop policy if exists alteracao_ativo_fixo_nota_explicativa on public.ativo_fixo_nota_explicativa;
create policy leitura_ativo_fixo_nota_explicativa
on public.ativo_fixo_nota_explicativa for select
using (exists (
  select 1 from public.usuarios_empresas ue
  where ue.empresa_id = ativo_fixo_nota_explicativa.empresa_id
    and ue.usuario_id = auth.uid()
));
create policy alteracao_ativo_fixo_nota_explicativa
on public.ativo_fixo_nota_explicativa for all
using (exists (
  select 1 from public.usuarios_empresas ue
  where ue.empresa_id = ativo_fixo_nota_explicativa.empresa_id
    and ue.usuario_id = auth.uid()
    and lower(trim(ue.perfil)) <> 'consulta'
))
with check (exists (
  select 1 from public.usuarios_empresas ue
  where ue.empresa_id = ativo_fixo_nota_explicativa.empresa_id
    and ue.usuario_id = auth.uid()
    and lower(trim(ue.perfil)) <> 'consulta'
));

do $$
declare
  v_empresa_id uuid;
  v_linhas integer;
begin
  select id into strict v_empresa_id
  from public.empresas
  where codcoligada in ('1','01');

  update public.ativo_fixo_grupos
  set nota_explicativa_codigo = case codigo
    when '1.2.3.02.01' then '7008'
    when '1.2.3.02.02' then '7011'
    when '1.2.3.02.03' then '7003'
    when '1.2.3.02.05' then '7004'
    when '1.2.3.02.07' then '7099'
    when '1.2.3.02.08' then '7005'
    when '1.2.3.01.01' then '7006'
    when '1.2.3.02.14' then '7100'
    when '1.2.3.02.16' then '7101'
    when '1.2.3.02.20' then '7104'
    else nota_explicativa_codigo end
  where empresa_id = v_empresa_id;

  insert into public.ativo_fixo_nota_explicativa
    (empresa_id, competencia, secao, ordem, codigo_ne, descricao, taxa_anual,
     saldo_inicial, adicoes, transferencias, afac, baixas, depreciacao,
     saldo_final, saldo_balancete, origem)
  select v_empresa_id, '2026-07', x.secao, x.ordem, x.codigo_ne, x.descricao,
         x.taxa_anual, x.saldo_inicial, x.adicoes, x.transferencias, x.afac,
         x.baixas, x.depreciacao, x.saldo_final, x.saldo_balancete,
         'PLANILHA_CARGA_INICIAL'
  from (values
    ('IMOBILIZADO', 1,  '7008', 'Benfeitorias em Imóveis de Terceiros', 0.20, 730918.40, 0, 0, 0, 0, -126138, 604780, 604780.61),
    ('IMOBILIZADO', 2,  '7011', 'Imóveis/Instalações',                   0.10,  50412.70, 0, 0, 0, 0,   -4786,  45627,  45627.00),
    ('IMOBILIZADO', 3,  '7014', 'Imóveis',                              0.00,      0.00, 0, 0, 0, 0,       0,      0,      0.00),
    ('IMOBILIZADO', 4,  '7010', 'Terrenos',                             0.00,      0.00, 0, 0, 0, 0,       0,      0,      0.00),
    ('IMOBILIZADO', 5,  '7003', 'Máquinas e Equipamentos',              0.10, 124683.48, 0, 0, 0, 0,  -11434, 113249, 113249.75),
    ('IMOBILIZADO', 6,  '7004', 'Móveis e Utensílios',                  0.10, 373875.02, 0, 0, 0, 0,  -32879, 340996, 340995.82),
    ('IMOBILIZADO', 7,  '7005', 'Computadores e Periféricos',           0.20, 841070.10, 19223, 0, 0, 0, -188532, 671761, 671761.19),
    ('IMOBILIZADO', 8,  '7013', 'Veículos',                             0.20,      0.00, 0, 0, 0, 0,       0,      0,      0.00),
    ('IMOBILIZADO', 9,  '7012', 'Acervo Educacional',                   0.00,      0.00, 0, 0, 0, 0,       0,      0,      0.00),
    ('IMOBILIZADO', 10, '7006', 'Imobilizado em Andamento',             0.00, 759613.70, 104393, 0, 0, 0,      0, 864007, 864007.12),
    ('IMOBILIZADO', 11, '7099', 'Equipamentos de Comunicação',          0.20,  62433.61, 31054, 0, 0, 0, -17113,  76375,  76374.75),
    ('INTANGIVEL',  1,  '7100', 'Software',                             0.20,      0.00, 0, 0, 0, 0,       0,      0,      0.00),
    ('INTANGIVEL',  2,  '7101', 'Software e Licenças de Uso',           1.00,      0.00, 0, 0, 0, 0,       0,      0,      0.00),
    ('INTANGIVEL',  3,  '7104', 'Fundo de Comércio',                    0.10, 3735000.00, 0, 0, 0, 0, -276667, 3458333, 3458333.33),
    ('INTANGIVEL',  4,  '7199', 'Autoria de Livros',                    0.00,      0.00, 0, 0, 0, 0,       0,      0,      0.00)
  ) as x(secao, ordem, codigo_ne, descricao, taxa_anual, saldo_inicial,
         adicoes, transferencias, afac, baixas, depreciacao, saldo_final,
         saldo_balancete)
  on conflict (empresa_id, competencia, codigo_ne) do update set
    secao = excluded.secao, ordem = excluded.ordem, descricao = excluded.descricao,
    taxa_anual = excluded.taxa_anual, saldo_inicial = excluded.saldo_inicial,
    adicoes = excluded.adicoes, transferencias = excluded.transferencias,
    afac = excluded.afac, baixas = excluded.baixas,
    depreciacao = excluded.depreciacao, saldo_final = excluded.saldo_final,
    saldo_balancete = excluded.saldo_balancete, origem = excluded.origem,
    atualizado_em = now();

  select count(*) into v_linhas
  from public.ativo_fixo_nota_explicativa
  where empresa_id = v_empresa_id and competencia = '2026-07';
  if v_linhas <> 15 then
    raise exception 'Quadro recusado: eram esperadas 15 linhas e foram encontradas %.', v_linhas;
  end if;
end $$;

commit;

select secao, count(*) as linhas, sum(saldo_inicial) as saldo_inicial,
       sum(adicoes) as adicoes, sum(depreciacao) as depreciacao,
       sum(saldo_final) as saldo_final, sum(saldo_balancete) as saldo_balancete,
       sum(diferenca) as diferenca
from public.ativo_fixo_nota_explicativa ne
join public.empresas e on e.id = ne.empresa_id
where e.codcoligada in ('1','01') and ne.competencia = '2026-07'
group by secao
order by secao;
