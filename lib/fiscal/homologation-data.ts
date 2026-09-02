import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import {
  calculateAnnualMonthly,
  type AccountingResultByTaxInput,
  type AccountingResultYtdInput,
  type FiscalBalanceAvailable,
  type FiscalCreditAvailable,
  type TaxCalculation,
  type TaxCalculationVersionStatus,
} from "./annual-monthly-engine.ts";
import {
  buildTaxAdjustmentLogicalKey,
  type AccountFiscalMapping,
  type AccountingChart,
  type CompanyAccountingChart,
  type FiscalNature,
  type FiscalRule,
  type FiscalTax,
  type PendingItem,
  type RuleExecutionResult,
  type TaxAdjustment,
  type TaxAdjustmentType,
} from "./fiscal-matrix.ts";
import {
  buildMonthlyTaxDossierModel,
  buildMonthlyTaxDossierPackage,
  buildTaxDossierRecord,
  TAX_DOSSIER_BUCKET,
  TaxDossierError,
  verifyExistingDossierIntegrity,
  type MonthlyTaxDossierArtifact,
  type MonthlyTaxDossierComparison,
  type TaxDossierRecord,
} from "./monthly-dossier.ts";
import {
  classifyNewAccount,
  closeTaxPeriod,
  confirmAutomaticNewAccountClassification,
  correctAutomaticNewAccountClassification,
  openNewTaxPeriodVersion,
  resolveConditionalOccurrence,
  validateCloseTaxPeriod,
  type CloseTaxPeriodIssue,
  type FiscalMatrixContext,
  type TaxWorkflowHumanDecision,
  type WorkflowTaxPeriod,
} from "./monthly-workflow.ts";
import {
  annualAdjustmentPeriodCode,
  buildTaxPeriodsForProfile,
  monthlyEstimatePeriodCode,
} from "./periods.ts";
import { canonicalJson, createSourceSnapshotDraft, normalizeMoney } from "./source-snapshot.ts";
import type { GenerateMonthlyDossierResponse, IrpjCsllDossierListResponse, MonthlyDossierArtifactResponse, MonthlyDossierCompareResponse, MonthlyDossierManifestResponse } from "./monthly-dossier-service.ts";
import type { IrpjCsllDashboardResponse } from "./monthly-workflow-service.ts";
import type { FiscalYearProfile, JsonObject, SourceSnapshot, SnapshotInputObject, TaxPeriodDraft } from "./types.ts";
import {
  IRPJ_CSLL_HOMOLOGATION_COMPANY,
  IRPJ_CSLL_HOMOLOGATION_TOKEN,
  IRPJ_CSLL_HOMOLOGATION_USER,
  isIrpjCsllHomologationMode,
} from "./homologation-mode.ts";
import { assertFiscalCompetence, FiscalAccessError, parseFiscalRequestScope, type FiscalAccessContext } from "../server/fiscal-access.ts";
import { bearerToken } from "../server/supabase-access.ts";

const FISCAL_YEAR = 2026;
const PROFILE_ID = "00000000-0000-5000-9000-000000000026";
const MATRIX_VERSION = "MATRIZ_FISCAL_V53";
const MATRIX_HASH = "5c8d1b04f97d2fd984293f4d3eb9b3f2d31f9f4d58c9793d2790a59c0f53f026";
const CREATED_AT = "2026-09-01T12:00:00.000Z";
const ACCOUNTING_CHART_ID = "chart-irpj-csll-2026-v53";
const COMPANY_CHART_ID = "company-chart-irpj-csll-2026-v53";
const BRINDES_ACCOUNT = "4.2.1.02.03.11 — Brindes e Cortesias";
const CSLL_DUE_ACCOUNT = "HOMOLOGACAO_V03_CSLL_DEVIDA";

type PreviewPayload = {
  readonly accountingResultYtd?: unknown;
  readonly accountingResultBeforeIrpjYtd?: unknown;
  readonly accountingResultBeforeCsllYtd?: unknown;
  readonly accountingResultYtdByTax?: unknown;
  readonly versionStatus?: unknown;
};

type HomologationMonthlyInput = {
  readonly accountingResultYtd: number;
  readonly accountingResultBeforeIrpjYtd?: number;
  readonly accountingResultBeforeCsllYtd?: number;
  readonly fiscalBalances: readonly FiscalBalanceAvailable[];
  readonly taxCredits: readonly FiscalCreditAvailable[];
  readonly records: readonly SnapshotInputObject[];
  readonly extractedAt: string;
  readonly adjustments: {
    readonly irpjAdd: number;
    readonly irpjCsllDueAdd?: number;
    readonly irpjExclusion: number;
    readonly csllAdd?: number;
    readonly csllExclusion?: number;
  };
};

type ClassifyPayload = {
  readonly accountingChartId?: unknown;
  readonly accountCode?: unknown;
  readonly reducedCode?: unknown;
  readonly fiscalNatureCode?: unknown;
  readonly fiscalNatureName?: unknown;
  readonly fiscalNatureDescription?: unknown;
  readonly fiscalRuleCode?: unknown;
  readonly irpjTreatment?: unknown;
  readonly csllTreatment?: unknown;
  readonly amountBasis?: unknown;
  readonly justification?: unknown;
};

type ConditionalPayload = {
  readonly accountCode?: unknown;
  readonly reducedCode?: unknown;
  readonly accountDescription?: unknown;
  readonly accountingChartId?: unknown;
  readonly companyAccountingChartId?: unknown;
  readonly accountFiscalMappingId?: unknown;
  readonly accountFiscalMappingVersion?: unknown;
  readonly fiscalNatureId?: unknown;
  readonly fiscalRuleId?: unknown;
  readonly fiscalRuleVersion?: unknown;
  readonly companyAccountMappingOverrideId?: unknown;
  readonly companyAccountMappingOverrideVersion?: unknown;
  readonly companyRuleOverrideId?: unknown;
  readonly companyRuleOverrideVersion?: unknown;
  readonly irpjDecision?: unknown;
  readonly csllDecision?: unknown;
  readonly amount?: unknown;
  readonly sourceContext?: unknown;
  readonly justification?: unknown;
};

type DossierPayload = {
  readonly taxPeriodId?: unknown;
};

type HomologationStore = {
  readonly fiscalYearProfile: FiscalYearProfile;
  periods: WorkflowTaxPeriod[];
  snapshots: SourceSnapshot[];
  taxCalculations: TaxCalculation[];
  taxAdjustments: TaxAdjustment[];
  ruleExecutionResults: RuleExecutionResult[];
  pendingItems: PendingItem[];
  humanDecisions: TaxWorkflowHumanDecision[];
  accountingCharts: AccountingChart[];
  companyAccountingCharts: CompanyAccountingChart[];
  mappings: AccountFiscalMapping[];
  fiscalNatures: FiscalNature[];
  fiscalRules: FiscalRule[];
  dossiers: TaxDossierRecord[];
  artifacts: Map<string, Map<string, Buffer>>;
};

type HomologationState = {
  readonly access: FiscalAccessContext;
  readonly fiscalYear: number;
  readonly month: number;
  readonly fiscalYearProfile: FiscalYearProfile | null;
  readonly taxPeriod: WorkflowTaxPeriod | null;
  readonly periodVersions: readonly WorkflowTaxPeriod[];
  readonly allYearPeriods: readonly WorkflowTaxPeriod[];
  readonly sourceSnapshots: readonly SourceSnapshot[];
  readonly sourceSnapshot: SourceSnapshot | null;
  readonly pendingItems: readonly PendingItem[];
  readonly ruleExecutionResults: readonly RuleExecutionResult[];
  readonly taxAdjustments: readonly TaxAdjustment[];
  readonly taxCalculations: readonly TaxCalculation[];
  readonly taxCalculation: TaxCalculation | null;
  readonly humanDecisions: readonly TaxWorkflowHumanDecision[];
  readonly dossiers: readonly TaxDossierRecord[];
};

const globalState = globalThis as typeof globalThis & {
  __irpjCsllHomologationStore?: HomologationStore;
};

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableUuid(payload: SnapshotInputObject) {
  const chars = sha256(canonicalJson(payload)).slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function money(value: number | string) {
  return normalizeMoney(value);
}

function total(records: readonly SnapshotInputObject[], field: "debit" | "credit") {
  return records.reduce((sum, record) => sum + Number(record[field] ?? 0), 0);
}

function fiscalSource(label: string): JsonObject {
  return { source: "IRPJ_CSLL_HOMOLOGATION_FIXTURE", label, matrixVersion: MATRIX_VERSION };
}

function requiredText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new FiscalAccessError(400, "MISSING_FIELD", `${label} é obrigatório.`);
  return text;
}

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function requiredInt(value: unknown, label: string) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) throw new FiscalAccessError(400, "INVALID_FIELD", `${label} deve ser inteiro.`);
  return numeric;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const text = requiredText(value, label);
  if (!(allowed as readonly string[]).includes(text)) throw new FiscalAccessError(400, "INVALID_FIELD", `${label} inválido.`);
  return text as T;
}

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function fiscalYearFromCompetence(competence: string) {
  return Number(competence.slice(0, 4));
}

function monthFromCompetence(competence: string) {
  return Number(competence.slice(5, 7));
}

function periodCodeForCompetence(fiscalYear: number, month: number) {
  return monthlyEstimatePeriodCode(fiscalYear, month);
}

function samePeriod(left: Pick<WorkflowTaxPeriod, "fiscalYear" | "periodCode">, right: Pick<WorkflowTaxPeriod, "fiscalYear" | "periodCode">) {
  return left.fiscalYear === right.fiscalYear && left.periodCode === right.periodCode;
}

function latestCalculation(calculations: readonly TaxCalculation[]) {
  return [...calculations]
    .filter((calculation) => calculation.versionStatus !== "CLOSED_SUPERSEDED")
    .sort((left, right) => {
      if (left.versionStatus === "CLOSED_CURRENT" && right.versionStatus !== "CLOSED_CURRENT") return -1;
      if (right.versionStatus === "CLOSED_CURRENT" && left.versionStatus !== "CLOSED_CURRENT") return 1;
      return right.calculationVersion - left.calculationVersion || right.createdAt.localeCompare(left.createdAt);
    })[0] ?? null;
}

function selectedPeriodVersion(periods: readonly WorkflowTaxPeriod[]) {
  return [...periods]
    .filter((period) => period.status !== "CLOSED_SUPERSEDED")
    .sort((left, right) => right.version - left.version || String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0]
    ?? periods[0]
    ?? null;
}

function fiscalEngine(profile: FiscalYearProfile | null, period: WorkflowTaxPeriod | null): IrpjCsllDashboardResponse["engine"] {
  if (profile?.taxRegime === "REAL_PROFIT" && profile.periodicity === "ANNUAL" && (!period || period.periodType === "MONTHLY_ESTIMATE")) {
    return { code: "ANNUAL_MONTHLY", readOnly: true, source: "FISCAL_YEAR_PROFILE", reason: "Lucro Real anual com apuração mensal por estimativa/balanço." };
  }
  return { code: "ENGINE_NOT_ENABLED_FOR_REGIME", readOnly: true, source: "FISCAL_YEAR_PROFILE", reason: "Motor mensal habilitado somente para Lucro Real anual nesta fase." };
}

function periodStatusFromCalculation(calculation: TaxCalculation | null) {
  if (!calculation) return "DRAFT" as const;
  return calculation.status === "CALCULATED" ? "CALCULATED" as const : "CALCULATED_WITH_PENDING_ITEMS" as const;
}

function trialBalanceRecord(accountCode: string, description: string, debit: number, credit = 0): SnapshotInputObject {
  return {
    accountCode,
    reducedCode: accountCode.replace(/\D/g, "").slice(-8),
    description,
    openingBalance: "0.00",
    debit: money(debit),
    credit: money(credit),
    movement: money(debit - credit),
    closingBalance: money(debit - credit),
  };
}

function fiscalBalance(id: string, tax: FiscalTax, balanceType: FiscalBalanceAvailable["balanceType"], amount: number): FiscalBalanceAvailable {
  return {
    id,
    tax,
    balanceType,
    originYear: 2025,
    availableAmount: money(amount),
    source: fiscalSource(id),
  };
}

function taxCredit(id: string, tax: FiscalTax, nature: FiscalCreditAvailable["nature"], amount: number, label: string): FiscalCreditAvailable {
  return {
    id,
    tax,
    nature,
    label,
    availableAmount: money(amount),
    source: fiscalSource(id),
  };
}

function snapshotFor(input: {
  readonly period: WorkflowTaxPeriod;
  readonly accountingResultYtd: number;
  readonly accountingResultBeforeIrpjYtd?: number;
  readonly accountingResultBeforeCsllYtd?: number;
  readonly fiscalBalances: readonly FiscalBalanceAvailable[];
  readonly taxCredits: readonly FiscalCreditAvailable[];
  readonly records: readonly SnapshotInputObject[];
  readonly extractedAt: string;
}) {
  const accountingResultBeforeIrpjYtd = input.accountingResultBeforeIrpjYtd ?? input.accountingResultYtd;
  const accountingResultBeforeCsllYtd = input.accountingResultBeforeCsllYtd ?? input.accountingResultYtd;
  const draft = createSourceSnapshotDraft({
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    externalCompanyRef: IRPJ_CSLL_HOMOLOGATION_COMPANY.code,
    taxPeriodId: input.period.id,
    taxPeriod: {
      fiscalYear: input.period.fiscalYear,
      periodCode: input.period.periodCode,
      startDate: input.period.startDate,
      endDate: input.period.endDate,
    },
    source: "TOTVS_BALANCETE_CANONICAL",
    sourceType: "TRIAL_BALANCE",
    provider: "TOTVS_RM_ADAPTER",
    adapterVersion: 1,
    contentSchemaVersion: 1,
    extractedAt: input.extractedAt,
    parameters: {
      startDate: input.period.startDate,
      endDate: input.period.endDate,
      includeClosingEntries: false,
      extractionMode: "ACCUMULATED_YTD_MONTHLY_ESTIMATE",
      accountingResultYtd: money(input.accountingResultYtd),
      accountingResultBeforeIrpjYtd: money(accountingResultBeforeIrpjYtd),
      accountingResultBeforeCsllYtd: money(accountingResultBeforeCsllYtd),
      fiscalBalances: input.fiscalBalances.map((balance) => ({
        id: balance.id,
        tax: balance.tax,
        balanceType: balance.balanceType,
        originYear: balance.originYear ?? null,
        availableAmount: money(balance.availableAmount),
        source: balance.source as SnapshotInputObject,
      })),
      taxCredits: input.taxCredits.map((credit) => ({
        id: credit.id,
        tax: credit.tax,
        nature: credit.nature,
        label: credit.label ?? "",
        availableAmount: money(credit.availableAmount),
        source: credit.source as SnapshotInputObject,
      })),
    },
    recordCount: input.records.length,
    records: input.records,
    totalDebit: money(total(input.records, "debit")),
    totalCredit: money(total(input.records, "credit")),
    balances: {
      accountingResultYtd: money(input.accountingResultYtd),
      accountingResultBeforeIrpjYtd: money(accountingResultBeforeIrpjYtd),
      accountingResultBeforeCsllYtd: money(accountingResultBeforeCsllYtd),
      fiscalBalances: input.fiscalBalances.map((balance) => ({ id: balance.id, tax: balance.tax, balanceType: balance.balanceType, availableAmount: money(balance.availableAmount) })),
      taxCredits: input.taxCredits.map((credit) => ({ id: credit.id, tax: credit.tax, nature: credit.nature, availableAmount: money(credit.availableAmount) })),
    },
    snapshotVersion: input.period.version,
  });
  return {
    id: stableUuid({ type: "SOURCE_SNAPSHOT", taxPeriodId: input.period.id, version: input.period.version, extractedAt: input.extractedAt }),
    ...draft,
    createdAt: input.extractedAt,
  } satisfies SourceSnapshot;
}

function periodFromDraft(draft: TaxPeriodDraft, version = 1, status: WorkflowTaxPeriod["status"] = "DRAFT"): WorkflowTaxPeriod {
  return {
    id: stableUuid({ type: "TAX_PERIOD", companyId: draft.companyId, fiscalYear: draft.fiscalYear, periodCode: draft.periodCode, version }),
    companyId: draft.companyId,
    fiscalYearProfileId: PROFILE_ID,
    fiscalYear: draft.fiscalYear,
    periodCode: draft.periodCode,
    startDate: draft.startDate,
    endDate: draft.endDate,
    periodType: draft.periodType,
    status,
    version,
    upstreamStale: false,
    closedManifestId: null,
    closedManifest: null,
    replacedByTaxPeriodId: null,
    closedAt: null,
    closedBy: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function makeRuleExecution(input: {
  readonly period: WorkflowTaxPeriod;
  readonly snapshot: SourceSnapshot;
  readonly accountCode: string;
  readonly accountDescription: string;
  readonly fiscalNatureId: string;
  readonly fiscalRuleId: string;
  readonly value: number;
  readonly createdAt: string;
}): RuleExecutionResult {
  const logicalKey = `HOMOLOGATION_RULE_EXECUTION:${sha256(canonicalJson({
    taxPeriodId: input.period.id,
    sourceSnapshotId: input.snapshot.id,
    accountCode: input.accountCode,
    fiscalRuleId: input.fiscalRuleId,
    value: money(input.value),
  }))}`;
  return {
    id: stableUuid({ type: "RULE_EXECUTION_RESULT", logicalKey }),
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    taxPeriodId: input.period.id,
    sourceSnapshotId: input.snapshot.id,
    accountingChartId: ACCOUNTING_CHART_ID,
    companyAccountingChartId: COMPANY_CHART_ID,
    accountCode: input.accountCode,
    reducedCode: null,
    accountDescription: input.accountDescription,
    fiscalNatureId: input.fiscalNatureId,
    accountFiscalMappingId: `mapping-${input.fiscalNatureId}`,
    accountFiscalMappingVersion: 53,
    companyAccountMappingOverrideId: null,
    companyAccountMappingOverrideVersion: null,
    fiscalRuleId: input.fiscalRuleId,
    fiscalRuleVersion: 53,
    companyRuleOverrideId: null,
    companyRuleOverrideVersion: null,
    executionMethod: "FULL_ACCOUNT",
    automationLevel: "AUTOMATIC",
    amountBasis: "NET_DEBIT_MOVEMENT",
    rawAccountingValue: money(input.value),
    calculatedValue: money(input.value),
    status: "EXECUTED",
    executionMetadata: {
        source: input.snapshot.source,
      provider: input.snapshot.provider,
      matrixVersion: MATRIX_VERSION,
      homologation: true,
    },
    logicalKey,
    createdAt: input.createdAt,
  };
}

function makeAdjustment(input: {
  readonly period: WorkflowTaxPeriod;
  readonly snapshot: SourceSnapshot;
  readonly tax: FiscalTax;
  readonly adjustmentType: TaxAdjustmentType;
  readonly accountCode: string;
  readonly accountDescription: string;
  readonly fiscalNatureId: string;
  readonly fiscalRuleId: string;
  readonly value: number;
  readonly createdAt: string;
}) {
  const result = makeRuleExecution(input);
  const logicalKey = buildTaxAdjustmentLogicalKey({
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    taxPeriodId: input.period.id,
    sourceSnapshotId: input.snapshot.id,
    ruleExecutionResultId: result.id,
    tax: input.tax,
    adjustmentType: input.adjustmentType,
    fiscalRuleId: result.fiscalRuleId,
    fiscalRuleVersion: result.fiscalRuleVersion,
  });
  const adjustment: TaxAdjustment = {
    id: stableUuid({ type: "TAX_ADJUSTMENT", logicalKey }),
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    taxPeriodId: input.period.id,
    sourceSnapshotId: input.snapshot.id,
    ruleExecutionResultId: result.id,
    tax: input.tax,
    adjustmentType: input.adjustmentType,
    accountCode: input.accountCode,
    reducedCode: null,
    fiscalNatureId: input.fiscalNatureId,
    fiscalRuleId: input.fiscalRuleId,
    fiscalRuleVersion: 53,
    value: money(input.value),
    origin: "RULE_EXECUTION_RESULT",
    status: "READY",
    logicalKey,
    createdAt: input.createdAt,
  };
  return { result, adjustment };
}

function calculateForPeriod(input: {
  readonly period: WorkflowTaxPeriod;
  readonly snapshot: SourceSnapshot;
  readonly accountingResultYtd: number | string;
  readonly accountingResultBeforeIrpjYtd?: number | string;
  readonly accountingResultBeforeCsllYtd?: number | string;
  readonly taxAdjustments: readonly TaxAdjustment[];
  readonly fiscalBalances: readonly FiscalBalanceAvailable[];
  readonly taxCredits: readonly FiscalCreditAvailable[];
  readonly priorCalculations: readonly TaxCalculation[];
  readonly pendingItems?: readonly PendingItem[];
  readonly calculationVersion: number;
  readonly versionStatus?: TaxCalculationVersionStatus;
  readonly createdAt: string;
}) {
  const result = calculateAnnualMonthly({
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    fiscalYearProfile: FISCAL_YEAR_PROFILE,
    taxPeriod: input.period,
    sourceSnapshot: input.snapshot,
    accountingResultYtd: {
      value: money(input.accountingResultYtd),
      source: {
        origin: "SOURCE_SNAPSHOT",
        sourceSnapshotId: input.snapshot.id,
        path: "parameters.accountingResultYtd",
      },
    },
    accountingResultYtdByTax: {
      IRPJ: {
        value: money(input.accountingResultBeforeIrpjYtd ?? input.accountingResultYtd),
        source: { origin: "SOURCE_SNAPSHOT", sourceSnapshotId: input.snapshot.id, path: "parameters.accountingResultBeforeIrpjYtd" },
      },
      CSLL: {
        value: money(input.accountingResultBeforeCsllYtd ?? input.accountingResultYtd),
        source: { origin: "SOURCE_SNAPSHOT", sourceSnapshotId: input.snapshot.id, path: "parameters.accountingResultBeforeCsllYtd" },
      },
    },
    taxAdjustments: input.taxAdjustments,
    fiscalBalances: input.fiscalBalances,
    taxCredits: input.taxCredits,
    priorCalculations: input.priorCalculations,
    pendingItems: input.pendingItems ?? [],
    matrixVersion: MATRIX_VERSION,
    calculationVersion: input.calculationVersion,
    versionStatus: input.versionStatus ?? "DRAFT",
    createdAt: input.createdAt,
  });
  if (!result.taxCalculation) throw new Error("Fixture de homologação deveria produzir cálculo ANNUAL_MONTHLY.");
  return result.taxCalculation;
}

function closeCalculatedPeriod(input: {
  readonly period: WorkflowTaxPeriod;
  readonly snapshot: SourceSnapshot;
  readonly taxCalculation: TaxCalculation;
  readonly taxAdjustments: readonly TaxAdjustment[];
  readonly pendingItems?: readonly PendingItem[];
  readonly humanDecisions?: readonly TaxWorkflowHumanDecision[];
  readonly periodVersions: readonly WorkflowTaxPeriod[];
  readonly timestamp: string;
}) {
  const result = closeTaxPeriod({
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    taxPeriod: { ...input.period, status: periodStatusFromCalculation(input.taxCalculation), updatedAt: input.timestamp },
    sourceSnapshot: input.snapshot,
    taxCalculation: input.taxCalculation,
    taxAdjustments: input.taxAdjustments,
    pendingItems: input.pendingItems ?? [],
    humanDecisions: input.humanDecisions ?? [],
    periodVersions: input.periodVersions,
    expectedMatrixVersion: input.taxCalculation.matrixVersion,
    companyCode: IRPJ_CSLL_HOMOLOGATION_COMPANY.code,
    companyName: IRPJ_CSLL_HOMOLOGATION_COMPANY.name,
    userId: IRPJ_CSLL_HOMOLOGATION_USER.id,
    userEmail: IRPJ_CSLL_HOMOLOGATION_USER.email,
    timestamp: input.timestamp,
  });
  if (!result.closed || !result.taxCalculation || !result.manifest) {
    throw new Error(`Fixture de homologação inválida: ${result.issues.map((issue) => issue.code).join(", ")}`);
  }
  const closedPeriod: WorkflowTaxPeriod = {
    ...result.taxPeriod,
    closedManifestId: result.manifest.id,
    closedManifest: result.manifest,
    closedAt: result.manifest.createdAt,
    closedBy: result.manifest.createdBy,
  };
  const supersededPeriods = result.supersededPeriods.map((period) => ({
    ...period,
    closedAt: period.closedAt ?? period.updatedAt ?? input.timestamp,
    closedBy: period.closedBy ?? IRPJ_CSLL_HOMOLOGATION_USER.id,
  }));
  return {
    closedPeriod,
    taxCalculation: result.taxCalculation,
    supersededPeriods,
  };
}

const FISCAL_YEAR_PROFILE: FiscalYearProfile = {
  id: PROFILE_ID,
  companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
  fiscalYear: FISCAL_YEAR,
  taxRegime: "REAL_PROFIT",
  periodicity: "ANNUAL",
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  version: 1,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

function fiscalMatrix(): Pick<HomologationStore, "accountingCharts" | "companyAccountingCharts" | "mappings" | "fiscalNatures" | "fiscalRules"> {
  const accountingCharts: AccountingChart[] = [{
    id: ACCOUNTING_CHART_ID,
    code: "RAIZ-2026",
    name: "Plano Contábil Raiz 2026",
    description: "Plano técnico usado pela homologação local IRPJ/CSLL.",
    active: true,
    version: 53,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }];
  const companyAccountingCharts: CompanyAccountingChart[] = [{
    id: COMPANY_CHART_ID,
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    accountingChartId: ACCOUNTING_CHART_ID,
    fiscalYear: 2026,
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    version: 53,
    active: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }];
  const fiscalNatures: FiscalNature[] = [
    {
      id: "nature-v53-brindes-cortesias",
      code: "BRINDES_CORTESIAS",
      name: "Brindes e Cortesias",
      description: BRINDES_ACCOUNT,
      sourceMetadata: { matrixVersion: MATRIX_VERSION, source: "MATRIZ_FISCAL_V53" },
      active: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    {
      id: "nature-v53-exclusao-rastreada",
      code: "EXCLUSAO_RASTREADA_HOMOLOGACAO",
      name: "Exclusão fiscal rastreada",
      description: "Exclusão fiscal de homologação para preservar os números canônicos já fechados.",
      sourceMetadata: { matrixVersion: MATRIX_VERSION, source: "MATRIZ_FISCAL_V53" },
      active: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ];
  const fiscalRules: FiscalRule[] = [
    {
      id: "rule-v53-brindes-cortesias",
      ruleCode: "MF53_BRINDES_CORTESIAS",
      fiscalNatureId: "nature-v53-brindes-cortesias",
      irpjTreatment: "ADDITION",
      csllTreatment: "ADDITION",
      executionMethod: "FULL_ACCOUNT",
      automationLevel: "AUTOMATIC",
      criteria: { amountBasis: "NET_DEBIT_MOVEMENT", source: "MATRIZ_FISCAL_V53" },
      sourceMetadata: { matrixVersion: MATRIX_VERSION },
      validFrom: "2026-01-01",
      validTo: null,
      version: 53,
      status: "ACTIVE",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    {
      id: "rule-v53-exclusao-rastreada",
      ruleCode: "MF53_EXCLUSAO_RASTREADA",
      fiscalNatureId: "nature-v53-exclusao-rastreada",
      irpjTreatment: "EXCLUSION",
      csllTreatment: "EXCLUSION",
      executionMethod: "FULL_ACCOUNT",
      automationLevel: "AUTOMATIC",
      criteria: { amountBasis: "NET_CREDIT_MOVEMENT", source: "MATRIZ_FISCAL_V53" },
      sourceMetadata: { matrixVersion: MATRIX_VERSION },
      validFrom: "2026-01-01",
      validTo: null,
      version: 53,
      status: "ACTIVE",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ];
  const mappings: AccountFiscalMapping[] = fiscalNatures.map((nature) => ({
    id: `mapping-${nature.id}`,
    accountingChartId: ACCOUNTING_CHART_ID,
    accountCode: nature.id === "nature-v53-brindes-cortesias" ? BRINDES_ACCOUNT : "3.1.1.02.01.10 — Exclusão fiscal rastreada",
    reducedCode: null,
    fiscalNatureId: nature.id,
    sourceMetadata: { matrixVersion: MATRIX_VERSION },
    validFrom: "2026-01-01",
    validTo: null,
    version: 53,
    active: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }));
  return { accountingCharts, companyAccountingCharts, mappings, fiscalNatures, fiscalRules };
}

function periodByCode(periods: readonly WorkflowTaxPeriod[], code: string) {
  const period = periods.find((item) => item.periodCode === code && item.version === 1);
  if (!period) throw new Error(`Período ${code} ausente na fixture de homologação.`);
  return period;
}

function replacePeriod(periods: WorkflowTaxPeriod[], next: WorkflowTaxPeriod) {
  const index = periods.findIndex((item) => item.id === next.id);
  if (index >= 0) periods[index] = next;
  else periods.push(next);
}

function replaceCalculation(calculations: TaxCalculation[], next: TaxCalculation) {
  const index = calculations.findIndex((item) => item.id === next.id);
  if (index >= 0) calculations[index] = next;
  else calculations.push(next);
}

function replaceDossier(dossiers: TaxDossierRecord[], next: TaxDossierRecord) {
  const index = dossiers.findIndex((item) => item.id === next.id);
  if (index >= 0) dossiers[index] = next;
  else dossiers.push(next);
}

function monthlyInputs(month: 1 | 2 | 3 | 4, period: WorkflowTaxPeriod, version = 1): HomologationMonthlyInput {
  if (month === 1) {
    const fiscalBalances = [
      fiscalBalance("pf-homolog-2026-m01", "IRPJ", "PREJUIZO_FISCAL", 80_000),
      fiscalBalance("bn-homolog-2026-m01", "CSLL", "BASE_NEGATIVA_CSLL", 50_000),
    ];
    const taxCredits = [
      taxCredit("irrf-servicos-homolog-2026-m01", "IRPJ", "IRRF_SERVICOS", 3_000, "IRRF – Serviços"),
      taxCredit("csll-deducao-homolog-2026-m01", "CSLL", "CSLL_EXPLICIT_DEDUCTION", 1_000, "CSLL Retida"),
    ];
    const records = [
      trialBalanceRecord("3.1.1.01.01 — Resultado contábil acumulado", "Resultado contábil acumulado M01", 300_000),
      trialBalanceRecord(BRINDES_ACCOUNT, "Brindes e Cortesias", 30_000),
      trialBalanceRecord("3.1.1.02.01.10 — Exclusão fiscal rastreada", "Exclusão fiscal rastreada", 0, 10_000),
    ];
    return { accountingResultYtd: 300_000, fiscalBalances, taxCredits, records, extractedAt: `2026-02-02T12:00:00.000Z`, adjustments: { irpjAdd: 30_000, irpjExclusion: 10_000, csllAdd: 30_000, csllExclusion: 10_000 } };
  }
  if (month === 2) {
    const fiscalBalances = [
      fiscalBalance("pf-homolog-2026-m02", "IRPJ", "PREJUIZO_FISCAL", 140_000),
      fiscalBalance("bn-homolog-2026-m02", "CSLL", "BASE_NEGATIVA_CSLL", 50_000),
    ];
    const taxCredits = [
      taxCredit("irrf-servicos-homolog-2026-m02", "IRPJ", "IRRF_SERVICOS", 3_000, "IRRF – Serviços"),
      taxCredit("irrf-aplicacoes-homolog-2026-m02", "IRPJ", "IRRF_APLICACOES_FINANCEIRAS", 2_000, "IRRF – Aplicações Financeiras"),
      taxCredit("csll-deducao-homolog-2026-m02", "CSLL", "CSLL_EXPLICIT_DEDUCTION", 2_000, "CSLL Retida"),
    ];
    const records = [
      trialBalanceRecord("3.1.1.01.01 — Resultado contábil acumulado", "Resultado contábil acumulado M02", 650_000),
      trialBalanceRecord(BRINDES_ACCOUNT, "Brindes e Cortesias", 70_000),
      trialBalanceRecord("3.1.1.02.01.10 — Exclusão fiscal rastreada", "Exclusão fiscal rastreada", 0, 30_000),
    ];
    return { accountingResultYtd: 650_000, fiscalBalances, taxCredits, records, extractedAt: `2026-03-02T12:00:00.000Z`, adjustments: { irpjAdd: 70_000, irpjExclusion: 30_000, csllAdd: 70_000, csllExclusion: 30_000 } };
  }
  if (month === 3) {
    const fiscalBalances = [
      fiscalBalance(`pf-homolog-2026-m03-v${version}`, "IRPJ", "PREJUIZO_FISCAL", version === 1 ? 190_000 : 200_000),
      fiscalBalance(`bn-homolog-2026-m03-v${version}`, "CSLL", "BASE_NEGATIVA_CSLL", version === 1 ? 98_000 : 100_000),
    ];
    const taxCredits = [
      taxCredit(`irrf-servicos-homolog-2026-m03-v${version}`, "IRPJ", "IRRF_SERVICOS", 6_000, "IRRF – Serviços"),
      taxCredit(`irrf-aplicacoes-homolog-2026-m03-v${version}`, "IRPJ", "IRRF_APLICACOES_FINANCEIRAS", version === 1 ? 3_000 : 4_000, "IRRF – Aplicações Financeiras"),
      taxCredit(`csll-deducao-homolog-2026-m03-v${version}`, "CSLL", "CSLL_EXPLICIT_DEDUCTION", 4_000, "CSLL Retida"),
    ];
    const accountingResultYtd = version === 1 ? 980_000 : 1_000_000;
    const usesCurrentIrpjCsllFixture = version > 2;
    const accountingResultBeforeCsllYtd = usesCurrentIrpjCsllFixture ? 1_000_000 : accountingResultYtd;
    const accountingResultBeforeIrpjYtd = usesCurrentIrpjCsllFixture ? 910_000 : accountingResultYtd;
    const irpjCsllDueAdd = usesCurrentIrpjCsllFixture ? 90_000 : 0;
    const records = [
      trialBalanceRecord("3.1.1.01.01 — Resultado contábil acumulado", `Resultado contábil acumulado M03 V0${version}`, accountingResultYtd),
      trialBalanceRecord(BRINDES_ACCOUNT, "Brindes e Cortesias", 100_000),
      trialBalanceRecord("3.1.1.02.01.10 — Exclusão fiscal rastreada", "Exclusão fiscal rastreada", 0, 50_000),
    ];
    return { accountingResultYtd, accountingResultBeforeIrpjYtd, accountingResultBeforeCsllYtd, fiscalBalances, taxCredits, records, extractedAt: `2026-04-02T12:0${version}:00.000Z`, adjustments: { irpjAdd: 100_000, irpjCsllDueAdd, irpjExclusion: 50_000, csllAdd: 100_000, csllExclusion: 50_000 } };
  }
  const fiscalBalances = [
    fiscalBalance("pf-homolog-2026-m04", "IRPJ", "PREJUIZO_FISCAL", 240_000),
    fiscalBalance("bn-homolog-2026-m04", "CSLL", "BASE_NEGATIVA_CSLL", 120_000),
  ];
  const taxCredits = [
    taxCredit("irrf-servicos-homolog-2026-m04", "IRPJ", "IRRF_SERVICOS", 8_000, "IRRF – Serviços"),
    taxCredit("irrf-aplicacoes-homolog-2026-m04", "IRPJ", "IRRF_APLICACOES_FINANCEIRAS", 4_000, "IRRF – Aplicações Financeiras"),
    taxCredit("csll-deducao-homolog-2026-m04", "CSLL", "CSLL_EXPLICIT_DEDUCTION", 5_000, "CSLL Retida"),
  ];
  const records = [
    trialBalanceRecord("3.1.1.01.01 — Resultado contábil acumulado", "Resultado contábil acumulado M04", 1_200_000),
    trialBalanceRecord("4.2.1.05.03.17 — Despesas com Correios e Postagens", "Conta L2 auto classificada", 18_000),
    trialBalanceRecord("4.2.1.05.03.19", "Serviços de Comunicação e Postagens", 32_000),
    trialBalanceRecord("4.2.1.07.04.09", "Despesa condicional de homologação", 25_000),
  ];
  return { accountingResultYtd: 1_200_000, fiscalBalances, taxCredits, records, extractedAt: "2026-05-04T12:00:00.000Z", adjustments: { irpjAdd: 0, irpjExclusion: 0, csllAdd: 0, csllExclusion: 0 } };
}

function adjustmentSet(period: WorkflowTaxPeriod, snapshot: SourceSnapshot, values: HomologationMonthlyInput["adjustments"], createdAt: string) {
  const items = [] as { result: RuleExecutionResult; adjustment: TaxAdjustment }[];
  const irpjCsllDueAdd = values.irpjCsllDueAdd ?? 0;
  const csllAdd = values.csllAdd ?? 0;
  const csllExclusion = values.csllExclusion ?? 0;
  if (values.irpjAdd > 0) {
    items.push(makeAdjustment({
      period,
      snapshot,
      tax: "IRPJ",
      adjustmentType: "ADDITION",
      accountCode: BRINDES_ACCOUNT,
      accountDescription: "Brindes e Cortesias",
      fiscalNatureId: "nature-v53-brindes-cortesias",
      fiscalRuleId: "rule-v53-brindes-cortesias",
      value: values.irpjAdd,
      createdAt,
    }));
  }
  if (irpjCsllDueAdd > 0) {
    items.push(makeAdjustment({
      period,
      snapshot,
      tax: "IRPJ",
      adjustmentType: "ADDITION",
      accountCode: CSLL_DUE_ACCOUNT,
      accountDescription: "CSLL devida",
      fiscalNatureId: "homologation-v03-csll-devida",
      fiscalRuleId: "homologation-v03-csll-devida",
      value: irpjCsllDueAdd,
      createdAt,
    }));
  }
  if (csllAdd > 0) {
    items.push(makeAdjustment({
      period,
      snapshot,
      tax: "CSLL",
      adjustmentType: "ADDITION",
      accountCode: BRINDES_ACCOUNT,
      accountDescription: "Brindes e Cortesias",
      fiscalNatureId: "nature-v53-brindes-cortesias",
      fiscalRuleId: "rule-v53-brindes-cortesias",
      value: csllAdd,
      createdAt,
    }));
  }
  if (values.irpjExclusion > 0) {
    items.push(makeAdjustment({
      period,
      snapshot,
      tax: "IRPJ",
      adjustmentType: "EXCLUSION",
      accountCode: "3.1.1.02.01.10 — Exclusão fiscal rastreada",
      accountDescription: "Exclusão fiscal rastreada",
      fiscalNatureId: "nature-v53-exclusao-rastreada",
      fiscalRuleId: "rule-v53-exclusao-rastreada",
      value: values.irpjExclusion,
      createdAt,
    }));
  }
  if (csllExclusion > 0) {
    items.push(makeAdjustment({
      period,
      snapshot,
      tax: "CSLL",
      adjustmentType: "EXCLUSION",
      accountCode: "3.1.1.02.01.10 — Exclusão fiscal rastreada",
      accountDescription: "Exclusão fiscal rastreada",
      fiscalNatureId: "nature-v53-exclusao-rastreada",
      fiscalRuleId: "rule-v53-exclusao-rastreada",
      value: csllExclusion,
      createdAt,
    }));
  }
  return {
    ruleExecutionResults: items.map((item) => item.result),
    taxAdjustments: items.map((item) => item.adjustment),
  };
}

function aprilPendingItems(period: WorkflowTaxPeriod, snapshot: SourceSnapshot): PendingItem[] {
  const l2Key = `HOMOLOGATION_L2:${period.id}:4.2.1.05.03.17`;
  const l3Key = `HOMOLOGATION_L3:${period.id}:4.2.1.05.03.19`;
  const conditionalKey = `HOMOLOGATION_CONDITIONAL:${period.id}:4.2.1.07.04.09`;
  return [
    {
      id: stableUuid({ type: "PENDING_ITEM", logicalKey: l2Key }),
      companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
      taxPeriodId: period.id,
      sourceSnapshotId: snapshot.id,
      type: "NEW_ACCOUNT_AUTO_CLASSIFIED",
      status: "OPEN",
      blocking: false,
      logicalKey: l2Key,
      description: "Conta nova classificada automaticamente: Despesas com Correios e Postagens.",
      originData: {
        sourceSnapshotId: snapshot.id,
        sourceSnapshotHash: snapshot.hash,
        accountingChartId: ACCOUNTING_CHART_ID,
        companyAccountingChartId: COMPANY_CHART_ID,
        accountCode: "4.2.1.05.03.17",
        reducedCode: "421050317",
        description: "Despesas com Correios e Postagens",
        debit: "18000.00",
        credit: "0.00",
        movement: "18000.00",
        irpjTreatment: "NO_ADJUSTMENT",
        csllTreatment: "ADDITION",
        fiscalNatureCode: "POSTAGENS_AUTOMATICAS",
        fiscalNatureName: "Despesas com Correios e Postagens",
        fiscalRuleCode: "MF53_POSTAGENS_AUTO",
        classificationCriterion: "Regra previamente aprovada",
        matrixVersion: MATRIX_VERSION,
        autoClassificationStatus: "AWAITING_CONFIRMATION",
      },
      createdAt: CREATED_AT,
      createdBy: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
    },
    {
      id: stableUuid({ type: "PENDING_ITEM", logicalKey: l3Key }),
      companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
      taxPeriodId: period.id,
      sourceSnapshotId: snapshot.id,
      type: "NEW_ACCOUNT_UNMAPPED",
      status: "OPEN",
      blocking: true,
      logicalKey: l3Key,
      description: "L3/L4 aguardando decisão: conta movimentada sem mapeamento fiscal vigente 4.2.1.05.03.19.",
      originData: {
        sourceSnapshotId: snapshot.id,
        sourceSnapshotHash: snapshot.hash,
        accountingChartId: ACCOUNTING_CHART_ID,
        companyAccountingChartId: COMPANY_CHART_ID,
        accountCode: "4.2.1.05.03.19",
        reducedCode: "421050319",
        description: "Serviços de Comunicação e Postagens",
        debit: "32000.00",
        credit: "0.00",
        movement: "32000.00",
      },
      createdAt: CREATED_AT,
      createdBy: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
    },
    {
      id: stableUuid({ type: "PENDING_ITEM", logicalKey: conditionalKey }),
      companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
      taxPeriodId: period.id,
      sourceSnapshotId: snapshot.id,
      type: "CONDITIONAL_TAX_DECISION",
      status: "OPEN",
      blocking: true,
      logicalKey: conditionalKey,
      description: "Ocorrência condicional aguardando decisão humana: 4.2.1.07.04.09.",
      originData: {
        sourceSnapshotId: snapshot.id,
        sourceSnapshotHash: snapshot.hash,
        accountCode: "4.2.1.07.04.09",
        reducedCode: "421070409",
        accountDescription: "Despesa condicional de homologação",
        accountingChartId: ACCOUNTING_CHART_ID,
        companyAccountingChartId: COMPANY_CHART_ID,
        accountFiscalMappingId: "mapping-condicional-homologacao",
        accountFiscalMappingVersion: 53,
        fiscalNatureId: "nature-condicional-homologacao",
        fiscalRuleId: "rule-condicional-homologacao",
        fiscalRuleVersion: 53,
        companyAccountMappingOverrideId: null,
        companyAccountMappingOverrideVersion: null,
        companyRuleOverrideId: null,
        companyRuleOverrideVersion: null,
        amount: "25000.00",
      },
      createdAt: CREATED_AT,
      createdBy: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
    },
  ];
}

function createInitialStore(): HomologationStore {
  const basePeriods = buildTaxPeriodsForProfile(FISCAL_YEAR_PROFILE).map((draft) => periodFromDraft(draft));
  const matrix = fiscalMatrix();
  const store: HomologationStore = {
    fiscalYearProfile: FISCAL_YEAR_PROFILE,
    periods: basePeriods,
    snapshots: [],
    taxCalculations: [],
    taxAdjustments: [],
    ruleExecutionResults: [],
    pendingItems: [],
    humanDecisions: [],
    ...matrix,
    dossiers: [],
    artifacts: new Map(),
  };

  const closedCalculations: TaxCalculation[] = [];
  for (const month of [1, 2] as const) {
    const period = periodByCode(store.periods, periodCodeForCompetence(FISCAL_YEAR, month));
    const input = monthlyInputs(month, period);
    const snapshot = snapshotFor({ period, accountingResultYtd: input.accountingResultYtd, fiscalBalances: input.fiscalBalances, taxCredits: input.taxCredits, records: input.records, extractedAt: input.extractedAt });
    const generated = adjustmentSet(period, snapshot, input.adjustments, input.extractedAt);
    const calculation = calculateForPeriod({
      period,
      snapshot,
      accountingResultYtd: input.accountingResultYtd,
      taxAdjustments: generated.taxAdjustments,
      fiscalBalances: input.fiscalBalances,
      taxCredits: input.taxCredits,
      priorCalculations: closedCalculations,
      calculationVersion: 1,
      createdAt: input.extractedAt,
    });
    const closed = closeCalculatedPeriod({
      period,
      snapshot,
      taxCalculation: calculation,
      taxAdjustments: generated.taxAdjustments,
      periodVersions: [period],
      timestamp: input.extractedAt,
    });
    replacePeriod(store.periods, closed.closedPeriod);
    store.snapshots.push(snapshot);
    store.ruleExecutionResults.push(...generated.ruleExecutionResults);
    store.taxAdjustments.push(...generated.taxAdjustments);
    store.taxCalculations.push(closed.taxCalculation);
    closedCalculations.push(closed.taxCalculation);
  }

  const marchV1 = periodByCode(store.periods, "2026-M03");
  const marchV1Input = monthlyInputs(3, marchV1, 1);
  const marchV1Snapshot = snapshotFor({ period: marchV1, accountingResultYtd: marchV1Input.accountingResultYtd, fiscalBalances: marchV1Input.fiscalBalances, taxCredits: marchV1Input.taxCredits, records: marchV1Input.records, extractedAt: marchV1Input.extractedAt });
  const marchV1Generated = adjustmentSet(marchV1, marchV1Snapshot, marchV1Input.adjustments, marchV1Input.extractedAt);
  const marchV1Calculation = calculateForPeriod({
    period: marchV1,
    snapshot: marchV1Snapshot,
    accountingResultYtd: marchV1Input.accountingResultYtd,
    taxAdjustments: marchV1Generated.taxAdjustments,
    fiscalBalances: marchV1Input.fiscalBalances,
    taxCredits: marchV1Input.taxCredits,
    priorCalculations: closedCalculations,
    calculationVersion: 1,
    createdAt: marchV1Input.extractedAt,
  });
  const marchV1Closed = closeCalculatedPeriod({
    period: marchV1,
    snapshot: marchV1Snapshot,
    taxCalculation: marchV1Calculation,
    taxAdjustments: marchV1Generated.taxAdjustments,
    periodVersions: [marchV1],
    timestamp: marchV1Input.extractedAt,
  });
  replacePeriod(store.periods, marchV1Closed.closedPeriod);
  store.snapshots.push(marchV1Snapshot);
  store.ruleExecutionResults.push(...marchV1Generated.ruleExecutionResults);
  store.taxAdjustments.push(...marchV1Generated.taxAdjustments);
  store.taxCalculations.push(marchV1Closed.taxCalculation);

  const marchV2 = periodFromDraft({
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    fiscalYearProfileId: PROFILE_ID,
    fiscalYear: FISCAL_YEAR,
    periodCode: "2026-M03",
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    periodType: "MONTHLY_ESTIMATE",
    status: "DRAFT",
    version: 2,
  }, 2);
  replacePeriod(store.periods, marchV2);
  const marchV2Input = monthlyInputs(3, marchV2, 2);
  const marchV2Snapshot = snapshotFor({ period: marchV2, accountingResultYtd: marchV2Input.accountingResultYtd, fiscalBalances: marchV2Input.fiscalBalances, taxCredits: marchV2Input.taxCredits, records: marchV2Input.records, extractedAt: marchV2Input.extractedAt });
  const marchV2Generated = adjustmentSet(marchV2, marchV2Snapshot, marchV2Input.adjustments, marchV2Input.extractedAt);
  const marchV2Calculation = calculateForPeriod({
    period: marchV2,
    snapshot: marchV2Snapshot,
    accountingResultYtd: marchV2Input.accountingResultYtd,
    taxAdjustments: marchV2Generated.taxAdjustments,
    fiscalBalances: marchV2Input.fiscalBalances,
    taxCredits: marchV2Input.taxCredits,
    priorCalculations: closedCalculations,
    calculationVersion: 2,
    createdAt: marchV2Input.extractedAt,
  });
  const marchV2Closed = closeCalculatedPeriod({
    period: marchV2,
    snapshot: marchV2Snapshot,
    taxCalculation: marchV2Calculation,
    taxAdjustments: marchV2Generated.taxAdjustments,
    periodVersions: [marchV1Closed.closedPeriod, marchV2],
    timestamp: marchV2Input.extractedAt,
  });
  replacePeriod(store.periods, marchV2Closed.closedPeriod);
  for (const superseded of marchV2Closed.supersededPeriods) replacePeriod(store.periods, superseded);
  replaceCalculation(store.taxCalculations, { ...marchV1Closed.taxCalculation, versionStatus: "CLOSED_SUPERSEDED" });
  store.snapshots.push(marchV2Snapshot);
  store.ruleExecutionResults.push(...marchV2Generated.ruleExecutionResults);
  store.taxAdjustments.push(...marchV2Generated.taxAdjustments);
  store.taxCalculations.push(marchV2Closed.taxCalculation);

  const april = periodByCode(store.periods, "2026-M04");
  const aprilInput = monthlyInputs(4, april);
  const aprilSnapshot = snapshotFor({ period: april, accountingResultYtd: aprilInput.accountingResultYtd, fiscalBalances: aprilInput.fiscalBalances, taxCredits: aprilInput.taxCredits, records: aprilInput.records, extractedAt: aprilInput.extractedAt });
  store.snapshots.push(aprilSnapshot);
  store.pendingItems.push(...aprilPendingItems(april, aprilSnapshot));

  store.periods.sort((left, right) => left.periodCode.localeCompare(right.periodCode) || left.version - right.version);
  return store;
}

function homologationStore() {
  if (!globalState.__irpjCsllHomologationStore) globalState.__irpjCsllHomologationStore = createInitialStore();
  return globalState.__irpjCsllHomologationStore;
}

export function resetIrpjCsllHomologationStoreForTests() {
  globalState.__irpjCsllHomologationStore = createInitialStore();
  return globalState.__irpjCsllHomologationStore;
}

function fakeUser(): User {
  return {
    id: IRPJ_CSLL_HOMOLOGATION_USER.id,
    aud: "authenticated",
    role: "authenticated",
    email: IRPJ_CSLL_HOMOLOGATION_USER.email,
    email_confirmed_at: CREATED_AT,
    phone: "",
    confirmed_at: CREATED_AT,
    last_sign_in_at: CREATED_AT,
    app_metadata: { provider: "homologation", providers: ["homologation"] },
    user_metadata: { name: IRPJ_CSLL_HOMOLOGATION_USER.name },
    identities: [],
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  } as User;
}

function requireHomologationAccess(request: Request, options: { readonly write?: boolean } = {}): FiscalAccessContext {
  if (!isIrpjCsllHomologationMode()) {
    throw new FiscalAccessError(500, "HOMOLOGATION_MODE_DISABLED", "Modo de homologação IRPJ/CSLL não habilitado.");
  }
  const token = bearerToken(request);
  if (token !== IRPJ_CSLL_HOMOLOGATION_TOKEN) {
    throw new FiscalAccessError(401, "INVALID_HOMOLOGATION_TOKEN", "Token de homologação IRPJ/CSLL inválido.");
  }
  const scope = parseFiscalRequestScope(request);
  const competence = assertFiscalCompetence(scope.competence);
  if (!scope.companyId && !scope.companyCode) throw new FiscalAccessError(400, "MISSING_COMPANY", "Empresa obrigatória.");
  if (scope.companyId && scope.companyId !== IRPJ_CSLL_HOMOLOGATION_COMPANY.id) {
    throw new FiscalAccessError(403, "COMPANY_NOT_LINKED", "Empresa não pertence à fixture local de homologação IRPJ/CSLL.");
  }
  if (scope.companyCode && scope.companyCode !== IRPJ_CSLL_HOMOLOGATION_COMPANY.code) {
    throw new FiscalAccessError(403, "COMPANY_NOT_LINKED", "Coligada não pertence à fixture local de homologação IRPJ/CSLL.");
  }
  return {
    client: {} as FiscalAccessContext["client"],
    user: fakeUser(),
    accessToken: token,
    company: {
      id: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
      code: IRPJ_CSLL_HOMOLOGATION_COMPANY.code,
      name: IRPJ_CSLL_HOMOLOGATION_COMPANY.name,
      cnpj: IRPJ_CSLL_HOMOLOGATION_COMPANY.cnpj,
      profile: IRPJ_CSLL_HOMOLOGATION_COMPANY.profile,
    },
    canWrite: options.write ? true : true,
    allowedModules: ["contabil"],
    competence,
  };
}

function fiscalBalancesFromSnapshot(snapshot: SourceSnapshot): FiscalBalanceAvailable[] {
  const rows = Array.isArray(snapshot.parameters.fiscalBalances) ? snapshot.parameters.fiscalBalances : [];
  return rows.map((row) => {
    const item = jsonObject(row);
    return {
      id: requiredText(item.id, "Saldo fiscal"),
      tax: enumValue(item.tax, ["IRPJ", "CSLL"] as const, "Tributo"),
      balanceType: enumValue(item.balanceType, ["PREJUIZO_FISCAL", "BASE_NEGATIVA_CSLL"] as const, "Tipo do saldo"),
      originYear: item.originYear === null || item.originYear === undefined ? null : requiredInt(item.originYear, "Ano de origem"),
      availableAmount: requiredText(item.availableAmount, "Valor disponível"),
      source: jsonObject(item.source),
    };
  });
}

function taxCreditsFromSnapshot(snapshot: SourceSnapshot): FiscalCreditAvailable[] {
  const rows = Array.isArray(snapshot.parameters.taxCredits) ? snapshot.parameters.taxCredits : [];
  return rows.map((row) => {
    const item = jsonObject(row);
    return {
      id: requiredText(item.id, "Crédito fiscal"),
      tax: enumValue(item.tax, ["IRPJ", "CSLL"] as const, "Tributo"),
      nature: enumValue(item.nature, ["IRRF_SERVICOS", "IRRF_APLICACOES_FINANCEIRAS", "CSLL_EXPLICIT_DEDUCTION"] as const, "Natureza do crédito"),
      label: optionalText(item.label) ?? undefined,
      availableAmount: requiredText(item.availableAmount, "Valor disponível"),
      source: jsonObject(item.source),
    };
  });
}

function accountingResultValue(value: unknown) {
  const direct = optionalText(value);
  if (direct) return direct;
  const source = jsonObject(value);
  return optionalText(source.value);
}
function accountingResultYtdFromSnapshot(snapshot: SourceSnapshot, payload: PreviewPayload = {}): AccountingResultYtdInput {
  const explicit = accountingResultValue(payload.accountingResultYtd);
  const value = explicit ?? requiredText(snapshot.parameters.accountingResultYtd, "Resultado contábil acumulado");
  return {
    value,
    source: {
      origin: explicit ? "REQUEST_BODY" : "SOURCE_SNAPSHOT",
      sourceSnapshotId: snapshot.id,
      sourceSnapshotHash: snapshot.hash,
      path: explicit ? "payload.accountingResultYtd" : "parameters.accountingResultYtd",
    } as JsonObject,
  };
}
function accountingResultYtdForTaxFromSnapshot(tax: "IRPJ" | "CSLL", snapshot: SourceSnapshot, payload: PreviewPayload = {}): AccountingResultYtdInput | undefined {
  const field = tax === "IRPJ" ? "accountingResultBeforeIrpjYtd" : "accountingResultBeforeCsllYtd";
  const label = tax === "IRPJ" ? "Resultado contábil antes do IRPJ" : "Resultado contábil antes da CSLL";
  const payloadValue = tax === "IRPJ" ? payload.accountingResultBeforeIrpjYtd : payload.accountingResultBeforeCsllYtd;
  const nestedPayload = jsonObject(payload.accountingResultYtdByTax)[tax];
  const explicit = accountingResultValue(payloadValue ?? nestedPayload);
  if (explicit) return { value: explicit, source: { origin: "REQUEST_BODY", sourceSnapshotId: snapshot.id, sourceSnapshotHash: snapshot.hash, path: `payload.${field}`, tax, label } as JsonObject };
  const snapshotParameters = jsonObject(snapshot.parameters);
  const snapshotBalances = jsonObject(snapshot.balances);
  const parameterFiscal = jsonObject(snapshotParameters.fiscal);
  const balanceFiscal = jsonObject(snapshotBalances.fiscal);
  const parameterByTax = jsonObject(snapshotParameters.accountingResultYtdByTax);
  const balanceByTax = jsonObject(snapshotBalances.accountingResultYtdByTax);
  const candidates = [
    { value: snapshotParameters[field], path: `parameters.${field}` },
    { value: parameterFiscal[field], path: `parameters.fiscal.${field}` },
    { value: parameterByTax[tax], path: `parameters.accountingResultYtdByTax.${tax}` },
    { value: snapshotBalances[field], path: `balances.${field}` },
    { value: balanceFiscal[field], path: `balances.fiscal.${field}` },
    { value: balanceByTax[tax], path: `balances.accountingResultYtdByTax.${tax}` },
  ];
  for (const candidate of candidates) {
    const value = accountingResultValue(candidate.value);
    if (value) return { value, source: { origin: "SOURCE_SNAPSHOT", sourceSnapshotId: snapshot.id, sourceSnapshotHash: snapshot.hash, path: candidate.path, tax, label } as JsonObject };
  }
  return undefined;
}
function accountingResultYtdByTaxFromSnapshot(snapshot: SourceSnapshot, payload: PreviewPayload = {}): AccountingResultByTaxInput | undefined {
  const irpj = accountingResultYtdForTaxFromSnapshot("IRPJ", snapshot, payload);
  const csll = accountingResultYtdForTaxFromSnapshot("CSLL", snapshot, payload);
  if (!irpj && !csll) return undefined;
  return { ...(irpj ? { IRPJ: irpj } : {}), ...(csll ? { CSLL: csll } : {}) };
}
function priorClosedCalculations(store: HomologationStore, state: HomologationState) {
  if (!state.taxPeriod) return [];
  const current = state.taxPeriod;
  const priorPeriods = store.periods
    .filter((period) => period.periodType === "MONTHLY_ESTIMATE")
    .filter((period) => period.status === "CLOSED_CURRENT")
    .filter((period) => period.endDate < current.endDate)
    .sort((left, right) => left.endDate.localeCompare(right.endDate));
  return priorPeriods.flatMap((period) => store.taxCalculations.filter((calculation) => calculation.taxPeriodId === period.id && calculation.versionStatus === "CLOSED_CURRENT"));
}

function nextCalculationVersion(calculations: readonly TaxCalculation[]) {
  return Math.max(0, ...calculations.map((calculation) => calculation.calculationVersion)) + 1;
}

function stateForRequest(request: Request): HomologationState {
  const access = requireHomologationAccess(request);
  const store = homologationStore();
  const fiscalYear = fiscalYearFromCompetence(access.competence);
  const month = monthFromCompetence(access.competence);
  const fiscalYearProfile = fiscalYear === FISCAL_YEAR ? store.fiscalYearProfile : null;
  const code = periodCodeForCompetence(fiscalYear, month);
  const allYearPeriods = store.periods
    .filter((period) => period.companyId === access.company.id && period.fiscalYear === fiscalYear)
    .sort((left, right) => left.periodCode.localeCompare(right.periodCode) || left.version - right.version);
  const periodVersions = allYearPeriods
    .filter((period) => period.periodCode === code)
    .sort((left, right) => right.version - left.version);
  const taxPeriod = selectedPeriodVersion(periodVersions);
  const periodIds = periodVersions.map((period) => period.id);
  const sourceSnapshots = taxPeriod ? store.snapshots.filter((snapshot) => snapshot.taxPeriodId === taxPeriod.id) : [];
  const taxCalculations = periodIds.length ? store.taxCalculations.filter((calculation) => periodIds.includes(calculation.taxPeriodId)) : [];
  const selectedTaxCalculations = taxPeriod ? taxCalculations.filter((calculation) => calculation.taxPeriodId === taxPeriod.id) : [];
  return {
    access,
    fiscalYear,
    month,
    fiscalYearProfile,
    taxPeriod,
    periodVersions,
    allYearPeriods,
    sourceSnapshots,
    sourceSnapshot: sourceSnapshots[0] ?? null,
    pendingItems: taxPeriod ? store.pendingItems.filter((item) => item.taxPeriodId === taxPeriod.id) : [],
    ruleExecutionResults: taxPeriod ? store.ruleExecutionResults.filter((item) => item.taxPeriodId === taxPeriod.id) : [],
    taxAdjustments: taxPeriod ? store.taxAdjustments.filter((item) => item.taxPeriodId === taxPeriod.id) : [],
    taxCalculations,
    taxCalculation: latestCalculation(selectedTaxCalculations),
    humanDecisions: taxPeriod ? store.humanDecisions.filter((item) => item.taxPeriodId === taxPeriod.id) : [],
    dossiers: store.dossiers.filter((item) => periodIds.includes(item.taxPeriodId)),
  };
}

function closeIssuesForState(state: HomologationState): readonly CloseTaxPeriodIssue[] {
  if (!state.taxPeriod) {
    return [{ code: "MISSING_TAX_PERIOD", message: "Período fiscal não encontrado para a competência.", severity: "BLOCKING", metadata: { competence: state.access.competence } }];
  }
  if (!state.sourceSnapshot) {
    return [{ code: "MISSING_SOURCE_SNAPSHOT", message: "Fechamento exige SOURCE_SNAPSHOT persistido antes do motor fiscal.", severity: "BLOCKING", metadata: { sequence: "TOTVS_SOURCE_SNAPSHOT_FISCAL_ENGINE" } }];
  }
  if (state.taxPeriod.status === "CLOSED_CURRENT" || state.taxPeriod.status === "CLOSED_SUPERSEDED") {
    return [];
  }
  if (fiscalEngine(state.fiscalYearProfile, state.taxPeriod).code !== "ANNUAL_MONTHLY") {
    return [{ code: "ENGINE_NOT_ENABLED_FOR_REGIME", message: "Fechamento mensal ainda não está habilitado para este regime/periodicidade.", severity: "BLOCKING", metadata: { periodicity: state.fiscalYearProfile?.periodicity ?? null } }];
  }
  return validateCloseTaxPeriod({
    companyId: state.access.company.id,
    taxPeriod: state.taxPeriod,
    sourceSnapshot: state.sourceSnapshot,
    taxCalculation: state.taxCalculation,
    taxAdjustments: state.taxAdjustments,
    pendingItems: state.pendingItems,
    humanDecisions: state.humanDecisions,
    periodVersions: state.periodVersions,
    expectedMatrixVersion: state.taxCalculation?.matrixVersion,
    companyCode: state.access.company.code,
    companyName: state.access.company.name,
    userId: state.access.user.id,
    userEmail: state.access.user.email ?? "",
  });
}

function dashboardFromState(state: HomologationState): IrpjCsllDashboardResponse {
  const closeIssues = closeIssuesForState(state);
  const isClosedPeriod = state.taxPeriod?.status === "CLOSED_CURRENT" || state.taxPeriod?.status === "CLOSED_SUPERSEDED";
  return {
    ok: true,
    backend: "supabase",
    sourceSequence: "TOTVS -> SOURCE_SNAPSHOT persistido -> motor fiscal",
    company: {
      id: state.access.company.id,
      code: state.access.company.code,
      name: state.access.company.name,
      profile: state.access.company.profile,
    },
    competence: state.access.competence,
    canWrite: state.access.canWrite,
    fiscalYearProfile: state.fiscalYearProfile,
    taxPeriod: state.taxPeriod,
    periodVersions: state.periodVersions,
    allYearPeriods: state.allYearPeriods,
    engine: fiscalEngine(state.fiscalYearProfile, state.taxPeriod),
    sourceSnapshot: state.sourceSnapshot,
    sourceSnapshots: state.sourceSnapshots,
    pendingItems: state.pendingItems,
    ruleExecutionResults: state.ruleExecutionResults,
    taxAdjustments: state.taxAdjustments,
    taxCalculations: state.taxCalculations,
    taxCalculation: state.taxCalculation,
    humanDecisions: state.humanDecisions,
    dossiers: state.dossiers,
    closeIssues,
    closeAllowed: !isClosedPeriod && closeIssues.length === 0,
    annualAdjustmentPeriodCode: annualAdjustmentPeriodCode(state.fiscalYear),
  };
}

export async function loadHomologationDashboard(request: Request): Promise<IrpjCsllDashboardResponse> {
  return dashboardFromState(stateForRequest(request));
}

function assertRunnable(state: HomologationState) {
  if (!state.fiscalYearProfile) throw new FiscalAccessError(409, "MISSING_FISCAL_YEAR_PROFILE", "Perfil fiscal do exercício não encontrado.");
  if (!state.taxPeriod) throw new FiscalAccessError(409, "MISSING_TAX_PERIOD", "Período fiscal não encontrado.");
  if (!state.sourceSnapshot) throw new FiscalAccessError(409, "MISSING_SOURCE_SNAPSHOT", "SOURCE_SNAPSHOT persistido é obrigatório antes do motor fiscal.");
  if (state.taxPeriod.status === "CLOSED_CURRENT" || state.taxPeriod.status === "CLOSED_SUPERSEDED") throw new FiscalAccessError(409, "PERIOD_ALREADY_CLOSED", "Período fechado é imutável.");
  return { fiscalYearProfile: state.fiscalYearProfile, taxPeriod: state.taxPeriod, sourceSnapshot: state.sourceSnapshot };
}

function payloadVersionStatus(value: unknown): TaxCalculationVersionStatus {
  if (!value) return "DRAFT";
  return enumValue(value, ["DRAFT", "REVIEW", "CLOSED_CURRENT", "CLOSED_SUPERSEDED"] as const, "Status da versão do cálculo");
}

async function runHomologationEngine(request: Request, payload: PreviewPayload = {}, options: { readonly preferFreshCalculation?: boolean } = {}) {
  requireHomologationAccess(request, { write: true });
  const state = stateForRequest(request);
  const store = homologationStore();
  const runnable = assertRunnable(state);
  const calculation = calculateAnnualMonthly({
    companyId: state.access.company.id,
    fiscalYearProfile: runnable.fiscalYearProfile,
    taxPeriod: runnable.taxPeriod,
    sourceSnapshot: runnable.sourceSnapshot,
    accountingResultYtd: accountingResultYtdFromSnapshot(runnable.sourceSnapshot, payload),
    accountingResultYtdByTax: accountingResultYtdByTaxFromSnapshot(runnable.sourceSnapshot, payload),
    taxAdjustments: state.taxAdjustments,
    fiscalBalances: fiscalBalancesFromSnapshot(runnable.sourceSnapshot),
    taxCredits: taxCreditsFromSnapshot(runnable.sourceSnapshot),
    priorCalculations: priorClosedCalculations(store, state),
    pendingItems: state.pendingItems,
    matrixVersion: MATRIX_VERSION,
    calculationVersion: nextCalculationVersion(state.taxCalculations.filter((calculation) => calculation.taxPeriodId === runnable.taxPeriod.id)),
    versionStatus: payloadVersionStatus(payload.versionStatus),
    createdAt: new Date().toISOString(),
  });
  if (!calculation.taxCalculation) throw new FiscalAccessError(409, "ENGINE_NOT_ENABLED_FOR_REGIME", "Motor mensal não habilitado para este regime/periodicidade.");
  store.taxCalculations.push(calculation.taxCalculation);
  replacePeriod(store.periods, {
    ...runnable.taxPeriod,
    status: periodStatusFromCalculation(calculation.taxCalculation),
    updatedAt: calculation.taxCalculation.createdAt,
  });
  const dashboard = dashboardFromState(stateForRequest(request));
  if (options.preferFreshCalculation && dashboard.taxPeriod?.id === runnable.taxPeriod.id) {
    return { ...dashboard, taxCalculation: calculation.taxCalculation };
  }
  return dashboard;
}

export async function previewHomologationMonthly(request: Request, payload: PreviewPayload = {}) {
  return runHomologationEngine(request, payload, { preferFreshCalculation: true });
}

export async function reprocessHomologationMonthly(request: Request, payload: PreviewPayload = {}) {
  return runHomologationEngine(request, payload);
}

function originValue(pendingItem: PendingItem, key: string) {
  return (pendingItem.originData as Record<string, unknown>)[key];
}

function pendingFor(request: Request, pendingId: string) {
  requireHomologationAccess(request, { write: true });
  const store = homologationStore();
  const pendingItem = store.pendingItems.find((item) => item.id === pendingId);
  if (!pendingItem) throw new FiscalAccessError(404, "PENDING_ITEM_NOT_FOUND", "Pendência não encontrada na homologação local.");
  const period = store.periods.find((item) => item.id === pendingItem.taxPeriodId);
  const snapshot = store.snapshots.find((item) => item.id === pendingItem.sourceSnapshotId);
  if (!period || !snapshot) throw new FiscalAccessError(409, "PENDING_CONTEXT_NOT_FOUND", "Contexto da pendência não encontrado.");
  return { store, pendingItem, period, snapshot };
}

function replacePending(store: HomologationStore, pendingItem: PendingItem) {
  const index = store.pendingItems.findIndex((item) => item.id === pendingItem.id);
  if (index >= 0) store.pendingItems[index] = pendingItem;
  else store.pendingItems.push(pendingItem);
}

export async function classifyHomologationPending(request: Request, pendingId: string, payload: ClassifyPayload) {
  const { store, pendingItem, period, snapshot } = pendingFor(request, pendingId);
  const result = classifyNewAccount({
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    taxPeriod: period,
    sourceSnapshot: snapshot,
    pendingItem,
    accountingChartId: requiredText(payload.accountingChartId ?? originValue(pendingItem, "accountingChartId"), "Plano de contas"),
    accountCode: requiredText(payload.accountCode ?? originValue(pendingItem, "accountCode"), "Conta contábil"),
    reducedCode: optionalText(payload.reducedCode ?? originValue(pendingItem, "reducedCode")),
    fiscalNatureCode: requiredText(payload.fiscalNatureCode, "Código da natureza fiscal"),
    fiscalNatureName: requiredText(payload.fiscalNatureName, "Nome da natureza fiscal"),
    fiscalNatureDescription: optionalText(payload.fiscalNatureDescription) ?? undefined,
    fiscalRuleCode: requiredText(payload.fiscalRuleCode, "Código da regra fiscal"),
    irpjTreatment: enumValue(payload.irpjTreatment, ["NO_ADJUSTMENT", "ADDITION", "EXCLUSION", "CONDITIONAL", "AUTOMATIC_SPECIAL"] as const, "Tratamento IRPJ"),
    csllTreatment: enumValue(payload.csllTreatment, ["NO_ADJUSTMENT", "ADDITION", "EXCLUSION", "CONDITIONAL", "AUTOMATIC_SPECIAL"] as const, "Tratamento CSLL"),
    amountBasis: payload.amountBasis ? enumValue(payload.amountBasis, ["NET_DEBIT_MOVEMENT", "NET_CREDIT_MOVEMENT"] as const, "Base do valor") : undefined,
    matrixVersionBefore: 53,
    justification: requiredText(payload.justification, "Justificativa"),
    userId: IRPJ_CSLL_HOMOLOGATION_USER.id,
    userEmail: IRPJ_CSLL_HOMOLOGATION_USER.email,
    timestamp: new Date().toISOString(),
  });
  store.fiscalNatures.push(result.generatedFiscalNature);
  store.fiscalRules.push(result.generatedFiscalRule);
  store.mappings.push(result.generatedMapping);
  replacePending(store, result.resolvedPendingItem);
  store.humanDecisions.push(result.decision);
  return dashboardFromState(stateForRequest(request));
}

export async function confirmHomologationAutomaticClassification(request: Request, pendingId: string) {
  const { store, pendingItem, period, snapshot } = pendingFor(request, pendingId);
  const result = confirmAutomaticNewAccountClassification({
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    taxPeriod: period,
    sourceSnapshot: snapshot,
    pendingItem,
    matrixVersionBefore: 53,
    userId: IRPJ_CSLL_HOMOLOGATION_USER.id,
    userEmail: IRPJ_CSLL_HOMOLOGATION_USER.email,
    timestamp: new Date().toISOString(),
  });
  replacePending(store, result.resolvedPendingItem);
  store.humanDecisions.push(result.decision);
  return dashboardFromState(stateForRequest(request));
}

export async function correctHomologationAutomaticClassification(request: Request, pendingId: string, payload: ClassifyPayload) {
  const { store, pendingItem, period, snapshot } = pendingFor(request, pendingId);
  const result = correctAutomaticNewAccountClassification({
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    taxPeriod: period,
    sourceSnapshot: snapshot,
    pendingItem,
    accountingChartId: requiredText(payload.accountingChartId ?? originValue(pendingItem, "accountingChartId"), "Plano de contas"),
    accountCode: requiredText(payload.accountCode ?? originValue(pendingItem, "accountCode"), "Conta contábil"),
    reducedCode: optionalText(payload.reducedCode ?? originValue(pendingItem, "reducedCode")),
    fiscalNatureCode: requiredText(payload.fiscalNatureCode, "Código da natureza fiscal"),
    fiscalNatureName: requiredText(payload.fiscalNatureName, "Nome da natureza fiscal"),
    fiscalNatureDescription: optionalText(payload.fiscalNatureDescription) ?? undefined,
    fiscalRuleCode: requiredText(payload.fiscalRuleCode, "Código da regra fiscal"),
    irpjTreatment: enumValue(payload.irpjTreatment, ["NO_ADJUSTMENT", "ADDITION", "EXCLUSION", "CONDITIONAL", "AUTOMATIC_SPECIAL"] as const, "Tratamento IRPJ"),
    csllTreatment: enumValue(payload.csllTreatment, ["NO_ADJUSTMENT", "ADDITION", "EXCLUSION", "CONDITIONAL", "AUTOMATIC_SPECIAL"] as const, "Tratamento CSLL"),
    amountBasis: payload.amountBasis ? enumValue(payload.amountBasis, ["NET_DEBIT_MOVEMENT", "NET_CREDIT_MOVEMENT"] as const, "Base do valor") : undefined,
    matrixVersionBefore: 53,
    justification: requiredText(payload.justification, "Justificativa"),
    userId: IRPJ_CSLL_HOMOLOGATION_USER.id,
    userEmail: IRPJ_CSLL_HOMOLOGATION_USER.email,
    timestamp: new Date().toISOString(),
  });
  store.fiscalNatures.push(result.generatedFiscalNature);
  store.fiscalRules.push(result.generatedFiscalRule);
  store.mappings.push(result.generatedMapping);
  replacePending(store, result.resolvedPendingItem);
  store.humanDecisions.push(result.decision);
  return dashboardFromState(stateForRequest(request));
}
export async function resolveHomologationConditional(request: Request, pendingId: string, payload: ConditionalPayload) {
  const { store, pendingItem, period, snapshot } = pendingFor(request, pendingId);
  const result = resolveConditionalOccurrence({
    companyId: IRPJ_CSLL_HOMOLOGATION_COMPANY.id,
    taxPeriod: period,
    sourceSnapshot: snapshot,
    pendingItem,
    accountCode: requiredText(payload.accountCode ?? originValue(pendingItem, "accountCode"), "Conta contábil"),
    reducedCode: optionalText(payload.reducedCode ?? originValue(pendingItem, "reducedCode")),
    accountDescription: optionalText(payload.accountDescription ?? originValue(pendingItem, "accountDescription")) ?? undefined,
    accountingChartId: requiredText(payload.accountingChartId ?? originValue(pendingItem, "accountingChartId"), "Plano de contas"),
    companyAccountingChartId: requiredText(payload.companyAccountingChartId ?? originValue(pendingItem, "companyAccountingChartId"), "Plano de contas da empresa"),
    accountFiscalMappingId: requiredText(payload.accountFiscalMappingId ?? originValue(pendingItem, "accountFiscalMappingId"), "Mapeamento fiscal"),
    accountFiscalMappingVersion: requiredInt(payload.accountFiscalMappingVersion ?? originValue(pendingItem, "accountFiscalMappingVersion"), "Versão do mapeamento fiscal"),
    fiscalNatureId: requiredText(payload.fiscalNatureId ?? originValue(pendingItem, "fiscalNatureId"), "Natureza fiscal"),
    fiscalRuleId: requiredText(payload.fiscalRuleId ?? originValue(pendingItem, "fiscalRuleId"), "Regra fiscal"),
    fiscalRuleVersion: requiredInt(payload.fiscalRuleVersion ?? originValue(pendingItem, "fiscalRuleVersion"), "Versão da regra fiscal"),
    companyAccountMappingOverrideId: optionalText(payload.companyAccountMappingOverrideId ?? originValue(pendingItem, "companyAccountMappingOverrideId")),
    companyAccountMappingOverrideVersion: payload.companyAccountMappingOverrideVersion ?? originValue(pendingItem, "companyAccountMappingOverrideVersion") ? requiredInt(payload.companyAccountMappingOverrideVersion ?? originValue(pendingItem, "companyAccountMappingOverrideVersion"), "Versão do override de mapeamento") : null,
    companyRuleOverrideId: optionalText(payload.companyRuleOverrideId ?? originValue(pendingItem, "companyRuleOverrideId")),
    companyRuleOverrideVersion: payload.companyRuleOverrideVersion ?? originValue(pendingItem, "companyRuleOverrideVersion") ? requiredInt(payload.companyRuleOverrideVersion ?? originValue(pendingItem, "companyRuleOverrideVersion"), "Versão do override de regra") : null,
    irpjDecision: enumValue(payload.irpjDecision, ["ADDITION", "EXCLUSION", "NO_ADJUSTMENT"] as const, "Decisão IRPJ"),
    csllDecision: enumValue(payload.csllDecision, ["ADDITION", "EXCLUSION", "NO_ADJUSTMENT"] as const, "Decisão CSLL"),
    amount: requiredText(payload.amount ?? originValue(pendingItem, "amount"), "Valor da ocorrência"),
    sourceContext: jsonObject(payload.sourceContext ?? pendingItem.originData),
    matrixVersionBefore: 53,
    justification: requiredText(payload.justification, "Justificativa"),
    userId: IRPJ_CSLL_HOMOLOGATION_USER.id,
    userEmail: IRPJ_CSLL_HOMOLOGATION_USER.email,
    timestamp: new Date().toISOString(),
  });
  replacePending(store, result.resolvedPendingItem);
  store.humanDecisions.push(result.decision);
  store.ruleExecutionResults.push(result.ruleExecutionResult);
  store.taxAdjustments.push(...result.taxAdjustments);
  return dashboardFromState(stateForRequest(request));
}

export async function openHomologationVersion(request: Request) {
  requireHomologationAccess(request, { write: true });
  const state = stateForRequest(request);
  const store = homologationStore();
  if (!state.taxPeriod) throw new FiscalAccessError(409, "MISSING_TAX_PERIOD", "Período fiscal não encontrado.");
  if (state.taxPeriod.periodCode !== "2026-M03" || state.taxPeriod.version < 2 || state.taxPeriod.status !== "CLOSED_CURRENT") {
    throw new FiscalAccessError(409, "HOMOLOGATION_NEW_VERSION_REQUIRES_M03_CURRENT", "Abertura local de nova versão exige M03 V02 ou posterior CLOSED_CURRENT em homologação.");
  }

  const { newPeriod } = openNewTaxPeriodVersion({ currentPeriod: state.taxPeriod, timestamp: new Date().toISOString() });
  const input = monthlyInputs(3, newPeriod, newPeriod.version);
  const snapshot = snapshotFor({
    period: newPeriod,
    accountingResultYtd: input.accountingResultYtd,
    accountingResultBeforeIrpjYtd: input.accountingResultBeforeIrpjYtd,
    accountingResultBeforeCsllYtd: input.accountingResultBeforeCsllYtd,
    fiscalBalances: input.fiscalBalances,
    taxCredits: input.taxCredits,
    records: input.records,
    extractedAt: input.extractedAt,
  });
  const generated = adjustmentSet(newPeriod, snapshot, input.adjustments, input.extractedAt);

  replacePeriod(store.periods, newPeriod);
  store.snapshots.push(snapshot);
  store.ruleExecutionResults.push(...generated.ruleExecutionResults);
  store.taxAdjustments.push(...generated.taxAdjustments);
  store.periods.sort((left, right) => left.periodCode.localeCompare(right.periodCode) || left.version - right.version);
  return dashboardFromState(stateForRequest(request));
}

export async function closeHomologationMonthly(request: Request) {
  requireHomologationAccess(request, { write: true });
  const state = stateForRequest(request);
  const store = homologationStore();
  if (!state.taxPeriod) throw new FiscalAccessError(409, "MISSING_TAX_PERIOD", "Período fiscal não encontrado.");
  if (!state.sourceSnapshot) throw new FiscalAccessError(409, "MISSING_SOURCE_SNAPSHOT", "SOURCE_SNAPSHOT persistido é obrigatório antes do fechamento.");
  const result = closeTaxPeriod({
    companyId: state.access.company.id,
    taxPeriod: state.taxPeriod,
    sourceSnapshot: state.sourceSnapshot,
    taxCalculation: state.taxCalculation,
    taxAdjustments: state.taxAdjustments,
    pendingItems: state.pendingItems,
    humanDecisions: state.humanDecisions,
    periodVersions: state.periodVersions,
    expectedMatrixVersion: state.taxCalculation?.matrixVersion,
    companyCode: state.access.company.code,
    companyName: state.access.company.name,
    userId: state.access.user.id,
    userEmail: state.access.user.email ?? "",
    timestamp: new Date().toISOString(),
  });
  if (!result.closed || !result.taxCalculation || !result.manifest) {
    return { ...dashboardFromState(state), closeIssues: result.issues, closeAllowed: false };
  }
  const closedPeriod: WorkflowTaxPeriod = {
    ...result.taxPeriod,
    closedManifestId: result.manifest.id,
    closedManifest: result.manifest,
    closedAt: result.manifest.createdAt,
    closedBy: result.manifest.createdBy,
  };
  replacePeriod(store.periods, closedPeriod);
  replaceCalculation(store.taxCalculations, result.taxCalculation);
  for (const superseded of result.supersededPeriods) {
    replacePeriod(store.periods, superseded);
    for (const calculation of store.taxCalculations.filter((item) => item.taxPeriodId === superseded.id)) {
      replaceCalculation(store.taxCalculations, { ...calculation, versionStatus: "CLOSED_SUPERSEDED" });
    }
  }
  return dashboardFromState(stateForRequest(request));
}

function allPeriodIdsForAccess(access: FiscalAccessContext) {
  const fiscalYear = fiscalYearFromCompetence(access.competence);
  return homologationStore().periods.filter((period) => period.companyId === access.company.id && period.fiscalYear === fiscalYear).map((period) => period.id);
}

function artifactByKind(dossier: TaxDossierRecord, kind: string) {
  const normalized = kind.toLowerCase();
  return dossier.artifactMetadata.find((artifact) => {
    if (normalized === "xlsx") return artifact.type === "XLSX";
    if (normalized === "pdf") return artifact.type === "PDF";
    if (normalized === "comparison") return artifact.type === "COMPARISON_JSON";
    return artifact.type === kind;
  }) ?? null;
}

function selectedDossierPeriod(access: FiscalAccessContext, payload: DossierPayload = {}) {
  const store = homologationStore();
  if (payload.taxPeriodId) {
    const period = store.periods.find((item) => item.id === String(payload.taxPeriodId));
    if (!period) throw new FiscalAccessError(404, "TAX_PERIOD_NOT_FOUND", "Período fiscal não encontrado na homologação local.");
    return period;
  }
  const period = store.periods
    .filter((item) => item.status === "CLOSED_CURRENT")
    .filter((item) => item.periodType === "MONTHLY_ESTIMATE" && item.endDate.slice(0, 7) === access.competence)
    .sort((left, right) => right.version - left.version)[0];
  if (!period) throw new FiscalAccessError(404, "CLOSED_TAX_PERIOD_NOT_FOUND", "Nenhuma versão fechada encontrada para a competência.");
  return period;
}

function closedCalculationForPeriod(store: HomologationStore, period: WorkflowTaxPeriod) {
  const manifestCalculationId = typeof period.closedManifest?.taxCalculationId === "string" ? period.closedManifest.taxCalculationId : null;
  const calculation = manifestCalculationId
    ? store.taxCalculations.find((item) => item.id === manifestCalculationId)
    : latestCalculation(store.taxCalculations.filter((item) => item.taxPeriodId === period.id));
  if (!calculation) throw new FiscalAccessError(409, "MISSING_TAX_CALCULATION", "Cálculo congelado da versão fechada não encontrado.");
  return calculation;
}

function snapshotForClosedPeriod(store: HomologationStore, period: WorkflowTaxPeriod, calculation: TaxCalculation) {
  const manifestSnapshotId = typeof period.closedManifest?.sourceSnapshotId === "string" ? period.closedManifest.sourceSnapshotId : null;
  const snapshot = store.snapshots.find((item) => item.id === (manifestSnapshotId ?? calculation.sourceSnapshotId));
  if (!snapshot) throw new FiscalAccessError(409, "MISSING_SOURCE_SNAPSHOT", "SOURCE_SNAPSHOT congelado da versão fechada não encontrado.");
  return snapshot;
}

function dossierModel(access: FiscalAccessContext, period: WorkflowTaxPeriod) {
  const store = homologationStore();
  const taxCalculation = closedCalculationForPeriod(store, period);
  const sourceSnapshot = snapshotForClosedPeriod(store, period, taxCalculation);
  return buildMonthlyTaxDossierModel({
    company: {
      id: access.company.id,
      code: access.company.code,
      name: access.company.name,
      cnpj: access.company.cnpj,
    },
    fiscalYearProfile: store.fiscalYearProfile,
    taxPeriod: period,
    sourceSnapshot,
    taxCalculation,
    taxAdjustments: store.taxAdjustments.filter((item) => item.taxPeriodId === period.id),
    ruleExecutionResults: store.ruleExecutionResults.filter((item) => item.taxPeriodId === period.id),
    humanDecisions: store.humanDecisions.filter((item) => item.taxPeriodId === period.id),
    pendingItems: store.pendingItems.filter((item) => item.taxPeriodId === period.id),
    closedManifest: period.closedManifest,
    matrixHash: MATRIX_HASH,
    generatedAt: new Date(period.closedAt ?? CREATED_AT),
  });
}

function previousClosedModel(access: FiscalAccessContext, current: WorkflowTaxPeriod) {
  const store = homologationStore();
  const previous = store.periods
    .filter((period) => samePeriod(period, current))
    .filter((period) => period.status === "CLOSED_CURRENT" || period.status === "CLOSED_SUPERSEDED")
    .filter((period) => period.version < current.version)
    .sort((left, right) => right.version - left.version)[0] ?? null;
  return previous ? dossierModel(access, previous) : null;
}

function saveArtifacts(store: HomologationStore, dossier: TaxDossierRecord, artifacts: readonly MonthlyTaxDossierArtifact[]) {
  const byPath = new Map<string, Buffer>();
  for (const artifact of artifacts) byPath.set(artifact.relativePath, artifact.bytes);
  store.artifacts.set(dossier.id, byPath);
}

function isDossierMaterializationMismatch(error: unknown) {
  return error instanceof TaxDossierError
    && (error.code === "DOSSIER_MANIFEST_HASH_MISMATCH" || error.code === "DOSSIER_ARTIFACT_HASH_MISMATCH");
}


function materializeHomologationDossier(store: HomologationStore, access: FiscalAccessContext, period: WorkflowTaxPeriod, dossierPackage: ReturnType<typeof buildMonthlyTaxDossierPackage>) {
  const dossier = buildTaxDossierRecord({ package: dossierPackage, generatedBy: access.user.id, generatedAt: new Date(period.closedAt ?? CREATED_AT) });
  replaceDossier(store.dossiers, dossier);
  saveArtifacts(store, dossier, dossierPackage.artifacts);
  return dossier;
}

function ensureCurrentHomologationDossierMaterialization(access: FiscalAccessContext, dossier: TaxDossierRecord) {
  const store = homologationStore();
  const period = store.periods.find((item) => item.id === dossier.taxPeriodId);
  if (!period) throw new FiscalAccessError(404, "TAX_PERIOD_NOT_FOUND", "Período fiscal do dossiê não encontrado na homologação local.");
  const model = dossierModel(access, period);
  const previous = previousClosedModel(access, period);
  const dossierPackage = buildMonthlyTaxDossierPackage(model, previous);
  try {
    verifyExistingDossierIntegrity(dossier, dossierPackage);
    return dossier;
  } catch (error) {
    if (!isDossierMaterializationMismatch(error)) throw error;
    return materializeHomologationDossier(store, access, period, dossierPackage);
  }
}

function getDossierOrThrow(request: Request) {
  const access = requireHomologationAccess(request);
  const id = requiredText(new URL(request.url).searchParams.get("dossierId"), "Dossiê");
  const dossier = homologationStore().dossiers.find((item) => item.companyId === access.company.id && item.id === id);
  if (!dossier) throw new FiscalAccessError(404, "DOSSIER_NOT_FOUND", "Dossiê não encontrado na homologação local.");
  return { access, dossier };
}

export async function listHomologationDossiers(request: Request): Promise<IrpjCsllDossierListResponse> {
  const access = requireHomologationAccess(request);
  const periodIds = allPeriodIdsForAccess(access);
  return {
    ok: true,
    bucketPrivate: true,
    bucket: TAX_DOSSIER_BUCKET,
    dossiers: homologationStore().dossiers.filter((item) => periodIds.includes(item.taxPeriodId)),
  };
}

export async function generateHomologationDossier(request: Request, payload: DossierPayload = {}): Promise<GenerateMonthlyDossierResponse> {
  const access = requireHomologationAccess(request, { write: true });
  const store = homologationStore();
  const period = selectedDossierPeriod(access, payload);
  const model = dossierModel(access, period);
  const previous = previousClosedModel(access, period);
  const dossierPackage = buildMonthlyTaxDossierPackage(model, previous);
  const existing = store.dossiers.find((item) => item.taxPeriodId === period.id && item.status === "AVAILABLE");
  if (existing) {
    try {
      verifyExistingDossierIntegrity(existing, dossierPackage);
      return { ok: true, status: "DOSSIER_ALREADY_EXISTS", dossier: existing };
    } catch (error) {
      if (!isDossierMaterializationMismatch(error)) throw error;
      const dossier = materializeHomologationDossier(store, access, period, dossierPackage);
      return { ok: true, status: "DOSSIER_GENERATED", dossier };
    }
  }
  const dossier = materializeHomologationDossier(store, access, period, dossierPackage);
  return { ok: true, status: "DOSSIER_GENERATED", dossier };
}

export async function getHomologationDossierManifest(request: Request): Promise<MonthlyDossierManifestResponse> {
  const { access, dossier: existing } = getDossierOrThrow(request);
  const dossier = ensureCurrentHomologationDossierMaterialization(access, existing);
  return { ok: true, dossier, manifest: dossier.manifest, manifestHash: dossier.manifestHash };
}

export async function getHomologationDossierArtifact(request: Request): Promise<MonthlyDossierArtifactResponse> {
  const { access, dossier: existing } = getDossierOrThrow(request);
  const dossier = ensureCurrentHomologationDossierMaterialization(access, existing);
  const kind = requiredText(new URL(request.url).searchParams.get("artifact"), "Artefato");
  const metadata = artifactByKind(dossier, kind);
  if (!metadata) throw new FiscalAccessError(404, "DOSSIER_ARTIFACT_NOT_FOUND", "Artefato não consta no manifest do dossiê.");
  const bytes = homologationStore().artifacts.get(dossier.id)?.get(metadata.relativePath);
  if (!bytes) throw new FiscalAccessError(404, "DOSSIER_ARTIFACT_NOT_FOUND", "Artefato do dossiê não encontrado no armazenamento local.");
  if (sha256(bytes) !== metadata.hashSha256) throw new FiscalAccessError(409, "DOSSIER_ARTIFACT_HASH_MISMATCH", "Hash do artefato baixado diverge do manifest.");
  return { dossier, artifact: { ...metadata, bytes }, bytes };
}

export async function compareHomologationDossierVersions(request: Request): Promise<MonthlyDossierCompareResponse> {
  const { access, dossier: existing } = getDossierOrThrow(request);
  const dossier = ensureCurrentHomologationDossierMaterialization(access, existing);
  const metadata = artifactByKind(dossier, "comparison");
  if (!metadata) return { ok: true, dossier, comparison: null };
  const bytes = homologationStore().artifacts.get(dossier.id)?.get(metadata.relativePath);
  if (!bytes) throw new FiscalAccessError(404, "DOSSIER_ARTIFACT_NOT_FOUND", "Comparativo do dossiê não encontrado no armazenamento local.");
  if (sha256(bytes) !== metadata.hashSha256) throw new FiscalAccessError(409, "DOSSIER_ARTIFACT_HASH_MISMATCH", "Hash do comparativo diverge do manifest.");
  return { ok: true, dossier, comparison: JSON.parse(bytes.toString("utf8")) as MonthlyTaxDossierComparison };
}
