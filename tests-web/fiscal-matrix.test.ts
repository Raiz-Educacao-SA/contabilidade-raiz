import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import type {
  AccountFiscalMapping,
  AccountingChart,
  CompanyAccountMappingOverride,
  CompanyAccountingChart,
  CompanyRuleOverride,
  FiscalNature,
  FiscalRule,
  TaxAdjustment,
} from "../lib/fiscal/fiscal-matrix.ts";
import type { JsonObject, SourceSnapshot, TaxPeriod } from "../lib/fiscal/types.ts";

const moduleUrl = new URL("../lib/fiscal/fiscal-matrix.ts", import.meta.url);
const CREATED_AT = "2026-08-31T12:00:00.000Z";
const BRINDES_ACCOUNT = "4.2.1.02.03.11";

function period(overrides: Partial<TaxPeriod> = {}): TaxPeriod {
  return {
    id: "period-2024-m01",
    companyId: "company-a",
    fiscalYearProfileId: "profile-2024-a",
    fiscalYear: 2024,
    periodCode: "2024-M01",
    startDate: "2024-01-01",
    endDate: "2024-01-31",
    periodType: "MONTHLY_ESTIMATE",
    status: "DRAFT",
    version: 1,
    ...overrides,
  };
}

function chart(overrides: Partial<AccountingChart> = {}): AccountingChart {
  return {
    id: "chart-shared",
    code: "SHARED_EDU_CHART",
    name: "Shared education chart",
    description: "ERP-agnostic accounting chart used by fiscal tests",
    active: true,
    version: 1,
    ...overrides,
  };
}

function companyChart(overrides: Partial<CompanyAccountingChart> = {}): CompanyAccountingChart {
  return {
    id: "company-chart-a",
    companyId: "company-a",
    accountingChartId: "chart-shared",
    fiscalYear: null,
    validFrom: "2024-01-01",
    validTo: null,
    version: 1,
    active: true,
    ...overrides,
  };
}

function nature(overrides: Partial<FiscalNature> = {}): FiscalNature {
  return {
    id: "nature-brindes",
    code: "BRINDES",
    name: "Brindes",
    description: "Brindes e cortesias",
    active: true,
    ...overrides,
  };
}

function mapping(overrides: Partial<AccountFiscalMapping> = {}): AccountFiscalMapping {
  return {
    id: "mapping-brindes-shared",
    accountingChartId: "chart-shared",
    accountCode: BRINDES_ACCOUNT,
    reducedCode: null,
    fiscalNatureId: "nature-brindes",
    validFrom: "2024-01-01",
    validTo: null,
    version: 1,
    active: true,
    ...overrides,
  };
}

function mappingOverride(
  overrides: Partial<CompanyAccountMappingOverride> = {},
): CompanyAccountMappingOverride {
  return {
    id: "mapping-override-a",
    companyId: "company-a",
    accountingChartId: "chart-shared",
    accountCode: BRINDES_ACCOUNT,
    reducedCode: null,
    fiscalNatureId: "nature-brindes",
    validFrom: "2024-01-01",
    validTo: null,
    version: 1,
    active: true,
    ...overrides,
  };
}

function rule(overrides: Partial<FiscalRule> = {}): FiscalRule {
  return {
    id: "rule-brindes-full-account",
    ruleCode: "BRINDES_FULL_ACCOUNT",
    fiscalNatureId: "nature-brindes",
    irpjTreatment: "ADDITION",
    csllTreatment: "ADDITION",
    executionMethod: "FULL_ACCOUNT",
    automationLevel: "AUTOMATIC",
    criteria: { amountBasis: "NET_DEBIT_MOVEMENT" },
    validFrom: "2024-01-01",
    validTo: null,
    version: 1,
    status: "ACTIVE",
    ...overrides,
  };
}

function ruleOverride(overrides: Partial<CompanyRuleOverride> = {}): CompanyRuleOverride {
  return {
    id: "rule-override-a",
    companyId: "company-a",
    fiscalNatureId: "nature-brindes",
    irpjTreatment: null,
    csllTreatment: null,
    executionMethod: null,
    automationLevel: null,
    criteria: null,
    validFrom: "2024-01-01",
    validTo: null,
    version: 1,
    status: "ACTIVE",
    ...overrides,
  };
}

function snapshotRecord(overrides: Partial<Record<string, string | number | null>> = {}): JsonObject {
  return {
    accountCode: BRINDES_ACCOUNT,
    reducedCode: null,
    description: "Brindes e Cortesias",
    openingBalance: "0.00",
    debit: "28800.00",
    credit: "0.00",
    movement: "28800.00",
    closingBalance: "28800.00",
    ...overrides,
  };
}

function snapshot(
  taxPeriod: TaxPeriod,
  records: readonly JsonObject[] = [snapshotRecord()],
  overrides: Partial<SourceSnapshot> = {},
): SourceSnapshot {
  return {
    id: `snapshot-${taxPeriod.periodCode.toLowerCase()}`,
    companyId: taxPeriod.companyId,
    externalCompanyRef: `${taxPeriod.companyId}-ledger-ref`,
    taxPeriodId: taxPeriod.id,
    taxPeriod: {
      fiscalYear: taxPeriod.fiscalYear,
      periodCode: taxPeriod.periodCode,
      startDate: taxPeriod.startDate,
      endDate: taxPeriod.endDate,
    },
    source: "FAKE_LEDGER_TRIAL_BALANCE",
    sourceType: "TRIAL_BALANCE",
    provider: "FAKE_LEDGER",
    adapterVersion: 1,
    contentSchemaVersion: 1,
    extractedAt: CREATED_AT,
    parameters: {},
    recordCount: records.length,
    records,
    totalDebit: "28800.00",
    totalCredit: "0.00",
    balances: {},
    hash: "a".repeat(64),
    snapshotVersion: 1,
    ...overrides,
  };
}

function matrix() {
  return {
    accountingCharts: [chart()],
    companyAccountingCharts: [companyChart()],
    mappings: [mapping()],
    fiscalNatures: [nature()],
    fiscalRules: [rule()],
  };
}

function expectObject<T>(value: T | null | undefined): T {
  assert.notEqual(value, null);
  assert.notEqual(value, undefined);
  return value as T;
}

test("plano de contas compartilhado não duplica classificação por empresa", async () => {
  assert.equal(existsSync(moduleUrl), true, "Fiscal matrix module is missing");
  const { resolveFiscalRuleForAccount } = await import(moduleUrl.href);
  const sharedMapping = mapping();
  const charts = [chart()];
  const companyCharts = [
    companyChart({ id: "company-chart-a", companyId: "company-a" }),
    companyChart({ id: "company-chart-b", companyId: "company-b" }),
  ];

  const companyA = resolveFiscalRuleForAccount({
    companyId: "company-a",
    accountCode: BRINDES_ACCOUNT,
    taxPeriod: period({ companyId: "company-a" }),
    accountingCharts: charts,
    companyAccountingCharts: companyCharts,
    mappings: [sharedMapping],
    fiscalNatures: [nature()],
    fiscalRules: [rule()],
  });
  const companyB = resolveFiscalRuleForAccount({
    companyId: "company-b",
    accountCode: BRINDES_ACCOUNT,
    taxPeriod: period({ id: "period-2024-m01-b", companyId: "company-b" }),
    accountingCharts: charts,
    companyAccountingCharts: companyCharts,
    mappings: [sharedMapping],
    fiscalNatures: [nature()],
    fiscalRules: [rule()],
  });

  assert.equal(companyA?.mapping.id, "mapping-brindes-shared");
  assert.equal(companyB?.mapping.id, "mapping-brindes-shared");
  assert.equal(companyA?.fiscalNature.code, "BRINDES");
  assert.equal(companyB?.fiscalNature.code, "BRINDES");
});

test("outro plano usa outro código para a mesma natureza fiscal", async () => {
  const { resolveFiscalRuleForAccount } = await import(moduleUrl.href);
  const resolution = resolveFiscalRuleForAccount({
    companyId: "company-b",
    accountCode: "6578",
    taxPeriod: period({ id: "period-2024-m01-b", companyId: "company-b" }),
    accountingCharts: [chart(), chart({ id: "chart-alt", code: "ALT_GROUP_CHART" })],
    companyAccountingCharts: [
      companyChart({ id: "company-chart-b", companyId: "company-b", accountingChartId: "chart-alt" }),
    ],
    mappings: [
      mapping(),
      mapping({ id: "mapping-brindes-alt", accountingChartId: "chart-alt", accountCode: "6578" }),
    ],
    fiscalNatures: [nature()],
    fiscalRules: [rule()],
  });

  assert.equal(resolution?.accountingChart.id, "chart-alt");
  assert.equal(resolution?.mapping.accountCode, "6578");
  assert.equal(resolution?.fiscalNature.id, "nature-brindes");
});

test("company mapping override altera a natureza efetiva da conta", async () => {
  const { resolveFiscalRuleForAccount } = await import(moduleUrl.href);
  const defaultNature = nature({ id: "nature-default", code: "DEFAULT", name: "Default" });
  const resolution = resolveFiscalRuleForAccount({
    companyId: "company-a",
    accountCode: BRINDES_ACCOUNT,
    taxPeriod: period(),
    accountingCharts: [chart()],
    companyAccountingCharts: [companyChart()],
    mappings: [mapping({ fiscalNatureId: "nature-default" })],
    companyAccountMappingOverrides: [mappingOverride({ fiscalNatureId: "nature-brindes" })],
    fiscalNatures: [defaultNature, nature()],
    fiscalRules: [rule()],
  });

  assert.equal(resolution?.mapping.fiscalNatureId, "nature-default");
  assert.equal(resolution?.mappingOverride?.id, "mapping-override-a");
  assert.equal(resolution?.fiscalNature.id, "nature-brindes");
});

test("company rule override atua separadamente do override de mapeamento", async () => {
  const { resolveFiscalRuleForAccount } = await import(moduleUrl.href);
  const resolution = resolveFiscalRuleForAccount({
    companyId: "company-a",
    accountCode: BRINDES_ACCOUNT,
    taxPeriod: period(),
    ...matrix(),
    companyRuleOverrides: [
      ruleOverride({
        irpjTreatment: "NO_ADJUSTMENT",
        csllTreatment: "ADDITION",
        criteria: { amountBasis: "NET_DEBIT_MOVEMENT", policy: "company-specific" },
        version: 2,
      }),
    ],
  });

  assert.equal(resolution?.mappingOverride, null);
  assert.equal(resolution?.companyRuleOverride?.id, "rule-override-a");
  assert.equal(resolution?.companyRuleOverride?.version, 2);
  assert.equal(resolution?.fiscalNature.id, "nature-brindes");
  assert.equal(resolution?.effective.irpjTreatment, "NO_ADJUSTMENT");
  assert.equal(resolution?.effective.csllTreatment, "ADDITION");
  assert.deepEqual(resolution?.effective.criteria, {
    amountBasis: "NET_DEBIT_MOVEMENT",
    policy: "company-specific",
  });
});

test("golden janeiro 2024 Brindes gera IRPJ e CSLL de 28800.00", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const jan = period();
  const execution = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(jan, [snapshotRecord({ debit: "28800.00", credit: "0.00", movement: "28800.00" })]),
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    createdAt: CREATED_AT,
  });
  const result = expectObject(execution.ruleExecutionResult);

  assert.equal(result.status, "EXECUTED");
  assert.equal(result.amountBasis, "NET_DEBIT_MOVEMENT");
  assert.equal(result.calculatedValue, "28800.00");
  assert.deepEqual(
    execution.taxAdjustments.map((adjustment: TaxAdjustment) => [adjustment.tax, adjustment.adjustmentType, adjustment.value]),
    [
      ["IRPJ", "ADDITION", "28800.00"],
      ["CSLL", "ADDITION", "28800.00"],
    ],
  );
});

test("golden fevereiro 2024 Brindes usa acumulado de 43709.70", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const feb = period({
    id: "period-2024-m02",
    periodCode: "2024-M02",
    startDate: "2024-01-01",
    endDate: "2024-02-29",
  });
  const execution = executeFullAccount({
    companyId: "company-a",
    taxPeriod: feb,
    sourceSnapshot: snapshot(
      feb,
      [snapshotRecord({ debit: "43709.70", credit: "0.00", movement: "43709.70" })],
      { totalDebit: "43709.70", hash: "b".repeat(64) },
    ),
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    createdAt: CREATED_AT,
  });
  const result = expectObject(execution.ruleExecutionResult);

  assert.equal(result.calculatedValue, "43709.70");
  assert.equal(result.executionMetadata.matchedRecordCount, 1);
  assert.deepEqual(result.executionMetadata.taxPeriod, {
    fiscalYear: 2024,
    periodCode: "2024-M02",
    startDate: "2024-01-01",
    endDate: "2024-02-29",
  });
  assert.deepEqual(execution.taxAdjustments.map((adjustment: TaxAdjustment) => adjustment.value), [
    "43709.70",
    "43709.70",
  ]);
});

test("IRPJ e CSLL são ajustes independentes", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const jan = period();
  const execution = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(jan),
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    fiscalRules: [rule({ irpjTreatment: "ADDITION", csllTreatment: "NO_ADJUSTMENT" })],
    createdAt: CREATED_AT,
  });

  assert.deepEqual(execution.taxAdjustments.map((adjustment: TaxAdjustment) => adjustment.tax), ["IRPJ"]);
  assert.equal(execution.taxAdjustments[0].adjustmentType, "ADDITION");
  assert.equal(execution.taxAdjustments[0].value, "28800.00");
});

test("NO_ADJUSTMENT não cria TAX_ADJUSTMENT, mas registra execução", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const jan = period();
  const execution = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(jan),
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    fiscalRules: [rule({ irpjTreatment: "NO_ADJUSTMENT", csllTreatment: "NO_ADJUSTMENT" })],
    createdAt: CREATED_AT,
  });

  assert.equal(execution.ruleExecutionResult?.status, "EXECUTED");
  assert.equal(execution.ruleExecutionResult?.calculatedValue, "28800.00");
  assert.deepEqual(execution.taxAdjustments, []);
});

test("FULL_ACCOUNT usa movimento líquido debitado sem soma bruta nem abs", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const jan = period({ id: "period-credit-reversal" });
  const execution = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(
      jan,
      [snapshotRecord({ debit: "100000.00", credit: "20000.00", movement: "80000.00" })],
      { totalDebit: "100000.00", totalCredit: "20000.00", hash: "c".repeat(64) },
    ),
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    createdAt: CREATED_AT,
  });

  assert.equal(execution.ruleExecutionResult?.rawAccountingValue, "80000.00");
  assert.equal(execution.ruleExecutionResult?.calculatedValue, "80000.00");
  assert.deepEqual(execution.taxAdjustments.map((adjustment: TaxAdjustment) => adjustment.value), [
    "80000.00",
    "80000.00",
  ]);
});

test("movimento contrário não vira abs e fica pendente de revisão", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const jan = period({ id: "period-opposite-movement" });
  const execution = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(
      jan,
      [snapshotRecord({ debit: "10000.00", credit: "15000.00", movement: "-5000.00" })],
      { totalDebit: "10000.00", totalCredit: "15000.00", hash: "d".repeat(64) },
    ),
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    createdAt: CREATED_AT,
  });

  assert.equal(execution.ruleExecutionResult?.status, "REQUIRES_REVIEW");
  assert.equal(execution.ruleExecutionResult?.rawAccountingValue, "-5000.00");
  assert.equal(execution.ruleExecutionResult?.calculatedValue, "0.00");
  assert.equal(execution.ruleExecutionResult?.executionMetadata.statusReason, "OPPOSITE_MOVEMENT_DIRECTION");
  assert.deepEqual(execution.taxAdjustments, []);
});

test("idempotência usa ids e chaves lógicas determinísticas", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const jan = period({ id: "period-idempotency" });
  const sourceSnapshot = snapshot(jan, undefined, { hash: "e".repeat(64) });
  const first = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot,
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    createdAt: CREATED_AT,
  });
  const repeated = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot,
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    createdAt: CREATED_AT,
  });
  const filtered = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot,
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    existingTaxAdjustments: first.taxAdjustments,
    createdAt: CREATED_AT,
  });

  assert.equal(first.ruleExecutionResult?.id, repeated.ruleExecutionResult?.id);
  assert.equal(first.ruleExecutionResult?.logicalKey, repeated.ruleExecutionResult?.logicalKey);
  assert.deepEqual(
    first.taxAdjustments.map((adjustment: TaxAdjustment) => adjustment.id),
    repeated.taxAdjustments.map((adjustment: TaxAdjustment) => adjustment.id),
  );
  assert.deepEqual(filtered.taxAdjustments, []);
});

test("TAX_ADJUSTMENT preserva rastreabilidade até regra, natureza, mapping e snapshot", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const jan = period({ id: "period-traceability" });
  const execution = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(jan, undefined, { hash: "f".repeat(64) }),
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    createdAt: CREATED_AT,
  });
  const result = expectObject(execution.ruleExecutionResult);
  const adjustment = execution.taxAdjustments[0];

  assert.equal(adjustment.ruleExecutionResultId, result.id);
  assert.equal(adjustment.sourceSnapshotId, result.sourceSnapshotId);
  assert.equal(result.fiscalRuleId, "rule-brindes-full-account");
  assert.equal(result.fiscalRuleVersion, 1);
  assert.equal(result.fiscalNatureId, "nature-brindes");
  assert.equal(result.accountFiscalMappingId, "mapping-brindes-shared");
  assert.equal(result.accountFiscalMappingVersion, 1);
  assert.equal(result.executionMetadata.sourceSnapshotHash, "f".repeat(64));
  assert.equal(result.accountingChartId, "chart-shared");
});

test("executor FULL_ACCOUNT funciona com snapshot canônico fake", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const jan = period({ id: "period-fake-provider" });
  const execution = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(jan, undefined, {
      source: "ALT_LEDGER_TRIAL_BALANCE",
      provider: "ALT_LEDGER",
      externalCompanyRef: "alt-ledger-company-a",
      hash: "1".repeat(64),
    }),
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    createdAt: CREATED_AT,
  });

  assert.equal(execution.ruleExecutionResult?.status, "EXECUTED");
  assert.equal(execution.ruleExecutionResult?.executionMetadata.provider, "ALT_LEDGER");
  assert.equal(execution.taxAdjustments.length, 2);
});

test("métodos diferentes de FULL_ACCOUNT permanecem não executados", async () => {
  const { executeFullAccount } = await import(moduleUrl.href);
  const jan = period({ id: "period-not-full-account" });
  const execution = executeFullAccount({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(jan),
    accountCode: BRINDES_ACCOUNT,
    ...matrix(),
    fiscalRules: [rule({ executionMethod: "TRANSACTION_FILTER" })],
    createdAt: CREATED_AT,
  });

  assert.equal(execution.ruleExecutionResult?.status, "SKIPPED");
  assert.equal(
    execution.ruleExecutionResult?.executionMetadata.statusReason,
    "EXECUTION_METHOD_NOT_SUPPORTED_IN_FULL_ACCOUNT_EXECUTOR",
  );
  assert.deepEqual(execution.taxAdjustments, []);
});

test("conta movimentada sem mapeamento vigente gera pendência bloqueante", async () => {
  const { detectNewAccountPendingItems } = await import(moduleUrl.href);
  const jan = period({ id: "period-unmapped" });
  const items = detectNewAccountPendingItems({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(jan),
    accountingCharts: [chart()],
    companyAccountingCharts: [companyChart()],
    mappings: [],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].type, "NEW_ACCOUNT_UNMAPPED");
  assert.equal(items[0].status, "OPEN");
  assert.equal(items[0].blocking, true);
  assert.equal(items[0].originData.accountCode, BRINDES_ACCOUNT);
  assert.equal(items[0].originData.accountingChartId, "chart-shared");
});

test("conta mapeada não gera pendência e detector é idempotente", async () => {
  const { detectNewAccountPendingItems } = await import(moduleUrl.href);
  const jan = period({ id: "period-mapped-detector" });
  const sourceSnapshot = snapshot(jan, [snapshotRecord(), snapshotRecord()]);
  const mapped = detectNewAccountPendingItems({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot,
    accountingCharts: [chart()],
    companyAccountingCharts: [companyChart()],
    mappings: [mapping()],
  });
  const firstUnmapped = detectNewAccountPendingItems({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot,
    accountingCharts: [chart()],
    companyAccountingCharts: [companyChart()],
    mappings: [],
  });
  const secondUnmapped = detectNewAccountPendingItems({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot,
    accountingCharts: [chart()],
    companyAccountingCharts: [companyChart()],
    mappings: [],
    existingPendingItems: firstUnmapped,
  });

  assert.deepEqual(mapped, []);
  assert.equal(firstUnmapped.length, 1);
  assert.match(firstUnmapped[0].logicalKey, /^NEW_ACCOUNT_UNMAPPED:[a-f0-9]{64}$/);
  assert.deepEqual(secondUnmapped, []);
});

test("saldo inicial sem movimento efetivo não gera conta nova", async () => {
  const { detectNewAccountPendingItems, isMovedTrialBalanceRecord } = await import(moduleUrl.href);
  const jan = period({ id: "period-opening-only" });
  const record = snapshotRecord({
    openingBalance: "100.00",
    debit: "0.00",
    credit: "0.00",
    movement: "0.00",
    closingBalance: "100.00",
  });

  const items = detectNewAccountPendingItems({
    companyId: "company-a",
    taxPeriod: jan,
    sourceSnapshot: snapshot(jan, [record]),
    accountingCharts: [chart()],
    companyAccountingCharts: [companyChart()],
    mappings: [],
  });

  assert.equal(isMovedTrialBalanceRecord(record), false);
  assert.deepEqual(items, []);
});