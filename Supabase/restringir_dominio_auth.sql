-- Restringe a criação de usuários ao domínio corporativo da Raiz Educação.
-- Depois de executar este arquivo no SQL Editor, habilite a função em:
-- Authentication > Hooks > Before User Created
-- Tipo: Postgres Function
-- Função: public.hook_restrict_signup_by_raiz_domain

create or replace function public.hook_restrict_signup_by_raiz_domain(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  user_email text := lower(trim(coalesce(event->'user'->>'email', '')));
begin
  if user_email ~ '^[^@[:space:]]+@raizeducacao\.com\.br$' then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Acesso permitido somente para e-mails @raizeducacao.com.br.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_restrict_signup_by_raiz_domain(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_by_raiz_domain(jsonb) from authenticated, anon, public;
