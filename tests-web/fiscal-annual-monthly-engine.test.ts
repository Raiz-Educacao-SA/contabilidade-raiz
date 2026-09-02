import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateAnnualMonthly,
  type CalculateAnnualMonthlyInput,
  type FiscalBalanceAvailable,
  type FiscalCreditAvailable,
  type TaxCalculation,
  type TaxCalculationVersionStatus,
} from "../lib/fiscal/annual-monthly-engine.ts";
import type { PendingItem, TaxAdjustment } from "../lib/fiscal/fiscal-matrix.ts";
import type {
  FiscalYearProfile,
  JsonObject,
  SourceSnapshot,
  TaxPeriod,
} from "../lib/fiscal/types.ts";

const COMPANY_ID = "empresa-raiz";
const PROFILE_ID = "profile-2026-annual";
const MATRIX_VERSION = "v53";
const CREATED_AT = "2026-09-01T12:00:00.000Z";

type FixtureTax = {
  accounting_result?: number;
  additions?: number;
  exclusions?: number;
  pre_compensation_base: number;
  compensation_used: number;
  taxable_base: number;
  normal_tax?: number;
  additional_tax?: number;
  tax_due_cumulative: number;
  prior_estimate_tax_due: number;
  withholding_used: number;
  current_month_tax_payable: number;
};

type FixtureMonth = {
  competence: string;
  version: number;
  status: TaxCalculationVersionStatus;
  irpj: FixtureTax & {
    accounting_result: number;
    additions: number;
    exclusions: number;
    normal_tax: number;
    additional_tax: number;
  };
  csll: FixtureTax;
};

type AnnualFixture = {
  fixture: string;
  fiscal_year: number;
  company_id: string;
  profile: { regime: "REAL_PROFIT"; periodicity: "ANNUAL" };
  months: FixtureMonth[];
};

const annualChain = JSON.parse(
  readFileSync(
    new URL("./fixtures/fiscal/v52_2/annual-monthly-chain-2026.json", import.meta.url),
    "utf8",
  ),
) as AnnualFixture;

const FIXTURE_ID = annualChain.fixture;

function money(value: number | string): string {
  return typeof value === "number" ? value.toFixed(2) : Number(value).toFixed(2);
}

function assertMoney(actual: string, expected: number | string): void {
  assert.equal(actual, money(expected));
}

function monthFixture(index: number): FixtureMonth {
  const fixture = annualChain.months[index];
  assert.ok(fixture, `fixture month ${index + 1} exists`);
  return fixture;
}

function annualProfile(overrides: Partial<FiscalYearProfile> = {}): FiscalYearProfile {
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
    ...overrides,
  };
}

function monthlyPeriod(month: number): TaxPeriod {
  const mm = String(month).padStart(2, "0");
  const endDate = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);

  return {
    id: `period-2026-m${mm}`,
    companyId: COMPANY_ID,
    fiscalYearProfileId: PROFILE_ID,
    fiscalYear: 2026,
    periodCode: `2026-M${mm}`,
    startDate: "2026-01-01",
    endDate,
    periodType: "MONTHLY_ESTIMATE",
    status: "DRAFT",
    version: 1,
    createdAt: CREATED_AT,
  };
}

function quarterPeriod(quarter: number): TaxPeriod {
  const ranges = [
    ["01-01", "03-31"],
    ["04-01", "06-30"],
    ["07-01", "09-30"],
    ["10-01", "12-31"],
  ] as const;
  const [start, end] = ranges[quarter - 1] ?? ranges[0];
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

function snapshotFor(period: TaxPeriod): SourceSnapshot {
  return {
    id: `snapshot-${period.periodCode.toLowerCase()}`,
    companyId: COMPANY_ID,
    externalCompanyRef: "1",
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
    recordCount: 8,
    records: [],
    totalDebit: "0.00",
    totalCredit: "0.00",
    balances: [],
    hash: "a".repeat(64),
    snapshotVersion: 1,
    createdAt: CREATED_AT,
  };
}

function adjustmentFor(
  period: TaxPeriod,
  snapshot: SourceSnapshot,
  tax: "IRPJ" | "CSLL",
  adjustmentType: "ADDITION" | "EXCLUSION",
  value: number,
  suffix: string,
): TaxAdjustment {
  return {
    id: `adjustment-${period.periodCode}-${tax}-${adjustmentType}-${suffix}`,
    companyId: COMPANY_ID,
    taxPeriodId: period.id,
    sourceSnapshotId: snapshot.id,
    ruleExecutionResultId: `rer-${period.periodCode}-${tax}-${suffix}`,
    tax,
    adjustmentType,
    accountCode: `4.2.1.99.${suffix}`,
    reducedCode: null,
    fiscalNatureId: `nature-${tax}-${suffix}`,
    fiscalRuleId: `rule-${tax}-${adjustmentType}-${suffix}`,
    fiscalRuleVersion: 1,
    value: money(value),
    origin: "RULE_EXECUTION_RESULT",
    status: "READY",
    logicalKey: `${period.periodCode}:${tax}:${adjustmentType}:${suffix}`,
    createdAt: CREATED_AT,
  };
}

function fixtureAdjustments(period: TaxPeriod, snapshot: SourceSnapshot, fixture: FixtureMonth): TaxAdjustment[] {
  const adjustments: TaxAdjustment[] = [];
  if (fixture.irpj.additions > 0) {
    adjustments.push(adjustmentFor(period, snapshot, "IRPJ", "ADDITION", fixture.irpj.additions, "irpj-add"));
  }
  if (fixture.irpj.exclusions > 0) {
    adjustments.push(adjustmentFor(period, snapshot, "IRPJ", "EXCLUSION", fixture.irpj.exclusions, "irpj-exc"));
  }

  if (fixture.csll.additions !== undefined || fixture.csll.exclusions !== undefined) {
    if ((fixture.csll.additions ?? 0) > 0) adjustments.push(adjustmentFor(period, snapshot, "CSLL", "ADDITION", fixture.csll.additions ?? 0, "csll-add"));
    if ((fixture.csll.exclusions ?? 0) > 0) adjustments.push(adjustmentFor(period, snapshot, "CSLL", "EXCLUSION", fixture.csll.exclusions ?? 0, "csll-exc"));
    return adjustments;
  }

  const csllDiff = fixture.csll.pre_compensation_base - fixture.irpj.accounting_result;
  if (csllDiff > 0) {
    adjustments.push(adjustmentFor(period, snapshot, "CSLL", "ADDITION", csllDiff, "csll-add"));
  }
  if (csllDiff < 0) {
    adjustments.push(adjustmentFor(period, snapshot, "CSLL", "EXCLUSION", Math.abs(csllDiff), "csll-exc"));
  }

  return adjustments;
}
function fixtureBalances(fixture: FixtureMonth): FiscalBalanceAvailable[] {
  return [
    {
      id: `pf-${fixture.competence}`,
      tax: "IRPJ",
      balanceType: "PREJUIZO_FISCAL",
      originYear: 2025,
      availableAmount: money(fixture.irpj.compensation_used),
      source: { fixture: FIXTURE_ID },
    },
    {
      id: `bn-${fixture.competence}`,
      tax: "CSLL",
      balanceType: "BASE_NEGATIVA_CSLL",
      originYear: 2025,
      availableAmount: money(fixture.csll.compensation_used),
      source: { fixture: FIXTURE_ID },
    },
  ];
}

function fixtureCredits(fixture: FixtureMonth): FiscalCreditAvailable[] {
  const credits: FiscalCreditAvailable[] = [];

  if (fixture.irpj.withholding_used > 0) {
    credits.push({
      id: `irrf-servicos-${fixture.competence}`,
      tax: "IRPJ",
      nature: "IRRF_SERVICOS",
      availableAmount: money(fixture.irpj.withholding_used),
      source: { fixture: FIXTURE_ID },
    });
  }

  if (fixture.csll.withholding_used > 0) {
    credits.push({
      id: `csll-deducao-${fixture.competence}`,
      tax: "CSLL",
      nature: "CSLL_EXPLICIT_DEDUCTION",
      availableAmount: money(fixture.csll.withholding_used),
      source: { fixture: FIXTURE_ID, sourceDocument: `explicit-${fixture.competence}` },
    });
  }

  return credits;
}

type InputOverrides = {
  month?: number;
  profile?: FiscalYearProfile;
  taxPeriod?: TaxPeriod;
  sourceSnapshot?: SourceSnapshot;
  accounting?: number | string;
  accountingByTax?: Partial<Record<"IRPJ" | "CSLL", number | string>>;
  taxAdjustments?: TaxAdjustment[];
  fiscalBalances?: FiscalBalanceAvailable[];
  taxCredits?: FiscalCreditAvailable[];
  priorCalculations?: TaxCalculation[];
  pendingItems?: PendingItem[];
  versionStatus?: TaxCalculationVersionStatus;
  payments?: JsonObject[];
};

function inputFor(overrides: InputOverrides = {}): CalculateAnnualMonthlyInput {
  const period = overrides.taxPeriod ?? monthlyPeriod(overrides.month ?? 1);
  const snapshot = overrides.sourceSnapshot ?? snapshotFor(period);
  const accountingByTax = overrides.accountingByTax;
  const accountingResultYtdByTax = accountingByTax
    ? {
        IRPJ: {
          value: money(accountingByTax.IRPJ ?? overrides.accounting ?? 0),
          source: { sourceSnapshotId: snapshot.id, source: "SNAPSHOT_BALANCE", tax: "IRPJ", evidence: { fixture: true } },
        },
        CSLL: {
          value: money(accountingByTax.CSLL ?? overrides.accounting ?? 0),
          source: { sourceSnapshotId: snapshot.id, source: "SNAPSHOT_BALANCE", tax: "CSLL", evidence: { fixture: true } },
        },
      }
    : undefined;

  return {
    companyId: COMPANY_ID,
    fiscalYearProfile: overrides.profile ?? annualProfile(),
    taxPeriod: period,
    sourceSnapshot: snapshot,
    accountingResultYtd: {
      value: money(overrides.accounting ?? 0),
      source: {
        sourceSnapshotId: snapshot.id,
        source: "SNAPSHOT_BALANCE",
        evidence: { fixture: true },
      },
    },
    accountingResultYtdByTax,
    taxAdjustments: overrides.taxAdjustments ?? [],
    fiscalBalances: overrides.fiscalBalances ?? [],
    taxCredits: overrides.taxCredits ?? [],
    priorCalculations: overrides.priorCalculations ?? [],
    pendingItems: overrides.pendingItems ?? [],
    payments: overrides.payments ?? [],
    matrixVersion: MATRIX_VERSION,
    calculationVersion: 1,
    versionStatus: overrides.versionStatus ?? "DRAFT",
    createdAt: CREATED_AT,
  };
}

function inputForFixture(
  fixture: FixtureMonth,
  priorCalculations: TaxCalculation[] = [],
  versionStatus: TaxCalculationVersionStatus = "CLOSED_CURRENT",
): CalculateAnnualMonthlyInput {
  const month = Number(fixture.competence.slice(-2));
  const period = monthlyPeriod(month);
  const snapshot = snapshotFor(period);

  return inputFor({
    taxPeriod: period,
    sourceSnapshot: snapshot,
    accounting: fixture.irpj.accounting_result,
    accountingByTax: { IRPJ: fixture.irpj.accounting_result, CSLL: fixture.csll.accounting_result ?? fixture.irpj.accounting_result },
    taxAdjustments: fixtureAdjustments(period, snapshot, fixture),
    fiscalBalances: fixtureBalances(fixture),
    taxCredits: fixtureCredits(fixture),
    priorCalculations,
    versionStatus,
  });
}

function calculationFrom(input: CalculateAnnualMonthlyInput): TaxCalculation {
  const result = calculateAnnualMonthly(input);
  assert.notEqual(result.taxCalculation, null, "calculation should be returned");
  return result.taxCalculation as TaxCalculation;
}

function fixtureCalculation(
  monthIndex: number,
  priorCalculations: TaxCalculation[] = [],
  versionStatus: TaxCalculationVersionStatus = "CLOSED_CURRENT",
): TaxCalculation {
  return calculationFrom(inputForFixture(monthFixture(monthIndex), priorCalculations, versionStatus));
}

function asPrior(
  calculation: TaxCalculation,
  versionStatus: TaxCalculationVersionStatus,
  payable = "999999.00",
): TaxCalculation {
  return {
    ...calculation,
    id: `${calculation.id}-${versionStatus.toLowerCase()}`,
    versionStatus,
    irpj: { ...calculation.irpj, currentMonthTaxPayable: payable },
    csll: { ...calculation.csll, currentMonthTaxPayable: payable },
  };
}

function assertIrpj(calculation: TaxCalculation, expected: FixtureMonth["irpj"]): void {
  assertMoney(calculation.irpj.accountingResultYtd, expected.accounting_result);
  assertMoney(calculation.irpj.totalAdditions, expected.additions);
  assertMoney(calculation.irpj.totalExclusions, expected.exclusions);
  assertMoney(calculation.irpj.baseBeforeCompensation, expected.pre_compensation_base);
  assertMoney(calculation.irpj.compensationUsed, expected.compensation_used);
  assertMoney(calculation.irpj.taxableBase, expected.taxable_base);
  assertMoney(calculation.irpj.normalTax, expected.normal_tax);
  assertMoney(calculation.irpj.additionalTax, expected.additional_tax);
  assertMoney(calculation.irpj.taxDueCumulative, expected.tax_due_cumulative);
  assertMoney(calculation.irpj.priorEstimateTaxDue, expected.prior_estimate_tax_due);
  assertMoney(calculation.irpj.eligibleCreditsUsed, expected.withholding_used);
  assertMoney(calculation.irpj.currentMonthTaxPayable, expected.current_month_tax_payable);
}

function assertCsll(calculation: TaxCalculation, expected: FixtureMonth["csll"]): void {
  if (expected.accounting_result !== undefined) assertMoney(calculation.csll.accountingResultYtd, expected.accounting_result);
  if (expected.additions !== undefined) assertMoney(calculation.csll.totalAdditions, expected.additions);
  if (expected.exclusions !== undefined) assertMoney(calculation.csll.totalExclusions, expected.exclusions);
  assertMoney(calculation.csll.baseBeforeCompensation, expected.pre_compensation_base);
  assertMoney(calculation.csll.compensationUsed, expected.compensation_used);
  assertMoney(calculation.csll.taxableBase, expected.taxable_base);
  assertMoney(calculation.csll.normalTax, expected.tax_due_cumulative);
  assertMoney(calculation.csll.taxDueCumulative, expected.tax_due_cumulative);
  assertMoney(calculation.csll.priorEstimateTaxDue, expected.prior_estimate_tax_due);
  assertMoney(calculation.csll.eligibleCreditsUsed, expected.withholding_used);
  assertMoney(calculation.csll.currentMonthTaxPayable, expected.current_month_tax_payable);
}
function credit(
  id: string,
  tax: "IRPJ" | "CSLL",
  nature: FiscalCreditAvailable["nature"],
  amount: number,
  source: JsonObject = { fixture: true },
): FiscalCreditAvailable {
  return { id, tax, nature, availableAmount: money(amount), source };
}

function balance(
  id: string,
  tax: "IRPJ" | "CSLL",
  balanceType: FiscalBalanceAvailable["balanceType"],
  amount: number,
  originYear = 2025,
): FiscalBalanceAvailable {
  return {
    id,
    tax,
    balanceType,
    originYear,
    availableAmount: money(amount),
    source: { fixture: true },
  };
}

function pendingItem(period: TaxPeriod): PendingItem {
  return {
    id: `pending-${period.periodCode}`,
    companyId: COMPANY_ID,
    taxPeriodId: period.id,
    sourceSnapshotId: `snapshot-${period.periodCode.toLowerCase()}`,
    type: "NEW_ACCOUNT_UNMAPPED",
    status: "OPEN",
    blocking: false,
    logicalKey: `pending:${period.periodCode}:4.2.1.99.999`,
    description: "Conta pendente de matriz",
    originData: { accountCode: "4.2.1.99.999", fixture: true },
    createdAt: CREATED_AT,
  };
}

test("H10/H11 calcula cadeia Jan-Fev-Mar ANNUAL_MONTHLY com fixture v52.2", () => {
  const jan = fixtureCalculation(0);
  const feb = fixtureCalculation(1, [jan]);
  const mar = fixtureCalculation(2, [jan, feb]);

  assert.equal(jan.status, "CALCULATED");
  assert.equal(feb.status, "CALCULATED");
  assert.equal(mar.status, "CALCULATED");

  assertIrpj(jan, monthFixture(0).irpj);
  assertIrpj(feb, monthFixture(1).irpj);
  assertIrpj(mar, monthFixture(2).irpj);
  assertCsll(mar, monthFixture(2).csll);

  assert.deepEqual(mar.priorCalculationIds, [jan.id, feb.id].sort());
  const memoryTaxPeriod = mar.memory.taxPeriod as JsonObject;
  assert.equal(memoryTaxPeriod.periodCode, "2026-M03");
});

test("H10 usa accountingResultYtd explícito e não fabrica resultado por contas da matriz", () => {
  const calc = calculationFrom(inputFor({ month: 1, accounting: 100000 }));

  assertMoney(calc.irpj.accountingResultYtd, 100000);
  assertMoney(calc.irpj.totalAdditions, 0);
  assertMoney(calc.irpj.totalExclusions, 0);
  assertMoney(calc.irpj.baseBeforeCompensation, 100000);
  assert.deepEqual(calc.accountingResultSource, {
    sourceSnapshotId: "snapshot-2026-m01",
    source: "SNAPSHOT_BALANCE",
    evidence: { fixture: true },
  });
});


test("H10 aceita resultados contábeis distintos antes de IRPJ e CSLL", () => {
  const calc = calculationFrom(inputFor({
    month: 1,
    accounting: 100000,
    accountingByTax: { IRPJ: 100000, CSLL: 120000 },
  }));

  assertMoney(calc.irpj.accountingResultYtd, 100000);
  assertMoney(calc.csll.accountingResultYtd, 120000);
  assertMoney(calc.irpj.baseBeforeCompensation, 100000);
  assertMoney(calc.csll.baseBeforeCompensation, 120000);
  assertMoney(calc.csll.taxDueCumulative, 10800);
  assert.deepEqual(calc.accountingResultSource, {
    IRPJ: { sourceSnapshotId: "snapshot-2026-m01", source: "SNAPSHOT_BALANCE", tax: "IRPJ", evidence: { fixture: true } },
    CSLL: { sourceSnapshotId: "snapshot-2026-m01", source: "SNAPSHOT_BALANCE", tax: "CSLL", evidence: { fixture: true } },
  });
});
test("H10 usa somente TAX_ADJUSTMENT para adições e exclusões", () => {
  const period = monthlyPeriod(1);
  const snapshot = snapshotFor(period);
  const calc = calculationFrom(
    inputFor({
      taxPeriod: period,
      sourceSnapshot: snapshot,
      accounting: 100000,
      taxAdjustments: [
        adjustmentFor(period, snapshot, "IRPJ", "ADDITION", 30000, "a"),
        adjustmentFor(period, snapshot, "IRPJ", "EXCLUSION", 10000, "e"),
        { ...adjustmentFor(period, snapshot, "IRPJ", "ADDITION", 99999, "sup"), status: "SUPERSEDED" },
      ],
    }),
  );

  assertMoney(calc.irpj.baseBeforeCompensation, 120000);
  assertMoney(calc.irpj.totalAdditions, 30000);
  assertMoney(calc.irpj.totalExclusions, 10000);
});

test("H10 aplica limite de 30% quando prejuízo fiscal disponível é maior que o limite", () => {
  const calc = calculationFrom(
    inputFor({
      accounting: 100000,
      fiscalBalances: [balance("pf-large", "IRPJ", "PREJUIZO_FISCAL", 90000)],
    }),
  );

  assertMoney(calc.irpj.maxCompensation, 30000);
  assertMoney(calc.irpj.compensationUsed, 30000);
  assertMoney(calc.irpj.taxableBase, 70000);
});

test("H10 usa prejuízo fiscal disponível quando menor que limite", () => {
  const calc = calculationFrom(
    inputFor({
      accounting: 100000,
      fiscalBalances: [balance("pf-small", "IRPJ", "PREJUIZO_FISCAL", 10000)],
    }),
  );

  assertMoney(calc.irpj.maxCompensation, 30000);
  assertMoney(calc.irpj.compensationUsed, 10000);
  assertMoney(calc.irpj.taxableBase, 90000);
});

test("H10 mantém PF e base negativa da CSLL independentes e sem cruzamento entre tributos", () => {
  const calc = calculationFrom(
    inputFor({
      accounting: 100000,
      fiscalBalances: [
        balance("pf", "IRPJ", "PREJUIZO_FISCAL", 30000),
        balance("bn", "CSLL", "BASE_NEGATIVA_CSLL", 10000),
      ],
    }),
  );

  assertMoney(calc.irpj.compensationUsed, 30000);
  assertMoney(calc.csll.compensationUsed, 10000);
  assert.equal(calc.fiscalBalanceUsages.find((usage) => usage.balanceId === "pf")?.tax, "IRPJ");
  assert.equal(calc.fiscalBalanceUsages.find((usage) => usage.balanceId === "bn")?.tax, "CSLL");
});

test("H10 não cria imposto quando a base fiscal acumulada é negativa", () => {
  const calc = calculationFrom(inputFor({ accounting: -100000 }));

  assertMoney(calc.irpj.rawBaseAfterCompensation, -100000);
  assertMoney(calc.irpj.taxableBase, 0);
  assertMoney(calc.irpj.taxDueCumulative, 0);
  assertMoney(calc.csll.taxableBase, 0);
  assertMoney(calc.csll.taxDueCumulative, 0);
});

test("H10 calcula adicional de IRPJ com limite mensal acumulado", () => {
  const jan = calculationFrom(inputFor({ month: 1, accounting: 100000 }));
  const mar = calculationFrom(inputFor({ month: 3, accounting: 100000 }));

  assertMoney(String(jan.irpj.rates.additionalThreshold), 20000);
  assertMoney(jan.irpj.additionalTax, 8000);
  assertMoney(String(mar.irpj.rates.additionalThreshold), 60000);
  assertMoney(mar.irpj.additionalTax, 4000);
});

test("H10 calcula CSLL a 9% versionável", () => {
  const calc = calculationFrom(inputFor({ accounting: 100000 }));

  assertMoney(calc.csll.normalTax, 9000);
  assertMoney(calc.csll.taxDueCumulative, 9000);
  assert.equal(calc.csll.rates.normalRateBps, 900);
});

test("H11 ignora versão DRAFT como estimativa anterior oficial", () => {
  const janDraft = fixtureCalculation(0, [], "DRAFT");
  const feb = calculationFrom(inputForFixture(monthFixture(1), [janDraft]));

  assert.equal(feb.status, "VALIDATION_REQUIRED");
  assertMoney(feb.irpj.priorEstimateTaxDue, 0);
  assertMoney(feb.csll.priorEstimateTaxDue, 0);
  assert.equal(feb.priorCalculationIds.length, 0);
  assert.ok(feb.validationIssues.some((issue) => issue.code === "MISSING_CLOSED_CURRENT_PRIOR_ESTIMATE"));
});

test("H11 ignora versão CLOSED_SUPERSEDED como estimativa anterior oficial", () => {
  const jan = fixtureCalculation(0);
  const janSuperseded = asPrior(jan, "CLOSED_SUPERSEDED");
  const feb = calculationFrom(inputForFixture(monthFixture(1), [janSuperseded]));

  assert.equal(feb.status, "VALIDATION_REQUIRED");
  assertMoney(feb.irpj.priorEstimateTaxDue, 0);
  assertMoney(feb.csll.priorEstimateTaxDue, 0);
});

test("H11 considera somente CLOSED_CURRENT e soma currentMonthTaxPayable oficial anterior", () => {
  const jan = fixtureCalculation(0);
  const feb = calculationFrom(
    inputForFixture(monthFixture(1), [asPrior(jan, "DRAFT"), asPrior(jan, "CLOSED_SUPERSEDED"), jan]),
  );

  assert.equal(feb.status, "CALCULATED");
  assertMoney(feb.irpj.priorEstimateTaxDue, 55000);
  assertMoney(feb.csll.priorEstimateTaxDue, 23300);
  assert.deepEqual(feb.priorCalculationIds, [jan.id]);
});

test("H11 pagamentos, DARF ou parcelamentos não alteram estimativa anterior", () => {
  const jan = fixtureCalculation(0);
  const withoutPayment = calculationFrom(inputForFixture(monthFixture(1), [jan]));
  const withLatePayment = calculationFrom({
    ...inputForFixture(monthFixture(1), [jan]),
    payments: [{ kind: "DARF", paidAt: "2026-04-30", value: "999999.00" }],
  });

  assert.equal(withLatePayment.logicalKey, withoutPayment.logicalKey);
  assertMoney(withLatePayment.irpj.priorEstimateTaxDue, 55000);
  assertMoney(withLatePayment.irpj.currentMonthTaxPayable, 73500);
});

test("H12/H13 segrega IRRF Serviços e IRRF Aplicações Financeiras", () => {
  const period = monthlyPeriod(3);
  const sourceSnapshot = snapshotFor(period);
  const calc = calculationFrom(
    inputFor({
      taxPeriod: period,
      sourceSnapshot,
      accounting: 500000,
      taxCredits: [
        credit("irrf-serv", "IRPJ", "IRRF_SERVICOS", 32000, { document: "servicos" }),
        credit("irrf-aplic", "IRPJ", "IRRF_APLICACOES_FINANCEIRAS", 24000, { document: "aplicacoes" }),
      ],
    }),
  );

  const services = calc.creditUsages.find((usage) => usage.creditId === "irrf-serv");
  const applications = calc.creditUsages.find((usage) => usage.creditId === "irrf-aplic");
  assert.equal(services?.nature, "IRRF_SERVICOS");
  assert.equal(services?.label, "IRRF – Serviços");
  assert.equal(applications?.nature, "IRRF_APLICACOES_FINANCEIRAS");
  assert.equal(applications?.label, "IRRF – Aplicações Financeiras");
  assertMoney(calc.irpj.eligibleCreditsUsed, 56000);
  assertMoney(services?.remaining ?? "0.00", 0);
  assertMoney(applications?.remaining ?? "0.00", 0);
});

test("H12/H13 crédito excedente zera imposto mensal sem gerar valor negativo", () => {
  const calc = calculationFrom(
    inputFor({
      accounting: 100000,
      taxCredits: [credit("irrf-excesso", "IRPJ", "IRRF_SERVICOS", 50000)],
    }),
  );

  assertMoney(calc.irpj.taxDueCumulative, 23000);
  assertMoney(calc.irpj.eligibleCreditsUsed, 23000);
  assertMoney(calc.irpj.currentMonthTaxPayable, 0);
  assertMoney(calc.creditUsages[0]?.remaining ?? "0.00", 27000);
});

test("H12/H13 impede uso duplicado do mesmo crédito fiscal", () => {
  assert.throws(
    () =>
      calculationFrom(
        inputFor({
          accounting: 100000,
          taxCredits: [
            credit("duplicado", "IRPJ", "IRRF_SERVICOS", 1000),
            credit("duplicado", "IRPJ", "IRRF_APLICACOES_FINANCEIRAS", 1000),
          ],
        }),
      ),
    /duplicado/,
  );
});

test("H13 exige fonte explícita para dedução segregada de CSLL", () => {
  assert.throws(
    () =>
      calculationFrom(
        inputFor({
          accounting: 100000,
          taxCredits: [credit("csll-sem-fonte", "CSLL", "CSLL_EXPLICIT_DEDUCTION", 1000, {})],
        }),
      ),
    /fonte rastreável/i,
  );
});

test("H13 usa somente dedução explícita segregada na CSLL", () => {
  const jan = fixtureCalculation(0);
  const feb = fixtureCalculation(1, [jan]);
  const mar = fixtureCalculation(2, [jan, feb]);

  const csllCredit = mar.creditUsages.find((usage) => usage.tax === "CSLL");
  assert.equal(csllCredit?.nature, "CSLL_EXPLICIT_DEDUCTION");
  assertMoney(mar.csll.eligibleCreditsUsed, 4000);
  assertMoney(mar.csll.currentMonthTaxPayable, 25900);
});

test("pendências abertas não bloqueiam cálculo provisional e marcam CALCULATED_WITH_PENDING_ITEMS", () => {
  const period = monthlyPeriod(1);
  const calc = calculationFrom(
    inputFor({
      taxPeriod: period,
      sourceSnapshot: snapshotFor(period),
      accounting: 100000,
      pendingItems: [pendingItem(period)],
    }),
  );

  assert.equal(calc.status, "CALCULATED_WITH_PENDING_ITEMS");
  assert.deepEqual(calc.memory.pendingItems, [
    { logicalKey: `pending:${period.periodCode}:4.2.1.99.999`, type: "NEW_ACCOUNT_UNMAPPED", blocking: false },
  ]);
});

test("entrada idêntica produz cálculo determinístico e idempotente", () => {
  const input = inputFor({
    accounting: 100000,
    fiscalBalances: [balance("pf-det", "IRPJ", "PREJUIZO_FISCAL", 10000)],
    taxCredits: [credit("irrf-det", "IRPJ", "IRRF_SERVICOS", 1000)],
  });

  const first = calculationFrom(input);
  const second = calculationFrom(input);

  assert.equal(second.id, first.id);
  assert.equal(second.logicalKey, first.logicalKey);
  assert.deepEqual(second.fiscalBalanceUsages, first.fiscalBalanceUsages);
  assert.deepEqual(second.creditUsages, first.creditUsages);
});

test("reprocessamento oficial no mesmo escopo não duplica consumo de PF ou créditos", () => {
  const first = calculationFrom(
    inputFor({
      accounting: 100000,
      fiscalBalances: [balance("pf-reprocess", "IRPJ", "PREJUIZO_FISCAL", 10000)],
      taxCredits: [credit("irrf-reprocess", "IRPJ", "IRRF_SERVICOS", 1000)],
      versionStatus: "REVIEW",
    }),
  );
  const second = calculationFrom(
    inputFor({
      accounting: 100000,
      fiscalBalances: [balance("pf-reprocess", "IRPJ", "PREJUIZO_FISCAL", 10000)],
      taxCredits: [credit("irrf-reprocess", "IRPJ", "IRRF_SERVICOS", 1000)],
      versionStatus: "REVIEW",
    }),
  );

  assert.deepEqual(
    second.fiscalBalanceUsages.map((usage) => usage.id),
    first.fiscalBalanceUsages.map((usage) => usage.id),
  );
  assert.deepEqual(
    second.creditUsages.map((usage) => usage.id),
    first.creditUsages.map((usage) => usage.id),
  );
});

test("perfil trimestral preserva infraestrutura e retorna ENGINE_NOT_ENABLED_FOR_REGIME", () => {
  const period = quarterPeriod(1);
  const result = calculateAnnualMonthly(
    inputFor({
      profile: annualProfile({ periodicity: "QUARTERLY" }),
      taxPeriod: period,
      sourceSnapshot: snapshotFor(period),
      accounting: 100000,
    }),
  );

  assert.equal(result.status, "ENGINE_NOT_ENABLED_FOR_REGIME");
  assert.equal(result.errorCode, "ENGINE_NOT_ENABLED_FOR_REGIME");
  assert.equal(result.taxCalculation, null);
});
