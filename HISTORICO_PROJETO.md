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

## Conciliação de Receita

- Base fiscal atualizada diretamente pelo TOTVS Gestão de Estoque, Compras e Faturamento.
- Consulta de leitura criada no TOTVS: `RAIZ.REC.FISCAL`.
- Base contábil atualizada diretamente pelo TOTVS Contábil, usando o razão das contas do grupo `3.1.1.01.01`.
- Chave mensal de cruzamento: `RA + competência`.
- Receita e descontos são conciliados separadamente, com tolerância de R$ 0,01.
- Lançamentos com complemento `APROPRIAÇÃO RECEITA` são desconsiderados.
- Estornos são identificados pelo prefixo `ESTORNO:`.
- A tela apresenta somente divergentes, registros exclusivos do Fiscal e registros exclusivos do Contábil.

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

## Consolidação de 7 de agosto de 2026

### Cronograma de fechamento

- O Cronograma de Fechamento é a visão inicial do sistema.
- O período é selecionado em duas listas, primeiro ano e depois mês.
- A janela projetada começa no primeiro dia do mês seguinte à competência selecionada e termina após 10 dias úteis.
- Cada setor é responsável pela entrega do próprio módulo e pode marcar ou desmarcar o respectivo `OK`.
- Quando a entrega é confirmada, o módulo assume o mesmo destaque visual do Book Contábil.
- O Book Contábil permanece como produto final do processo de fechamento.
- O histórico das entregas permanece disponível no menu lateral.

### Apuração de PIS e COFINS

- A tela pertence ao Módulo Contábil e utiliza empresa, ano, mês e filiais como filtros.
- O filtro de filiais permite selecionar uma ou várias filiais, de 1 a 15.
- A empresa selecionada permanece ao trocar de página.
- O regime tributário é exibido dentro da área da empresa.
- O processo contém as etapas Faturamento Mensal, Outras Receitas, Rateios Anuidades e Notas Canceladas.
- A base de Faturamento Mensal utiliza a Planilha.NET 2 do módulo Gestão de Estoque, Compras e Faturamento, consulta técnica `METTA1308`, aplicação `T`, título `ANALISE NF MENSALIDADES 1`, desconsiderando notas canceladas.
- A base tributável do faturamento é o campo `VALORNF`, respeitando empresa, competência e filiais selecionadas.
- Notas canceladas são desconsideradas do faturamento e tratadas em etapa própria.
- A classificação é feita linha a linha pelo serviço/descrição, aplicando as regras cumulativas e não cumulativas definidas pela Contabilidade.
- `Pré-Escolar` é classificado como cumulativo.
- Outras Receitas seguem prioritariamente o regime não cumulativo para empresas no Lucro Real, respeitando as parametrizações da empresa.
- Notas Canceladas usam a Planilha.NET 37: `METTA.100`, aplicação `C`, título `NOTAS MUNICIPAIS CANCELADAS`.
- Cada etapa mantém sua última apuração até o usuário acionar `Limpar`.
- Cada etapa pode ser ocultada ou exibida.
- A apuração consolidada soma PIS e COFINS cumulativos e não cumulativos das etapas, com a dedução correspondente das notas canceladas.
- A exportação completa gera um arquivo Excel com uma planilha por etapa e uma planilha de consolidação.
- A etapa Lançamentos gera CSV seguindo o modelo contábil e o nome `coligadaNN.csv`.

### Análise de Balancete

- A Análise de Balancete é o último item do menu do Módulo Contábil, depois de Intercompany.
- O botão `Gerar balancete` apresenta o balancete completo da competência.
- O botão `Analisar balancete` apresenta somente as contas criticadas.
- As duas visões ficam em abas separadas e utilizam o máximo de área útil da tela.
- A análise pode ser exportada.
- O padrão visual utiliza títulos e botões compactos, coerentes com os filtros superiores.

### Intercompany

- A Raiz é tratada como holding e os saldos são cruzados entre as empresas do grupo.
- A origem é o balancete oficial mensal do TOTVS RM.
- As naturezas atuais são Mútuos, Rateio CSC, Almoxarifado e Transações Individuais.
- A primeira etapa, `Atualizar Intercompany`, carrega e apresenta as contas Intercompany encontradas em cada empresa, com natureza, conta contábil, código reduzido, descrição e saldo final.
- Durante essa etapa, a mensagem central é `Atualizando Intercompany`.
- Depois da atualização, o botão `Analisar Intercompany` é liberado.
- A segunda etapa cruza ativo a receber e passivo a pagar e apresenta somente os itens que precisam de tratamento.
- A diferença é calculada pela soma `Ativo + Passivo`.
- A margem de conciliação é R$ 1,00: valores entre -R$ 1,00 e +R$ 1,00 são conciliados e ocultados.
- Diferenças acima da margem, conta a receber ausente, conta a pagar ausente ou ambas as contas ausentes seguem para tratamento.
- Conciliados não aparecem na tabela, no resumo final nem no Excel exportado.
- A terceira etapa, `Identificar`, consulta os movimentos contábeis das empresas e procura lançamentos sem contrapartida por conta, data e valor.
- O detalhamento informa empresa com lançamento, empresa sem lançamento, lado do lançamento, conta, data, valor, resultado de Ativo + Passivo e motivo provável.
- Também existe identificação individual em cada linha divergente.
- A exportação da análise contém somente divergências.

### Conciliação bancária e fontes

- A leitura operacional dos extratos usa movimentos normalizados e sanitizados do Raiz Data Engine.
- A atualização dos extratos deve informar quando nenhum movimento ou conta for encontrado.
- O botão da fonte fica verde após atualização válida.
- A conciliação só é liberada após extratos e base contábil estarem disponíveis.
- Quando houver múltiplas contas, cada identificador bancário protegido deve ser vinculado explicitamente à conta contábil.
- O sistema deve entregar somente contas e lançamentos divergentes para tratamento.

### Publicação e continuidade

- Repositório atual: `luandasilva-prog/contabilidade-raiz`.
- Branch de produção: `main`.
- Projeto Vercel: `contabilidade-raiz`, equipe `contabilidade2`.
- Endereço de produção: <https://contabilidade-raiz.vercel.app/>.
- As alterações aprovadas são enviadas ao GitHub e publicadas na Vercel.
- Credenciais, senhas, tokens e valores de variáveis de ambiente não devem ser registrados no histórico.

## 2026-08-14 — Integração canônica de extratos com o Data Engine

- A fonte operacional de extratos passou a ser o Raiz Data Engine, pela rota
  server-side `/api/data-engine/statements`.
- O navegador não recebe a credencial técnica do Data Engine.
- A API consulta movimentos por coligada e competência, pagina todos os
  resultados e devolve somente descrições sanitizadas.
- Como o identificador bancário do Data Engine é protegido, a interface exige
  vínculo explícito com a conta contábil quando há mais de uma conta.
- O fluxo antigo do Google Drive deixa de ser usado pelo painel de conciliação.

---

Última consolidação deste histórico: 14 de agosto de 2026.
