import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/revenue-by-branch.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/totvs/trial-balance/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Receita por Filial usa retrospectiva por movimento", () => {
  assert.match(component, /Retrospectiva · Receita por Filial/);
  assert.match(component, /Movimento mensal das contas contábeis iniciadas por 3/);
  assert.match(component, /byBranch=1/);
  assert.match(component, /movements/);
});

test("consulta por filial aceita qualquer coligada e somente contas iniciadas por 3", () => {
  assert.match(route, /startsWith\("3"\)/);
  assert.match(route, /PLN_B7_S=3;/);
  assert.doesNotMatch(route, /company === "10"/);
});

test("página renderiza a retrospectiva no item Receita por Filial", () => {
  assert.match(page, /import RevenueByBranch/);
  assert.match(page, /accountingTab === "receita-filial"[\s\S]*?<RevenueByBranch/);
});
