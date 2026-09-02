import { createHash } from "node:crypto";
import {
  accountingCompletionIdentity,
  type ScheduleCompletion,
} from "../schedule-completion.ts";
import {
  ANNUAL_MONTHLY_ENGINE,
  calculateAnnualMonthly,
  type AccountingResultByTaxInput,
  type AccountingResultYtdInput,
  type CalculateAnnualMonthlyInput,
  type FiscalBalanceAvailable,
  type FiscalCreditAvailable,
  type TaxCalculation,
  type TaxCalculationVersionStatus,
} from "./annual-monthly-engine.ts";
import {
  buildTaxAdjustmentLogicalKey,
  executeFullAccount,
  isMovedTrialBalanceRecord,
  type AccountFiscalMapping,
  type AccountingChart,
  type CompanyAccountingChart,
  type CompanyAccountMappingOverride,
  type CompanyRuleOverride,
  type FiscalAutomationLevel,
  type FiscalNature,
  type FiscalRule,
  type FiscalRuleExecutionMethod,
  type FiscalTax,
  type FiscalTreatment,
  type PendingItem,
  type PendingItemDraft,
  type RuleExecutionResult,
  type TaxAdjustment,
  type TaxAdjustmentType,
} from "./fiscal-matrix.ts";
import {
  runFiscalAutoOnboarding,
  type AutoOnboardingDecision,
} from "./matrix-seed.ts";
import { assertIsoDate } from "./periods.ts";
import { canonicalJson, normalizeMoney } from "./source-snapshot.ts";
import type {
  JsonObject,
  JsonValue,
  MonetaryAmount,
  SnapshotInputObject,
  SourceSnapshot,
  TaxPeriod,
  TaxPeriodIdentity,
  TaxPeriodStatus,
} from "./types.ts";
import { assertValidVersion } from "./versioning.ts";

export const FISCAL_WORKFLOW_VERSION = 1;
export const TAX_WORKFLOW_HUMAN_DECISION_TYPES = [
  "NEW_ACCOUNT_CLASSIFICATION",
  "CONDITIONAL_OCCURRENCE",
] as const;
export const CONDITIONAL_TAX_DECISIONS = ["ADDITION", "EXCLUSION", "NO_ADJUSTMENT"] as const;

export type TaxWorkflowHumanDecisionType = (typeof TAX_WORKFLOW_HUMAN_DECISION_TYPES)[number];
export type ConditionalTaxDecision = (typeof CONDITIONAL_TAX_DECISIONS)[number];
export type WorkflowTaxPeriod = TaxPeriod & {
  readonly upstreamStale?: boolean;
  readonly closedManifestId?: string | null;
  readonly closedManifest?: JsonObject | null;
  readonly replacedByTaxPeriodId?: string | null;
  readonly closedAt?: string | null;
  readonly closedBy?: string | null;
};
export type FiscalMatrixContext = {
  readonly accountingCharts: readonly AccountingChart[];
  readonly companyAccountingCharts: readonly CompanyAccountingChart[];
  readonly mappings: readonly AccountFiscalMapping[];
  readonly companyAccountMappingOverrides?: readonly CompanyAccountMappingOverride[];
  readonly fiscalNatures: readonly FiscalNature[];
  readonly fiscalRules: readonly FiscalRule[];
  readonly companyRuleOverrides?: readonly CompanyRuleOverride[];
};
export type TaxWorkflowHumanDecision = {
  readonly id: string;
  readonly logicalKey: string;
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly sourceSnapshotId: string;
  readonly pendingItemId: string;
  readonly decisionType: TaxWorkflowHumanDecisionType;
  readonly userId: string;
  readonly userEmail: string | null;
  readonly justification: string;
  readonly beforeState: JsonObject;
  readonly afterState: JsonObject;
  readonly snapshotContext: JsonObject;
  readonly matrixVersionBefore: number;
  readonly matrixVersionAfter: number;
  readonly taxAdjustmentIds: readonly string[];
  readonly createdAt: string;
};
export type PreviewTaxPeriodInput = {
  readonly companyId: string;
  readonly fiscalYearProfile: CalculateAnnualMonthlyInput["fiscalYearProfile"];
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly sourceSnapshot: SourceSnapshot;
  readonly matrix: FiscalMatrixContext;
  readonly accountingResultYtd: AccountingResultYtdInput;
  readonly accountingResultYtdByTax?: AccountingResultByTaxInput;
  readonly fiscalBalances?: readonly FiscalBalanceAvailable[];
  readonly taxCredits?: readonly FiscalCreditAvailable[];
  readonly priorCalculations?: readonly TaxCalculation[];
  readonly existingPendingItems?: readonly PendingItem[];
  readonly existingRuleExecutionResults?: readonly RuleExecutionResult[];
  readonly existingTaxAdjustments?: readonly TaxAdjustment[];
  readonly matrixVersion: string;
  readonly calculationVersion?: number;
  readonly versionStatus?: TaxCalculationVersionStatus;
  readonly createdAt?: string | Date;
};
export type PreviewTaxPeriodResult = {
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly sourceSnapshot: SourceSnapshot;
  readonly autoOnboardingDecisions: readonly AutoOnboardingDecision[];
  readonly pendingItems: readonly PendingItem[];
  readonly ruleExecutionResults: readonly RuleExecutionResult[];
  readonly taxAdjustments: readonly TaxAdjustment[];
  readonly taxCalculation: TaxCalculation | null;
  readonly calculationIssues: readonly JsonObject[];
};
export type ClassifyNewAccountInput = {
  readonly companyId: string;
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly sourceSnapshot: SourceSnapshot;
  readonly pendingItem: PendingItem;
  readonly accountingChartId: string;
  readonly accountCode: string;
  readonly reducedCode?: string | null;
  readonly fiscalNatureCode: string;
  readonly fiscalNatureName: string;
  readonly fiscalNatureDescription?: string;
  readonly fiscalRuleCode: string;
  readonly irpjTreatment: FiscalTreatment;
  readonly csllTreatment: FiscalTreatment;
  readonly executionMethod?: FiscalRuleExecutionMethod;
  readonly automationLevel?: FiscalAutomationLevel;
  readonly amountBasis?: "NET_DEBIT_MOVEMENT" | "NET_CREDIT_MOVEMENT";
  readonly matrixVersionBefore: number;
  readonly justification: string;
  readonly userId: string;
  readonly userEmail?: string | null;
  readonly timestamp?: string | Date;
};
export type ClassifyNewAccountResult = {
  readonly decision: TaxWorkflowHumanDecision;
  readonly resolvedPendingItem: PendingItem;
  readonly generatedFiscalNature: FiscalNature;
  readonly generatedFiscalRule: FiscalRule;
  readonly generatedMapping: AccountFiscalMapping;
  readonly reprocessRequired: true;
};
export type ConfirmAutomaticNewAccountClassificationInput = {
  readonly companyId: string;
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly sourceSnapshot: SourceSnapshot;
  readonly pendingItem: PendingItem;
  readonly matrixVersionBefore: number;
  readonly userId: string;
  readonly userEmail?: string | null;
  readonly timestamp?: string | Date;
};
export type ConfirmAutomaticNewAccountClassificationResult = {
  readonly decision: TaxWorkflowHumanDecision;
  readonly resolvedPendingItem: PendingItem;
  readonly reprocessRequired: false;
};
export type CorrectAutomaticNewAccountClassificationInput = ClassifyNewAccountInput;
export type CorrectAutomaticNewAccountClassificationResult = ClassifyNewAccountResult;
export type ResolveConditionalOccurrenceInput = {
  readonly companyId: string;
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly sourceSnapshot: SourceSnapshot;
  readonly pendingItem: PendingItem;
  readonly accountCode: string;
  readonly reducedCode?: string | null;
  readonly accountDescription?: string;
  readonly accountingChartId: string;
  readonly companyAccountingChartId: string;
  readonly accountFiscalMappingId: string;
  readonly accountFiscalMappingVersion: number;
  readonly fiscalNatureId: string;
  readonly fiscalRuleId: string;
  readonly fiscalRuleVersion: number;
  readonly companyAccountMappingOverrideId?: string | null;
  readonly companyAccountMappingOverrideVersion?: number | null;
  readonly companyRuleOverrideId?: string | null;
  readonly companyRuleOverrideVersion?: number | null;
  readonly irpjDecision: ConditionalTaxDecision;
  readonly csllDecision: ConditionalTaxDecision;
  readonly amount: MonetaryAmount;
  readonly sourceContext?: JsonObject;
  readonly matrixVersionBefore: number;
  readonly justification: string;
  readonly userId: string;
  readonly userEmail?: string | null;
  readonly timestamp?: string | Date;
};
export type ResolveConditionalOccurrenceResult = {
  readonly decision: TaxWorkflowHumanDecision;
  readonly resolvedPendingItem: PendingItem;
  readonly ruleExecutionResult: RuleExecutionResult;
  readonly taxAdjustments: readonly TaxAdjustment[];
  readonly reprocessRequired: true;
};
export type ReviewTaxPeriodInput = {
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly userId: string;
  readonly userEmail?: string | null;
  readonly justification: string;
  readonly timestamp?: string | Date;
};
export type ReviewTaxPeriodResult = {
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly audit: JsonObject;
};
export type CloseTaxPeriodIssue = {
  readonly code: string;
  readonly message: string;
  readonly severity: "BLOCKING" | "WARNING";
  readonly metadata: JsonObject;
};
export type TaxPeriodCloseManifest = {
  readonly id: string;
  readonly logicalKey: string;
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly taxPeriod: TaxPeriodIdentity & { readonly periodType: TaxPeriod["periodType"]; readonly version: number };
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotHash: string;
  readonly taxCalculationId: string;
  readonly matrixVersion: string;
  readonly ruleVersions: TaxCalculation["ruleVersions"];
  readonly taxAdjustmentIds: readonly string[];
  readonly humanDecisionIds: readonly string[];
  readonly fiscalBalanceUsageIds: readonly string[];
  readonly creditUsageIds: readonly string[];
  readonly closedVersion: number;
  readonly scheduleModule: string;
  readonly scheduleSector: string;
  readonly createdAt: string;
  readonly createdBy: string;
};
export type CloseTaxPeriodInput = {
  readonly companyId: string;
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly sourceSnapshot: SourceSnapshot;
  readonly taxCalculation: TaxCalculation | null;
  readonly taxAdjustments?: readonly TaxAdjustment[];
  readonly pendingItems?: readonly PendingItem[];
  readonly humanDecisions?: readonly TaxWorkflowHumanDecision[];
  readonly periodVersions?: readonly WorkflowTaxPeriod[];
  readonly expectedMatrixVersion?: string;
  readonly companyCode: string;
  readonly companyName: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly timestamp?: string | Date;
  readonly payments?: readonly JsonObject[];
};
export type CloseTaxPeriodResult = {
  readonly closed: boolean;
  readonly issues: readonly CloseTaxPeriodIssue[];
  readonly manifest: TaxPeriodCloseManifest | null;
  readonly scheduleCompletion: ScheduleCompletion | null;
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly taxCalculation: TaxCalculation | null;
  readonly supersededPeriods: readonly WorkflowTaxPeriod[];
  readonly stalePeriods: readonly WorkflowTaxPeriod[];
  readonly transaction: {
    readonly committed: boolean;
    readonly periodUpdates: readonly WorkflowTaxPeriod[];
    readonly taxCalculation: TaxCalculation | null;
    readonly manifest: TaxPeriodCloseManifest | null;
    readonly scheduleCompletion: ScheduleCompletion | null;
  };
};
export type OpenNewTaxPeriodVersionInput = {
  readonly currentPeriod: WorkflowTaxPeriod;
  readonly timestamp?: string | Date;
  readonly nextStatus?: Extract<TaxPeriodStatus, "DRAFT" | "REVIEWED">;
};
export type OpenNewTaxPeriodVersionResult = {
  readonly currentPeriod: WorkflowTaxPeriod;
  readonly newPeriod: WorkflowTaxPeriod;
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
function normalizeCreatedAt(value: string | Date | undefined) {
  const parsed = value instanceof Date || value !== undefined ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) throw new Error("Data/hora do workflow fiscal inválida.");
  return parsed.toISOString();
}
function centsFromMoney(value: MonetaryAmount, label: string) {
  const normalized = normalizeMoney(value);
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsigned = sign < 0n ? normalized.slice(1) : normalized;
  const [integer, fraction] = unsigned.split(".");
  const cents = sign * BigInt(`${integer}${fraction}`);
  if (cents < 0n) throw new Error(`${label} não pode ser negativo.`);
  return cents;
}
function moneyFromCents(cents: bigint) {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
function workflowLogicalKey(prefix: string, payload: SnapshotInputObject) {
  return `${prefix}:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}
function deterministicUuid(payload: SnapshotInputObject) {
  const chars = createHash("sha256").update(canonicalJson(payload)).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function sourceObject(value: JsonObject | undefined): JsonObject {
  if (!value || Array.isArray(value) || !Object.keys(value).length) return {};
  return value;
}
function isNonEmptySource(value: JsonObject) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}
function assertSamePeriodSource(taxPeriod: WorkflowTaxPeriod, sourceSnapshot: SourceSnapshot, companyId: string) {
  if (taxPeriod.companyId !== companyId || sourceSnapshot.companyId !== companyId) throw new Error("Empresa inconsistente no workflow fiscal.");
  if (sourceSnapshot.taxPeriodId !== taxPeriod.id) throw new Error("Snapshot não pertence ao período fiscal informado.");
  if (
    sourceSnapshot.taxPeriod.fiscalYear !== taxPeriod.fiscalYear ||
    sourceSnapshot.taxPeriod.periodCode !== taxPeriod.periodCode ||
    sourceSnapshot.taxPeriod.startDate !== taxPeriod.startDate ||
    sourceSnapshot.taxPeriod.endDate !== taxPeriod.endDate
  ) {
    throw new Error("Identidade do período no snapshot diverge do período fiscal informado.");
  }
}
function periodIdentity(period: WorkflowTaxPeriod) {
  return {
    fiscalYear: period.fiscalYear,
    periodCode: period.periodCode,
    startDate: period.startDate,
    endDate: period.endDate,
  } satisfies TaxPeriodIdentity;
}
function periodMonth(period: Pick<TaxPeriod, "fiscalYear" | "periodCode" | "periodType">) {
  if (period.periodType !== "MONTHLY_ESTIMATE") return null;
  const match = new RegExp(`^${period.fiscalYear}-M(0[1-9]|1[0-2])$`).exec(period.periodCode);
  return match ? Number(match[1]) : null;
}
function competenceFromPeriod(period: Pick<TaxPeriod, "endDate">) {
  assertIsoDate(period.endDate, "data final do período fiscal");
  return period.endDate.slice(0, 7);
}
function recordText(record: JsonObject, ...fields: readonly string[]) {
  for (const field of fields) {
    const value = record[field];
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}
function reducedCodeFromRecord(record: JsonObject) {
  return optionalTrimmed(recordText(record, "reducedCode", "reduced", "codigoReduzido"));
}
function pendingItemFromDraft(draft: PendingItemDraft, createdAt: string): PendingItem {
  return {
    ...draft,
    id: deterministicUuid({ type: "PENDING_ITEM", logicalKey: draft.logicalKey }),
    createdAt,
    createdBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  };
}
function mergeByLogicalKey<T extends { readonly logicalKey: string }>(items: readonly T[]) {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(item.logicalKey, item);
  return [...byKey.values()];
}
function mergeById<T extends { readonly id: string }>(items: readonly T[]) {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}
function readyAdjustment(adjustment: TaxAdjustment): TaxAdjustment {
  return adjustment.status === "READY" ? adjustment : { ...adjustment, status: "READY" };
}
function periodStatusFromCalculation(calculation: TaxCalculation | null): TaxPeriodStatus {
  if (!calculation) return "DRAFT";
  if (calculation.status === "CALCULATED") return "CALCULATED";
  return "CALCULATED_WITH_PENDING_ITEMS";
}
function matrixWithGenerated(input: {
  readonly matrix: FiscalMatrixContext;
  readonly generatedMappings: readonly AccountFiscalMapping[];
  readonly generatedFiscalNatures: readonly FiscalNature[];
  readonly generatedFiscalRules: readonly FiscalRule[];
}): FiscalMatrixContext {
  return {
    ...input.matrix,
    mappings: mergeById([...input.matrix.mappings, ...input.generatedMappings]),
    fiscalNatures: mergeById([...input.matrix.fiscalNatures, ...input.generatedFiscalNatures]),
    fiscalRules: mergeById([...input.matrix.fiscalRules, ...input.generatedFiscalRules]),
  };
}

export function isBlockingPendingItem(pendingItem: Pick<PendingItem, "status" | "blocking">) {
  return pendingItem.status === "OPEN" && pendingItem.blocking;
}

export function previewTaxPeriod(input: PreviewTaxPeriodInput): PreviewTaxPeriodResult {
  const companyId = trimRequired(input.companyId, "Empresa");
  const createdAt = normalizeCreatedAt(input.createdAt);
  assertSamePeriodSource(input.taxPeriod, input.sourceSnapshot, companyId);

  const autoOnboarding = runFiscalAutoOnboarding({
    companyId,
    taxPeriod: input.taxPeriod,
    sourceSnapshot: input.sourceSnapshot,
    accountingCharts: input.matrix.accountingCharts,
    companyAccountingCharts: input.matrix.companyAccountingCharts,
    mappings: input.matrix.mappings,
    fiscalNatures: input.matrix.fiscalNatures,
    fiscalRules: input.matrix.fiscalRules,
    existingPendingItems: input.existingPendingItems,
  });
  const generatedPending = autoOnboarding.pendingItems.map((item) => pendingItemFromDraft(item, createdAt));
  const pendingItems = mergeByLogicalKey([...(input.existingPendingItems ?? []), ...generatedPending]);
  const matrix = matrixWithGenerated({
    matrix: input.matrix,
    generatedMappings: autoOnboarding.generatedMappings,
    generatedFiscalNatures: autoOnboarding.generatedFiscalNatures,
    generatedFiscalRules: autoOnboarding.generatedFiscalRules,
  });
  const ruleResults = new Map<string, RuleExecutionResult>();
  const taxAdjustments = new Map<string, TaxAdjustment>();
  for (const result of input.existingRuleExecutionResults ?? []) ruleResults.set(result.logicalKey, result);
  for (const adjustment of input.existingTaxAdjustments ?? []) taxAdjustments.set(adjustment.logicalKey, adjustment);

  for (const record of input.sourceSnapshot.records) {
    if (!isMovedTrialBalanceRecord(record)) continue;
    const accountCode = recordText(record, "accountCode", "account");
    if (!accountCode) throw new Error("Registro de balancete sem conta contábil.");
    const execution = executeFullAccount({
      companyId,
      taxPeriod: input.taxPeriod,
      sourceSnapshot: input.sourceSnapshot,
      accountCode,
      reducedCode: reducedCodeFromRecord(record),
      accountingCharts: matrix.accountingCharts,
      companyAccountingCharts: matrix.companyAccountingCharts,
      mappings: matrix.mappings,
      companyAccountMappingOverrides: matrix.companyAccountMappingOverrides,
      fiscalNatures: matrix.fiscalNatures,
      fiscalRules: matrix.fiscalRules,
      companyRuleOverrides: matrix.companyRuleOverrides,
      existingTaxAdjustments: [...taxAdjustments.values()],
      createdAt,
    });
    if (execution.ruleExecutionResult) ruleResults.set(execution.ruleExecutionResult.logicalKey, execution.ruleExecutionResult);
    for (const adjustment of execution.taxAdjustments) taxAdjustments.set(adjustment.logicalKey, readyAdjustment(adjustment));
  }

  const annualResult = calculateAnnualMonthly({
    companyId,
    fiscalYearProfile: input.fiscalYearProfile,
    taxPeriod: input.taxPeriod,
    sourceSnapshot: input.sourceSnapshot,
    accountingResultYtd: input.accountingResultYtd,
    accountingResultYtdByTax: input.accountingResultYtdByTax,
    taxAdjustments: [...taxAdjustments.values()],
    fiscalBalances: input.fiscalBalances,
    taxCredits: input.taxCredits,
    priorCalculations: input.priorCalculations,
    pendingItems: pendingItems.filter((item) => item.status === "OPEN"),
    matrixVersion: input.matrixVersion,
    calculationVersion: input.calculationVersion,
    versionStatus: input.versionStatus,
    createdAt,
  });
  const taxCalculation = annualResult.taxCalculation;
  const taxPeriod = {
    ...input.taxPeriod,
    status: periodStatusFromCalculation(taxCalculation),
    updatedAt: createdAt,
  } satisfies WorkflowTaxPeriod;

  return {
    taxPeriod,
    sourceSnapshot: input.sourceSnapshot,
    autoOnboardingDecisions: autoOnboarding.decisions,
    pendingItems,
    ruleExecutionResults: [...ruleResults.values()],
    taxAdjustments: [...taxAdjustments.values()],
    taxCalculation,
    calculationIssues: annualResult.issues as readonly JsonObject[],
  };
}

export function reprocessTaxPeriod(input: PreviewTaxPeriodInput): PreviewTaxPeriodResult {
  if (input.taxPeriod.status === "CLOSED_CURRENT" || input.taxPeriod.status === "CLOSED_SUPERSEDED") {
    throw new Error("Período fechado é imutável; abra nova versão para reprocessar.");
  }
  return previewTaxPeriod(input);
}

function assertHumanJustification(input: { readonly justification: string; readonly userId: string }) {
  trimRequired(input.userId, "Usuário");
  const justification = trimRequired(input.justification, "Justificativa");
  if (justification.length < 8) throw new Error("Justificativa da decisão humana deve ser descritiva.");
  return justification;
}
function assertPendingOpen(pendingItem: PendingItem, type: PendingItem["type"]) {
  if (pendingItem.type !== type) throw new Error("Tipo de pendência incompatível com a operação.");
  if (pendingItem.status !== "OPEN") throw new Error("Pendência já resolvida ou descartada.");
}
function resolvedPendingItem(input: {
  readonly pendingItem: PendingItem;
  readonly userId: string;
  readonly timestamp: string;
  readonly note: string;
}): PendingItem {
  return {
    ...input.pendingItem,
    status: "RESOLVED",
    blocking: false,
    resolvedAt: input.timestamp,
    resolvedBy: input.userId,
    resolutionNote: input.note,
  };
}
function decisionAudit(input: {
  readonly companyId: string;
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly sourceSnapshot: SourceSnapshot;
  readonly pendingItem: PendingItem;
  readonly decisionType: TaxWorkflowHumanDecisionType;
  readonly userId: string;
  readonly userEmail: string | null;
  readonly justification: string;
  readonly beforeState: JsonObject;
  readonly afterState: JsonObject;
  readonly snapshotContext: JsonObject;
  readonly matrixVersionBefore: number;
  readonly matrixVersionAfter: number;
  readonly taxAdjustmentIds: readonly string[];
  readonly timestamp: string;
}): TaxWorkflowHumanDecision {
  const logicalKey = workflowLogicalKey("TAX_WORKFLOW_HUMAN_DECISION", {
    companyId: input.companyId,
    taxPeriodId: input.taxPeriod.id,
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    pendingItemId: input.pendingItem.id,
    decisionType: input.decisionType,
    userId: input.userId,
    beforeState: input.beforeState,
    afterState: input.afterState,
  });
  return {
    id: deterministicUuid({ type: "TAX_WORKFLOW_HUMAN_DECISION", logicalKey }),
    logicalKey,
    companyId: input.companyId,
    taxPeriodId: input.taxPeriod.id,
    sourceSnapshotId: input.sourceSnapshot.id,
    pendingItemId: input.pendingItem.id,
    decisionType: input.decisionType,
    userId: input.userId,
    userEmail: input.userEmail,
    justification: input.justification,
    beforeState: input.beforeState,
    afterState: input.afterState,
    snapshotContext: input.snapshotContext,
    matrixVersionBefore: input.matrixVersionBefore,
    matrixVersionAfter: input.matrixVersionAfter,
    taxAdjustmentIds: input.taxAdjustmentIds,
    createdAt: input.timestamp,
  };
}

export function classifyNewAccount(input: ClassifyNewAccountInput): ClassifyNewAccountResult {
  return buildNewAccountClassification(input, {
    pendingType: "NEW_ACCOUNT_UNMAPPED",
    humanDecision: "NEW_ACCOUNT_CLASSIFICATION",
  });
}

function automaticClassificationState(pendingItem: PendingItem): JsonObject {
  const text = (...fields: readonly string[]) => {
    const value = recordText(pendingItem.originData, ...fields);
    return value || null;
  };
  return {
    accountCode: text("accountCode", "account"),
    reducedCode: text("reducedCode", "reduced", "codigoReduzido"),
    accountDescription: text("description", "accountDescription"),
    irpjTreatment: text("irpjTreatment", "suggestedIrpjTreatment"),
    csllTreatment: text("csllTreatment", "suggestedCsllTreatment"),
    fiscalNatureId: text("fiscalNatureId"),
    fiscalNatureCode: text("fiscalNatureCode"),
    fiscalNatureName: text("fiscalNatureName"),
    fiscalRuleId: text("fiscalRuleId"),
    fiscalRuleCode: text("fiscalRuleCode", "catalogRuleCode", "ruleCode"),
    criterion: text("classificationCriterion", "criterion", "autoOnboardingLevel") ?? "Regra previamente aprovada",
    matrixVersion: text("matrixVersion", "fiscalMatrixVersion"),
    sourceSnapshotHash: text("sourceSnapshotHash"),
    status: "AWAITING_CONFIRMATION",
  };
}

export function confirmAutomaticNewAccountClassification(input: ConfirmAutomaticNewAccountClassificationInput): ConfirmAutomaticNewAccountClassificationResult {
  const companyId = trimRequired(input.companyId, "Empresa");
  const timestamp = normalizeCreatedAt(input.timestamp);
  trimRequired(input.userId, "Usuário");
  assertSamePeriodSource(input.taxPeriod, input.sourceSnapshot, companyId);
  assertPendingOpen(input.pendingItem, "NEW_ACCOUNT_AUTO_CLASSIFIED");
  assertValidVersion(input.matrixVersionBefore, "versão da Matriz Fiscal");
  const automaticClassification = automaticClassificationState(input.pendingItem);
  const justification = "Classificação automática confirmada pelo responsável.";
  const decision = decisionAudit({
    companyId,
    taxPeriod: input.taxPeriod,
    sourceSnapshot: input.sourceSnapshot,
    pendingItem: input.pendingItem,
    decisionType: "NEW_ACCOUNT_CLASSIFICATION",
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    justification,
    beforeState: {
      action: "CONFIRM_AUTO_CLASSIFICATION",
      pendingItemId: input.pendingItem.id,
      pendingItemType: input.pendingItem.type,
      pendingItemStatus: input.pendingItem.status,
      pendingItemBlocking: input.pendingItem.blocking,
      automaticClassification,
      originData: input.pendingItem.originData,
    },
    afterState: {
      action: "CONFIRM_AUTO_CLASSIFICATION",
      confirmationStatus: "CONFIRMED",
      confirmedBy: input.userId,
      confirmedAt: timestamp,
      automaticClassification,
    },
    snapshotContext: {
      sourceSnapshotId: input.sourceSnapshot.id,
      sourceSnapshotHash: input.sourceSnapshot.hash,
      taxPeriod: periodIdentity(input.taxPeriod) as unknown as JsonObject,
      pendingItemOrigin: input.pendingItem.originData,
      automaticClassification,
    },
    matrixVersionBefore: input.matrixVersionBefore,
    matrixVersionAfter: input.matrixVersionBefore,
    taxAdjustmentIds: [],
    timestamp,
  });
  const resolved = resolvedPendingItem({
    pendingItem: input.pendingItem,
    userId: input.userId,
    timestamp,
    note: justification,
  });
  return {
    decision,
    resolvedPendingItem: resolved,
    reprocessRequired: false,
  };
}

function buildNewAccountClassification(input: ClassifyNewAccountInput, options: {
  readonly pendingType: PendingItem["type"];
  readonly humanDecision: string;
  readonly decisionAction?: string;
  readonly beforeStateExtra?: JsonObject;
  readonly afterStateExtra?: JsonObject;
  readonly resolutionNote?: string;
}): ClassifyNewAccountResult {
  const companyId = trimRequired(input.companyId, "Empresa");
  const timestamp = normalizeCreatedAt(input.timestamp);
  const justification = assertHumanJustification(input);
  assertSamePeriodSource(input.taxPeriod, input.sourceSnapshot, companyId);
  assertPendingOpen(input.pendingItem, options.pendingType);
  assertValidVersion(input.matrixVersionBefore, "versão anterior da Matriz Fiscal");
  const matrixVersionAfter = input.matrixVersionBefore + 1;
  const reducedCode = optionalTrimmed(input.reducedCode);
  const fiscalNatureId = deterministicUuid({
    type: "HUMAN_CLASSIFIED_FISCAL_NATURE",
    companyId,
    matrixVersionAfter,
    accountCode: input.accountCode,
    reducedCode,
  });
  const fiscalRuleId = deterministicUuid({
    type: "HUMAN_CLASSIFIED_FISCAL_RULE",
    companyId,
    matrixVersionAfter,
    accountCode: input.accountCode,
    reducedCode,
  });
  const source = {
    workflowVersion: FISCAL_WORKFLOW_VERSION,
    humanDecision: options.humanDecision,
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    pendingItemId: input.pendingItem.id,
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    justification,
  } satisfies JsonObject;
  const generatedFiscalNature: FiscalNature = {
    id: fiscalNatureId,
    code: trimRequired(input.fiscalNatureCode, "Código da natureza fiscal"),
    name: trimRequired(input.fiscalNatureName, "Nome da natureza fiscal"),
    description: String(input.fiscalNatureDescription ?? input.fiscalNatureName).trim(),
    sourceMetadata: source,
    active: true,
    createdAt: timestamp,
  };
  const generatedFiscalRule: FiscalRule = {
    id: fiscalRuleId,
    ruleCode: trimRequired(input.fiscalRuleCode, "Código da regra fiscal"),
    fiscalNatureId,
    irpjTreatment: input.irpjTreatment,
    csllTreatment: input.csllTreatment,
    executionMethod: input.executionMethod ?? "FULL_ACCOUNT",
    automationLevel: input.automationLevel ?? "MANUAL",
    criteria: {
      amountBasis: input.amountBasis ?? (input.accountCode.startsWith("3.") ? "NET_CREDIT_MOVEMENT" : "NET_DEBIT_MOVEMENT"),
      humanDecisionId: null,
      workflowVersion: FISCAL_WORKFLOW_VERSION,
    },
    sourceMetadata: source,
    validFrom: input.taxPeriod.startDate,
    validTo: null,
    version: matrixVersionAfter,
    status: "ACTIVE",
    createdAt: timestamp,
  };
  const generatedMapping: AccountFiscalMapping = {
    id: deterministicUuid({
      type: "HUMAN_CLASSIFIED_ACCOUNT_MAPPING",
      companyId,
      matrixVersionAfter,
      accountingChartId: input.accountingChartId,
      accountCode: input.accountCode,
      reducedCode,
      fiscalNatureId,
    }),
    accountingChartId: trimRequired(input.accountingChartId, "Plano de contas"),
    accountCode: trimRequired(input.accountCode, "Conta contábil"),
    reducedCode,
    fiscalNatureId,
    sourceMetadata: source,
    validFrom: input.taxPeriod.startDate,
    validTo: null,
    version: matrixVersionAfter,
    active: true,
    createdAt: timestamp,
  };
  const afterState = {
    ...(options.decisionAction ? { action: options.decisionAction } : {}),
    mapping: generatedMapping as unknown as JsonObject,
    fiscalNature: generatedFiscalNature as unknown as JsonObject,
    fiscalRule: generatedFiscalRule as unknown as JsonObject,
    ...(options.afterStateExtra ?? {}),
  } satisfies JsonObject;
  const decision = decisionAudit({
    companyId,
    taxPeriod: input.taxPeriod,
    sourceSnapshot: input.sourceSnapshot,
    pendingItem: input.pendingItem,
    decisionType: "NEW_ACCOUNT_CLASSIFICATION",
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    justification,
    beforeState: {
      pendingItemId: input.pendingItem.id,
      pendingItemType: input.pendingItem.type,
      pendingItemStatus: input.pendingItem.status,
      pendingItemBlocking: input.pendingItem.blocking,
      originData: input.pendingItem.originData,
      ...(options.beforeStateExtra ?? {}),
    },
    afterState,
    snapshotContext: {
      sourceSnapshotId: input.sourceSnapshot.id,
      sourceSnapshotHash: input.sourceSnapshot.hash,
      taxPeriod: periodIdentity(input.taxPeriod) as unknown as JsonObject,
      pendingItemOrigin: input.pendingItem.originData,
    },
    matrixVersionBefore: input.matrixVersionBefore,
    matrixVersionAfter,
    taxAdjustmentIds: [],
    timestamp,
  });
  const resolved = resolvedPendingItem({
    pendingItem: input.pendingItem,
    userId: input.userId,
    timestamp,
    note: options.resolutionNote ?? justification,
  });
  return {
    decision,
    resolvedPendingItem: resolved,
    generatedFiscalNature,
    generatedFiscalRule,
    generatedMapping,
    reprocessRequired: true,
  };
}

export function correctAutomaticNewAccountClassification(input: CorrectAutomaticNewAccountClassificationInput): CorrectAutomaticNewAccountClassificationResult {
  const automaticClassification = automaticClassificationState(input.pendingItem);
  return buildNewAccountClassification(input, {
    pendingType: "NEW_ACCOUNT_AUTO_CLASSIFIED",
    humanDecision: "AUTO_CLASSIFICATION_CORRECTION",
    decisionAction: "CORRECT_AUTO_CLASSIFICATION",
    beforeStateExtra: {
      originalAutomaticClassification: automaticClassification,
    },
    afterStateExtra: {
      originalAutomaticClassification: automaticClassification,
      correctedClassification: {
        accountCode: input.accountCode,
        reducedCode: input.reducedCode ?? null,
        fiscalNatureCode: input.fiscalNatureCode,
        fiscalNatureName: input.fiscalNatureName,
        fiscalRuleCode: input.fiscalRuleCode,
        irpjTreatment: input.irpjTreatment,
        csllTreatment: input.csllTreatment,
        executionMethod: input.executionMethod ?? "FULL_ACCOUNT",
      },
    },
    resolutionNote: `Classificação automática corrigida: ${input.justification}`,
  });
}
function assertConditionalDecision(value: string, label: string): ConditionalTaxDecision {
  if (!isOneOf(value, CONDITIONAL_TAX_DECISIONS)) throw new Error(`${label} inválida.`);
  return value;
}
function buildConditionalRuleExecutionResult(input: ResolveConditionalOccurrenceInput & {
  readonly timestamp: string;
  readonly decisionId: string;
  readonly amount: string;
  readonly sourceContext: JsonObject;
}): RuleExecutionResult {
  const reducedCode = optionalTrimmed(input.reducedCode);
  const logicalKey = workflowLogicalKey("CONDITIONAL_RULE_EXECUTION_RESULT", {
    companyId: input.companyId,
    taxPeriodId: input.taxPeriod.id,
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    pendingItemId: input.pendingItem.id,
    accountCode: input.accountCode,
    reducedCode,
    fiscalRuleId: input.fiscalRuleId,
    fiscalRuleVersion: input.fiscalRuleVersion,
    irpjDecision: input.irpjDecision,
    csllDecision: input.csllDecision,
    amount: input.amount,
  });
  return {
    id: deterministicUuid({ type: "CONDITIONAL_RULE_EXECUTION_RESULT", logicalKey }),
    companyId: input.companyId,
    taxPeriodId: input.taxPeriod.id,
    sourceSnapshotId: input.sourceSnapshot.id,
    accountingChartId: input.accountingChartId,
    companyAccountingChartId: input.companyAccountingChartId,
    accountCode: input.accountCode,
    reducedCode,
    accountDescription: input.accountDescription ?? "",
    fiscalNatureId: input.fiscalNatureId,
    accountFiscalMappingId: input.accountFiscalMappingId,
    accountFiscalMappingVersion: input.accountFiscalMappingVersion,
    companyAccountMappingOverrideId: input.companyAccountMappingOverrideId ?? null,
    companyAccountMappingOverrideVersion: input.companyAccountMappingOverrideVersion ?? null,
    fiscalRuleId: input.fiscalRuleId,
    fiscalRuleVersion: input.fiscalRuleVersion,
    companyRuleOverrideId: input.companyRuleOverrideId ?? null,
    companyRuleOverrideVersion: input.companyRuleOverrideVersion ?? null,
    executionMethod: "MANUAL_EXCEPTION",
    automationLevel: "MANUAL",
    amountBasis: null,
    rawAccountingValue: input.amount,
    calculatedValue: input.amount,
    status: "EXECUTED",
    executionMetadata: {
      workflowVersion: FISCAL_WORKFLOW_VERSION,
      humanDecisionId: input.decisionId,
      pendingItemId: input.pendingItem.id,
      sourceSnapshotHash: input.sourceSnapshot.hash,
      irpjDecision: input.irpjDecision,
      csllDecision: input.csllDecision,
      sourceContext: input.sourceContext,
    },
    logicalKey,
    createdAt: input.timestamp,
  };
}
function conditionalAdjustment(input: {
  readonly result: RuleExecutionResult;
  readonly tax: FiscalTax;
  readonly adjustmentType: TaxAdjustmentType;
  readonly timestamp: string;
}) {
  const logicalKey = buildTaxAdjustmentLogicalKey({
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
    id: deterministicUuid({ type: "TAX_ADJUSTMENT", logicalKey }),
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
    status: "READY",
    logicalKey,
    createdAt: input.timestamp,
  } satisfies TaxAdjustment;
}

export function resolveConditionalOccurrence(input: ResolveConditionalOccurrenceInput): ResolveConditionalOccurrenceResult {
  const companyId = trimRequired(input.companyId, "Empresa");
  const timestamp = normalizeCreatedAt(input.timestamp);
  const justification = assertHumanJustification(input);
  assertSamePeriodSource(input.taxPeriod, input.sourceSnapshot, companyId);
  assertPendingOpen(input.pendingItem, "CONDITIONAL_TAX_DECISION");
  assertValidVersion(input.matrixVersionBefore, "versão da Matriz Fiscal");
  assertValidVersion(input.accountFiscalMappingVersion, "versão do mapeamento fiscal");
  assertValidVersion(input.fiscalRuleVersion, "versão da regra fiscal");
  const amount = normalizeMoney(input.amount);
  centsFromMoney(amount, "Valor da decisão condicional");
  const irpjDecision = assertConditionalDecision(input.irpjDecision, "Decisão IRPJ");
  const csllDecision = assertConditionalDecision(input.csllDecision, "Decisão CSLL");
  const sourceContext = sourceObject(input.sourceContext ?? input.pendingItem.originData);
  const provisionalDecisionKey = workflowLogicalKey("CONDITIONAL_OCCURRENCE_DECISION_SEED", {
    companyId,
    taxPeriodId: input.taxPeriod.id,
    sourceSnapshotId: input.sourceSnapshot.id,
    pendingItemId: input.pendingItem.id,
    irpjDecision,
    csllDecision,
    amount,
  });
  const provisionalDecisionId = deterministicUuid({ type: "CONDITIONAL_OCCURRENCE_DECISION_SEED", logicalKey: provisionalDecisionKey });
  const ruleExecutionResult = buildConditionalRuleExecutionResult({
    ...input,
    companyId,
    timestamp,
    decisionId: provisionalDecisionId,
    amount,
    sourceContext,
  });
  const adjustments = [
    ["IRPJ", irpjDecision] as const,
    ["CSLL", csllDecision] as const,
  ].flatMap(([tax, decision]) => {
    if (decision === "NO_ADJUSTMENT") return [];
    return [conditionalAdjustment({ result: ruleExecutionResult, tax, adjustmentType: decision, timestamp })];
  });
  const afterState = {
    irpjDecision,
    csllDecision,
    amount,
    ruleExecutionResultId: ruleExecutionResult.id,
    taxAdjustmentIds: adjustments.map((adjustment) => adjustment.id),
  } satisfies JsonObject;
  const decision = decisionAudit({
    companyId,
    taxPeriod: input.taxPeriod,
    sourceSnapshot: input.sourceSnapshot,
    pendingItem: input.pendingItem,
    decisionType: "CONDITIONAL_OCCURRENCE",
    userId: input.userId,
    userEmail: input.userEmail ?? null,
    justification,
    beforeState: {
      pendingItemId: input.pendingItem.id,
      pendingItemType: input.pendingItem.type,
      pendingItemStatus: input.pendingItem.status,
      pendingItemBlocking: input.pendingItem.blocking,
      originData: input.pendingItem.originData,
    },
    afterState,
    snapshotContext: {
      sourceSnapshotId: input.sourceSnapshot.id,
      sourceSnapshotHash: input.sourceSnapshot.hash,
      context: sourceContext,
      taxPeriod: periodIdentity(input.taxPeriod) as unknown as JsonObject,
    },
    matrixVersionBefore: input.matrixVersionBefore,
    matrixVersionAfter: input.matrixVersionBefore,
    taxAdjustmentIds: adjustments.map((adjustment) => adjustment.id),
    timestamp,
  });
  const resolved = resolvedPendingItem({
    pendingItem: input.pendingItem,
    userId: input.userId,
    timestamp,
    note: justification,
  });
  return {
    decision,
    resolvedPendingItem: resolved,
    ruleExecutionResult: {
      ...ruleExecutionResult,
      executionMetadata: {
        ...ruleExecutionResult.executionMetadata,
        humanDecisionId: decision.id,
      },
    },
    taxAdjustments: adjustments,
    reprocessRequired: true,
  };
}

export function reviewTaxPeriod(input: ReviewTaxPeriodInput): ReviewTaxPeriodResult {
  if (input.taxPeriod.status === "CLOSED_CURRENT" || input.taxPeriod.status === "CLOSED_SUPERSEDED") {
    throw new Error("Período fechado é imutável; revisão exige nova versão.");
  }
  const timestamp = normalizeCreatedAt(input.timestamp);
  const justification = assertHumanJustification(input);
  return {
    taxPeriod: {
      ...input.taxPeriod,
      status: "REVIEWED",
      updatedAt: timestamp,
    },
    audit: {
      workflowVersion: FISCAL_WORKFLOW_VERSION,
      action: "REVIEW_TAX_PERIOD",
      userId: input.userId,
      userEmail: input.userEmail ?? null,
      justification,
      previousStatus: input.taxPeriod.status,
      newStatus: "REVIEWED",
      timestamp,
    },
  };
}

function closeIssue(code: string, message: string, metadata: JsonObject = {}): CloseTaxPeriodIssue {
  return { code, message, severity: "BLOCKING", metadata };
}
function validateTaxCalculationLinks(input: CloseTaxPeriodInput, issues: CloseTaxPeriodIssue[]) {
  const calculation = input.taxCalculation;
  if (!calculation) {
    issues.push(closeIssue("MISSING_TAX_CALCULATION", "Fechamento exige cálculo fiscal existente."));
    return;
  }
  if (calculation.companyId !== input.companyId || calculation.taxPeriodId !== input.taxPeriod.id) {
    issues.push(closeIssue("CALCULATION_PERIOD_MISMATCH", "Cálculo não pertence à empresa/período informado."));
  }
  if (calculation.sourceSnapshotId !== input.sourceSnapshot.id || calculation.sourceSnapshotHash !== input.sourceSnapshot.hash) {
    issues.push(closeIssue("SNAPSHOT_HASH_MISMATCH", "Snapshot/hash do cálculo diverge do snapshot informado."));
  }
  if (calculation.engine !== ANNUAL_MONTHLY_ENGINE || input.taxPeriod.periodType !== "MONTHLY_ESTIMATE") {
    issues.push(closeIssue("ENGINE_NOT_ENABLED_FOR_REGIME", "Fechamento mensal exige cálculo ANNUAL_MONTHLY."));
  }
  if (calculation.status === "VALIDATION_REQUIRED") {
    issues.push(closeIssue("CALCULATION_VALIDATION_REQUIRED", "Cálculo possui validação bloqueante pendente."));
  }
  if (input.expectedMatrixVersion && calculation.matrixVersion !== input.expectedMatrixVersion) {
    issues.push(closeIssue("MATRIX_VERSION_MISMATCH", "Cálculo não usa a versão esperada da Matriz Fiscal.", { expected: input.expectedMatrixVersion, actual: calculation.matrixVersion }));
  }
  const adjustmentIds = new Set((input.taxAdjustments ?? []).map((adjustment) => adjustment.id));
  const missingAdjustments = calculation.taxAdjustmentIds.filter((id) => !adjustmentIds.has(id));
  if (missingAdjustments.length) {
    issues.push(closeIssue("TAX_ADJUSTMENT_VERSION_MISMATCH", "Ajustes usados no cálculo não foram fornecidos ao gate.", { missingAdjustments }));
  }
}
function validateOpenPendings(input: CloseTaxPeriodInput, issues: CloseTaxPeriodIssue[]) {
  const blocking = (input.pendingItems ?? []).filter(isBlockingPendingItem);
  if (blocking.length) {
    issues.push(closeIssue("BLOCKING_PENDING_ITEMS", "Há pendências bloqueantes abertas.", {
      pendingItemIds: blocking.map((item) => item.id),
      pendingTypes: blocking.map((item) => item.type),
    }));
  }
  const unconfirmedAutomatic = (input.pendingItems ?? []).filter((item) => item.status === "OPEN" && item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED");
  if (unconfirmedAutomatic.length) {
    issues.push(closeIssue("AUTO_CLASSIFICATION_CONFIRMATION_REQUIRED", "Há classificações automáticas de contas novas aguardando confirmação humana.", {
      pendingItemIds: unconfirmedAutomatic.map((item) => item.id),
      pendingTypes: unconfirmedAutomatic.map((item) => item.type),
    }));
  }
}
function validateCreditUsages(calculation: TaxCalculation, issues: CloseTaxPeriodIssue[]) {
  for (const usage of calculation.creditUsages) {
    const used = centsFromMoney(usage.used, "Crédito utilizado");
    const available = centsFromMoney(usage.available, "Crédito disponível");
    if (used <= 0n) continue;
    if (!isNonEmptySource(usage.source)) {
      issues.push(closeIssue("CREDIT_WITHOUT_SOURCE", "Crédito utilizado sem origem rastreável.", { creditId: usage.creditId, nature: usage.nature, tax: usage.tax }));
    }
    if (used > available) {
      issues.push(closeIssue("CREDIT_EXCEEDS_AVAILABLE", "Crédito utilizado excede o saldo disponível.", { creditId: usage.creditId, used: usage.used, available: usage.available }));
    }
  }
}
function validateFiscalBalanceUsages(calculation: TaxCalculation, issues: CloseTaxPeriodIssue[]) {
  for (const usage of calculation.fiscalBalanceUsages) {
    const used = centsFromMoney(usage.used, "Saldo fiscal utilizado");
    const available = centsFromMoney(usage.available, "Saldo fiscal disponível");
    if (used <= 0n) continue;
    if (!isNonEmptySource(usage.source)) {
      issues.push(closeIssue("FISCAL_BALANCE_WITHOUT_SOURCE", "PF/BN utilizado sem origem rastreável.", { balanceId: usage.balanceId, balanceType: usage.balanceType, tax: usage.tax }));
    }
    if (used > available) {
      issues.push(closeIssue("FISCAL_BALANCE_EXCEEDS_AVAILABLE", "PF/BN utilizado excede o saldo disponível.", { balanceId: usage.balanceId, used: usage.used, available: usage.available }));
    }
  }
}
function validateClosedCurrentUniqueness(input: CloseTaxPeriodInput, issues: CloseTaxPeriodIssue[]) {
  const currentVersions = (input.periodVersions ?? []).filter(
    (period) =>
      period.companyId === input.companyId &&
      period.fiscalYear === input.taxPeriod.fiscalYear &&
      period.periodCode === input.taxPeriod.periodCode &&
      period.id !== input.taxPeriod.id &&
      period.status === "CLOSED_CURRENT",
  );
  if (currentVersions.length > 1) {
    issues.push(closeIssue("MULTIPLE_CLOSED_CURRENT", "Já há mais de uma versão CLOSED_CURRENT para o período.", { periodIds: currentVersions.map((period) => period.id) }));
  }
  if (currentVersions.length === 1 && input.taxPeriod.version <= currentVersions[0].version) {
    issues.push(closeIssue("CLOSED_CURRENT_VERSION_CONFLICT", "Nova versão precisa ser posterior à versão CLOSED_CURRENT atual.", { currentVersion: currentVersions[0].version, closingVersion: input.taxPeriod.version }));
  }
}

export function validateCloseTaxPeriod(input: CloseTaxPeriodInput): readonly CloseTaxPeriodIssue[] {
  const companyId = trimRequired(input.companyId, "Empresa");
  const issues: CloseTaxPeriodIssue[] = [];
  assertSamePeriodSource(input.taxPeriod, input.sourceSnapshot, companyId);
  if (input.taxPeriod.status === "CLOSED_CURRENT") issues.push(closeIssue("PERIOD_ALREADY_CLOSED_CURRENT", "Período CLOSED_CURRENT não pode ser fechado novamente in place."));
  if (input.taxPeriod.status === "CLOSED_SUPERSEDED") issues.push(closeIssue("PERIOD_CLOSED_SUPERSEDED", "Período superseded é imutável."));
  if (input.taxPeriod.upstreamStale) issues.push(closeIssue("PERIOD_UPSTREAM_STALE", "Período está stale por mudança retroativa anterior."));
  if (!input.sourceSnapshot.id || !input.sourceSnapshot.hash) issues.push(closeIssue("MISSING_SOURCE_SNAPSHOT", "Fechamento exige SOURCE_SNAPSHOT persistido e hash."));
  validateOpenPendings(input, issues);
  validateTaxCalculationLinks(input, issues);
  if (input.taxCalculation) {
    validateCreditUsages(input.taxCalculation, issues);
    validateFiscalBalanceUsages(input.taxCalculation, issues);
  }
  validateClosedCurrentUniqueness(input, issues);
  return issues;
}

function dependentClosedPeriods(input: CloseTaxPeriodInput) {
  const month = periodMonth(input.taxPeriod);
  if (month === null) return [];
  return (input.periodVersions ?? []).filter((period) => {
    const candidateMonth = periodMonth(period);
    return (
      candidateMonth !== null &&
      candidateMonth > month &&
      period.companyId === input.companyId &&
      period.fiscalYear === input.taxPeriod.fiscalYear &&
      period.status === "CLOSED_CURRENT" &&
      period.id !== input.taxPeriod.id
    );
  });
}
function buildCloseManifest(input: CloseTaxPeriodInput & { readonly taxCalculation: TaxCalculation; readonly timestamp: string; readonly schedule: ScheduleCompletion }) {
  const logicalKey = workflowLogicalKey("TAX_PERIOD_CLOSE_MANIFEST", {
    companyId: input.companyId,
    taxPeriodId: input.taxPeriod.id,
    taxPeriodVersion: input.taxPeriod.version,
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    taxCalculationId: input.taxCalculation.id,
    matrixVersion: input.taxCalculation.matrixVersion,
    taxAdjustmentIds: input.taxCalculation.taxAdjustmentIds,
    humanDecisionIds: (input.humanDecisions ?? []).map((decision) => decision.id).sort(),
  });
  return {
    id: deterministicUuid({ type: "TAX_PERIOD_CLOSE_MANIFEST", logicalKey }),
    logicalKey,
    companyId: input.companyId,
    taxPeriodId: input.taxPeriod.id,
    taxPeriod: {
      ...periodIdentity(input.taxPeriod),
      periodType: input.taxPeriod.periodType,
      version: input.taxPeriod.version,
    },
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    taxCalculationId: input.taxCalculation.id,
    matrixVersion: input.taxCalculation.matrixVersion,
    ruleVersions: input.taxCalculation.ruleVersions,
    taxAdjustmentIds: input.taxCalculation.taxAdjustmentIds,
    humanDecisionIds: (input.humanDecisions ?? []).map((decision) => decision.id).sort(),
    fiscalBalanceUsageIds: input.taxCalculation.fiscalBalanceUsages.map((usage) => usage.id),
    creditUsageIds: input.taxCalculation.creditUsages.map((usage) => usage.id),
    closedVersion: input.taxPeriod.version,
    scheduleModule: input.schedule.modulo,
    scheduleSector: input.schedule.setor,
    createdAt: input.timestamp,
    createdBy: input.userId,
  } satisfies TaxPeriodCloseManifest;
}

export function closeTaxPeriod(input: CloseTaxPeriodInput): CloseTaxPeriodResult {
  const timestamp = normalizeCreatedAt(input.timestamp);
  const issues = validateCloseTaxPeriod(input);
  if (issues.length || !input.taxCalculation) {
    return {
      closed: false,
      issues,
      manifest: null,
      scheduleCompletion: null,
      taxPeriod: input.taxPeriod,
      taxCalculation: input.taxCalculation,
      supersededPeriods: [],
      stalePeriods: [],
      transaction: {
        committed: false,
        periodUpdates: [],
        taxCalculation: null,
        manifest: null,
        scheduleCompletion: null,
      },
    };
  }

  const identity = accountingCompletionIdentity("irpj-csll", input.companyCode, input.companyName);
  const scheduleCompletion: ScheduleCompletion = {
    ...identity,
    status: "concluido",
    confirmado_email: input.userEmail,
    confirmado_em: timestamp,
  };
  const manifest = buildCloseManifest({ ...input, taxCalculation: input.taxCalculation, timestamp, schedule: scheduleCompletion });
  const closedPeriod: WorkflowTaxPeriod = {
    ...input.taxPeriod,
    status: "CLOSED_CURRENT",
    upstreamStale: false,
    closedManifestId: manifest.id,
    updatedAt: timestamp,
  };
  const closedCalculation: TaxCalculation = {
    ...input.taxCalculation,
    versionStatus: "CLOSED_CURRENT",
  };
  const supersededPeriods = (input.periodVersions ?? [])
    .filter(
      (period) =>
        period.companyId === input.companyId &&
        period.fiscalYear === input.taxPeriod.fiscalYear &&
        period.periodCode === input.taxPeriod.periodCode &&
        period.id !== input.taxPeriod.id &&
        period.status === "CLOSED_CURRENT",
    )
    .map((period) => ({
      ...period,
      status: "CLOSED_SUPERSEDED" as const,
      replacedByTaxPeriodId: input.taxPeriod.id,
      updatedAt: timestamp,
    }));
  const stalePeriods = dependentClosedPeriods(input)
    .filter((period) => !supersededPeriods.some((superseded) => superseded.id === period.id))
    .map((period) => ({
      ...period,
      upstreamStale: true,
      updatedAt: timestamp,
    }));
  const periodUpdates = [closedPeriod, ...supersededPeriods, ...stalePeriods];

  return {
    closed: true,
    issues: [],
    manifest,
    scheduleCompletion,
    taxPeriod: closedPeriod,
    taxCalculation: closedCalculation,
    supersededPeriods,
    stalePeriods,
    transaction: {
      committed: true,
      periodUpdates,
      taxCalculation: closedCalculation,
      manifest,
      scheduleCompletion,
    },
  };
}

export function openNewTaxPeriodVersion(input: OpenNewTaxPeriodVersionInput): OpenNewTaxPeriodVersionResult {
  if (input.currentPeriod.status !== "CLOSED_CURRENT") {
    throw new Error("Abertura de V02 exige V01 CLOSED_CURRENT.");
  }
  const timestamp = normalizeCreatedAt(input.timestamp);
  const nextVersion = input.currentPeriod.version + 1;
  assertValidVersion(nextVersion, "nova versão do período fiscal");
  const newPeriod: WorkflowTaxPeriod = {
    ...input.currentPeriod,
    id: deterministicUuid({
      type: "TAX_PERIOD_VERSION",
      companyId: input.currentPeriod.companyId,
      fiscalYear: input.currentPeriod.fiscalYear,
      periodCode: input.currentPeriod.periodCode,
      version: nextVersion,
    }),
    version: nextVersion,
    status: input.nextStatus ?? "DRAFT",
    upstreamStale: false,
    closedManifestId: null,
    replacedByTaxPeriodId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    currentPeriod: input.currentPeriod,
    newPeriod,
  };
}
