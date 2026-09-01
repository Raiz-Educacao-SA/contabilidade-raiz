export type AccountingRevenueKind = "revenue" | "discount" | "other";
export type RevenueDivergenceClassification = "Receitas extras" | "";
export type RevenueReconciliationStatus =
  | "Sem Dados"
  | "Conciliado"
  | "Só no Fiscal"
  | "Só no Contábil"
  | "Divergente";

export const REVENUE_TOLERANCE = 0.01;
export const REVENUE_ACCOUNT_PREFIX = "3.1.1.01.01";
export const EXTENDED_HOURS_REVENUE_ACCOUNT = "3.1.1.01.02.03";
export const OTHER_STUDENT_REVENUE_ACCOUNT = "3.1.1.01.02.06";
export const EXTRA_REVENUE_ACCOUNTS = [
  EXTENDED_HOURS_REVENUE_ACCOUNT,
  OTHER_STUDENT_REVENUE_ACCOUNT,
] as const;
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
  "Horário Integral (Estendido)",
  "Horário Estendido",
  "Outras Receitas de Alunos",
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
    ...EXTRA_REVENUE_ACCOUNTS,
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
    (normalizedAccount.startsWith(REVENUE_ACCOUNT_PREFIX) ||
      isExtraRevenueAccount(normalizedAccount)) &&
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

export function isExtraRevenueAccount(account?: string) {
  return EXTRA_REVENUE_ACCOUNTS.some(
    (extraAccount) => extraAccount === account?.trim(),
  );
}

export function isRevenueAppropriation(complement: string) {
  return normalizeAccountingDescription(complement) === "APROPRIACAO RECEITA";
}

export function isExcludedRevenueGenerationType(generationType?: string) {
  return ["I", "E"].includes(generationType?.trim().toUpperCase() || "");
}

export function normalizeRevenueRa(value: string) {
  const normalized = value.trim();
  if (/^\d+\.0+$/.test(normalized)) return normalized.replace(/\.0+$/, "");
  return normalized;
}

export function isValidRevenueRa(value: string) {
  const normalized = normalizeRevenueRa(value);
  return /^(?=[A-Z0-9]*\d)[A-Z0-9]{5,}$/i.test(normalized);
}

export function revenueReconciliationExportFileName(
  companyCode: string,
  companyName: string,
  competenceLabel: string,
) {
  const normalizedCode = String(companyCode).padStart(2, "0");
  const numericCode = Number(companyCode);
  const companyWithoutLeadingCode = Number.isFinite(numericCode)
    ? companyName.replace(
        new RegExp(`^\\s*0*${numericCode}\\s*(?:[—–-]+|_+)\\s*`, "u"),
        "",
      )
    : companyName;
  const companySlug = companyWithoutLeadingCode
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "") || "Empresa";

  return `${normalizedCode}_${companySlug}_Faturamento_VS_Educacional_${competenceLabel.replace("/", ".")}.xlsx`;
}

export type AccountingRevenueEntry = {
  ra: string;
  name: string;
  value: number;
  kind: Exclude<AccountingRevenueKind, "other">;
  complement?: string;
  generationType?: string;
  account?: string;
};

export type FiscalRevenueEntry = {
  id: string;
  ra: string;
  name: string;
  status: string;
  originalValue: number;
  discount: number;
};

export function consolidateFiscalRevenueRows<T extends FiscalRevenueEntry>(
  entries: T[],
) {
  const rowsByRa = new Map<string, T[]>();

  entries.forEach((entry) => {
    const rows = rowsByRa.get(entry.ra) || [];
    rows.push(entry);
    rowsByRa.set(entry.ra, rows);
  });

  return [...rowsByRa.values()].map((rows) => {
    const authorizedRows = rows.filter(
      (row) => normalizeAccountingDescription(row.status) === "AUTORIZADA",
    );
    const revenueRows = authorizedRows.length > 0 ? authorizedRows : rows;
    const representative = authorizedRows[0] || rows[0];

    return {
      ...representative,
      id: rows.map((row) => row.id).join("|"),
      status: authorizedRows.length > 0
        ? "AUTORIZADA"
        : [...new Set(rows.map((row) => row.status.trim()).filter(Boolean))].join(" | "),
      originalValue: revenueRows.reduce(
        (sum, row) => sum + row.originalValue,
        0,
      ),
      discount: rows.reduce((sum, row) => sum + row.discount, 0),
    };
  });
}

export function summarizeAccountingRevenue(entries: AccountingRevenueEntry[]) {
  const summaries = new Map<
    string,
    {
      name: string;
      revenue: number;
      extraRevenue: number;
      extraRevenueAccounts: string[];
      discount: number;
      complements: string[];
      generationTypes: string[];
    }
  >();

  entries.forEach((entry) => {
    const current = summaries.get(entry.ra) || {
      name: entry.name,
      revenue: 0,
      extraRevenue: 0,
      extraRevenueAccounts: [],
      discount: 0,
      complements: [],
      generationTypes: [],
    };

    if (entry.kind === "revenue") {
      current.revenue += entry.value;
      if (isExtraRevenueAccount(entry.account)) {
        current.extraRevenue += entry.value;
        const account = entry.account?.trim();
        if (account && !current.extraRevenueAccounts.includes(account)) {
          current.extraRevenueAccounts.push(account);
        }
      }
    } else current.discount += entry.value;

    const complement = entry.complement?.trim();
    if (complement && !current.complements.includes(complement)) {
      current.complements.push(complement);
    }
    const generationType = entry.generationType?.trim();
    if (
      generationType &&
      !current.generationTypes.includes(generationType)
    ) {
      current.generationTypes.push(generationType);
    }
    summaries.set(entry.ra, current);
  });

  summaries.forEach((summary) => {
    summary.revenue = Math.abs(summary.revenue);
    summary.extraRevenue = Math.abs(summary.extraRevenue);
  });

  return summaries;
}

export function classifyRevenueDivergence(values: {
  status: RevenueReconciliationStatus;
  revenueDifference: number;
  discountDifference: number;
  extraRevenue: number;
}): RevenueDivergenceClassification {
  return Math.abs(values.extraRevenue) > REVENUE_TOLERANCE
    ? "Receitas extras"
    : "";
}

export function calculateUnexplainedRevenueDifference(
  revenueDifference: number,
  extraRevenue: number,
) {
  return Math.round((Math.abs(extraRevenue) - revenueDifference) * 100) / 100;
}

export function requiresRevenueTreatment(values: {
  status: RevenueReconciliationStatus;
  classification: RevenueDivergenceClassification;
  unexplainedRevenueDifference: number;
  discountDifference: number;
}) {
  if (!values.classification) {
    return values.status !== "Conciliado";
  }

  return (
    Math.abs(values.unexplainedRevenueDifference) > REVENUE_TOLERANCE ||
    Math.abs(values.discountDifference) > REVENUE_TOLERANCE
  );
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
