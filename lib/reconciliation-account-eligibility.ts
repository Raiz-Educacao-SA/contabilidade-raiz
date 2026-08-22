const TREASURY_CASH_ACCOUNT_PATTERN = /\bCAIXA[\s-]*TESOURARIA\b/iu;

export function isAccountingAccountEligibleForBankReconciliation(name: string) {
  return !TREASURY_CASH_ACCOUNT_PATTERN.test(name);
}
