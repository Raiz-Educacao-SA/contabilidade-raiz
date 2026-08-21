# Publicação na Vercel

## Projeto de produção

- Repositório operacional: `luandasilva-prog/contabilidade-raiz`
- Branch de produção: `main`
- Projeto Vercel: `contabilidade-raiz`
- Equipe Vercel: `contabilidade2`
- URL: `https://contabilidade-raiz.vercel.app`

O deploy deve ocorrer pela integração Git da Vercel após merge aprovado. Não use
deploy direto pela CLI.

## Variáveis obrigatórias

Cadastre em Production, Preview e Development, conforme a política do projeto:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DATA_ENGINE_BASE_URL`
- `DATA_ENGINE_API_KEY`
- `TOTVS_WS_PRD_BASE_URL`
- `TOTVS_WS_PRD_USER`
- `TOTVS_WS_PRD_PASSWORD`

`DATA_ENGINE_API_KEY` é exclusivamente server-side. Nunca crie uma variável
`NEXT_PUBLIC_DATA_ENGINE_API_KEY` nem exponha a credencial ao navegador.

A credencial do Data Engine deve ter somente `read:tesouraria`, acesso PII
governado e a lista explícita de coligadas atendidas pelo portal.

O endpoint produtivo atual é
`https://raiz-data-engine-production.up.railway.app`. A aplicação consulta as
cinco operações governadas (`movimentos`, `saldos`, `posicoes`, `cobertura` e
`pendencias`) exclusivamente pela rota server-side.

## Gates antes do merge

```bash
npm ci
npm test
npm exec tsc -- --noEmit
npm run build
```

Após o deploy, valide login, consulta contábil TOTVS e consulta de extratos pela
rota server-side `/api/data-engine/statements`. O fluxo de conciliação não usa o
Google Drive como fonte de extratos.

## Segurança

- Não registre chaves, tokens ou extratos no Git.
- Não use chave `service_role` do Supabase no cliente.
- Não envie a chave do Data Engine em respostas, logs ou variáveis públicas.
- Mantenha respostas de erro sanitizadas e cache `private, no-store`.
