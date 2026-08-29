export type AccountingRevenueKind = "revenue" | "discount" | "other";

export const REVENUE_ACCOUNT_PREFIX = "3.1.1.01.01";
export const PAA_DISCOUNT_ACCOUNT = "3.1.2.02.02.03";

export function accountingRevenueQueryAccounts() {
  return [REVENUE_ACCOUNT_PREFIX, PAA_DISCOUNT_ACCOUNT] as const;
}

export function classifyAccountingRevenue(
  account: string,
  description: string,
): AccountingRevenueKind {
  const normalizedAccount = account.trim();
  const normalizedDescription = description.trim().toUpperCase();

  if (normalizedAccount.startsWith(REVENUE_ACCOUNT_PREFIX)) return "revenue";
  if (
    normalizedAccount === PAA_DISCOUNT_ACCOUNT ||
    normalizedDescription.includes("BOLSA") ||
    normalizedDescription.includes("DESCONTO")
  ) {
    return "discount";
  }

  return "other";
}

export function deduplicateAccountingRecords(records: string[]) {
  return [...new Set(records)];
}
