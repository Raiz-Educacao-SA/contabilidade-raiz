# Histórico do projeto — Contabilidade Raiz

## Objetivo

Centralizar as rotinas contábeis da Raiz Educação em um único sistema, começando pela conciliação financeira e evoluindo para compras, folha de pagamento, rotinas contábeis e o Book Contábil como produto final do fechamento.

## Estrutura atual

O menu principal possui os seguintes itens, nesta ordem:

1. Módulo Financeiro
2. Módulo Compras
3. Módulo Folha de Pagamento
4. Módulo Contábil
5. Módulo Book Contábil

Os cartões do menu foram compactados para permanecerem visíveis na tela inicial, sem rolagem vertical em telas de computador.

## Módulo Financeiro

O módulo contém:

- Conciliação bancária;
- Conciliação de receita;
- Conciliação de empréstimos;
- Conciliação de parcelamentos.

### Regras definidas para a conciliação bancária

- A conciliação é realizada por empresa, competência mensal e conta bancária.
- A conta deve ser identificada automaticamente a partir da planilha contábil e do extrato.
- É possível trabalhar conta por conta ou preparar vários extratos e executar o processamento mensal.
- O histórico da última conciliação deve permanecer disponível até que o usuário o limpe.
- O extrato pode ser associado individualmente a cada conta.
- A ficha de conciliação deve exibir somente pendências, lançamentos ausentes ou valores divergentes.
- Quando saldos, débitos e créditos estiverem conciliados, a ficha não deve repetir os lançamentos; deve apresentar apenas a posição final conciliada.
- A visão mensal deve validar movimentações, dias sem lançamentos contábeis e diferenças entre extrato e contabilidade.
- Foram preparados os comandos “Atualizar extratos” e “Atualizar contábil”.
- A origem planejada dos extratos é o Google Drive, evitando dependência de upload manual.
- A base contábil oficial é o TOTVS RM, inicialmente pela consulta Planilha 18.

## Empresas e competência

- A lista de empresas é controlada pelos vínculos do usuário no Supabase.
- Empresa, ano e mês são filtros superiores compartilhados pelos módulos.
- O código da unidade segue o padrão `CODCOLIGADA.CODFILIAL` quando aplicável.
- A relação inicial de empresas foi fornecida pela planilha `Resumo_Empresas.xlsx`.

## Book Contábil

O Book Contábil possui uma visão mensal por empresa, usando os mesmos filtros superiores da conciliação.

### Balancete mensal

- Consulta oficial do TOTVS RM: `CUBO.CTB.002 — CUBO BALANCETE MENSAL - MOV X SALDO`.
- Exibe código reduzido em coluna própria.
- Exibe conta contábil, descrição, saldo anterior, débitos, créditos e saldo final.
- A coluna Movimento foi retirada da apresentação.
- Exibe totais de débitos, créditos, saldos devedores e saldos credores.
- Permite pesquisar por código reduzido, conta ou descrição.
- A tabela foi compactada para exibir mais contas simultaneamente.
- A atualização do balancete é feita diretamente no TOTVS RM.

## Identidade e acesso

- Nome do sistema: **Contabilidade Raiz**.
- Identidade visual: logomarca da Raiz Educação.
- Autenticação e vínculos de empresas: Supabase.
- Credenciais, senhas e chaves não são registradas neste histórico nem no repositório.

## Publicação e integrações

- Código-fonte: repositório privado `luandasilva-prog/conciliacao-bancaria` no GitHub.
- Hospedagem: projeto `conciliacao-bancaria` da equipe `contabilidade2` na Vercel.
- Aplicação: <https://conciliacao-bancaria-git-main-contabilidade2.vercel.app/>
- Banco, autenticação e armazenamento: Supabase.
- Base contábil: WebService do TOTVS RM em produção.
- Origem planejada dos extratos: pasta corporativa do Google Drive em `FECHAMENTO/EXTRATOS BANCÁRIOS`.

## Diretriz de evolução

Os resultados dos módulos Financeiro, Compras, Folha de Pagamento e Contábil devem alimentar progressivamente o Book Contábil, que representa a visão final do processo de fechamento.

---

Última consolidação deste histórico: 5 de agosto de 2026.
