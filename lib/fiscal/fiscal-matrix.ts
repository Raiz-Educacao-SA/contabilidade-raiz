import { createHash } from "node:crypto";
import { assertFiscalYear, assertIsoDate } from "./periods.ts";
import { canonicalJson, normalizeMoney } from "./source-snapshot.ts";
import type {
  JsonObject,
  JsonValue,
  SourceSnapshot,
  SnapshotInputObject,
  TaxPeriod,
  TaxPeriodIdentity,
} from "./types.ts";
import { FISCAL_SOURCE_TYPES } from "./types.ts";
import { assertValidVersion } from "./versioning.ts";

export const FISCAL_TREATMENTS = [
  "NO_ADJUSTMENT",
  "ADDITION",
  "EXCLUSION",
  "CONDITIONAL",
  "AUTOMATIC_SPECIAL",
] as const;
export const FISCAL_RULE_EXECUTION_METHODS = [
  "FULL_ACCOUNT",
  "TRANSACTION_FILTER",
  "BALANCE_FORMULA",
  "EXTERNAL_SOURCE",
  "MANUAL_EXCEPTION",
] as const;
export const FISCAL_AUTOMATION_LEVELS = ["AUTOMATIC", "SEMI_AUTOMATIC", "MANUAL"] as const;
export const FISCAL_RULE_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED"] as const;
export const FISCAL_AMOUNT_BASES = ["NET_DEBIT_MOVEMENT", "NET_CREDIT_MOVEMENT"] as const;
export const RULE_EXECUTION_RESULT_STATUSES = [
  "EXECUTED",
  "REQUIRES_REVIEW",
  "SKIPPED",
] as const;
export const TAXES = ["IRPJ", "CSLL"] as const;
export const TAX_ADJUSTMENT_TYPES = ["ADDITION", "EXCLUSION"] as const;
export const TAX_ADJUSTMENT_ORIGINS = ["RULE_EXECUTION_RESULT"] as const;
export const TAX_ADJUSTMENT_STATUSES = ["DRAFT", "READY", "SUPERSEDED"] as const;
export const PENDING_ITEM_TYPES = [
  "NEW_ACCOUNT_UNMAPPED",
  "NEW_ACCOUNT_AUTO_CLASSIFIED",
  "CONDITIONAL_TAX_DECISION",
] as const;
export const PENDING_ITEM_STATUSES = ["OPEN", "RESOLVED", "DISMISSED"] as const;

export type FiscalTreatment = (typeof FISCAL_TREATMENTS)[number];
export type FiscalRuleExecutionMethod = (typeof FISCAL_RULE_EXECUTION_METHODS)[number];
export type FiscalAutomationLevel = (typeof FISCAL_AUTOMATION_LEVELS)[number];
export type FiscalRuleStatus = (typeof FISCAL_RULE_STATUSES)[number];
export type FiscalAmountBasis = (typeof FISCAL_AMOUNT_BASES)[number];
export type RuleExecutionResultStatus = (typeof RULE_EXECUTION_RESULT_STATUSES)[number];
export type FiscalTax = (typeof TAXES)[number];
export type TaxAdjustmentType = (typeof TAX_ADJUSTMENT_TYPES)[number];
export type TaxAdjustmentOrigin = (typeof TAX_ADJUSTMENT_ORIGINS)[number];
export type TaxAdjustmentStatus = (typeof TAX_ADJUSTMENT_STATUSES)[number];
export type PendingItemType = (typeof PENDING_ITEM_TYPES)[number];
export type PendingItemStatus = (typeof PENDING_ITEM_STATUSES)[number];

export type AccountingChart = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
  readonly version: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type CompanyAccountingChart = {
  readonly id: string;
  readonly companyId: string;
  readonly accountingChartId: string;
  readonly fiscalYear: number | null;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly version: number;
  readonly active: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type FiscalNature = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly sourceMetadata?: JsonObject;
  readonly active: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type AccountFiscalMapping = {
  readonly id: string;
  readonly accountingChartId: string;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly fiscalNatureId: string;
  readonly sourceMetadata?: JsonObject;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly version: number;
  readonly active: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type CompanyAccountMappingOverride = {
  readonly id: string;
  readonly companyId: string;
  readonly accountingChartId: string;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly fiscalNatureId: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly version: number;
  readonly active: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type FiscalRule = {
  readonly id: string;
  readonly ruleCode: string;
  readonly fiscalNatureId: string;
  readonly irpjTreatment: FiscalTreatment;
  readonly csllTreatment: FiscalTreatment;
  readonly executionMethod: FiscalRuleExecutionMethod;
  readonly automationLevel: FiscalAutomationLevel;
  readonly criteria: JsonObject;
  readonly sourceMetadata?: JsonObject;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly version: number;
  readonly status: FiscalRuleStatus;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type CompanyRuleOverride = {
  readonly id: string;
  readonly companyId: string;
  readonly fiscalNatureId: string;
  readonly irpjTreatment?: FiscalTreatment | null;
  readonly csllTreatment?: FiscalTreatment | null;
  readonly executionMethod?: FiscalRuleExecutionMethod | null;
  readonly automationLevel?: FiscalAutomationLevel | null;
  readonly criteria?: JsonObject | null;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly version: number;
  readonly status: FiscalRuleStatus;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type RuleExecutionResult = {
  readonly id: string;
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly sourceSnapshotId: string;
  readonly accountingChartId: string;
  readonly companyAccountingChartId: string;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly accountDescription: string;
  readonly fiscalNatureId: string;
  readonly accountFiscalMappingId: string;
  readonly accountFiscalMappingVersion: number;
  readonly companyAccountMappingOverrideId: string | null;
  readonly companyAccountMappingOverrideVersion: number | null;
  readonly fiscalRuleId: string;
  readonly fiscalRuleVersion: number;
  readonly companyRuleOverrideId: string | null;
  readonly companyRuleOverrideVersion: number | null;
  readonly executionMethod: FiscalRuleExecutionMethod;
  readonly automationLevel: FiscalAutomationLevel;
  readonly amountBasis: FiscalAmountBasis | null;
  readonly rawAccountingValue: string;
  readonly calculatedValue: string;
  readonly status: RuleExecutionResultStatus;
  readonly executionMetadata: JsonObject;
  readonly logicalKey: string;
  readonly createdAt: string;
};

export type TaxAdjustment = {
  readonly id: string;
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly sourceSnapshotId: string;
  readonly ruleExecutionResultId: string;
  readonly tax: FiscalTax;
  readonly adjustmentType: TaxAdjustmentType;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly fiscalNatureId: string;
  readonly fiscalRuleId: string;
  readonly fiscalRuleVersion: number;
  readonly value: string;
  readonly origin: TaxAdjustmentOrigin;
  readonly status: TaxAdjustmentStatus;
  readonly logicalKey: string;
  readonly createdAt: string;
};

export type PendingItem = {
  readonly id: string;
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly sourceSnapshotId: string;
  readonly type: PendingItemType;
  readonly status: PendingItemStatus;
  readonly blocking: boolean;
  readonly logicalKey: string;
  readonly description: string;
  readonly originData: JsonObject;
  readonly createdAt?: string;
  readonly createdBy?: string | null;
  readonly resolvedAt?: string | null;
  readonly resolvedBy?: string | null;
  readonly resolutionNote?: string | null;
};

export type PendingItemDraft = Omit<
  PendingItem,
  "createdAt" | "createdBy" | "id" | "resolvedAt" | "resolvedBy" | "resolutionNote"
>;

export type FiscalRuleResolution = {
  readonly accountingChart: AccountingChart;
  readonly companyAccountingChart: CompanyAccountingChart;
  readonly mapping: AccountFiscalMapping;
  readonly mappingOverride: CompanyAccountMappingOverride | null;
  readonly fiscalNature: FiscalNature;
  readonly baseRule: FiscalRule;
  readonly baseRuleVersion: number;
  readonly companyRuleOverride: CompanyRuleOverride | null;
  readonly override: CompanyRuleOverride | null;
  readonly effective: {
    readonly irpjTreatment: FiscalTreatment;
    readonly csllTreatment: FiscalTreatment;
    readonly executionMethod: FiscalRuleExecutionMethod;
    readonly automationLevel: FiscalAutomationLevel;
    readonly criteria: JsonObject;
  };
};

export type ResolutionTaxPeriod = Pick<TaxPeriod, "fiscalYear" | "startDate" | "endDate"> | TaxPeriodIdentity;

export type ResolveFiscalRuleForAccountInput = {
  readonly companyId: string;
  readonly accountCode: string;
  readonly reducedCode?: string | null;
  readonly taxPeriod: ResolutionTaxPeriod;
  readonly accountingCharts: readonly AccountingChart[];
  readonly companyAccountingCharts: readonly CompanyAccountingChart[];
  readonly mappings: readonly AccountFiscalMapping[];
  readonly companyAccountMappingOverrides?: readonly CompanyAccountMappingOverride[];
  readonly fiscalNatures: readonly FiscalNature[];
  readonly fiscalRules: readonly FiscalRule[];
  readonly companyRuleOverrides?: readonly CompanyRuleOverride[];
  readonly resolveDate?: string;
};

export type DetectNewAccountPendingItemsInput = {
  readonly companyId: string;
  readonly taxPeriod: Pick<
    TaxPeriod,
    "id" | "companyId" | "fiscalYear" | "periodCode" | "startDate" | "endDate"
  >;
  readonly sourceSnapshot: SourceSnapshot;
  readonly accountingCharts: readonly AccountingChart[];
  readonly companyAccountingCharts: readonly CompanyAccountingChart[];
  readonly mappings: readonly AccountFiscalMapping[];
  readonly existingPendingItems?: readonly Pick<PendingItem, "logicalKey">[];
};

export type ExecuteFullAccountInput = {
  readonly companyId: string;
  readonly taxPeriod: Pick<
    TaxPeriod,
    "id" | "companyId" | "fiscalYear" | "periodCode" | "startDate" | "endDate"
  >;
  readonly sourceSnapshot: SourceSnapshot;
  readonly accountCode: string;
  readonly reducedCode?: string | null;
  readonly accountingCharts: readonly AccountingChart[];
  readonly companyAccountingCharts: readonly CompanyAccountingChart[];
  readonly mappings: readonly AccountFiscalMapping[];
  readonly companyAccountMappingOverrides?: readonly CompanyAccountMappingOverride[];
  readonly fiscalNatures: readonly FiscalNature[];
  readonly fiscalRules: readonly FiscalRule[];
  readonly companyRuleOverrides?: readonly CompanyRuleOverride[];
  readonly existingTaxAdjustments?: readonly Pick<TaxAdjustment, "id" | "logicalKey">[];
  readonly createdAt?: string | Date;
};

export type FullAccountExecution = {
  readonly resolution: FiscalRuleResolution | null;
  readonly ruleExecutionResult: RuleExecutionResult | null;
  readonly taxAdjustments: readonly TaxAdjustment[];
};

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

function trimRequired(value: unknown, label: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function optionalTrimmed(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function assertValidity(validFrom: string, validTo: string | null) {
  assertIsoDate(validFrom, "vigência inicial");
  if (validTo !== null) assertIsoDate(validTo, "vigência final");
  if (validTo !== null && validFrom > validTo) throw new Error("Vigência inválida.");
}

function assertAllowed<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!isOneOf(value, allowed)) throw new Error(`${label} inválido.`);
  return value;
}

function optionalAllowed<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  label: string,
): T | null {
  if (value === null || value === undefined) return null;
  return assertAllowed(value, allowed, label);
}

function normalizeCriteria(criteria: JsonObject | undefined): JsonObject {
  return JSON.parse(canonicalJson(criteria ?? {})) as JsonObject;
}

function activeOnDate(item: { readonly validFrom: string; readonly validTo: string | null }, date: string) {
  return item.validFrom <= date && (item.validTo === null || date <= item.validTo);
}

function sortVersioned<T extends { readonly id: string; readonly validFrom: string; readonly version: number }>(
  items: readonly T[],
) {
  return [...items].sort(
    (left, right) =>
      right.version - left.version ||
      right.validFrom.localeCompare(left.validFrom) ||
      left.id.localeCompare(right.id),
  );
}

function resolutionDateForPeriod(taxPeriod: ResolutionTaxPeriod) {
  assertFiscalYear(taxPeriod.fiscalYear);
  assertIsoDate(taxPeriod.startDate, "data inicial do período fiscal");
  assertIsoDate(taxPeriod.endDate, "data final do período fiscal");
  if (taxPeriod.startDate > taxPeriod.endDate) throw new Error("Período fiscal inválido.");
  return taxPeriod.endDate;
}

function normalizeCreatedAt(value: string | Date | undefined) {
  const parsed = value instanceof Date || value !== undefined ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) throw new Error("Data de criação fiscal inválida.");
  return parsed.toISOString();
}

export function normalizeAccountingChart(chart: AccountingChart): AccountingChart {
  assertValidVersion(chart.version, "versão do plano de contas");
  return {
    ...chart,
    id: trimRequired(chart.id, "Plano de contas"),
    code: trimRequired(chart.code, "Código do plano de contas"),
    name: trimRequired(chart.name, "Nome do plano de contas"),
    description: String(chart.description ?? "").trim(),
    active: Boolean(chart.active),
  };
}

export function normalizeCompanyAccountingChart(
  companyChart: CompanyAccountingChart,
): CompanyAccountingChart {
  assertValidity(companyChart.validFrom, companyChart.validTo);
  assertValidVersion(companyChart.version, "versão do vínculo empresa/plano de contas");
  if (companyChart.fiscalYear !== null) assertFiscalYear(companyChart.fiscalYear);
  return {
    ...companyChart,
    id: trimRequired(companyChart.id, "Vínculo empresa/plano de contas"),
    companyId: trimRequired(companyChart.companyId, "Empresa"),
    accountingChartId: trimRequired(companyChart.accountingChartId, "Plano de contas"),
    fiscalYear: companyChart.fiscalYear,
    active: Boolean(companyChart.active),
  };
}

export function normalizeFiscalNature(nature: FiscalNature): FiscalNature {
  return {
    ...nature,
    id: trimRequired(nature.id, "Natureza fiscal"),
    code: trimRequired(nature.code, "Código da natureza fiscal"),
    name: trimRequired(nature.name, "Nome da natureza fiscal"),
    description: String(nature.description ?? "").trim(),
    active: Boolean(nature.active),
  };
}

export function normalizeAccountFiscalMapping(mapping: AccountFiscalMapping): AccountFiscalMapping {
  assertValidity(mapping.validFrom, mapping.validTo);
  assertValidVersion(mapping.version, "versão do mapeamento fiscal");
  return {
    ...mapping,
    id: trimRequired(mapping.id, "Mapeamento fiscal"),
    accountingChartId: trimRequired(mapping.accountingChartId, "Plano de contas"),
    accountCode: trimRequired(mapping.accountCode, "Conta contábil"),
    reducedCode: optionalTrimmed(mapping.reducedCode),
    fiscalNatureId: trimRequired(mapping.fiscalNatureId, "Natureza fiscal"),
    active: Boolean(mapping.active),
  };
}

export function normalizeCompanyAccountMappingOverride(
  override: CompanyAccountMappingOverride,
): CompanyAccountMappingOverride {
  assertValidity(override.validFrom, override.validTo);
  assertValidVersion(override.version, "versão do override de mapeamento fiscal");
  return {
    ...override,
    id: trimRequired(override.id, "Override de mapeamento fiscal"),
    companyId: trimRequired(override.companyId, "Empresa"),
    accountingChartId: trimRequired(override.accountingChartId, "Plano de contas"),
    accountCode: trimRequired(override.accountCode, "Conta contábil"),
    reducedCode: optionalTrimmed(override.reducedCode),
    fiscalNatureId: trimRequired(override.fiscalNatureId, "Natureza fiscal"),
    active: Boolean(override.active),
  };
}

export function normalizeFiscalRule(rule: FiscalRule): FiscalRule {
  assertValidity(rule.validFrom, rule.validTo);
  assertValidVersion(rule.version, "versão da regra fiscal");
  return {
    ...rule,
    id: trimRequired(rule.id, "Regra fiscal"),
    ruleCode: trimRequired(rule.ruleCode, "Código da regra fiscal"),
    fiscalNatureId: trimRequired(rule.fiscalNatureId, "Natureza fiscal"),
    irpjTreatment: assertAllowed(rule.irpjTreatment, FISCAL_TREATMENTS, "Tratamento IRPJ"),
    csllTreatment: assertAllowed(rule.csllTreatment, FISCAL_TREATMENTS, "Tratamento CSLL"),
    executionMethod: assertAllowed(rule.executionMethod, FISCAL_RULE_EXECUTION_METHODS, "Método de execução"),
    automationLevel: assertAllowed(rule.automationLevel, FISCAL_AUTOMATION_LEVELS, "Nível de automação"),
    criteria: normalizeCriteria(rule.criteria),
    status: assertAllowed(rule.status, FISCAL_RULE_STATUSES, "Status da regra fiscal"),
  };
}

export function normalizeCompanyRuleOverride(override: CompanyRuleOverride): CompanyRuleOverride {
  assertValidity(override.validFrom, override.validTo);
  assertValidVersion(override.version, "versão do override fiscal");
  return {
    ...override,
    id: trimRequired(override.id, "Override de regra fiscal"),
    companyId: trimRequired(override.companyId, "Empresa"),
    fiscalNatureId: trimRequired(override.fiscalNatureId, "Natureza fiscal"),
    irpjTreatment: optionalAllowed(override.irpjTreatment, FISCAL_TREATMENTS, "Tratamento IRPJ"),
    csllTreatment: optionalAllowed(override.csllTreatment, FISCAL_TREATMENTS, "Tratamento CSLL"),
    executionMethod: optionalAllowed(
      override.executionMethod,
      FISCAL_RULE_EXECUTION_METHODS,
      "Método de execução",
    ),
    automationLevel: optionalAllowed(
      override.automationLevel,
      FISCAL_AUTOMATION_LEVELS,
      "Nível de automação",
    ),
    criteria:
      override.criteria === undefined || override.criteria === null
        ? null
        : normalizeCriteria(override.criteria),
    status: assertAllowed(override.status, FISCAL_RULE_STATUSES, "Status do override fiscal"),
  };
}

export function findCompanyAccountingChart(input: {
  readonly companyId: string;
  readonly fiscalYear: number;
  readonly date: string;
  readonly companyAccountingCharts: readonly CompanyAccountingChart[];
}) {
  const companyId = trimRequired(input.companyId, "Empresa");
  assertFiscalYear(input.fiscalYear);
  assertIsoDate(input.date, "data de resolução");
  const matching = input.companyAccountingCharts
    .map(normalizeCompanyAccountingChart)
    .filter(
      (companyChart) =>
        companyChart.active &&
        companyChart.companyId === companyId &&
        activeOnDate(companyChart, input.date) &&
        (companyChart.fiscalYear === null || companyChart.fiscalYear === input.fiscalYear),
    )
    .sort((left, right) => {
      const leftExact = left.fiscalYear === input.fiscalYear ? 1 : 0;
      const rightExact = right.fiscalYear === input.fiscalYear ? 1 : 0;
      return (
        rightExact - leftExact ||
        right.version - left.version ||
        right.validFrom.localeCompare(left.validFrom) ||
        left.id.localeCompare(right.id)
      );
    });
  return matching[0] ?? null;
}

export function findAccountFiscalMapping(input: {
  readonly accountingChartId: string;
  readonly accountCode: string;
  readonly reducedCode?: string | null;
  readonly date: string;
  readonly mappings: readonly AccountFiscalMapping[];
}) {
  const accountingChartId = trimRequired(input.accountingChartId, "Plano de contas");
  const accountCode = trimRequired(input.accountCode, "Conta contábil");
  const reducedCode = optionalTrimmed(input.reducedCode);
  assertIsoDate(input.date, "data de resolução");
  const matching = input.mappings
    .map(normalizeAccountFiscalMapping)
    .filter(
      (mapping) =>
        mapping.active &&
        mapping.accountingChartId === accountingChartId &&
        mapping.accountCode === accountCode &&
        activeOnDate(mapping, input.date) &&
        (mapping.reducedCode === null || mapping.reducedCode === reducedCode),
    )
    .sort((left, right) => {
      const leftExact = left.reducedCode !== null && left.reducedCode === reducedCode ? 1 : 0;
      const rightExact = right.reducedCode !== null && right.reducedCode === reducedCode ? 1 : 0;
      return (
        rightExact - leftExact ||
        right.version - left.version ||
        right.validFrom.localeCompare(left.validFrom) ||
        left.id.localeCompare(right.id)
      );
    });
  return matching[0] ?? null;
}

export function findCompanyAccountMappingOverride(input: {
  readonly companyId: string;
  readonly accountingChartId: string;
  readonly accountCode: string;
  readonly reducedCode?: string | null;
  readonly date: string;
  readonly overrides: readonly CompanyAccountMappingOverride[];
}) {
  const companyId = trimRequired(input.companyId, "Empresa");
  const accountingChartId = trimRequired(input.accountingChartId, "Plano de contas");
  const accountCode = trimRequired(input.accountCode, "Conta contábil");
  const reducedCode = optionalTrimmed(input.reducedCode);
  assertIsoDate(input.date, "data de resolução");
  const matching = input.overrides
    .map(normalizeCompanyAccountMappingOverride)
    .filter(
      (override) =>
        override.active &&
        override.companyId === companyId &&
        override.accountingChartId === accountingChartId &&
        override.accountCode === accountCode &&
        activeOnDate(override, input.date) &&
        (override.reducedCode === null || override.reducedCode === reducedCode),
    )
    .sort((left, right) => {
      const leftExact = left.reducedCode !== null && left.reducedCode === reducedCode ? 1 : 0;
      const rightExact = right.reducedCode !== null && right.reducedCode === reducedCode ? 1 : 0;
      return (
        rightExact - leftExact ||
        right.version - left.version ||
        right.validFrom.localeCompare(left.validFrom) ||
        left.id.localeCompare(right.id)
      );
    });
  return matching[0] ?? null;
}

function latestActiveFiscalRule(
  rules: readonly FiscalRule[],
  fiscalNatureId: string,
  date: string,
) {
  return sortVersioned(
    rules
      .map(normalizeFiscalRule)
      .filter(
        (rule) =>
          rule.status === "ACTIVE" &&
          rule.fiscalNatureId === fiscalNatureId &&
          activeOnDate(rule, date),
      ),
  )[0] ?? null;
}

function latestActiveCompanyOverride(
  overrides: readonly CompanyRuleOverride[],
  companyId: string,
  fiscalNatureId: string,
  date: string,
) {
  return sortVersioned(
    overrides
      .map(normalizeCompanyRuleOverride)
      .filter(
        (override) =>
          override.status === "ACTIVE" &&
          override.companyId === companyId &&
          override.fiscalNatureId === fiscalNatureId &&
          activeOnDate(override, date),
      ),
  )[0] ?? null;
}

export function resolveFiscalRuleForAccount(
  input: ResolveFiscalRuleForAccountInput,
): FiscalRuleResolution | null {
  const companyId = trimRequired(input.companyId, "Empresa");
  const date = input.resolveDate ?? resolutionDateForPeriod(input.taxPeriod);
  assertIsoDate(date, "data de resolução");
  const companyAccountingChart = findCompanyAccountingChart({
    companyId,
    fiscalYear: input.taxPeriod.fiscalYear,
    date,
    companyAccountingCharts: input.companyAccountingCharts,
  });
  if (!companyAccountingChart) throw new Error("Plano de contas vigente não encontrado para a empresa.");

  const accountingChart = input.accountingCharts.map(normalizeAccountingChart).find(
    (chart) => chart.active && chart.id === companyAccountingChart.accountingChartId,
  );
  if (!accountingChart) throw new Error("Plano de contas ativo não encontrado.");

  const mapping = findAccountFiscalMapping({
    accountingChartId: accountingChart.id,
    accountCode: input.accountCode,
    reducedCode: input.reducedCode,
    date,
    mappings: input.mappings,
  });
  if (!mapping) return null;

  const mappingOverride = findCompanyAccountMappingOverride({
    companyId,
    accountingChartId: accountingChart.id,
    accountCode: input.accountCode,
    reducedCode: input.reducedCode,
    date,
    overrides: input.companyAccountMappingOverrides ?? [],
  });
  const fiscalNatureId = mappingOverride?.fiscalNatureId ?? mapping.fiscalNatureId;
  const fiscalNature = input.fiscalNatures.map(normalizeFiscalNature).find(
    (nature) => nature.active && nature.id === fiscalNatureId,
  );
  if (!fiscalNature) throw new Error("Natureza fiscal vigente não encontrada para a conta.");

  const baseRule = latestActiveFiscalRule(input.fiscalRules, fiscalNature.id, date);
  if (!baseRule) throw new Error("Regra fiscal padrão vigente não encontrada para a natureza.");

  const companyRuleOverride = latestActiveCompanyOverride(
    input.companyRuleOverrides ?? [],
    companyId,
    fiscalNature.id,
    date,
  );

  return {
    accountingChart,
    companyAccountingChart,
    mapping,
    mappingOverride,
    fiscalNature,
    baseRule,
    baseRuleVersion: baseRule.version,
    companyRuleOverride,
    override: companyRuleOverride,
    effective: {
      irpjTreatment: companyRuleOverride?.irpjTreatment ?? baseRule.irpjTreatment,
      csllTreatment: companyRuleOverride?.csllTreatment ?? baseRule.csllTreatment,
      executionMethod: companyRuleOverride?.executionMethod ?? baseRule.executionMethod,
      automationLevel: companyRuleOverride?.automationLevel ?? baseRule.automationLevel,
      criteria: normalizeCriteria(companyRuleOverride?.criteria ?? baseRule.criteria),
    },
  };
}

function centsFromMoney(value: string | number) {
  const normalized = normalizeMoney(value);
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsigned = sign < 0n ? normalized.slice(1) : normalized;
  const [integer, fraction] = unsigned.split(".");
  return sign * (BigInt(integer) * 100n + BigInt(fraction));
}

function centsFromSnapshotMoney(value: JsonValue | undefined, label: string) {
  if (value === undefined || value === null || value === "") return 0n;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label} inválido no snapshot.`);
  }
  return centsFromMoney(value);
}

function moneyFromCents(cents: bigint) {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  const integer = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${sign}${integer}.${fraction}`;
}

function nonZeroMoney(value: JsonValue | undefined) {
  return centsFromSnapshotMoney(value, "Valor monetário") !== 0n;
}

function snapshotRecordText(record: JsonObject, field: string) {
  const value = record[field];
  return String(value ?? "").trim();
}

export function isMovedTrialBalanceRecord(record: JsonObject) {
  return nonZeroMoney(record.debit) || nonZeroMoney(record.credit) || nonZeroMoney(record.movement);
}

function logicalKey(prefix: string, payload: SnapshotInputObject) {
  return `${prefix}:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

function deterministicUuid(payload: SnapshotInputObject) {
  const chars = createHash("sha256").update(canonicalJson(payload)).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function logicalPendingKey(payload: SnapshotInputObject) {
  return logicalKey("NEW_ACCOUNT_UNMAPPED", payload);
}

export function buildNewAccountUnmappedLogicalKey(input: {
  readonly companyId: string;
  readonly taxPeriod: Pick<TaxPeriod, "fiscalYear" | "periodCode" | "startDate" | "endDate">;
  readonly sourceSnapshot: Pick<SourceSnapshot, "hash">;
  readonly accountCode: string;
  readonly reducedCode: string | null;
}) {
  return logicalPendingKey({
    type: "NEW_ACCOUNT_UNMAPPED",
    companyId: input.companyId,
    taxPeriod: {
      fiscalYear: input.taxPeriod.fiscalYear,
      periodCode: input.taxPeriod.periodCode,
      startDate: input.taxPeriod.startDate,
      endDate: input.taxPeriod.endDate,
    },
    sourceSnapshotHash: input.sourceSnapshot.hash,
    accountCode: input.accountCode,
    reducedCode: input.reducedCode,
  });
}

function assertTrialBalanceSnapshot(snapshot: SourceSnapshot) {
  const sourceType = assertAllowed(
    snapshot.sourceType,
    FISCAL_SOURCE_TYPES,
    "Tipo de fonte do snapshot",
  );
  if (sourceType !== "TRIAL_BALANCE") {
    throw new Error("Rotina fiscal exige snapshot de balancete.");
  }
}

export function detectNewAccountPendingItems({
  companyId,
  taxPeriod,
  sourceSnapshot,
  accountingCharts,
  companyAccountingCharts,
  mappings,
  existingPendingItems = [],
}: DetectNewAccountPendingItemsInput): PendingItemDraft[] {
  const normalizedCompanyId = trimRequired(companyId, "Empresa");
  if (taxPeriod.companyId !== normalizedCompanyId || sourceSnapshot.companyId !== normalizedCompanyId) {
    throw new Error("Empresa inconsistente para detecção de contas novas.");
  }
  if (sourceSnapshot.taxPeriodId !== taxPeriod.id) {
    throw new Error("Snapshot não pertence ao período fiscal informado.");
  }
  assertTrialBalanceSnapshot(sourceSnapshot);
  const date = resolutionDateForPeriod(taxPeriod);
  const companyAccountingChart = findCompanyAccountingChart({
    companyId: normalizedCompanyId,
    fiscalYear: taxPeriod.fiscalYear,
    date,
    companyAccountingCharts,
  });
  if (!companyAccountingChart) throw new Error("Plano de contas vigente não encontrado para a empresa.");
  const accountingChart = accountingCharts.map(normalizeAccountingChart).find(
    (chart) => chart.active && chart.id === companyAccountingChart.accountingChartId,
  );
  if (!accountingChart) throw new Error("Plano de contas ativo não encontrado.");
  const seen = new Set(existingPendingItems.map((item) => item.logicalKey));
  const pendingItems: PendingItemDraft[] = [];

  for (const record of sourceSnapshot.records) {
    const accountCode = snapshotRecordText(record, "accountCode");
    if (!accountCode) throw new Error("Registro de balancete sem conta contábil.");
    if (!isMovedTrialBalanceRecord(record)) continue;
    const reducedCode = optionalTrimmed(snapshotRecordText(record, "reducedCode"));
    const mapping = findAccountFiscalMapping({
      accountingChartId: accountingChart.id,
      accountCode,
      reducedCode,
      date,
      mappings,
    });
    if (mapping) continue;

    const pendingKey = buildNewAccountUnmappedLogicalKey({
      companyId: normalizedCompanyId,
      taxPeriod,
      sourceSnapshot,
      accountCode,
      reducedCode,
    });
    if (seen.has(pendingKey)) continue;
    seen.add(pendingKey);
    pendingItems.push({
      companyId: normalizedCompanyId,
      taxPeriodId: taxPeriod.id,
      sourceSnapshotId: sourceSnapshot.id,
      type: "NEW_ACCOUNT_UNMAPPED",
      status: "OPEN",
      blocking: true,
      logicalKey: pendingKey,
      description: `Conta contábil movimentada sem mapeamento fiscal vigente: ${accountCode}.`,
      originData: {
        sourceSnapshotId: sourceSnapshot.id,
        sourceSnapshotHash: sourceSnapshot.hash,
        source: sourceSnapshot.source,
        sourceType: sourceSnapshot.sourceType,
        provider: sourceSnapshot.provider,
        externalCompanyRef: sourceSnapshot.externalCompanyRef,
        accountingChartId: accountingChart.id,
        companyAccountingChartId: companyAccountingChart.id,
        accountCode,
        reducedCode,
        description: snapshotRecordText(record, "description"),
        openingBalance: snapshotRecordText(record, "openingBalance"),
        debit: snapshotRecordText(record, "debit"),
        credit: snapshotRecordText(record, "credit"),
        movement: snapshotRecordText(record, "movement"),
        closingBalance: snapshotRecordText(record, "closingBalance"),
        period: {
          fiscalYear: taxPeriod.fiscalYear,
          periodCode: taxPeriod.periodCode,
          startDate: taxPeriod.startDate,
          endDate: taxPeriod.endDate,
        },
      },
    });
  }

  return pendingItems;
}

function accountRecordMatches(record: JsonObject, accountCode: string, reducedCode: string | null) {
  if (snapshotRecordText(record, "accountCode") !== accountCode) return false;
  if (reducedCode === null) return true;
  return optionalTrimmed(snapshotRecordText(record, "reducedCode")) === reducedCode;
}

function aggregateSnapshotAccount(
  sourceSnapshot: SourceSnapshot,
  accountCode: string,
  reducedCode: string | null,
) {
  let debit = 0n;
  let credit = 0n;
  let movement = 0n;
  let matchedRecordCount = 0;
  let accountDescription = "";

  for (const record of sourceSnapshot.records) {
    if (!accountRecordMatches(record, accountCode, reducedCode)) continue;
    matchedRecordCount += 1;
    if (!accountDescription) accountDescription = snapshotRecordText(record, "description");
    debit += centsFromSnapshotMoney(record.debit, "Débito");
    credit += centsFromSnapshotMoney(record.credit, "Crédito");
    movement += centsFromSnapshotMoney(record.movement, "Movimento");
  }

  return {
    debit,
    credit,
    movement,
    matchedRecordCount,
    accountDescription,
  };
}

function amountBasisFromCriteria(criteria: JsonObject) {
  const basis = criteria.amountBasis;
  if (typeof basis !== "string") return null;
  return isOneOf(basis, FISCAL_AMOUNT_BASES) ? basis : null;
}

function accountingValueFromBasis(input: {
  readonly amountBasis: FiscalAmountBasis;
  readonly debit: bigint;
  readonly credit: bigint;
}) {
  if (input.amountBasis === "NET_DEBIT_MOVEMENT") return input.debit - input.credit;
  return input.credit - input.debit;
}

export function buildRuleExecutionResultLogicalKey(input: {
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotHash: string;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly accountingChartId: string;
  readonly companyAccountingChartId: string;
  readonly accountFiscalMappingId: string;
  readonly accountFiscalMappingVersion: number;
  readonly companyAccountMappingOverrideId: string | null;
  readonly companyAccountMappingOverrideVersion: number | null;
  readonly fiscalRuleId: string;
  readonly fiscalRuleVersion: number;
  readonly companyRuleOverrideId: string | null;
  readonly companyRuleOverrideVersion: number | null;
}) {
  return logicalKey("RULE_EXECUTION_RESULT", {
    companyId: input.companyId,
    taxPeriodId: input.taxPeriodId,
    sourceSnapshotId: input.sourceSnapshotId,
    sourceSnapshotHash: input.sourceSnapshotHash,
    accountCode: input.accountCode,
    reducedCode: input.reducedCode,
    accountingChartId: input.accountingChartId,
    companyAccountingChartId: input.companyAccountingChartId,
    accountFiscalMappingId: input.accountFiscalMappingId,
    accountFiscalMappingVersion: input.accountFiscalMappingVersion,
    companyAccountMappingOverrideId: input.companyAccountMappingOverrideId,
    companyAccountMappingOverrideVersion: input.companyAccountMappingOverrideVersion,
    fiscalRuleId: input.fiscalRuleId,
    fiscalRuleVersion: input.fiscalRuleVersion,
    companyRuleOverrideId: input.companyRuleOverrideId,
    companyRuleOverrideVersion: input.companyRuleOverrideVersion,
  });
}

export function buildTaxAdjustmentLogicalKey(input: {
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly sourceSnapshotId: string;
  readonly ruleExecutionResultId: string;
  readonly tax: FiscalTax;
  readonly adjustmentType: TaxAdjustmentType;
  readonly fiscalRuleId: string;
  readonly fiscalRuleVersion: number;
}) {
  return logicalKey("TAX_ADJUSTMENT", {
    companyId: input.companyId,
    taxPeriodId: input.taxPeriodId,
    sourceSnapshotId: input.sourceSnapshotId,
    ruleExecutionResultId: input.ruleExecutionResultId,
    tax: input.tax,
    adjustmentType: input.adjustmentType,
    fiscalRuleId: input.fiscalRuleId,
    fiscalRuleVersion: input.fiscalRuleVersion,
  });
}

function taxAdjustmentTypeForTreatment(treatment: FiscalTreatment): TaxAdjustmentType | null {
  if (treatment === "ADDITION" || treatment === "EXCLUSION") return treatment;
  return null;
}

function buildRuleExecutionResult(input: {
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly sourceSnapshot: SourceSnapshot;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly accountDescription: string;
  readonly resolution: FiscalRuleResolution;
  readonly amountBasis: FiscalAmountBasis | null;
  readonly rawAccountingValue: bigint;
  readonly calculatedValue: bigint;
  readonly status: RuleExecutionResultStatus;
  readonly createdAt: string;
  readonly metadata: JsonObject;
}): RuleExecutionResult {
  const logicalResultKey = buildRuleExecutionResultLogicalKey({
    companyId: input.companyId,
    taxPeriodId: input.taxPeriodId,
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    accountCode: input.accountCode,
    reducedCode: input.reducedCode,
    accountingChartId: input.resolution.accountingChart.id,
    companyAccountingChartId: input.resolution.companyAccountingChart.id,
    accountFiscalMappingId: input.resolution.mapping.id,
    accountFiscalMappingVersion: input.resolution.mapping.version,
    companyAccountMappingOverrideId: input.resolution.mappingOverride?.id ?? null,
    companyAccountMappingOverrideVersion: input.resolution.mappingOverride?.version ?? null,
    fiscalRuleId: input.resolution.baseRule.id,
    fiscalRuleVersion: input.resolution.baseRule.version,
    companyRuleOverrideId: input.resolution.companyRuleOverride?.id ?? null,
    companyRuleOverrideVersion: input.resolution.companyRuleOverride?.version ?? null,
  });
  return {
    id: deterministicUuid({ type: "RULE_EXECUTION_RESULT", logicalKey: logicalResultKey }),
    companyId: input.companyId,
    taxPeriodId: input.taxPeriodId,
    sourceSnapshotId: input.sourceSnapshot.id,
    accountingChartId: input.resolution.accountingChart.id,
    companyAccountingChartId: input.resolution.companyAccountingChart.id,
    accountCode: input.accountCode,
    reducedCode: input.reducedCode,
    accountDescription: input.accountDescription,
    fiscalNatureId: input.resolution.fiscalNature.id,
    accountFiscalMappingId: input.resolution.mapping.id,
    accountFiscalMappingVersion: input.resolution.mapping.version,
    companyAccountMappingOverrideId: input.resolution.mappingOverride?.id ?? null,
    companyAccountMappingOverrideVersion: input.resolution.mappingOverride?.version ?? null,
    fiscalRuleId: input.resolution.baseRule.id,
    fiscalRuleVersion: input.resolution.baseRule.version,
    companyRuleOverrideId: input.resolution.companyRuleOverride?.id ?? null,
    companyRuleOverrideVersion: input.resolution.companyRuleOverride?.version ?? null,
    executionMethod: input.resolution.effective.executionMethod,
    automationLevel: input.resolution.effective.automationLevel,
    amountBasis: input.amountBasis,
    rawAccountingValue: moneyFromCents(input.rawAccountingValue),
    calculatedValue: moneyFromCents(input.calculatedValue),
    status: input.status,
    executionMetadata: input.metadata,
    logicalKey: logicalResultKey,
    createdAt: input.createdAt,
  };
}

function buildTaxAdjustment(input: {
  readonly result: RuleExecutionResult;
  readonly tax: FiscalTax;
  readonly adjustmentType: TaxAdjustmentType;
  readonly createdAt: string;
}) {
  const adjustmentKey = buildTaxAdjustmentLogicalKey({
    companyId: input.result.companyId,
    taxPeriodId: input.result.taxPeriodId,
    sourceSnapshotId: input.result.sourceSnapshotId,
    ruleExecutionResultId: input.result.id,
    tax: input.tax,
    adjustmentType: input.adjustmentType,
    fiscalRuleId: input.result.fiscalRuleId,
    fiscalRuleVersion: input.result.fiscalRuleVersion,
  });
  return {
    id: deterministicUuid({ type: "TAX_ADJUSTMENT", logicalKey: adjustmentKey }),
    companyId: input.result.companyId,
    taxPeriodId: input.result.taxPeriodId,
    sourceSnapshotId: input.result.sourceSnapshotId,
    ruleExecutionResultId: input.result.id,
    tax: input.tax,
    adjustmentType: input.adjustmentType,
    accountCode: input.result.accountCode,
    reducedCode: input.result.reducedCode,
    fiscalNatureId: input.result.fiscalNatureId,
    fiscalRuleId: input.result.fiscalRuleId,
    fiscalRuleVersion: input.result.fiscalRuleVersion,
    value: input.result.calculatedValue,
    origin: "RULE_EXECUTION_RESULT",
    status: "DRAFT",
    logicalKey: adjustmentKey,
    createdAt: input.createdAt,
  } satisfies TaxAdjustment;
}

export function executeFullAccount(input: ExecuteFullAccountInput): FullAccountExecution {
  const companyId = trimRequired(input.companyId, "Empresa");
  const accountCode = trimRequired(input.accountCode, "Conta contábil");
  const reducedCode = optionalTrimmed(input.reducedCode);
  if (input.taxPeriod.companyId !== companyId || input.sourceSnapshot.companyId !== companyId) {
    throw new Error("Empresa inconsistente para execução FULL_ACCOUNT.");
  }
  if (input.sourceSnapshot.taxPeriodId !== input.taxPeriod.id) {
    throw new Error("Snapshot não pertence ao período fiscal informado.");
  }
  if (
    input.sourceSnapshot.taxPeriod.fiscalYear !== input.taxPeriod.fiscalYear ||
    input.sourceSnapshot.taxPeriod.periodCode !== input.taxPeriod.periodCode ||
    input.sourceSnapshot.taxPeriod.startDate !== input.taxPeriod.startDate ||
    input.sourceSnapshot.taxPeriod.endDate !== input.taxPeriod.endDate
  ) {
    throw new Error("Identidade do período no snapshot diverge do período fiscal informado.");
  }
  assertTrialBalanceSnapshot(input.sourceSnapshot);

  const resolution = resolveFiscalRuleForAccount({
    companyId,
    accountCode,
    reducedCode,
    taxPeriod: input.taxPeriod,
    accountingCharts: input.accountingCharts,
    companyAccountingCharts: input.companyAccountingCharts,
    mappings: input.mappings,
    companyAccountMappingOverrides: input.companyAccountMappingOverrides,
    fiscalNatures: input.fiscalNatures,
    fiscalRules: input.fiscalRules,
    companyRuleOverrides: input.companyRuleOverrides,
  });
  if (!resolution) return { resolution: null, ruleExecutionResult: null, taxAdjustments: [] };

  const createdAt = normalizeCreatedAt(input.createdAt);
  const aggregate = aggregateSnapshotAccount(input.sourceSnapshot, accountCode, reducedCode);
  const amountBasis = amountBasisFromCriteria(resolution.effective.criteria);
  let rawAccountingValue = 0n;
  let calculatedValue = 0n;
  let status: RuleExecutionResultStatus = "EXECUTED";
  let statusReason: string | null = null;

  if (resolution.effective.executionMethod !== "FULL_ACCOUNT") {
    status = "SKIPPED";
    statusReason = "EXECUTION_METHOD_NOT_SUPPORTED_IN_FULL_ACCOUNT_EXECUTOR";
  } else if (aggregate.matchedRecordCount === 0) {
    status = "SKIPPED";
    statusReason = "ACCOUNT_NOT_FOUND_IN_SOURCE_SNAPSHOT";
  } else if (!amountBasis) {
    status = "REQUIRES_REVIEW";
    statusReason = "AMOUNT_BASIS_NOT_CONFIGURED";
  } else {
    rawAccountingValue = accountingValueFromBasis({
      amountBasis,
      debit: aggregate.debit,
      credit: aggregate.credit,
    });
    if (rawAccountingValue < 0n) {
      status = "REQUIRES_REVIEW";
      statusReason = "OPPOSITE_MOVEMENT_DIRECTION";
    } else {
      calculatedValue = rawAccountingValue;
    }
  }

  const ruleExecutionResult = buildRuleExecutionResult({
    companyId,
    taxPeriodId: input.taxPeriod.id,
    sourceSnapshot: input.sourceSnapshot,
    accountCode,
    reducedCode,
    accountDescription: aggregate.accountDescription,
    resolution,
    amountBasis,
    rawAccountingValue,
    calculatedValue,
    status,
    createdAt,
    metadata: {
      statusReason,
      sourceSnapshotHash: input.sourceSnapshot.hash,
      source: input.sourceSnapshot.source,
      sourceType: input.sourceSnapshot.sourceType,
      provider: input.sourceSnapshot.provider,
      taxPeriod: {
        fiscalYear: input.taxPeriod.fiscalYear,
        periodCode: input.taxPeriod.periodCode,
        startDate: input.taxPeriod.startDate,
        endDate: input.taxPeriod.endDate,
      },
      accountingChartId: resolution.accountingChart.id,
      companyAccountingChartId: resolution.companyAccountingChart.id,
      accountFiscalMappingId: resolution.mapping.id,
      accountFiscalMappingVersion: resolution.mapping.version,
      companyAccountMappingOverrideId: resolution.mappingOverride?.id ?? null,
      companyAccountMappingOverrideVersion: resolution.mappingOverride?.version ?? null,
      fiscalRuleId: resolution.baseRule.id,
      fiscalRuleVersion: resolution.baseRule.version,
      companyRuleOverrideId: resolution.companyRuleOverride?.id ?? null,
      companyRuleOverrideVersion: resolution.companyRuleOverride?.version ?? null,
      amountBasis,
      debit: moneyFromCents(aggregate.debit),
      credit: moneyFromCents(aggregate.credit),
      movement: moneyFromCents(aggregate.movement),
      matchedRecordCount: aggregate.matchedRecordCount,
    },
  });

  if (ruleExecutionResult.status !== "EXECUTED" || calculatedValue <= 0n) {
    return { resolution, ruleExecutionResult, taxAdjustments: [] };
  }

  const existingIds = new Set((input.existingTaxAdjustments ?? []).map((item) => item.id));
  const existingKeys = new Set((input.existingTaxAdjustments ?? []).map((item) => item.logicalKey));
  const adjustments = [
    ["IRPJ", taxAdjustmentTypeForTreatment(resolution.effective.irpjTreatment)] as const,
    ["CSLL", taxAdjustmentTypeForTreatment(resolution.effective.csllTreatment)] as const,
  ].flatMap(([tax, adjustmentType]) => {
    if (!adjustmentType) return [];
    const adjustment = buildTaxAdjustment({
      result: ruleExecutionResult,
      tax,
      adjustmentType,
      createdAt,
    });
    if (existingIds.has(adjustment.id) || existingKeys.has(adjustment.logicalKey)) return [];
    return [adjustment];
  });

  return {
    resolution,
    ruleExecutionResult,
    taxAdjustments: adjustments,
  };
}