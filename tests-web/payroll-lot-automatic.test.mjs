import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../app/payroll-batch-reconciliation.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/payroll/lot/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("a conferência lê o lote automaticamente do Labore", () => {
  assert.match(panel, /\/api\/payroll\/lot/);
  assert.match(panel, /Lote automático do Labore/);
  assert.doesNotMatch(panel, /Planilha do lote/);
  assert.doesNotMatch(panel, /accept="\.xlsx,\.xls,\.xlsm"/);
  assert.match(page, /accessToken=\{session\.access_token\}/);
});

test("a API filtra coligada, competência e aplicação P do Labore", () => {
  assert.match(route, /LABORE_APPLICATION = "P"/);
  assert.match(route, /RAZAOSEMLOTE0/);
  assert.match(route, /PLN_B7_S=\$\{LABORE_APPLICATION\}/);
  assert.match(route, /authorizedCompanies/);
  assert.match(route, /startsWith\(competence\)/);
  assert.match(route, /endsWith\(dates\.suffix\)/);
});
