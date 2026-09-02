import assert from "node:assert/strict";
import test from "node:test";
import type { AccountFiscalMapping, FiscalRule } from "../lib/fiscal/fiscal-matrix.ts";
import type { RaizTaxMatrixAccount } from "../lib/fiscal/matrix-seed.ts";

const seedModuleUrl = new URL("../lib/fiscal/matrix-seed.ts", import.meta.url);

function countBy<T extends string>(values: readonly T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

test("Matriz Fiscal v53 reconcilia 454 contas e distribuição canônica", async () => {
  const { loadRaizTaxMatrixV53, validateRaizTaxMatrixV53 } = await import(seedModuleUrl.href);
  const dataset = loadRaizTaxMatrixV53();
  const validation = validateRaizTaxMatrixV53(dataset);

  assert.equal(dataset.baselineMetadata?.baselineVersion, "v53");
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(validation.accountCount, 454);
  assert.equal(validation.uniqueAccountCodes, 454);
  assert.deepEqual(validation.duplicateAccountCodes, []);
  assert.deepEqual(validation.emptyIrpjTreatmentAccounts, []);
  assert.deepEqual(validation.emptyCsllTreatmentAccounts, []);
  assert.deepEqual(validation.irpjDistribution, {
    "SEM AJUSTE": 395,
    "ADIÇÃO": 27,
    "EXCLUSÃO": 9,
    CONDICIONAL: 22,
    "REGRA AUTOMÁTICA": 1,
  });
  assert.deepEqual(validation.csllDistribution, validation.irpjDistribution);
  assert.deepEqual(validation.translationMismatches, []);
  assert.deepEqual(validation.irpjCsllDivergentAccounts, []);
});

test("seed transforma Matriz v53 na arquitetura fiscal sem matriz paralela", async () => {
  const { buildRaizFiscalMatrixSeed } = await import(seedModuleUrl.href);
  const seed = buildRaizFiscalMatrixSeed({ companyId: "company-a", fiscalYear: 2026 });

  assert.equal(seed.accountingCharts.length, 1);
  assert.equal(seed.companyAccountingCharts.length, 1);
  assert.equal(seed.mappings.length, 454);
  assert.equal(seed.fiscalNatures.length, 142);
  assert.equal(seed.fiscalRules.length, 142);
  assert.equal(new Set(seed.mappings.map((mapping: AccountFiscalMapping) => mapping.accountCode)).size, 454);
  assert.ok(seed.fiscalNatures.length < seed.mappings.length);
  assert.ok(seed.fiscalRules.length < seed.mappings.length);
  assert.ok(seed.mappings.every((mapping: AccountFiscalMapping) => mapping.sourceMetadata?.matrixVersion === "v53"));
  assert.ok(seed.fiscalRules.every((rule: FiscalRule) => rule.sourceMetadata?.matrixVersion === "v53"));
});

test("seed preserva tratamentos independentes de IRPJ/CSLL e modos especiais", async () => {
  const { buildRaizFiscalMatrixSeed } = await import(seedModuleUrl.href);
  const seed = buildRaizFiscalMatrixSeed({ companyId: "company-a", fiscalYear: 2026 });
  const treatments = countBy(seed.fiscalRules.flatMap((rule: FiscalRule) => [rule.irpjTreatment, rule.csllTreatment]));
  const specialMapping = seed.mappings.find((mapping: AccountFiscalMapping) => mapping.accountCode === "4.2.1.14.01.01");
  assert.ok(specialMapping);
  const specialRule = seed.fiscalRules.find((rule: FiscalRule) => rule.fiscalNatureId === specialMapping.fiscalNatureId);

  assert.ok((treatments.get("CONDITIONAL") ?? 0) > 0);
  assert.ok((treatments.get("AUTOMATIC_SPECIAL") ?? 0) > 0);
  assert.equal(specialRule?.irpjTreatment, "AUTOMATIC_SPECIAL");
  assert.equal(specialRule?.csllTreatment, "AUTOMATIC_SPECIAL");
  assert.equal(specialRule?.executionMethod, "BALANCE_FORMULA");
  assert.equal(specialRule?.criteria.specialRule, "AUTOMATIC_BY_SIGN");
  assert.equal(specialRule?.criteria.originalMode, "AUTOMÁTICO_POR_SINAL");
});

test("validationStatus legado permanece como proveniência histórica", async () => {
  const { buildRaizFiscalMatrixSeed, loadRaizTaxMatrixV53 } = await import(seedModuleUrl.href);
  const dataset = loadRaizTaxMatrixV53();
  const provenanceAccount = dataset.accounts.find((account: RaizTaxMatrixAccount) => account.validationStatus === "PROPOSTA_CHATGPT");
  assert.ok(provenanceAccount);
  const seed = buildRaizFiscalMatrixSeed({ companyId: "company-a", fiscalYear: 2026 });
  const mapping = seed.mappings.find((item: AccountFiscalMapping) => item.accountCode === provenanceAccount.accountCode);

  assert.equal(mapping?.sourceMetadata?.validationStatusMeaning, "HISTORICAL_PROVENANCE_NOT_PENDING_WORKFLOW");
  assert.equal(
    (mapping?.sourceMetadata?.originalRecord as { validationStatus?: string } | undefined)?.validationStatus,
    "PROPOSTA_CHATGPT",
  );
});

test("seed é idempotente por ids determinísticos", async () => {
  const { buildRaizFiscalMatrixSeed, mergeFiscalMatrixSeed } = await import(seedModuleUrl.href);
  const seed = buildRaizFiscalMatrixSeed({ companyId: "company-a", fiscalYear: 2026 });
  const once = mergeFiscalMatrixSeed({}, seed);
  const twice = mergeFiscalMatrixSeed(once, seed);

  assert.equal(twice.accountingCharts.length, once.accountingCharts.length);
  assert.equal(twice.companyAccountingCharts.length, once.companyAccountingCharts.length);
  assert.equal(twice.mappings.length, once.mappings.length);
  assert.equal(twice.fiscalNatures.length, once.fiscalNatures.length);
  assert.equal(twice.fiscalRules.length, once.fiscalRules.length);
  assert.deepEqual(twice, once);
});
