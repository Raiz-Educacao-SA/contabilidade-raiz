import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("../app/monthly-reconciliation.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const reconciliation = await readFile(new URL("../lib/reconciliation.ts", import.meta.url), "utf8");
const monthlyCss = await readFile(new URL("../app/monthly.css", import.meta.url), "utf8");

test("conciliação bancária finaliza a tarefa por empresa e competência", () => {
  assert.match(panel, /financialCompletionIdentity\("bancaria", companyCode, companyName\)/);
  assert.match(panel, /<ModuleCompletionControl/);
  assert.match(panel, /disabled=\{!results\.length\}/);
  assert.match(page, /userId=\{session\.user\.id\}/);
});

test("não duplica o controle de finalização no cabeçalho geral", () => {
  assert.match(page, /selectedModule === "bancaria"\) return null/);
});

test("lista somente lançamentos divergentes da contabilidade", () => {
  assert.match(panel, /row\.status === "Somente na contabilidade"/);
  assert.match(panel, /Débitos lançados na contabilidade não identificados no banco/);
  assert.match(panel, /Créditos lançados na contabilidade não identificados no banco/);
  assert.doesNotMatch(panel, /Débitos identificados no banco não lançados na contabilidade/);
  assert.doesNotMatch(panel, /Créditos identificados no banco não lançados na contabilidade/);
});

test("procura primeiro no dia e depois em toda a competência", () => {
  assert.match(reconciliation, /exactDate \? dayKey\(a\.date\) === dayKey\(b\.date\)/);
  assert.match(reconciliation, /monthKey\(a\.date\) === monthKey\(b\.date\)/);
  assert.doesNotMatch(reconciliation, /days <= toleranceDays/);
});

test("usa fonte compacta na ficha de divergências", () => {
  assert.match(monthlyCss, /\.reconciliation-form th,[\s\S]*?font-size: 9px/);
});
