-- Atualiza o cadastro a partir de Resumo_Empresas.xlsx.
-- Pode ser executado mais de uma vez sem duplicar empresas ou vínculos.

alter table public.empresas
  add column if not exists codcoligada text;

create unique index if not exists empresas_cnpj_unico
  on public.empresas (cnpj)
  where cnpj is not null;

create unique index if not exists empresas_codcoligada_unico
  on public.empresas (codcoligada)
  where codcoligada is not null;

insert into public.empresas (codcoligada, razao_social, cnpj, ativa)
values
  ('01', 'RAIZ EDUCAÇÃO', '21.219.576/0001-14', true),
  ('02', 'COLÉGIO QI', '86.704.160/0001-37', true),
  ('03', 'RAIZ SUL', '21.669.216/0001-14', true),
  ('04', 'EDITORA RAIZ', '14.642.152/0001-00', true),
  ('05', 'AO CUBO', '23.075.186/0001-43', true),
  ('06', 'METROPOLITANO', '33.590.308/0001-93', true),
  ('08', 'MATRIZ EDUCAÇÃO', '28.336.302/0001-54', true),
  ('09', 'Global Tree', '28.734.505/0001-07', true),
  ('10', 'ESCOLAS INTEGRADAS', '07.499.961/0001-31', true),
  ('11', 'GEU', '89.409.825/0001-78', true),
  ('12', 'CLV', '09.262.835/0001-94', true),
  ('13', 'SELVI', '92.845.437/0001-44', true),
  ('14', 'DIDACTA', '87.188.959/0001-80', true),
  ('16', 'CLV GAMA', '38.376.734/0001-42', true),
  ('17', 'BOM TEMPO', '20.647.702/0001-79', true),
  ('18', 'APOGEU ESPAÇO MÁGICO', '25.788.092/0001-47', true),
  ('20', 'APOGEU CIDADE ALTA - INTEGRA', '66.448.143/0001-79', true),
  ('25', 'COLÉGIO SARAH DAWSEY', '42.722.698/0001-07', true),
  ('26', 'APOGEU SUDESTE', '32.555.626/0001-50', true),
  ('28', 'PRO RAIZ', '49.218.279/0001-73', true),
  ('29', 'COLÉGIO AMERICANO', '58.232.918/0001-46', true),
  ('30', 'COLÉGIO UNIÃO', '58.241.128/0001-27', true)
on conflict (cnpj) where cnpj is not null do update
set codcoligada = excluded.codcoligada,
    razao_social = excluded.razao_social,
    ativa = true;

-- Os usuários que já são administradores recebem acesso às empresas da lista.
insert into public.usuarios_empresas (usuario_id, empresa_id, perfil)
select distinct
  administradores.usuario_id,
  empresas.id,
  'Administrador'
from (
  select distinct usuario_id
  from public.usuarios_empresas
  where lower(perfil) = 'administrador'
) administradores
cross join public.empresas empresas
where empresas.codcoligada is not null
on conflict (usuario_id, empresa_id) do update
set perfil = excluded.perfil;
