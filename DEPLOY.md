# Publicação no Streamlit Community Cloud

## Estrutura de publicação

- Repositório: `luandasilva-prog/conciliacao-bancaria`
- Branch: `main`
- Arquivo principal: `streamlit_app.py`
- Dependências: `requirements.txt`
- Banco, autenticação e arquivos: Supabase

## 1. Preparar o Supabase

1. Crie ou abra o projeto no Supabase.
2. No **SQL Editor**, execute `Supabase/schema.sql`.
3. Em **Authentication > Users**, crie o primeiro usuário.
4. Ajuste os valores de exemplo e execute `Supabase/criar_primeiro_acesso.sql`.
5. Confirme que o bucket privado `extratos-bancarios` foi criado.
6. Confirme que o RLS está habilitado e que as políticas do `schema.sql` existem.

O aplicativo usa:

- `empresas`;
- `usuarios_empresas`;
- `contas_bancarias`;
- `saldos_bancarios`;
- `arquivos_importados`;
- bucket privado `extratos-bancarios`.

## 2. Configurar Secrets

Use somente a URL do projeto e a chave pública `anon`/`publishable`.
Nunca use nem publique a chave `service_role`.

No ambiente local, copie `.streamlit/secrets.toml.example` para
`.streamlit/secrets.toml` e preencha:

```toml
SUPABASE_URL = "https://SEU-PROJETO.supabase.co"
SUPABASE_ANON_KEY = "SUA-CHAVE-PUBLICAVEL"
```

O arquivo `.streamlit/secrets.toml` é ignorado pelo Git.

## 3. Publicar

1. Revise as alterações locais.
2. Faça commit e push para a branch `main`.
3. Acesse o Streamlit Community Cloud e conecte a conta do GitHub.
4. Selecione o repositório, a branch `main` e `streamlit_app.py`.
5. Em **App settings > Secrets**, cadastre as mesmas duas variáveis.
6. Faça o deploy e teste login, cadastro de conta, upload, armazenamento e conciliação.

## Segurança

- O repositório deve permanecer privado enquanto houver código ou contexto interno.
- Não envie extratos, planilhas contábeis, relatórios ou dados bancários ao Git.
- O bucket é privado e o acesso é limitado pelas políticas RLS.
- A aplicação não precisa da chave `service_role`.
