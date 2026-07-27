-- Execute este script depois de:
-- 1. executar schema.sql;
-- 2. criar o primeiro usuário em Authentication > Users.
--
-- Troque somente os três valores abaixo antes de executar.

do $$
declare
  v_email text := 'SEU_EMAIL_AQUI';
  v_razao_social text := 'NOME_DA_EMPRESA';
  v_cnpj text := null; -- Exemplo: '00.000.000/0001-00'
  v_usuario_id uuid;
  v_empresa_id uuid;
begin
  select id
    into v_usuario_id
    from auth.users
   where lower(email) = lower(v_email)
   limit 1;

  if v_usuario_id is null then
    raise exception 'Usuário não encontrado para o e-mail %', v_email;
  end if;

  insert into public.empresas (razao_social, cnpj)
  values (v_razao_social, v_cnpj)
  returning id into v_empresa_id;

  insert into public.usuarios_empresas (
    usuario_id,
    empresa_id,
    perfil
  )
  values (
    v_usuario_id,
    v_empresa_id,
    'Administrador'
  );
end
$$;
