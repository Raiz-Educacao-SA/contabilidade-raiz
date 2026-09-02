import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import type { TaxCalculation, TaxCalculationTaxMemory, TaxCalculationVersionStatus } from "../lib/fiscal/annual-monthly-engine.ts";
import type { PendingItem, RuleExecutionResult, TaxAdjustment } from "../lib/fiscal/fiscal-matrix.ts";
import {
  buildMonthlyTaxDossierModel,
  buildMonthlyTaxDossierPackage,
  buildTaxDossierRecord,
  compareMonthlyTaxDossierModels,
  formatDossierMoney,
  TaxDossierError,
  verifyExistingDossierIntegrity,
} from "../lib/fiscal/monthly-dossier.ts";
import type { TaxPeriodCloseManifest, TaxWorkflowHumanDecision, WorkflowTaxPeriod } from "../lib/fiscal/monthly-workflow.ts";
import { createSourceSnapshotDraft } from "../lib/fiscal/source-snapshot.ts";
import type { FiscalYearProfile, JsonObject, SourceSnapshot } from "../lib/fiscal/types.ts";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-09-01T12:00:00.000Z";

function money(value: number | string) {
  return typeof value === "number" ? value.toFixed(2) : Number(value).toFixed(2);
}

function sha256(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function monthEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function annualProfile(): FiscalYearProfile {
  return {
    id: PROFILE_ID,
    companyId: COMPANY_ID,
    fiscalYear: 2026,
    taxRegime: "REAL_PROFIT",
    periodicity: "ANNUAL",
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    version: 1,
    createdAt: CREATED_AT,
  };
}

function monthlyPeriod(month: number, version = 1, status: WorkflowTaxPeriod["status"] = "CLOSED_CURRENT"): WorkflowTaxPeriod {
  const mm = String(month).padStart(2, "0");
  return {
    id: `44444444-4444-4444-8444-${String(month).padStart(12, "0")}`,
    companyId: COMPANY_ID,
    fiscalYearProfileId: PROFILE_ID,
    fiscalYear: 2026,
    periodCode: `2026-M${mm}`,
    startDate: "2026-01-01",
    endDate: monthEnd(2026, month),
    periodType: "MONTHLY_ESTIMATE",
    status,
    version,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function record(accountCode: string, debit: number, credit = 0): JsonObject {
  return {
    accountCode,
    reducedCode: accountCode.replace(/\D/g, "").slice(-6),
    description: `Conta fiscal ${accountCode}`,
    openingBalance: "0.00",
    debit: money(debit),
    credit: money(credit),
    movement: money(debit - credit),
    closingBalance: money(debit - credit),
  };
}

function snapshotFor(period: WorkflowTaxPeriod, amount = 1000): SourceSnapshot {
  const records = [record("4.2.1.01.001", amount), record("3.1.1.01.001", 0, 125)];
  const draft = createSourceSnapshotDraft({
    companyId: COMPANY_ID,
    externalCompanyRef: "RM-0007",
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
      password: "nao-exportar",
      nested: { service_role: "nao-exportar" },
    },
    recordCount: records.length,
    records,
    totalDebit: amount,
    totalCredit: 125,
    balances: { accounts: records.length },
    snapshotVersion: 1,
  });
  return { id: `55555555-5555-4555-8555-${period.periodCode.replace(/\D/g, "").padStart(12, "0")}`, ...draft, createdAt: CREATED_AT };
}

function fiscalBalanceUsage(tax: "IRPJ" | "CSLL", used: number) {
  return {
    id: `balance-${tax}`,
    logicalKey: `balance:${tax}`,
    tax,
    balanceType: tax === "IRPJ" ? "PREJUIZO_FISCAL" as const : "BASE_NEGATIVA_CSLL" as const,
    balanceId: `saldo-${tax}`,
    originYear: 2025,
    available: money(500),
    used: money(used),
    remaining: money(500 - used),
    source: { movementId: `mov-${tax}`, ledger: "PF_BN" },
  };
}

function creditUsage(tax: "IRPJ" | "CSLL", nature: "IRRF_SERVICOS" | "IRRF_APLICACOES_FINANCEIRAS" | "CSLL_EXPLICIT_DEDUCTION", used: number) {
  return {
    id: `credit-${tax}-${nature}`,
    logicalKey: `credit:${tax}:${nature}`,
    tax,
    nature,
    label: nature === "IRRF_SERVICOS" ? "IRRF Serviços" : nature === "IRRF_APLICACOES_FINANCEIRAS" ? "IRRF Aplicações" : "Dedução CSLL",
    creditId: `credito-${nature}`,
    available: money(300),
    used: money(used),
    remaining: money(300 - used),
    source: { movementId: `retencao-${nature}`, ledger: "RETENCOES" },
  };
}

function memory(tax: "IRPJ" | "CSLL", overrides: Partial<TaxCalculationTaxMemory> = {}): TaxCalculationTaxMemory {
  const balance = fiscalBalanceUsage(tax, tax === "IRPJ" ? 50 : 30);
  const credits = tax === "IRPJ"
    ? [creditUsage("IRPJ", "IRRF_SERVICOS", 120), creditUsage("IRPJ", "IRRF_APLICACOES_FINANCEIRAS", 30)]
    : [creditUsage("CSLL", "CSLL_EXPLICIT_DEDUCTION", 15)];
  return {
    tax,
    accountingResultYtd: "1000.00",
    totalAdditions: tax === "IRPJ" ? "200.00" : "180.00",
    totalExclusions: "50.00",
    baseBeforeCompensation: tax === "IRPJ" ? "1150.00" : "1130.00",
    availableFiscalBalance: "500.00",
    maxCompensation: "345.00",
    compensationUsed: balance.used,
    fiscalBalanceUsages: [balance],
    rawBaseAfterCompensation: tax === "IRPJ" ? "1100.00" : "1100.00",
    taxableBase: "1100.00",
    rates: { normalBps: tax === "IRPJ" ? 1500 : 900 },
    normalTax: tax === "IRPJ" ? "165.00" : "99.00",
    additionalTax: tax === "IRPJ" ? "0.00" : "0.00",
    taxDueCumulative: tax === "IRPJ" ? "165.00" : "99.00",
    priorEstimateTaxDue: "20.00",
    priorEstimateReferences: [{ calculationId: "calc-prior", taxPeriodId: "period-prior", periodCode: "2026-M04", tax, versionStatus: "CLOSED_CURRENT", currentMonthTaxPayable: "20.00" }],
    creditUsages: credits,
    eligibleCreditsUsed: tax === "IRPJ" ? "150.00" : "15.00",
    netBeforeFloor: tax === "IRPJ" ? "0.00" : "64.00",
    currentMonthTaxPayable: tax === "IRPJ" ? "0.00" : "64.00",
    ...overrides,
  };
}

function adjustment(period: WorkflowTaxPeriod, snapshot: SourceSnapshot, version = 1): TaxAdjustment {
  return {
    id: `adjustment-${period.periodCode}-irpj`,
    companyId: COMPANY_ID,
    taxPeriodId: period.id,
    sourceSnapshotId: snapshot.id,
    ruleExecutionResultId: `result-${period.periodCode}`,
    tax: "IRPJ",
    adjustmentType: "ADDITION",
    accountCode: "4.2.1.01.001",
    reducedCode: "421001",
    fiscalNatureId: "nature-despesa",
    fiscalRuleId: "rule-despesa",
    fiscalRuleVersion: version,
    value: "200.00",
    origin: "RULE_EXECUTION_RESULT",
    status: "READY",
    logicalKey: `adjustment:${period.id}`,
    createdAt: CREATED_AT,
  };
}

function ruleResult(period: WorkflowTaxPeriod, snapshot: SourceSnapshot, version = 1): RuleExecutionResult {
  return {
    id: `result-${period.periodCode}`,
    companyId: COMPANY_ID,
    taxPeriodId: period.id,
    sourceSnapshotId: snapshot.id,
    accountingChartId: "chart-2026",
    companyAccountingChartId: "company-chart-2026",
    accountCode: "4.2.1.01.001",
    reducedCode: "421001",
    accountDescription: "Despesa fiscal rastreada",
    fiscalNatureId: "nature-despesa",
    accountFiscalMappingId: "mapping-421001",
    accountFiscalMappingVersion: 1,
    companyAccountMappingOverrideId: null,
    companyAccountMappingOverrideVersion: null,
    fiscalRuleId: "rule-despesa",
    fiscalRuleVersion: version,
    companyRuleOverrideId: null,
    companyRuleOverrideVersion: null,
    executionMethod: "FULL_ACCOUNT",
    automationLevel: "AUTOMATIC",
    amountBasis: "NET_DEBIT_MOVEMENT",
    rawAccountingValue: "200.00",
    calculatedValue: "200.00",
    status: "EXECUTED",
    executionMetadata: { sourceSnapshotId: snapshot.id },
    logicalKey: `result:${period.id}`,
    createdAt: CREATED_AT,
  };
}

function calculation(period: WorkflowTaxPeriod, snapshot: SourceSnapshot, taxAdjustment: TaxAdjustment, options: { versionStatus?: TaxCalculationVersionStatus; matrixVersion?: string; ruleVersion?: number; irpjPayable?: string } = {}): TaxCalculation {
  const ruleVersion = options.ruleVersion ?? taxAdjustment.fiscalRuleVersion;
  const irpj = memory("IRPJ", options.irpjPayable ? { currentMonthTaxPayable: options.irpjPayable, taxDueCumulative: options.irpjPayable } : {});
  const csll = memory("CSLL");
  return {
    id: `66666666-6666-4666-8666-${period.periodCode.replace(/\D/g, "").padStart(12, "0")}`,
    companyId: COMPANY_ID,
    taxPeriodId: period.id,
    sourceSnapshotId: snapshot.id,
    sourceSnapshotHash: snapshot.hash,
    fiscalYearProfileId: PROFILE_ID,
    engine: "ANNUAL_MONTHLY",
    modelVersion: 1,
    calculationVersion: period.version,
    versionStatus: options.versionStatus ?? (period.status === "CLOSED_SUPERSEDED" ? "CLOSED_SUPERSEDED" : period.status === "CLOSED_CURRENT" ? "CLOSED_CURRENT" : "DRAFT"),
    status: "CALCULATED",
    taxPeriod: {
      fiscalYear: period.fiscalYear,
      periodCode: period.periodCode,
      startDate: period.startDate,
      endDate: period.endDate,
      periodType: period.periodType,
    },
    accountingResultSource: { sourceSnapshotId: snapshot.id, sourceSnapshotHash: snapshot.hash },
    matrixVersion: options.matrixVersion ?? "v53",
    ruleVersions: [{ fiscalRuleId: taxAdjustment.fiscalRuleId, fiscalRuleVersion: ruleVersion }],
    taxAdjustmentIds: [taxAdjustment.id],
    priorCalculationIds: ["calc-prior"],
    fiscalBalanceUsages: [...irpj.fiscalBalanceUsages, ...csll.fiscalBalanceUsages],
    creditUsages: [...irpj.creditUsages, ...csll.creditUsages],
    irpj,
    csll,
    validationIssues: [],
    memory: { matrixHash: options.matrixVersion === "v54" ? "matrix-hash-v54" : "matrix-hash-v53" },
    logicalKey: `calculation:${period.id}`,
    createdAt: CREATED_AT,
  };
}

function decision(period: WorkflowTaxPeriod, snapshot: SourceSnapshot): TaxWorkflowHumanDecision {
  return {
    id: `decision-${period.periodCode}`,
    logicalKey: `decision:${period.id}`,
    companyId: COMPANY_ID,
    taxPeriodId: period.id,
    sourceSnapshotId: snapshot.id,
    pendingItemId: `pending-${period.periodCode}`,
    decisionType: "NEW_ACCOUNT_CLASSIFICATION",
    userId: USER_ID,
    userEmail: "fiscal@raizeducacao.com.br",
    justification: "Classificação fiscal aprovada para teste do dossiê.",
    beforeState: { status: "OPEN" },
    afterState: { status: "RESOLVED" },
    snapshotContext: { sourceSnapshotId: snapshot.id },
    matrixVersionBefore: 52,
    matrixVersionAfter: 53,
    taxAdjustmentIds: [`adjustment-${period.periodCode}-irpj`],
    createdAt: CREATED_AT,
  };
}

function pending(period: WorkflowTaxPeriod, snapshot: SourceSnapshot): PendingItem {
  return {
    id: `pending-${period.periodCode}`,
    companyId: COMPANY_ID,
    taxPeriodId: period.id,
    sourceSnapshotId: snapshot.id,
    type: "NEW_ACCOUNT_UNMAPPED",
    status: "RESOLVED",
    blocking: true,
    logicalKey: `pending:${period.id}`,
    description: "Conta nova resolvida antes do fechamento.",
    originData: { accountCode: "4.2.1.01.001" },
    createdAt: CREATED_AT,
    resolvedAt: CREATED_AT,
    resolvedBy: USER_ID,
    resolutionNote: "Resolvida antes do fechamento.",
  };
}

function closeManifest(period: WorkflowTaxPeriod, snapshot: SourceSnapshot, taxCalculation: TaxCalculation, humanDecision: TaxWorkflowHumanDecision): TaxPeriodCloseManifest {
  return {
    id: `closed-${period.periodCode}-v${period.version}`,
    logicalKey: `close:${period.id}`,
    companyId: COMPANY_ID,
    taxPeriodId: period.id,
    taxPeriod: {
      fiscalYear: period.fiscalYear,
      periodCode: period.periodCode,
      startDate: period.startDate,
      endDate: period.endDate,
      periodType: period.periodType,
      version: period.version,
    },
    sourceSnapshotId: snapshot.id,
    sourceSnapshotHash: snapshot.hash,
    taxCalculationId: taxCalculation.id,
    matrixVersion: taxCalculation.matrixVersion,
    ruleVersions: taxCalculation.ruleVersions,
    taxAdjustmentIds: taxCalculation.taxAdjustmentIds,
    humanDecisionIds: [humanDecision.id],
    fiscalBalanceUsageIds: taxCalculation.fiscalBalanceUsages.map((usage) => usage.id),
    creditUsageIds: taxCalculation.creditUsages.map((usage) => usage.id),
    closedVersion: period.version,
    scheduleModule: "IRPJ_CSLL",
    scheduleSector: "Fiscal",
    createdAt: CREATED_AT,
    createdBy: USER_ID,
  };
}

function fixture(options: { month?: number; version?: number; periodStatus?: WorkflowTaxPeriod["status"]; snapshotAmount?: number; matrixVersion?: string; ruleVersion?: number; irpjPayable?: string } = {}) {
  const basePeriod = monthlyPeriod(options.month ?? 5, options.version ?? 1, options.periodStatus ?? "CLOSED_CURRENT");
  const sourceSnapshot = snapshotFor(basePeriod, options.snapshotAmount ?? 1000);
  const taxAdjustment = adjustment(basePeriod, sourceSnapshot, options.ruleVersion ?? 1);
  const ruleExecution = ruleResult(basePeriod, sourceSnapshot, options.ruleVersion ?? 1);
  const taxCalculation = calculation(basePeriod, sourceSnapshot, taxAdjustment, {
    matrixVersion: options.matrixVersion,
    ruleVersion: options.ruleVersion,
    irpjPayable: options.irpjPayable,
  });
  const humanDecision = decision(basePeriod, sourceSnapshot);
  const manifest = closeManifest(basePeriod, sourceSnapshot, taxCalculation, humanDecision);
  const taxPeriod: WorkflowTaxPeriod = {
    ...basePeriod,
    closedManifestId: manifest.id,
    closedManifest: manifest,
    closedAt: manifest.createdAt,
    closedBy: manifest.createdBy,
  };
  const input = {
    company: { id: COMPANY_ID, code: "0007", name: "Raiz Educação S.A.", cnpj: "00.000.000/0001-00" },
    fiscalYearProfile: annualProfile(),
    taxPeriod,
    sourceSnapshot,
    taxCalculation,
    taxAdjustments: [taxAdjustment],
    ruleExecutionResults: [ruleExecution],
    humanDecisions: [humanDecision],
    pendingItems: [pending(taxPeriod, sourceSnapshot)],
    closedManifest: manifest,
    matrixHash: String(taxCalculation.memory.matrixHash),
    generatedAt: CREATED_AT,
  };
  const model = buildMonthlyTaxDossierModel(input);
  return { input, model };
}

function artifactText(pkg: ReturnType<typeof buildMonthlyTaxDossierPackage>, type: string) {
  const artifact = pkg.artifacts.find((item) => item.type === type);
  assert.ok(artifact, `${type} artifact exists`);
  return artifact.bytes.toString("utf8");
}

function workbookValues(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellStyles: true });
  return {
    workbook,
    sheetNames: workbook.SheetNames,
    values: workbook.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false }) as string[][]).flat().map(String),
  };
}
describe("IRPJ/CSLL monthly dossier foundation", () => {
  it("requires closed current or closed superseded versions", () => {
    const { input } = fixture();
    assert.throws(
      () => buildMonthlyTaxDossierModel({ ...input, taxPeriod: { ...input.taxPeriod, status: "DRAFT" }, taxCalculation: { ...input.taxCalculation, versionStatus: "DRAFT" } }),
      (error) => error instanceof TaxDossierError && error.code === "DOSSIER_VERSION_NOT_CLOSED",
    );

    assert.doesNotThrow(() => fixture({ periodStatus: "CLOSED_SUPERSEDED" }));
  });

  it("preserves the accumulated monthly estimate interval in the frozen snapshot", () => {
    const { model } = fixture({ month: 5 });
    assert.equal(model.taxPeriod.periodCode, "2026-M05");
    assert.equal(model.sourceSnapshot.taxPeriod.startDate, "2026-01-01");
    assert.equal(model.sourceSnapshot.taxPeriod.endDate, "2026-05-31");
    assert.equal(model.sourceSnapshot.parameters.startDate, "2026-01-01");
    assert.equal(model.sourceSnapshot.parameters.endDate, "2026-05-31");
    assert.equal(model.sourceSnapshot.parameters.includeClosingEntries, false);
  });

  it("builds the private storage structure and required artifacts", () => {
    const { model } = fixture({ month: 5 });
    const pkg = buildMonthlyTaxDossierPackage(model);
    assert.equal(model.storageBucket, "irpj-csll-dossiers");
    assert.equal(model.storagePrefix, `IRPJ-CSLL/${COMPANY_ID}/2026/2026-05/V01/`);
    assert.deepEqual(pkg.artifacts.map((artifact) => artifact.relativePath).sort(), [
      "Apuracao/Apuracao_IRPJ_CSLL_2026_05_V01.pdf",
      "Apuracao/Apuracao_IRPJ_CSLL_2026_05_V01.xlsx",
      "Auditoria/auditoria.json",
      "Decisoes_Fiscais/decisoes-fiscais.json",
      "Fontes/source-snapshot.json",
      "manifest.json",
      "manifest.sha256",
    ].sort());
  });

  it("creates reformulated XLSX/PDF artifacts with fiscal presentation and separated IRRF details", () => {
    const { model } = fixture();
    const pkg = buildMonthlyTaxDossierPackage(model);
    const xlsx = pkg.artifacts.find((artifact) => artifact.type === "XLSX");
    const pdf = pkg.artifacts.find((artifact) => artifact.type === "PDF");
    assert.ok(xlsx);
    assert.ok(pdf);
    const workbook = workbookValues(xlsx.bytes);
    assert.deepEqual(workbook.sheetNames, ["Resumo", "Memoria_IRPJ", "Memoria_CSLL", "Ajustes_Fiscais", "Decisoes", "Saldos_Creditos", "Fontes", "Auditoria"]);
    assert.ok(workbook.values.includes("APURAÇÃO IRPJ/CSLL — LUCRO REAL"));
    assert.ok(workbook.values.includes("Empresa"));
    assert.ok(workbook.values.includes("Raiz Educação S.A."));
    assert.ok(workbook.values.includes("CNPJ"));
    assert.ok(workbook.values.includes("Competência"));
    assert.ok(workbook.values.includes("Maio/2026"));
    assert.ok(workbook.values.includes("Matriz"));
    assert.ok(workbook.values.includes("V53"));
    assert.ok(workbook.values.includes("IRPJ acumulado"));
    assert.ok(workbook.values.includes("CSLL acumulada"));
    assert.ok(workbook.values.includes("Resultado contábil antes do IRPJ"));
    assert.ok(workbook.values.includes("Resultado contábil antes da CSLL"));
    assert.ok(workbook.values.includes("Base do ajuste"));
    assert.ok(workbook.values.includes("Saldo integral da conta"));
    assert.ok(workbook.values.includes("Composição não disponível no cenário atual."));
    assert.ok(workbook.values.includes("IRRF – Serviços"));
    assert.ok(workbook.values.includes("IRRF – Aplicações Financeiras"));
    assert.ok(!workbook.values.includes("Total IRRF"));
    assert.ok(workbook.workbook.Sheets.Resumo["!autofilter"]);
    assert.ok((workbook.workbook.Sheets.Resumo["!cols"]?.length ?? 0) >= 2);

    const pdfText = pdf.bytes.toString("latin1");
    assert.equal(pdf.bytes.toString("latin1", 0, 8), "%PDF-1.4");
    assert.match(pdfText, /WinAnsiEncoding/);
    assert.match(pdfText, /APURAÇÃO IRPJ\/CSLL/);
    assert.match(pdfText, /Competência: Maio\/2026/);
    assert.match(pdfText, /Responsável: fiscal@raizeducacao\.com\.br/);
    assert.match(pdfText, /IRRF Serviços|IRRF - Serviços/);
    assert.doesNotMatch(pdfText, /Total IRRF/);
    assert.doesNotMatch(pdfText, new RegExp(USER_ID));
  });
  it("hashes every artifact and keeps the manifest hash idempotent", () => {
    const { model } = fixture();
    const first = buildMonthlyTaxDossierPackage(model);
    const second = buildMonthlyTaxDossierPackage(model);
    assert.equal(first.manifestHash, second.manifestHash);
    assert.deepEqual(first.artifactMetadata.map((item) => item.hashSha256), second.artifactMetadata.map((item) => item.hashSha256));
    for (const artifact of first.artifacts) {
      assert.equal(artifact.hashSha256, sha256(artifact.bytes));
      assert.match(artifact.hashSha256, /^[a-f0-9]{64}$/);
    }
    assert.equal(first.artifacts.find((artifact) => artifact.type === "MANIFEST_JSON")?.hashSha256, first.manifestHash);
    assert.match(artifactText(first, "MANIFEST_SHA256"), new RegExp(`^${first.manifestHash}  manifest\\.json`));
  });

  it("persists a record identity by tax period/version and detects divergent existing dossiers", () => {
    const { model } = fixture();
    const pkg = buildMonthlyTaxDossierPackage(model);
    const record = buildTaxDossierRecord({ package: pkg, generatedBy: USER_ID, generatedAt: CREATED_AT });
    const sameRecord = buildTaxDossierRecord({ package: pkg, generatedBy: USER_ID, generatedAt: CREATED_AT });
    assert.equal(record.id, sameRecord.id);
    assert.equal(record.logicalKey, `TAX_DOSSIER:${model.taxPeriod.id}:${model.taxPeriod.version}`);
    assert.equal(record.manifestHash, pkg.manifestHash);
    assert.doesNotThrow(() => verifyExistingDossierIntegrity(record, pkg));
    assert.throws(
      () => verifyExistingDossierIntegrity({ ...record, manifestHash: "0".repeat(64) }, pkg),
      (error) => error instanceof TaxDossierError && error.code === "DOSSIER_MANIFEST_HASH_MISMATCH",
    );
  });

  it("includes frozen references, audit ids and sanitized source metadata", () => {
    const { model } = fixture();
    const pkg = buildMonthlyTaxDossierPackage(model);
    assert.equal(pkg.manifest.sourceSnapshotId, model.sourceSnapshot.id);
    assert.equal(pkg.manifest.sourceSnapshotHash, model.sourceSnapshot.hash);
    assert.equal(pkg.manifest.taxCalculationId, model.taxCalculation.id);
    assert.deepEqual(pkg.manifest.ruleVersions, model.taxCalculation.ruleVersions);
    assert.deepEqual(pkg.manifest.adjustmentIds, model.taxCalculation.taxAdjustmentIds);
    assert.deepEqual(pkg.manifest.decisionIds, model.humanDecisions.map((decision) => decision.id));
    assert.ok(!JSON.stringify(pkg.manifest).toLowerCase().includes("service_role"));
    assert.ok(!artifactText(pkg, "SOURCE_SNAPSHOT_JSON").toLowerCase().includes("password"));
    assert.ok(!artifactText(pkg, "SOURCE_SNAPSHOT_JSON").toLowerCase().includes("service_role"));
  });

  it("rejects hash and frozen-reference mismatches", () => {
    const { input } = fixture();
    assert.throws(
      () => buildMonthlyTaxDossierModel({ ...input, sourceSnapshot: { ...input.sourceSnapshot, hash: "a".repeat(64) } }),
      (error) => error instanceof TaxDossierError && error.code === "SOURCE_SNAPSHOT_HASH_MISMATCH",
    );
    assert.throws(
      () => buildMonthlyTaxDossierModel({ ...input, closedManifest: { ...input.closedManifest, sourceSnapshotId: "snapshot-de-outra-versao" } }),
      (error) => error instanceof TaxDossierError && error.code === "CLOSE_MANIFEST_SNAPSHOT_MISMATCH",
    );
  });

  it("rejects PF/BN and credit usages without traceable source", () => {
    const { input } = fixture();
    const [firstCredit] = input.taxCalculation.creditUsages;
    const taxCalculation = { ...input.taxCalculation, creditUsages: [{ ...firstCredit, source: {} }, ...input.taxCalculation.creditUsages.slice(1)] };
    assert.throws(
      () => buildMonthlyTaxDossierModel({ ...input, taxCalculation }),
      (error) => error instanceof TaxDossierError && error.code === "CREDIT_WITHOUT_SOURCE",
    );
  });

  it("does not mutate the closed tax period while generating the package", () => {
    const { model } = fixture();
    const before = JSON.stringify(model.taxPeriod);
    buildMonthlyTaxDossierPackage(model);
    assert.equal(JSON.stringify(model.taxPeriod), before);
  });

  it("compares V01 and V02 with explicit causality and a comparison artifact", () => {
    const previous = fixture({ version: 1, periodStatus: "CLOSED_SUPERSEDED", snapshotAmount: 1000 }).model;
    const current = fixture({ version: 2, periodStatus: "CLOSED_CURRENT", snapshotAmount: 1500, matrixVersion: "v54", ruleVersion: 2, irpjPayable: "210.00" }).model;
    const comparison = compareMonthlyTaxDossierModels(previous, current);
    assert.equal(comparison.previousVersion, "V01");
    assert.equal(comparison.currentVersion, "V02");
    assert.ok(comparison.causalities.includes("SNAPSHOT_CHANGED"));
    assert.ok(comparison.causalities.includes("MATRIX_CHANGED"));
    assert.ok(comparison.causalities.includes("RULE_CHANGED"));
    assert.ok(comparison.rows.some((row) => row.metric === "IRPJ a recolher no mês" && row.changeNature !== "UNCHANGED"));
    assert.ok(comparison.rows.some((row) => row.metric === "Resultado contábil antes do IRPJ"));
    assert.ok(comparison.rows.some((row) => row.metric === "Resultado contábil antes da CSLL"));
    assert.ok(comparison.rows.some((row) => row.metric.trim() === "Despesa fiscal rastreada"));
    assert.ok(!comparison.rows.some((row) => row.metric === "sourceSnapshotHash" || row.metric === "Matrix version" || row.metric === "rule versions"));

    const pkg = buildMonthlyTaxDossierPackage(current, previous);
    const comparisonArtifact = pkg.artifacts.find((artifact) => artifact.type === "COMPARISON_JSON");
    assert.ok(comparisonArtifact);
    assert.equal(comparisonArtifact.relativePath, "Comparativos/comparativo-versoes.json");
    assert.deepEqual(pkg.manifest.comparisonSourceVersions, ["V01", "V02"]);
  });

  it("formats monetary evidence in BRL", () => {
    assert.equal(formatDossierMoney("1234.5"), "R$ 1.234,50");
    assert.equal(formatDossierMoney("-1234.5"), "-R$ 1.234,50");
  });
});
