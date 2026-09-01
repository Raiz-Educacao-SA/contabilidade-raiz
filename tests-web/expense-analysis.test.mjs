import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const component = fs.readFileSync(new URL("../app/expense-analysis.tsx", import.meta.url), "utf8");

test("Módulo Contábil renderiza a análise no item Despesas", () => {
  assert.match(page, /import ExpenseAnalysis/);
  assert.match(page, /accountingTab === "despesas"[\s\S]*?<ExpenseAnalysis/);
});

test("análise aplica as regras aprovadas para agosto e ativos", () => {
  assert.match(component, /Divergência em comparação a meses anteriores/);
  assert.match(component, /Ativo Imobilizado/);
  assert.match(component, /LEFT|startsWith\("1\."\)/);
  assert.match(component, /DATASAIDA/);
  assert.match(component, /CODCOLIGADA/);
  assert.match(component, /DEBITO/);
});
