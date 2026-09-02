import assert from "node:assert/strict";
import test from "node:test";
import type { FiscalCreditAvailable, TaxCalculation } from "../lib/fiscal/annual-monthly-engine.ts";
import type {
  AccountFiscalMapping,
  AccountingChart,
  CompanyAccountingChart,
  FiscalNature,
  FiscalRule,
  PendingItem,
  TaxAdjustment,
} from "../lib/fiscal/fiscal-matrix.ts";
import {
  classifyNewAccount,
  closeTaxPeriod,
  confirmAutomaticNewAccountClassification,
  correctAutomaticNewAccountClassification,
  isBlockingPendingItem,
  openNewTaxPeriodVersion,
  previewTaxPeriod,
  reprocessTaxPeriod,
  resolveConditionalOccurrence,
  reviewTaxPeriod,
  type FiscalMatrixContext,
  type WorkflowTaxPeriod,
} from "../lib/fiscal/monthly-workflow.ts";
import { buildTaxPeriodsForProfile } from "../lib/fiscal/periods.ts";
import { createSourceSnapshotDraft } from "../lib/fiscal/source-snapshot.ts";
import type { FiscalYearProfile, JsonObject, SourceSnapshot } from "../lib/fiscal/types.ts";

const COMPANY_ID = "empresa-raiz";
const PROFILE_ID = "profile-2026-annual";
const ACCOUNTING_CHART_ID = "chart-raiz-2026";
const COMPANY_CHART_ID = "company-chart-raiz-2026";
const MATRIX_VERSION = "v53";
const CREATED_AT = "2026-09-01T12:00:00.000Z";
const USER_ID = "user-fiscal";
const USER_EMAIL = "fiscal@raizeducacao.com.br";

type PreviewOptions = {
  readonly period?: WorkflowTaxPeriod;
  readonly matrix?: FiscalMatrixContext;
  readonly records?: readonly JsonObject[];
  readonly existingPendingItems?: readonly PendingItem[];
  readonly existingTaxAdjustments?: readonly TaxAdjustment[];
  readonly accountingResultYtd?: number;
  readonly accountingResultYtdByTax?: Partial<Record<"IRPJ" | "CSLL", number | string>>;
  readonly taxCredits?: readonly FiscalCreditAvailable[];
  readonly priorCalculations?: readonly TaxCalculation[];
};

function money(value: number | string) {
  return typeof value === "number" ? value.toFixed(2) : Number(value).toFixed(2);
}

function monthEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function annualProfile(overrides: Partial<FiscalYearProfile> = {}): FiscalYearProfile {
  const fiscalYear = overrides.fiscalYear ?? 2026;
  return {
    id: PROFILE_ID,
    companyId: COMPANY_ID,
    fiscalYear,
    taxRegime: "REAL_PROFIT",
    periodicity: "ANNUAL",
    validFrom: `${fiscalYear}-01-01`,
    validTo: `${fiscalYear}-12-31`,
    version: 1,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function monthlyPeriod(month: number, overrides: Partial<WorkflowTaxPeriod> = {}): WorkflowTaxPeriod {
  const fiscalYear = overrides.fiscalYear ?? 2026;
  const mm = String(month).padStart(2, "0");
  const version = overrides.version ?? 1;
  return {
    id: overrides.id ?? `period-${fiscalYear}-m${mm}-v${version}`,
    companyId: COMPANY_ID,
    fiscalYearProfileId: PROFILE_ID,
    fiscalYear,
    periodCode: `${fiscalYear}-M${mm}`,
    startDate: `${fiscalYear}-01-01`,
    endDate: monthEnd(fiscalYear, month),
    periodType: "MONTHLY_ESTIMATE",
    status: "DRAFT",
    version,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function quarterPeriod(quarter: number): WorkflowTaxPeriod {
  const ranges = [
    ["01-01", "03-31"],
    ["04-01", "06-30"],
    ["07-01", "09-30"],
    ["10-01", "12-31"],
  ] as const;
  const [start, end] = ranges[quarter - 1];
  const qq = String(quarter).padStart(2, "0");
  return {
    id: `period-2026-t${qq}`,
    companyId: COMPANY_ID,
    fiscalYearProfileId: PROFILE_ID,
    fiscalYear: 2026,
    periodCode: `2026-T${qq}`,
    startDate: `2026-${start}`,
    endDate: `2026-${end}`,
    periodType: "QUARTERLY_REAL",
    status: "DRAFT",
    version: 1,
    createdAt: CREATED_AT,
  };
}

function annualAdjustmentPeriod(): WorkflowTaxPeriod {
  return {
    id: "period-2026-annual-v1",
    companyId: COMPANY_ID,
    fiscalYearProfileId: PROFILE_ID,
    fiscalYear: 2026,
    periodCode: "2026-A00",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    periodType: "ANNUAL_ADJUSTMENT",
    status: "DRAFT",
    version: 1,
    createdAt: CREATED_AT,
  };
}

function trialBalanceRecord(input: {
  readonly accountCode: string;
  readonly description: string;
  readonly debit?: number;
  readonly credit?: number;
  readonly reducedCode?: string | null;
}): JsonObject {
  const debit = input.debit ?? 0;
  const credit = input.credit ?? 0;
  return {
    accountCode: input.accountCode,
    reducedCode: input.reducedCode ?? null,
    description: input.description,
    openingBalance: "0.00",
    debit: money(debit),
    credit: money(credit),
    movement: money(debit - credit),
    closingBalance: money(debit - credit),
  };
}

function knownRecord(value = 1000) {
  return trialBalanceRecord({
    accountCode: "4.2.1.02.01.001",
    description: "Servicos administrativos conhecidos",
    debit: value,
  });
}

function postalRecord(value = 180) {
  return trialBalanceRecord({
    accountCode: "4.2.1.02.04.991",
    description: "Correio Sedex servico postal operacional",
    debit: value,
  });
}

function l3Record(value = 250) {
  return trialBalanceRecord({
    accountCode: "4.2.1.01.99.991",
    description: "Folha administrativa bonificacao nova",
    debit: value,
  });
}

function l4Record(value = 300) {
  return trialBalanceRecord({
    accountCode: "4.2.1.07.01.991",
    description: "Despesa de multa indenizacao extraordinaria",
    debit: value,
  });
}

function conditionalRecord(value = 700) {
  return trialBalanceRecord({
    accountCode: "4.2.1.77.001",
    description: "Ocorrencia condicional documentada",
    debit: value,
  });
}

function snapshot(period: WorkflowTaxPeriod, records: readonly JsonObject[] = [knownRecord()]): SourceSnapshot {
  const totalDebit = records.reduce((sum, record) => sum + Number(record.debit ?? 0), 0);
  const totalCredit = records.reduce((sum, record) => sum + Number(record.credit ?? 0), 0);
  const draft = createSourceSnapshotDraft({
    companyId: COMPANY_ID,
    externalCompanyRef: "0007",
    taxPeriodId: period.id,
    taxPeriod: {
      fiscalYear: period.fiscalYear,
      periodCode: period.periodCode,
      startDate: period.startDate,
      endDate: period.endDate,
    },
    source: "TOTVS_BALANCETE",
    sourceType: "TRIAL_BALANCE",
    provider: "TOTVS_RM",
    adapterVersion: 1,
    contentSchemaVersion: 1,
    extractedAt: CREATED_AT,
    parameters: {
      startDate: period.startDate,
      endDate: period.endDate,
      includeClosingEntries: false,
    },
    recordCount: records.length,
    records,
    totalDebit,
    totalCredit,
    balances: { byAccount: records.length },
    snapshotVersion: period.version,
  });
  return {
    id: `snapshot-${period.id}`,
    createdAt: CREATED_AT,
    ...draft,
  };
}

function baseMatrix(): FiscalMatrixContext {
  const chart: AccountingChart = {
    id: ACCOUNTING_CHART_ID,
    code: "RAIZ-2026",
    name: "Plano Raiz 2026",
    description: "Plano sintetico para testes fiscais",
    active: true,
    version: 1,
    createdAt: CREATED_AT,
  };
  const companyChart: CompanyAccountingChart = {
    id: COMPANY_CHART_ID,
    companyId: COMPANY_ID,
    accountingChartId: ACCOUNTING_CHART_ID,
    fiscalYear: 2026,
    validFrom: "2026-01-01",
    validTo: null,
    version: 1,
    active: true,
    createdAt: CREATED_AT,
  };
  const fiscalNature: FiscalNature = {
    id: "nature-known-services",
    code: "KNOWN_SERVICES",
    name: "Servicos conhecidos",
    description: "Natureza fiscal sem ajuste",
    active: true,
    createdAt: CREATED_AT,
  };
  const mapping: AccountFiscalMapping = {
    id: "mapping-known-services",
    accountingChartId: ACCOUNTING_CHART_ID,
    accountCode: "4.2.1.02.01.001",
    reducedCode: null,
    fiscalNatureId: fiscalNature.id,
    validFrom: "2026-01-01",
    validTo: null,
    version: 1,
    active: true,
    createdAt: CREATED_AT,
  };
  const rule: FiscalRule = {
    id: "rule-known-services",
    ruleCode: "KNOWN_SERVICES_NO_ADJUSTMENT",
    fiscalNatureId: fiscalNature.id,
    irpjTreatment: "NO_ADJUSTMENT",
    csllTreatment: "NO_ADJUSTMENT",
    executionMethod: "FULL_ACCOUNT",
    automationLevel: "AUTOMATIC",
    criteria: { amountBasis: "NET_DEBIT_MOVEMENT" },
    validFrom: "2026-01-01",
    validTo: null,
    version: 1,
    status: "ACTIVE",
    createdAt: CREATED_AT,
  };
  return {
    accountingCharts: [chart],
    companyAccountingCharts: [companyChart],
    mappings: [mapping],
    fiscalNatures: [fiscalNature],
    fiscalRules: [rule],
  };
}

function matrixWithConditional(): FiscalMatrixContext {
  const matrix = baseMatrix();
  const fiscalNature: FiscalNature = {
    id: "nature-conditional-occurrence",
    code: "CONDITIONAL_OCCURRENCE",
    name: "Ocorrencia condicional",
    description: "Conta ja classificada como condicional",
    active: true,
    createdAt: CREATED_AT,
  };
  const mapping: AccountFiscalMapping = {
    id: "mapping-conditional-occurrence",
    accountingChartId: ACCOUNTING_CHART_ID,
    accountCode: "4.2.1.77.001",
    reducedCode: null,
    fiscalNatureId: fiscalNature.id,
    validFrom: "2026-01-01",
    validTo: null,
    version: 3,
    active: true,
    createdAt: CREATED_AT,
  };
  const rule: FiscalRule = {
    id: "rule-conditional-occurrence",
    ruleCode: "CONDITIONAL_OCCURRENCE_DECISION",
    fiscalNatureId: fiscalNature.id,
    irpjTreatment: "CONDITIONAL",
    csllTreatment: "CONDITIONAL",
    executionMethod: "MANUAL_EXCEPTION",
    automationLevel: "MANUAL",
    criteria: { pendingItemType: "CONDITIONAL_TAX_DECISION" },
    validFrom: "2026-01-01",
    validTo: null,
    version: 4,
    status: "ACTIVE",
    createdAt: CREATED_AT,
  };
  return {
    ...matrix,
    mappings: [...matrix.mappings, mapping],
    fiscalNatures: [...matrix.fiscalNatures, fiscalNature],
    fiscalRules: [...matrix.fiscalRules, rule],
  };
}

function runPreview(options: PreviewOptions = {}) {
  const period = options.period ?? monthlyPeriod(1);
  const matrix = options.matrix ?? baseMatrix();
  const records = options.records ?? [knownRecord()];
  const sourceSnapshot = snapshot(period, records);
  const accountingByTax = options.accountingResultYtdByTax;
  const accountingResultYtdByTax = accountingByTax
    ? {
        IRPJ: {
          value: money(accountingByTax.IRPJ ?? options.accountingResultYtd ?? 120_000),
          source: { sourceSnapshotId: sourceSnapshot.id, sourceSnapshotHash: sourceSnapshot.hash, tax: "IRPJ" },
        },
        CSLL: {
          value: money(accountingByTax.CSLL ?? options.accountingResultYtd ?? 120_000),
          source: { sourceSnapshotId: sourceSnapshot.id, sourceSnapshotHash: sourceSnapshot.hash, tax: "CSLL" },
        },
      }
    : undefined;
  return previewTaxPeriod({
    companyId: COMPANY_ID,
    fiscalYearProfile: annualProfile({ fiscalYear: period.fiscalYear }),
    taxPeriod: period,
    sourceSnapshot,
    matrix,
    accountingResultYtd: {
      value: options.accountingResultYtd ?? 120_000,
      source: { sourceSnapshotId: sourceSnapshot.id, sourceSnapshotHash: sourceSnapshot.hash },
    },
    accountingResultYtdByTax,
    taxCredits: options.taxCredits,
    priorCalculations: options.priorCalculations,
    existingPendingItems: options.existingPendingItems,
    existingTaxAdjustments: options.existingTaxAdjustments,
    matrixVersion: MATRIX_VERSION,
    createdAt: CREATED_AT,
  });
}

function closeInput(result: ReturnType<typeof runPreview>, overrides: Partial<Parameters<typeof closeTaxPeriod>[0]> = {}) {
  return {
    companyId: COMPANY_ID,
    taxPeriod: result.taxPeriod,
    sourceSnapshot: result.sourceSnapshot,
    taxCalculation: result.taxCalculation,
    taxAdjustments: result.taxAdjustments,
    pendingItems: result.pendingItems,
    companyCode: "0007",
    companyName: "Raiz Teste",
    userId: USER_ID,
    userEmail: USER_EMAIL,
    timestamp: CREATED_AT,
    ...overrides,
  } satisfies Parameters<typeof closeTaxPeriod>[0];
}

function assertIssue(result: ReturnType<typeof closeTaxPeriod>, code: string) {
  assert.ok(result.issues.some((issue) => issue.code === code), `expected close issue ${code}`);
}

function closeSuccessfulMonth(month = 1, overrides: PreviewOptions = {}) {
  const preview = runPreview({ period: monthlyPeriod(month), ...overrides });
  const closeResult = closeTaxPeriod(closeInput(preview));
  assert.equal(closeResult.closed, true);
  assert.ok(closeResult.taxCalculation);
  return { preview, closeResult };
}

function withCreditSource(calculation: TaxCalculation, source: JsonObject): TaxCalculation {
  const creditUsages = calculation.creditUsages.map((usage) => ({ ...usage, source }));
  return {
    ...calculation,
    creditUsages,
    irpj: { ...calculation.irpj, creditUsages: creditUsages.filter((usage) => usage.tax === "IRPJ") },
    csll: { ...calculation.csll, creditUsages: creditUsages.filter((usage) => usage.tax === "CSLL") },
  };
}

test("preview sem pendencias calcula a competencia mensal conhecida", () => {
  const result = runPreview();

  assert.equal(result.taxPeriod.status, "CALCULATED");
  assert.deepEqual(result.pendingItems, []);
  assert.ok(result.taxCalculation);
  assert.equal(result.taxCalculation.status, "CALCULATED");
  assert.equal(result.taxCalculation.accountingResultSource.sourceSnapshotId, result.sourceSnapshot.id);
});


test("preview propaga resultado contábil distinto por IRPJ e CSLL", () => {
  const result = runPreview({
    accountingResultYtd: 100_000,
    accountingResultYtdByTax: { IRPJ: 100_000, CSLL: 140_000 },
  });

  assert.ok(result.taxCalculation);
  assert.equal(result.taxCalculation.irpj.accountingResultYtd, "100000.00");
  assert.equal(result.taxCalculation.csll.accountingResultYtd, "140000.00");
  assert.equal(result.taxCalculation.irpj.baseBeforeCompensation, "100000.00");
  assert.equal(result.taxCalculation.csll.baseBeforeCompensation, "140000.00");
});
test("preview detecta conta nova L3 como pendencia bloqueante", () => {
  const result = runPreview({ records: [knownRecord(), l3Record()] });

  assert.equal(result.taxPeriod.status, "CALCULATED_WITH_PENDING_ITEMS");
  assert.ok(result.pendingItems.some((item) => item.type === "NEW_ACCOUNT_UNMAPPED" && item.blocking));
  assert.ok(result.autoOnboardingDecisions.some((decision) => decision.level === "L3_SUGGESTED"));
});

test("preview trata L2 aprovado como nao bloqueante e auto-commit controlado", () => {
  const result = runPreview({ records: [knownRecord(), postalRecord()] });
  const closeResult = closeTaxPeriod(closeInput(result));

  assert.ok(result.pendingItems.some((item) => item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED" && !isBlockingPendingItem(item)));
  assert.ok(result.autoOnboardingDecisions.some((decision) => decision.level === "L2_RULE_BASED_SAFE" && decision.autoCommit));
  assert.equal(result.taxPeriod.status, "CALCULATED_WITH_PENDING_ITEMS");
  assert.equal(closeResult.closed, false);
  assertIssue(closeResult, "AUTO_CLASSIFICATION_CONFIRMATION_REQUIRED");
});

test("confirmacao humana de L2 registra auditoria e libera o gate de fechamento", () => {
  const result = runPreview({ records: [knownRecord(), postalRecord()] });
  const pending = result.pendingItems.find((item) => item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED");
  assert.ok(pending);

  const confirmation = confirmAutomaticNewAccountClassification({
    companyId: COMPANY_ID,
    taxPeriod: result.taxPeriod,
    sourceSnapshot: result.sourceSnapshot,
    pendingItem: pending,
    matrixVersionBefore: 53,
    userId: USER_ID,
    userEmail: USER_EMAIL,
    timestamp: CREATED_AT,
  });
  const closeResult = closeTaxPeriod(closeInput(result, { pendingItems: [confirmation.resolvedPendingItem] }));

  assert.equal(confirmation.resolvedPendingItem.status, "RESOLVED");
  assert.equal(confirmation.resolvedPendingItem.resolvedBy, USER_ID);
  assert.equal(confirmation.decision.userId, USER_ID);
  assert.equal(confirmation.decision.matrixVersionBefore, 53);
  assert.equal(confirmation.decision.matrixVersionAfter, 53);
  assert.equal(confirmation.decision.afterState.confirmationStatus, "CONFIRMED");
  assert.equal(closeResult.closed, true);
});

test("correcao de L2 preserva classificacao automatica original e exige justificativa", () => {
  const result = runPreview({ records: [knownRecord(), postalRecord()] });
  const pending = result.pendingItems.find((item) => item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED");
  assert.ok(pending);
  const expectedAccountCode = String((pending.originData as Record<string, unknown>).accountCode);

  assert.throws(
    () =>
      correctAutomaticNewAccountClassification({
        companyId: COMPANY_ID,
        taxPeriod: result.taxPeriod,
        sourceSnapshot: result.sourceSnapshot,
        pendingItem: pending,
        accountingChartId: ACCOUNTING_CHART_ID,
        accountCode: expectedAccountCode,
        fiscalNatureCode: "POSTAGEM_CORRIGIDA",
        fiscalNatureName: "Postagem corrigida",
        fiscalRuleCode: "POSTAGEM_CORRIGIDA_RULE",
        irpjTreatment: "ADDITION",
        csllTreatment: "NO_ADJUSTMENT",
        matrixVersionBefore: 53,
        justification: "curta",
        userId: USER_ID,
      }),
    /Justificativa/,
  );

  const correction = correctAutomaticNewAccountClassification({
    companyId: COMPANY_ID,
    taxPeriod: result.taxPeriod,
    sourceSnapshot: result.sourceSnapshot,
    pendingItem: pending,
    accountingChartId: ACCOUNTING_CHART_ID,
    accountCode: expectedAccountCode,
    fiscalNatureCode: "POSTAGEM_CORRIGIDA",
    fiscalNatureName: "Postagem corrigida",
    fiscalRuleCode: "POSTAGEM_CORRIGIDA_RULE",
    irpjTreatment: "ADDITION",
    csllTreatment: "NO_ADJUSTMENT",
    matrixVersionBefore: 53,
    justification: "Classificação automática corrigida em homologação.",
    userId: USER_ID,
    userEmail: USER_EMAIL,
    timestamp: CREATED_AT,
  });

  const originalAutomatic = correction.decision.beforeState.originalAutomaticClassification as { readonly accountCode: string };
  const correctedClassification = correction.decision.afterState.correctedClassification as { readonly irpjTreatment: string };

  assert.equal(correction.resolvedPendingItem.status, "RESOLVED");
  assert.equal(originalAutomatic.accountCode, expectedAccountCode);
  assert.equal(correctedClassification.irpjTreatment, "ADDITION");
  assert.equal(correction.generatedMapping.version, 54);
  assert.equal(correction.reprocessRequired, true);
});

test("pendencia L4 aberta bloqueia fechamento", () => {
  const result = runPreview({ records: [knownRecord(), l4Record()] });
  const closeResult = closeTaxPeriod(closeInput(result));

  assert.equal(closeResult.closed, false);
  assertIssue(closeResult, "BLOCKING_PENDING_ITEMS");
  assert.ok(result.autoOnboardingDecisions.some((decision) => decision.level === "L4_REVIEW_REQUIRED"));
});

test("conta condicional ja classificada bloqueia enquanto nao houver decisao", () => {
  const result = runPreview({ matrix: matrixWithConditional(), records: [knownRecord(), conditionalRecord()] });
  const closeResult = closeTaxPeriod(closeInput(result));

  assert.equal(closeResult.closed, false);
  assert.ok(result.pendingItems.some((item) => item.type === "CONDITIONAL_TAX_DECISION" && item.blocking));
  assertIssue(closeResult, "BLOCKING_PENDING_ITEMS");
});

test("classificacao humana de conta nova gera nova versao e reprocessamento resolve pendencia", () => {
  const initial = runPreview({ records: [knownRecord(), l3Record()] });
  const pending = initial.pendingItems.find((item) => item.type === "NEW_ACCOUNT_UNMAPPED");
  assert.ok(pending);
  const base = baseMatrix();

  const classification = classifyNewAccount({
    companyId: COMPANY_ID,
    taxPeriod: initial.taxPeriod,
    sourceSnapshot: initial.sourceSnapshot,
    pendingItem: pending,
    accountingChartId: ACCOUNTING_CHART_ID,
    accountCode: "4.2.1.01.99.991",
    fiscalNatureCode: "HUMAN_PAYROLL_BONUS",
    fiscalNatureName: "Bonus de folha classificado",
    fiscalRuleCode: "HUMAN_PAYROLL_BONUS_ADD",
    irpjTreatment: "ADDITION",
    csllTreatment: "NO_ADJUSTMENT",
    matrixVersionBefore: 53,
    justification: "Classificacao fiscal validada pela equipe fiscal.",
    userId: USER_ID,
    userEmail: USER_EMAIL,
    timestamp: CREATED_AT,
  });
  const reprocessed = reprocessTaxPeriod({
    companyId: COMPANY_ID,
    fiscalYearProfile: annualProfile(),
    taxPeriod: { ...initial.taxPeriod, status: "DRAFT" },
    sourceSnapshot: initial.sourceSnapshot,
    matrix: {
      ...base,
      mappings: [...base.mappings, classification.generatedMapping],
      fiscalNatures: [...base.fiscalNatures, classification.generatedFiscalNature],
      fiscalRules: [...base.fiscalRules, classification.generatedFiscalRule],
    },
    accountingResultYtd: { value: 120_000, source: { sourceSnapshotId: initial.sourceSnapshot.id } },
    existingPendingItems: [classification.resolvedPendingItem],
    matrixVersion: "v54",
    createdAt: CREATED_AT,
  });

  assert.equal(classification.generatedMapping.version, 54);
  assert.equal(classification.resolvedPendingItem.status, "RESOLVED");
  assert.equal(classification.decision.matrixVersionBefore, 53);
  assert.equal(classification.decision.matrixVersionAfter, 54);
  assert.equal(classification.decision.userId, USER_ID);
  assert.equal(classification.decision.justification.includes("validada"), true);
  assert.equal(classification.decision.snapshotContext.sourceSnapshotHash, initial.sourceSnapshot.hash);
  assert.equal(reprocessed.pendingItems.filter((item) => item.status === "OPEN").length, 0);
  assert.ok(reprocessed.taxAdjustments.some((adjustment) => adjustment.tax === "IRPJ" && adjustment.adjustmentType === "ADDITION"));
});

test("decisao condicional exige justificativa descritiva", () => {
  const result = runPreview({ matrix: matrixWithConditional(), records: [conditionalRecord()] });
  const pending = result.pendingItems.find((item) => item.type === "CONDITIONAL_TAX_DECISION");
  assert.ok(pending);

  assert.throws(
    () =>
      resolveConditionalOccurrence({
        companyId: COMPANY_ID,
        taxPeriod: result.taxPeriod,
        sourceSnapshot: result.sourceSnapshot,
        pendingItem: pending,
        accountCode: "4.2.1.77.001",
        accountingChartId: ACCOUNTING_CHART_ID,
        companyAccountingChartId: COMPANY_CHART_ID,
        accountFiscalMappingId: "mapping-conditional-occurrence",
        accountFiscalMappingVersion: 3,
        fiscalNatureId: "nature-conditional-occurrence",
        fiscalRuleId: "rule-conditional-occurrence",
        fiscalRuleVersion: 4,
        irpjDecision: "ADDITION",
        csllDecision: "NO_ADJUSTMENT",
        amount: 700,
        matrixVersionBefore: 53,
        justification: "curta",
        userId: USER_ID,
      }),
    /Justificativa/,
  );
});

test("decisao condicional gera ajustes independentes para IRPJ e CSLL", () => {
  const result = runPreview({ matrix: matrixWithConditional(), records: [conditionalRecord()] });
  const pending = result.pendingItems.find((item) => item.type === "CONDITIONAL_TAX_DECISION");
  assert.ok(pending);

  const decision = resolveConditionalOccurrence({
    companyId: COMPANY_ID,
    taxPeriod: result.taxPeriod,
    sourceSnapshot: result.sourceSnapshot,
    pendingItem: pending,
    accountCode: "4.2.1.77.001",
    accountDescription: "Ocorrencia condicional documentada",
    accountingChartId: ACCOUNTING_CHART_ID,
    companyAccountingChartId: COMPANY_CHART_ID,
    accountFiscalMappingId: "mapping-conditional-occurrence",
    accountFiscalMappingVersion: 3,
    fiscalNatureId: "nature-conditional-occurrence",
    fiscalRuleId: "rule-conditional-occurrence",
    fiscalRuleVersion: 4,
    irpjDecision: "ADDITION",
    csllDecision: "NO_ADJUSTMENT",
    amount: 700,
    sourceContext: { documento: "parecer-periodo-2026-M05" },
    matrixVersionBefore: 53,
    justification: "Decisao fiscal do periodo documentada em parecer interno.",
    userId: USER_ID,
    userEmail: USER_EMAIL,
    timestamp: CREATED_AT,
  });

  assert.equal(decision.resolvedPendingItem.status, "RESOLVED");
  assert.deepEqual(decision.taxAdjustments.map((adjustment) => adjustment.tax), ["IRPJ"]);
  assert.equal(decision.taxAdjustments[0].adjustmentType, "ADDITION");
  assert.equal(decision.decision.matrixVersionBefore, 53);
  assert.equal(decision.decision.matrixVersionAfter, 53);
  assert.equal(decision.decision.snapshotContext.sourceSnapshotHash, result.sourceSnapshot.hash);
  assert.equal(decision.ruleExecutionResult.executionMetadata.humanDecisionId, decision.decision.id);
});

test("periodo revisado registra auditoria sem exigir etapa artificial para fechamento automatico", () => {
  const preview = runPreview();
  const reviewed = reviewTaxPeriod({
    taxPeriod: preview.taxPeriod,
    userId: USER_ID,
    userEmail: USER_EMAIL,
    justification: "Revisao mensal executada pela equipe fiscal.",
    timestamp: CREATED_AT,
  });
  const closed = closeTaxPeriod(closeInput(preview));

  assert.equal(reviewed.taxPeriod.status, "REVIEWED");
  assert.equal(reviewed.audit.userId, USER_ID);
  assert.equal(closed.closed, true);
  assert.equal(closed.taxPeriod.status, "CLOSED_CURRENT");
});

test("credito usado sem origem rastreavel bloqueia fechamento", () => {
  const credit: FiscalCreditAvailable = {
    id: "credit-irrf-sem-fonte",
    tax: "IRPJ",
    nature: "IRRF_SERVICOS",
    label: "IRRF sem fonte",
    availableAmount: 500,
    source: { documentId: "comprovante-irrf" },
  };
  const preview = runPreview({ accountingResultYtd: 100_000, taxCredits: [credit] });
  assert.ok(preview.taxCalculation);

  const brokenCalculation = withCreditSource(preview.taxCalculation, {});
  const closeResult = closeTaxPeriod(closeInput(preview, { taxCalculation: brokenCalculation }));

  assert.equal(closeResult.closed, false);
  assertIssue(closeResult, "CREDIT_WITHOUT_SOURCE");
});

test("fechamento mensal ignora pagamentos DARF nesta fase", () => {
  const preview = runPreview();
  const closeResult = closeTaxPeriod(closeInput(preview, { payments: [{ type: "DARF", status: "NAO_VALIDADO" }] }));

  assert.equal(closeResult.closed, true);
  assert.equal(closeResult.scheduleCompletion?.modulo, "contabil:irpj-csll:0007");
});

test("periodo CLOSED_CURRENT e imutavel para reprocessamento", () => {
  const { closeResult } = closeSuccessfulMonth();

  assert.throws(
    () =>
      reprocessTaxPeriod({
        companyId: COMPANY_ID,
        fiscalYearProfile: annualProfile(),
        taxPeriod: closeResult.taxPeriod,
        sourceSnapshot: snapshot(closeResult.taxPeriod),
        matrix: baseMatrix(),
        accountingResultYtd: 120_000,
        matrixVersion: MATRIX_VERSION,
      }),
    /imut/,
  );
});

test("abrir nova versao cria V02 em DRAFT sem alterar V01 fechada", () => {
  const { closeResult } = closeSuccessfulMonth(1);
  const opened = openNewTaxPeriodVersion({ currentPeriod: closeResult.taxPeriod, timestamp: CREATED_AT });

  assert.equal(opened.currentPeriod.status, "CLOSED_CURRENT");
  assert.equal(opened.newPeriod.version, 2);
  assert.equal(opened.newPeriod.status, "DRAFT");
  assert.equal(opened.newPeriod.periodCode, closeResult.taxPeriod.periodCode);
});

test("fechar V02 supersede V01 e mantem apenas V02 como CLOSED_CURRENT", () => {
  const { closeResult: v1Close } = closeSuccessfulMonth(1);
  const opened = openNewTaxPeriodVersion({ currentPeriod: v1Close.taxPeriod, timestamp: CREATED_AT });
  const v2Preview = runPreview({ period: opened.newPeriod, accountingResultYtd: 121_000 });
  const v2Close = closeTaxPeriod(closeInput(v2Preview, { periodVersions: [v1Close.taxPeriod, v2Preview.taxPeriod] }));

  assert.equal(v2Close.closed, true);
  assert.equal(v2Close.taxPeriod.version, 2);
  assert.equal(v2Close.taxPeriod.status, "CLOSED_CURRENT");
  assert.equal(v2Close.supersededPeriods[0].id, v1Close.taxPeriod.id);
  assert.equal(v2Close.supersededPeriods[0].status, "CLOSED_SUPERSEDED");
});

test("gate impede duas versoes CLOSED_CURRENT para o mesmo periodo", () => {
  const v2 = monthlyPeriod(5, { id: "period-2026-m05-v2", version: 2 });
  const preview = runPreview({ period: v2 });
  const conflictingCurrentA = monthlyPeriod(5, { id: "period-2026-m05-v1a", status: "CLOSED_CURRENT", version: 1 });
  const conflictingCurrentB = monthlyPeriod(5, { id: "period-2026-m05-v1b", status: "CLOSED_CURRENT", version: 1 });
  const closeResult = closeTaxPeriod(closeInput(preview, { periodVersions: [conflictingCurrentA, conflictingCurrentB, preview.taxPeriod] }));

  assert.equal(closeResult.closed, false);
  assertIssue(closeResult, "MULTIPLE_CLOSED_CURRENT");
});

test("fechamento retroativo marca periodos mensais posteriores como upstream_stale", () => {
  const { closeResult: janClose } = closeSuccessfulMonth(1);
  const febV1 = monthlyPeriod(2, { status: "CLOSED_CURRENT", version: 1 });
  const febV2 = monthlyPeriod(2, { id: "period-2026-m02-v2", version: 2 });
  const marClosed = monthlyPeriod(3, { status: "CLOSED_CURRENT", version: 1 });
  const febPreview = runPreview({ period: febV2, accountingResultYtd: 80_000, priorCalculations: [janClose.taxCalculation!] });
  const closeResult = closeTaxPeriod(closeInput(febPreview, { periodVersions: [febV1, febPreview.taxPeriod, marClosed] }));

  assert.equal(closeResult.closed, true);
  assert.deepEqual(closeResult.stalePeriods.map((period) => period.id), [marClosed.id]);
  assert.equal(closeResult.stalePeriods[0].upstreamStale, true);
});

test("stale retroativo nao recalcula nem reabre periodo posterior automaticamente", () => {
  const { closeResult: janClose } = closeSuccessfulMonth(1);
  const febV1 = monthlyPeriod(2, { status: "CLOSED_CURRENT", version: 1 });
  const febV2 = monthlyPeriod(2, { id: "period-2026-m02-v2", version: 2 });
  const aprClosed = monthlyPeriod(4, { status: "CLOSED_CURRENT", version: 1 });
  const febPreview = runPreview({ period: febV2, accountingResultYtd: 80_000, priorCalculations: [janClose.taxCalculation!] });
  const closeResult = closeTaxPeriod(closeInput(febPreview, { periodVersions: [febV1, febPreview.taxPeriod, aprClosed] }));

  assert.equal(closeResult.closed, true);
  assert.equal(closeResult.transaction.taxCalculation?.taxPeriodId, febV2.id);
  assert.equal(closeResult.stalePeriods[0].status, "CLOSED_CURRENT");
  assert.equal(closeResult.stalePeriods[0].upstreamStale, true);
});

test("cronograma so e concluido quando fechamento e bem-sucedido", () => {
  const successfulPreview = runPreview();
  const successfulClose = closeTaxPeriod(closeInput(successfulPreview));
  const failingPreview = runPreview({ records: [knownRecord(), l3Record()] });
  const failingClose = closeTaxPeriod(closeInput(failingPreview));

  assert.equal(successfulClose.closed, true);
  assert.equal(successfulClose.scheduleCompletion?.modulo, "contabil:irpj-csll:0007");
  assert.equal(successfulClose.scheduleCompletion?.status, "concluido");
  assert.equal(failingClose.closed, false);
  assert.equal(failingClose.scheduleCompletion, null);
  assert.equal(failingClose.transaction.committed, false);
});

test("reprocessamento e deterministico e nao duplica ajustes", () => {
  const initial = runPreview({ records: [knownRecord(), l3Record()] });
  const pending = initial.pendingItems.find((item) => item.type === "NEW_ACCOUNT_UNMAPPED");
  assert.ok(pending);
  const classification = classifyNewAccount({
    companyId: COMPANY_ID,
    taxPeriod: initial.taxPeriod,
    sourceSnapshot: initial.sourceSnapshot,
    pendingItem: pending,
    accountingChartId: ACCOUNTING_CHART_ID,
    accountCode: "4.2.1.01.99.991",
    fiscalNatureCode: "HUMAN_PAYROLL_BONUS",
    fiscalNatureName: "Bonus de folha classificado",
    fiscalRuleCode: "HUMAN_PAYROLL_BONUS_ADD",
    irpjTreatment: "ADDITION",
    csllTreatment: "ADDITION",
    matrixVersionBefore: 53,
    justification: "Classificacao fiscal validada pela equipe fiscal.",
    userId: USER_ID,
    timestamp: CREATED_AT,
  });
  const base = baseMatrix();
  const matrix = {
    ...base,
    mappings: [...base.mappings, classification.generatedMapping],
    fiscalNatures: [...base.fiscalNatures, classification.generatedFiscalNature],
    fiscalRules: [...base.fiscalRules, classification.generatedFiscalRule],
  };
  const first = reprocessTaxPeriod({
    companyId: COMPANY_ID,
    fiscalYearProfile: annualProfile(),
    taxPeriod: { ...initial.taxPeriod, status: "DRAFT" },
    sourceSnapshot: initial.sourceSnapshot,
    matrix,
    accountingResultYtd: 120_000,
    existingPendingItems: [classification.resolvedPendingItem],
    matrixVersion: "v54",
    createdAt: CREATED_AT,
  });
  const second = reprocessTaxPeriod({
    companyId: COMPANY_ID,
    fiscalYearProfile: annualProfile(),
    taxPeriod: { ...initial.taxPeriod, status: "DRAFT" },
    sourceSnapshot: initial.sourceSnapshot,
    matrix,
    accountingResultYtd: 120_000,
    existingPendingItems: [classification.resolvedPendingItem],
    existingTaxAdjustments: first.taxAdjustments,
    matrixVersion: "v54",
    createdAt: CREATED_AT,
  });

  assert.equal(second.taxCalculation?.logicalKey, first.taxCalculation?.logicalKey);
  assert.deepEqual(second.taxAdjustments.map((adjustment) => adjustment.id).sort(), first.taxAdjustments.map((adjustment) => adjustment.id).sort());
});

test("fechamento bloqueado nao persiste atualizacoes transacionais", () => {
  const result = runPreview({ records: [knownRecord(), l3Record()] });
  const closeResult = closeTaxPeriod(closeInput(result));

  assert.equal(closeResult.closed, false);
  assert.deepEqual(closeResult.transaction.periodUpdates, []);
  assert.equal(closeResult.transaction.manifest, null);
  assert.equal(closeResult.transaction.scheduleCompletion, null);
});

test("manifesto de fechamento congela snapshot, calculo, matriz, ajustes e decisoes", () => {
  const preview = runPreview();
  const closeResult = closeTaxPeriod(closeInput(preview));

  assert.ok(closeResult.manifest);
  assert.equal(closeResult.manifest.sourceSnapshotId, preview.sourceSnapshot.id);
  assert.equal(closeResult.manifest.sourceSnapshotHash, preview.sourceSnapshot.hash);
  assert.equal(closeResult.manifest.taxCalculationId, preview.taxCalculation?.id);
  assert.equal(closeResult.manifest.matrixVersion, MATRIX_VERSION);
  assert.deepEqual(closeResult.manifest.taxAdjustmentIds, preview.taxCalculation?.taxAdjustmentIds);
  assert.deepEqual(closeResult.manifest.ruleVersions, preview.taxCalculation?.ruleVersions);
  assert.equal(closeResult.taxPeriod.closedManifestId, closeResult.manifest.id);
});

test("auditoria de decisoes humanas preserva before after usuario justificativa e contexto", () => {
  const result = runPreview({ matrix: matrixWithConditional(), records: [conditionalRecord()] });
  const pending = result.pendingItems.find((item) => item.type === "CONDITIONAL_TAX_DECISION");
  assert.ok(pending);
  const decision = resolveConditionalOccurrence({
    companyId: COMPANY_ID,
    taxPeriod: result.taxPeriod,
    sourceSnapshot: result.sourceSnapshot,
    pendingItem: pending,
    accountCode: "4.2.1.77.001",
    accountingChartId: ACCOUNTING_CHART_ID,
    companyAccountingChartId: COMPANY_CHART_ID,
    accountFiscalMappingId: "mapping-conditional-occurrence",
    accountFiscalMappingVersion: 3,
    fiscalNatureId: "nature-conditional-occurrence",
    fiscalRuleId: "rule-conditional-occurrence",
    fiscalRuleVersion: 4,
    irpjDecision: "EXCLUSION",
    csllDecision: "ADDITION",
    amount: 500,
    sourceContext: { documento: "parecer-auditavel" },
    matrixVersionBefore: 53,
    justification: "Decisao humana documentada para auditoria completa.",
    userId: USER_ID,
    userEmail: USER_EMAIL,
    timestamp: CREATED_AT,
  });

  assert.equal(decision.decision.userId, USER_ID);
  assert.equal(decision.decision.userEmail, USER_EMAIL);
  assert.equal(decision.decision.justification.includes("auditoria"), true);
  assert.equal(decision.decision.beforeState.pendingItemId, pending.id);
  assert.equal(decision.decision.afterState.irpjDecision, "EXCLUSION");
  assert.equal(decision.decision.afterState.csllDecision, "ADDITION");
  assert.equal(decision.decision.snapshotContext.sourceSnapshotId, result.sourceSnapshot.id);
  assert.deepEqual([...decision.decision.taxAdjustmentIds].sort(), decision.taxAdjustments.map((adjustment) => adjustment.id).sort());
});

test("preview mensal consome SOURCE_SNAPSHOT persistido com intervalo acumulado", () => {
  const period = monthlyPeriod(5);
  const result = runPreview({ period, records: [knownRecord()] });

  assert.equal(result.sourceSnapshot.taxPeriod.startDate, "2026-01-01");
  assert.equal(result.sourceSnapshot.taxPeriod.endDate, "2026-05-31");
  assert.equal(result.sourceSnapshot.parameters.startDate, "2026-01-01");
  assert.equal(result.sourceSnapshot.parameters.endDate, "2026-05-31");
  assert.equal(result.sourceSnapshot.parameters.includeClosingEntries, false);
  assert.equal(result.taxCalculation?.sourceSnapshotId, result.sourceSnapshot.id);
  assert.equal(result.taxCalculation?.sourceSnapshotHash, result.sourceSnapshot.hash);
});

test("periodos fiscais preservam anual acumulado, trimestral nao acumulado e ajuste anual", () => {
  const annual = buildTaxPeriodsForProfile(annualProfile());
  const leapAnnual = buildTaxPeriodsForProfile(annualProfile({ fiscalYear: 2028 }));
  const quarterly = buildTaxPeriodsForProfile(annualProfile({ periodicity: "QUARTERLY" }));
  const find = (periods: ReturnType<typeof buildTaxPeriodsForProfile>, code: string) => {
    const period = periods.find((item) => item.periodCode === code);
    assert.ok(period, `period ${code} exists`);
    return { start: period.startDate, end: period.endDate };
  };

  assert.deepEqual(find(annual, "2026-M01"), { start: "2026-01-01", end: "2026-01-31" });
  assert.deepEqual(find(annual, "2026-M02"), { start: "2026-01-01", end: "2026-02-28" });
  assert.deepEqual(find(annual, "2026-M05"), { start: "2026-01-01", end: "2026-05-31" });
  assert.deepEqual(find(annual, "2026-M12"), { start: "2026-01-01", end: "2026-12-31" });
  assert.deepEqual(find(leapAnnual, "2028-M02"), { start: "2028-01-01", end: "2028-02-29" });
  assert.deepEqual(find(quarterly, "2026-T01"), { start: "2026-01-01", end: "2026-03-31" });
  assert.deepEqual(find(quarterly, "2026-T02"), { start: "2026-04-01", end: "2026-06-30" });
  assert.deepEqual(find(quarterly, "2026-T03"), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(find(quarterly, "2026-T04"), { start: "2026-10-01", end: "2026-12-31" });
  assert.deepEqual(find(annual, "2026-ANNUAL"), { start: "2026-01-01", end: "2026-12-31" });
});
