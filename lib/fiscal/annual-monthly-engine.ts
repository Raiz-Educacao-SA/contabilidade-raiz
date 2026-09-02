import { createHash } from "node:crypto";
import type { FiscalTax, PendingItem, TaxAdjustment } from "./fiscal-matrix.ts";
import { canonicalJson, normalizeMoney } from "./source-snapshot.ts";
import type {
  FiscalYearProfile,
  JsonObject,
  MonetaryAmount,
  SnapshotInputObject,
  SourceSnapshot,
  TaxPeriod,
  TaxPeriodIdentity,
} from "./types.ts";
import { assertFiscalYear, assertIsoDate } from "./periods.ts";
import { assertValidVersion } from "./versioning.ts";

export const ANNUAL_MONTHLY_ENGINE = "ANNUAL_MONTHLY" as const;
export const TAX_CALCULATION_MODEL_VERSION = 1;
export const IRPJ_RATE_BPS = 1500;
export const IRPJ_ADDITIONAL_RATE_BPS = 1000;
export const CSLL_RATE_BPS = 900;
export const COMPENSATION_LIMIT_BPS = 3000;
export const IRPJ_ADDITIONAL_MONTHLY_THRESHOLD_CENTS = 2_000_000n;

export const TAX_CALCULATION_STATUSES = ["CALCULATED", "CALCULATED_WITH_PENDING_ITEMS", "VALIDATION_REQUIRED"] as const;
export const TAX_CALCULATION_VERSION_STATUSES = ["DRAFT", "REVIEW", "CLOSED_CURRENT", "CLOSED_SUPERSEDED"] as const;
export const FISCAL_BALANCE_TYPES = ["PREJUIZO_FISCAL", "BASE_NEGATIVA_CSLL"] as const;
export const FISCAL_CREDIT_NATURES = ["IRRF_SERVICOS", "IRRF_APLICACOES_FINANCEIRAS", "CSLL_EXPLICIT_DEDUCTION"] as const;

export type TaxCalculationStatus = (typeof TAX_CALCULATION_STATUSES)[number];
export type TaxCalculationVersionStatus = (typeof TAX_CALCULATION_VERSION_STATUSES)[number];
export type FiscalBalanceType = (typeof FISCAL_BALANCE_TYPES)[number];
export type FiscalCreditNature = (typeof FISCAL_CREDIT_NATURES)[number];

export type AccountingResultYtdInput = MonetaryAmount | { readonly value: MonetaryAmount; readonly source: JsonObject };
export type AccountingResultByTaxInput = Partial<Record<FiscalTax, AccountingResultYtdInput>>;
export type FiscalBalanceAvailable = {
  readonly id: string;
  readonly tax: FiscalTax;
  readonly balanceType: FiscalBalanceType;
  readonly originYear?: number | null;
  readonly availableAmount: MonetaryAmount;
  readonly source: JsonObject;
};
export type FiscalCreditAvailable = {
  readonly id: string;
  readonly tax: FiscalTax;
  readonly nature: FiscalCreditNature;
  readonly label?: string;
  readonly availableAmount: MonetaryAmount;
  readonly source: JsonObject;
};
export type CalculationIssue = {
  readonly code: string;
  readonly message: string;
  readonly severity: "BLOCKING" | "WARNING";
  readonly metadata: JsonObject;
};
export type PriorEstimateReference = {
  readonly calculationId: string;
  readonly taxPeriodId: string;
  readonly periodCode: string;
  readonly tax: FiscalTax;
  readonly versionStatus: TaxCalculationVersionStatus;
  readonly currentMonthTaxPayable: string;
};
export type FiscalBalanceUsage = {
  readonly id: string;
  readonly logicalKey: string;
  readonly tax: FiscalTax;
  readonly balanceType: FiscalBalanceType;
  readonly balanceId: string;
  readonly originYear: number | null;
  readonly available: string;
  readonly used: string;
  readonly remaining: string;
  readonly source: JsonObject;
};
export type TaxCreditUsage = {
  readonly id: string;
  readonly logicalKey: string;
  readonly tax: FiscalTax;
  readonly nature: FiscalCreditNature;
  readonly label: string;
  readonly creditId: string;
  readonly available: string;
  readonly used: string;
  readonly remaining: string;
  readonly source: JsonObject;
};
export type TaxCalculationTaxMemory = {
  readonly tax: FiscalTax;
  readonly accountingResultYtd: string;
  readonly totalAdditions: string;
  readonly totalExclusions: string;
  readonly baseBeforeCompensation: string;
  readonly availableFiscalBalance: string;
  readonly maxCompensation: string;
  readonly compensationUsed: string;
  readonly fiscalBalanceUsages: readonly FiscalBalanceUsage[];
  readonly rawBaseAfterCompensation: string;
  readonly taxableBase: string;
  readonly rates: JsonObject;
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
export type TaxCalculation = {
  readonly id: string;
  readonly companyId: string;
  readonly taxPeriodId: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotHash: string;
  readonly fiscalYearProfileId: string;
  readonly engine: typeof ANNUAL_MONTHLY_ENGINE;
  readonly modelVersion: number;
  readonly calculationVersion: number;
  readonly versionStatus: TaxCalculationVersionStatus;
  readonly status: TaxCalculationStatus;
  readonly taxPeriod: TaxPeriodIdentity & { readonly periodType: TaxPeriod["periodType"] };
  readonly accountingResultSource: JsonObject;
  readonly matrixVersion: string;
  readonly ruleVersions: readonly { readonly fiscalRuleId: string; readonly fiscalRuleVersion: number }[];
  readonly taxAdjustmentIds: readonly string[];
  readonly priorCalculationIds: readonly string[];
  readonly fiscalBalanceUsages: readonly FiscalBalanceUsage[];
  readonly creditUsages: readonly TaxCreditUsage[];
  readonly irpj: TaxCalculationTaxMemory;
  readonly csll: TaxCalculationTaxMemory;
  readonly validationIssues: readonly CalculationIssue[];
  readonly memory: JsonObject;
  readonly logicalKey: string;
  readonly createdAt: string;
};
export type CalculateAnnualMonthlyInput = {
  readonly companyId: string;
  readonly fiscalYearProfile: Pick<FiscalYearProfile, "id" | "companyId" | "fiscalYear" | "taxRegime" | "periodicity" | "version">;
  readonly taxPeriod: Pick<TaxPeriod, "id" | "companyId" | "fiscalYear" | "periodCode" | "startDate" | "endDate" | "periodType" | "version">;
  readonly sourceSnapshot: SourceSnapshot;
  readonly accountingResultYtd: AccountingResultYtdInput;
  readonly accountingResultYtdByTax?: AccountingResultByTaxInput;
  readonly taxAdjustments: readonly TaxAdjustment[];
  readonly fiscalBalances?: readonly FiscalBalanceAvailable[];
  readonly taxCredits?: readonly FiscalCreditAvailable[];
  readonly priorCalculations?: readonly TaxCalculation[];
  readonly pendingItems?: readonly Pick<PendingItem, "companyId" | "taxPeriodId" | "sourceSnapshotId" | "status" | "logicalKey" | "type" | "blocking">[];
  readonly matrixVersion: string;
  readonly calculationVersion?: number;
  readonly versionStatus?: TaxCalculationVersionStatus;
  readonly createdAt?: string | Date;
  readonly payments?: readonly JsonObject[];
};
export type AnnualMonthlyCalculationResult =
  | { readonly status: "ENGINE_NOT_ENABLED_FOR_REGIME"; readonly errorCode: "ENGINE_NOT_ENABLED_FOR_REGIME"; readonly issues: readonly CalculationIssue[]; readonly taxCalculation: null }
  | { readonly status: TaxCalculationStatus; readonly issues: readonly CalculationIssue[]; readonly taxCalculation: TaxCalculation };

type NormalizedFiscalBalance = FiscalBalanceAvailable & { readonly availableCents: bigint; readonly originYear: number | null };
type NormalizedFiscalCredit = FiscalCreditAvailable & { readonly availableCents: bigint; readonly label: string };
type PriorEstimateResolution = { readonly total: bigint; readonly references: readonly PriorEstimateReference[]; readonly issues: readonly CalculationIssue[] };
type TaxMemoryInput = {
  readonly tax: FiscalTax;
  readonly monthsInYtdPeriod: number;
  readonly accountingResultCents: bigint;
  readonly additionsCents: bigint;
  readonly exclusionsCents: bigint;
  readonly fiscalBalances: readonly NormalizedFiscalBalance[];
  readonly taxCredits: readonly NormalizedFiscalCredit[];
  readonly priorEstimate: PriorEstimateResolution;
  readonly usageScopeKey: string;
};

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}
function trimRequired(value: unknown, label: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}
function normalizeCreatedAt(value: string | Date | undefined) {
  const parsed = value instanceof Date || value !== undefined ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) throw new Error("Data de criação do cálculo fiscal inválida.");
  return parsed.toISOString();
}
function centsFromMoney(value: MonetaryAmount, label: string) {
  const normalized = normalizeMoney(value);
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsigned = sign < 0n ? normalized.slice(1) : normalized;
  const [integer, fraction] = unsigned.split(".");
  return sign * BigInt(`${integer}${fraction}`);
}
function nonNegativeCents(value: MonetaryAmount, label: string) {
  const cents = centsFromMoney(value, label);
  if (cents < 0n) throw new Error(`${label} não pode ser negativo.`);
  return cents;
}
function moneyFromCents(cents: bigint) {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  const integer = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${sign}${integer}.${fraction}`;
}
function multiplyBasisPoints(cents: bigint, basisPoints: number) {
  return (cents * BigInt(basisPoints)) / 10_000n;
}
function positive(value: bigint) {
  return value > 0n ? value : 0n;
}
function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
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
function assertObjectSource(source: JsonObject, label: string) {
  if (!source || typeof source !== "object" || Array.isArray(source) || Object.keys(source).length === 0) throw new Error(`${label} exige fonte rastreável.`);
}
type NormalizedAccountingResult = {
  readonly cents: bigint;
  readonly value: string;
  readonly source: JsonObject;
};

function normalizeAccountingResult(input: AccountingResultYtdInput, label: string): NormalizedAccountingResult {
  if (typeof input === "object" && input !== null && !Array.isArray(input) && "value" in input) {
    assertObjectSource(input.source, label);
    return { cents: centsFromMoney(input.value, label), value: normalizeMoney(input.value), source: input.source };
  }
  const value = input as MonetaryAmount;
  return { cents: centsFromMoney(value, label), value: normalizeMoney(value), source: { sourceType: "EXPLICIT_ACCOUNTING_RESULT_YTD_INPUT" } as JsonObject };
}
function normalizeAccountingResults(input: CalculateAnnualMonthlyInput): Record<FiscalTax, NormalizedAccountingResult> {
  const fallback = normalizeAccountingResult(input.accountingResultYtd, "Resultado contábil acumulado");
  return {
    IRPJ: input.accountingResultYtdByTax?.IRPJ ? normalizeAccountingResult(input.accountingResultYtdByTax.IRPJ, "Resultado contábil antes do IRPJ") : fallback,
    CSLL: input.accountingResultYtdByTax?.CSLL ? normalizeAccountingResult(input.accountingResultYtdByTax.CSLL, "Resultado contábil antes da CSLL") : fallback,
  };
}
function accountingResultSourcePayload(input: Record<FiscalTax, NormalizedAccountingResult>): JsonObject {
  if (input.IRPJ.value === input.CSLL.value && canonicalJson(input.IRPJ.source) === canonicalJson(input.CSLL.source)) return input.IRPJ.source;
  return { IRPJ: input.IRPJ.source, CSLL: input.CSLL.source };
}
function accountingResultKeyPayload(input: Record<FiscalTax, NormalizedAccountingResult>): JsonObject {
  if (input.IRPJ.value === input.CSLL.value) return { accountingResultYtd: input.IRPJ.value };
  return { accountingResultBeforeIrpjYtd: input.IRPJ.value, accountingResultBeforeCsllYtd: input.CSLL.value };
}
function monthFromMonthlyEstimatePeriod(period: Pick<TaxPeriod, "fiscalYear" | "periodCode" | "periodType">) {
  if (period.periodType !== "MONTHLY_ESTIMATE") throw new Error("ANNUAL_MONTHLY exige período MONTHLY_ESTIMATE.");
  const match = new RegExp(`^${period.fiscalYear}-M(0[1-9]|1[0-2])$`).exec(period.periodCode);
  if (!match) throw new Error("Código do período mensal inválido para ANNUAL_MONTHLY.");
  return Number(match[1]);
}
function normalizeVersionStatus(value: TaxCalculationVersionStatus | undefined) {
  const versionStatus = value ?? "DRAFT";
  if (!isOneOf(versionStatus, TAX_CALCULATION_VERSION_STATUSES)) throw new Error("Status da versão do cálculo fiscal inválido.");
  return versionStatus;
}
function normalizeFiscalBalance(balance: FiscalBalanceAvailable): NormalizedFiscalBalance {
  const id = trimRequired(balance.id, "Saldo fiscal");
  const tax = trimRequired(balance.tax, "Tributo do saldo fiscal");
  const balanceType = trimRequired(balance.balanceType, "Tipo de saldo fiscal");
  if (!isOneOf(tax, ["IRPJ", "CSLL"] as const)) throw new Error("Tributo do saldo fiscal inválido.");
  if (!isOneOf(balanceType, FISCAL_BALANCE_TYPES)) throw new Error("Tipo de saldo fiscal inválido.");
  if (tax === "IRPJ" && balanceType !== "PREJUIZO_FISCAL") throw new Error("Saldo de IRPJ exige PREJUIZO_FISCAL.");
  if (tax === "CSLL" && balanceType !== "BASE_NEGATIVA_CSLL") throw new Error("Saldo de CSLL exige BASE_NEGATIVA_CSLL.");
  assertObjectSource(balance.source, "Saldo fiscal");
  const originYear = balance.originYear ?? null;
  if (originYear !== null) assertFiscalYear(originYear);
  return { ...balance, id, tax, balanceType, originYear, availableCents: nonNegativeCents(balance.availableAmount, "Saldo fiscal disponível") };
}
function creditLabel(nature: FiscalCreditNature) {
  if (nature === "IRRF_SERVICOS") return "IRRF – Serviços";
  if (nature === "IRRF_APLICACOES_FINANCEIRAS") return "IRRF – Aplicações Financeiras";
  return "Dedução explícita CSLL";
}
function normalizeFiscalCredit(credit: FiscalCreditAvailable): NormalizedFiscalCredit {
  const id = trimRequired(credit.id, "Crédito fiscal");
  const tax = trimRequired(credit.tax, "Tributo do crédito fiscal");
  const nature = trimRequired(credit.nature, "Natureza do crédito fiscal");
  if (!isOneOf(tax, ["IRPJ", "CSLL"] as const)) throw new Error("Tributo do crédito fiscal inválido.");
  if (!isOneOf(nature, FISCAL_CREDIT_NATURES)) throw new Error("Natureza de crédito fiscal inválida.");
  if ((nature === "IRRF_SERVICOS" || nature === "IRRF_APLICACOES_FINANCEIRAS") && tax !== "IRPJ") throw new Error("IRRF mensal é crédito exclusivo de IRPJ nesta fase.");
  if (nature === "CSLL_EXPLICIT_DEDUCTION" && tax !== "CSLL") throw new Error("Dedução explícita de CSLL não pode ser usada em IRPJ.");
  assertObjectSource(credit.source, "Crédito fiscal");
  return { ...credit, id, tax, nature, label: credit.label?.trim() || creditLabel(nature), availableCents: nonNegativeCents(credit.availableAmount, "Crédito fiscal disponível") };
}
function assertUniqueIds(items: readonly { readonly id: string }[], label: string) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`${label} duplicado: ${item.id}.`);
    seen.add(item.id);
  }
}
function periodCodeForMonth(fiscalYear: number, month: number) {
  return `${fiscalYear}-M${String(month).padStart(2, "0")}`;
}
function resolvePriorEstimate(input: { readonly tax: FiscalTax; readonly companyId: string; readonly fiscalYear: number; readonly currentMonth: number; readonly priorCalculations: readonly TaxCalculation[] }): PriorEstimateResolution {
  const references: PriorEstimateReference[] = [];
  const issues: CalculationIssue[] = [];
  for (let month = 1; month < input.currentMonth; month += 1) {
    const expectedPeriodCode = periodCodeForMonth(input.fiscalYear, month);
    const candidates = input.priorCalculations
      .filter((calculation) => calculation.companyId === input.companyId)
      .filter((calculation) => calculation.engine === ANNUAL_MONTHLY_ENGINE)
      .filter((calculation) => calculation.taxPeriod.fiscalYear === input.fiscalYear)
      .filter((calculation) => calculation.taxPeriod.periodCode === expectedPeriodCode)
      .filter((calculation) => calculation.versionStatus === "CLOSED_CURRENT")
      .sort((left, right) => right.calculationVersion - left.calculationVersion || right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
    if (candidates.length === 0) {
      issues.push({ code: "MISSING_CLOSED_CURRENT_PRIOR_ESTIMATE", message: `Não há cálculo oficial CLOSED_CURRENT anterior para ${expectedPeriodCode}.`, severity: "BLOCKING", metadata: { tax: input.tax, periodCode: expectedPeriodCode } });
      continue;
    }
    if (candidates.length > 1) {
      issues.push({ code: "MULTIPLE_CLOSED_CURRENT_PRIOR_ESTIMATES", message: `Há mais de um cálculo CLOSED_CURRENT para ${expectedPeriodCode}.`, severity: "BLOCKING", metadata: { tax: input.tax, periodCode: expectedPeriodCode, calculationIds: candidates.map((item) => item.id) } });
    }
    const selected = candidates[0];
    const memory = input.tax === "IRPJ" ? selected.irpj : selected.csll;
    references.push({ calculationId: selected.id, taxPeriodId: selected.taxPeriodId, periodCode: selected.taxPeriod.periodCode, tax: input.tax, versionStatus: selected.versionStatus, currentMonthTaxPayable: memory.currentMonthTaxPayable });
  }
  return { total: references.reduce((sum, reference) => sum + centsFromMoney(reference.currentMonthTaxPayable, "Estimativa anterior"), 0n), references, issues };
}
function summarizeAdjustments(input: { readonly tax: FiscalTax; readonly companyId: string; readonly taxPeriodId: string; readonly sourceSnapshotId: string; readonly taxAdjustments: readonly TaxAdjustment[] }) {
  let additions = 0n;
  let exclusions = 0n;
  const references: JsonObject[] = [];
  for (const adjustment of input.taxAdjustments) {
    if (adjustment.companyId !== input.companyId || adjustment.taxPeriodId !== input.taxPeriodId || adjustment.sourceSnapshotId !== input.sourceSnapshotId) throw new Error("TAX_ADJUSTMENT inconsistente com o cálculo fiscal.");
    if (adjustment.status === "SUPERSEDED") continue;
    if (adjustment.tax !== input.tax) continue;
    const value = nonNegativeCents(adjustment.value, "Ajuste fiscal");
    if (adjustment.adjustmentType === "ADDITION") additions += value;
    else exclusions += value;
    references.push({ id: adjustment.id, logicalKey: adjustment.logicalKey, tax: adjustment.tax, adjustmentType: adjustment.adjustmentType, value: moneyFromCents(value), accountCode: adjustment.accountCode, fiscalRuleId: adjustment.fiscalRuleId, fiscalRuleVersion: adjustment.fiscalRuleVersion, status: adjustment.status });
  }
  return { additions, exclusions, references };
}
function fiscalBalanceOrder(left: NormalizedFiscalBalance, right: NormalizedFiscalBalance) {
  return (left.originYear ?? 9999) - (right.originYear ?? 9999) || left.id.localeCompare(right.id);
}
function allocateFiscalBalances(input: { readonly tax: FiscalTax; readonly limit: bigint; readonly balances: readonly NormalizedFiscalBalance[]; readonly usageScopeKey: string }) {
  let remainingLimit = input.limit;
  const usages: FiscalBalanceUsage[] = [];
  for (const balance of input.balances.filter((item) => item.tax === input.tax).sort(fiscalBalanceOrder)) {
    const used = minBigInt(balance.availableCents, remainingLimit);
    remainingLimit -= used;
    const usageKey = logicalKey("FISCAL_BALANCE_USAGE", { usageScopeKey: input.usageScopeKey, tax: input.tax, balanceId: balance.id, balanceType: balance.balanceType, originYear: balance.originYear });
    usages.push({ id: deterministicUuid({ type: "FISCAL_BALANCE_USAGE", logicalKey: usageKey }), logicalKey: usageKey, tax: input.tax, balanceType: balance.balanceType, balanceId: balance.id, originYear: balance.originYear, available: moneyFromCents(balance.availableCents), used: moneyFromCents(used), remaining: moneyFromCents(balance.availableCents - used), source: balance.source });
  }
  return usages;
}
function creditNatureOrder(nature: FiscalCreditNature) {
  if (nature === "IRRF_SERVICOS") return 1;
  if (nature === "IRRF_APLICACOES_FINANCEIRAS") return 2;
  return 3;
}
function allocateCredits(input: { readonly tax: FiscalTax; readonly need: bigint; readonly credits: readonly NormalizedFiscalCredit[]; readonly usageScopeKey: string }) {
  let remainingNeed = positive(input.need);
  const usages: TaxCreditUsage[] = [];
  const eligible = input.credits.filter((credit) => credit.tax === input.tax).sort((left, right) => creditNatureOrder(left.nature) - creditNatureOrder(right.nature) || left.id.localeCompare(right.id));
  for (const credit of eligible) {
    const used = minBigInt(credit.availableCents, remainingNeed);
    remainingNeed -= used;
    const usageKey = logicalKey("TAX_CREDIT_USAGE", { usageScopeKey: input.usageScopeKey, tax: input.tax, creditId: credit.id, nature: credit.nature });
    usages.push({ id: deterministicUuid({ type: "TAX_CREDIT_USAGE", logicalKey: usageKey }), logicalKey: usageKey, tax: input.tax, nature: credit.nature, label: credit.label, creditId: credit.id, available: moneyFromCents(credit.availableCents), used: moneyFromCents(used), remaining: moneyFromCents(credit.availableCents - used), source: credit.source });
  }
  return usages;
}
function taxMemory(input: TaxMemoryInput): TaxCalculationTaxMemory {
  const baseBeforeCompensation = input.accountingResultCents + input.additionsCents - input.exclusionsCents;
  const maxCompensation = positive(multiplyBasisPoints(baseBeforeCompensation, COMPENSATION_LIMIT_BPS));
  const fiscalBalanceUsages = allocateFiscalBalances({ tax: input.tax, limit: maxCompensation, balances: input.fiscalBalances, usageScopeKey: input.usageScopeKey });
  const compensationUsed = fiscalBalanceUsages.reduce((sum, usage) => sum + centsFromMoney(usage.used, "Compensação utilizada"), 0n);
  const availableFiscalBalance = fiscalBalanceUsages.reduce((sum, usage) => sum + centsFromMoney(usage.available, "Saldo fiscal disponível"), 0n);
  const rawBaseAfterCompensation = baseBeforeCompensation - compensationUsed;
  const taxableBase = positive(rawBaseAfterCompensation);
  const normalRateBps = input.tax === "IRPJ" ? IRPJ_RATE_BPS : CSLL_RATE_BPS;
  const normalTax = multiplyBasisPoints(taxableBase, normalRateBps);
  const additionalThreshold = input.tax === "IRPJ" ? IRPJ_ADDITIONAL_MONTHLY_THRESHOLD_CENTS * BigInt(input.monthsInYtdPeriod) : 0n;
  const additionalBase = input.tax === "IRPJ" ? positive(taxableBase - additionalThreshold) : 0n;
  const additionalTax = input.tax === "IRPJ" ? multiplyBasisPoints(additionalBase, IRPJ_ADDITIONAL_RATE_BPS) : 0n;
  const taxDueCumulative = normalTax + additionalTax;
  const creditUsages = allocateCredits({ tax: input.tax, need: taxDueCumulative - input.priorEstimate.total, credits: input.taxCredits, usageScopeKey: input.usageScopeKey });
  const eligibleCreditsUsed = creditUsages.reduce((sum, usage) => sum + centsFromMoney(usage.used, "Crédito utilizado"), 0n);
  const netBeforeFloor = taxDueCumulative - input.priorEstimate.total - eligibleCreditsUsed;
  return {
    tax: input.tax,
    accountingResultYtd: moneyFromCents(input.accountingResultCents),
    totalAdditions: moneyFromCents(input.additionsCents),
    totalExclusions: moneyFromCents(input.exclusionsCents),
    baseBeforeCompensation: moneyFromCents(baseBeforeCompensation),
    availableFiscalBalance: moneyFromCents(availableFiscalBalance),
    maxCompensation: moneyFromCents(maxCompensation),
    compensationUsed: moneyFromCents(compensationUsed),
    fiscalBalanceUsages,
    rawBaseAfterCompensation: moneyFromCents(rawBaseAfterCompensation),
    taxableBase: moneyFromCents(taxableBase),
    rates: { normalRateBps, additionalRateBps: input.tax === "IRPJ" ? IRPJ_ADDITIONAL_RATE_BPS : 0, additionalThreshold: moneyFromCents(additionalThreshold), compensationLimitBps: COMPENSATION_LIMIT_BPS },
    normalTax: moneyFromCents(normalTax),
    additionalTax: moneyFromCents(additionalTax),
    taxDueCumulative: moneyFromCents(taxDueCumulative),
    priorEstimateTaxDue: moneyFromCents(input.priorEstimate.total),
    priorEstimateReferences: input.priorEstimate.references,
    creditUsages,
    eligibleCreditsUsed: moneyFromCents(eligibleCreditsUsed),
    netBeforeFloor: moneyFromCents(netBeforeFloor),
    currentMonthTaxPayable: moneyFromCents(positive(netBeforeFloor)),
  };
}
function ruleVersionsFromAdjustments(taxAdjustments: readonly TaxAdjustment[]) {
  const byKey = new Map<string, { readonly fiscalRuleId: string; readonly fiscalRuleVersion: number }>();
  for (const adjustment of taxAdjustments) {
    if (adjustment.status !== "SUPERSEDED") byKey.set(`${adjustment.fiscalRuleId}:${adjustment.fiscalRuleVersion}`, { fiscalRuleId: adjustment.fiscalRuleId, fiscalRuleVersion: adjustment.fiscalRuleVersion });
  }
  return [...byKey.values()].sort((left, right) => left.fiscalRuleId.localeCompare(right.fiscalRuleId) || left.fiscalRuleVersion - right.fiscalRuleVersion);
}
function openRelevantPendingItems(input: CalculateAnnualMonthlyInput) {
  return (input.pendingItems ?? []).filter((item) => item.companyId === input.companyId && item.status === "OPEN" && (item.taxPeriodId === input.taxPeriod.id || item.sourceSnapshotId === input.sourceSnapshot.id)).sort((left, right) => left.logicalKey.localeCompare(right.logicalKey));
}
function taxCalculationStatus(input: { readonly issues: readonly CalculationIssue[]; readonly pendingItems: readonly Pick<PendingItem, "logicalKey">[] }): TaxCalculationStatus {
  if (input.issues.some((issue) => issue.severity === "BLOCKING")) return "VALIDATION_REQUIRED";
  if (input.pendingItems.length) return "CALCULATED_WITH_PENDING_ITEMS";
  return "CALCULATED";
}
function assertSnapshotMatchesPeriod(input: CalculateAnnualMonthlyInput) {
  if (input.fiscalYearProfile.companyId !== input.companyId || input.taxPeriod.companyId !== input.companyId || input.sourceSnapshot.companyId !== input.companyId) throw new Error("Empresa inconsistente para cálculo ANNUAL_MONTHLY.");
  if (input.sourceSnapshot.taxPeriodId !== input.taxPeriod.id) throw new Error("Snapshot não pertence ao período fiscal informado.");
  if (input.sourceSnapshot.taxPeriod.fiscalYear !== input.taxPeriod.fiscalYear || input.sourceSnapshot.taxPeriod.periodCode !== input.taxPeriod.periodCode || input.sourceSnapshot.taxPeriod.startDate !== input.taxPeriod.startDate || input.sourceSnapshot.taxPeriod.endDate !== input.taxPeriod.endDate) throw new Error("Identidade do período no snapshot diverge do período fiscal informado.");
  assertFiscalYear(input.taxPeriod.fiscalYear);
  assertIsoDate(input.taxPeriod.startDate, "data inicial do período fiscal");
  assertIsoDate(input.taxPeriod.endDate, "data final do período fiscal");
}
function disabledForRegimeIssue(input: CalculateAnnualMonthlyInput): CalculationIssue {
  return { code: "ENGINE_NOT_ENABLED_FOR_REGIME", message: "Motor ANNUAL_MONTHLY habilitado apenas para Lucro Real anual mensal nesta fase.", severity: "BLOCKING", metadata: { taxRegime: input.fiscalYearProfile.taxRegime, periodicity: input.fiscalYearProfile.periodicity, periodType: input.taxPeriod.periodType } };
}

export function calculateAnnualMonthly(input: CalculateAnnualMonthlyInput): AnnualMonthlyCalculationResult {
  const companyId = trimRequired(input.companyId, "Empresa");
  const matrixVersion = trimRequired(input.matrixVersion, "Versão da Matriz Fiscal");
  assertSnapshotMatchesPeriod({ ...input, companyId });
  if (input.fiscalYearProfile.taxRegime !== "REAL_PROFIT" || input.fiscalYearProfile.periodicity !== "ANNUAL" || input.taxPeriod.periodType !== "MONTHLY_ESTIMATE") {
    const issue = disabledForRegimeIssue(input);
    return { status: "ENGINE_NOT_ENABLED_FOR_REGIME", errorCode: "ENGINE_NOT_ENABLED_FOR_REGIME", issues: [issue], taxCalculation: null };
  }
  const calculationVersion = input.calculationVersion ?? 1;
  assertValidVersion(calculationVersion, "versão do cálculo fiscal");
  assertValidVersion(input.fiscalYearProfile.version, "versão do perfil fiscal");
  assertValidVersion(input.taxPeriod.version, "versão do período fiscal");
  const versionStatus = normalizeVersionStatus(input.versionStatus);
  const createdAt = normalizeCreatedAt(input.createdAt);
  const monthsInYtdPeriod = monthFromMonthlyEstimatePeriod(input.taxPeriod);
  const accountingResults = normalizeAccountingResults(input);
  const accountingResultSource = accountingResultSourcePayload(accountingResults);
  const accountingResultKey = accountingResultKeyPayload(accountingResults);
  const normalizedFiscalBalances = (input.fiscalBalances ?? []).map(normalizeFiscalBalance);
  const normalizedCredits = (input.taxCredits ?? []).map(normalizeFiscalCredit);
  assertUniqueIds(normalizedFiscalBalances, "Saldo fiscal");
  assertUniqueIds(normalizedCredits, "Crédito fiscal");
  const activeAdjustments = input.taxAdjustments.filter((adjustment) => adjustment.status !== "SUPERSEDED");
  const irpjAdjustments = summarizeAdjustments({ tax: "IRPJ", companyId, taxPeriodId: input.taxPeriod.id, sourceSnapshotId: input.sourceSnapshot.id, taxAdjustments: input.taxAdjustments });
  const csllAdjustments = summarizeAdjustments({ tax: "CSLL", companyId, taxPeriodId: input.taxPeriod.id, sourceSnapshotId: input.sourceSnapshot.id, taxAdjustments: input.taxAdjustments });
  const irpjPrior = resolvePriorEstimate({ tax: "IRPJ", companyId, fiscalYear: input.taxPeriod.fiscalYear, currentMonth: monthsInYtdPeriod, priorCalculations: input.priorCalculations ?? [] });
  const csllPrior = resolvePriorEstimate({ tax: "CSLL", companyId, fiscalYear: input.taxPeriod.fiscalYear, currentMonth: monthsInYtdPeriod, priorCalculations: input.priorCalculations ?? [] });
  const issues = [...irpjPrior.issues, ...csllPrior.issues];
  const relevantPendingItems = openRelevantPendingItems({ ...input, companyId });
  const usageScopeKey = logicalKey("ANNUAL_MONTHLY_USAGE_SCOPE", {
    companyId,
    fiscalYearProfileId: input.fiscalYearProfile.id,
    fiscalYearProfileVersion: input.fiscalYearProfile.version,
    taxPeriodId: input.taxPeriod.id,
    taxPeriodVersion: input.taxPeriod.version,
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    matrixVersion,
    ...accountingResultKey,
    activeAdjustmentKeys: activeAdjustments.map((adjustment) => adjustment.logicalKey).sort(),
    fiscalBalances: normalizedFiscalBalances.map((balance) => ({ id: balance.id, tax: balance.tax, balanceType: balance.balanceType, originYear: balance.originYear, available: moneyFromCents(balance.availableCents) })).sort((left, right) => left.id.localeCompare(right.id)),
    taxCredits: normalizedCredits.map((credit) => ({ id: credit.id, tax: credit.tax, nature: credit.nature, available: moneyFromCents(credit.availableCents) })).sort((left, right) => left.id.localeCompare(right.id)),
    priorEstimateReferences: [...irpjPrior.references, ...csllPrior.references].map((reference) => `${reference.tax}:${reference.periodCode}:${reference.calculationId}`).sort(),
  });
  const irpj = taxMemory({ tax: "IRPJ", monthsInYtdPeriod, accountingResultCents: accountingResults.IRPJ.cents, additionsCents: irpjAdjustments.additions, exclusionsCents: irpjAdjustments.exclusions, fiscalBalances: normalizedFiscalBalances, taxCredits: normalizedCredits, priorEstimate: irpjPrior, usageScopeKey });
  const csll = taxMemory({ tax: "CSLL", monthsInYtdPeriod, accountingResultCents: accountingResults.CSLL.cents, additionsCents: csllAdjustments.additions, exclusionsCents: csllAdjustments.exclusions, fiscalBalances: normalizedFiscalBalances, taxCredits: normalizedCredits, priorEstimate: csllPrior, usageScopeKey });
  const fiscalBalanceUsages = [...irpj.fiscalBalanceUsages, ...csll.fiscalBalanceUsages];
  const creditUsages = [...irpj.creditUsages, ...csll.creditUsages];
  const ruleVersions = ruleVersionsFromAdjustments(activeAdjustments);
  const taxAdjustmentIds = activeAdjustments.map((adjustment) => adjustment.id).sort();
  const priorCalculationIds = [...new Set([...irpjPrior.references, ...csllPrior.references].map((reference) => reference.calculationId))].sort();
  const status = taxCalculationStatus({ issues, pendingItems: relevantPendingItems });
  const memory = {
    engine: ANNUAL_MONTHLY_ENGINE,
    modelVersion: TAX_CALCULATION_MODEL_VERSION,
    fiscalYearProfile: { id: input.fiscalYearProfile.id, version: input.fiscalYearProfile.version, taxRegime: input.fiscalYearProfile.taxRegime, periodicity: input.fiscalYearProfile.periodicity },
    taxPeriod: { fiscalYear: input.taxPeriod.fiscalYear, periodCode: input.taxPeriod.periodCode, startDate: input.taxPeriod.startDate, endDate: input.taxPeriod.endDate, periodType: input.taxPeriod.periodType, version: input.taxPeriod.version, monthsInYtdPeriod },
    sourceSnapshot: { id: input.sourceSnapshot.id, hash: input.sourceSnapshot.hash, source: input.sourceSnapshot.source, provider: input.sourceSnapshot.provider, snapshotVersion: input.sourceSnapshot.snapshotVersion },
    accountingResultSource,
    matrixVersion,
    ruleVersions,
    taxAdjustmentReferences: [...irpjAdjustments.references, ...csllAdjustments.references],
    priorEstimatePolicy: "ONLY_CLOSED_CURRENT_PREVIOUS_MONTHS_TAX_DUE_NO_PAYMENTS",
    paymentPolicy: "PAYMENTS_DARF_INSTALLMENTS_NOT_USED_IN_MONTHLY_FORMULA",
    pendingItems: relevantPendingItems.map((item) => ({ logicalKey: item.logicalKey, type: item.type, blocking: item.blocking })),
    validationIssues: issues,
  } as JsonObject;
  const calculationKey = logicalKey("TAX_CALCULATION", {
    companyId,
    fiscalYearProfileId: input.fiscalYearProfile.id,
    fiscalYearProfileVersion: input.fiscalYearProfile.version,
    taxPeriodId: input.taxPeriod.id,
    taxPeriodVersion: input.taxPeriod.version,
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    engine: ANNUAL_MONTHLY_ENGINE,
    modelVersion: TAX_CALCULATION_MODEL_VERSION,
    matrixVersion,
    calculationVersion,
    versionStatus,
    ...accountingResultKey,
    taxAdjustmentIds,
    priorCalculationIds,
    irpj,
    csll,
    validationIssues: issues,
  });
  const taxCalculation: TaxCalculation = {
    id: deterministicUuid({ type: "TAX_CALCULATION", logicalKey: calculationKey }),
    companyId,
    taxPeriodId: input.taxPeriod.id,
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    fiscalYearProfileId: input.fiscalYearProfile.id,
    engine: ANNUAL_MONTHLY_ENGINE,
    modelVersion: TAX_CALCULATION_MODEL_VERSION,
    calculationVersion,
    versionStatus,
    status,
    taxPeriod: { fiscalYear: input.taxPeriod.fiscalYear, periodCode: input.taxPeriod.periodCode, startDate: input.taxPeriod.startDate, endDate: input.taxPeriod.endDate, periodType: input.taxPeriod.periodType },
    accountingResultSource,
    matrixVersion,
    ruleVersions,
    taxAdjustmentIds,
    priorCalculationIds,
    fiscalBalanceUsages,
    creditUsages,
    irpj,
    csll,
    validationIssues: issues,
    memory,
    logicalKey: calculationKey,
    createdAt,
  };
  return { status, issues, taxCalculation };
}
