export const BANK_RECONCILIATION_TOLERANCE = 1;
export const BANK_RECONCILIATION_TOLERANCE_CENTS =
  BANK_RECONCILIATION_TOLERANCE * 100;

export const BANK_STATEMENT_SOURCE_PRIORITY = {
  unknown: 0,
  pdf: 1,
  excel: 2,
} as const;

export const BANK_RECONCILIATION_POLICY_STEPS = [
  {
    title: "Aplicar a mesma regra a todas as empresas",
    detail:
      "A análise respeita a coligada e a competência selecionadas, mas o tratamento técnico é único e não cria exceções para empresas específicas.",
  },
  {
    title: "Atualizar a base contábil",
    detail:
      "O sistema consulta os lançamentos bancários do TOTVS e os alertas internos da Planilha 18 antes de liberar a etapa seguinte.",
  },
  {
    title: "Atualizar os extratos no Data Engine",
    detail:
      "Para cada conta e competência, o Excel tem prioridade. O PDF só é usado quando não existe Excel correspondente; os dois nunca são somados.",
  },
  {
    title: "Usar o movimento correto da aplicação",
    detail:
      "Contas de aplicação usam primeiro o extrato de movimento. Posições e saldos servem apenas como alternativa quando os movimentos não estão disponíveis.",
  },
  {
    title: "Vincular somente contas bancárias elegíveis",
    detail:
      "Empresa, banco, agência, conta e evidência de movimento identificam a correspondência. Contas de caixa e tesouraria são desconsideradas.",
  },
  {
    title: "Preservar movimentos legítimos e eliminar duplicidades",
    detail:
      "Lançamentos repetidos que pertencem ao mesmo Excel são mantidos. O mesmo movimento vindo de outro arquivo, PDF ou fonte equivalente é contado uma única vez.",
  },
  {
    title: "Conferir primeiro o movimento líquido diário",
    detail:
      "O sistema soma entradas e saídas do extrato e débitos e créditos contábeis por dia. A soma líquida prevalece sobre a comparação isolada de lançamentos.",
  },
  {
    title: "Conferir depois o movimento líquido mensal",
    detail:
      "Diferenças de datas que se compensam dentro da competência são desconsideradas quando o total líquido do mês está correto.",
  },
  {
    title: "Aplicar a tolerância de até R$ 1,00",
    detail:
      "Diferenças líquidas mensais de até R$ 1,00 são consideradas conciliadas e não geram pendência na ficha.",
  },
  {
    title: "Localizar somente a diferença real",
    detail:
      "A investigação por dia e por movimento só é aberta quando o total líquido mensal permanece divergente após todas as compensações.",
  },
  {
    title: "Manter histórico e relatório",
    detail:
      "Contas conciliadas e divergentes mantêm fichas recolhidas. O relatório consolidado registra diferenças diárias informativas sem transformá-las em pendência quando o mês fecha.",
  },
] as const;
