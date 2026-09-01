import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const component = fs.readFileSync(new URL("../app/expense-analysis.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/totvs/expenses/route.ts", import.meta.url), "utf8");

test("Módulo Contábil renderiza a análise no item Despesas", () => {
  assert.match(page, /import ExpenseAnalysis/);
  assert.match(page, /accountingTab === "despesas"[\s\S]*?<ExpenseAnalysis/);
  assert.match(component, /Atualizar PlanilhaNet 08/);
  assert.match(component, /\/api\/totvs\/expenses/);
  assert.match(page, /accessToken=\{session\.access_token\}/);
});
test("análise aplica as regras aprovadas para agosto e ativos", () => {
  assert.match(component, /Divergência em comparação a meses anteriores/);
  assert.match(component, /Ativo Imobilizado/);
  assert.match(component, /LEFT|startsWith\("1\."\)/);
  assert.match(component, /DATASAIDA/);
  assert.match(component, /CODCOLIGADA/);
  assert.match(component, /DEBITO/);
});

test("atualização consulta o período em lotes mensais paralelos", () => {
  assert.match(route, /Promise\.all\(monthlyRanges/);
  assert.match(route, /monthCount > 12/);
  assert.match(component, /periodStart/);
  assert.match(component, /periodEnd/);
  assert.match(component, /Exportar Excel/);
  assert.match(component, /disabled=\{!analysis \|\| busy\}/);
  assert.match(component, /AbortSignal\.timeout\(120_000\)/);
  assert.match(page, /accountingTab === "despesas"/);
});

test("exportação segue o padrão contábil aprovado", () => {
  assert.match(component, /xlsx-js-style/);
  assert.match(component, /Análise de Despesa/);
  assert.match(component, /Lançamentos Contábeis/);
  assert.match(component, /Regras e Controles/);
  assert.match(component, /fileTitle\(companyName\)/);
  assert.match(component, /Calibri/);
});
