# Conciliação Bancária Automática — versão ajustada

Sistema local em Streamlit para importar uma planilha contábil e vários extratos bancários em Excel.

## Regra principal

A movimentação do mês não é diferença de conciliação.

- Entradas, saídas e movimentação líquida são exibidas apenas como informações financeiras.
- A diferença de conciliação considera somente lançamentos pendentes e divergências por lançamento.
- Um mês pode ter grande movimentação e, mesmo assim, apresentar diferença de conciliação igual a R$ 0,00.

## O que o sistema faz

- Identifica as contas existentes na planilha contábil.
- Permite vincular cada extrato à conta contábil correta.
- Concilia primeiro por data e valor exatos.
- Sugere correspondências pelo mesmo valor dentro da tolerância de dias.
- Mostra conciliados, possíveis conciliações, somente no banco e somente na contabilidade.
- Exibe entradas, saídas e movimentação líquida apenas como indicadores informativos.
- Exporta para a aba `Todas_as_diferencas` somente os itens que não estão conciliados.

## Instalação no Windows

1. Instale o Python 3.11 ou mais recente.
2. Extraia esta pasta.
3. Dê dois cliques em `instalar.bat`.
4. Depois dê dois cliques em `executar.bat`.
5. O navegador abrirá automaticamente.

## Uso

1. Envie a planilha contábil.
2. Envie um ou mais extratos em Excel.
3. Confira a conta contábil sugerida para cada extrato.
4. Clique em **Executar conciliação**.
5. Baixe o relatório em Excel.

## Estrutura esperada

### Planilha contábil

- DESCRICAO
- CODCONTA
- DATACOMPENSACAO ou DATA
- DEBITO
- CREDITO

### Extrato bancário

- DATA
- LANCAMENTO, HISTORICO ou DESCRICAO
- VALOR

Linhas de saldo são ignoradas automaticamente.


## Conferência diária

O sistema agrupa os lançamentos por data e compara a movimentação líquida do banco com a movimentação líquida contábil.

A movimentação normal do dia não é considerada diferença. O dia é marcado como `REVISAR` somente quando:

- o total líquido do banco não corresponde ao total líquido contábil; ou
- existe lançamento pendente naquela data.

O relatório exportado contém uma aba `Diario_...` para cada extrato.

## Vários extratos e armazenamento

- O campo de extratos aceita vários arquivos ao mesmo tempo.
- Cada extrato é vinculado à sua conta contábil.
- Novos extratos podem ser armazenados em `dados/extratos/AAAA-MM/CONTA`.
- Extratos já armazenados podem ser selecionados novamente dentro da competência.

## Saldo inicial e continuidade mensal

Para cada conta, informe o saldo inicial. O sistema calcula:

`Saldo final = Saldo inicial + movimentação líquida do mês`

Ao marcar **Fixar saldo final para o mês seguinte**, o saldo final será sugerido automaticamente como saldo inicial da competência posterior. Os saldos ficam registrados em `dados/saldos.json`.
