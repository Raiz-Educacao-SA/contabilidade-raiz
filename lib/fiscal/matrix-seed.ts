import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildNewAccountUnmappedLogicalKey,
  findAccountFiscalMapping,
  findCompanyAccountingChart,
  isMovedTrialBalanceRecord,
  resolveFiscalRuleForAccount,
  type AccountFiscalMapping,
  type AccountingChart,
  type CompanyAccountingChart,
  type FiscalAmountBasis,
  type FiscalAutomationLevel,
  type FiscalNature,
  type FiscalRule,
  type FiscalRuleExecutionMethod,
  type FiscalTreatment,
  type PendingItem,
  type PendingItemDraft,
  type PendingItemType,
} from "./fiscal-matrix.ts";
import { canonicalJson } from "./source-snapshot.ts";
import type { JsonObject, JsonValue, SourceSnapshot, SnapshotInputObject, TaxPeriod } from "./types.ts";

export const RAIZ_TAX_MATRIX_VERSION = "v53";
export const RAIZ_TAX_MATRIX_VERSION_NUMBER = 53;
export const RAIZ_ACCOUNTING_CHART_CODE = "RAIZ_FISCAL_MATRIX_V53";
export const RAIZ_TAX_MATRIX_SOURCE_FILE = "data/fiscal/raiz/tax-matrix-v53.json";
export const RAIZ_AUTO_ONBOARDING_CATALOG_FILE = "data/fiscal/raiz/auto-onboarding-catalog-v51_1.json";
export const RAIZ_AUTO_ONBOARDING_APPROVED_L2_FILE = "data/fiscal/raiz/auto-onboarding-approved-l2-v53.json";

const TAX_MATRIX_URL = new URL("../../data/fiscal/raiz/tax-matrix-v53.json", import.meta.url);
const CATALOG_URL = new URL("../../data/fiscal/raiz/auto-onboarding-catalog-v51_1.json", import.meta.url);
const APPROVED_L2_URL = new URL("../../data/fiscal/raiz/auto-onboarding-approved-l2-v53.json", import.meta.url);

const SOURCE_TREATMENTS = ["SEM AJUSTE", "ADIÇÃO", "EXCLUSÃO", "CONDICIONAL", "REGRA AUTOMÁTICA"] as const;
const EXPECTED_DISTRIBUTION = {
  "SEM AJUSTE": 395,
  "ADIÇÃO": 27,
  "EXCLUSÃO": 9,
  CONDICIONAL: 22,
  "REGRA AUTOMÁTICA": 1,
} as const;

export type RaizTaxMatrixSourceTreatment = (typeof SOURCE_TREATMENTS)[number];
export type RaizTaxMatrixAccount = {
  readonly accountCode: string;
  readonly description: string;
  readonly nature: "DB" | "CR" | string;
  readonly group: string;
  readonly irpj: RaizTaxMatrixSourceTreatment | string;
  readonly csll: RaizTaxMatrixSourceTreatment | string;
  readonly mode: string;
  readonly operationalRule: string;
  readonly legalBasis: string;
  readonly source: string;
  readonly validationStatus: string;
  readonly observation: string;
};
export type RaizTaxMatrixDataset = {
  readonly baselineMetadata?: JsonObject;
  readonly version: string;
  readonly sourceWorkbook: string;
  readonly accountCount: number;
  readonly classificationSummary: Record<string, number>;
  readonly accounts: readonly RaizTaxMatrixAccount[];
  readonly cpc06Rules?: readonly JsonValue[];
  readonly regAdtoRules?: readonly JsonValue[];
  readonly note?: string;
};
export type RaizTaxMatrixValidation = {
  readonly accountCount: number;
  readonly uniqueAccountCodes: number;
  readonly duplicateAccountCodes: readonly string[];
  readonly emptyIrpjTreatmentAccounts: readonly string[];
  readonly emptyCsllTreatmentAccounts: readonly string[];
  readonly irpjDistribution: Record<RaizTaxMatrixSourceTreatment, number>;
  readonly csllDistribution: Record<RaizTaxMatrixSourceTreatment, number>;
  readonly unexpectedIrpjTreatments: readonly string[];
  readonly unexpectedCsllTreatments: readonly string[];
  readonly translationMismatches: readonly string[];
  readonly irpjCsllDivergentAccounts: readonly string[];
  readonly valid: boolean;
  readonly errors: readonly string[];
};
export type RaizFiscalMatrixSeed = {
  readonly matrixVersion: typeof RAIZ_TAX_MATRIX_VERSION;
  readonly sourceDataset: string;
  readonly accountingCharts: readonly AccountingChart[];
  readonly companyAccountingCharts: readonly CompanyAccountingChart[];
  readonly mappings: readonly AccountFiscalMapping[];
  readonly fiscalNatures: readonly FiscalNature[];
  readonly fiscalRules: readonly FiscalRule[];
  readonly validation: RaizTaxMatrixValidation;
};
export type BuildRaizFiscalMatrixSeedInput = {
  readonly companyId?: string;
  readonly fiscalYear?: number | null;
  readonly validFrom?: string;
  readonly validTo?: string | null;
  readonly accountingChartId?: string;
};
export type AutoOnboardingCatalogRule = {
  readonly rule_code: string;
  readonly family: string;
  readonly prefixes: readonly string[];
  readonly positive: readonly string[];
  readonly negative: readonly string[];
  readonly level: string;
  readonly irpj: string;
  readonly csll: string;
  readonly status: string;
  readonly notes?: string;
};
export type AutoOnboardingApprovedL2Rule = {
  readonly rule_code: string;
  readonly family: string;
  readonly auto_commit: boolean;
  readonly canonical_evidence: string;
  readonly prefixes: readonly string[];
  readonly positive: readonly string[];
  readonly negative: readonly string[];
  readonly irpj: string;
  readonly csll: string;
};
export type AutoOnboardingApprovedL2Rules = {
  readonly version: string;
  readonly source: string;
  readonly principle: string;
  readonly approved_rules: readonly AutoOnboardingApprovedL2Rule[];
};
export type AutoOnboardingCatalog = {
  readonly version: string;
  readonly status: string;
  readonly source_matrix: string;
  readonly principle: string;
  readonly l2_candidates: readonly AutoOnboardingCatalogRule[];
  readonly l3_l4_families: readonly {
    readonly rule_code: string;
    readonly family: string;
    readonly prefix: string;
    readonly level: string;
    readonly reason: string;
  }[];
  readonly global_blockers: readonly { readonly term: string; readonly reason: string; readonly destination: string }[];
};
export type AutoOnboardingLevel =
  | "KNOWN_ACCOUNT"
  | "KNOWN_CONDITIONAL"
  | "NO_REVIEW_NO_MOVEMENT"
  | "L1_EXACT"
  | "L2_RULE_BASED_SAFE"
  | "L3_SUGGESTED"
  | "L4_REVIEW_REQUIRED";
export type AutoOnboardingDecision = {
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly description: string;
  readonly level: AutoOnboardingLevel;
  readonly autoCommit: boolean;
  readonly blocking: boolean;
  readonly ruleCode: string | null;
  readonly matchedAccountCode: string | null;
  readonly irpjTreatment: FiscalTreatment | null;
  readonly csllTreatment: FiscalTreatment | null;
  readonly pendingItem: PendingItemDraft | null;
  readonly generatedMapping: AccountFiscalMapping | null;
  readonly generatedFiscalNature: FiscalNature | null;
  readonly generatedFiscalRule: FiscalRule | null;
  readonly metadata: JsonObject;
};
export type RunFiscalAutoOnboardingInput = {
  readonly companyId: string;
  readonly taxPeriod: Pick<TaxPeriod, "id" | "companyId" | "fiscalYear" | "periodCode" | "startDate" | "endDate">;
  readonly sourceSnapshot: SourceSnapshot;
  readonly accountingCharts: readonly AccountingChart[];
  readonly companyAccountingCharts: readonly CompanyAccountingChart[];
  readonly mappings: readonly AccountFiscalMapping[];
  readonly fiscalNatures: readonly FiscalNature[];
  readonly fiscalRules: readonly FiscalRule[];
  readonly matrixDataset?: RaizTaxMatrixDataset;
  readonly catalog?: AutoOnboardingCatalog;
  readonly approvedL2Rules?: AutoOnboardingApprovedL2Rules;
  readonly existingPendingItems?: readonly Pick<PendingItem, "logicalKey">[];
};

let cachedMatrix: RaizTaxMatrixDataset | null = null;
let cachedCatalog: AutoOnboardingCatalog | null = null;
let cachedApprovedL2Rules: AutoOnboardingApprovedL2Rules | null = null;

function parseJsonFile<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

export function loadRaizTaxMatrixV53(): RaizTaxMatrixDataset {
  cachedMatrix ??= parseJsonFile<RaizTaxMatrixDataset>(TAX_MATRIX_URL);
  return cachedMatrix;
}

export function loadRaizAutoOnboardingCatalog(): AutoOnboardingCatalog {
  cachedCatalog ??= parseJsonFile<AutoOnboardingCatalog>(CATALOG_URL);
  return cachedCatalog;
}

export function loadRaizApprovedL2Rules(): AutoOnboardingApprovedL2Rules {
  cachedApprovedL2Rules ??= parseJsonFile<AutoOnboardingApprovedL2Rules>(APPROVED_L2_URL);
  return cachedApprovedL2Rules;
}

function sourceTreatment(value: string, label: string): RaizTaxMatrixSourceTreatment {
  const normalized = value.trim();
  if ((SOURCE_TREATMENTS as readonly string[]).includes(normalized)) return normalized as RaizTaxMatrixSourceTreatment;
  throw new Error(`${label} inválido na Matriz Fiscal v53: ${value}.`);
}

export function sourceTreatmentToFiscalTreatment(value: string, label = "tratamento fiscal"): FiscalTreatment {
  const treatment = sourceTreatment(value, label);
  if (treatment === "SEM AJUSTE") return "NO_ADJUSTMENT";
  if (treatment === "ADIÇÃO") return "ADDITION";
  if (treatment === "EXCLUSÃO") return "EXCLUSION";
  if (treatment === "CONDICIONAL") return "CONDITIONAL";
  return "AUTOMATIC_SPECIAL";
}

export function fiscalTreatmentToSourceTreatment(value: FiscalTreatment): RaizTaxMatrixSourceTreatment {
  if (value === "NO_ADJUSTMENT") return "SEM AJUSTE";
  if (value === "ADDITION") return "ADIÇÃO";
  if (value === "EXCLUSION") return "EXCLUSÃO";
  if (value === "CONDITIONAL") return "CONDICIONAL";
  return "REGRA AUTOMÁTICA";
}

function emptyDistribution(): Record<RaizTaxMatrixSourceTreatment, number> {
  return { "SEM AJUSTE": 0, "ADIÇÃO": 0, "EXCLUSÃO": 0, CONDICIONAL: 0, "REGRA AUTOMÁTICA": 0 };
}
function unique(values: readonly string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function validateRaizTaxMatrixV53(
  dataset: RaizTaxMatrixDataset = loadRaizTaxMatrixV53(),
  options: { readonly throwOnError?: boolean } = {},
): RaizTaxMatrixValidation {
  const irpjDistribution = emptyDistribution();
  const csllDistribution = emptyDistribution();
  const duplicateAccountCodes: string[] = [];
  const emptyIrpjTreatmentAccounts: string[] = [];
  const emptyCsllTreatmentAccounts: string[] = [];
  const unexpectedIrpjTreatments: string[] = [];
  const unexpectedCsllTreatments: string[] = [];
  const translationMismatches: string[] = [];
  const irpjCsllDivergentAccounts: string[] = [];
  const seen = new Set<string>();

  for (const account of dataset.accounts) {
    const accountCode = String(account.accountCode ?? "").trim();
    if (!accountCode) duplicateAccountCodes.push("<EMPTY_ACCOUNT_CODE>");
    if (seen.has(accountCode)) duplicateAccountCodes.push(accountCode);
    seen.add(accountCode);
    const rawIrpj = String(account.irpj ?? "").trim();
    const rawCsll = String(account.csll ?? "").trim();
    if (!rawIrpj) emptyIrpjTreatmentAccounts.push(accountCode);
    if (!rawCsll) emptyCsllTreatmentAccounts.push(accountCode);
    try {
      const treatment = sourceTreatment(rawIrpj, `IRPJ da conta ${accountCode}`);
      irpjDistribution[treatment] += 1;
      if (fiscalTreatmentToSourceTreatment(sourceTreatmentToFiscalTreatment(rawIrpj)) !== treatment) translationMismatches.push(`${accountCode}:IRPJ`);
    } catch {
      unexpectedIrpjTreatments.push(`${accountCode}:${rawIrpj}`);
    }
    try {
      const treatment = sourceTreatment(rawCsll, `CSLL da conta ${accountCode}`);
      csllDistribution[treatment] += 1;
      if (fiscalTreatmentToSourceTreatment(sourceTreatmentToFiscalTreatment(rawCsll)) !== treatment) translationMismatches.push(`${accountCode}:CSLL`);
    } catch {
      unexpectedCsllTreatments.push(`${accountCode}:${rawCsll}`);
    }
    if (rawIrpj !== rawCsll) irpjCsllDivergentAccounts.push(accountCode);
  }

  const errors: string[] = [];
  if (dataset.accounts.length !== 454) errors.push(`accountCount esperado 454, obtido ${dataset.accounts.length}.`);
  if (seen.size !== 454) errors.push(`uniqueAccountCodes esperado 454, obtido ${seen.size}.`);
  for (const treatment of SOURCE_TREATMENTS) {
    if (irpjDistribution[treatment] !== EXPECTED_DISTRIBUTION[treatment]) errors.push(`Distribuição IRPJ ${treatment} esperada ${EXPECTED_DISTRIBUTION[treatment]}, obtida ${irpjDistribution[treatment]}.`);
    if (csllDistribution[treatment] !== EXPECTED_DISTRIBUTION[treatment]) errors.push(`Distribuição CSLL ${treatment} esperada ${EXPECTED_DISTRIBUTION[treatment]}, obtida ${csllDistribution[treatment]}.`);
  }
  if (duplicateAccountCodes.length) errors.push(`Contas duplicadas: ${unique(duplicateAccountCodes).join(", ")}.`);
  if (emptyIrpjTreatmentAccounts.length) errors.push("Há tratamento IRPJ vazio.");
  if (emptyCsllTreatmentAccounts.length) errors.push("Há tratamento CSLL vazio.");
  if (unexpectedIrpjTreatments.length) errors.push("Há tratamento IRPJ fora da fonte canônica.");
  if (unexpectedCsllTreatments.length) errors.push("Há tratamento CSLL fora da fonte canônica.");
  if (translationMismatches.length) errors.push("Há tradução interna que não retorna ao tratamento da fonte.");
  if (irpjCsllDivergentAccounts.length) errors.push("Distribuição atual exige IRPJ e CSLL idênticos, mas há contas divergentes.");

  const validation = {
    accountCount: dataset.accounts.length,
    uniqueAccountCodes: seen.size,
    duplicateAccountCodes: unique(duplicateAccountCodes),
    emptyIrpjTreatmentAccounts: unique(emptyIrpjTreatmentAccounts),
    emptyCsllTreatmentAccounts: unique(emptyCsllTreatmentAccounts),
    irpjDistribution,
    csllDistribution,
    unexpectedIrpjTreatments: unique(unexpectedIrpjTreatments),
    unexpectedCsllTreatments: unique(unexpectedCsllTreatments),
    translationMismatches: unique(translationMismatches),
    irpjCsllDivergentAccounts: unique(irpjCsllDivergentAccounts),
    valid: errors.length === 0,
    errors,
  } satisfies RaizTaxMatrixValidation;
  if (options.throwOnError && !validation.valid) throw new Error(`Seed da Matriz Fiscal v53 recusado: ${errors.join(" ")}`);
  return validation;
}
function deterministicUuid(payload: SnapshotInputObject) {
  const chars = createHash("sha256").update(canonicalJson(payload)).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function stableSlug(value: string, maxLength = 36) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return (slug || "ITEM").slice(0, maxLength);
}

function accountMetadata(account: RaizTaxMatrixAccount): JsonObject {
  return {
    accountCode: account.accountCode,
    description: account.description,
    nature: account.nature,
    group: account.group,
    irpj: account.irpj,
    csll: account.csll,
    mode: account.mode,
    operationalRule: account.operationalRule,
    legalBasis: account.legalBasis,
    source: account.source,
    validationStatus: account.validationStatus,
    observation: account.observation,
  };
}

function ruleKeyPayload(account: RaizTaxMatrixAccount): JsonObject {
  return {
    accountingNature: account.nature,
    group: account.group,
    irpj: account.irpj,
    csll: account.csll,
    mode: account.mode,
    operationalRule: account.operationalRule,
    legalBasis: account.legalBasis,
    source: account.source,
  };
}

function amountBasisForNature(nature: string): FiscalAmountBasis {
  return nature.trim().toUpperCase() === "CR" ? "NET_CREDIT_MOVEMENT" : "NET_DEBIT_MOVEMENT";
}

function isSimpleFullAccount(account: RaizTaxMatrixAccount) {
  const irpjTreatment = sourceTreatmentToFiscalTreatment(String(account.irpj), "IRPJ");
  const csllTreatment = sourceTreatmentToFiscalTreatment(String(account.csll), "CSLL");
  return (
    account.mode.trim() === "AUTOMÁTICO" &&
    irpjTreatment !== "CONDITIONAL" &&
    csllTreatment !== "CONDITIONAL" &&
    irpjTreatment !== "AUTOMATIC_SPECIAL" &&
    csllTreatment !== "AUTOMATIC_SPECIAL"
  );
}

function executionMethodFor(account: RaizTaxMatrixAccount): FiscalRuleExecutionMethod {
  const treatments = [
    sourceTreatmentToFiscalTreatment(String(account.irpj), "IRPJ"),
    sourceTreatmentToFiscalTreatment(String(account.csll), "CSLL"),
  ];
  if (treatments.includes("AUTOMATIC_SPECIAL")) return "BALANCE_FORMULA";
  if (treatments.includes("CONDITIONAL")) return "MANUAL_EXCEPTION";
  if (isSimpleFullAccount(account)) return "FULL_ACCOUNT";
  if (account.mode.includes("CONTROLE FISCAL") || account.mode.includes("PARTE B")) return "EXTERNAL_SOURCE";
  return "MANUAL_EXCEPTION";
}

function automationLevelFor(account: RaizTaxMatrixAccount): FiscalAutomationLevel {
  const method = executionMethodFor(account);
  if (method === "FULL_ACCOUNT" || method === "BALANCE_FORMULA") return "AUTOMATIC";
  if (account.mode.startsWith("AUTOMÁTICO")) return "SEMI_AUTOMATIC";
  return "MANUAL";
}

function sourceMetadata(extra: JsonObject = {}): JsonObject {
  return {
    matrixVersion: RAIZ_TAX_MATRIX_VERSION,
    sourceDataset: RAIZ_TAX_MATRIX_SOURCE_FILE,
    sourceStructuredFile: "tax-matrix-v43.json",
    sourceWorkbook: "Matriz_Fiscal_IRPJ_CSLL_v49_consolidacao_funcional.xlsx",
    validationStatusMeaning: "HISTORICAL_PROVENANCE_NOT_PENDING_WORKFLOW",
    ...extra,
  };
}

export function buildRaizFiscalMatrixSeed(input: BuildRaizFiscalMatrixSeedInput = {}): RaizFiscalMatrixSeed {
  const dataset = loadRaizTaxMatrixV53();
  const validation = validateRaizTaxMatrixV53(dataset, { throwOnError: true });
  const accountingChartId = input.accountingChartId ?? deterministicUuid({ entity: "ACCOUNTING_CHART", code: RAIZ_ACCOUNTING_CHART_CODE });
  const validFrom = input.validFrom ?? "2026-01-01";
  const validTo = input.validTo ?? null;
  const accountingCharts: AccountingChart[] = [{
    id: accountingChartId,
    code: RAIZ_ACCOUNTING_CHART_CODE,
    name: "Matriz Fiscal IRPJ/CSLL v53",
    description: "Plano fiscal canônico Raiz para seed da Matriz IRPJ/CSLL v53.",
    active: true,
    version: RAIZ_TAX_MATRIX_VERSION_NUMBER,
  }];

  const groupedRules = new Map<string, { index: number; keyHash: string; first: RaizTaxMatrixAccount; accounts: RaizTaxMatrixAccount[] }>();
  for (const account of dataset.accounts) {
    const key = canonicalJson(ruleKeyPayload(account));
    const current = groupedRules.get(key);
    if (current) current.accounts.push(account);
    else groupedRules.set(key, { index: groupedRules.size + 1, keyHash: createHash("sha256").update(key).digest("hex"), first: account, accounts: [account] });
  }

  const fiscalNatures: FiscalNature[] = [];
  const fiscalRules: FiscalRule[] = [];
  const ruleIdByKey = new Map<string, { fiscalNatureId: string; keyHash: string }>();

  for (const [key, group] of groupedRules) {
    const first = group.first;
    const suffix = group.keyHash.slice(0, 10).toUpperCase();
    const fiscalNatureId = deterministicUuid({ entity: "FISCAL_NATURE", matrixVersion: RAIZ_TAX_MATRIX_VERSION, keyHash: group.keyHash });
    const fiscalRuleId = deterministicUuid({ entity: "FISCAL_RULE", matrixVersion: RAIZ_TAX_MATRIX_VERSION, keyHash: group.keyHash });
    const method = executionMethodFor(first);
    const criteria: Record<string, JsonValue> = {
      ...sourceMetadata({ ruleKeyHash: group.keyHash }),
      originalTreatments: { irpj: first.irpj, csll: first.csll },
      sourceClassifications: { irpj: first.irpj, csll: first.csll },
      accountingNature: first.nature,
      group: first.group,
      originalMode: first.mode,
      operationalRule: first.operationalRule,
      legalBasis: first.legalBasis,
      source: first.source,
      validationStatuses: unique(group.accounts.map((account) => account.validationStatus)),
      sourceAccounts: group.accounts.map(accountMetadata),
    };
    if (method === "FULL_ACCOUNT") criteria.amountBasis = amountBasisForNature(first.nature);
    if (method === "BALANCE_FORMULA") criteria.specialRule = "AUTOMATIC_BY_SIGN";
    if (sourceTreatmentToFiscalTreatment(String(first.irpj)) === "CONDITIONAL") criteria.pendingItemType = "CONDITIONAL_TAX_DECISION";

    fiscalNatures.push({
      id: fiscalNatureId,
      code: `RFN_${RAIZ_TAX_MATRIX_VERSION_NUMBER}_${String(group.index).padStart(3, "0")}_${suffix}`,
      name: stableSlug(`${first.group} ${first.irpj} ${first.mode}`, 80),
      description: `Matriz Fiscal v53: ${first.group} | ${first.irpj}/${first.csll} | ${first.mode}`,
      sourceMetadata: sourceMetadata({ ruleKeyHash: group.keyHash }),
      active: true,
    });
    fiscalRules.push({
      id: fiscalRuleId,
      ruleCode: `RFR_${RAIZ_TAX_MATRIX_VERSION_NUMBER}_${String(group.index).padStart(3, "0")}_${suffix}`,
      fiscalNatureId,
      irpjTreatment: sourceTreatmentToFiscalTreatment(String(first.irpj), "IRPJ"),
      csllTreatment: sourceTreatmentToFiscalTreatment(String(first.csll), "CSLL"),
      executionMethod: method,
      automationLevel: automationLevelFor(first),
      criteria: criteria as JsonObject,
      sourceMetadata: sourceMetadata({ ruleKeyHash: group.keyHash }),
      validFrom,
      validTo,
      version: RAIZ_TAX_MATRIX_VERSION_NUMBER,
      status: "ACTIVE",
    });
    ruleIdByKey.set(key, { fiscalNatureId, keyHash: group.keyHash });
  }

  const mappings = dataset.accounts.map((account) => {
    const key = canonicalJson(ruleKeyPayload(account));
    const rule = ruleIdByKey.get(key);
    if (!rule) throw new Error(`Regra fiscal não encontrada para a conta ${account.accountCode}.`);
    return {
      id: deterministicUuid({ entity: "ACCOUNT_FISCAL_MAPPING", matrixVersion: RAIZ_TAX_MATRIX_VERSION, accountingChartId, accountCode: account.accountCode }),
      accountingChartId,
      accountCode: account.accountCode,
      reducedCode: null,
      fiscalNatureId: rule.fiscalNatureId,
      sourceMetadata: sourceMetadata({ accountCode: account.accountCode, originalRecord: accountMetadata(account), ruleKeyHash: rule.keyHash }),
      validFrom,
      validTo,
      version: RAIZ_TAX_MATRIX_VERSION_NUMBER,
      active: true,
    } satisfies AccountFiscalMapping;
  });

  const companyAccountingCharts = input.companyId ? [{
    id: deterministicUuid({ entity: "COMPANY_ACCOUNTING_CHART", matrixVersion: RAIZ_TAX_MATRIX_VERSION, companyId: input.companyId, accountingChartId, fiscalYear: input.fiscalYear ?? null }),
    companyId: input.companyId,
    accountingChartId,
    fiscalYear: input.fiscalYear ?? null,
    validFrom,
    validTo,
    version: RAIZ_TAX_MATRIX_VERSION_NUMBER,
    active: true,
  } satisfies CompanyAccountingChart] : [];

  return { matrixVersion: RAIZ_TAX_MATRIX_VERSION, sourceDataset: RAIZ_TAX_MATRIX_SOURCE_FILE, accountingCharts, companyAccountingCharts, mappings, fiscalNatures, fiscalRules, validation };
}

function mergeById<T extends { readonly id: string }>(current: readonly T[] | undefined, incoming: readonly T[]) {
  const merged = new Map<string, T>();
  for (const item of current ?? []) merged.set(item.id, item);
  for (const item of incoming) if (!merged.has(item.id)) merged.set(item.id, item);
  return [...merged.values()];
}

export function mergeFiscalMatrixSeed(
  current: Partial<Omit<RaizFiscalMatrixSeed, "matrixVersion" | "sourceDataset" | "validation">>,
  incoming: RaizFiscalMatrixSeed,
): RaizFiscalMatrixSeed {
  return {
    matrixVersion: RAIZ_TAX_MATRIX_VERSION,
    sourceDataset: incoming.sourceDataset,
    accountingCharts: mergeById(current.accountingCharts, incoming.accountingCharts),
    companyAccountingCharts: mergeById(current.companyAccountingCharts, incoming.companyAccountingCharts),
    mappings: mergeById(current.mappings, incoming.mappings),
    fiscalNatures: mergeById(current.fiscalNatures, incoming.fiscalNatures),
    fiscalRules: mergeById(current.fiscalRules, incoming.fiscalRules),
    validation: incoming.validation,
  };
}
function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function textIncludesTerm(text: string, term: string) {
  const normalizedText = normalizeText(text);
  const terms = term.split("/").map((part) => normalizeText(part)).filter(Boolean);
  return terms.some((candidate) => normalizedText.includes(candidate));
}
function startsWithPrefix(accountCode: string, prefix: string) {
  return accountCode === prefix || accountCode.startsWith(`${prefix}.`);
}
function recordText(record: JsonObject, ...fields: readonly string[]) {
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}
function reducedCodeFromRecord(record: JsonObject) {
  return recordText(record, "reducedCode", "reduced") || null;
}
function parentAccountCode(record: JsonObject, accountCode: string) {
  const explicitParent = recordText(record, "parent", "parentAccount", "parentAccountCode");
  if (explicitParent) return explicitParent;
  const parts = accountCode.split(".");
  return parts.length > 1 ? parts.slice(0, -1).join(".") : null;
}
function exactMatrixDescriptionMatch(dataset: RaizTaxMatrixDataset, description: string) {
  const normalizedDescription = normalizeText(description);
  if (!normalizedDescription) return null;
  const matches = dataset.accounts.filter((account) => normalizeText(account.description) === normalizedDescription);
  return matches.length === 1 ? matches[0] : null;
}
function matchGlobalBlocker(catalog: AutoOnboardingCatalog, description: string) {
  return catalog.global_blockers.find((blocker) => textIncludesTerm(description, blocker.term)) ?? null;
}
function matchApprovedL2Rule(approvedRules: AutoOnboardingApprovedL2Rules, accountCode: string, description: string) {
  for (const rule of approvedRules.approved_rules) {
    if (!rule.auto_commit) continue;
    if (!rule.prefixes.some((prefix) => startsWithPrefix(accountCode, prefix))) continue;
    if (!rule.positive.some((term) => textIncludesTerm(description, term))) continue;
    if (rule.negative.some((term) => textIncludesTerm(description, term))) continue;
    return rule;
  }
  return null;
}
function matchAssistedFamily(catalog: AutoOnboardingCatalog, accountCode: string) {
  return catalog.l3_l4_families.find((family) => startsWithPrefix(accountCode, family.prefix)) ?? null;
}
function matchL3Suggestion(catalog: AutoOnboardingCatalog, description: string) {
  return catalog.l2_candidates.find((rule) => rule.positive.some((term) => textIncludesTerm(description, term))) ?? null;
}
function logicalKey(type: PendingItemType, payload: SnapshotInputObject) {
  return `${type}:${createHash("sha256").update(canonicalJson({ type, ...payload })).digest("hex")}`;
}
function pendingBase(input: {
  readonly companyId: string;
  readonly taxPeriod: RunFiscalAutoOnboardingInput["taxPeriod"];
  readonly sourceSnapshot: SourceSnapshot;
  readonly accountCode: string;
  readonly reducedCode: string | null;
}) {
  return {
    companyId: input.companyId,
    taxPeriod: {
      fiscalYear: input.taxPeriod.fiscalYear,
      periodCode: input.taxPeriod.periodCode,
      startDate: input.taxPeriod.startDate,
      endDate: input.taxPeriod.endDate,
    },
    sourceSnapshotId: input.sourceSnapshot.id,
    sourceSnapshotHash: input.sourceSnapshot.hash,
    accountCode: input.accountCode,
    reducedCode: input.reducedCode,
  };
}
function buildPendingItem(input: {
  readonly type: PendingItemType;
  readonly companyId: string;
  readonly taxPeriod: RunFiscalAutoOnboardingInput["taxPeriod"];
  readonly sourceSnapshot: SourceSnapshot;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly description: string;
  readonly blocking: boolean;
  readonly originData: JsonObject;
}): PendingItemDraft {
  const base = pendingBase(input);
  const pendingKey = input.type === "NEW_ACCOUNT_UNMAPPED"
    ? buildNewAccountUnmappedLogicalKey({
        companyId: input.companyId,
        taxPeriod: input.taxPeriod,
        sourceSnapshot: input.sourceSnapshot,
        accountCode: input.accountCode,
        reducedCode: input.reducedCode,
      })
    : logicalKey(input.type, base);
  return {
    companyId: input.companyId,
    taxPeriodId: input.taxPeriod.id,
    sourceSnapshotId: input.sourceSnapshot.id,
    type: input.type,
    status: "OPEN",
    blocking: input.blocking,
    logicalKey: pendingKey,
    description: input.description,
    originData: input.originData,
  };
}
function generatedMapping(input: {
  readonly level: "L1_EXACT" | "L2_RULE_BASED_SAFE";
  readonly accountingChartId: string;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly fiscalNatureId: string;
  readonly validFrom: string;
  readonly source: JsonObject;
}): AccountFiscalMapping {
  return {
    id: deterministicUuid({ entity: "AUTO_ONBOARDING_ACCOUNT_FISCAL_MAPPING", level: input.level, matrixVersion: RAIZ_TAX_MATRIX_VERSION, accountingChartId: input.accountingChartId, accountCode: input.accountCode, reducedCode: input.reducedCode, fiscalNatureId: input.fiscalNatureId }),
    accountingChartId: input.accountingChartId,
    accountCode: input.accountCode,
    reducedCode: input.reducedCode,
    fiscalNatureId: input.fiscalNatureId,
    sourceMetadata: sourceMetadata(input.source),
    validFrom: input.validFrom,
    validTo: null,
    version: RAIZ_TAX_MATRIX_VERSION_NUMBER + 1,
    active: true,
  };
}
function normalizedCatalogTreatment(value: string) {
  return value.replace("SEM_AJUSTE", "SEM AJUSTE");
}
function buildL2Artifacts(input: {
  readonly accountingChartId: string;
  readonly accountCode: string;
  readonly reducedCode: string | null;
  readonly description: string;
  readonly rule: AutoOnboardingApprovedL2Rule;
  readonly validFrom: string;
}) {
  const irpjTreatment = sourceTreatmentToFiscalTreatment(normalizedCatalogTreatment(input.rule.irpj), "IRPJ L2");
  const csllTreatment = sourceTreatmentToFiscalTreatment(normalizedCatalogTreatment(input.rule.csll), "CSLL L2");
  const fiscalNatureId = deterministicUuid({ entity: "AUTO_ONBOARDING_L2_FISCAL_NATURE", matrixVersion: RAIZ_TAX_MATRIX_VERSION, ruleCode: input.rule.rule_code, irpjTreatment, csllTreatment });
  const fiscalRuleId = deterministicUuid({ entity: "AUTO_ONBOARDING_L2_FISCAL_RULE", matrixVersion: RAIZ_TAX_MATRIX_VERSION, ruleCode: input.rule.rule_code, irpjTreatment, csllTreatment });
  const source = {
    autoOnboardingLevel: "L2_RULE_BASED_SAFE",
    approvedRulesVersion: loadRaizApprovedL2Rules().version,
    approvalSource: loadRaizApprovedL2Rules().source,
    canonicalEvidence: input.rule.canonical_evidence,
    autoCommitApproved: input.rule.auto_commit,
    catalogRuleCode: input.rule.rule_code,
    accountCode: input.accountCode,
    accountDescription: input.description,
    originalApprovedRule: input.rule as unknown as JsonObject,
  } as JsonObject;
  const fiscalNature: FiscalNature = {
    id: fiscalNatureId,
    code: `AOL2_${stableSlug(input.rule.rule_code, 48)}`,
    name: input.rule.family,
    description: `Auto-Onboarding L2 v53: ${input.rule.family}`,
    sourceMetadata: sourceMetadata(source),
    active: true,
  };
  const fiscalRule: FiscalRule = {
    id: fiscalRuleId,
    ruleCode: `AUTO_ONBOARDING_${stableSlug(input.rule.rule_code, 56)}`,
    fiscalNatureId,
    irpjTreatment,
    csllTreatment,
    executionMethod: "FULL_ACCOUNT",
    automationLevel: "AUTOMATIC",
    criteria: {
      ...sourceMetadata(source),
      amountBasis: input.accountCode.startsWith("3.") ? "NET_CREDIT_MOVEMENT" : "NET_DEBIT_MOVEMENT",
      originalMode: "AUTO_ONBOARDING_L2_RULE_BASED_SAFE",
    } as JsonObject,
    sourceMetadata: sourceMetadata(source),
    validFrom: input.validFrom,
    validTo: null,
    version: RAIZ_TAX_MATRIX_VERSION_NUMBER + 1,
    status: "ACTIVE",
  };
  return {
    fiscalNature,
    fiscalRule,
    mapping: generatedMapping({ level: "L2_RULE_BASED_SAFE", accountingChartId: input.accountingChartId, accountCode: input.accountCode, reducedCode: input.reducedCode, fiscalNatureId, validFrom: input.validFrom, source }),
  };
}
function decisionMetadata(extra: JsonObject): JsonObject {
  return { matrixVersion: RAIZ_TAX_MATRIX_VERSION, engineVersion: "AUTO_ONBOARDING_V53_PHASE_4", ...extra };
}
function pushDecision(decisions: AutoOnboardingDecision[], decision: AutoOnboardingDecision) {
  decisions.push(decision);
}

export function runFiscalAutoOnboarding(input: RunFiscalAutoOnboardingInput) {
  if (input.taxPeriod.companyId !== input.companyId || input.sourceSnapshot.companyId !== input.companyId) throw new Error("Empresa inconsistente para Auto-Onboarding fiscal.");
  if (input.sourceSnapshot.taxPeriodId !== input.taxPeriod.id) throw new Error("Snapshot não pertence ao período fiscal informado.");
  const dataset = input.matrixDataset ?? loadRaizTaxMatrixV53();
  const catalog = input.catalog ?? loadRaizAutoOnboardingCatalog();
  const approvedL2Rules = input.approvedL2Rules ?? loadRaizApprovedL2Rules();
  const companyAccountingChart = findCompanyAccountingChart({ companyId: input.companyId, fiscalYear: input.taxPeriod.fiscalYear, date: input.taxPeriod.endDate, companyAccountingCharts: input.companyAccountingCharts });
  if (!companyAccountingChart) throw new Error("Plano de contas vigente não encontrado para a empresa.");
  const accountingChart = input.accountingCharts.find((chart) => chart.active && chart.id === companyAccountingChart.accountingChartId);
  if (!accountingChart) throw new Error("Plano de contas ativo não encontrado.");

  const seenPending = new Set(input.existingPendingItems?.map((item) => item.logicalKey) ?? []);
  const decisions: AutoOnboardingDecision[] = [];
  const pendingItems: PendingItemDraft[] = [];
  const generatedMappings: AccountFiscalMapping[] = [];
  const generatedFiscalNatures = new Map<string, FiscalNature>();
  const generatedFiscalRules = new Map<string, FiscalRule>();
  const pushPending = (pendingItem: PendingItemDraft) => {
    if (seenPending.has(pendingItem.logicalKey)) return null;
    seenPending.add(pendingItem.logicalKey);
    pendingItems.push(pendingItem);
    return pendingItem;
  };

  for (const record of input.sourceSnapshot.records) {
    const accountCode = recordText(record, "accountCode", "account");
    if (!accountCode) throw new Error("Registro de balancete sem conta contábil.");
    const reducedCode = reducedCodeFromRecord(record);
    const description = recordText(record, "description", "descricao", "accountDescription");
    const baseMetadata = decisionMetadata({ accountCode, reducedCode, description, debit: recordText(record, "debit"), credit: recordText(record, "credit"), movement: recordText(record, "movement"), parentAccountCode: parentAccountCode(record, accountCode), sourceSnapshotId: input.sourceSnapshot.id, sourceSnapshotHash: input.sourceSnapshot.hash });

    if (!isMovedTrialBalanceRecord(record)) {
      pushDecision(decisions, { accountCode, reducedCode, description, level: "NO_REVIEW_NO_MOVEMENT", autoCommit: false, blocking: false, ruleCode: null, matchedAccountCode: null, irpjTreatment: null, csllTreatment: null, pendingItem: null, generatedMapping: null, generatedFiscalNature: null, generatedFiscalRule: null, metadata: baseMetadata });
      continue;
    }

    const mapping = findAccountFiscalMapping({ accountingChartId: accountingChart.id, accountCode, reducedCode, date: input.taxPeriod.endDate, mappings: input.mappings });
    if (mapping) {
      const resolution = resolveFiscalRuleForAccount({ companyId: input.companyId, accountCode, reducedCode, taxPeriod: input.taxPeriod, accountingCharts: input.accountingCharts, companyAccountingCharts: input.companyAccountingCharts, mappings: input.mappings, fiscalNatures: input.fiscalNatures, fiscalRules: input.fiscalRules });
      const isConditional = resolution?.effective.irpjTreatment === "CONDITIONAL" || resolution?.effective.csllTreatment === "CONDITIONAL";
      if (isConditional && resolution) {
        const pendingItem = pushPending(buildPendingItem({
          type: "CONDITIONAL_TAX_DECISION",
          companyId: input.companyId,
          taxPeriod: input.taxPeriod,
          sourceSnapshot: input.sourceSnapshot,
          accountCode,
          reducedCode,
          description: `Movimento em conta condicional exige decisão fiscal: ${accountCode}.`,
          blocking: true,
          originData: { ...baseMetadata, pendingLabel: "ADIÇÃO / EXCLUSÃO CONDICIONAL", fiscalNatureId: resolution.fiscalNature.id, fiscalRuleId: resolution.baseRule.id, irpjTreatment: resolution.effective.irpjTreatment, csllTreatment: resolution.effective.csllTreatment, originalMode: resolution.effective.criteria.originalMode ?? null, operationalRule: resolution.effective.criteria.operationalRule ?? null } as JsonObject,
        }));
        pushDecision(decisions, { accountCode, reducedCode, description, level: "KNOWN_CONDITIONAL", autoCommit: false, blocking: true, ruleCode: resolution.baseRule.ruleCode, matchedAccountCode: accountCode, irpjTreatment: resolution.effective.irpjTreatment, csllTreatment: resolution.effective.csllTreatment, pendingItem, generatedMapping: null, generatedFiscalNature: null, generatedFiscalRule: null, metadata: baseMetadata });
        continue;
      }
      pushDecision(decisions, { accountCode, reducedCode, description, level: "KNOWN_ACCOUNT", autoCommit: false, blocking: false, ruleCode: resolution?.baseRule.ruleCode ?? null, matchedAccountCode: accountCode, irpjTreatment: resolution?.effective.irpjTreatment ?? null, csllTreatment: resolution?.effective.csllTreatment ?? null, pendingItem: null, generatedMapping: null, generatedFiscalNature: null, generatedFiscalRule: null, metadata: baseMetadata });
      continue;
    }

    const exactMatch = exactMatrixDescriptionMatch(dataset, description);
    if (exactMatch) {
      const matchedMapping = findAccountFiscalMapping({ accountingChartId: accountingChart.id, accountCode: exactMatch.accountCode, reducedCode: null, date: input.taxPeriod.endDate, mappings: input.mappings });
      if (!matchedMapping) throw new Error(`Mapeamento L1 não encontrado para ${exactMatch.accountCode}.`);
      const generated = generatedMapping({ level: "L1_EXACT", accountingChartId: accountingChart.id, accountCode, reducedCode, fiscalNatureId: matchedMapping.fiscalNatureId, validFrom: input.taxPeriod.startDate, source: { ...baseMetadata, autoOnboardingLevel: "L1_EXACT", matchedAccountCode: exactMatch.accountCode, matchedOriginalRecord: accountMetadata(exactMatch) } as JsonObject });
      generatedMappings.push(generated);
      pushDecision(decisions, { accountCode, reducedCode, description, level: "L1_EXACT", autoCommit: true, blocking: false, ruleCode: null, matchedAccountCode: exactMatch.accountCode, irpjTreatment: sourceTreatmentToFiscalTreatment(String(exactMatch.irpj), "IRPJ L1"), csllTreatment: sourceTreatmentToFiscalTreatment(String(exactMatch.csll), "CSLL L1"), pendingItem: null, generatedMapping: generated, generatedFiscalNature: null, generatedFiscalRule: null, metadata: baseMetadata });
      continue;
    }

    const blocker = matchGlobalBlocker(catalog, description);
    const l2Rule = blocker ? null : matchApprovedL2Rule(approvedL2Rules, accountCode, description);
    if (l2Rule) {
      const artifacts = buildL2Artifacts({ accountingChartId: accountingChart.id, accountCode, reducedCode, description, rule: l2Rule, validFrom: input.taxPeriod.startDate });
      generatedMappings.push(artifacts.mapping);
      generatedFiscalNatures.set(artifacts.fiscalNature.id, artifacts.fiscalNature);
      generatedFiscalRules.set(artifacts.fiscalRule.id, artifacts.fiscalRule);
      const pendingItem = pushPending(buildPendingItem({
        type: "NEW_ACCOUNT_AUTO_CLASSIFIED",
        companyId: input.companyId,
        taxPeriod: input.taxPeriod,
        sourceSnapshot: input.sourceSnapshot,
        accountCode,
        reducedCode,
        description: `Conta nova classificada automaticamente por regra L2: ${accountCode}.`,
        blocking: false,
        originData: { ...baseMetadata, pendingLabel: "CONTA NOVA", statusLabel: "OK", autoOnboardingLevel: "L2_RULE_BASED_SAFE", autoCommitted: true, catalogRuleCode: l2Rule.rule_code, irpjTreatment: artifacts.fiscalRule.irpjTreatment, csllTreatment: artifacts.fiscalRule.csllTreatment } as JsonObject,
      }));
      pushDecision(decisions, { accountCode, reducedCode, description, level: "L2_RULE_BASED_SAFE", autoCommit: true, blocking: false, ruleCode: l2Rule.rule_code, matchedAccountCode: null, irpjTreatment: artifacts.fiscalRule.irpjTreatment, csllTreatment: artifacts.fiscalRule.csllTreatment, pendingItem, generatedMapping: artifacts.mapping, generatedFiscalNature: artifacts.fiscalNature, generatedFiscalRule: artifacts.fiscalRule, metadata: baseMetadata });
      continue;
    }

    const family = matchAssistedFamily(catalog, accountCode);
    const suggestion = blocker ? null : matchL3Suggestion(catalog, description);
    const level: "L3_SUGGESTED" | "L4_REVIEW_REQUIRED" = !blocker && (family?.level === "L3" || suggestion) ? "L3_SUGGESTED" : "L4_REVIEW_REQUIRED";
    const pendingItem = pushPending(buildPendingItem({
      type: "NEW_ACCOUNT_UNMAPPED",
      companyId: input.companyId,
      taxPeriod: input.taxPeriod,
      sourceSnapshot: input.sourceSnapshot,
      accountCode,
      reducedCode,
      description: `Conta contábil movimentada sem mapeamento fiscal vigente: ${accountCode}.`,
      blocking: true,
      originData: { ...baseMetadata, pendingLabel: "CONTA NOVA", autoOnboardingLevel: level, autoCommitted: false, blocker: blocker ? (blocker as unknown as JsonObject) : null, assistedFamily: family ? (family as unknown as JsonObject) : null, suggestedCatalogRule: suggestion ? (suggestion as unknown as JsonObject) : null, suggestedIrpjTreatment: suggestion ? sourceTreatmentToFiscalTreatment(normalizedCatalogTreatment(suggestion.irpj), "IRPJ L3") : null, suggestedCsllTreatment: suggestion ? sourceTreatmentToFiscalTreatment(normalizedCatalogTreatment(suggestion.csll), "CSLL L3") : null } as JsonObject,
    }));
    pushDecision(decisions, { accountCode, reducedCode, description, level, autoCommit: false, blocking: true, ruleCode: suggestion?.rule_code ?? family?.rule_code ?? null, matchedAccountCode: null, irpjTreatment: suggestion ? sourceTreatmentToFiscalTreatment(normalizedCatalogTreatment(suggestion.irpj), "IRPJ L3") : null, csllTreatment: suggestion ? sourceTreatmentToFiscalTreatment(normalizedCatalogTreatment(suggestion.csll), "CSLL L3") : null, pendingItem, generatedMapping: null, generatedFiscalNature: null, generatedFiscalRule: null, metadata: baseMetadata });
  }

  return {
    decisions,
    pendingItems,
    generatedMappings: mergeById([], generatedMappings),
    generatedFiscalNatures: [...generatedFiscalNatures.values()],
    generatedFiscalRules: [...generatedFiscalRules.values()],
  };
}
