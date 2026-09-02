import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type { TaxCalculation, TaxCalculationTaxMemory } from "./annual-monthly-engine.ts";
import type { PendingItem, RuleExecutionResult, TaxAdjustment } from "./fiscal-matrix.ts";
import type { TaxPeriodCloseManifest, TaxWorkflowHumanDecision, WorkflowTaxPeriod } from "./monthly-workflow.ts";
import { canonicalJson, normalizeMoney, verifySourceSnapshotIntegrity } from "./source-snapshot.ts";
import type { FiscalYearProfile, JsonObject, JsonValue, SourceSnapshot } from "./types.ts";

export const MONTHLY_TAX_DOSSIER_SCHEMA_VERSION = 1;
export const MONTHLY_TAX_DOSSIER_VERSION = 1;
export const TAX_DOSSIER_BUCKET = "irpj-csll-dossiers";
export const TAX_DOSSIER_STORAGE_ROOT = "IRPJ-CSLL";

export const TAX_DOSSIER_STATUSES = ["AVAILABLE", "GENERATION_FAILED"] as const;
export const TAX_DOSSIER_INTEGRITY_STATUSES = ["OK", "FAILED"] as const;
export const TAX_DOSSIER_ARTIFACT_TYPES = [
  "XLSX",
  "PDF",
  "SOURCE_SNAPSHOT_JSON",
  "FISCAL_DECISIONS_JSON",
  "AUDIT_JSON",
  "COMPARISON_JSON",
  "MANIFEST_JSON",
  "MANIFEST_SHA256",
] as const;

export type TaxDossierStatus = (typeof TAX_DOSSIER_STATUSES)[number];
export type TaxDossierIntegrityStatus = (typeof TAX_DOSSIER_INTEGRITY_STATUSES)[number];
export type TaxDossierArtifactType = (typeof TAX_DOSSIER_ARTIFACT_TYPES)[number];

export type TaxDossierCompany = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly cnpj?: string | null;
};

export type MonthlyTaxDossierModelInput = {
  readonly company: TaxDossierCompany;
  readonly fiscalYearProfile: FiscalYearProfile | null;
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly sourceSnapshot: SourceSnapshot;
  readonly taxCalculation: TaxCalculation;
  readonly taxAdjustments: readonly TaxAdjustment[];
  readonly ruleExecutionResults: readonly RuleExecutionResult[];
  readonly humanDecisions: readonly TaxWorkflowHumanDecision[];
  readonly pendingItems?: readonly PendingItem[];
  readonly closedManifest?: TaxPeriodCloseManifest | JsonObject | null;
  readonly matrixHash?: string | null;
  readonly generatedAt?: string | Date;
};

export type MonthlyTaxDossierModel = {
  readonly schemaVersion: number;
  readonly dossierVersion: number;
  readonly company: TaxDossierCompany;
  readonly fiscalYearProfile: FiscalYearProfile | null;
  readonly fiscalYear: number;
  readonly competence: string;
  readonly versionLabel: string;
  readonly storageBucket: typeof TAX_DOSSIER_BUCKET;
  readonly storagePrefix: string;
  readonly taxPeriod: WorkflowTaxPeriod;
  readonly closedManifest: JsonObject;
  readonly sourceSnapshot: SourceSnapshot;
  readonly taxCalculation: TaxCalculation;
  readonly taxCalculationHash: string;
  readonly taxAdjustments: readonly TaxAdjustment[];
  readonly ruleExecutionResults: readonly RuleExecutionResult[];
  readonly humanDecisions: readonly TaxWorkflowHumanDecision[];
  readonly resolvedPendingItems: readonly PendingItem[];
  readonly matrixVersion: string;
  readonly matrixHash: string | null;
  readonly generatedAt: string;
  readonly closedAt: string | null;
  readonly closedBy: string | null;
  readonly blockingPendingCountAtClose: 0;
};

export type MonthlyTaxDossierComparisonRow = {
  readonly metric: string;
  readonly previousVersion: string;
  readonly currentVersion: string;
  readonly previousValue: string;
  readonly currentValue: string;
  readonly delta: string | null;
  readonly changeNature: "UNCHANGED" | "VALUE_CHANGED" | "ADDED" | "REMOVED";
  readonly cause: string;
};

export type MonthlyTaxDossierComparison = {
  readonly schemaVersion: number;
  readonly previousTaxPeriodId: string;
  readonly currentTaxPeriodId: string;
  readonly previousVersion: string;
  readonly currentVersion: string;
  readonly rows: readonly MonthlyTaxDossierComparisonRow[];
  readonly causalities: readonly string[];
};

export type MonthlyTaxDossierArtifact = {
  readonly type: TaxDossierArtifactType;
  readonly relativePath: string;
  readonly contentType: string;
  readonly fileName: string;
  readonly bytes: Buffer;
  readonly hashSha256: string;
  readonly sizeBytes: number;
};

export type MonthlyTaxDossierArtifactMetadata = Omit<MonthlyTaxDossierArtifact, "bytes">;

export type MonthlyTaxDossierPackage = {
  readonly model: MonthlyTaxDossierModel;
  readonly comparison: MonthlyTaxDossierComparison | null;
  readonly manifest: JsonObject;
  readonly manifestHash: string;
  readonly artifacts: readonly MonthlyTaxDossierArtifact[];
  readonly artifactMetadata: readonly MonthlyTaxDossierArtifactMetadata[];
};

export type TaxDossierRecord = {
  readonly id: string;
  readonly logicalKey: string;
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly taxPeriodVersion: number;
  readonly status: TaxDossierStatus;
  readonly storageBucket: string;
  readonly storagePrefix: string;
  readonly manifest: JsonObject;
  readonly manifestHash: string;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly artifactMetadata: readonly MonthlyTaxDossierArtifactMetadata[];
  readonly integrityStatus: TaxDossierIntegrityStatus;
  readonly failureCode?: string | null;
  readonly failureMessage?: string | null;
  readonly comparisonSourceVersions: readonly string[];
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export class TaxDossierError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}



function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? sanitizeJson(value as JsonObject) as JsonObject : {};
}

function sha256(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cents(value: unknown) {
  const normalized = normalizeMoney(typeof value === "number" || typeof value === "string" ? value : "0");
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsigned = sign < 0n ? normalized.slice(1) : normalized;
  const [integer, fraction] = unsigned.split(".");
  return sign * BigInt(`${integer}${fraction}`);
}

function moneyFromCents(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function formatDossierMoney(value: unknown) {
  const normalized = normalizeMoney(typeof value === "number" || typeof value === "string" ? value : "0");
  const sign = normalized.startsWith("-") ? "-" : "";
  const unsigned = sign ? normalized.slice(1) : normalized;
  const [integer, fraction] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${grouped},${fraction}`;
}

function formatBps(value: unknown) {
  const bps = Number(value ?? 0);
  return `${(bps / 100).toFixed(2).replace(".", ",")}%`;
}

function versionLabel(version: number) {
  return `V${String(version).padStart(2, "0")}`;
}

function competenceFromPeriod(period: WorkflowTaxPeriod) {
  return period.endDate.slice(0, 7);
}

function sanitizeSegment(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_.=-]/g, "_").slice(0, 120) || "empresa";
}

export function monthlyDossierStoragePrefix(companyId: string, fiscalYear: number, competence: string, version: number) {
  return `${TAX_DOSSIER_STORAGE_ROOT}/${sanitizeSegment(companyId)}/${fiscalYear}/${competence}/${versionLabel(version)}/`;
}

function generatedAtValue(value: string | Date | undefined, fallback: string | null) {
  const parsed = value === undefined ? new Date(fallback ?? "2000-01-01T00:00:00.000Z") : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TaxDossierError("INVALID_DOSSIER_GENERATED_AT", "Data de geração do dossiê inválida.");
  return parsed.toISOString();
}

function sensitiveKey(key: string) {
  return /(access[_-]?token|refresh[_-]?token|password|senha|secret|service[_-]?role|cookie|authorization|connection[_-]?string|credential|credencial|totvs[_-]?password|supabase[_-]?service)/i.test(key);
}

export function sanitizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => sanitizeJson(item));
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, JsonValue>)
    .filter(([key]) => !sensitiveKey(key))
    .map(([key, item]) => [key, sanitizeJson(item)] as const);
  return Object.fromEntries(entries) as JsonObject;
}

function hasSensitiveText(value: JsonValue) {
  return canonicalJson(value as never).toLowerCase().match(/access[_-]?token|refresh[_-]?token|service[_-]?role|connection[_-]?string|totvs[_-]?password|authorization|cookie/) !== null;
}

function stableJsonBuffer(value: JsonValue) {
  return Buffer.from(`${canonicalJson(sanitizeJson(value) as never)}\n`, "utf8");
}

function calculationHash(calculation: TaxCalculation) {
  return sha256(stableJsonBuffer(calculation as unknown as JsonObject));
}

function ensureClosedEligibility(period: WorkflowTaxPeriod, calculation: TaxCalculation) {
  if (period.status !== "CLOSED_CURRENT" && period.status !== "CLOSED_SUPERSEDED") {
    throw new TaxDossierError("DOSSIER_VERSION_NOT_CLOSED", "Dossiê oficial exige versão CLOSED_CURRENT ou CLOSED_SUPERSEDED.");
  }
  if (calculation.versionStatus !== "CLOSED_CURRENT" && calculation.versionStatus !== "CLOSED_SUPERSEDED") {
    throw new TaxDossierError("DOSSIER_CALCULATION_NOT_CLOSED", "Dossiê oficial exige cálculo fechado.");
  }
}

function ensureSnapshotIntegrity(snapshot: SourceSnapshot) {
  if (!verifySourceSnapshotIntegrity(snapshot as never)) {
    throw new TaxDossierError("SOURCE_SNAPSHOT_HASH_MISMATCH", "Hash do SOURCE_SNAPSHOT diverge do conteúdo persistido.");
  }
}

function ensureFrozenReferences(input: MonthlyTaxDossierModelInput, closedManifest: JsonObject) {
  if (input.sourceSnapshot.taxPeriodId !== input.taxPeriod.id) {
    throw new TaxDossierError("SOURCE_SNAPSHOT_PERIOD_MISMATCH", "SOURCE_SNAPSHOT não pertence à versão fechada.");
  }
  if (input.taxCalculation.taxPeriodId !== input.taxPeriod.id) {
    throw new TaxDossierError("TAX_CALCULATION_PERIOD_MISMATCH", "TAX_CALCULATION não pertence à versão fechada.");
  }
  if (input.taxCalculation.sourceSnapshotId !== input.sourceSnapshot.id || input.taxCalculation.sourceSnapshotHash !== input.sourceSnapshot.hash) {
    throw new TaxDossierError("TAX_CALCULATION_SNAPSHOT_MISMATCH", "Cálculo fechado não aponta para o snapshot congelado informado.");
  }
  if (closedManifest.sourceSnapshotId && closedManifest.sourceSnapshotId !== input.sourceSnapshot.id) {
    throw new TaxDossierError("CLOSE_MANIFEST_SNAPSHOT_MISMATCH", "Manifesto de fechamento aponta para outro snapshot.");
  }
  if (closedManifest.sourceSnapshotHash && closedManifest.sourceSnapshotHash !== input.sourceSnapshot.hash) {
    throw new TaxDossierError("CLOSE_MANIFEST_SNAPSHOT_HASH_MISMATCH", "Manifesto de fechamento aponta para outro hash de snapshot.");
  }
  if (closedManifest.taxCalculationId && closedManifest.taxCalculationId !== input.taxCalculation.id) {
    throw new TaxDossierError("CLOSE_MANIFEST_CALCULATION_MISMATCH", "Manifesto de fechamento aponta para outro cálculo.");
  }
}

function sourceIsTraceable(source: JsonObject) {
  return Boolean(source && typeof source === "object" && !Array.isArray(source) && Object.keys(source).length > 0);
}

function ensureTraceableBalancesAndCredits(calculation: TaxCalculation) {
  for (const usage of calculation.fiscalBalanceUsages) {
    if (cents(usage.used) > 0n && !sourceIsTraceable(usage.source)) {
      throw new TaxDossierError("FISCAL_BALANCE_WITHOUT_SOURCE", "PF/BN utilizado sem origem rastreável no cálculo fechado.");
    }
  }
  for (const usage of calculation.creditUsages) {
    if (cents(usage.used) > 0n && !sourceIsTraceable(usage.source)) {
      throw new TaxDossierError("CREDIT_WITHOUT_SOURCE", "Crédito utilizado sem origem rastreável no cálculo fechado.");
    }
  }
}

function relevantAdjustments(input: MonthlyTaxDossierModelInput) {
  const ids = new Set(input.taxCalculation.taxAdjustmentIds);
  return input.taxAdjustments
    .filter((adjustment) => ids.has(adjustment.id) && adjustment.status !== "SUPERSEDED")
    .sort((left, right) => left.tax.localeCompare(right.tax) || left.accountCode.localeCompare(right.accountCode) || left.id.localeCompare(right.id));
}

function resolvedPendingItems(input: MonthlyTaxDossierModelInput) {
  return (input.pendingItems ?? [])
    .filter((item) => item.taxPeriodId === input.taxPeriod.id && item.status === "RESOLVED")
    .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey));
}

function blockingPendingCount(input: MonthlyTaxDossierModelInput) {
  return (input.pendingItems ?? []).filter((item) => item.taxPeriodId === input.taxPeriod.id && item.status === "OPEN" && item.blocking).length;
}

function closedAtFrom(input: MonthlyTaxDossierModelInput, manifest: JsonObject) {
  return String((manifest.createdAt ?? input.taxPeriod.updatedAt ?? input.taxCalculation.createdAt) || "");
}

function closedByFrom(input: MonthlyTaxDossierModelInput, manifest: JsonObject) {
  return String((manifest.createdBy ?? input.taxPeriod.closedBy ?? "") || "") || null;
}

function matrixHashFrom(input: MonthlyTaxDossierModelInput, manifest: JsonObject) {
  const value = input.matrixHash ?? manifest.matrixHash ?? input.taxCalculation.memory?.matrixHash ?? null;
  return value ? String(value) : null;
}

export function buildMonthlyTaxDossierModel(input: MonthlyTaxDossierModelInput): MonthlyTaxDossierModel {
  const closedManifest = asJsonObject(input.closedManifest ?? input.taxPeriod.closedManifest ?? {});
  if (!Object.keys(closedManifest).length) {
    throw new TaxDossierError("MISSING_CLOSED_MANIFEST", "Dossiê exige manifesto lógico de fechamento congelado.");
  }
  ensureClosedEligibility(input.taxPeriod, input.taxCalculation);
  ensureSnapshotIntegrity(input.sourceSnapshot);
  ensureFrozenReferences(input, closedManifest);
  ensureTraceableBalancesAndCredits(input.taxCalculation);
  const blocking = blockingPendingCount(input);
  if (blocking > 0) {
    throw new TaxDossierError("BLOCKING_PENDING_ITEMS_AT_DOSSIER", "Dossiê não pode ser gerado com pendências bloqueantes abertas.");
  }
  const closedAt = closedAtFrom(input, closedManifest);
  const generatedAt = generatedAtValue(input.generatedAt, closedAt || input.taxCalculation.createdAt);
  const competence = competenceFromPeriod(input.taxPeriod);
  return {
    schemaVersion: MONTHLY_TAX_DOSSIER_SCHEMA_VERSION,
    dossierVersion: MONTHLY_TAX_DOSSIER_VERSION,
    company: input.company,
    fiscalYearProfile: input.fiscalYearProfile,
    fiscalYear: input.taxPeriod.fiscalYear,
    competence,
    versionLabel: versionLabel(input.taxPeriod.version),
    storageBucket: TAX_DOSSIER_BUCKET,
    storagePrefix: monthlyDossierStoragePrefix(input.company.id, input.taxPeriod.fiscalYear, competence, input.taxPeriod.version),
    taxPeriod: input.taxPeriod,
    closedManifest,
    sourceSnapshot: input.sourceSnapshot,
    taxCalculation: input.taxCalculation,
    taxCalculationHash: calculationHash(input.taxCalculation),
    taxAdjustments: relevantAdjustments(input),
    ruleExecutionResults: input.ruleExecutionResults
      .filter((result) => result.taxPeriodId === input.taxPeriod.id)
      .sort((left, right) => left.accountCode.localeCompare(right.accountCode) || left.id.localeCompare(right.id)),
    humanDecisions: input.humanDecisions
      .filter((decision) => decision.taxPeriodId === input.taxPeriod.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    resolvedPendingItems: resolvedPendingItems(input),
    matrixVersion: input.taxCalculation.matrixVersion,
    matrixHash: matrixHashFrom(input, closedManifest),
    generatedAt,
    closedAt: closedAt || null,
    closedBy: closedByFrom(input, closedManifest),
    blockingPendingCountAtClose: 0,
  };
}

function sourceSnapshotExport(model: MonthlyTaxDossierModel): JsonObject {
  return sanitizeJson({
    snapshotId: model.sourceSnapshot.id,
    hash: model.sourceSnapshot.hash,
    source: model.sourceSnapshot.source,
    sourceType: model.sourceSnapshot.sourceType,
    provider: model.sourceSnapshot.provider,
    adapterVersion: model.sourceSnapshot.adapterVersion,
    contentSchemaVersion: model.sourceSnapshot.contentSchemaVersion,
    company: model.company,
    taxPeriodId: model.taxPeriod.id,
    taxPeriod: model.sourceSnapshot.taxPeriod,
    extractedAt: model.sourceSnapshot.extractedAt,
    parameters: model.sourceSnapshot.parameters,
    startDate: model.sourceSnapshot.taxPeriod.startDate,
    endDate: model.sourceSnapshot.taxPeriod.endDate,
    includeClosingEntries: model.sourceSnapshot.parameters.includeClosingEntries ?? null,
    recordCount: model.sourceSnapshot.recordCount,
    totalDebit: model.sourceSnapshot.totalDebit,
    totalCredit: model.sourceSnapshot.totalCredit,
    balances: model.sourceSnapshot.balances,
    canonicalContent: model.sourceSnapshot.records,
    immutableReference: { table: "source_snapshots", id: model.sourceSnapshot.id, hash: model.sourceSnapshot.hash },
  } as JsonObject) as JsonObject;
}

function decisionsExport(model: MonthlyTaxDossierModel): JsonObject {
  return sanitizeJson({
    taxPeriodId: model.taxPeriod.id,
    taxPeriodVersion: model.taxPeriod.version,
    matrixVersion: model.matrixVersion,
    decisions: model.humanDecisions.map((decision) => ({
      id: decision.id,
      decisionType: decision.decisionType,
      pendingItemId: decision.pendingItemId,
      userId: decision.userId,
      userEmail: decision.userEmail,
      justification: decision.justification,
      createdAt: decision.createdAt,
      before: decision.beforeState,
      after: decision.afterState,
      snapshotContext: decision.snapshotContext,
      matrixVersionBefore: decision.matrixVersionBefore,
      matrixVersionAfter: decision.matrixVersionAfter,
      taxAdjustmentIds: decision.taxAdjustmentIds,
    })),
  } as JsonObject) as JsonObject;
}

function auditExport(model: MonthlyTaxDossierModel): JsonObject {
  return sanitizeJson({
    evidenceChain: "numero -> calculo congelado -> ajuste -> execucao -> regra/versao -> Matriz -> snapshot -> fonte",
    humanDecisionChain: "numero -> decisao -> usuario -> data -> justificativa -> contexto",
    closedManifest: model.closedManifest,
    taxCalculationHash: model.taxCalculationHash,
    ruleVersions: model.taxCalculation.ruleVersions,
    taxAdjustmentIds: model.taxCalculation.taxAdjustmentIds,
    humanDecisionIds: model.humanDecisions.map((decision) => decision.id),
    pendingItemsResolved: model.resolvedPendingItems.map((item) => ({ id: item.id, type: item.type, resolvedAt: item.resolvedAt, resolvedBy: item.resolvedBy })),
  } as JsonObject) as JsonObject;
}

function statusDisplayLabel(value: string | null | undefined) {
  if (value === "CLOSED_CURRENT") return "Fechada vigente";
  if (value === "CLOSED_SUPERSEDED") return "Fechada substituída";
  if (value === "DRAFT") return "Rascunho";
  if (value === "OPEN") return "Aberta";
  return value ?? "";
}

function engineDisplayLabel(value: string | null | undefined) {
  if (value === "ANNUAL_MONTHLY") return "Lucro Real Anual - estimativa mensal";
  return value ?? "";
}

function matrixDisplayLabel(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  const match = text.match(/V(\d+)$/i) ?? text.match(/(\d+)$/);
  return match ? `V${Number(match[1])}` : text;
}

function formatDossierDate(value: string | null | undefined) {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatDossierDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR", { timeZone: "UTC" });
}

function formatCnpj(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 14) return value ?? "";
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function competenceDisplay(value: string) {
  const [year, month] = value.split("-");
  const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const index = Number(month) - 1;
  return names[index] ? `${names[index]}/${year}` : value;
}

function isUuid(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function responsibleLabel(model: MonthlyTaxDossierModel) {
  const closedBy = String(model.closedBy ?? "").trim();
  if (closedBy && !isUuid(closedBy)) return closedBy;
  return model.humanDecisions.find((decision) => decision.userEmail)?.userEmail ?? closedBy;
}

function sourceValue(source: JsonObject | null | undefined, key: string) {
  const value = source?.[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

function creditDocumentLabel(source: JsonObject | null | undefined) {
  const keys = ["documentNumber", "documento", "document", "notaFiscal", "invoice", "sourceDocument", "lancamentoId"];
  for (const key of keys) {
    const value = sourceValue(source, key);
    if (value) return value;
  }
  return "";
}

function zeroBreakdownLabel(type: "ADDITION" | "EXCLUSION") {
  return type === "ADDITION" ? "Nenhuma adição no período" : "Nenhuma exclusão no período";
}

function adjustmentTreatmentLabel(tax: string, type: string) {
  if (type === "ADDITION") return `(+) Adição ${tax}`;
  if (type === "EXCLUSION") return `(-) Exclusão ${tax}`;
  return type;
}

function adjustmentBaseDisplay(result: RuleExecutionResult | undefined) {
  if (result?.executionMethod === "FULL_ACCOUNT") return "Saldo integral da conta";
  if (result?.executionMethod === "TRANSACTION_FILTER") return "Lançamentos específicos";
  return "Regra/controle fiscal";
}

function adjustmentSupportDisplay(result: RuleExecutionResult | undefined) {
  return result?.executionMethod === "TRANSACTION_FILTER" ? "Ver composição" : "—";
}

function adjustmentResultMap(model: MonthlyTaxDossierModel) {
  return new Map(model.ruleExecutionResults.map((result) => [result.id, result]));
}

function adjustmentDescription(adjustment: TaxAdjustment, result: RuleExecutionResult | undefined) {
  return result?.accountDescription || adjustment.accountCode;
}

type DossierAdjustmentGroup = {
  readonly primary: TaxAdjustment;
  readonly result: RuleExecutionResult | undefined;
  readonly treatments: readonly string[];
};

function adjustmentGroupKey(adjustment: TaxAdjustment, result: RuleExecutionResult | undefined) {
  return [
    adjustment.accountCode,
    adjustment.fiscalRuleId,
    adjustment.fiscalRuleVersion,
    adjustment.adjustmentType,
    adjustment.value,
    result?.rawAccountingValue ?? adjustment.value,
    adjustmentBaseDisplay(result),
  ].join("|");
}
function groupedAdjustmentRows(model: MonthlyTaxDossierModel): DossierAdjustmentGroup[] {
  const results = adjustmentResultMap(model);
  const groups = new Map<string, { primary: TaxAdjustment; result: RuleExecutionResult | undefined; treatments: string[] }>();
  for (const adjustment of model.taxAdjustments.filter((item) => item.status !== "SUPERSEDED")) {
    const result = results.get(adjustment.ruleExecutionResultId);
    const key = adjustmentGroupKey(adjustment, result);
    const label = adjustmentTreatmentLabel(adjustment.tax, adjustment.adjustmentType);
    const group = groups.get(key);
    if (group) {
      if (!group.treatments.includes(label)) group.treatments.push(label);
      continue;
    }
    groups.set(key, { primary: adjustment, result, treatments: [label] });
  }
  return [...groups.values()].map((group) => ({ ...group, treatments: group.treatments.sort((left, right) => left.localeCompare(right)) }));
}

function appendAdjustmentRows(
  rows: (string | number)[][],
  model: MonthlyTaxDossierModel,
  tax: "IRPJ" | "CSLL",
  type: "ADDITION" | "EXCLUSION",
  totalValue: string,
) {
  const results = adjustmentResultMap(model);
  const items = model.taxAdjustments.filter((adjustment) => adjustment.tax === tax && adjustment.adjustmentType === type && adjustment.status !== "SUPERSEDED");
  if (!items.length && cents(totalValue) === 0n) {
    rows.push([`    ${zeroBreakdownLabel(type)}`, "—"]);
    return;
  }
  for (const adjustment of items) {
    const result = results.get(adjustment.ruleExecutionResultId);
    rows.push([`    ${adjustment.accountCode} - ${adjustmentDescription(adjustment, result)}`, formatDossierMoney(adjustment.value)]);
  }
}

function dossierHeaderRows(model: MonthlyTaxDossierModel) {
  return [
    ["APURAÇÃO IRPJ/CSLL — LUCRO REAL", ""],
    ["Empresa", model.company.name],
    ["CNPJ", formatCnpj(model.company.cnpj)],
    ["Competência", competenceDisplay(model.competence)],
    ["Período", `${formatDossierDate(model.taxPeriod.startDate)} a ${formatDossierDate(model.taxPeriod.endDate)}`],
    ["Versão", model.versionLabel],
    ["Status", statusDisplayLabel(model.taxPeriod.status)],
    ["Fechado em", formatDossierDateTime(model.closedAt)],
    ["Responsável", responsibleLabel(model)],
  ];
}

function withDossierHeader(model: MonthlyTaxDossierModel, title: string, rows: (string | number)[][]) {
  return [...dossierHeaderRows(model), [], [title, ""], ...rows];
}

function accountingResultLabel(tax: "IRPJ" | "CSLL") {
  return tax === "IRPJ" ? "Resultado contábil antes do IRPJ" : "Resultado contábil antes da CSLL";
}

function taxMemoryRows(title: string, model: MonthlyTaxDossierModel, memory: TaxCalculationTaxMemory) {
  const tax = memory.tax as "IRPJ" | "CSLL";
  const rows: (string | number)[][] = [["Composição", "Valor"]];
  rows.push([accountingResultLabel(tax), formatDossierMoney(memory.accountingResultYtd)]);
  rows.push([`(+) Adições ${tax}`, formatDossierMoney(memory.totalAdditions)]);
  appendAdjustmentRows(rows, model, tax, "ADDITION", memory.totalAdditions);
  rows.push([`(-) Exclusões ${tax}`, formatDossierMoney(memory.totalExclusions)]);
  appendAdjustmentRows(rows, model, tax, "EXCLUSION", memory.totalExclusions);
  rows.push([tax === "IRPJ" ? "Lucro Real antes da compensação" : "Base CSLL antes da compensação", formatDossierMoney(memory.baseBeforeCompensation)]);
  rows.push([tax === "IRPJ" ? "(-) Prejuízo Fiscal utilizado" : "(-) Base Negativa utilizada", formatDossierMoney(memory.compensationUsed)]);
  rows.push(["Base após compensação", formatDossierMoney(memory.taxableBase)]);
  rows.push([tax === "IRPJ" ? "IRPJ 15%" : "CSLL 9%", formatDossierMoney(memory.normalTax)]);
  if (tax === "IRPJ") rows.push(["Adicional IRPJ", formatDossierMoney(memory.additionalTax)]);
  rows.push([tax === "IRPJ" ? "IRPJ acumulado" : "CSLL acumulada", formatDossierMoney(memory.taxDueCumulative)]);
  rows.push(["(-) Estimativas anteriores", formatDossierMoney(memory.priorEstimateTaxDue)]);
  if (tax === "IRPJ") {
    rows.push(["(-) IRRF – Serviços", formatDossierMoney(totalCredit(memory, "IRRF_SERVICOS"))]);
    rows.push(["(-) IRRF – Aplicações Financeiras", formatDossierMoney(totalCredit(memory, "IRRF_APLICACOES_FINANCEIRAS"))]);
  } else {
    rows.push(["(-) CSLL Retida", formatDossierMoney(totalCredit(memory, "CSLL_EXPLICIT_DEDUCTION"))]);
  }
  rows.push([finalLabel(tax, model.competence), formatDossierMoney(memory.currentMonthTaxPayable)]);
  return withDossierHeader(model, title, rows);
}

function adjustmentRows(model: MonthlyTaxDossierModel) {
  return withDossierHeader(model, "Ajustes Fiscais", [
    ["Conta", "Descrição", "Tratamento", "Base do ajuste", "Valor contábil", "Ajuste", "Suporte"],
    ...groupedAdjustmentRows(model).map((group) => {
      const adjustment = group.primary;
      const result = group.result;
      return [
        adjustment.accountCode,
        adjustmentDescription(adjustment, result),
        group.treatments.join("; "),
        adjustmentBaseDisplay(result),
        result ? formatDossierMoney(result.rawAccountingValue) : "",
        formatDossierMoney(adjustment.value),
        adjustmentSupportDisplay(result),
      ];
    }),
  ]);
}
function decisionRows(model: MonthlyTaxDossierModel) {
  return withDossierHeader(model, "Decisões Fiscais", [
    ["Decisão", "Responsável", "Data", "Justificativa", "Conta/contexto"],
    ...model.humanDecisions.map((decision) => [
      decision.decisionType,
      decision.userEmail ?? decision.userId,
      formatDossierDateTime(decision.createdAt),
      decision.justification,
      String(decision.snapshotContext.accountCode ?? decision.beforeState.accountCode ?? decision.pendingItemId),
    ]),
  ]);
}

function balanceDossierLabel(value: string) {
  if (value === "PREJUIZO_FISCAL") return "Prejuízo Fiscal";
  if (value === "BASE_NEGATIVA_CSLL") return "Base Negativa";
  return value;
}

function creditDossierLabel(value: string) {
  if (value === "IRRF_SERVICOS") return "IRRF – Serviços";
  if (value === "IRRF_APLICACOES_FINANCEIRAS") return "IRRF – Aplicações Financeiras";
  if (value === "CSLL_EXPLICIT_DEDUCTION") return "CSLL Retida";
  return value;
}

function balancesAndCreditsRows(model: MonthlyTaxDossierModel) {
  return withDossierHeader(model, "Saldos e Créditos", [
    ["Natureza", "Disponível", "Utilizado", "Saldo", "Composição"],
    ...model.taxCalculation.fiscalBalanceUsages.map((usage) => [
      balanceDossierLabel(usage.balanceType),
      formatDossierMoney(usage.available),
      formatDossierMoney(usage.used),
      formatDossierMoney(usage.remaining),
      usage.originYear ? `Ano/período de origem ${usage.originYear}` : "Composição não disponível no cenário atual.",
    ]),
    ...model.taxCalculation.creditUsages.map((usage) => [
      creditDossierLabel(usage.nature),
      formatDossierMoney(usage.available),
      formatDossierMoney(usage.used),
      formatDossierMoney(usage.remaining),
      creditDocumentLabel(usage.source) || "Composição não disponível no cenário atual.",
    ]),
  ]);
}
function sourceRows(model: MonthlyTaxDossierModel) {
  return [
    ["Campo", "Valor"],
    ["Snapshot id", model.sourceSnapshot.id],
    ["Snapshot hash", model.sourceSnapshot.hash],
    ["Fonte", model.sourceSnapshot.source],
    ["Provider", model.sourceSnapshot.provider],
    ["Adapter version", model.sourceSnapshot.adapterVersion],
    ["Content schema version", model.sourceSnapshot.contentSchemaVersion],
    ["Extraído em", model.sourceSnapshot.extractedAt],
    ["Data inicial", model.sourceSnapshot.taxPeriod.startDate],
    ["Data final", model.sourceSnapshot.taxPeriod.endDate],
    ["includeClosingEntries", String(model.sourceSnapshot.parameters.includeClosingEntries ?? "")],
    ["Registros", model.sourceSnapshot.recordCount],
    ["Total débito", formatDossierMoney(model.sourceSnapshot.totalDebit)],
    ["Total crédito", formatDossierMoney(model.sourceSnapshot.totalCredit)],
  ];
}

function auditRows(model: MonthlyTaxDossierModel) {
  return [
    ["Campo", "Valor"],
    ["Manifesto fechamento", model.taxPeriod.closedManifestId ?? String(model.closedManifest.id ?? "")],
    ["Tax calculation id", model.taxCalculation.id],
    ["Tax calculation hash", model.taxCalculationHash],
    ["Matrix version", model.matrixVersion],
    ["Matrix hash", model.matrixHash ?? ""],
    ["Rule versions", canonicalJson(model.taxCalculation.ruleVersions as never)],
    ["Adjustment ids", model.taxCalculation.taxAdjustmentIds.join(", ")],
    ["Decision ids", model.humanDecisions.map((decision) => decision.id).join(", ")],
    ["PF/BN movement ids", model.taxCalculation.fiscalBalanceUsages.map((usage) => usage.id).join(", ")],
    ["Credit movement ids", model.taxCalculation.creditUsages.map((usage) => usage.id).join(", ")],
  ];
}

function finalLabel(tax: "IRPJ" | "CSLL", competence: string) {
  const month = Number(competence.slice(5, 7));
  if (month >= 1 && month <= 11) return tax === "IRPJ" ? "IRPJ a recolher no mês" : "CSLL a recolher no mês";
  return tax === "IRPJ" ? "Resultado IRPJ da competência" : "Resultado CSLL da competência";
}

type DossierSheetOptions = {
  readonly tableHeaderRow?: number | null;
};

function addSheet(workbook: XLSX.WorkBook, name: string, rows: (string | number)[][], options: DossierSheetOptions = {}) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const maxColumns = Math.max(2, ...rows.map((row) => row.length));
  sheet["!cols"] = Array.from({ length: maxColumns }, (_, index) => ({ wch: index === 0 ? 34 : 22 }));
  const inferredHeaderRow = rows.findIndex((row) => row.includes("Campo") || row.includes("Indicador") || row.includes("Composição") || row.includes("Conta") || row.includes("Natureza"));
  const tableHeaderRow = options.tableHeaderRow === undefined ? inferredHeaderRow : options.tableHeaderRow;
  if (tableHeaderRow !== null && tableHeaderRow >= 0 && rows.length > tableHeaderRow) {
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: tableHeaderRow, c: 0 }, e: { r: rows.length - 1, c: maxColumns - 1 } }) };
    sheet["!freeze"] = { xSplit: 0, ySplit: tableHeaderRow + 1 };
  }
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

export function buildMonthlyDossierXlsx(model: MonthlyTaxDossierModel, comparison: MonthlyTaxDossierComparison | null) {
  const workbook = XLSX.utils.book_new();
  const dossierHeader = dossierHeaderRows(model);
  const defaultTableHeaderRow = dossierHeader.length + 2;
  addSheet(workbook, "Resumo", [
    ...dossierHeader,
    [],
    ["Indicador", "Valor"],
    ["Motor", engineDisplayLabel(model.taxCalculation.engine)],
    ["Snapshot", model.sourceSnapshot.hash],
    ["Matriz", matrixDisplayLabel(model.matrixVersion)],
    ["Pendências bloqueantes no fechamento", model.blockingPendingCountAtClose],
    [finalLabel("IRPJ", model.competence), formatDossierMoney(model.taxCalculation.irpj.currentMonthTaxPayable)],
    [finalLabel("CSLL", model.competence), formatDossierMoney(model.taxCalculation.csll.currentMonthTaxPayable)],
  ], { tableHeaderRow: dossierHeader.length + 1 });
  addSheet(workbook, "Memoria_IRPJ", taxMemoryRows("Memória IRPJ", model, model.taxCalculation.irpj), { tableHeaderRow: defaultTableHeaderRow });
  addSheet(workbook, "Memoria_CSLL", taxMemoryRows("Memória CSLL", model, model.taxCalculation.csll), { tableHeaderRow: defaultTableHeaderRow });
  addSheet(workbook, "Ajustes_Fiscais", adjustmentRows(model), { tableHeaderRow: defaultTableHeaderRow });
  addSheet(workbook, "Decisoes", decisionRows(model), { tableHeaderRow: defaultTableHeaderRow });
  addSheet(workbook, "Saldos_Creditos", balancesAndCreditsRows(model), { tableHeaderRow: defaultTableHeaderRow });
  addSheet(workbook, "Fontes", withDossierHeader(model, "Fontes", sourceRows(model)), { tableHeaderRow: defaultTableHeaderRow });
  addSheet(workbook, "Auditoria", withDossierHeader(model, "Auditoria", auditRows(model)), { tableHeaderRow: defaultTableHeaderRow });
  if (comparison) {
    addSheet(workbook, "Comparativo_Versoes", withDossierHeader(model, "Comparativo de Versões", [
      ["Composição", comparison.previousVersion, comparison.currentVersion, "Diferença", "Natureza", "Causa"],
      ...comparison.rows.map((row) => [row.metric, row.previousValue, row.currentValue, row.delta ?? "", row.changeNature, row.cause]),
    ]), { tableHeaderRow: defaultTableHeaderRow });
  }
  const writeOptions = { bookType: "xlsx", type: "buffer", Props: { CreatedDate: new Date("2000-01-01T00:00:00.000Z"), ModifiedDate: new Date("2000-01-01T00:00:00.000Z") } } as XLSX.WritingOptions & { Props: Record<string, unknown> };
  const written = XLSX.write(workbook, writeOptions);
  return Buffer.isBuffer(written) ? written : Buffer.from(written);
}
function pdfEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function latin1Text(value: string) {
  return value.replace(/[–—→]/g, "-").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}

function wrapLine(line: string, width = 96) {
  const words = latin1Text(line).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    if (`${current} ${word}`.trim().length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current || !lines.length) lines.push(current);
  return lines;
}

function comparisonNatureDisplay(value: string) {
  if (value === "VALUE_CHANGED") return "Valor alterado";
  if (value === "UNCHANGED") return "Sem alteração";
  if (value === "ADDED") return "Adicionado";
  if (value === "REMOVED") return "Removido";
  return value;
}

function comparisonCauseDisplay(value: string) {
  if (value === "SNAPSHOT_CHANGED") return "Snapshot alterado";
  if (value === "MATRIX_CHANGED") return "Matriz alterada";
  if (value === "RULE_CHANGED") return "Regra alterada";
  if (value === "HUMAN_DECISION_CHANGED") return "Decisão fiscal alterada";
  if (value === "CREDIT_CHANGED") return "Crédito alterado";
  if (value === "FISCAL_BALANCE_CHANGED") return "PF/BN alterado";
  if (value === "UNKNOWN_CAUSE") return "Causa não identificada";
  return value;
}

function pdfTableLines(rows: (string | number)[][], tableHeaderRow: number, limit = 80) {
  return rows
    .slice(tableHeaderRow + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .slice(0, limit)
    .map((row) => row.map((cell) => String(cell ?? "")).join(" | "));
}

export function buildMonthlyDossierPdf(model: MonthlyTaxDossierModel, comparison: MonthlyTaxDossierComparison | null) {
  const tableHeaderRow = dossierHeaderRows(model).length + 2;
  const lines = [
    ...dossierHeaderRows(model).map(([label, value]) => value ? `${label}: ${value}` : String(label)),
    `Gerado em: ${formatDossierDateTime(model.generatedAt)}`,
    "",
    "Resumo da apuração",
    `Motor: ${engineDisplayLabel(model.taxCalculation.engine)}`,
    `Matriz: ${matrixDisplayLabel(model.matrixVersion)}`,
    `Snapshot: ${model.sourceSnapshot.hash}`,
    `${finalLabel("IRPJ", model.competence)}: ${formatDossierMoney(model.taxCalculation.irpj.currentMonthTaxPayable)}`,
    `${finalLabel("CSLL", model.competence)}: ${formatDossierMoney(model.taxCalculation.csll.currentMonthTaxPayable)}`,
    "",
    "Memória IRPJ",
    ...pdfTableLines(taxMemoryRows("Memória IRPJ", model, model.taxCalculation.irpj), tableHeaderRow),
    "",
    "Memória CSLL",
    ...pdfTableLines(taxMemoryRows("Memória CSLL", model, model.taxCalculation.csll), tableHeaderRow),
    "",
    "Ajustes Fiscais",
    ...pdfTableLines(adjustmentRows(model), tableHeaderRow, 30),
    model.taxAdjustments.length > 30 ? "Demais ajustes disponíveis no XLSX." : "",
    "",
    "Saldos e Créditos",
    ...pdfTableLines(balancesAndCreditsRows(model), tableHeaderRow, 30),
    "",
    "Decisões fiscais",
    ...(model.humanDecisions.length ? model.humanDecisions.map((decision) => `${decision.decisionType} | ${decision.userEmail ?? decision.userId} | ${formatDossierDateTime(decision.createdAt)} | ${decision.justification}`) : ["Sem decisões fiscais registradas para a versão."]),
    "",
    "Comparativo de versões",
    ...(comparison ? comparison.rows.slice(0, 40).map((row) => `${row.metric} | ${comparison.previousVersion}: ${row.previousValue} | ${comparison.currentVersion}: ${row.currentValue} | Diferença: ${row.delta ?? "—"} | ${comparisonNatureDisplay(row.changeNature)} | ${comparisonCauseDisplay(row.cause)}`) : ["Comparativo V01/V02 não aplicável para esta versão."]),
    comparison && comparison.rows.length > 40 ? "Demais linhas do comparativo disponíveis no XLSX/JSON." : "",
    "",
    "Auditoria resumida",
    `Tax calculation hash: ${model.taxCalculationHash}`,
    `Rule versions: ${canonicalJson(model.taxCalculation.ruleVersions as never)}`,
    `Manifesto fechamento: ${model.taxPeriod.closedManifestId ?? String(model.closedManifest.id ?? "")}`,
  ].flatMap((line) => wrapLine(line));

  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 54) pages.push(lines.slice(index, index + 54));
  const objects: Buffer[] = [];
  const addObject = (content: string | Buffer) => {
    objects.push(Buffer.isBuffer(content) ? content : Buffer.from(content, "latin1"));
    return objects.length;
  };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const pageLines of pages) {
    const streamText = `BT /F1 10 Tf 40 800 Td 13 TL ${pageLines.map((line) => `(${pdfEscape(line)}) Tj T*`).join(" ")} ET`;
    const stream = Buffer.from(streamText, "latin1");
    const contentId = addObject(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "latin1");
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`, "latin1");
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, "latin1"), objects[index], Buffer.from("\nendobj\n", "latin1"));
  }
  const body = Buffer.concat(chunks);
  const xrefOffset = body.length;
  const xref = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f ", ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)].join("\n");
  const trailer = `\n${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([body, Buffer.from(trailer, "latin1")]);
}
function artifact(type: TaxDossierArtifactType, relativePath: string, contentType: string, bytes: Buffer): MonthlyTaxDossierArtifact {
  const fileName = relativePath.split("/").at(-1) ?? relativePath;
  return { type, relativePath, contentType, fileName, bytes, hashSha256: sha256(bytes), sizeBytes: bytes.byteLength };
}

function xlsxFileName(model: MonthlyTaxDossierModel) {
  return `Apuracao_IRPJ_CSLL_${model.fiscalYear}_${model.competence.slice(5, 7)}_${model.versionLabel}.xlsx`;
}

function pdfFileName(model: MonthlyTaxDossierModel) {
  return `Apuracao_IRPJ_CSLL_${model.fiscalYear}_${model.competence.slice(5, 7)}_${model.versionLabel}.pdf`;
}

function jsonArtifact(type: TaxDossierArtifactType, relativePath: string, value: JsonValue) {
  return artifact(type, relativePath, "application/json; charset=utf-8", stableJsonBuffer(value));
}

function moneyDelta(left: string, right: string) {
  return moneyFromCents(cents(right) - cents(left));
}

function compareMoneyMetric(metric: string, previousVersion: string, currentVersion: string, previousValue: string, currentValue: string, cause: string): MonthlyTaxDossierComparisonRow {
  const previousCents = cents(previousValue);
  const currentCents = cents(currentValue);
  const delta = currentCents - previousCents;
  return {
    metric,
    previousVersion,
    currentVersion,
    previousValue: formatDossierMoney(previousValue),
    currentValue: formatDossierMoney(currentValue),
    delta: formatDossierMoney(moneyDelta(previousValue, currentValue)),
    changeNature: delta === 0n ? "UNCHANGED" : previousCents === 0n ? "ADDED" : currentCents === 0n ? "REMOVED" : "VALUE_CHANGED",
    cause,
  };
}

function totalCredit(memory: TaxCalculationTaxMemory, nature: string) {
  return moneyFromCents(memory.creditUsages.filter((item) => item.nature === nature).reduce((sum, item) => sum + cents(item.used), 0n));
}

function evidenceCause(previous: MonthlyTaxDossierModel, current: MonthlyTaxDossierModel, metric: string) {
  if (previous.sourceSnapshot.hash !== current.sourceSnapshot.hash) return "SNAPSHOT_CHANGED";
  if (previous.matrixVersion !== current.matrixVersion || previous.matrixHash !== current.matrixHash) return "MATRIX_CHANGED";
  if (canonicalJson(previous.taxCalculation.ruleVersions as never) !== canonicalJson(current.taxCalculation.ruleVersions as never)) return "RULE_CHANGED";
  if (canonicalJson(previous.humanDecisions.map((item) => item.id) as never) !== canonicalJson(current.humanDecisions.map((item) => item.id) as never)) return "HUMAN_DECISION_CHANGED";
  if (metric.includes("IRRF") || metric.includes("Retida") || metric.includes("Crédito")) return "CREDIT_CHANGED";
  if (metric.includes("PF") || metric.includes("BN") || metric.includes("Prejuízo") || metric.includes("Base Negativa")) return "FISCAL_BALANCE_CHANGED";
  return "UNKNOWN_CAUSE";
}

function adjustmentSignature(model: MonthlyTaxDossierModel) {
  return canonicalJson(model.taxAdjustments.map((item) => ({ id: item.id, tax: item.tax, accountCode: item.accountCode, type: item.adjustmentType, value: item.value, rule: item.fiscalRuleId, version: item.fiscalRuleVersion })).sort((left, right) => left.id.localeCompare(right.id)) as never);
}

function adjustmentComparisonKey(adjustment: TaxAdjustment) {
  return `${adjustment.tax}:${adjustment.adjustmentType}:${adjustment.accountCode}:${adjustment.fiscalRuleId}`;
}

type AdjustmentComparisonItem = {
  readonly adjustment: TaxAdjustment;
  readonly result: RuleExecutionResult | undefined;
};

function adjustmentComparisonCause(previous: MonthlyTaxDossierModel, current: MonthlyTaxDossierModel, previousItem: AdjustmentComparisonItem | undefined, currentItem: AdjustmentComparisonItem | undefined) {
  if (previousItem && currentItem && previousItem.adjustment.fiscalRuleVersion !== currentItem.adjustment.fiscalRuleVersion) return "RULE_CHANGED";
  return evidenceCause(previous, current, "ajustes");
}

function adjustmentComparisonRows(
  previous: MonthlyTaxDossierModel,
  current: MonthlyTaxDossierModel,
  tax: "IRPJ" | "CSLL",
  type: "ADDITION" | "EXCLUSION",
  previousVersion: string,
  currentVersion: string,
) {
  const previousResults = adjustmentResultMap(previous);
  const currentResults = adjustmentResultMap(current);
  const previousMap = new Map<string, AdjustmentComparisonItem>();
  const currentMap = new Map<string, AdjustmentComparisonItem>();
  for (const adjustment of previous.taxAdjustments.filter((item) => item.tax === tax && item.adjustmentType === type && item.status !== "SUPERSEDED")) {
    previousMap.set(adjustmentComparisonKey(adjustment), { adjustment, result: previousResults.get(adjustment.ruleExecutionResultId) });
  }
  for (const adjustment of current.taxAdjustments.filter((item) => item.tax === tax && item.adjustmentType === type && item.status !== "SUPERSEDED")) {
    currentMap.set(adjustmentComparisonKey(adjustment), { adjustment, result: currentResults.get(adjustment.ruleExecutionResultId) });
  }
  return [...new Set([...previousMap.keys(), ...currentMap.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const previousItem = previousMap.get(key);
      const currentItem = currentMap.get(key);
      const labelItem = currentItem ?? previousItem;
      const description = labelItem ? adjustmentDescription(labelItem.adjustment, labelItem.result) : key;
      return compareMoneyMetric(
        `    ${description}`,
        previousVersion,
        currentVersion,
        previousItem?.adjustment.value ?? "0.00",
        currentItem?.adjustment.value ?? "0.00",
        adjustmentComparisonCause(previous, current, previousItem, currentItem),
      );
    });
}

function buildComparisonCausalities(previous: MonthlyTaxDossierModel, current: MonthlyTaxDossierModel, rows: readonly MonthlyTaxDossierComparisonRow[]) {
  const causalities = new Set(rows.filter((row) => row.changeNature !== "UNCHANGED").map((row) => row.cause));
  if (previous.sourceSnapshot.hash !== current.sourceSnapshot.hash) causalities.add("SNAPSHOT_CHANGED");
  if (previous.matrixVersion !== current.matrixVersion || previous.matrixHash !== current.matrixHash) causalities.add("MATRIX_CHANGED");
  if (canonicalJson(previous.taxCalculation.ruleVersions as never) !== canonicalJson(current.taxCalculation.ruleVersions as never)) causalities.add("RULE_CHANGED");
  if (canonicalJson(previous.humanDecisions.map((item) => item.id) as never) !== canonicalJson(current.humanDecisions.map((item) => item.id) as never)) causalities.add("HUMAN_DECISION_CHANGED");
  if (adjustmentSignature(previous) !== adjustmentSignature(current)) causalities.add("RULE_CHANGED");
  return [...causalities];
}

export function compareMonthlyTaxDossierModels(previous: MonthlyTaxDossierModel, current: MonthlyTaxDossierModel): MonthlyTaxDossierComparison {
  const previousVersion = previous.versionLabel;
  const currentVersion = current.versionLabel;
  const rows: MonthlyTaxDossierComparisonRow[] = [];
  rows.push(compareMoneyMetric("Resultado contábil antes do IRPJ", previousVersion, currentVersion, previous.taxCalculation.irpj.accountingResultYtd, current.taxCalculation.irpj.accountingResultYtd, evidenceCause(previous, current, "Resultado contábil antes do IRPJ")));
  rows.push(compareMoneyMetric("(+) Adições IRPJ", previousVersion, currentVersion, previous.taxCalculation.irpj.totalAdditions, current.taxCalculation.irpj.totalAdditions, evidenceCause(previous, current, "Adições IRPJ")));
  rows.push(...adjustmentComparisonRows(previous, current, "IRPJ", "ADDITION", previousVersion, currentVersion));
  rows.push(compareMoneyMetric("(-) Exclusões IRPJ", previousVersion, currentVersion, previous.taxCalculation.irpj.totalExclusions, current.taxCalculation.irpj.totalExclusions, evidenceCause(previous, current, "Exclusões IRPJ")));
  rows.push(...adjustmentComparisonRows(previous, current, "IRPJ", "EXCLUSION", previousVersion, currentVersion));
  rows.push(compareMoneyMetric("Lucro Real antes da compensação", previousVersion, currentVersion, previous.taxCalculation.irpj.baseBeforeCompensation, current.taxCalculation.irpj.baseBeforeCompensation, evidenceCause(previous, current, "Lucro Real antes da compensação")));
  rows.push(compareMoneyMetric("(-) Prejuízo Fiscal utilizado", previousVersion, currentVersion, previous.taxCalculation.irpj.compensationUsed, current.taxCalculation.irpj.compensationUsed, evidenceCause(previous, current, "Prejuízo Fiscal utilizado")));
  rows.push(compareMoneyMetric("Base após compensação IRPJ", previousVersion, currentVersion, previous.taxCalculation.irpj.taxableBase, current.taxCalculation.irpj.taxableBase, evidenceCause(previous, current, "Base IRPJ")));
  rows.push(compareMoneyMetric("IRPJ 15%", previousVersion, currentVersion, previous.taxCalculation.irpj.normalTax, current.taxCalculation.irpj.normalTax, evidenceCause(previous, current, "IRPJ 15%")));
  rows.push(compareMoneyMetric("Adicional IRPJ", previousVersion, currentVersion, previous.taxCalculation.irpj.additionalTax, current.taxCalculation.irpj.additionalTax, evidenceCause(previous, current, "Adicional IRPJ")));
  rows.push(compareMoneyMetric("IRPJ acumulado", previousVersion, currentVersion, previous.taxCalculation.irpj.taxDueCumulative, current.taxCalculation.irpj.taxDueCumulative, evidenceCause(previous, current, "IRPJ acumulado")));
  rows.push(compareMoneyMetric("(-) Estimativas anteriores IRPJ", previousVersion, currentVersion, previous.taxCalculation.irpj.priorEstimateTaxDue, current.taxCalculation.irpj.priorEstimateTaxDue, evidenceCause(previous, current, "Estimativas anteriores IRPJ")));
  rows.push(compareMoneyMetric("(-) IRRF – Serviços", previousVersion, currentVersion, totalCredit(previous.taxCalculation.irpj, "IRRF_SERVICOS"), totalCredit(current.taxCalculation.irpj, "IRRF_SERVICOS"), evidenceCause(previous, current, "IRRF Serviços")));
  rows.push(compareMoneyMetric("(-) IRRF – Aplicações Financeiras", previousVersion, currentVersion, totalCredit(previous.taxCalculation.irpj, "IRRF_APLICACOES_FINANCEIRAS"), totalCredit(current.taxCalculation.irpj, "IRRF_APLICACOES_FINANCEIRAS"), evidenceCause(previous, current, "IRRF Aplicações Financeiras")));
  rows.push(compareMoneyMetric(finalLabel("IRPJ", current.competence), previousVersion, currentVersion, previous.taxCalculation.irpj.currentMonthTaxPayable, current.taxCalculation.irpj.currentMonthTaxPayable, evidenceCause(previous, current, finalLabel("IRPJ", current.competence))));

  rows.push(compareMoneyMetric("Resultado contábil antes da CSLL", previousVersion, currentVersion, previous.taxCalculation.csll.accountingResultYtd, current.taxCalculation.csll.accountingResultYtd, evidenceCause(previous, current, "Resultado contábil antes da CSLL")));
  rows.push(compareMoneyMetric("(+) Adições CSLL", previousVersion, currentVersion, previous.taxCalculation.csll.totalAdditions, current.taxCalculation.csll.totalAdditions, evidenceCause(previous, current, "Adições CSLL")));
  rows.push(...adjustmentComparisonRows(previous, current, "CSLL", "ADDITION", previousVersion, currentVersion));
  rows.push(compareMoneyMetric("(-) Exclusões CSLL", previousVersion, currentVersion, previous.taxCalculation.csll.totalExclusions, current.taxCalculation.csll.totalExclusions, evidenceCause(previous, current, "Exclusões CSLL")));
  rows.push(...adjustmentComparisonRows(previous, current, "CSLL", "EXCLUSION", previousVersion, currentVersion));
  rows.push(compareMoneyMetric("Base CSLL antes da compensação", previousVersion, currentVersion, previous.taxCalculation.csll.baseBeforeCompensation, current.taxCalculation.csll.baseBeforeCompensation, evidenceCause(previous, current, "Base CSLL antes da compensação")));
  rows.push(compareMoneyMetric("(-) Base Negativa utilizada", previousVersion, currentVersion, previous.taxCalculation.csll.compensationUsed, current.taxCalculation.csll.compensationUsed, evidenceCause(previous, current, "Base Negativa utilizada")));
  rows.push(compareMoneyMetric("Base após compensação CSLL", previousVersion, currentVersion, previous.taxCalculation.csll.taxableBase, current.taxCalculation.csll.taxableBase, evidenceCause(previous, current, "Base CSLL")));
  rows.push(compareMoneyMetric("CSLL 9%", previousVersion, currentVersion, previous.taxCalculation.csll.normalTax, current.taxCalculation.csll.normalTax, evidenceCause(previous, current, "CSLL 9%")));
  rows.push(compareMoneyMetric("CSLL acumulada", previousVersion, currentVersion, previous.taxCalculation.csll.taxDueCumulative, current.taxCalculation.csll.taxDueCumulative, evidenceCause(previous, current, "CSLL acumulada")));
  rows.push(compareMoneyMetric("(-) Estimativas anteriores CSLL", previousVersion, currentVersion, previous.taxCalculation.csll.priorEstimateTaxDue, current.taxCalculation.csll.priorEstimateTaxDue, evidenceCause(previous, current, "Estimativas anteriores CSLL")));
  rows.push(compareMoneyMetric("(-) CSLL Retida", previousVersion, currentVersion, totalCredit(previous.taxCalculation.csll, "CSLL_EXPLICIT_DEDUCTION"), totalCredit(current.taxCalculation.csll, "CSLL_EXPLICIT_DEDUCTION"), evidenceCause(previous, current, "CSLL Retida")));
  rows.push(compareMoneyMetric(finalLabel("CSLL", current.competence), previousVersion, currentVersion, previous.taxCalculation.csll.currentMonthTaxPayable, current.taxCalculation.csll.currentMonthTaxPayable, evidenceCause(previous, current, finalLabel("CSLL", current.competence))));

  return {
    schemaVersion: MONTHLY_TAX_DOSSIER_SCHEMA_VERSION,
    previousTaxPeriodId: previous.taxPeriod.id,
    currentTaxPeriodId: current.taxPeriod.id,
    previousVersion,
    currentVersion,
    rows,
    causalities: buildComparisonCausalities(previous, current, rows),
  };
}
function artifactListForManifest(artifacts: readonly MonthlyTaxDossierArtifact[]) {
  return artifacts.map((item) => ({
    type: item.type,
    path: item.relativePath,
    contentType: item.contentType,
    sizeBytes: item.sizeBytes,
    hashAlgorithm: "SHA-256",
    hashSha256: item.hashSha256,
  })).sort((left, right) => left.path.localeCompare(right.path));
}

export function buildDossierManifest(model: MonthlyTaxDossierModel, artifacts: readonly MonthlyTaxDossierArtifact[], comparison: MonthlyTaxDossierComparison | null): JsonObject {
  const manifest = sanitizeJson({
    schemaVersion: MONTHLY_TAX_DOSSIER_SCHEMA_VERSION,
    dossierVersion: MONTHLY_TAX_DOSSIER_VERSION,
    generatedAt: model.generatedAt,
    companyId: model.company.id,
    companyCode: model.company.code,
    companyName: model.company.name,
    cnpj: model.company.cnpj ?? null,
    fiscalYear: model.fiscalYear,
    periodCode: model.taxPeriod.periodCode,
    periodStart: model.taxPeriod.startDate,
    periodEnd: model.taxPeriod.endDate,
    taxPeriodId: model.taxPeriod.id,
    taxPeriodVersion: model.taxPeriod.version,
    taxPeriodStatus: model.taxPeriod.status,
    closedAt: model.closedAt,
    closedBy: model.closedBy,
    engine: model.taxCalculation.engine,
    sourceSnapshotId: model.sourceSnapshot.id,
    sourceSnapshotHash: model.sourceSnapshot.hash,
    matrixVersion: model.matrixVersion,
    matrixHash: model.matrixHash,
    taxCalculationId: model.taxCalculation.id,
    taxCalculationHash: model.taxCalculationHash,
    ruleVersions: model.taxCalculation.ruleVersions,
    adjustmentIds: model.taxCalculation.taxAdjustmentIds,
    decisionIds: model.humanDecisions.map((decision) => decision.id),
    creditMovementIds: model.taxCalculation.creditUsages.map((usage) => usage.id),
    fiscalBalanceMovementIds: model.taxCalculation.fiscalBalanceUsages.map((usage) => usage.id),
    artifactList: artifactListForManifest(artifacts),
    artifactHashes: Object.fromEntries(artifacts.map((item) => [item.relativePath, item.hashSha256]).sort(([left], [right]) => left.localeCompare(right))),
    comparisonSourceVersions: comparison ? [comparison.previousVersion, comparison.currentVersion] : [],
  } as JsonObject) as JsonObject;
  if (hasSensitiveText(manifest)) throw new TaxDossierError("DOSSIER_MANIFEST_CONTAINS_SECRET", "Manifest contém metadata sensível.");
  return manifest;
}

export function buildMonthlyTaxDossierPackage(model: MonthlyTaxDossierModel, previousModel: MonthlyTaxDossierModel | null = null): MonthlyTaxDossierPackage {
  const comparison = previousModel ? compareMonthlyTaxDossierModels(previousModel, model) : null;
  const xlsx = artifact("XLSX", `Apuracao/${xlsxFileName(model)}`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buildMonthlyDossierXlsx(model, comparison));
  const pdf = artifact("PDF", `Apuracao/${pdfFileName(model)}`, "application/pdf", buildMonthlyDossierPdf(model, comparison));
  const artifacts: MonthlyTaxDossierArtifact[] = [
    jsonArtifact("SOURCE_SNAPSHOT_JSON", "Fontes/source-snapshot.json", sourceSnapshotExport(model)),
    jsonArtifact("FISCAL_DECISIONS_JSON", "Decisoes_Fiscais/decisoes-fiscais.json", decisionsExport(model)),
    jsonArtifact("AUDIT_JSON", "Auditoria/auditoria.json", auditExport(model)),
    xlsx,
    pdf,
  ];
  if (comparison) artifacts.push(jsonArtifact("COMPARISON_JSON", "Comparativos/comparativo-versoes.json", comparison as unknown as JsonObject));
  const manifest = buildDossierManifest(model, artifacts, comparison);
  const manifestBytes = stableJsonBuffer(manifest);
  const manifestHash = sha256(manifestBytes);
  artifacts.push(artifact("MANIFEST_JSON", "manifest.json", "application/json; charset=utf-8", manifestBytes));
  artifacts.push(artifact("MANIFEST_SHA256", "manifest.sha256", "text/plain; charset=utf-8", Buffer.from(`${manifestHash}  manifest.json\n`, "utf8")));
  return {
    model,
    comparison,
    manifest,
    manifestHash,
    artifacts,
    artifactMetadata: artifacts.map(({ bytes: _bytes, ...metadata }) => metadata),
  };
}

export function buildTaxDossierRecord(input: { readonly package: MonthlyTaxDossierPackage; readonly generatedBy: string; readonly generatedAt?: string | Date }): TaxDossierRecord {
  const generatedAt = generatedAtValue(input.generatedAt, input.package.model.generatedAt);
  const logicalKey = `TAX_DOSSIER:${input.package.model.taxPeriod.id}:${input.package.model.taxPeriod.version}`;
  const id = createHash("sha256").update(logicalKey).digest("hex").slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  return {
    id,
    logicalKey,
    companyId: input.package.model.company.id,
    taxPeriodId: input.package.model.taxPeriod.id,
    taxPeriodVersion: input.package.model.taxPeriod.version,
    status: "AVAILABLE",
    storageBucket: input.package.model.storageBucket,
    storagePrefix: input.package.model.storagePrefix,
    manifest: input.package.manifest,
    manifestHash: input.package.manifestHash,
    generatedAt,
    generatedBy: input.generatedBy,
    artifactMetadata: input.package.artifactMetadata,
    integrityStatus: "OK",
    failureCode: null,
    failureMessage: null,
    comparisonSourceVersions: input.package.comparison ? [input.package.comparison.previousVersion, input.package.comparison.currentVersion] : [],
  };
}

export function verifyExistingDossierIntegrity(record: TaxDossierRecord, nextPackage: MonthlyTaxDossierPackage) {
  if (record.manifestHash !== nextPackage.manifestHash) {
    throw new TaxDossierError("DOSSIER_MANIFEST_HASH_MISMATCH", "Dossiê já existente possui manifest hash divergente.");
  }
  const current = new Map(record.artifactMetadata.map((item) => [item.relativePath, item.hashSha256]));
  for (const artifact of nextPackage.artifactMetadata) {
    if (current.get(artifact.relativePath) !== artifact.hashSha256) {
      throw new TaxDossierError("DOSSIER_ARTIFACT_HASH_MISMATCH", "Artefato existente possui hash divergente.");
    }
  }
  return true;
}