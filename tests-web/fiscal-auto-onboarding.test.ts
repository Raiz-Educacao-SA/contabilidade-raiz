import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AccountFiscalMapping } from "../lib/fiscal/fiscal-matrix.ts";
import type { JsonObject, SourceSnapshot, TaxPeriod } from "../lib/fiscal/types.ts";

const seedModuleUrl = new URL("../lib/fiscal/matrix-seed.ts", import.meta.url);
const CREATED_AT = "2026-08-31T12:00:00.000Z";
const COMPANY_ID = "company-a";

function period(overrides: Partial<TaxPeriod> = {}): TaxPeriod {
  return {
    id: "period-2026-m03",
    companyId: COMPANY_ID,
    fiscalYearProfileId: "profile-2026-a",
    fiscalYear: 2026,
    periodCode: "2026-M03",
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    periodType: "MONTHLY_ESTIMATE",
    status: "DRAFT",
    version: 1,
    ...overrides,
  };
}

function snapshotRecord(overrides: Partial<Record<string, string | number | null>> = {}): JsonObject {
  return {
    accountCode: "4.2.1.02.03.11",
    reducedCode: null,
    description: "Brindes e Cortesias",
    openingBalance: "0.00",
    debit: "100.00",
    credit: "0.00",
    movement: "100.00",
    closingBalance: "100.00",
    ...overrides,
  };
}

function snapshot(taxPeriod: TaxPeriod, records: readonly JsonObject[]): SourceSnapshot {
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
    totalDebit: "100.00",
    totalCredit: "0.00",
    balances: {},
    hash: "a".repeat(64),
    snapshotVersion: 1,
  };
}

async function seededRun(records: readonly JsonObject[]) {
  const { buildRaizFiscalMatrixSeed, runFiscalAutoOnboarding } = await import(seedModuleUrl.href);
  const taxPeriod = period();
  const seed = buildRaizFiscalMatrixSeed({ companyId: COMPANY_ID, fiscalYear: 2026, validFrom: "2026-01-01" });
  return runFiscalAutoOnboarding({
    companyId: COMPANY_ID,
    taxPeriod,
    sourceSnapshot: snapshot(taxPeriod, records),
    ...seed,
  });
}

test("conta conhecida da Matriz não vira NEW_ACCOUNT_UNMAPPED", async () => {
  const run = await seededRun([
    snapshotRecord({ accountCode: "4.2.1.02.03.11", description: "Brindes e Cortesias", debit: "28800.00", movement: "28800.00" }),
  ]);

  assert.equal(run.decisions.length, 1);
  assert.equal(run.decisions[0].level, "KNOWN_ACCOUNT");
  assert.equal(run.decisions[0].irpjTreatment, "ADDITION");
  assert.equal(run.decisions[0].csllTreatment, "ADDITION");
  assert.deepEqual(run.pendingItems, []);
});

test("conta condicional conhecida cria pendência de decisão do fato/movimento", async () => {
  const run = await seededRun([
    snapshotRecord({ accountCode: "4.2.1.12.01.02", description: "(-) Reversao de Provisao", credit: "25000.00", debit: "0.00", movement: "-25000.00" }),
  ]);

  assert.equal(run.decisions[0].level, "KNOWN_CONDITIONAL");
  assert.equal(run.decisions[0].blocking, true);
  assert.equal(run.pendingItems.length, 1);
  assert.equal(run.pendingItems[0].type, "CONDITIONAL_TAX_DECISION");
  assert.equal(run.pendingItems[0].blocking, true);
  assert.equal(run.pendingItems[0].originData.pendingLabel, "ADIÇÃO / EXCLUSÃO CONDICIONAL");
  assert.match(String(run.pendingItems[0].originData.operationalRule), /provisão|provisao/i);
});

test("conta realmente nova sem movimento não gera pendência", async () => {
  const run = await seededRun([
    snapshotRecord({ accountCode: "4.2.1.05.03.22", description: "Nova conta sem movimento", debit: "0.00", credit: "0.00", movement: "0.00" }),
  ]);

  assert.equal(run.decisions[0].level, "NO_REVIEW_NO_MOVEMENT");
  assert.equal(run.decisions[0].blocking, false);
  assert.deepEqual(run.pendingItems, []);
});

test("L1_EXACT usa correspondência exata aprovada sem bloquear", async () => {
  const run = await seededRun([
    snapshotRecord({ accountCode: "4.2.1.05.02.06", description: "Material de Escritório", debit: "27850.00", movement: "27850.00" }),
  ]);

  assert.equal(run.decisions[0].level, "L1_EXACT");
  assert.equal(run.decisions[0].autoCommit, true);
  assert.equal(run.decisions[0].blocking, false);
  assert.equal(run.decisions[0].matchedAccountCode, "4.2.1.03.01.03");
  assert.equal(run.generatedMappings.length, 1);
  assert.deepEqual(run.pendingItems, []);
});

test("L2_RULE_BASED_SAFE usa apenas regra Postal explicitamente aprovada", async () => {
  const run = await seededRun([
    snapshotRecord({ accountCode: "4.2.1.05.03.17", description: "Despesas com Correios e Postagens", debit: "12680.00", movement: "12680.00" }),
  ]);

  assert.equal(run.decisions[0].level, "L2_RULE_BASED_SAFE");
  assert.equal(run.decisions[0].autoCommit, true);
  assert.equal(run.decisions[0].blocking, false);
  assert.equal(run.decisions[0].ruleCode, "BASIC_OPERATING_POSTAL");
  assert.equal(run.generatedMappings.length, 1);
  assert.equal(run.generatedFiscalNatures.length, 1);
  assert.equal(run.generatedFiscalRules.length, 1);
  assert.equal(run.generatedFiscalRules[0].sourceMetadata?.canonicalEvidence, "v53/v50.3 explicit auto_commit=true");
  assert.equal(run.pendingItems.length, 1);
  assert.equal(run.pendingItems[0].type, "NEW_ACCOUNT_AUTO_CLASSIFIED");
  assert.equal(run.pendingItems[0].blocking, false);
  assert.equal(run.pendingItems[0].originData.statusLabel, "OK");
});

test("L2_RULE_BASED_SAFE mantém IPTU como regra aprovada", async () => {
  const run = await seededRun([
    snapshotRecord({ accountCode: "4.2.1.04.01.991", description: "IPTU unidade escolar", debit: "9800.00", movement: "9800.00" }),
  ]);

  assert.equal(run.decisions[0].level, "L2_RULE_BASED_SAFE");
  assert.equal(run.decisions[0].autoCommit, true);
  assert.equal(run.decisions[0].blocking, false);
  assert.equal(run.decisions[0].ruleCode, "BASIC_OPERATING_IPTU");
  assert.equal(run.decisions[0].irpjTreatment, "NO_ADJUSTMENT");
  assert.equal(run.decisions[0].csllTreatment, "NO_ADJUSTMENT");
});

test("candidato L2 sem aprovação explícita não auto-commita", async () => {
  const run = await seededRun([
    snapshotRecord({ accountCode: "4.2.1.03.01.991", description: "Material de papelaria administrativa", debit: "12680.00", movement: "12680.00" }),
  ]);

  assert.equal(run.decisions[0].level, "L3_SUGGESTED");
  assert.equal(run.decisions[0].autoCommit, false);
  assert.equal(run.decisions[0].blocking, true);
  assert.equal(run.generatedMappings.length, 0);
  assert.equal(run.generatedFiscalNatures.length, 0);
  assert.equal(run.generatedFiscalRules.length, 0);
  assert.equal(run.pendingItems.length, 1);
  assert.equal(run.pendingItems[0].type, "NEW_ACCOUNT_UNMAPPED");
  assert.equal(run.pendingItems[0].originData.suggestedCatalogRule?.rule_code, "BASIC_MATERIAL_CONSUMPTION");
});
test("L3_SUGGESTED bloqueia e exige aprovação humana", async () => {
  const run = await seededRun([
    snapshotRecord({ accountCode: "4.2.1.02.03.991", description: "Evento institucional de captacao", debit: "18450.00", movement: "18450.00" }),
  ]);

  assert.equal(run.decisions[0].level, "L3_SUGGESTED");
  assert.equal(run.decisions[0].autoCommit, false);
  assert.equal(run.decisions[0].blocking, true);
  assert.equal(run.pendingItems.length, 1);
  assert.equal(run.pendingItems[0].type, "NEW_ACCOUNT_UNMAPPED");
  assert.equal(run.pendingItems[0].blocking, true);
  assert.equal(run.pendingItems[0].originData.autoOnboardingLevel, "L3_SUGGESTED");
});

test("L4_REVIEW_REQUIRED bloqueia e categoria sensível não vira L2 por descrição", async () => {
  const run = await seededRun([
    snapshotRecord({ accountCode: "4.2.1.03.01.98", description: "Material de papelaria com multa", debit: "1250.00", movement: "1250.00" }),
  ]);

  assert.equal(run.decisions[0].level, "L4_REVIEW_REQUIRED");
  assert.equal(run.decisions[0].autoCommit, false);
  assert.equal(run.decisions[0].blocking, true);
  assert.equal(run.generatedMappings.length, 0);
  assert.equal(run.generatedFiscalRules.length, 0);
  assert.equal(run.pendingItems[0].originData.autoOnboardingLevel, "L4_REVIEW_REQUIRED");
  assert.match(JSON.stringify(run.pendingItems[0].originData.blocker), /multa/i);
});

test("Auto-Onboarding é idempotente para artefatos e pendências", async () => {
  const { buildRaizFiscalMatrixSeed, runFiscalAutoOnboarding } = await import(seedModuleUrl.href);
  const taxPeriod = period({ id: "period-idempotent-auto" });
  const seed = buildRaizFiscalMatrixSeed({ companyId: COMPANY_ID, fiscalYear: 2026, validFrom: "2026-01-01" });
  const sourceSnapshot = snapshot(taxPeriod, [
    snapshotRecord({ accountCode: "4.2.1.05.03.17", description: "Despesas com Correios e Postagens", debit: "12680.00", movement: "12680.00" }),
  ]);
  const first = runFiscalAutoOnboarding({ companyId: COMPANY_ID, taxPeriod, sourceSnapshot, ...seed });
  const second = runFiscalAutoOnboarding({ companyId: COMPANY_ID, taxPeriod, sourceSnapshot, ...seed, existingPendingItems: first.pendingItems });

  assert.deepEqual(first.generatedMappings.map((mapping: AccountFiscalMapping) => mapping.id), second.generatedMappings.map((mapping: AccountFiscalMapping) => mapping.id));
  assert.equal(first.pendingItems.length, 1);
  assert.deepEqual(second.pendingItems, []);
});

test("fixtures v52.2 e casos H03/H04/H05/H06/H15 da suíte v52.3 estão disponíveis", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/fiscal/v52_2/auto-onboarding-l1-l4.json", import.meta.url), "utf8")) as { fixture_version: string; accounts: { level: string }[] };
  const suite = JSON.parse(readFileSync(new URL("./fixtures/fiscal/v52_3/acceptance-suite-irpj-csll-v52_3.json", import.meta.url), "utf8")) as { cases: { id: string; pre_codex_readiness: string }[] };
  const applicable = suite.cases.filter((item) => ["H03", "H04", "H05", "H06", "H15"].includes(item.id));

  assert.equal(fixture.fixture_version, "v52.2");
  assert.deepEqual(fixture.accounts.map((account) => account.level), [
    "L1_EXACT",
    "L2_RULE_BASED_SAFE",
    "L3_SUGGESTED",
    "L4_REVIEW_REQUIRED",
    "L4_REVIEW_REQUIRED",
    "NO_REVIEW_NO_MOVEMENT",
  ]);
  assert.deepEqual(applicable.map((item) => item.id), ["H03", "H04", "H05", "H06", "H15"]);
});
