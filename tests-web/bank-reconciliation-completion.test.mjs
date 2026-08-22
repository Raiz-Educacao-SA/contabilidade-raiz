import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("../app/monthly-reconciliation.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const reconciliation = await readFile(new URL("../lib/reconciliation.ts", import.meta.url), "utf8");
const monthlyCss = await readFile(new URL("../app/monthly.css", import.meta.url), "utf8");
const modulesCss = await readFile(new URL("../app/modules.css", import.meta.url), "utf8");

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
  assert.match(monthlyCss, /\.form-identification b \{[\s\S]*?font-size: 10px/);
  assert.match(monthlyCss, /\.form-summary b \{[\s\S]*?font-size: 13px/);
  assert.match(monthlyCss, /\.reconciliation-form > header h2 \{[\s\S]*?font-size: 17px/);
  assert.match(monthlyCss, /\.bank-content \.reconciliation-form > header h2 \{[^}]*font-size: 12px/);
  assert.match(monthlyCss, /\.bank-content \.form-identification b \{ font-size: 8px/);
  assert.match(monthlyCss, /\.bank-content \.form-summary b \{ font-size: 10px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-metrics b \{ font-size: 11px/);
});

test("compacta as etapas e os valores da conciliação bancária", () => {
  assert.match(monthlyCss, /\.bank-content \.source-control \{[^}]*padding: 14px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-account \{[^}]*padding: 14px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-metrics b \{ font-size: 11px/);
});

test("reduz também as fontes do cabeçalho, filtros e ações", () => {
  assert.match(modulesCss, /\.bank-content > header h1 \{ font-size: 21px/);
  assert.match(modulesCss, /\.bank-content \.filter-heading b \{ font-size: 8px/);
  assert.match(modulesCss, /\.bank-content \.top-context select \{ font-size: 9px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-flow \.panel-title h2 \{ font-size: 12px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-flow \.panel-title p \{ font-size: 8px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-flow \.history-actions button \{ font-size: 8px/);
});

test("mostra nominalmente as contas encontradas e não encontradas", () => {
  assert.match(panel, /Contas encontradas e não encontradas/);
  assert.match(panel, /Encontradas nas duas bases/);
  assert.match(panel, /Conta contábil sem extrato/);
  assert.match(panel, /Extrato sem conta contábil/);
  assert.match(panel, /unmatchedAccounts\.map\(\(account\)/);
  assert.match(panel, /unmatchedSources\.map\(\(source\)/);
  assert.match(panel, /statements\.map\(\(statement\)/);
  assert.match(panel, /Detalhes técnicos da atualização dos extratos/);
});

test("preserva a conciliação ao mudar de tela e só substitui dados após atualizar", () => {
  assert.match(panel, /const workflowCache = new Map<string, WorkflowState>\(\)/);
  assert.match(panel, /initialWorkflow\?\.accounting \?\? \[\]/);
  assert.match(panel, /workflowCache\.set\(historyKey/);
  assert.doesNotMatch(panel, /setAccounting\(\[\]\)/);
  assert.doesNotMatch(panel, /setDataEngineSources\(\[\]\)/);
  assert.match(panel, /!accountingBusy && !dataEngineBusy/);
});
