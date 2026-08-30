export type AccountingRevenueKind = "revenue" | "discount" | "other";
export type RevenueReconciliationStatus =
  | "Sem Dados"
  | "Conciliado"
  | "Só no Fiscal"
  | "Só no Contábil"
  | "Divergente";

export const REVENUE_TOLERANCE = 0.01;
export const REVENUE_ACCOUNT_PREFIX = "3.1.1.01.01";
export const COMMERCIAL_DISCOUNT_ACCOUNT = "3.1.2.02.01.01";
export const DISCOUNT_ACCOUNT_PREFIX = "3.1.2.02.02";
export const INSTITUTIONAL_DISCOUNT_ACCOUNT = "3.1.2.02.02.01";
export const PAA_DISCOUNT_ACCOUNT = "3.1.2.02.02.03";

export const REVENUE_ACCOUNT_DESCRIPTIONS = [
  "Mensalidade Creche",
  "Mensalidade Educacao Infantil",
  "Mensalidade Ensino Fundamental",
  "Mensalidade Ensino Medio",
  "Mensalidade Educação Continuada",
  "Serviços Prestados",
  "Mensalidade - Dependência",
  "Provisão de Receita Educacional",
  "Mensalidade Pré-Militar",
  "Mensalidades - Educação básica",
  "Mensalidades Extras",
  "Mensalidade Pre-Vestibular",
  "Horario Integral (Estentido)",
  "Mensalidade Curso Preparatório",
] as const;

export const DISCOUNT_ACCOUNT_DESCRIPTIONS = [
  "Bolsas Institucionais",
  "Desconto Comercial s/ Mensalidades",
  "Bolsas Funcionais",
  "Bolsas PAA",
  "Desconto Institucional",
] as const;

export function normalizeAccountingDescription(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const REVENUE_DESCRIPTIONS = new Set(
  REVENUE_ACCOUNT_DESCRIPTIONS.map(normalizeAccountingDescription),
);
const DISCOUNT_DESCRIPTIONS = new Set(
  DISCOUNT_ACCOUNT_DESCRIPTIONS.map(normalizeAccountingDescription),
);

export function accountingRevenueQueryAccounts() {
  return [
    REVENUE_ACCOUNT_PREFIX,
    COMMERCIAL_DISCOUNT_ACCOUNT,
    DISCOUNT_ACCOUNT_PREFIX,
  ] as const;
}

export function classifyAccountingRevenue(
  account: string,
  description: string,
): AccountingRevenueKind {
  const normalizedAccount = account.trim();
  const normalizedDescription = normalizeAccountingDescription(description);

  if (
    normalizedAccount.startsWith(REVENUE_ACCOUNT_PREFIX) &&
    REVENUE_DESCRIPTIONS.has(normalizedDescription)
  ) {
    return "revenue";
  }

  if (
    (normalizedAccount === COMMERCIAL_DISCOUNT_ACCOUNT ||
      normalizedAccount.startsWith(DISCOUNT_ACCOUNT_PREFIX)) &&
    DISCOUNT_DESCRIPTIONS.has(normalizedDescription)
  ) {
    return "discount";
  }

  return "other";
}

export function isRevenueAppropriation(complement: string) {
  return normalizeAccountingDescription(complement) === "APROPRIACAO RECEITA";
}

export function normalizeRevenueRa(value: string) {
  const normalized = value.trim();
  if (/^\d+\.0+$/.test(normalized)) return normalized.replace(/\.0+$/, "");
  return normalized;
}

export type AccountingRevenueEntry = {
  ra: string;
  name: string;
  value: number;
  kind: Exclude<AccountingRevenueKind, "other">;
  complement?: string;
};

export function summarizeAccountingRevenue(entries: AccountingRevenueEntry[]) {
  const summaries = new Map<
    string,
    { name: string; revenue: number; discount: number; complements: string[] }
  >();

  entries.forEach((entry) => {
    const current = summaries.get(entry.ra) || {
      name: entry.name,
      revenue: 0,
      discount: 0,
      complements: [],
    };

    if (entry.kind === "revenue") current.revenue += entry.value;
    else current.discount += entry.value;

    const complement = entry.complement?.trim();
    if (complement && !current.complements.includes(complement)) {
      current.complements.push(complement);
    }
    summaries.set(entry.ra, current);
  });

  summaries.forEach((summary) => {
    summary.revenue = Math.abs(summary.revenue);
  });

  return summaries;
}

export function classifyRevenueReconciliation(values: {
  fiscalRevenue: number;
  accountingRevenue: number;
  fiscalDiscount: number;
  accountingDiscount: number;
}): RevenueReconciliationStatus {
  const {
    fiscalRevenue,
    accountingRevenue,
    fiscalDiscount,
    accountingDiscount,
  } = values;
  const isZero = (value: number) => Math.abs(value) <= REVENUE_TOLERANCE;
  const monetaryDifference = (left: number, right: number) =>
    Math.abs(Math.round((left - right) * 100) / 100);

  if (
    [fiscalRevenue, accountingRevenue, fiscalDiscount, accountingDiscount].every(
      isZero,
    )
  ) {
    return "Sem Dados";
  }
  if (
    monetaryDifference(fiscalRevenue, accountingRevenue) <= REVENUE_TOLERANCE &&
    monetaryDifference(fiscalDiscount, accountingDiscount) <= REVENUE_TOLERANCE
  ) {
    return "Conciliado";
  }
  if (
    fiscalRevenue > REVENUE_TOLERANCE &&
    isZero(accountingRevenue) &&
    isZero(accountingDiscount)
  ) {
    return "Só no Fiscal";
  }
  if (
    accountingRevenue > REVENUE_TOLERANCE &&
    isZero(fiscalRevenue) &&
    isZero(fiscalDiscount)
  ) {
    return "Só no Contábil";
  }
  return "Divergente";
}

export function deduplicateAccountingRecords(records: string[]) {
  return [...new Set(records)];
}
