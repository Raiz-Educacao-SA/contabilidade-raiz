"use client";

import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
} from "lucide-react";

type JsonRecord = Record<string, unknown>;

type FiscalYearProfile = {
  readonly id: string;
  readonly fiscalYear: number;
  readonly taxRegime: string;
  readonly periodicity: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly version: number;
};

type WorkflowTaxPeriod = {
  readonly id: string;
  readonly fiscalYear: number;
  readonly periodCode: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly periodType: string;
  readonly status: string;
  readonly version: number;
  readonly upstreamStale?: boolean;
  readonly closedManifestId?: string | null;
  readonly closedManifest?: JsonRecord;
  readonly replacedByTaxPeriodId?: string | null;
  readonly updatedAt?: string;
  readonly closedAt?: string | null;
  readonly closedBy?: string | null;
};

type SourceSnapshot = {
  readonly id: string;
  readonly taxPeriod: {
    readonly fiscalYear: number;
    readonly periodCode: string;
    readonly startDate: string;
    readonly endDate: string;
  };
  readonly source: string;
  readonly sourceType: string;
  readonly provider: string;
  readonly extractedAt: string;
  readonly parameters: JsonRecord;
  readonly recordCount: number;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly balances: unknown;
  readonly hash: string;
  readonly snapshotVersion: number;
};

type PendingItem = {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly blocking: boolean;
  readonly logicalKey: string;
  readonly description: string;
  readonly originData: JsonRecord;
  readonly createdAt?: string;
  readonly createdBy?: string | null;
  readonly resolvedAt?: string | null;
  readonly resolvedBy?: string | null;
  readonly resolutionNote?: string | null;
};

type RuleExecutionResult = {
  readonly id: string;
  readonly accountCode: string;
  readonly accountDescription: string;
  readonly fiscalRuleId: string;
  readonly fiscalRuleVersion: number;
  readonly executionMethod: string;
  readonly automationLevel: string;
  readonly amountBasis: string | null;
  readonly rawAccountingValue: string;
  readonly calculatedValue: string;
  readonly status: string;
  readonly createdAt: string;
};

type TaxAdjustment = {
  readonly id: string;
  readonly tax: "IRPJ" | "CSLL" | string;
  readonly adjustmentType: string;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly ruleExecutionResultId?: string;
  readonly fiscalNatureId: string;
  readonly fiscalRuleId: string;
  readonly fiscalRuleVersion: number;
  readonly value: string;
  readonly origin: string;
  readonly status: string;
  readonly createdAt: string;
};

type PriorEstimateReference = {
  readonly calculationId: string;
  readonly taxPeriodId: string;
  readonly periodCode: string;
  readonly tax: string;
  readonly versionStatus: string;
  readonly currentMonthTaxPayable: string;
};

type FiscalBalanceUsage = {
  readonly id: string;
  readonly tax: string;
  readonly balanceType: string;
  readonly balanceId: string;
  readonly originYear: number | null;
  readonly available: string;
  readonly used: string;
  readonly remaining: string;
  readonly source?: JsonRecord;
};

type TaxCreditUsage = {
  readonly id: string;
  readonly tax: string;
  readonly nature: string;
  readonly label: string;
  readonly creditId: string;
  readonly available: string;
  readonly used: string;
  readonly remaining: string;
  readonly source?: JsonRecord;
};

type TaxMemory = {
  readonly tax: string;
  readonly accountingResultYtd: string;
  readonly totalAdditions: string;
  readonly totalExclusions: string;
  readonly baseBeforeCompensation: string;
  readonly availableFiscalBalance: string;
  readonly maxCompensation: string;
  readonly compensationUsed: string;
  readonly rawBaseAfterCompensation: string;
  readonly taxableBase: string;
  readonly normalTax: string;
  readonly additionalTax: string;
  readonly taxDueCumulative: string;
  readonly priorEstimateTaxDue: string;
  readonly priorEstimateReferences: readonly PriorEstimateReference[];
  readonly creditUsages: readonly TaxCreditUsage[];
  readonly eligibleCreditsUsed: string;
  readonly netBeforeFloor: string;
  readonly currentMonthTaxPayable: string;
};

type TaxCalculation = {
  readonly id: string;
  readonly taxPeriodId: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotHash: string;
  readonly engine: string;
  readonly modelVersion: number;
  readonly calculationVersion: number;
  readonly versionStatus: string;
  readonly status: string;
  readonly matrixVersion: string;
  readonly taxAdjustmentIds: readonly string[];
  readonly priorCalculationIds: readonly string[];
  readonly fiscalBalanceUsages: readonly FiscalBalanceUsage[];
  readonly creditUsages: readonly TaxCreditUsage[];
  readonly irpj: TaxMemory;
  readonly csll: TaxMemory;
  readonly validationIssues: readonly { readonly code: string; readonly message: string; readonly severity: string }[];
  readonly createdAt: string;
};

type HumanDecision = {
  readonly id: string;
  readonly pendingItemId: string;
  readonly decisionType: string;
  readonly userEmail: string | null;
  readonly justification: string;
  readonly previousState: JsonRecord;
  readonly nextState: JsonRecord;
  readonly createdAt: string;
};

type TaxDossierArtifact = {
  readonly type: string;
  readonly relativePath: string;
  readonly contentType: string;
  readonly fileName: string;
  readonly hashSha256: string;
  readonly sizeBytes: number;
};

type TaxDossier = {
  readonly id: string;
  readonly taxPeriodId: string;
  readonly taxPeriodVersion: number;
  readonly status: "AVAILABLE" | "GENERATION_FAILED" | string;
  readonly storageBucket: string;
  readonly storagePrefix: string;
  readonly manifestHash: string;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly artifactMetadata: readonly TaxDossierArtifact[];
  readonly integrityStatus: "OK" | "FAILED" | string;
  readonly failureCode?: string | null;
  readonly failureMessage?: string | null;
  readonly comparisonSourceVersions: readonly string[];
};

type DossierComparisonRow = {
  readonly metric: string;
  readonly previousVersion?: string;
  readonly currentVersion?: string;
  readonly previousValue: string;
  readonly currentValue: string;
  readonly delta: string | null;
  readonly changeNature: string;
  readonly cause: string;
};

type DossierComparison = {
  readonly previousVersion: string;
  readonly currentVersion: string;
  readonly rows: readonly DossierComparisonRow[];
  readonly causalities?: readonly string[];
};
type CloseIssue = {
  readonly code: string;
  readonly message: string;
  readonly severity: string;
};

type IrpjCsllDashboard = {
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
  readonly humanDecisions: readonly HumanDecision[];
  readonly dossiers: readonly TaxDossier[];
  readonly closeIssues: readonly CloseIssue[];
  readonly closeAllowed: boolean;
  readonly annualAdjustmentPeriodCode: string;
};

type IrpjCsllAssessmentProps = {
  readonly companyId: string;
  readonly companyCode: string;
  readonly companyName: string;
  readonly competence: string;
  readonly accessToken: string;
  readonly canWrite: boolean;
  readonly userId: string;
  readonly userEmail: string;
};

type TabId =
  | "overview"
  | "memory"
  | "adjustments"
  | "pending"
  | "balances"
  | "annual"
  | "versions";

const tabs: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: "overview", label: "Visão Geral" },
  { id: "memory", label: "Memória de Cálculo" },
  { id: "adjustments", label: "Ajustes Fiscais" },
  { id: "pending", label: "Pendências" },
  { id: "balances", label: "Saldos e Créditos" },
  { id: "annual", label: "Apuração do Exercício" },
  { id: "versions", label: "Versões e Dossiê" },
];

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const statusLabels: Record<string, string> = {
  DRAFT: "Rascunho",
  CALCULATED: "Calculado",
  CALCULATED_WITH_PENDING_ITEMS: "Calculado com pendências",
  REVIEWED: "Revisado",
  CLOSED_CURRENT: "Fechado vigente",
  CLOSED_SUPERSEDED: "Fechado substituído",
  OPEN: "Aberta",
  RESOLVED: "Resolvida",
};

const adjustmentLabels: Record<string, string> = {
  ADDITION: "Adição",
  EXCLUSION: "Exclusão",
};

const treatmentOptions = [
  ["NO_ADJUSTMENT", "Sem ajuste"],
  ["ADDITION", "Adição"],
  ["EXCLUSION", "Exclusão"],
  ["CONDITIONAL", "Condicional"],
  ["AUTOMATIC_SPECIAL", "Especial automática"],
] as const;

const conditionalOptions = [
  ["ADDITION", "Adição"],
  ["EXCLUSION", "Exclusão"],
  ["NO_ADJUSTMENT", "Sem ajuste"],
] as const;
const treatmentSelectOptions = [["", "Selecione o tratamento"], ...treatmentOptions] as const;
const conditionalSelectOptions = [["", "Selecione o tratamento"], ...conditionalOptions] as const;
type TaxMemoryMoneyKey =
  | "accountingResultYtd"
  | "totalAdditions"
  | "totalExclusions"
  | "baseBeforeCompensation"
  | "availableFiscalBalance"
  | "maxCompensation"
  | "compensationUsed"
  | "taxableBase"
  | "normalTax"
  | "additionalTax"
  | "taxDueCumulative"
  | "priorEstimateTaxDue"
  | "currentMonthTaxPayable";

type MemoryLine = {
  readonly label: string;
  readonly key?: TaxMemoryMoneyKey;
  readonly creditNature?: string;
  readonly tone?: "section-total" | "ded" | "total";
  readonly breakdown?: { readonly tax: "IRPJ" | "CSLL"; readonly adjustmentType: "ADDITION" | "EXCLUSION" };
};

const irpjMemoryRows: readonly MemoryLine[] = [
  { key: "accountingResultYtd", label: "Resultado contábil antes do IRPJ" },
  { key: "totalAdditions", label: "(+) Adições IRPJ", tone: "section-total", breakdown: { tax: "IRPJ", adjustmentType: "ADDITION" } },
  { key: "totalExclusions", label: "(-) Exclusões IRPJ", tone: "section-total", breakdown: { tax: "IRPJ", adjustmentType: "EXCLUSION" } },
  { key: "baseBeforeCompensation", label: "Lucro Real antes da compensação", tone: "total" },
  { key: "compensationUsed", label: "(-) Prejuízo Fiscal utilizado", tone: "ded" },
  { key: "taxableBase", label: "Base após compensação", tone: "section-total" },
  { key: "normalTax", label: "IRPJ 15%" },
  { key: "additionalTax", label: "Adicional IRPJ" },
  { key: "taxDueCumulative", label: "IRPJ acumulado", tone: "section-total" },
  { key: "priorEstimateTaxDue", label: "Estimativas anteriores", tone: "ded" },
  { creditNature: "IRRF_SERVICOS", label: "(-) IRRF – Serviços", tone: "ded" },
  { creditNature: "IRRF_APLICACOES_FINANCEIRAS", label: "(-) IRRF – Aplicações Financeiras", tone: "ded" },
  { key: "currentMonthTaxPayable", label: "IRPJ a recolher no mês", tone: "total" },
];

const csllMemoryRows: readonly MemoryLine[] = [
  { key: "accountingResultYtd", label: "Resultado contábil antes da CSLL" },
  { key: "totalAdditions", label: "(+) Adições CSLL", tone: "section-total", breakdown: { tax: "CSLL", adjustmentType: "ADDITION" } },
  { key: "totalExclusions", label: "(-) Exclusões CSLL", tone: "section-total", breakdown: { tax: "CSLL", adjustmentType: "EXCLUSION" } },
  { key: "baseBeforeCompensation", label: "Base CSLL antes da compensação", tone: "total" },
  { key: "compensationUsed", label: "(-) Base Negativa utilizada", tone: "ded" },
  { key: "taxableBase", label: "Base após compensação", tone: "section-total" },
  { key: "normalTax", label: "CSLL 9%" },
  { key: "taxDueCumulative", label: "CSLL acumulada", tone: "section-total" },
  { key: "priorEstimateTaxDue", label: "Estimativas anteriores", tone: "ded" },
  { creditNature: "CSLL_EXPLICIT_DEDUCTION", label: "(-) CSLL Retida", tone: "ded" },
  { key: "currentMonthTaxPayable", label: "CSLL a recolher no mês", tone: "total" },
];
const annualMonths = [
  { index: 1, label: "Jan/2026" },
  { index: 2, label: "Fev/2026" },
  { index: 3, label: "Mar/2026" },
  { index: 4, label: "Abr/2026" },
  { index: 5, label: "Mai/2026" },
  { index: 6, label: "Jun/2026" },
  { index: 7, label: "Jul/2026" },
  { index: 8, label: "Ago/2026" },
  { index: 9, label: "Set/2026" },
  { index: 10, label: "Out/2026" },
  { index: 11, label: "Nov/2026" },
  { index: 12, label: "Dez/2026" },
] as const;

const irpjAnnualRows: readonly MemoryLine[] = [
  { key: "accountingResultYtd", label: "Resultado contábil antes do IRPJ", tone: "section-total" },
  { key: "totalAdditions", label: "(+) Adições IRPJ", tone: "section-total", breakdown: { tax: "IRPJ", adjustmentType: "ADDITION" } },
  { key: "totalExclusions", label: "(-) Exclusões IRPJ", tone: "section-total", breakdown: { tax: "IRPJ", adjustmentType: "EXCLUSION" } },
  { key: "baseBeforeCompensation", label: "Lucro Real antes da compensação", tone: "section-total" },
  { key: "compensationUsed", label: "(-) Prejuízo Fiscal utilizado", tone: "ded" },
  { key: "taxableBase", label: "Base tributável após compensação", tone: "section-total" },
  { key: "normalTax", label: "IRPJ 15%" },
  { key: "additionalTax", label: "Adicional IRPJ" },
  { key: "taxDueCumulative", label: "IRPJ acumulado", tone: "section-total" },
  { key: "priorEstimateTaxDue", label: "(-) Estimativas devidas em meses anteriores", tone: "ded" },
  { creditNature: "IRRF_SERVICOS", label: "(-) IRRF – Serviços", tone: "ded" },
  { creditNature: "IRRF_APLICACOES_FINANCEIRAS", label: "(-) IRRF – Aplicações Financeiras", tone: "ded" },
  { key: "currentMonthTaxPayable", label: "IRPJ a recolher no mês", tone: "total" },
];

const csllAnnualRows: readonly MemoryLine[] = [
  { key: "accountingResultYtd", label: "Resultado contábil antes da CSLL", tone: "section-total" },
  { key: "totalAdditions", label: "(+) Adições CSLL", tone: "section-total", breakdown: { tax: "CSLL", adjustmentType: "ADDITION" } },
  { key: "totalExclusions", label: "(-) Exclusões CSLL", tone: "section-total", breakdown: { tax: "CSLL", adjustmentType: "EXCLUSION" } },
  { key: "baseBeforeCompensation", label: "Base CSLL antes da compensação", tone: "section-total" },
  { key: "compensationUsed", label: "(-) Base Negativa utilizada", tone: "ded" },
  { key: "taxableBase", label: "Base tributável CSLL", tone: "section-total" },
  { key: "normalTax", label: "CSLL 9%" },
  { key: "taxDueCumulative", label: "CSLL acumulada", tone: "section-total" },
  { key: "priorEstimateTaxDue", label: "(-) Estimativas devidas em meses anteriores", tone: "ded" },
  { creditNature: "CSLL_EXPLICIT_DEDUCTION", label: "(-) CSLL Retida", tone: "ded" },
  { key: "currentMonthTaxPayable", label: "CSLL a recolher no mês", tone: "total" },
];
function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textFrom(value: unknown, fallback = "-") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function originString(item: PendingItem, key: string) {
  const value = item.originData[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function money(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) ? moneyFormatter.format(numeric) : "-";
}

function numericMoney(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}

function versionLabel(version: number | null | undefined) {
  return version ? `V${String(version).padStart(2, "0")}` : "-";
}

function calculationVersionLabel(calculation: TaxCalculation | null) {
  return calculation ? versionLabel(calculation.calculationVersion) : "-";
}

function competenceLabel(value: string) {
  const month = annualMonths.find((item) => item.index === Number(value.slice(5, 7)))?.label.split("/")[0] ?? value.slice(5, 7);
  return `${month}/${value.slice(0, 4)}`;
}

function competenceMonthName(value: string) {
  const label = annualMonths.find((item) => item.index === Number(value.slice(5, 7)))?.label.split("/")[0] ?? value.slice(5, 7);
  return label.toLowerCase();
}

function periodMonth(period: WorkflowTaxPeriod) {
  const match = period.periodCode.match(/M(\d{2})$/);
  return match ? Number(match[1]) : Number(period.endDate.slice(5, 7));
}

function operationalEngineLabel(code: string | null | undefined) {
  if (code === "ANNUAL_MONTHLY") return "Lucro Real Anual";
  if (code === "ENGINE_NOT_ENABLED_FOR_REGIME") return "Motor não habilitado";
  return code ? statusLabel(code) : "-";
}

function statusTone(value: string | null | undefined) {
  if (value === "CLOSED_CURRENT" || value === "RESOLVED" || value === "CALCULATED" || value === "REVIEWED") return "ok";
  if (value === "CLOSED_SUPERSEDED") return "neutral";
  if (value === "OPEN" || value === "DRAFT" || value === "CALCULATED_WITH_PENDING_ITEMS") return "warn";
  return "";
}

function treatmentLabel(value: string | null | undefined) {
  if (value === "ADDITION") return "ADIÇÃO";
  if (value === "EXCLUSION") return "EXCLUSÃO";
  if (value === "NO_ADJUSTMENT") return "SEM AJUSTE";
  if (value === "CONDITIONAL") return "CONDICIONAL";
  return value ? statusLabel(value).toUpperCase() : "-";
}

function treatmentTag(value: string | null | undefined) {
  if (value === "ADDITION") return "add";
  if (value === "EXCLUSION") return "exc";
  if (value === "CONDITIONAL") return "cond";
  return "neutral";
}

function originLabel(value: string | null | undefined) {
  if (value === "RULE_EXECUTION_RESULT") return "Matriz Fiscal aplicada";
  if (value === "SOURCE_SNAPSHOT") return "Snapshot fonte";
  if (value === "REQUEST_BODY") return "Decisão fiscal registrada";
  return value ? statusLabel(value) : "-";
}

function balanceLabel(value: string | null | undefined) {
  if (value === "PREJUIZO_FISCAL") return "Prejuízo Fiscal — IRPJ";
  if (value === "BASE_NEGATIVA_CSLL") return "Base Negativa — CSLL";
  return value ? statusLabel(value) : "-";
}

function creditLabel(value: string | null | undefined) {
  if (value === "IRRF_SERVICOS") return "IRRF – Serviços";
  if (value === "IRRF_APLICACOES_FINANCEIRAS") return "IRRF – Aplicações Financeiras";
  if (value === "CSLL_EXPLICIT_DEDUCTION") return "CSLL Retida";
  return value ? statusLabel(value) : "-";
}

function zeroBreakdownLabel(type: "ADDITION" | "EXCLUSION") {
  return type === "ADDITION" ? "Nenhuma adição no período" : "Nenhuma exclusão no período";
}

function readableUser(value: string | null | undefined, currentUserId: string, currentUserEmail: string) {
  const text = textFrom(value, "");
  if (!text) return currentUserEmail || "-";
  if (text === currentUserId || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    return currentUserEmail || text;
  }
  return text;
}

function matrixVersionLabel(value: string | null | undefined) {
  const text = textFrom(value, "");
  const match = text.match(/V(\d+)$/i) ?? text.match(/(\d+)$/);
  return match ? `V${Number(match[1])}` : statusLabel(text);
}

function companyDisplayName(code: string, name: string) {
  const normalizedCode = textFrom(code, "");
  const text = textFrom(name, "");
  for (const separator of [" — ", " - "]) {
    const prefix = `${normalizedCode}${separator}`;
    if (normalizedCode && text.startsWith(prefix)) return text.slice(prefix.length);
  }
  return text;
}

function operationalPendingDescription(item: PendingItem) {
  if (item.type === "NEW_ACCOUNT_UNMAPPED") {
    return "Conta movimentada sem mapeamento fiscal vigente. Necessária classificação pelo responsável.";
  }
  if (item.type === "CONDITIONAL_TAX_DECISION") return "Ocorrência condicional aguardando decisão fiscal.";
  return item.description.replace(/\bL[1-4](?:\/L[1-4])?\b/g, "").trim() || item.description;
}

function adjustmentSupportLabel(result: RuleExecutionResult | null | undefined) {
  if (requiresLaunchComposition(result)) return null;
  return "—";
}

function sourceString(value: JsonRecord | undefined, key: string) {
  const item = value?.[key];
  return item === null || item === undefined ? "" : String(item).trim();
}

function creditDocumentLabel(row: TaxCreditUsage) {
  const keys = ["documentNumber", "documento", "document", "notaFiscal", "invoice", "sourceDocument", "lancamentoId"];
  for (const key of keys) {
    const value = sourceString(row.source, key);
    if (value) return value;
  }
  return "";
}

function comparisonNatureLabel(value: string) {
  if (value === "VALUE_CHANGED") return "Valor alterado";
  if (value === "UNCHANGED") return "Sem alteração";
  if (value === "ADDED") return "Adicionado";
  if (value === "REMOVED") return "Removido";
  return statusLabel(value);
}

function comparisonCauseLabel(value: string) {
  if (value === "SNAPSHOT_CHANGED") return "Snapshot alterado";
  if (value === "MATRIX_CHANGED") return "Matriz alterada";
  if (value === "RULE_CHANGED") return "Regra alterada";
  if (value === "HUMAN_DECISION_CHANGED") return "Decisão fiscal alterada";
  if (value === "CREDIT_CHANGED") return "Crédito alterado";
  if (value === "FISCAL_BALANCE_CHANGED") return "PF/BN alterado";
  if (value === "UNKNOWN_CAUSE") return "Causa não identificada";
  return statusLabel(value);
}

function isDossierComparison(value: unknown): value is DossierComparison {
  return isRecord(value) && typeof value.previousVersion === "string" && typeof value.currentVersion === "string" && Array.isArray(value.rows);
}

function creditUsed(memory: TaxMemory, nature: string) {
  return memory.creditUsages
    .filter((usage) => usage.nature === nature)
    .reduce((total, usage) => total + numericMoney(usage.used), 0);
}

function memoryLineValue(memory: TaxMemory, line: MemoryLine) {
  if (line.creditNature) return money(creditUsed(memory, line.creditNature));
  return line.key ? money(memory[line.key]) : "-";
}

function memoryLineNumeric(memory: TaxMemory, line: MemoryLine) {
  if (line.creditNature) return creditUsed(memory, line.creditNature);
  return line.key ? numericMoney(memory[line.key]) : 0;
}

function splitAccountLabel(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  const [code, ...descriptionParts] = text.split(" — ");
  return {
    code: code.trim() || "-",
    description: descriptionParts.join(" — ").trim(),
  };
}

function accountCodeOnly(value: string | null | undefined) {
  return splitAccountLabel(value).code;
}

function accountDescriptionFrom(value: string | null | undefined, fallback = "-") {
  return splitAccountLabel(value).description || fallback;
}

function adjustmentDescription(adjustment: TaxAdjustment, result: RuleExecutionResult | null | undefined) {
  return result?.accountDescription || accountDescriptionFrom(adjustment.accountCode, adjustment.accountCode);
}

function adjustmentBaseLabel(result: RuleExecutionResult | null | undefined) {
  if (result?.executionMethod === "FULL_ACCOUNT") return "Saldo integral da conta";
  if (result?.executionMethod === "TRANSACTION_FILTER") return "Lançamentos específicos";
  return "Regra/controle fiscal";
}

function requiresLaunchComposition(result: RuleExecutionResult | null | undefined) {
  return result?.executionMethod === "TRANSACTION_FILTER";
}

type AdjustmentGroup = {
  readonly key: string;
  readonly primary: TaxAdjustment;
  readonly result: RuleExecutionResult | null;
  readonly treatments: readonly { readonly tax: string; readonly adjustmentType: string }[];
};

function resultForAdjustment(adjustment: TaxAdjustment, results: readonly RuleExecutionResult[]) {
  return results.find((result) => result.id === adjustment.ruleExecutionResultId)
    ?? results.find((result) => result.accountCode === adjustment.accountCode && result.fiscalRuleId === adjustment.fiscalRuleId)
    ?? null;
}
function adjustmentGroupKey(adjustment: TaxAdjustment, result: RuleExecutionResult | null) {
  return [
    adjustment.accountCode,
    adjustment.fiscalRuleId,
    adjustment.fiscalRuleVersion,
    adjustment.adjustmentType,
    adjustment.value,
    result?.rawAccountingValue ?? adjustment.value,
    adjustmentBaseLabel(result),
  ].join("|");
}
function groupAdjustmentRows(rows: readonly TaxAdjustment[], results: readonly RuleExecutionResult[]): AdjustmentGroup[] {
  const groups = new Map<string, { key: string; primary: TaxAdjustment; result: RuleExecutionResult | null; treatments: { tax: string; adjustmentType: string }[] }>();
  for (const item of rows) {
    const result = resultForAdjustment(item, results);
    const key = adjustmentGroupKey(item, result);
    const treatment = { tax: item.tax, adjustmentType: item.adjustmentType };
    const existing = groups.get(key);
    if (existing) {
      if (!existing.treatments.some((entry) => entry.tax === treatment.tax && entry.adjustmentType === treatment.adjustmentType)) existing.treatments.push(treatment);
      continue;
    }
    groups.set(key, { key, primary: item, result, treatments: [treatment] });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    treatments: group.treatments.sort((left, right) => (left.tax === "IRPJ" ? -1 : right.tax === "IRPJ" ? 1 : left.tax.localeCompare(right.tax))),
  }));
}

function operationalSourceLabel(value: string | null | undefined) {
  if (value === "TOTVS_BALANCETE_CANONICAL") return "Balancete TOTVS";
  if (!value) return "Snapshot persistido";
  return statusLabel(value);
}

function yesNo(value: unknown) {
  return value === true || value === "true" || value === "S" ? "Sim" : "Não";
}

function signedMoney(value: number) {
  return value < 0 ? `(${money(Math.abs(value))})` : money(value);
}

function pendingAccountCode(item: PendingItem) {
  return originString(item, "accountCode") || item.logicalKey.split(":").at(-1) || "-";
}

function pendingReducedCode(item: PendingItem) {
  return originString(item, "reducedCode");
}

function pendingDescription(item: PendingItem) {
  return originString(item, "description") || originString(item, "accountDescription") || item.description.replace(/^.*?:\s*/, "");
}

function pendingAmount(item: PendingItem) {
  return originString(item, "amount") || originString(item, "movement") || originString(item, "debit") || originString(item, "calculatedValue") || originString(item, "rawAccountingValue");
}

function defaultFiscalCode(item: PendingItem, prefix: string) {
  const reduced = pendingReducedCode(item) || pendingAccountCode(item).replace(/\D/g, "");
  return `${prefix}_${reduced || "CONTA_NOVA"}`;
}

function hiddenPayloadField(name: string, value: string | number | null | undefined) {
  return <input key={name} type="hidden" name={name} value={value === null || value === undefined ? "" : String(value)} />;
}
function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

function shortHash(value: string | null | undefined) {
  return value ? `${value.slice(0, 12)}...` : "-";
}

function statusLabel(value: string | null | undefined) {
  return value ? statusLabels[value] ?? value : "-";
}

function snapshotParameter(snapshot: SourceSnapshot | null, key: string) {
  return snapshot ? textFrom(snapshot.parameters[key]) : "-";
}

function payloadFromForm(form: HTMLFormElement) {
  const payload: Record<string, unknown> = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === "string") payload[key] = value;
  });
  return payload;
}

function currentCalculationForPeriod(period: WorkflowTaxPeriod, calculations: readonly TaxCalculation[]) {
  return calculations
    .filter((calculation) => calculation.taxPeriodId === period.id && calculation.versionStatus !== "CLOSED_SUPERSEDED")
    .sort((left, right) => {
      if (left.versionStatus === "CLOSED_CURRENT" && right.versionStatus !== "CLOSED_CURRENT") return -1;
      if (right.versionStatus === "CLOSED_CURRENT" && left.versionStatus !== "CLOSED_CURRENT") return 1;
      return right.calculationVersion - left.calculationVersion || right.createdAt.localeCompare(left.createdAt);
    })[0] ?? null;
}

function isOfficialClosedPeriod(period: WorkflowTaxPeriod) {
  return period.status === "CLOSED_CURRENT" || period.status === "CLOSED_SUPERSEDED";
}

function dossierForPeriod(period: WorkflowTaxPeriod, dossiers: readonly TaxDossier[]) {
  return dossiers
    .filter((dossier) => dossier.taxPeriodId === period.id)
    .sort((left, right) => {
      if (left.status === "AVAILABLE" && right.status !== "AVAILABLE") return -1;
      if (right.status === "AVAILABLE" && left.status !== "AVAILABLE") return 1;
      return right.generatedAt.localeCompare(left.generatedAt);
    })[0] ?? null;
}

function artifactForDossier(dossier: TaxDossier | null, type: string) {
  return dossier?.artifactMetadata.find((artifact) => artifact.type === type) ?? null;
}
function hiddenOriginField(item: PendingItem, name: string) {
  return <input key={name} type="hidden" name={name} value={originString(item, name)} />;
}
function commonHiddenFieldsFor(item: PendingItem) {
  return ["accountingChartId", "accountCode", "reducedCode"].map((name) => hiddenOriginField(item, name));
}

export default function IrpjCsllAssessment({
  companyId,
  companyCode,
  companyName,
  competence,
  accessToken,
  canWrite,
  userId,
  userEmail,
}: IrpjCsllAssessmentProps) {
  const [dashboard, setDashboard] = useState<IrpjCsllDashboard | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manifestPreview, setManifestPreview] = useState<string | null>(null);
  const [comparisonPreview, setComparisonPreview] = useState<string | null>(null);
  const [comparisonView, setComparisonView] = useState<DossierComparison | null>(null);
  const [selectedPendingId, setSelectedPendingId] = useState<string | null>(null);
  const [selectedAdjustmentId, setSelectedAdjustmentId] = useState<string | null>(null);
  const [selectedBalanceId, setSelectedBalanceId] = useState<string | null>(null);
  const [selectedAutoCorrectionId, setSelectedAutoCorrectionId] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ companyId, company: companyCode, competence });
    return params.toString();
  }, [companyCode, companyId, competence]);

  const requestHeaders = useMemo(() => ({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }), [accessToken]);

  const load = useCallback(async () => {
    if (!companyId || !accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/irpj-csll?${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json() as unknown;
      if (!response.ok || !isRecord(payload) || payload.ok !== true) {
        throw new Error(isRecord(payload) ? textFrom(payload.message, "Falha ao carregar IRPJ/CSLL.") : "Falha ao carregar IRPJ/CSLL.");
      }
      setDashboard(payload as IrpjCsllDashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar IRPJ/CSLL.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, companyId, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const runCommand = useCallback(async (path: string, payload: Record<string, unknown> = {}, successMessage: string) => {
    setBusyAction(path);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/irpj-csll/${path}?${query}`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
      });
      const body = await response.json() as unknown;
      if (!response.ok || !isRecord(body) || body.ok !== true) {
        throw new Error(isRecord(body) ? textFrom(body.message, "Ação fiscal não concluída.") : "Ação fiscal não concluída.");
      }
      setDashboard(body as IrpjCsllDashboard);
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ação fiscal não concluída.");
    } finally {
      setBusyAction(null);
    }
  }, [query, requestHeaders]);

  const submitPendingAction = useCallback(async (
    event: FormEvent<HTMLFormElement>,
    pendingId: string,
    action: "classify" | "resolve-conditional" | "correct-auto",
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    await runCommand(
      `pending/${pendingId}/${action}`,
      payloadFromForm(form),
      action === "classify" ? "Classificação fiscal registrada." : action === "correct-auto" ? "Classificação automática corrigida." : "Decisão condicional registrada.",
    );
    form.reset();
  }, [runCommand]);

  const confirmAutomaticClassification = useCallback(async (pendingId: string) => {
    await runCommand(`pending/${pendingId}/confirm-auto`, {}, "Classificação automática confirmada.");
  }, [runCommand]);


  const runDossierGenerate = useCallback(async (taxPeriodId: string) => {
    setBusyAction(`dossier:generate:${taxPeriodId}`);
    setError(null);
    setNotice(null);
    setManifestPreview(null);
    setComparisonPreview(null);
    setComparisonView(null);
    try {
      const response = await fetch(`/api/irpj-csll/dossier/generate?${query}`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ taxPeriodId }),
      });
      const body = await response.json() as unknown;
      if (!response.ok || !isRecord(body) || body.ok !== true) {
        throw new Error(isRecord(body) ? textFrom(body.message, "Dossiê mensal não gerado.") : "Dossiê mensal não gerado.");
      }
      await load();
      setNotice(textFrom((body as JsonRecord).status) === "DOSSIER_ALREADY_EXISTS" ? "Dossiê mensal já estava íntegro." : "Dossiê mensal gerado e armazenado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dossiê mensal não gerado.");
    } finally {
      setBusyAction(null);
    }
  }, [load, query, requestHeaders]);

  const downloadDossierArtifact = useCallback(async (dossierId: string, artifact: "xlsx" | "pdf") => {
    setBusyAction(`dossier:download:${dossierId}:${artifact}`);
    setError(null);
    try {
      const params = new URLSearchParams(query);
      params.set("dossierId", dossierId);
      params.set("artifact", artifact);
      const response = await fetch(`/api/irpj-csll/dossier/artifact?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as unknown;
        throw new Error(isRecord(body) ? textFrom(body.message, "Download do dossiê não autorizado.") : "Download do dossiê não autorizado.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${dossierId}-${artifact}.bin`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice("Artefato do dossiê baixado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download do dossiê não autorizado.");
    } finally {
      setBusyAction(null);
    }
  }, [accessToken, query]);

  const viewDossierManifest = useCallback(async (dossierId: string) => {
    setBusyAction(`dossier:manifest:${dossierId}`);
    setError(null);
    try {
      const params = new URLSearchParams(query);
      params.set("dossierId", dossierId);
      const response = await fetch(`/api/irpj-csll/dossier/manifest?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await response.json() as unknown;
      if (!response.ok || !isRecord(body) || body.ok !== true) {
        throw new Error(isRecord(body) ? textFrom(body.message, "Manifest não disponível.") : "Manifest não disponível.");
      }
      setComparisonPreview(null);
      setComparisonView(null);
      setManifestPreview(JSON.stringify(body.manifest ?? body, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manifest não disponível.");
    } finally {
      setBusyAction(null);
    }
  }, [accessToken, query]);

  const viewDossierComparison = useCallback(async (dossierId: string) => {
    setBusyAction(`dossier:compare:${dossierId}`);
    setError(null);
    try {
      const params = new URLSearchParams(query);
      params.set("dossierId", dossierId);
      const response = await fetch(`/api/irpj-csll/dossier/compare?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await response.json() as unknown;
      if (!response.ok || !isRecord(body) || body.ok !== true) {
        throw new Error(isRecord(body) ? textFrom(body.message, "Comparativo não disponível.") : "Comparativo não disponível.");
      }
      setManifestPreview(null);
      setComparisonPreview(JSON.stringify(body.comparison ?? { message: "Comparativo V01/V02 não aplicável para esta versão." }, null, 2));
      setComparisonView(isDossierComparison(body.comparison) ? body.comparison : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparativo não disponível.");
    } finally {
      setBusyAction(null);
    }
  }, [accessToken, query]);
  const writeAllowed = Boolean(canWrite && dashboard?.canWrite);
  const taxPeriod = dashboard?.taxPeriod ?? null;
  const calculation = dashboard?.taxCalculation ?? null;
  const sourceSnapshot = dashboard?.sourceSnapshot ?? null;
  const isClosedPeriod = taxPeriod?.status === "CLOSED_CURRENT" || taxPeriod?.status === "CLOSED_SUPERSEDED";
  const canRunEngine = writeAllowed && dashboard?.engine.code === "ANNUAL_MONTHLY" && Boolean(taxPeriod && sourceSnapshot) && !isClosedPeriod;
  const adjustmentRows = dashboard?.taxAdjustments.filter((item) => item.status !== "SUPERSEDED") ?? [];
  const openPending = dashboard?.pendingItems.filter((item) => item.status === "OPEN") ?? [];
  const automaticClassificationItems = dashboard?.pendingItems.filter((item) => item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED") ?? [];
  const autoPending = automaticClassificationItems.filter((item) => item.status === "OPEN");
  const confirmedAuto = automaticClassificationItems.filter((item) => item.status !== "OPEN");
  const blockingPending = openPending.filter((item) => item.type !== "NEW_ACCOUNT_AUTO_CLASSIFIED" && item.blocking);
  const newAccountOccurrences = (dashboard?.pendingItems.filter((item) => item.type === "NEW_ACCOUNT_UNMAPPED" || item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED").length ?? 0);
  const waitingClassification = openPending.filter((item) => item.type === "NEW_ACCOUNT_UNMAPPED").length;
  const conditionalOccurrences = (dashboard?.pendingItems.filter((item) => item.type === "CONDITIONAL_TAX_DECISION").length ?? 0);
  const closeIssues = isClosedPeriod ? [] : dashboard?.closeIssues ?? [];
  const closeGatePendingCount = blockingPending.length + autoPending.length;
  const closeReady = Boolean(dashboard?.closeAllowed && !isClosedPeriod);
  const closeStatusText = taxPeriod?.status === "CLOSED_CURRENT" ? "Fechado vigente" : taxPeriod?.status === "CLOSED_SUPERSEDED" ? "Fechado substituído" : closeReady ? "pronto para fechar" : `${closeIssues.length} pendência(s)`;
  const periodRows = (dashboard?.allYearPeriods ?? [])
    .filter((period) => period.periodType === "MONTHLY_ESTIMATE" || period.periodType === "ANNUAL_ADJUSTMENT" || period.periodType === "QUARTERLY_REAL")
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.periodCode.localeCompare(right.periodCode));
  const fiscalYear = dashboard?.fiscalYearProfile?.fiscalYear ?? Number(competence.slice(0, 4));
  const selectedPending = selectedPendingId ? blockingPending.find((item) => item.id === selectedPendingId) ?? blockingPending[0] ?? null : blockingPending[0] ?? null;
  const groupedAdjustmentRows = groupAdjustmentRows(adjustmentRows, dashboard?.ruleExecutionResults ?? []);
  const selectedAdjustment = selectedAdjustmentId ? adjustmentRows.find((item) => item.id === selectedAdjustmentId) ?? null : null;
  const selectedAdjustmentResult = selectedAdjustment
    ? dashboard?.ruleExecutionResults.find((result) => result.accountCode === selectedAdjustment.accountCode && result.fiscalRuleId === selectedAdjustment.fiscalRuleId) ?? null
    : null;
  const periodVersions = [...(dashboard?.periodVersions ?? [])].sort((left, right) => left.version - right.version);
  const officialVersion = periodVersions.find((period) => period.status === "CLOSED_CURRENT") ?? periodVersions.at(-1) ?? null;
  const supersededVersion = periodVersions.find((period) => period.status === "CLOSED_SUPERSEDED") ?? periodVersions.find((period) => officialVersion && period.id !== officialVersion.id) ?? null;
  const officialCalculation = officialVersion ? currentCalculationForPeriod(officialVersion, dashboard?.taxCalculations ?? []) : calculation;
  const supersededCalculation = supersededVersion ? currentCalculationForPeriod(supersededVersion, dashboard?.taxCalculations ?? []) : null;
  const versionImpact = officialCalculation && supersededCalculation
    ? numericMoney(officialCalculation.irpj.currentMonthTaxPayable) + numericMoney(officialCalculation.csll.currentMonthTaxPayable) - numericMoney(supersededCalculation.irpj.currentMonthTaxPayable) - numericMoney(supersededCalculation.csll.currentMonthTaxPayable)
    : null;
  const nextVersionLabel = versionLabel((taxPeriod?.version ?? periodVersions.at(-1)?.version ?? 1) + 1);
  const materializedPeriod = officialVersion ?? taxPeriod;
  const materializedDossier = materializedPeriod ? dossierForPeriod(materializedPeriod, dashboard?.dossiers ?? []) : null;
  const materializedXlsx = artifactForDossier(materializedDossier, "XLSX");
  const materializedPdf = artifactForDossier(materializedDossier, "PDF");
  const materializedManifest = artifactForDossier(materializedDossier, "MANIFEST_JSON");
  const materializedComparison = artifactForDossier(materializedDossier, "COMPARISON_JSON");
  const monthlyCalculations = new Map<number, TaxCalculation>();
  for (const period of periodRows.filter((item) => item.periodType === "MONTHLY_ESTIMATE")) {
    const periodCalculation = currentCalculationForPeriod(period, dashboard?.taxCalculations ?? []);
    if (periodCalculation) monthlyCalculations.set(periodMonth(period), periodCalculation);
  }
  const fiscalBalanceRows = calculation?.fiscalBalanceUsages ?? [];
  const creditUsageRows = calculation?.creditUsages ?? [];
  const creditFamilies = ["IRRF_SERVICOS", "IRRF_APLICACOES_FINANCEIRAS", "CSLL_EXPLICIT_DEDUCTION"] as const;
  const creditBalanceRows = creditFamilies.map((nature) => {
    const rows = creditUsageRows.filter((item) => item.nature === nature);
    return {
      id: nature,
      tax: nature === "CSLL_EXPLICIT_DEDUCTION" ? "CSLL" : "IRPJ",
      label: creditLabel(nature),
      available: rows.reduce((total, item) => total + numericMoney(item.available), 0),
      used: rows.reduce((total, item) => total + numericMoney(item.used), 0),
      remaining: rows.reduce((total, item) => total + numericMoney(item.remaining), 0),
      detail: rows.map((item) => item.label || item.creditId).join(" · ") || "Sem utilização na competência",
      rows,
    };
  });
  const balanceCompositionItems = [
    ...fiscalBalanceRows.map((item) => ({
      id: `balance:${item.id}`,
      label: balanceLabel(item.balanceType),
      tax: item.tax,
      compositionLabel: "Ano/período de origem",
      emptyMessage: "Composição não disponível no cenário atual.",
      rows: [{ period: item.originYear ? String(item.originYear) : fiscalYear ? String(fiscalYear) : "Período não informado", available: item.available, used: item.used, remaining: item.remaining }],
    })),
    ...creditBalanceRows.map((item) => ({
      id: `credit:${item.id}`,
      label: item.label,
      tax: item.tax,
      compositionLabel: "Origem documental",
      emptyMessage: "Composição não disponível no cenário atual.",
      rows: item.rows
        .map((row) => ({ period: creditDocumentLabel(row), available: row.available, used: row.used, remaining: row.remaining }))
        .filter((row) => row.period),
    })),
  ];
  const selectedBalance = selectedBalanceId ? balanceCompositionItems.find((item) => item.id === selectedBalanceId) ?? null : null;
  const selectedAutoCorrection = selectedAutoCorrectionId ? autoPending.find((item) => item.id === selectedAutoCorrectionId) ?? null : null;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!blockingPending.length && selectedPendingId) {
        setSelectedPendingId(null);
        return;
      }
      if (blockingPending.length && (!selectedPendingId || !blockingPending.some((item) => item.id === selectedPendingId))) {
        setSelectedPendingId(blockingPending[0].id);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [blockingPending, selectedPendingId]);

  function ruleResultForAdjustment(adjustment: TaxAdjustment) {
    return dashboard?.ruleExecutionResults.find((result) => result.accountCode === adjustment.accountCode && result.fiscalRuleId === adjustment.fiscalRuleId) ?? null;
  }

  function adjustmentsForBreakdown(tax: "IRPJ" | "CSLL", adjustmentType: "ADDITION" | "EXCLUSION") {
    return adjustmentRows.filter((item) => item.tax === tax && item.adjustmentType === adjustmentType);
  }

  function renderAdjustmentBreakdown(line: MemoryLine, memory: TaxMemory) {
    if (!line.breakdown) return null;
    const rows = adjustmentsForBreakdown(line.breakdown.tax, line.breakdown.adjustmentType);
    if (!rows.length) {
      if (memoryLineNumeric(memory, line) !== 0) return null;
      return (
        <div className="memory-breakdown">
          <div className="memory-breakdown-row empty">
            <span>{zeroBreakdownLabel(line.breakdown.adjustmentType)}</span>
            <span className="num">—</span>
          </div>
        </div>
      );
    }
    return (
      <div className="memory-breakdown">
        {rows.map((item) => {
          const result = ruleResultForAdjustment(item);
          return (
            <div key={`${line.label}-${item.id}`} className="memory-breakdown-row">
              <span>{adjustmentDescription(item, result)}</span>
              <span className="num">{money(item.value)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function renderMemoryCard(tax: "IRPJ" | "CSLL", memory: TaxMemory, rows: readonly MemoryLine[]) {
    return (
      <article className="card">
        <div className="cardhead">
          <div>
            <h2>Memória de Cálculo — {tax}</h2>
            <p>Versão {calculationVersionLabel(calculation)}</p>
          </div>
          <span className="status ok">CÁLCULO ATUAL</span>
        </div>
        <div className="calc">
          {rows.map((line) => (
            <Fragment key={`${tax}-${line.label}`}>
              <div className={line.tone}>
                <span>{line.label}</span>
                <span className="num">{memoryLineValue(memory, line)}</span>
              </div>
              {renderAdjustmentBreakdown(line, memory)}
            </Fragment>
          ))}
        </div>
        <div className="irpj-subtable-title">Estimativas anteriores</div>
        <div className="table-scroll">
          <table className="data-table irpj-table compact">
            <thead>
              <tr><th>Período</th><th>Status</th><th className="num-head">Valor</th></tr>
            </thead>
            <tbody>
              {memory.priorEstimateReferences.map((reference) => (
                <tr key={`${reference.tax}-${reference.calculationId}`}>
                  <td>{reference.periodCode}</td>
                  <td>{statusLabel(reference.versionStatus)}</td>
                  <td className="num">{money(reference.currentMonthTaxPayable)}</td>
                </tr>
              ))}
              {memory.priorEstimateReferences.length === 0 && <tr><td colSpan={3}>Sem estimativas anteriores fechadas.</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    );
  }

  function renderAnnualTable(tax: "IRPJ" | "CSLL", title: string, rows: readonly MemoryLine[]) {
    const selectedMonth = taxPeriod ? periodMonth(taxPeriod) : null;
    return (
      <article className="card annual-card">
        <div className="annual-head">
          <div>
            <h2>{title}</h2>
            <p>Acompanhamento mensal e acumulado da apuração do exercício.</p>
          </div>
        </div>
        <div className="annual-scroll">
          <table className="annual-table">
            <thead>
              <tr>
                <th>Composição</th>
                {annualMonths.map((month) => <th key={month.index}>{month.label.replace("2026", String(fiscalYear))}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((line) => {
                const breakdownRows = line.breakdown ? adjustmentsForBreakdown(line.breakdown.tax, line.breakdown.adjustmentType) : [];
                const selectedMemory = selectedMonth ? monthlyCalculations.get(selectedMonth) : null;
                const emptyBreakdown = line.breakdown && selectedMemory && memoryLineNumeric(tax === "IRPJ" ? selectedMemory.irpj : selectedMemory.csll, line) === 0 && breakdownRows.length === 0;
                return (
                  <Fragment key={`${tax}-${line.label}`}>
                    <tr className={line.tone === "ded" ? "ded-row" : line.tone === "total" ? "final-row" : line.tone === "section-total" ? "section" : undefined}>
                      <td>{line.label}</td>
                      {annualMonths.map((month) => {
                        const monthCalculation = monthlyCalculations.get(month.index);
                        const memory = monthCalculation ? (tax === "IRPJ" ? monthCalculation.irpj : monthCalculation.csll) : null;
                        return memory
                          ? <td key={month.index} className="num">{memoryLineValue(memory, line)}</td>
                          : <td key={month.index} className="future">—</td>;
                      })}
                    </tr>
                    {breakdownRows.map((item) => {
                      const result = ruleResultForAdjustment(item);
                      return (
                        <tr key={`${tax}-${line.label}-${item.id}`} className="breakdown-row">
                          <td>{adjustmentDescription(item, result)}</td>
                          {annualMonths.map((month) => month.index === selectedMonth
                            ? <td key={month.index} className="num">{money(item.value)}</td>
                            : <td key={month.index} className="future">—</td>)}
                        </tr>
                      );
                    })}
                    {emptyBreakdown && line.breakdown && (
                      <tr className="breakdown-row empty">
                        <td>{zeroBreakdownLabel(line.breakdown.adjustmentType)}</td>
                        {annualMonths.map((month) => <td key={month.index} className="future">—</td>)}
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    );
  }
  function comparisonMetricsFor(tax: "IRPJ" | "CSLL") {
    if (!officialCalculation || !supersededCalculation) return [];
    const rows = tax === "IRPJ" ? irpjMemoryRows : csllMemoryRows;
    const previousMemory = tax === "IRPJ" ? supersededCalculation.irpj : supersededCalculation.csll;
    const currentMemory = tax === "IRPJ" ? officialCalculation.irpj : officialCalculation.csll;
    return rows.map((line) => {
      const previous = memoryLineNumeric(previousMemory, line);
      const current = memoryLineNumeric(currentMemory, line);
      return { tax, label: line.label, previous, current, difference: current - previous };
    });
  }

  function comparisonAdjustmentRows(tax: "IRPJ" | "CSLL", adjustmentType: "ADDITION" | "EXCLUSION") {
    return adjustmentsForBreakdown(tax, adjustmentType).map((item) => {
      const result = ruleResultForAdjustment(item);
      return {
        id: `${tax}-${adjustmentType}-${item.id}`,
        label: adjustmentDescription(item, result),
        previous: 0,
        current: numericMoney(item.value),
        difference: numericMoney(item.value),
      };
    });
  }
  function renderPendingDetail(item: PendingItem | null) {
    if (!item) return <div className="irpj-no-action">Nenhuma pendência bloqueante aberta.</div>;
    const accountCode = pendingAccountCode(item);
    const amount = pendingAmount(item);
    const description = pendingDescription(item);
    const commonHiddenFields = ["accountingChartId", "accountCode", "reducedCode"].map((name) => hiddenOriginField(item, name));

    if (item.type === "NEW_ACCOUNT_UNMAPPED") {
      return (
        <div className="irpj-detail-body">
          <div className="status warn">NOVA CONTA SEM CLASSIFICAÇÃO FISCAL</div>
          <h3>{accountCode} · {description}</h3>
          <div className="context-label">MOVIMENTAÇÃO ACUMULADA</div>
          <div className="entry-meta">
            <div className="m"><small>Grupo / conta pai</small><b>{originString(item, "parentAccount") || "Não informado"}</b></div>
            <div className="m"><small>Primeiro movimento</small><b>{formatDate(originString(item, "firstMovementDate"))}</b></div>
            <div className="m"><small>Movimento acumulado</small><b>{amount ? money(amount) : "Não informado"}</b></div>
          </div>
          <div className="history-box"><small>Leitura automática do motor</small><div>{operationalPendingDescription(item)}</div></div>
          <div className="context-label">AMOSTRA DOS LANÇAMENTOS</div>
          <div className="table-scroll">
            <table className="data-table irpj-table">
              <thead><tr><th>Data</th><th>Documento</th><th className="wrap">Histórico / Complemento</th><th className="num-head">Débito</th><th className="num-head">Crédito</th></tr></thead>
              <tbody>
                <tr><td colSpan={5}>Não disponível</td></tr>
              </tbody>
            </table>
          </div>
          <div className="notice"><b>Sugestão fiscal:</b> Sugestão fiscal não disponível. Confirme o tratamento fiscal e registre a justificativa.</div>
          <form className="decision-box" onSubmit={(event) => submitPendingAction(event, item.id, "classify")}>
            {commonHiddenFields}
            {hiddenPayloadField("fiscalNatureCode", defaultFiscalCode(item, "NATUREZA"))}
            {hiddenPayloadField("fiscalNatureName", `Classificação fiscal ${accountCode}`)}
            {hiddenPayloadField("fiscalRuleCode", defaultFiscalCode(item, "REGRA"))}
            <div className="context-label">Classificação fiscal da nova conta</div>
            <div className="decision-grid">
              <label><span>IRPJ</span><select name="irpjTreatment" defaultValue="" required>{treatmentSelectOptions.map(([value, label]) => <option key={value || "UNSELECTED"} value={value} disabled={!value}>{label}</option>)}</select></label>
              <label><span>CSLL</span><select name="csllTreatment" defaultValue="" required>{treatmentSelectOptions.map(([value, label]) => <option key={value || "UNSELECTED"} value={value} disabled={!value}>{label}</option>)}</select></label>
            </div>
            <label className="validity"><span>Vigência da classificação</span><select name="validFrom" defaultValue={competence}><option value={competence}>{competenceLabel(competence)} em diante</option></select></label>
            <label className="justification"><span>Justificativa da classificação</span><textarea name="justification" minLength={8} required placeholder="Registre objetivamente o fundamento da classificação fiscal..." /></label>
            <div className="footer-actions"><button className="btn primary" type="submit" disabled={!writeAllowed || Boolean(busyAction)}>Classificar conta</button></div>
            <details className="technical-details"><summary>Detalhes técnicos</summary><span>{item.logicalKey}</span></details>
          </form>
        </div>
      );
    }

    if (item.type === "CONDITIONAL_TAX_DECISION") {
      return (
        <div className="irpj-detail-body">
          <div className="status warn">PENDENTE DE DECISÃO FISCAL</div>
          <h3>{description} · {amount ? money(amount) : "Valor não informado"}</h3>
          <div className="entry-meta">
            <div className="m"><small>Lançamento</small><b>{originString(item, "entryId") || originString(item, "launchId") || "Não informado"}</b></div>
            <div className="m"><small>Documento</small><b>{originString(item, "document") || "Não informado"}</b></div>
            <div className="m"><small>Origem</small><b>{originString(item, "source") || originString(item, "provider") || "Snapshot fonte"}</b></div>
          </div>
          <div className="history-box"><small>Histórico / complemento do lançamento</small><div>{originString(item, "history") || item.description}</div></div>
          <div className="context-label">Composição do lançamento / contrapartidas</div>
          <div className="table-scroll">
            <table className="data-table irpj-table">
              <thead><tr><th>Papel</th><th>Conta</th><th className="wrap">Descrição da conta</th><th className="num-head">Valor</th></tr></thead>
              <tbody>
                <tr className="target-row"><td><b>Linha fiscal alvo</b></td><td>{accountCode}</td><td className="wrap">{description}</td><td className="num">{amount ? money(amount) : "-"}</td></tr>
                <tr><td colSpan={4}>Contrapartidas não disponíveis no payload atual.</td></tr>
              </tbody>
            </table>
          </div>
          <div className="notice">A justificativa registrada passa a compor a trilha de auditoria da ocorrência.</div>
          <form className="decision-box" onSubmit={(event) => submitPendingAction(event, item.id, "resolve-conditional")}>
            {[
              "accountCode",
              "reducedCode",
              "accountDescription",
              "accountingChartId",
              "companyAccountingChartId",
              "accountFiscalMappingId",
              "accountFiscalMappingVersion",
              "fiscalNatureId",
              "fiscalRuleId",
              "fiscalRuleVersion",
              "companyAccountMappingOverrideId",
              "companyAccountMappingOverrideVersion",
              "companyRuleOverrideId",
              "companyRuleOverrideVersion",
            ].map((name) => hiddenOriginField(item, name))}
            {hiddenPayloadField("amount", amount)}
            <div className="context-label">Decisão fiscal</div>
            <div className="decision-grid">
              <label><span>IRPJ</span><select name="irpjDecision" defaultValue="" required>{conditionalSelectOptions.map(([value, label]) => <option key={value || "UNSELECTED"} value={value} disabled={!value}>{label}</option>)}</select></label>
              <label><span>CSLL</span><select name="csllDecision" defaultValue="" required>{conditionalSelectOptions.map(([value, label]) => <option key={value || "UNSELECTED"} value={value} disabled={!value}>{label}</option>)}</select></label>
            </div>
            <label className="justification"><span>Justificativa da decisão</span><textarea name="justification" minLength={8} required placeholder="Descreva objetivamente o motivo da decisão fiscal..." /></label>
            <div className="footer-actions"><button className="btn primary" type="submit" disabled={!writeAllowed || Boolean(busyAction)}>Registrar decisão</button></div>
            <div className="audit-note">Ao registrar, o sistema guarda a decisão, justificativa, usuário, data/hora e o snapshot analisado.</div>
          </form>
        </div>
      );
    }

    return <div className="irpj-no-action">Tratamento operacional pendente de matriz fiscal.</div>;
  }

  return (
    <section className="irpj-csll-workspace" data-user-id={userId}>
      <div className="irpj-topbar">
        <div>
          <span className="eyebrow">IRPJ/CSLL</span>
          <h2>Apuração fiscal mensal</h2>
          <p className="subtitle">{companyCode} — {companyDisplayName(companyCode, companyName)} · {competenceLabel(competence)} · {userEmail}</p>
        </div>
        <div className="context">
          <div className="pill"><small>Empresa</small><b>{companyCode}</b><span>{companyDisplayName(companyCode, companyName)}</span></div>
          <div className="pill"><small>Competência</small><b>{competenceLabel(competence)}</b><span>{taxPeriod?.periodCode ?? "-"}</span></div>
          <div className="pill readonly-pill">
            <small>Motor</small>
            <b>{operationalEngineLabel(dashboard?.engine.code)}</b>
            <span className="readonly-note">definido pela empresa</span>
            <input className="irpj-sr-only" data-field="motor-readonly" value={dashboard?.engine.code ?? "-"} readOnly aria-readonly="true" tabIndex={-1} />
          </div>
          <div className="pill"><small>Status</small><b>{statusLabel(taxPeriod?.status)}</b><span>{calculationVersionLabel(calculation)}</span></div>
        </div>
      </div>

      <div className="footer-actions irpj-actionbar">
        <button className="btn" type="button" onClick={load} disabled={loading || Boolean(busyAction)}>
          {loading ? <Loader2 className="spin" /> : <RefreshCw />}
          Atualizar painel
        </button>
        <button className="btn primary" type="button" onClick={() => runCommand("preview", {}, "Prévia fiscal processada.")} disabled={!canRunEngine || Boolean(busyAction)}>
          <Play /> Gerar prévia
        </button>
        <button className="btn" type="button" onClick={() => runCommand("reprocess", {}, "Snapshot reprocessado pelo motor fiscal.")} disabled={!canRunEngine || Boolean(busyAction)}>
          <RotateCw /> Reprocessar snapshot
        </button>
        {isClosedPeriod ? (
          <button className="btn" type="button" onClick={() => runCommand("versions/open", {}, "Nova versão aberta para o período.")} disabled={!writeAllowed || taxPeriod?.status !== "CLOSED_CURRENT" || Boolean(busyAction)}>
            <GitBranch /> Abrir {nextVersionLabel}
          </button>
        ) : (
          <button className="btn success" type="button" onClick={() => runCommand("close", {}, "Período fiscal fechado com versão vigente.")} disabled={!writeAllowed || !dashboard?.closeAllowed || Boolean(busyAction)}>
            <CheckCircle2 /> Fechar período
          </button>
        )}
      </div>

      {notice && <div className="notice irpj-notice success"><BadgeCheck /> {notice}</div>}
      {error && <div className="notice irpj-notice error"><AlertTriangle /> {error}</div>}

      <nav className="tabs irpj-tabs" aria-label="Navegação IRPJ/CSLL">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <section className="irpj-view">
          <div className="grid4">
            <article className="card kpi"><small>Status da apuração</small><span className={`status ${statusTone(taxPeriod?.status)}`}>{statusLabel(taxPeriod?.status)}</span><div className="foot">{calculationVersionLabel(calculation)} · cálculo atual</div></article>
            <article className="card kpi"><small>Resultado contábil antes do IRPJ</small><strong>{money(calculation?.irpj.accountingResultYtd)}</strong><div className="foot">{taxPeriod ? `${formatDate(taxPeriod.startDate)} a ${formatDate(taxPeriod.endDate)}` : "Período não carregado"}</div></article>
            <article className="card kpi"><small>IRPJ a recolher no mês</small><strong>{money(calculation?.irpj.currentMonthTaxPayable)}</strong><div className="foot">Após estimativas anteriores e retenções utilizadas</div></article>
            <article className="card kpi"><small>CSLL a recolher no mês</small><strong>{money(calculation?.csll.currentMonthTaxPayable)}</strong><div className="foot">Após compensação de base negativa e retenções utilizadas</div></article>
          </div>

          <div className="twocol">
            <article className="card">
              <div className="cardhead"><div><h2>Composição do IRPJ</h2><p>Apuração acumulada do exercício até a competência selecionada.</p></div><button className="btn primary" type="button" onClick={() => setActiveTab("memory")}>Abrir memória</button></div>
              <div className="calc">
                <div><span>IRPJ acumulado</span><span className="num">{money(calculation?.irpj.taxDueCumulative)}</span></div>
                <div className="ded"><span>(-) Estimativas anteriores</span><span className="num">{money(calculation?.irpj.priorEstimateTaxDue)}</span></div>
                <div className="ded"><span>(-) IRRF – Serviços</span><span className="num">{calculation ? money(creditUsed(calculation.irpj, "IRRF_SERVICOS")) : "-"}</span></div>
                <div className="ded"><span>(-) IRRF – Aplicações Financeiras</span><span className="num">{calculation ? money(creditUsed(calculation.irpj, "IRRF_APLICACOES_FINANCEIRAS")) : "-"}</span></div>
                <div className="total"><span>IRPJ a recolher no mês</span><span className="num">{money(calculation?.irpj.currentMonthTaxPayable)}</span></div>
              </div>
            </article>
            <article className="card">
              <div className="cardhead"><div><h2>Composição da CSLL</h2><p>Apuração acumulada do exercício até a competência selecionada.</p></div><button className="btn primary" type="button" onClick={() => setActiveTab("memory")}>Abrir memória</button></div>
              <div className="calc">
                <div><span>CSLL devida acumulada</span><span className="num">{money(calculation?.csll.taxDueCumulative)}</span></div>
                <div className="ded"><span>(-) Estimativas anteriores</span><span className="num">{money(calculation?.csll.priorEstimateTaxDue)}</span></div>
                <div className="ded"><span>(-) CSLL Retida</span><span className="num">{calculation ? money(creditUsed(calculation.csll, "CSLL_EXPLICIT_DEDUCTION")) : "-"}</span></div>
                <div className="total"><span>CSLL a recolher no mês</span><span className="num">{money(calculation?.csll.currentMonthTaxPayable)}</span></div>
              </div>
            </article>
          </div>

          <div className="twocol irpj-secondary-row">
            <article className="card">
              <div className="cardhead"><div><h2>Andamento da apuração</h2><p>Etapas necessárias para fechar ou versionar a apuração.</p></div><span className={`status ${isClosedPeriod || closeReady ? "ok" : "warn"}`}>{closeStatusText}</span></div>
              <div className="stepbar"><i className="step done"></i><i className="step done"></i><i className={calculation ? "step done" : "step current"}></i><i className={openPending.length ? "step current" : "step done"}></i><i className={isClosedPeriod || closeReady ? "step done" : "step"}></i></div>
              <div className="table-scroll"><table className="data-table irpj-table compact"><tbody>
                <tr><td><span className="status ok">✓</span></td><td><b>Balancete capturado</b><br /><span className="muted">Snapshot TOTVS registrado</span></td><td className="num">{sourceSnapshot ? "Concluído" : "Pendente"}</td></tr>
                <tr><td><span className="status ok">✓</span></td><td><b>Matriz Fiscal aplicada</b><br /><span className="muted">{calculation?.matrixVersion ?? "Aguardando cálculo"}</span></td><td className="num">{calculation ? "Concluído" : "Pendente"}</td></tr>
                <tr><td><span className={openPending.length ? "status warn" : "status ok"}>{openPending.length ? "!" : "✓"}</span></td><td><b>Pendências fiscais</b><br /><span className="muted">{autoPending.length} automática(s) aguardando confirmação · {blockingPending.length} exigem análise</span></td><td className="num"><button className="support-link" type="button" onClick={() => setActiveTab("pending")}>Ver</button></td></tr>
                <tr><td><span className={isClosedPeriod || closeReady ? "status ok" : "status"}>{isClosedPeriod || closeReady ? "✓" : "○"}</span></td><td><b>Fechamento da versão</b><br /><span className="muted">{isClosedPeriod ? "Versão fechada vigente; alterações exigem nova versão." : closeReady ? "Sem bloqueios" : "Bloqueado até resolver pendências"}</span></td><td className="num">{isClosedPeriod ? "Fechado" : closeReady ? "Liberado" : "Pendente"}</td></tr>
              </tbody></table></div>
            </article>
            <article className="card">
              <div className="cardhead"><div><h2>Fonte da apuração</h2><p>Origem operacional da base usada no snapshot persistido.</p></div></div>
              <dl className="irpj-facts">
                <div><dt>Fonte</dt><dd>{operationalSourceLabel(sourceSnapshot?.source)}</dd></div>
                <div><dt>Período</dt><dd>{sourceSnapshot ? `${formatDate(sourceSnapshot.taxPeriod.startDate)} a ${formatDate(sourceSnapshot.taxPeriod.endDate)}` : "-"}</dd></div>
                <div><dt>Snapshot</dt><dd>{sourceSnapshot?.id ?? "-"}</dd></div>
                <div><dt>Hash</dt><dd>{shortHash(sourceSnapshot?.hash)}</dd></div>
                <div><dt>Lançamentos de fechamento</dt><dd>{yesNo(sourceSnapshot?.parameters.includeClosingEntries)}</dd></div>
              </dl>
              <details className="technical-details">
                <summary>Detalhes técnicos</summary>
                <dl className="irpj-facts">
                  <div><dt>Provider</dt><dd>{sourceSnapshot?.provider ?? "-"}</dd></div>
                  <div><dt>Fonte técnica</dt><dd>{sourceSnapshot?.source ?? "-"}</dd></div>
                  <div><dt>Sequência</dt><dd>{dashboard?.sourceSequence ?? "TOTVS -> SOURCE_SNAPSHOT persistido -> motor fiscal"}</dd></div>
                  <div><dt>Extração</dt><dd>{formatDateTime(sourceSnapshot?.extractedAt)}</dd></div>
                  <div><dt>Registros</dt><dd>{sourceSnapshot?.recordCount ?? "-"}</dd></div>
                </dl>
              </details>            </article>
          </div>
        </section>
      )}

      {activeTab === "memory" && (
        <section className="irpj-view">
          {calculation ? (
            <div className="twocol">
              {renderMemoryCard("IRPJ", calculation.irpj, irpjMemoryRows)}
              {renderMemoryCard("CSLL", calculation.csll, csllMemoryRows)}
            </div>
          ) : (
            <article className="card empty-state">Memória disponível após processamento backend do período.</article>
          )}
          <div className="footer-actions"><button className="btn" type="button" onClick={() => setActiveTab("annual")}>Ver Apuração do Exercício</button></div>
        </section>
      )}

      {activeTab === "adjustments" && (
        <section className="irpj-view">
          <article className="card">
            <div className="cardhead"><div><h2>Ajustes Fiscais</h2><p>Adições e exclusões já reconhecidas na competência.</p></div></div>
            <div className="table-scroll"><table className="data-table irpj-table"><colgroup><col style={{ width: "13%" }} /><col style={{ width: "26%" }} /><col style={{ width: "15%" }} /><col style={{ width: "16%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "6%" }} /></colgroup>
              <thead><tr><th>Conta</th><th className="wrap">Descrição</th><th>Tratamento</th><th>Base do ajuste</th><th className="num-head">Valor contábil</th><th className="num-head">Ajuste</th><th>Suporte</th></tr></thead>
              <tbody>
                {groupedAdjustmentRows.map((group) => {
                  const item = group.primary;
                  const result = group.result;
                  return (
                    <tr key={group.key}>
                      <td><b>{accountCodeOnly(item.accountCode)}</b>{item.reducedCode ? <small>{item.reducedCode}</small> : null}</td>
                      <td className="wrap">{adjustmentDescription(item, result)}</td>
                      <td><div className="adjustment-treatment-stack">{group.treatments.map((treatment) => <span key={`${treatment.tax}-${treatment.adjustmentType}`} className={`tag ${treatmentTag(treatment.adjustmentType)}`}>{treatment.tax} · {treatmentLabel(treatment.adjustmentType)}</span>)}</div></td>
                      <td>{adjustmentBaseLabel(result)}</td>
                      <td className="num">{money(result?.rawAccountingValue ?? item.value)}</td>
                      <td className="num">{item.adjustmentType === "EXCLUSION" ? `(${money(item.value)})` : money(item.value)}</td>
                      <td>{requiresLaunchComposition(result) ? <button className="support-link" type="button" onClick={() => setSelectedAdjustmentId(item.id)}>Ver composição</button> : <span className="muted">{adjustmentSupportLabel(result)}</span>}</td>
                    </tr>
                  );
                })}
                {groupedAdjustmentRows.length === 0 && <tr><td colSpan={7}>Sem ajustes fiscais persistidos para este período.</td></tr>}              </tbody>
            </table></div>
            {selectedAdjustment && (
              <div className="drawer open">
                <button className="btn close-drawer" type="button" onClick={() => setSelectedAdjustmentId(null)}>Fechar</button>
                <h3>Composição do ajuste</h3>
                <p>Dados já disponíveis no resultado da regra fiscal e no snapshot persistido.</p>
                <div className="table-scroll"><table className="data-table irpj-table compact"><tbody>
                  <tr><td>Conta</td><td><b>{accountCodeOnly(selectedAdjustment.accountCode)}</b></td></tr>
                  <tr><td>Descrição</td><td>{adjustmentDescription(selectedAdjustment, selectedAdjustmentResult)}</td></tr>
                  <tr><td>Base do ajuste</td><td>{adjustmentBaseLabel(selectedAdjustmentResult)}</td></tr>
                  <tr><td>Valor contábil</td><td className="num">{money(selectedAdjustmentResult?.rawAccountingValue ?? selectedAdjustment.value)}</td></tr>
                  <tr><td>Ajuste</td><td className="num">{money(selectedAdjustment.value)}</td></tr>
                  <tr><td>Fonte</td><td>{operationalSourceLabel(sourceSnapshot?.source)}</td></tr>
                  <tr><td>Snapshot</td><td>{shortHash(sourceSnapshot?.hash)}</td></tr>
                </tbody></table></div>
              </div>
            )}
          </article>
        </section>
      )}

      {activeTab === "pending" && (
        <section className="irpj-view">
          <div className="notice">{closeGatePendingCount ? `Impedimentos para fechamento: ${closeGatePendingCount}. ${autoPending.length} aguardando confirmação automática e ${blockingPending.length} aguardando análise fiscal.` : "Não há impedimentos para fechamento."}</div>
          <article className="card">
            <div className="cardhead"><div><h2>Ocorrências da competência</h2><p>O sistema encontrou {newAccountOccurrences + conditionalOccurrences} situação(ões); classificou {automaticClassificationItems.length} automaticamente e deixou {blockingPending.length} para análise humana.</p></div></div>
            <div className="matrix-summary occurrence-summary">
              <div className="matrix-mini"><small>Contas novas identificadas</small><strong>{newAccountOccurrences}</strong><div className="muted">inclui automáticas e não mapeadas</div></div>
              <div className="matrix-mini"><small>Classificadas automaticamente</small><strong>{automaticClassificationItems.length}</strong><div className="muted">{autoPending.length} aguardam · {confirmedAuto.length} confirmada(s)</div></div>
              <div className="matrix-mini"><small>Aguardando classificação</small><strong>{waitingClassification}</strong><div className="muted">ação humana</div></div>
              <div className="matrix-mini"><small>Ocorrências condicionais</small><strong>{conditionalOccurrences}</strong><div className="muted">decisão fiscal</div></div>
              <div className="matrix-mini"><small>Impedimentos para fechamento</small><strong>{closeGatePendingCount}</strong><div className="muted">{autoPending.length} confirmação automática · {blockingPending.length} análise fiscal</div></div>
            </div>
            <div className="auto-review-block">
              <div className="auto-review-head"><div><h3>Classificadas automaticamente — verificar</h3><p>Podem ser usadas na prévia e no reprocessamento, mas precisam de confirmação para fechar a versão.</p></div><span className="status warn">{autoPending.length} aguardando confirmação</span></div>
              <div className="table-scroll"><table className="data-table irpj-table">
                <thead><tr><th>Conta</th><th className="wrap">Descrição</th><th>IRPJ</th><th>CSLL</th><th>Classificação</th><th className="num-head">Movimento acumulado</th><th>Status</th><th>Ações</th></tr></thead>
                <tbody>
                  {automaticClassificationItems.map((item) => {
                    const awaiting = item.status === "OPEN";
                    return (
                      <tr key={item.id}>
                        <td><b>{pendingAccountCode(item)}</b></td>
                        <td className="wrap">{pendingDescription(item)}</td>
                        <td>{treatmentLabel(originString(item, "irpjTreatment") || "NO_ADJUSTMENT")}</td>
                        <td>{treatmentLabel(originString(item, "csllTreatment") || "NO_ADJUSTMENT")}</td>
                        <td><span className="auto-method">Classificada automaticamente</span><small>{originString(item, "classificationCriterion") || "Regra previamente aprovada"}</small></td>
                        <td className="num">{pendingAmount(item) ? money(pendingAmount(item)) : "-"}</td>
                        <td><span className={awaiting ? "status warn" : "status ok"}>{awaiting ? "Aguardando confirmação" : "Confirmada"}</span>{!awaiting && item.resolvedAt ? <small>{formatDateTime(item.resolvedAt)}</small> : null}</td>
                        <td><div className="irpj-dossier-actions">
                          <button className="btn" type="button" onClick={() => confirmAutomaticClassification(item.id)} disabled={!writeAllowed || !awaiting || Boolean(busyAction)}>Confirmar classificação</button>
                          <button className="btn" type="button" onClick={() => setSelectedAutoCorrectionId(item.id)} disabled={!writeAllowed || !awaiting || Boolean(busyAction)}>Corrigir classificação</button>
                        </div></td>
                      </tr>
                    );
                  })}
                  {automaticClassificationItems.length === 0 && <tr><td colSpan={8}>Nenhuma classificação automática identificada.</td></tr>}
                </tbody>
              </table></div>
              {selectedAutoCorrection && (
                <div className="drawer open">
                  <button className="btn close-drawer" type="button" onClick={() => setSelectedAutoCorrectionId(null)}>Fechar</button>
                  <h3>Corrigir classificação automática</h3>
                  <p>A classificação automática original permanece registrada na trilha; a correção exige justificativa.</p>
                  <form className="decision-box" onSubmit={async (event) => { await submitPendingAction(event, selectedAutoCorrection.id, "correct-auto"); setSelectedAutoCorrectionId(null); }}>
                    {commonHiddenFieldsFor(selectedAutoCorrection)}
                    {hiddenPayloadField("fiscalNatureCode", defaultFiscalCode(selectedAutoCorrection, "NATUREZA_CORRIGIDA"))}
                    {hiddenPayloadField("fiscalNatureName", `Classificação corrigida ${pendingAccountCode(selectedAutoCorrection)}`)}
                    {hiddenPayloadField("fiscalRuleCode", defaultFiscalCode(selectedAutoCorrection, "REGRA_CORRIGIDA"))}
                    <div className="decision-grid">
                      <label><span>IRPJ</span><select name="irpjTreatment" defaultValue="" required>{treatmentSelectOptions.map(([value, label]) => <option key={value || "UNSELECTED"} value={value} disabled={!value}>{label}</option>)}</select></label>
                      <label><span>CSLL</span><select name="csllTreatment" defaultValue="" required>{treatmentSelectOptions.map(([value, label]) => <option key={value || "UNSELECTED"} value={value} disabled={!value}>{label}</option>)}</select></label>
                    </div>
                    <label className="justification"><span>Justificativa da correção</span><textarea name="justification" minLength={8} required placeholder="Explique objetivamente por que a classificação automática deve ser corrigida..." /></label>
                    <div className="footer-actions"><button className="btn primary" type="submit" disabled={!writeAllowed || Boolean(busyAction)}>Registrar correção</button></div>
                  </form>
                </div>
              )}
            </div>
          </article>

          <div className="twocol">
            <article className="card">
              <div className="cardhead"><div><h2>Fila de Pendências</h2><p>Somente ocorrências que exigem ação humana fiscal.</p></div><span className="status warn">{blockingPending.length} aberta(s)</span></div>
              <div className="pending">
                {blockingPending.map((item) => (
                  <button key={item.id} className={`item ${selectedPending?.id === item.id ? "selected" : ""}`} type="button" onClick={() => setSelectedPendingId(item.id)}>
                    <span className="dot"></span>
                    <div>
                      <h3>{item.type === "NEW_ACCOUNT_UNMAPPED" ? "Nova conta" : "Ocorrência condicional"} · {pendingDescription(item)}</h3>
                      <p>Conta {pendingAccountCode(item)}{pendingAmount(item) ? ` · ${money(pendingAmount(item))}` : ""}</p>
                    </div>
                    <span className="tag cond">{item.type === "NEW_ACCOUNT_UNMAPPED" ? "CONTA NOVA" : "DECISÃO FISCAL"}</span>
                  </button>
                ))}
                {blockingPending.length === 0 && <div className="irpj-no-action">Nenhuma pendência bloqueante aberta.</div>}
              </div>
            </article>
            <article className="card">
              <div className="cardhead"><div><h2>Detalhe da ocorrência</h2><p>Informações disponíveis para apoiar a decisão fiscal.</p></div></div>
              {renderPendingDetail(selectedPending)}
            </article>
          </div>
        </section>
      )}
      {activeTab === "balances" && (
        <section className="irpj-view">
          <div className="grid4 balance-kpis">
            {(() => {
              const pf = fiscalBalanceRows.find((item) => item.balanceType === "PREJUIZO_FISCAL");
              const bn = fiscalBalanceRows.find((item) => item.balanceType === "BASE_NEGATIVA_CSLL");
              const servicos = creditBalanceRows.find((item) => item.id === "IRRF_SERVICOS");
              const aplicacoes = creditBalanceRows.find((item) => item.id === "IRRF_APLICACOES_FINANCEIRAS");
              const csllRetida = creditBalanceRows.find((item) => item.id === "CSLL_EXPLICIT_DEDUCTION");
              const cards = [
                { id: pf ? `balance:${pf.id}` : "balance:pf", title: "Prejuízo Fiscal — IRPJ", row: pf },
                { id: bn ? `balance:${bn.id}` : "balance:bn", title: "Base Negativa — CSLL", row: bn },
                { id: "credit:IRRF_SERVICOS", title: "IRRF – Serviços", row: servicos },
                { id: "credit:IRRF_APLICACOES_FINANCEIRAS", title: "IRRF – Aplicações Financeiras", row: aplicacoes },
                { id: "credit:CSLL_EXPLICIT_DEDUCTION", title: "CSLL Retida", row: csllRetida },
              ];
              return cards.map((card) => (
                <article key={card.id} className="card kpi">
                  <small>{card.title}</small>
                  <strong>{money(card.row?.remaining)}</strong>
                  <div className="foot">Saldo atual após utilização</div>
                  <div className="kpi-meta">Disponível: {money(card.row?.available)} · Utilizado: {money(card.row?.used)}</div>
                </article>
              ));
            })()}
          </div>
          <article className="card">
            <div className="cardhead"><div><h2>Movimentação dos saldos fiscais</h2><p>Disponível | Utilizado | Saldo por natureza.</p></div></div>
            <div className="table-scroll"><table className="data-table balance-table irpj-table">
              <thead><tr><th>Natureza</th><th className="num-head">Disponível</th><th className="num-head">Utilizado</th><th className="num-head">Saldo</th><th>Composição</th></tr></thead>
              <tbody>
                {fiscalBalanceRows.map((item) => (
                  <tr key={item.id}><td>{balanceLabel(item.balanceType)}</td><td className="num">{money(item.available)}</td><td className="num">{money(item.used)}</td><td className="num">{money(item.remaining)}</td><td><button className="balance-link" type="button" onClick={() => setSelectedBalanceId(`balance:${item.id}`)}>Ver composição</button></td></tr>
                ))}
                {creditBalanceRows.map((item) => (
                  <tr key={item.id}><td>{item.label}<br /><span className="muted">{item.rows.some((row) => creditDocumentLabel(row)) ? `${item.rows.length} origem(ns) documental(is)` : "Composição não disponível no cenário atual."}</span></td><td className="num">{money(item.available)}</td><td className="num">{money(item.used)}</td><td className="num">{money(item.remaining)}</td><td><button className="balance-link" type="button" onClick={() => setSelectedBalanceId(`credit:${item.id}`)} disabled={!item.rows.length}>Ver composição</button></td></tr>
                ))}
                {!fiscalBalanceRows.length && !creditBalanceRows.length && <tr><td colSpan={5}>Sem saldos ou créditos utilizados nesta prévia.</td></tr>}
              </tbody>
            </table></div>
            {selectedBalance && (
              <div className="drawer open">
                <button className="btn close-drawer" type="button" onClick={() => setSelectedBalanceId(null)}>Fechar</button>
                <h3>Composição — {selectedBalance.label}</h3>
                <p>Origens disponíveis no cálculo mensal selecionado.</p>
                <div className="table-scroll"><table className="data-table irpj-table compact">
                  <thead><tr><th>{selectedBalance.compositionLabel}</th><th className="num-head">Disponível</th><th className="num-head">Utilizado</th><th className="num-head">Saldo</th></tr></thead>
                  <tbody>
                    {selectedBalance.rows.map((row) => (
                      <tr key={`${selectedBalance.id}-${row.period}`}><td>{row.period}</td><td className="num">{money(row.available)}</td><td className="num">{money(row.used)}</td><td className="num">{money(row.remaining)}</td></tr>
                    ))}
                    {selectedBalance.rows.length === 0 && <tr><td colSpan={4}>{selectedBalance.emptyMessage}</td></tr>}
                  </tbody>
                </table></div>
              </div>
            )}
          </article>
        </section>
      )}
      {activeTab === "annual" && (
        <section className="irpj-view">
          <div className="notice">Esta aba apresenta somente as apurações mensais já disponíveis. Meses sem apuração permanecem em branco.</div>
          <article className="card annual-export-card">
            <div><h2>Arquivo anual da apuração — Exercício {fiscalYear}</h2><p>Visual em formato de planilha para acompanhar as versões mensais já existentes. Exportação anual definitiva não faz parte desta rodada.</p><div className="annual-export-meta"><span><b>Fonte:</b> versões mensais disponíveis</span><span><b>Fechamento anual:</b> não iniciado</span></div></div>
            <div className="annual-export-actions"><button className="btn" type="button" disabled>Exportar Excel do Exercício</button><button className="btn" type="button" disabled>Exportar PDF do Exercício</button></div>
          </article>
          {renderAnnualTable("IRPJ", "IRPJ — Apuração do Exercício", irpjAnnualRows)}
          {renderAnnualTable("CSLL", "CSLL — Apuração do Exercício", csllAnnualRows)}
        </section>
      )}

      {activeTab === "versions" && (
        <section className="irpj-view">
          <div className="versionbar"><b>Versões:</b>{periodVersions.map((period) => <button key={period.id} type="button" className={period.id === taxPeriod?.id ? "active" : ""}>{versionLabel(period.version)} · {statusLabel(period.status)}</button>)}<span>{officialVersion ? `${versionLabel(officialVersion.version)} é a versão oficial atual.` : "Nenhuma versão oficial carregada."}</span></div>
          <div className="compare-top">
            <article className="card kpi"><small>{supersededVersion ? `${versionLabel(supersededVersion.version)} — ${statusLabel(supersededVersion.status)}` : "Versão anterior"}</small><strong>IRPJ: {money(supersededCalculation?.irpj.currentMonthTaxPayable)}</strong><div className="kpi-meta">CSLL: {money(supersededCalculation?.csll.currentMonthTaxPayable)}</div><div className="foot">{supersededVersion?.closedAt ? `Fechado em ${formatDateTime(supersededVersion.closedAt)}` : "Fechamento anterior"}</div></article>
            <article className="card kpi"><small>{officialVersion ? `${versionLabel(officialVersion.version)} — Versão oficial atual` : "Versão atual"}</small><strong>IRPJ: {money(officialCalculation?.irpj.currentMonthTaxPayable)}</strong><div className="kpi-meta">CSLL: {money(officialCalculation?.csll.currentMonthTaxPayable)}</div><div className="foot">{officialVersion?.closedAt ? `Fechado em ${formatDateTime(officialVersion.closedAt)}` : "Fechamento atual"}</div></article>
            <article className="card kpi"><small>Impacto entre versões</small>{versionImpact === null ? <strong className="muted-value">Comparativo ainda não gerado</strong> : <div className={`delta ${versionImpact > 0 ? "up" : ""}`}>{signedMoney(versionImpact)}</div>}<div className="foot">IRPJ + CSLL a recolher no mês</div></article>
          </div>
          <article className="card compare-matrix">
            <div className="cardhead"><div><h2>{comparisonView ? `Comparativo ${comparisonView.previousVersion} × ${comparisonView.currentVersion}` : supersededVersion && officialVersion ? `Comparativo ${versionLabel(supersededVersion.version)} × ${versionLabel(officialVersion.version)}` : "Comparativo V01 × V02"}</h2><p>Indicadores mínimos por versão e abertura de adições/exclusões por conta quando disponíveis.</p></div></div>
            {comparisonView ? (
              <div className="table-scroll"><table className="data-table irpj-table compact">
                <thead><tr><th>Composição</th><th className="num-head">{comparisonView.previousVersion}</th><th className="num-head">{comparisonView.currentVersion}</th><th className="num-head">Diferença</th><th>Causa</th></tr></thead>
                <tbody>
                  {comparisonView.rows.map((row) => (
                    <tr key={`${row.metric}-${row.previousVersion ?? comparisonView.previousVersion}-${row.currentVersion ?? comparisonView.currentVersion}`} className={row.metric.startsWith("    ") ? "breakdown-row" : undefined}>
                      <td>{row.metric}<small>{comparisonNatureLabel(row.changeNature)}</small></td>
                      <td className="num">{row.previousValue}</td>
                      <td className="num">{row.currentValue}</td>
                      <td className="num">{row.delta ?? "—"}</td>
                      <td>{comparisonCauseLabel(row.cause)}</td>
                    </tr>
                  ))}
                  {comparisonView.rows.length === 0 && <tr><td colSpan={5}>Comparativo sem diferenças materiais.</td></tr>}
                </tbody>
              </table></div>
            ) : officialCalculation && supersededCalculation ? (
              <div className="table-scroll"><table className="data-table irpj-table compact">
                <thead><tr><th>Composição</th><th className="num-head">{versionLabel(supersededVersion?.version)}</th><th className="num-head">{versionLabel(officialVersion?.version)}</th><th className="num-head">Diferença</th><th>Causa</th></tr></thead>
                <tbody>
                  {[...comparisonMetricsFor("IRPJ"), ...comparisonMetricsFor("CSLL")].map((row) => (
                    <tr key={`${row.tax}-${row.label}`}><td>{row.tax} — {row.label}</td><td className="num">{money(row.previous)}</td><td className="num">{money(row.current)}</td><td className="num">{signedMoney(row.difference)}</td><td>Comparativo materializado pendente</td></tr>
                  ))}
                  {["IRPJ", "CSLL"].map((tax) => (["ADDITION", "EXCLUSION"] as const).map((kind) => (
                    <Fragment key={`${tax}-${kind}-compare`}>
                      <tr className="section"><td colSpan={5}>{kind === "ADDITION" ? "(+) Adições" : "(-) Exclusões"} {tax} por conta</td></tr>
                      {comparisonAdjustmentRows(tax as "IRPJ" | "CSLL", kind).map((row) => (
                        <tr key={row.id} className="breakdown-row"><td>{row.label}</td><td className="num">{money(row.previous)}</td><td className="num">{money(row.current)}</td><td className="num">{signedMoney(row.difference)}</td><td>Comparativo materializado pendente</td></tr>
                      ))}
                    </Fragment>
                  )))}
                </tbody>
              </table></div>
            ) : <div className="irpj-no-action">Comparativo ainda não gerado</div>}
            <div className="audit-note">Causa não identificada quando o payload da tela não trouxer evidência de snapshot, matriz, regra, decisão, crédito ou PF/BN alterado.</div>
          </article>
          <div className="twocol">
            <article className="card">
              <div className="cardhead"><div><h2>Versões do período</h2><p>Controle de versões fechadas, substituídas e nova versão.</p></div><button className="btn" type="button" onClick={() => runCommand("versions/open", {}, "Nova versão aberta para o período.")} disabled={!writeAllowed || taxPeriod?.status !== "CLOSED_CURRENT" || Boolean(busyAction)}><GitBranch /> Abrir {nextVersionLabel}</button></div>
              <div className="table-scroll"><table className="data-table irpj-table compact">
                <thead><tr><th>Período</th><th>Versão</th><th>Status</th><th>Snapshot</th><th>Matriz</th><th>Dossiê</th><th>Artefatos</th></tr></thead>
                <tbody>
                  {periodVersions.map((period) => {
                    const dossier = dossierForPeriod(period, dashboard?.dossiers ?? []);
                    const xlsxArtifact = artifactForDossier(dossier, "XLSX");
                    const pdfArtifact = artifactForDossier(dossier, "PDF");
                    const comparisonArtifact = artifactForDossier(dossier, "COMPARISON_JSON");
                    const generateBusy = busyAction === `dossier:generate:${period.id}`;
                    const snapshotHash = typeof period.closedManifest?.sourceSnapshotHash === "string" ? period.closedManifest.sourceSnapshotHash : period.closedManifestId;
                    const periodCalculation = currentCalculationForPeriod(period, dashboard?.taxCalculations ?? []);
                    const periodMatrixVersion = (isRecord(period.closedManifest) ? sourceString(period.closedManifest, "matrixVersion") : "") || periodCalculation?.matrixVersion || "";
                    return (
                      <tr key={period.id}>
                        <td>{period.periodCode}</td>
                        <td><b>{versionLabel(period.version)}</b></td>
                        <td><span className={`status ${statusTone(period.status)}`}>{statusLabel(period.status)}</span>{period.closedAt ? <small>Fechado em {formatDateTime(period.closedAt)}</small> : null}{period.closedBy ? <small>Responsável: {readableUser(period.closedBy, userId, userEmail)}</small> : null}{period.upstreamStale ? <small>recalcular próximos períodos</small> : null}</td>
                        <td>{shortHash(typeof snapshotHash === "string" ? snapshotHash : null)}</td>
                        <td>{periodMatrixVersion ? matrixVersionLabel(periodMatrixVersion) : "Matriz fiscal não informada"}</td>
                        <td>{dossier?.status === "AVAILABLE" ? <div className="irpj-dossier-status"><span className="status ok">Disponível</span><small>{formatDateTime(dossier.generatedAt)} · {shortHash(dossier.manifestHash)} · {dossier.integrityStatus}</small><small>Responsável: {readableUser(dossier.generatedBy, userId, userEmail)}</small></div> : dossier?.status === "GENERATION_FAILED" ? <div className="irpj-dossier-status"><span className="status bad">Falhou</span><small>{dossier.failureCode ?? "Falha de geração"}</small></div> : <span className="irpj-no-action">Disponível após gerar o dossiê.</span>}</td>
                        <td><div className="irpj-dossier-actions">
                          {dossier?.status === "AVAILABLE" ? <>
                            <button className="btn" type="button" onClick={() => downloadDossierArtifact(dossier.id, "xlsx")} disabled={!xlsxArtifact || Boolean(busyAction)} title="Baixar XLSX do dossiê"><Download /> Baixar XLSX</button>
                            <button className="btn" type="button" onClick={() => downloadDossierArtifact(dossier.id, "pdf")} disabled={!pdfArtifact || Boolean(busyAction)} title="Baixar PDF do dossiê"><Download /> Baixar PDF</button>
                            <button className="btn" type="button" onClick={() => viewDossierComparison(dossier.id)} disabled={!comparisonArtifact || Boolean(busyAction)} title="Comparar versões"><GitBranch /> Comparar versões</button>
                            <details className="technical-details inline"><summary>Manifest</summary><button className="btn" type="button" onClick={() => viewDossierManifest(dossier.id)} disabled={Boolean(busyAction)} title="Ver manifest JSON"><Eye /> Ver manifest</button></details>
                          </> : <button className="btn" type="button" onClick={() => runDossierGenerate(period.id)} disabled={!writeAllowed || !isOfficialClosedPeriod(period) || Boolean(busyAction)} title="Gerar dossiê oficial para versão fechada">{generateBusy ? <Loader2 className="spin" /> : <FileText />} Gerar dossiê</button>}
                        </div></td>
                      </tr>
                    );
                  })}
                  {periodVersions.length === 0 && <tr><td colSpan={7}>Nenhuma versão encontrada para o período.</td></tr>}
                </tbody>
              </table></div>
            </article>
            <article className="card">
              <div className="dossier-section">
                <div className="cardhead"><div><h2>Trilha da versão / Conteúdo da versão</h2><p>Registros lógicos congelados no fechamento.</p></div></div>
                <div className="folder">
                  <div className="row"><div className="icon">01</div><div><b>Fontes</b><br /><small>Balancete e snapshot usados</small></div><span className="status ok">{dashboard?.sourceSnapshots.length ?? 0} fonte(s)</span></div>
                  <div className="row"><div className="icon">02</div><div><b>Decisões fiscais</b><br /><small>Justificativas e trilha de auditoria</small></div><span className="status ok">{dashboard?.humanDecisions.length ?? 0} decisão(ões)</span></div>
                  <div className="row"><div className="icon">03</div><div><b>Cálculo</b><br /><small>Memória mensal, hashes e referências</small></div><span className="muted">{calculation ? calculationVersionLabel(calculation) : "não calculado"}</span></div>
                </div>
              </div>
              <div className="dossier-section">
                <div className="cardhead"><div><h2>Dossiê materializado</h2><p>XLSX, PDF, manifest e comparativo quando gerados.</p></div></div>
                <div className="folder">
                  <div className="row"><div className="icon">X</div><div><b>XLSX</b><br /><small>Memória materializada</small></div>{materializedXlsx ? <span className="status ok">Disponível</span> : <span className="muted">Disponível após gerar o dossiê.</span>}</div>
                  <div className="row"><div className="icon">P</div><div><b>PDF</b><br /><small>Relatório mensal</small></div>{materializedPdf ? <span className="status ok">Disponível</span> : <span className="muted">Disponível após gerar o dossiê.</span>}</div>
                  <div className="row"><div className="icon">#</div><div><b>manifest.json</b><br /><small>Hashes, motor, matriz e fontes</small></div>{materializedManifest ? <span className="status ok">Disponível</span> : <span className="muted">Disponível após gerar o dossiê.</span>}</div>
                  <div className="row"><div className="icon">C</div><div><b>Comparativo</b><br /><small>V01 × V02 quando houver versão anterior</small></div>{materializedComparison ? <span className="status ok">Disponível</span> : <span className="muted">Disponível após gerar o dossiê.</span>}</div>
                </div>
              </div>
              {manifestPreview && <details className="technical-details" open><summary>Detalhes técnicos / Auditoria</summary><pre className="irpj-json-preview">{manifestPreview}</pre></details>}
              {comparisonPreview && <details className="technical-details" open><summary>Detalhes técnicos / Auditoria</summary><pre className="irpj-json-preview">{comparisonPreview}</pre></details>}
            </article>
          </div>
        </section>
      )}
    </section>
  );
}
