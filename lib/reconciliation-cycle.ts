export function sourceReadyForReconciliation(
  updated: boolean,
  hasRows: boolean,
  sourceRevision: number,
  reconciliationRevision: number,
) {
  return updated && hasRows && sourceRevision > reconciliationRevision;
}

export function completedReconciliationRevision(
  accountingRevision: number,
  statementsRevision: number,
) {
  return Math.max(accountingRevision, statementsRevision);
}
