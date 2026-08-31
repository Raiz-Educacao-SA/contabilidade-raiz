import {
  FISCAL_PERIODICITIES,
  FISCAL_TAX_REGIMES,
  TAX_PERIOD_STATUSES,
  TAX_PERIOD_TYPES,
  type FiscalYearProfile,
  type FiscalYearProfileDraft,
  type TaxPeriodDraft,
} from "./types.ts";
import { assertValidVersion } from "./versioning.ts";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

export function assertFiscalYear(fiscalYear: number) {
  if (!Number.isSafeInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 9999) {
    throw new Error("Exercício fiscal inválido.");
  }
}

export function assertIsoDate(value: string, label = "data") {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new Error(`${label} deve estar no formato YYYY-MM-DD.`);
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} inválida.`);
  }
}

export function fiscalYearBounds(fiscalYear: number) {
  assertFiscalYear(fiscalYear);
  return {
    startDate: `${fiscalYear}-01-01`,
    endDate: `${fiscalYear}-12-31`,
  };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthlyEstimatePeriod(fiscalYear: number, month: number) {
  return {
    startDate: `${fiscalYear}-01-01`,
    endDate: `${fiscalYear}-${pad2(month)}-${pad2(lastDayOfMonth(fiscalYear, month))}`,
  };
}

function quarterPeriod(fiscalYear: number, quarter: number) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    startDate: `${fiscalYear}-${pad2(startMonth)}-01`,
    endDate: `${fiscalYear}-${pad2(endMonth)}-${pad2(lastDayOfMonth(fiscalYear, endMonth))}`,
  };
}

export function monthlyEstimatePeriodCode(fiscalYear: number, month: number) {
  assertFiscalYear(fiscalYear);
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new Error("Mês fiscal inválido.");
  }
  return `${fiscalYear}-M${pad2(month)}`;
}

export function annualAdjustmentPeriodCode(fiscalYear: number) {
  assertFiscalYear(fiscalYear);
  return `${fiscalYear}-ANNUAL`;
}

export function quarterlyRealPeriodCode(fiscalYear: number, quarter: number) {
  assertFiscalYear(fiscalYear);
  if (!Number.isSafeInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new Error("Trimestre fiscal inválido.");
  }
  return `${fiscalYear}-T${pad2(quarter)}`;
}

function expectedTaxPeriodRange(input: Pick<TaxPeriodDraft, "fiscalYear" | "periodCode" | "periodType">) {
  if (input.periodType === "MONTHLY_ESTIMATE") {
    const match = new RegExp(`^${input.fiscalYear}-M(0[1-9]|1[0-2])$`).exec(input.periodCode);
    if (!match) return null;
    return monthlyEstimatePeriod(input.fiscalYear, Number(match[1]));
  }

  if (input.periodType === "QUARTERLY_REAL") {
    const match = new RegExp(`^${input.fiscalYear}-T(0[1-4])$`).exec(input.periodCode);
    if (!match) return null;
    return quarterPeriod(input.fiscalYear, Number(match[1]));
  }

  if (input.periodType === "ANNUAL_ADJUSTMENT") {
    if (input.periodCode !== annualAdjustmentPeriodCode(input.fiscalYear)) return null;
    return fiscalYearBounds(input.fiscalYear);
  }

  return null;
}

function assertTaxPeriodMatchesSemanticRange(
  input: Pick<TaxPeriodDraft, "fiscalYear" | "periodCode" | "periodType" | "startDate" | "endDate">,
) {
  const expected = expectedTaxPeriodRange(input);
  if (!expected) {
    throw new Error("Código do período fiscal incompatível com o tipo do período.");
  }
  if (input.startDate !== expected.startDate || input.endDate !== expected.endDate) {
    throw new Error("Intervalo do período fiscal incompatível com o código e tipo do período.");
  }
}

export function normalizeFiscalYearProfileDraft(input: FiscalYearProfileDraft) {
  assertFiscalYear(input.fiscalYear);
  const taxRegime = input.taxRegime ?? "REAL_PROFIT";
  const validTo = input.validTo ?? null;
  const version = input.version ?? 1;
  assertValidVersion(version);
  assertIsoDate(input.validFrom, "vigência inicial");
  if (validTo !== null) assertIsoDate(validTo, "vigência final");
  if (!input.companyId.trim()) {
    throw new Error("Empresa é obrigatória.");
  }
  if (!isOneOf(taxRegime, FISCAL_TAX_REGIMES)) {
    throw new Error("Regime fiscal inválido para esta fundação.");
  }
  if (!isOneOf(input.periodicity, FISCAL_PERIODICITIES)) {
    throw new Error("Periodicidade fiscal inválida.");
  }
  if (validTo !== null && input.validFrom > validTo) {
    throw new Error("Vigência fiscal inválida.");
  }
  return {
    companyId: input.companyId.trim(),
    fiscalYear: input.fiscalYear,
    taxRegime,
    periodicity: input.periodicity,
    validFrom: input.validFrom,
    validTo,
    version,
  } satisfies Required<Omit<FiscalYearProfileDraft, "validTo">> & {
    readonly validTo: string | null;
  };
}

export function normalizeTaxPeriodDraft(input: TaxPeriodDraft) {
  assertFiscalYear(input.fiscalYear);
  assertIsoDate(input.startDate, "data inicial");
  assertIsoDate(input.endDate, "data final");
  const status = input.status ?? "DRAFT";
  const version = input.version ?? 1;
  assertValidVersion(version);
  const companyId = input.companyId.trim();
  const periodCode = input.periodCode.trim();
  if (!companyId) {
    throw new Error("Empresa é obrigatória.");
  }
  if (!periodCode) {
    throw new Error("Código do período é obrigatório.");
  }
  if (!isOneOf(input.periodType, TAX_PERIOD_TYPES)) {
    throw new Error("Tipo do período fiscal inválido.");
  }
  if (!isOneOf(status, TAX_PERIOD_STATUSES)) {
    throw new Error("Status do período fiscal inválido.");
  }
  if (input.startDate > input.endDate) {
    throw new Error("Intervalo do período fiscal inválido.");
  }
  assertTaxPeriodMatchesSemanticRange({
    fiscalYear: input.fiscalYear,
    periodCode,
    startDate: input.startDate,
    endDate: input.endDate,
    periodType: input.periodType,
  });
  return {
    companyId,
    fiscalYearProfileId: input.fiscalYearProfileId ?? null,
    fiscalYear: input.fiscalYear,
    periodCode,
    startDate: input.startDate,
    endDate: input.endDate,
    periodType: input.periodType,
    status,
    version,
  } satisfies Required<TaxPeriodDraft> & {
    readonly fiscalYearProfileId: string | null;
  };
}

export function buildTaxPeriodsForProfile(
  profile: FiscalYearProfile | FiscalYearProfileDraft,
): TaxPeriodDraft[] {
  const normalized = normalizeFiscalYearProfileDraft(profile);
  const fiscalYearProfileId =
    "id" in profile && typeof profile.id === "string" ? profile.id : null;
  const base: Pick<
    TaxPeriodDraft,
    "companyId" | "fiscalYearProfileId" | "fiscalYear" | "status" | "version"
  > = {
    companyId: normalized.companyId,
    fiscalYearProfileId,
    fiscalYear: normalized.fiscalYear,
    status: "DRAFT",
    version: normalized.version,
  };

  if (normalized.periodicity === "QUARTERLY") {
    return [1, 2, 3, 4].map<TaxPeriodDraft>((quarter) => ({
      ...base,
      ...quarterPeriod(normalized.fiscalYear, quarter),
      periodCode: quarterlyRealPeriodCode(normalized.fiscalYear, quarter),
      periodType: "QUARTERLY_REAL",
    }));
  }

  const monthlyPeriods = Array.from({ length: 12 }, (_, index): TaxPeriodDraft => {
    const month = index + 1;
    return {
      ...base,
      ...monthlyEstimatePeriod(normalized.fiscalYear, month),
      periodCode: monthlyEstimatePeriodCode(normalized.fiscalYear, month),
      periodType: "MONTHLY_ESTIMATE",
    };
  });
  const bounds = fiscalYearBounds(normalized.fiscalYear);
  return [
    ...monthlyPeriods,
    {
      ...base,
      ...bounds,
      periodCode: annualAdjustmentPeriodCode(normalized.fiscalYear),
      periodType: "ANNUAL_ADJUSTMENT",
    },
  ];
}

export function coversDate(period: Pick<TaxPeriodDraft, "startDate" | "endDate">, date: string) {
  assertIsoDate(date);
  return period.startDate <= date && date <= period.endDate;
}