export const FISCAL_TAX_REGIMES = ["REAL_PROFIT"] as const;
export const FISCAL_PERIODICITIES = ["ANNUAL", "QUARTERLY"] as const;
export const TAX_PERIOD_TYPES = [
  "MONTHLY_ESTIMATE",
  "ANNUAL_ADJUSTMENT",
  "QUARTERLY_REAL",
] as const;
export const TAX_PERIOD_STATUSES = [
  "DRAFT",
  "CALCULATED",
  "REVIEWED",
  "CLOSED_CURRENT",
  "CLOSED_SUPERSEDED",
] as const;
export const FISCAL_SOURCE_TYPES = ["TRIAL_BALANCE"] as const;

export type FiscalTaxRegime = (typeof FISCAL_TAX_REGIMES)[number];
export type FiscalPeriodicity = (typeof FISCAL_PERIODICITIES)[number];
export type TaxPeriodType = (typeof TAX_PERIOD_TYPES)[number];
export type TaxPeriodStatus = (typeof TAX_PERIOD_STATUSES)[number];
export type FiscalSourceType = (typeof FISCAL_SOURCE_TYPES)[number];
export type FiscalSource = string;
export type FiscalSourceProvider = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type MonetaryAmount = number | string;
export type SnapshotInputValue =
  | JsonPrimitive
  | Date
  | SnapshotInputObject
  | readonly SnapshotInputValue[];
export type SnapshotInputObject = {
  readonly [key: string]: SnapshotInputValue | undefined;
};

export type FiscalYearProfile = {
  readonly id: string;
  readonly companyId: string;
  readonly fiscalYear: number;
  readonly taxRegime: FiscalTaxRegime;
  readonly periodicity: FiscalPeriodicity;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly version: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type FiscalYearProfileDraft = {
  readonly companyId: string;
  readonly fiscalYear: number;
  readonly taxRegime?: FiscalTaxRegime;
  readonly periodicity: FiscalPeriodicity;
  readonly validFrom: string;
  readonly validTo?: string | null;
  readonly version?: number;
};

export type TaxPeriod = {
  readonly id: string;
  readonly companyId: string;
  readonly fiscalYearProfileId: string | null;
  readonly fiscalYear: number;
  readonly periodCode: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly periodType: TaxPeriodType;
  readonly status: TaxPeriodStatus;
  readonly version: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type TaxPeriodDraft = {
  readonly companyId: string;
  readonly fiscalYearProfileId?: string | null;
  readonly fiscalYear: number;
  readonly periodCode: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly periodType: TaxPeriodType;
  readonly status?: TaxPeriodStatus;
  readonly version?: number;
};

export type TaxPeriodIdentity = {
  readonly fiscalYear: number;
  readonly periodCode: string;
  readonly startDate: string;
  readonly endDate: string;
};

export type SourceSnapshot = {
  readonly id: string;
  readonly companyId: string;
  readonly externalCompanyRef: string;
  readonly taxPeriodId: string;
  readonly taxPeriod: TaxPeriodIdentity;
  readonly source: FiscalSource;
  readonly sourceType: FiscalSourceType;
  readonly provider: FiscalSourceProvider;
  readonly adapterVersion: number;
  readonly contentSchemaVersion: number;
  readonly extractedAt: string;
  readonly parameters: JsonObject;
  readonly recordCount: number;
  readonly records: readonly JsonObject[];
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly balances: JsonValue;
  readonly hash: string;
  readonly snapshotVersion: number;
  readonly createdAt?: string;
};

export type SourceSnapshotDraft = {
  readonly companyId: string;
  readonly externalCompanyRef: string;
  readonly taxPeriodId: string;
  readonly taxPeriod: TaxPeriodIdentity;
  readonly source: FiscalSource;
  readonly sourceType: FiscalSourceType;
  readonly provider: FiscalSourceProvider;
  readonly adapterVersion: number;
  readonly contentSchemaVersion: number;
  readonly extractedAt: string | Date;
  readonly parameters?: SnapshotInputObject;
  readonly recordCount: number;
  readonly records: readonly SnapshotInputObject[];
  readonly totalDebit: MonetaryAmount;
  readonly totalCredit: MonetaryAmount;
  readonly balances?: SnapshotInputValue;
  readonly snapshotVersion?: number;
};