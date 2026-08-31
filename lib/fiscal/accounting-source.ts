import { assertFiscalYear, assertIsoDate } from "./periods.ts";
import { canonicalJson, normalizeMoney } from "./source-snapshot.ts";
import type {
  FiscalSource,
  FiscalSourceProvider,
  FiscalSourceType,
  JsonObject,
  MonetaryAmount,
  SnapshotInputObject,
  TaxPeriod,
  TaxPeriodIdentity,
} from "./types.ts";
import { FISCAL_SOURCE_TYPES } from "./types.ts";
import { assertValidVersion } from "./versioning.ts";

export const TRIAL_BALANCE_SOURCE_TYPE = "TRIAL_BALANCE" satisfies FiscalSourceType;
export const TRIAL_BALANCE_CONTENT_SCHEMA_VERSION = 1;

export type AccountingSourceRequest = {
  readonly companyId: string;
  readonly externalCompanyRef: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly accountFilter?: string;
  readonly includeClosingEntries: boolean;
  readonly parameters?: SnapshotInputObject;
};

export type AccountingSourceRequestFromTaxPeriodInput = {
  readonly companyId: string;
  readonly externalCompanyRef: string;
  readonly accountFilter?: string;
  readonly includeClosingEntries?: boolean;
  readonly parameters?: SnapshotInputObject;
};

export type AccountingTaxPeriod = Pick<
  TaxPeriod,
  "fiscalYear" | "periodCode" | "startDate" | "endDate" | "periodType"
>;

export type AccountingTrialBalanceInputRecord = {
  readonly accountCode?: string | number | null;
  readonly reducedCode?: string | number | null;
  readonly description?: string | null;
  readonly openingBalance?: MonetaryAmount | null;
  readonly debit?: MonetaryAmount | null;
  readonly credit?: MonetaryAmount | null;
  readonly movement?: MonetaryAmount | null;
  readonly closingBalance?: MonetaryAmount | null;
};

export type AccountingTrialBalanceRecord = {
  readonly accountCode: string;
  readonly reducedCode: string;
  readonly description: string;
  readonly openingBalance: string;
  readonly debit: string;
  readonly credit: string;
  readonly movement: string;
  readonly closingBalance: string;
};

export type AccountingSourceResult = {
  readonly source: FiscalSource;
  readonly sourceType: FiscalSourceType;
  readonly provider: FiscalSourceProvider;
  readonly adapterVersion: number;
  readonly contentSchemaVersion: number;
  readonly parameters: SnapshotInputObject;
  readonly records: readonly AccountingTrialBalanceInputRecord[];
};

export type NormalizedAccountingSourceResult = {
  readonly source: FiscalSource;
  readonly sourceType: FiscalSourceType;
  readonly provider: FiscalSourceProvider;
  readonly adapterVersion: number;
  readonly contentSchemaVersion: number;
  readonly parameters: JsonObject;
  readonly records: readonly AccountingTrialBalanceRecord[];
  readonly recordCount: number;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly balances: {
    readonly openingBalance: string;
    readonly movement: string;
    readonly closingBalance: string;
  };
};

export type AccountingSource = {
  readonly source: FiscalSource;
  readonly sourceType: FiscalSourceType;
  readonly provider: FiscalSourceProvider;
  readonly adapterVersion: number;
  readonly contentSchemaVersion: number;
  fetchTrialBalance(request: AccountingSourceRequest): Promise<AccountingSourceResult>;
};

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

function trimRequired(value: unknown, label: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function optionalTrimmed(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function assertDateRange(startDate: string, endDate: string) {
  assertIsoDate(startDate, "data inicial contábil");
  assertIsoDate(endDate, "data final contábil");
  if (startDate > endDate) throw new Error("Intervalo contábil inválido.");
}

export function taxPeriodIdentityFromTaxPeriod(period: AccountingTaxPeriod): TaxPeriodIdentity {
  assertFiscalYear(period.fiscalYear);
  const periodCode = trimRequired(period.periodCode, "Código do período fiscal");
  assertDateRange(period.startDate, period.endDate);
  return {
    fiscalYear: period.fiscalYear,
    periodCode,
    startDate: period.startDate,
    endDate: period.endDate,
  };
}

export function normalizeAccountingSourceRequest(
  request: AccountingSourceRequest,
): AccountingSourceRequest {
  const companyId = trimRequired(request.companyId, "Empresa");
  const externalCompanyRef = trimRequired(
    request.externalCompanyRef,
    "Identificação externa da empresa",
  );
  if (typeof request.includeClosingEntries !== "boolean") {
    throw new Error("Inclusão de lançamentos de fechamento deve ser booleana.");
  }
  assertDateRange(request.startDate, request.endDate);
  const accountFilter = optionalTrimmed(request.accountFilter);
  return {
    companyId,
    externalCompanyRef,
    startDate: request.startDate,
    endDate: request.endDate,
    ...(accountFilter === undefined ? {} : { accountFilter }),
    includeClosingEntries: request.includeClosingEntries,
    parameters: request.parameters ?? {},
  };
}

function includeClosingEntriesForTaxPeriod(
  taxPeriod: AccountingTaxPeriod,
  includeClosingEntries: boolean | undefined,
) {
  if (includeClosingEntries !== undefined) return includeClosingEntries;
  if (taxPeriod.periodType === "MONTHLY_ESTIMATE") return false;
  throw new Error("Inclusão de lançamentos de fechamento deve ser configurada para este período fiscal.");
}

export function accountingSourceRequestFromTaxPeriod(
  taxPeriod: AccountingTaxPeriod,
  input: AccountingSourceRequestFromTaxPeriodInput,
): AccountingSourceRequest {
  taxPeriodIdentityFromTaxPeriod(taxPeriod);
  return normalizeAccountingSourceRequest({
    companyId: input.companyId,
    externalCompanyRef: input.externalCompanyRef,
    startDate: taxPeriod.startDate,
    endDate: taxPeriod.endDate,
    accountFilter: input.accountFilter,
    includeClosingEntries: includeClosingEntriesForTaxPeriod(taxPeriod, input.includeClosingEntries),
    parameters: input.parameters,
  });
}

function normalizeAccountingMoney(value: MonetaryAmount | null | undefined, label: string) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error(`${label} é obrigatório.`);
  }
  return normalizeMoney(value);
}

function normalizeNonNegativeAccountingMoney(
  value: MonetaryAmount | null | undefined,
  label: string,
) {
  const normalized = normalizeAccountingMoney(value, label);
  if (normalized.startsWith("-")) throw new Error(`${label} não pode ser negativo.`);
  return normalized;
}

function centsFromNormalizedMoney(value: string) {
  const sign = value.startsWith("-") ? -1n : 1n;
  const unsigned = sign < 0n ? value.slice(1) : value;
  const [integer, fraction] = unsigned.split(".");
  return sign * (BigInt(integer) * 100n + BigInt(fraction));
}

function moneyFromCents(cents: bigint) {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  const integer = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${sign}${integer}.${fraction}`;
}

function sumMoney(values: readonly string[]) {
  return moneyFromCents(values.reduce((total, value) => total + centsFromNormalizedMoney(value), 0n));
}

export function normalizeTrialBalanceRecord(
  record: AccountingTrialBalanceInputRecord,
): AccountingTrialBalanceRecord {
  return {
    accountCode: trimRequired(record.accountCode, "Código da conta contábil"),
    reducedCode: String(record.reducedCode ?? "").trim(),
    description: String(record.description ?? "").trim(),
    openingBalance: normalizeAccountingMoney(record.openingBalance, "Saldo inicial"),
    debit: normalizeNonNegativeAccountingMoney(record.debit, "Débito"),
    credit: normalizeNonNegativeAccountingMoney(record.credit, "Crédito"),
    movement: normalizeAccountingMoney(record.movement, "Movimento"),
    closingBalance: normalizeAccountingMoney(record.closingBalance, "Saldo final"),
  };
}

function compareTrialBalanceRecords(
  left: AccountingTrialBalanceRecord,
  right: AccountingTrialBalanceRecord,
) {
  return (
    left.accountCode.localeCompare(right.accountCode, "pt-BR", { numeric: true }) ||
    left.reducedCode.localeCompare(right.reducedCode, "pt-BR", { numeric: true }) ||
    left.description.localeCompare(right.description, "pt-BR", { numeric: true }) ||
    canonicalJson(left).localeCompare(canonicalJson(right))
  );
}

export function normalizeAccountingSourceResult(
  result: AccountingSourceResult,
): NormalizedAccountingSourceResult {
  const source = trimRequired(result.source, "Fonte contábil");
  const provider = trimRequired(result.provider, "Provedor contábil");
  if (!isOneOf(result.sourceType, FISCAL_SOURCE_TYPES)) {
    throw new Error("Tipo de fonte contábil inválido.");
  }
  assertValidVersion(result.adapterVersion, "versão do adapter contábil");
  assertValidVersion(result.contentSchemaVersion, "versão do contrato de balancete");
  const records = result.records
    .map(normalizeTrialBalanceRecord)
    .sort(compareTrialBalanceRecords);
  const totalDebit = sumMoney(records.map((record) => record.debit));
  const totalCredit = sumMoney(records.map((record) => record.credit));
  return {
    source,
    sourceType: result.sourceType,
    provider,
    adapterVersion: result.adapterVersion,
    contentSchemaVersion: result.contentSchemaVersion,
    parameters: JSON.parse(canonicalJson(result.parameters)) as JsonObject,
    records,
    recordCount: records.length,
    totalDebit,
    totalCredit,
    balances: {
      openingBalance: sumMoney(records.map((record) => record.openingBalance)),
      movement: sumMoney(records.map((record) => record.movement)),
      closingBalance: sumMoney(records.map((record) => record.closingBalance)),
    },
  };
}