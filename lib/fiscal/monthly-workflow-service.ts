import type { AccountingResultByTaxInput, AccountingResultYtdInput, TaxCalculation } from "./annual-monthly-engine.ts";
import {
  classifyHomologationPending,
  closeHomologationMonthly,
  confirmHomologationAutomaticClassification,
  correctHomologationAutomaticClassification,
  loadHomologationDashboard,
  openHomologationVersion,
  previewHomologationMonthly,
  reprocessHomologationMonthly,
  resolveHomologationConditional,
} from "./homologation-data.ts";
import { isIrpjCsllHomologationMode } from "./homologation-mode.ts";
import type { TaxDossierRecord } from "./monthly-dossier.ts";
import type { FiscalTreatment, PendingItem, RuleExecutionResult, TaxAdjustment } from "./fiscal-matrix.ts";
import {
  classifyNewAccount,
  closeTaxPeriod,
  confirmAutomaticNewAccountClassification,
  correctAutomaticNewAccountClassification,
  openNewTaxPeriodVersion,
  previewTaxPeriod,
  reprocessTaxPeriod,
  resolveConditionalOccurrence,
  validateCloseTaxPeriod,
  type CloseTaxPeriodIssue,
  type ConditionalTaxDecision,
  type TaxWorkflowHumanDecision,
  type WorkflowTaxPeriod,
} from "./monthly-workflow.ts";
import {
  annualAdjustmentPeriodCode,
  monthlyEstimatePeriodCode,
  quarterlyRealPeriodCode,
} from "./periods.ts";
import {
  commitTaxPeriodClose,
  getPendingItem,
  listFiscalMatrixContext,
  listFiscalYearProfiles,
  listPendingItems,
  listRuleExecutionResults,
  listSourceSnapshots,
  listTaxAdjustments,
  listTaxCalculations,
  listTaxDossiers,
  listTaxPeriods,
  listTaxWorkflowHumanDecisions,
  upsertAccountFiscalMapping,
  upsertFiscalNature,
  upsertFiscalRule,
  upsertPendingItem,
  upsertPendingItems,
  upsertRuleExecutionResults,
  upsertTaxAdjustments,
  upsertTaxCalculation,
  upsertTaxWorkflowHumanDecision,
  upsertTaxPeriod,
} from "./repository.ts";
import type {
  FiscalYearProfile,
  JsonObject,
  JsonValue,
  SourceSnapshot,
  SnapshotInputObject,
} from "./types.ts";
import {
  fiscalAccessErrorResponse,
  parseFiscalRequestScope,
  requireFiscalAccess,
  type FiscalAccessContext,
} from "../server/fiscal-access.ts";

export type IrpjCsllDashboardResponse = {
  readonly ok: true;
  readonly backend: "supabase";
  readonly sourceSequence: "TOTVS -> SOURCE_SNAPSHOT persistido -> motor fiscal";
  readonly company: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly profile: string;
  };
  readonly competence: string;
  readonly canWrite: boolean;
  readonly fiscalYearProfile: FiscalYearProfile | null;
  readonly taxPeriod: WorkflowTaxPeriod | null;
  readonly periodVersions: readonly WorkflowTaxPeriod[];
  readonly allYearPeriods: readonly WorkflowTaxPeriod[];
  readonly engine: {
    readonly code: "ANNUAL_MONTHLY" | "ENGINE_NOT_ENABLED_FOR_REGIME";
    readonly readOnly: true;
    readonly source: "FISCAL_YEAR_PROFILE";
    readonly reason: string;
  };
  readonly sourceSnapshot: SourceSnapshot | null;
  readonly sourceSnapshots: readonly SourceSnapshot[];
  readonly pendingItems: readonly PendingItem[];
  readonly ruleExecutionResults: readonly RuleExecutionResult[];
  readonly taxAdjustments: readonly TaxAdjustment[];
  readonly taxCalculations: readonly TaxCalculation[];
  readonly taxCalculation: TaxCalculation | null;
  readonly humanDecisions: readonly TaxWorkflowHumanDecision[];
  readonly dossiers: readonly TaxDossierRecord[];
  readonly closeIssues: readonly CloseTaxPeriodIssue[];
  readonly closeAllowed: boolean;
  readonly annualAdjustmentPeriodCode: string;
};

type WorkflowState = {
  readonly access: FiscalAccessContext;
  readonly fiscalYear: number;
  readonly month: number;
  readonly fiscalYearProfile: FiscalYearProfile | null;
  readonly targetPeriodCode: string;
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

type PreviewPayload = {
  readonly accountingResultYtd?: unknown;
  readonly accountingResultBeforeIrpjYtd?: unknown;
  readonly accountingResultBeforeCsllYtd?: unknown;
  readonly accountingResultYtdByTax?: unknown;
  readonly versionStatus?: TaxCalculation["versionStatus"];
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

export class FiscalWorkflowServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fiscalWorkflowErrorResponse(error: unknown) {
  if (error instanceof FiscalWorkflowServiceError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message } };
  }
  return fiscalAccessErrorResponse(error);
}

function fiscalYearFromCompetence(competence: string) {
  return Number(competence.slice(0, 4));
}

function monthFromCompetence(competence: string) {
  return Number(competence.slice(5, 7));
}

function quarterFromMonth(month: number) {
  return Math.ceil(month / 3);
}

function targetPeriodCode(profile: FiscalYearProfile | null, fiscalYear: number, month: number) {
  if (profile?.periodicity === "QUARTERLY") return quarterlyRealPeriodCode(fiscalYear, quarterFromMonth(month));
  return monthlyEstimatePeriodCode(fiscalYear, month);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function sourceObject(value: unknown, snapshot: SourceSnapshot): JsonObject {
  const source = asObject(value);
  return Object.keys(source).length > 0 ? source : { sourceSnapshotId: snapshot.id, sourceSnapshotHash: snapshot.hash };
}

function asObjectArray(value: unknown): readonly JsonObject[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonObject[] : [];
}

function jsonAt(root: unknown, path: readonly string[]) {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function monetaryCandidate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function requiredText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new FiscalWorkflowServiceError(400, "MISSING_FIELD", `${label} é obrigatório.`);
  return text;
}

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function requiredNumber(value: unknown, label: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new FiscalWorkflowServiceError(400, "INVALID_FIELD", `${label} inválido.`);
  return numeric;
}

function requiredInt(value: unknown, label: string) {
  const numeric = requiredNumber(value, label);
  if (!Number.isInteger(numeric)) throw new FiscalWorkflowServiceError(400, "INVALID_FIELD", `${label} deve ser inteiro.`);
  return numeric;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const text = requiredText(value, label);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new FiscalWorkflowServiceError(400, "INVALID_FIELD", `${label} inválido.`);
  }
  return text as T;
}

function selectedPeriodVersion(periods: readonly WorkflowTaxPeriod[]) {
  return periods
    .filter((period) => period.status !== "CLOSED_SUPERSEDED")
    .sort((left, right) => right.version - left.version || String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0]
    ?? periods[0]
    ?? null;
}

function latestCalculation(calculations: readonly TaxCalculation[]) {
  return calculations
    .filter((calculation) => calculation.versionStatus !== "CLOSED_SUPERSEDED")
    .sort((left, right) => {
      if (left.versionStatus === "CLOSED_CURRENT" && right.versionStatus !== "CLOSED_CURRENT") return -1;
      if (right.versionStatus === "CLOSED_CURRENT" && left.versionStatus !== "CLOSED_CURRENT") return 1;
      return right.calculationVersion - left.calculationVersion || right.createdAt.localeCompare(left.createdAt);
    })[0] ?? null;
}

function fiscalEngine(profile: FiscalYearProfile | null, period: WorkflowTaxPeriod | null): IrpjCsllDashboardResponse["engine"] {
  if (profile?.taxRegime === "REAL_PROFIT" && profile.periodicity === "ANNUAL" && (!period || period.periodType === "MONTHLY_ESTIMATE")) {
    return { code: "ANNUAL_MONTHLY", readOnly: true, source: "FISCAL_YEAR_PROFILE", reason: "Lucro Real anual com apuração mensal por estimativa/balanço." };
  }
  return { code: "ENGINE_NOT_ENABLED_FOR_REGIME", readOnly: true, source: "FISCAL_YEAR_PROFILE", reason: "Motor mensal habilitado somente para Lucro Real anual nesta fase." };
}

function closeIssuesForState(state: WorkflowState) {
  if (!state.taxPeriod) {
    return [{ code: "MISSING_TAX_PERIOD", message: "Período fiscal não encontrado para a competência.", severity: "BLOCKING", metadata: { competence: state.access.competence } }] satisfies CloseTaxPeriodIssue[];
  }
  if (!state.sourceSnapshot) {
    return [{ code: "MISSING_SOURCE_SNAPSHOT", message: "Fechamento exige SOURCE_SNAPSHOT persistido antes do motor fiscal.", severity: "BLOCKING", metadata: { sequence: "TOTVS_SOURCE_SNAPSHOT_FISCAL_ENGINE" } }] satisfies CloseTaxPeriodIssue[];
  }
  if (state.taxPeriod.status === "CLOSED_CURRENT" || state.taxPeriod.status === "CLOSED_SUPERSEDED") {
    return [] satisfies CloseTaxPeriodIssue[];
  }
  if (fiscalEngine(state.fiscalYearProfile, state.taxPeriod).code !== "ANNUAL_MONTHLY") {
    return [{ code: "ENGINE_NOT_ENABLED_FOR_REGIME", message: "Fechamento mensal ainda não está habilitado para este regime/periodicidade.", severity: "BLOCKING", metadata: { periodicity: state.fiscalYearProfile?.periodicity ?? null } }] satisfies CloseTaxPeriodIssue[];
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
    companyCode: state.access.company.code,
    companyName: state.access.company.name,
    userId: state.access.user.id,
    userEmail: state.access.user.email ?? "",
  });
}

async function readWorkflowState(access: FiscalAccessContext): Promise<WorkflowState> {
  const fiscalYear = fiscalYearFromCompetence(access.competence);
  const month = monthFromCompetence(access.competence);
  const fiscalYearProfiles = await listFiscalYearProfiles(access.client, access.company.id, fiscalYear);
  const fiscalYearProfile = fiscalYearProfiles[0] ?? null;
  const allYearPeriods = await listTaxPeriods(access.client, access.company.id, fiscalYear);
  const code = targetPeriodCode(fiscalYearProfile, fiscalYear, month);
  const periodVersions = allYearPeriods
    .filter((period) => period.periodCode === code)
    .sort((left, right) => right.version - left.version);
  const taxPeriod = selectedPeriodVersion(periodVersions);
  const versionPeriodIds = periodVersions.map((period) => period.id);
  if (!taxPeriod) {
    return {
      access,
      fiscalYear,
      month,
      fiscalYearProfile,
      targetPeriodCode: code,
      taxPeriod: null,
      periodVersions,
      allYearPeriods,
      sourceSnapshots: [],
      sourceSnapshot: null,
      pendingItems: [],
      ruleExecutionResults: [],
      taxAdjustments: [],
      taxCalculations: [],
      taxCalculation: null,
      humanDecisions: [],
      dossiers: [],
    };
  }
  const [sourceSnapshots, pendingItems, ruleExecutionResults, taxAdjustments, taxCalculations, humanDecisions, dossiers] = await Promise.all([
    listSourceSnapshots(access.client, access.company.id, taxPeriod.id),
    listPendingItems(access.client, access.company.id, taxPeriod.id),
    listRuleExecutionResults(access.client, access.company.id, taxPeriod.id),
    listTaxAdjustments(access.client, access.company.id, taxPeriod.id),
    Promise.all(versionPeriodIds.map((periodId) => listTaxCalculations(access.client, access.company.id, periodId))).then((items) => items.flat()),
    listTaxWorkflowHumanDecisions(access.client, access.company.id, taxPeriod.id),
    listTaxDossiers(access.client, access.company.id, periodVersions.map((period) => period.id)),
  ]);
  return {
    access,
    fiscalYear,
    month,
    fiscalYearProfile,
    targetPeriodCode: code,
    taxPeriod,
    periodVersions,
    allYearPeriods,
    sourceSnapshots,
    sourceSnapshot: sourceSnapshots[0] ?? null,
    pendingItems,
    ruleExecutionResults,
    taxAdjustments,
    taxCalculations,
    taxCalculation: latestCalculation(taxCalculations.filter((calculation) => calculation.taxPeriodId === taxPeriod.id)),
    humanDecisions,
    dossiers,
  };
}

function dashboardFromState(state: WorkflowState): IrpjCsllDashboardResponse {
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

export async function loadIrpjCsllDashboard(request: Request) {
  if (isIrpjCsllHomologationMode()) return loadHomologationDashboard(request);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request));
  return dashboardFromState(await readWorkflowState(access));
}

function assertRunnableAnnualMonthly(state: WorkflowState) {
  if (!state.fiscalYearProfile) throw new FiscalWorkflowServiceError(409, "MISSING_FISCAL_YEAR_PROFILE", "Perfil fiscal do exercício não encontrado.");
  if (!state.taxPeriod) throw new FiscalWorkflowServiceError(409, "MISSING_TAX_PERIOD", "Período fiscal não encontrado.");
  if (!state.sourceSnapshot) throw new FiscalWorkflowServiceError(409, "MISSING_SOURCE_SNAPSHOT", "SOURCE_SNAPSHOT persistido é obrigatório antes do motor fiscal.");
  if (fiscalEngine(state.fiscalYearProfile, state.taxPeriod).code !== "ANNUAL_MONTHLY") {
    throw new FiscalWorkflowServiceError(409, "ENGINE_NOT_ENABLED_FOR_REGIME", "Motor mensal não habilitado para este regime/periodicidade.");
  }
  return {
    fiscalYearProfile: state.fiscalYearProfile,
    taxPeriod: state.taxPeriod,
    sourceSnapshot: state.sourceSnapshot,
  };
}

function matrixVersionNumberFromState(state: { readonly ruleExecutionResults?: readonly RuleExecutionResult[]; readonly taxAdjustments?: readonly TaxAdjustment[] }) {
  const versions = [...(state.ruleExecutionResults ?? []), ...(state.taxAdjustments ?? [])]
    .map((item) => Number((item as Record<string, unknown>).fiscalRuleVersion ?? (item as Record<string, unknown>).fiscal_rule_version))
    .filter((value) => Number.isInteger(value) && value > 0);
  return Math.max(1, ...versions);
}

function matrixVersionString(matrixVersionNumber: number) {
  return `SUPABASE_MATRIX_V${matrixVersionNumber}`;
}

function accountingResultValueCandidate(value: unknown) {
  const direct = monetaryCandidate(value);
  if (direct !== null) return direct;
  if (value && typeof value === "object" && !Array.isArray(value)) return monetaryCandidate((value as Record<string, unknown>).value);
  return null;
}
function accountingResultYtdFromSnapshot(snapshot: SourceSnapshot, payload: PreviewPayload = {}): AccountingResultYtdInput {
  const direct = accountingResultValueCandidate(payload.accountingResultYtd);
  if (direct !== null) {
    const source: JsonObject = { origin: "REQUEST_BODY", field: "accountingResultYtd", sourceSnapshotId: snapshot.id, sourceSnapshotHash: snapshot.hash };
    return { value: direct, source };
  }
  const candidates: readonly { readonly path: readonly string[]; readonly root: unknown }[] = [
    { root: snapshot.parameters, path: ["accountingResultYtd"] },
    { root: snapshot.parameters, path: ["resultadoContabilAcumulado"] },
    { root: snapshot.parameters, path: ["fiscal", "accountingResultYtd"] },
    { root: snapshot.balances, path: ["accountingResultYtd"] },
    { root: snapshot.balances, path: ["resultadoContabilAcumulado"] },
    { root: snapshot.balances, path: ["fiscal", "accountingResultYtd"] },
  ];
  for (const candidate of candidates) {
    const value = accountingResultValueCandidate(jsonAt(candidate.root, candidate.path));
    if (value !== null) {
      const source: JsonObject = { origin: "SOURCE_SNAPSHOT", path: candidate.path.join("."), sourceSnapshotId: snapshot.id, sourceSnapshotHash: snapshot.hash };
      return { value, source };
    }
  }
  throw new FiscalWorkflowServiceError(422, "MISSING_ACCOUNTING_RESULT_YTD", "Resultado contábil acumulado deve existir no SOURCE_SNAPSHOT ou ser informado explicitamente ao backend.");
}
function accountingResultYtdForTaxFromSnapshot(tax: "IRPJ" | "CSLL", snapshot: SourceSnapshot, payload: PreviewPayload = {}): AccountingResultYtdInput | undefined {
  const field = tax === "IRPJ" ? "accountingResultBeforeIrpjYtd" : "accountingResultBeforeCsllYtd";
  const label = tax === "IRPJ" ? "Resultado contábil antes do IRPJ" : "Resultado contábil antes da CSLL";
  const payloadValue = tax === "IRPJ" ? payload.accountingResultBeforeIrpjYtd : payload.accountingResultBeforeCsllYtd;
  const direct = accountingResultValueCandidate(payloadValue ?? jsonAt(payload.accountingResultYtdByTax, [tax]));
  if (direct !== null) return { value: direct, source: { origin: "REQUEST_BODY", field, tax, sourceSnapshotId: snapshot.id, sourceSnapshotHash: snapshot.hash } as JsonObject };
  const candidates: readonly { readonly path: readonly string[]; readonly root: unknown }[] = [
    { root: snapshot.parameters, path: [field] },
    { root: snapshot.parameters, path: ["fiscal", field] },
    { root: snapshot.parameters, path: ["accountingResultYtdByTax", tax] },
    { root: snapshot.balances, path: [field] },
    { root: snapshot.balances, path: ["fiscal", field] },
    { root: snapshot.balances, path: ["accountingResultYtdByTax", tax] },
  ];
  for (const candidate of candidates) {
    const value = accountingResultValueCandidate(jsonAt(candidate.root, candidate.path));
    if (value !== null) return { value, source: { origin: "SOURCE_SNAPSHOT", path: candidate.path.join("."), tax, label, sourceSnapshotId: snapshot.id, sourceSnapshotHash: snapshot.hash } as JsonObject };
  }
  return undefined;
}
function accountingResultYtdByTaxFromSnapshot(snapshot: SourceSnapshot, payload: PreviewPayload = {}): AccountingResultByTaxInput | undefined {
  const irpj = accountingResultYtdForTaxFromSnapshot("IRPJ", snapshot, payload);
  const csll = accountingResultYtdForTaxFromSnapshot("CSLL", snapshot, payload);
  if (!irpj && !csll) return undefined;
  return { ...(irpj ? { IRPJ: irpj } : {}), ...(csll ? { CSLL: csll } : {}) };
}
function fiscalBalancesFromSnapshot(snapshot: SourceSnapshot) {
  const rows = [
    ...asObjectArray(jsonAt(snapshot.parameters, ["fiscalBalances"])),
    ...asObjectArray(jsonAt(snapshot.balances, ["fiscalBalances"])),
  ];
  return rows.map((row) => ({
    id: requiredText(row.id, "ID do saldo fiscal"),
    tax: enumValue(row.tax, ["IRPJ", "CSLL"] as const, "Tributo do saldo fiscal"),
    balanceType: enumValue(row.balanceType, ["PREJUIZO_FISCAL", "BASE_NEGATIVA_CSLL"] as const, "Tipo de saldo fiscal"),
    originYear: row.originYear === null || row.originYear === undefined ? null : requiredInt(row.originYear, "Ano de origem do saldo fiscal"),
    availableAmount: requiredText(row.availableAmount ?? row.available, "Valor disponível do saldo fiscal"),
    source: sourceObject(row.source, snapshot),
  }));
}

function taxCreditsFromSnapshot(snapshot: SourceSnapshot) {
  const rows = [
    ...asObjectArray(jsonAt(snapshot.parameters, ["taxCredits"])),
    ...asObjectArray(jsonAt(snapshot.parameters, ["credits"])),
    ...asObjectArray(jsonAt(snapshot.balances, ["taxCredits"])),
  ];
  return rows.map((row) => ({
    id: requiredText(row.id, "ID do crédito fiscal"),
    tax: enumValue(row.tax, ["IRPJ", "CSLL"] as const, "Tributo do crédito fiscal"),
    nature: enumValue(row.nature, ["IRRF_SERVICOS", "IRRF_APLICACOES_FINANCEIRAS", "CSLL_EXPLICIT_DEDUCTION"] as const, "Natureza do crédito fiscal"),
    label: optionalText(row.label) ?? undefined,
    availableAmount: requiredText(row.availableAmount ?? row.available, "Valor disponível do crédito fiscal"),
    source: sourceObject(row.source, snapshot),
  }));
}

async function priorClosedCalculations(state: WorkflowState) {
  if (!state.taxPeriod) return [];
  const currentPeriod = state.taxPeriod;
  const priorPeriods = state.allYearPeriods
    .filter((period) =>
      period.companyId === state.access.company.id
      && period.fiscalYear === state.fiscalYear
      && period.periodType === "MONTHLY_ESTIMATE"
      && period.status === "CLOSED_CURRENT"
      && period.endDate < currentPeriod.endDate,
    )
    .sort((left, right) => left.endDate.localeCompare(right.endDate));
  const calculations = await Promise.all(
    priorPeriods.map((period) => listTaxCalculations(state.access.client, state.access.company.id, period.id)),
  );
  return calculations.flatMap((items) => items.filter((item) => item.versionStatus === "CLOSED_CURRENT"));
}

function nextCalculationVersion(calculations: readonly TaxCalculation[]) {
  return Math.max(0, ...calculations.map((calculation) => calculation.calculationVersion)) + 1;
}

async function persistPreviewResult(state: WorkflowState, result: ReturnType<typeof reprocessTaxPeriod>) {
  await upsertPendingItems(state.access.client, result.pendingItems);
  await upsertRuleExecutionResults(state.access.client, result.ruleExecutionResults);
  await upsertTaxAdjustments(state.access.client, result.taxAdjustments);
  if (result.taxCalculation) await upsertTaxCalculation(state.access.client, result.taxCalculation);
  await upsertTaxPeriod(state.access.client, result.taxPeriod);
}

async function executePreview(request: Request, payload: PreviewPayload, mode: "preview" | "reprocess") {
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request), { write: true });
  const state = await readWorkflowState(access);
  const runnable = assertRunnableAnnualMonthly(state);
  const matrix = await listFiscalMatrixContext(access.client, access.company.id, state.fiscalYear);
  const matrixVersionNumber = matrixVersionNumberFromState({ ruleExecutionResults: state.ruleExecutionResults, taxAdjustments: state.taxAdjustments });
  const input = {
    companyId: access.company.id,
    fiscalYearProfile: runnable.fiscalYearProfile,
    taxPeriod: runnable.taxPeriod,
    sourceSnapshot: runnable.sourceSnapshot,
    matrix,
    accountingResultYtd: accountingResultYtdFromSnapshot(runnable.sourceSnapshot, payload),
    accountingResultYtdByTax: accountingResultYtdByTaxFromSnapshot(runnable.sourceSnapshot, payload),
    fiscalBalances: fiscalBalancesFromSnapshot(runnable.sourceSnapshot),
    taxCredits: taxCreditsFromSnapshot(runnable.sourceSnapshot),
    priorCalculations: await priorClosedCalculations(state),
    existingPendingItems: state.pendingItems,
    existingRuleExecutionResults: state.ruleExecutionResults,
    existingTaxAdjustments: state.taxAdjustments,
    matrixVersion: matrixVersionString(matrixVersionNumber),
    calculationVersion: nextCalculationVersion(state.taxCalculations.filter((calculation) => calculation.taxPeriodId === runnable.taxPeriod.id)),
    versionStatus: payload.versionStatus ?? "DRAFT",
  };
  const result = mode === "reprocess" ? reprocessTaxPeriod(input) : previewTaxPeriod(input);
  await persistPreviewResult(state, result);
  return dashboardFromState(await readWorkflowState(access));
}

export async function previewIrpjCsllMonthly(request: Request, payload: PreviewPayload = {}) {
  if (isIrpjCsllHomologationMode()) return previewHomologationMonthly(request, payload);
  return executePreview(request, payload, "preview");
}

export async function reprocessIrpjCsllMonthly(request: Request, payload: PreviewPayload = {}) {
  if (isIrpjCsllHomologationMode()) return reprocessHomologationMonthly(request, payload);
  return executePreview(request, payload, "reprocess");
}

function originValue(pendingItem: PendingItem, key: string) {
  return (pendingItem.originData as Record<string, JsonValue | undefined>)[key];
}

export async function classifyIrpjCsllPending(request: Request, pendingId: string, payload: ClassifyPayload) {
  if (isIrpjCsllHomologationMode()) return classifyHomologationPending(request, pendingId, payload);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request), { write: true });
  const state = await readWorkflowState(access);
  const runnable = assertRunnableAnnualMonthly(state);
  const pendingItem = await getPendingItem(access.client, access.company.id, pendingId);
  if (pendingItem.taxPeriodId !== runnable.taxPeriod.id) {
    throw new FiscalWorkflowServiceError(409, "PENDING_PERIOD_MISMATCH", "Pendência não pertence ao período selecionado.");
  }
  const matrixVersionBefore = matrixVersionNumberFromState({ ruleExecutionResults: state.ruleExecutionResults, taxAdjustments: state.taxAdjustments });
  const result = classifyNewAccount({
    companyId: access.company.id,
    taxPeriod: runnable.taxPeriod,
    sourceSnapshot: runnable.sourceSnapshot,
    pendingItem,
    accountingChartId: requiredText(payload.accountingChartId ?? originValue(pendingItem, "accountingChartId"), "Plano de contas"),
    accountCode: requiredText(payload.accountCode ?? originValue(pendingItem, "accountCode"), "Conta contábil"),
    reducedCode: optionalText(payload.reducedCode ?? originValue(pendingItem, "reducedCode")),
    fiscalNatureCode: requiredText(payload.fiscalNatureCode, "Código da natureza fiscal"),
    fiscalNatureName: requiredText(payload.fiscalNatureName, "Nome da natureza fiscal"),
    fiscalNatureDescription: optionalText(payload.fiscalNatureDescription) ?? undefined,
    fiscalRuleCode: requiredText(payload.fiscalRuleCode, "Código da regra fiscal"),
    irpjTreatment: enumValue(payload.irpjTreatment, ["NO_ADJUSTMENT", "ADDITION", "EXCLUSION", "CONDITIONAL", "AUTOMATIC_SPECIAL"] as const, "Tratamento IRPJ") as FiscalTreatment,
    csllTreatment: enumValue(payload.csllTreatment, ["NO_ADJUSTMENT", "ADDITION", "EXCLUSION", "CONDITIONAL", "AUTOMATIC_SPECIAL"] as const, "Tratamento CSLL") as FiscalTreatment,
    amountBasis: payload.amountBasis ? enumValue(payload.amountBasis, ["NET_DEBIT_MOVEMENT", "NET_CREDIT_MOVEMENT"] as const, "Base do valor") : undefined,
    matrixVersionBefore,
    justification: requiredText(payload.justification, "Justificativa"),
    userId: access.user.id,
    userEmail: access.user.email ?? null,
  });
  await upsertFiscalNature(access.client, result.generatedFiscalNature);
  await upsertFiscalRule(access.client, result.generatedFiscalRule);
  await upsertAccountFiscalMapping(access.client, result.generatedMapping);
  await upsertPendingItem(access.client, result.resolvedPendingItem);
  await upsertTaxWorkflowHumanDecision(access.client, result.decision);
  return dashboardFromState(await readWorkflowState(access));
}

export async function confirmIrpjCsllAutomaticClassification(request: Request, pendingId: string) {
  if (isIrpjCsllHomologationMode()) return confirmHomologationAutomaticClassification(request, pendingId);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request), { write: true });
  const state = await readWorkflowState(access);
  const runnable = assertRunnableAnnualMonthly(state);
  const pendingItem = await getPendingItem(access.client, access.company.id, pendingId);
  if (pendingItem.taxPeriodId !== runnable.taxPeriod.id) {
    throw new FiscalWorkflowServiceError(409, "PENDING_PERIOD_MISMATCH", "Pendência não pertence ao período selecionado.");
  }
  const result = confirmAutomaticNewAccountClassification({
    companyId: access.company.id,
    taxPeriod: runnable.taxPeriod,
    sourceSnapshot: runnable.sourceSnapshot,
    pendingItem,
    matrixVersionBefore: matrixVersionNumberFromState({ ruleExecutionResults: state.ruleExecutionResults, taxAdjustments: state.taxAdjustments }),
    userId: access.user.id,
    userEmail: access.user.email ?? null,
  });
  await upsertPendingItem(access.client, result.resolvedPendingItem);
  await upsertTaxWorkflowHumanDecision(access.client, result.decision);
  return dashboardFromState(await readWorkflowState(access));
}

export async function correctIrpjCsllAutomaticClassification(request: Request, pendingId: string, payload: ClassifyPayload) {
  if (isIrpjCsllHomologationMode()) return correctHomologationAutomaticClassification(request, pendingId, payload);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request), { write: true });
  const state = await readWorkflowState(access);
  const runnable = assertRunnableAnnualMonthly(state);
  const pendingItem = await getPendingItem(access.client, access.company.id, pendingId);
  if (pendingItem.taxPeriodId !== runnable.taxPeriod.id) {
    throw new FiscalWorkflowServiceError(409, "PENDING_PERIOD_MISMATCH", "Pendência não pertence ao período selecionado.");
  }
  const matrixVersionBefore = matrixVersionNumberFromState({ ruleExecutionResults: state.ruleExecutionResults, taxAdjustments: state.taxAdjustments });
  const result = correctAutomaticNewAccountClassification({
    companyId: access.company.id,
    taxPeriod: runnable.taxPeriod,
    sourceSnapshot: runnable.sourceSnapshot,
    pendingItem,
    accountingChartId: requiredText(payload.accountingChartId ?? originValue(pendingItem, "accountingChartId"), "Plano de contas"),
    accountCode: requiredText(payload.accountCode ?? originValue(pendingItem, "accountCode"), "Conta contábil"),
    reducedCode: optionalText(payload.reducedCode ?? originValue(pendingItem, "reducedCode")),
    fiscalNatureCode: requiredText(payload.fiscalNatureCode, "Código da natureza fiscal"),
    fiscalNatureName: requiredText(payload.fiscalNatureName, "Nome da natureza fiscal"),
    fiscalNatureDescription: optionalText(payload.fiscalNatureDescription) ?? undefined,
    fiscalRuleCode: requiredText(payload.fiscalRuleCode, "Código da regra fiscal"),
    irpjTreatment: enumValue(payload.irpjTreatment, ["NO_ADJUSTMENT", "ADDITION", "EXCLUSION", "CONDITIONAL", "AUTOMATIC_SPECIAL"] as const, "Tratamento IRPJ") as FiscalTreatment,
    csllTreatment: enumValue(payload.csllTreatment, ["NO_ADJUSTMENT", "ADDITION", "EXCLUSION", "CONDITIONAL", "AUTOMATIC_SPECIAL"] as const, "Tratamento CSLL") as FiscalTreatment,
    amountBasis: payload.amountBasis ? enumValue(payload.amountBasis, ["NET_DEBIT_MOVEMENT", "NET_CREDIT_MOVEMENT"] as const, "Base do valor") : undefined,
    matrixVersionBefore,
    justification: requiredText(payload.justification, "Justificativa"),
    userId: access.user.id,
    userEmail: access.user.email ?? null,
  });
  await upsertFiscalNature(access.client, result.generatedFiscalNature);
  await upsertFiscalRule(access.client, result.generatedFiscalRule);
  await upsertAccountFiscalMapping(access.client, result.generatedMapping);
  await upsertPendingItem(access.client, result.resolvedPendingItem);
  await upsertTaxWorkflowHumanDecision(access.client, result.decision);
  return dashboardFromState(await readWorkflowState(access));
}
export async function resolveIrpjCsllConditional(request: Request, pendingId: string, payload: ConditionalPayload) {
  if (isIrpjCsllHomologationMode()) return resolveHomologationConditional(request, pendingId, payload);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request), { write: true });
  const state = await readWorkflowState(access);
  const runnable = assertRunnableAnnualMonthly(state);
  const pendingItem = await getPendingItem(access.client, access.company.id, pendingId);
  if (pendingItem.taxPeriodId !== runnable.taxPeriod.id) {
    throw new FiscalWorkflowServiceError(409, "PENDING_PERIOD_MISMATCH", "Pendência não pertence ao período selecionado.");
  }
  const result = resolveConditionalOccurrence({
    companyId: access.company.id,
    taxPeriod: runnable.taxPeriod,
    sourceSnapshot: runnable.sourceSnapshot,
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
    irpjDecision: enumValue(payload.irpjDecision, ["ADDITION", "EXCLUSION", "NO_ADJUSTMENT"] as const, "Decisão IRPJ") as ConditionalTaxDecision,
    csllDecision: enumValue(payload.csllDecision, ["ADDITION", "EXCLUSION", "NO_ADJUSTMENT"] as const, "Decisão CSLL") as ConditionalTaxDecision,
    amount: requiredText(payload.amount ?? originValue(pendingItem, "amount"), "Valor da ocorrência"),
    sourceContext: asObject(payload.sourceContext ?? pendingItem.originData),
    matrixVersionBefore: matrixVersionNumberFromState({ ruleExecutionResults: state.ruleExecutionResults, taxAdjustments: state.taxAdjustments }),
    justification: requiredText(payload.justification, "Justificativa"),
    userId: access.user.id,
    userEmail: access.user.email ?? null,
  });
  await upsertPendingItem(access.client, result.resolvedPendingItem);
  await upsertTaxWorkflowHumanDecision(access.client, result.decision);
  await upsertRuleExecutionResults(access.client, [result.ruleExecutionResult]);
  await upsertTaxAdjustments(access.client, result.taxAdjustments);
  return dashboardFromState(await readWorkflowState(access));
}

export async function openIrpjCsllVersion(request: Request) {
  if (isIrpjCsllHomologationMode()) return openHomologationVersion(request);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request), { write: true });
  const state = await readWorkflowState(access);
  if (!state.taxPeriod) throw new FiscalWorkflowServiceError(409, "MISSING_TAX_PERIOD", "Período fiscal não encontrado.");
  const result = openNewTaxPeriodVersion({ currentPeriod: state.taxPeriod });
  await upsertTaxPeriod(access.client, result.newPeriod);
  return dashboardFromState(await readWorkflowState(access));
}

export async function closeIrpjCsllMonthly(request: Request) {
  if (isIrpjCsllHomologationMode()) return closeHomologationMonthly(request);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request), { write: true });
  const state = await readWorkflowState(access);
  const runnable = assertRunnableAnnualMonthly(state);
  const result = closeTaxPeriod({
    companyId: access.company.id,
    taxPeriod: runnable.taxPeriod,
    sourceSnapshot: runnable.sourceSnapshot,
    taxCalculation: state.taxCalculation,
    taxAdjustments: state.taxAdjustments,
    pendingItems: state.pendingItems,
    humanDecisions: state.humanDecisions,
    periodVersions: state.periodVersions,
    expectedMatrixVersion: state.taxCalculation?.matrixVersion,
    companyCode: access.company.code,
    companyName: access.company.name,
    userId: access.user.id,
    userEmail: access.user.email ?? "",
  });
  if (!result.closed || !result.taxCalculation || !result.manifest || !result.scheduleCompletion) {
    return { ...dashboardFromState(state), closeIssues: result.issues, closeAllowed: false };
  }
  const timestamp = result.manifest.createdAt;
  await commitTaxPeriodClose(access.client, {
    companyId: access.company.id,
    closedPeriod: result.taxPeriod,
    taxCalculation: result.taxCalculation,
    manifest: result.manifest,
    scheduleCompetence: access.competence,
    scheduleCompletion: result.scheduleCompletion,
    supersededPeriods: result.supersededPeriods,
    stalePeriods: result.stalePeriods,
    userId: access.user.id,
    userEmail: access.user.email ?? "",
    timestamp,
  });
  return dashboardFromState(await readWorkflowState(access));
}








