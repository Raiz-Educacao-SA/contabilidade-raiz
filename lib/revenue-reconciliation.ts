export type AccountingRevenueKind =
  | "revenue"
  | "discount"
  | "internalMd"
  | "other";
export type RevenueDivergenceClassification =
  | "Receitas extras"
  | "Mensalidade continuada"
  | "MD interno"
  | "";
export type RevenueReconciliationStatus =
  | "Sem Dados"
  | "Conciliado"
  | "Só no Fiscal"
  | "Só no Contábil"
  | "Divergente";

export const REVENUE_TOLERANCE = 0.01;
export const REVENUE_ACCOUNT_PREFIX = "3.1.1.01.01";
export const ADDITIONAL_TUITION_REVENUE_ACCOUNT = "3.1.1.01.01.11";
export const EXTENDED_HOURS_REVENUE_ACCOUNT = "3.1.1.01.02.03";
export const OTHER_STUDENT_REVENUE_ACCOUNT = "3.1.1.01.02.06";
export const DIDACTIC_MATERIAL_REVENUE_ACCOUNT = "3.1.1.01.03.14";
export const CONTINUING_EDUCATION_REVENUE_ACCOUNT = "3.1.1.01.01.05";
export const COMPANY_18_INTERNAL_MD_ACCOUNT = "2.3.1.03.02.02";
export const EXTRA_REVENUE_ACCOUNTS = [
  ADDITIONAL_TUITION_REVENUE_ACCOUNT,
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
    DIDACTIC_MATERIAL_REVENUE_ACCOUNT,
    COMMERCIAL_DISCOUNT_ACCOUNT,
    DISCOUNT_ACCOUNT_PREFIX,
  ] as const;
}

export function accountingRevenueQueryAccountsForCompany(companyCode: string) {
  const accounts: string[] = [...accountingRevenueQueryAccounts()];
  if (Number(companyCode) === 18) {
    accounts.push(COMPANY_18_INTERNAL_MD_ACCOUNT);
  }
  return accounts;
}

export function isCompany18InternalMdEntry(
  companyCode: string,
  account: string,
  history: string,
) {
  return (
    Number(companyCode) === 18 &&
    account.replace(/\D/g, "") === COMPANY_18_INTERNAL_MD_ACCOUNT.replace(/\D/g, "") &&
    /\bMD\s+INTERNO\b/.test(normalizeAccountingDescription(history))
  );
}

export function classifyAccountingRevenue(
  account: string,
  description: string,
): AccountingRevenueKind {
  const normalizedAccount = account.trim();
  const normalizedDescription = normalizeAccountingDescription(description);

  if (
    normalizedAccount === DIDACTIC_MATERIAL_REVENUE_ACCOUNT &&
    normalizedDescription === normalizeAccountingDescription("Material Didático")
  ) {
    return "revenue";
  }

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

export function isContinuingEducationRevenueAccount(account?: string) {
  return (
    account?.replace(/\D/g, "") ===
    CONTINUING_EDUCATION_REVENUE_ACCOUNT.replace(/\D/g, "")
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
    const representative = authorizedRows[0] || rows[0];
    const statuses = [
      ...new Set(rows.map((row) => row.status.trim()).filter(Boolean)),
    ];

    return {
      ...representative,
      id: rows.map((row) => row.id).join("|"),
      status: statuses.join(" | "),
      originalValue: rows.reduce(
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
      internalMd: number;
      internalMdAccounts: string[];
      internalMdComplements: string[];
      continuingEducationRevenue: number;
      continuingEducationAccounts: string[];
      continuingEducationComplements: string[];
      revenueIndicators: string[];
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
      internalMd: 0,
      internalMdAccounts: [],
      internalMdComplements: [],
      continuingEducationRevenue: 0,
      continuingEducationAccounts: [],
      continuingEducationComplements: [],
      revenueIndicators: [],
      discount: 0,
      complements: [],
      generationTypes: [],
    };

    if (entry.kind === "revenue") {
      current.revenue += entry.value;
      if (isContinuingEducationRevenueAccount(entry.account)) {
        current.continuingEducationRevenue += entry.value;
        const account = entry.account?.trim();
        if (account && !current.continuingEducationAccounts.includes(account)) {
          current.continuingEducationAccounts.push(account);
        }
        const complement = entry.complement?.trim();
        if (
          complement &&
          !current.continuingEducationComplements.includes(complement)
        ) {
          current.continuingEducationComplements.push(complement);
        }
      }
      if (isExtraRevenueAccount(entry.account)) {
        current.extraRevenue += entry.value;
        const account = entry.account?.trim();
        if (account && !current.extraRevenueAccounts.includes(account)) {
          current.extraRevenueAccounts.push(account);
        }
        if (account && !current.revenueIndicators.includes(account)) {
          current.revenueIndicators.push(account);
        }
      }
      if (
        entry.account?.trim() === DIDACTIC_MATERIAL_REVENUE_ACCOUNT &&
        !current.revenueIndicators.includes("Material didático")
      ) {
        current.revenueIndicators.push("Material didático");
      }
    } else if (entry.kind === "discount") {
      current.discount += entry.value;
    } else {
      current.internalMd += entry.value;
      const account = entry.account?.trim();
      if (account && !current.internalMdAccounts.includes(account)) {
        current.internalMdAccounts.push(account);
      }
      const complement = entry.complement?.trim();
      if (complement && !current.internalMdComplements.includes(complement)) {
        current.internalMdComplements.push(complement);
      }
    }

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
    summary.internalMd = Math.abs(summary.internalMd);
    summary.continuingEducationRevenue = Math.abs(
      summary.continuingEducationRevenue,
    );
  });

  return summaries;
}

export function classifyContinuingEducationDivergence(values: {
  status: RevenueReconciliationStatus;
  revenueDifference: number;
  discountDifference: number;
  continuingEducationRevenue: number;
}): RevenueDivergenceClassification {
  const {
    status,
    revenueDifference,
    discountDifference,
    continuingEducationRevenue,
  } = values;
  const roundedAbsolute = (value: number) =>
    Math.abs(Math.round(value * 100) / 100);

  if (
    ["Conciliado", "Sem Dados"].includes(status) ||
    revenueDifference <= REVENUE_TOLERANCE ||
    roundedAbsolute(continuingEducationRevenue) <= REVENUE_TOLERANCE ||
    roundedAbsolute(discountDifference) > REVENUE_TOLERANCE
  ) {
    return "";
  }

  return Math.abs(
    roundedAbsolute(revenueDifference) -
      roundedAbsolute(continuingEducationRevenue),
  ) <= REVENUE_TOLERANCE
    ? "Mensalidade continuada"
    : "";
}

export function classifyCompany18InternalMdDivergence(values: {
  companyCode: string;
  status: RevenueReconciliationStatus;
  revenueDifference: number;
  discountDifference: number;
  internalMd: number;
}): RevenueDivergenceClassification {
  const {
    companyCode,
    status,
    revenueDifference,
    discountDifference,
    internalMd,
  } = values;
  const roundedAbsolute = (value: number) =>
    Math.abs(Math.round(value * 100) / 100);

  if (
    Number(companyCode) !== 18 ||
    ["Conciliado", "Sem Dados"].includes(status) ||
    revenueDifference >= -REVENUE_TOLERANCE ||
    roundedAbsolute(internalMd) <= REVENUE_TOLERANCE ||
    roundedAbsolute(discountDifference) > REVENUE_TOLERANCE
  ) {
    return "";
  }

  return Math.abs(
    roundedAbsolute(revenueDifference) - roundedAbsolute(internalMd),
  ) <= REVENUE_TOLERANCE
    ? "MD interno"
    : "";
}

export function classifyRevenueDivergence(values: {
  status: RevenueReconciliationStatus;
  revenueDifference: number;
  discountDifference: number;
  extraRevenue: number;
}): RevenueDivergenceClassification {
  const {
    status,
    revenueDifference,
    discountDifference,
    extraRevenue,
  } = values;
  const roundedAbsolute = (value: number) =>
    Math.abs(Math.round(value * 100) / 100);

  if (
    status !== "Divergente" ||
    roundedAbsolute(extraRevenue) <= REVENUE_TOLERANCE ||
    roundedAbsolute(discountDifference) > REVENUE_TOLERANCE
  ) {
    return "";
  }

  return Math.abs(
    roundedAbsolute(revenueDifference) - roundedAbsolute(extraRevenue),
  ) <= REVENUE_TOLERANCE
    ? "Receitas extras"
    : "";
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
