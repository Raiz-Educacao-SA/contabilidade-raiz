# Módulo Ativo Fixo — especificação inicial

## Objetivo

Substituir o controle mensal em Excel por um módulo auditável na plataforma Contabilidade Raiz, começando pela Raiz Educação e por uma carga inicial com posição em 31/07/2026.

## Diagnóstico da planilha de origem

- Data-base: 31/07/2026.
- Cadastro: 584 registros de bens.
- Método: depreciação linear.
- Início da depreciação configurado: mês seguinte à aquisição.
- Valor de custo armazenado: R$ 10.309.045,90.
- Valor residual armazenado: R$ 3.981,11.
- Depreciação acumulada contábil armazenada: R$ 4.129.935,20.
- Saldo contábil calculado no dashboard: R$ 6.175.129,57.
- Há controles paralelos de vida útil, quota, depreciação acumulada e saldo nas visões contábil e fiscal.
- Há consolidações por grupo de conta, natureza, nota explicativa e centro de custo.
- As fontes auxiliares incluem filiais, empresas, fornecedores, plano de contas, centros de custo, razão e balancete.
- O dashboard contém três fórmulas com referência quebrada em `L14:L16`; elas não devem ser usadas como fonte de verdade da migração.

Observação de reconciliação: a soma direta dos saldos contábeis das linhas com valores armazenados não coincide com o total do dashboard. A carga deve registrar o valor de origem por bem e produzir uma exceção de conciliação até que a diferença seja explicada.

## Escopo da versão 1

### 1. Carga inicial até julho/2026

- Importar os bens da planilha sem sobrescrever o arquivo de origem.
- Preservar empresa, filial, descrição, número da NF, unidade, conta, natureza, nota explicativa, centro de custo, fornecedor, aquisição, baixa, quantidade, valores e vidas úteis.
- Criar um identificador patrimonial próprio e manter a linha de origem para rastreabilidade.
- Registrar saldos de abertura em 31/07/2026: custo, residual, base depreciável, depreciação acumulada e saldo líquido.
- Classificar inconsistências antes da homologação: campos obrigatórios ausentes, datas inválidas, vida útil zero, saldo negativo, baixa incompatível, duplicidade de NF/item e divergência entre cadastro, razão e balancete.

### 2. Operação mensal a partir de agosto/2026

Fluxo proposto:

1. O módulo Compras apresenta aquisições candidatas ao imobilizado.
2. O analista abre a nota fiscal no Zeev e valida documento, fornecedor, item, quantidade, valor, unidade e centro de custo.
3. O analista decide entre imobilizar, despesa, projeto/em andamento ou rejeitar.
4. Para itens imobilizados, informa grupo patrimonial, vida útil, valor residual e regra de início.
5. O sistema cria um ou mais bens vinculados à NF e mantém evidência da validação.
6. No fechamento, o sistema calcula depreciação, baixas, transferências e ajustes da competência.
7. O sistema gera a prévia dos lançamentos contábeis e exige aprovação antes do registro definitivo.
8. O quadro de movimentações reconcilia controle patrimonial, razão e balancete.

### 3. Áreas do módulo

- **Visão geral:** KPIs, posição por grupo, evolução, alertas e status do fechamento.
- **Aquisições:** fila originada em Compras, consulta da NF no Zeev e decisão contábil.
- **Bens:** cadastro, ficha individual, documentos, histórico e trilha de auditoria.
- **Movimentações:** adição, transferência, baixa, ajuste, impairment e reversão.
- **Cálculo mensal:** prévia, exceções, aprovação e fechamento da competência.
- **Lançamentos contábeis:** partidas geradas, exportação/integração e status.
- **Conciliação:** controle x razão x balancete por conta, filial e competência.
- **Quadro de movimentações:** saldo inicial, adições, baixas, transferências, depreciação, ajustes e saldo final.
- **Parâmetros:** grupos, contas, vida útil, residual, materialidade e regras de contabilização.

## Regras mínimas de cálculo

- Base depreciável = custo - valor residual.
- Quota mensal = base depreciável / vida útil em meses.
- A depreciação começa conforme parâmetro do grupo; para a carga atual, no mês seguinte à aquisição.
- A depreciação acumulada não pode exceder a base depreciável em valor absoluto.
- Bem baixado não deprecia após a competência da baixa; a regra para o próprio mês deve ser parametrizada.
- Ajustes e saldos negativos precisam manter o sinal e uma justificativa auditável.
- O cálculo deve ser versionado por competência e nunca reescrever silenciosamente um fechamento aprovado.

## Modelo de dados proposto

- `ativo_fixo_grupos`: grupo patrimonial, contas contábeis, vida útil e regras.
- `ativo_fixo_bens`: ficha mestre do bem e vínculo com empresa/filial.
- `ativo_fixo_documentos`: NF, fornecedor, chave, Zeev e evidências.
- `ativo_fixo_aquisicoes`: itens candidatos vindos de Compras e decisão de validação.
- `ativo_fixo_movimentacoes`: adições, baixas, transferências, ajustes e impairment.
- `ativo_fixo_calculos`: resultado mensal por bem, com versão e status.
- `ativo_fixo_lancamentos`: cabeçalho e partidas da contabilização.
- `ativo_fixo_conciliacoes`: valores do controle, razão, balancete e diferenças.
- `ativo_fixo_importacoes`: arquivo, linha de origem, hash, status e erros da carga.
- `ativo_fixo_fechamentos`: competência, responsável, aprovação e bloqueio.

Todas as tabelas devem ser segregadas por `empresa_id`, aplicar RLS conforme o perfil do usuário e registrar criação/alteração para auditoria.

## Critérios de aceite da carga inicial

- 100% das linhas classificadas como importadas ou rejeitadas com motivo.
- Totais de custo, depreciação acumulada e saldo líquido explicados por conta e filial.
- Diferenças entre controle, razão e balancete exibidas, sem ajustes automáticos ocultos.
- Amostra homologada de bens cobrindo aquisição normal, ajuste, bem totalmente depreciado, baixa e valor residual.
- Fechamento de julho/2026 bloqueado como posição inicial e agosto/2026 aberto para operação.

## Dependências a confirmar

- Empresa piloto: código de coligada e filiais incluídas.
- Regra de materialidade para capitalização.
- Contas de ativo, depreciação acumulada, despesa e ganho/perda por grupo.
- Forma de acesso às NFs no Zeev: API, link autenticado ou consulta assistida.
- Forma de registro contábil: integração direta com TOTVS RM ou arquivo/lote para aprovação.
- Relatórios/consultas oficiais do razão e balancete usados no fechamento.
