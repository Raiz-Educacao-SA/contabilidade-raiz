import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/pending-accounting-lots.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/totvs/accounting/pending-lots/route.ts", import.meta.url), "utf8");

test("módulo contábil oferece a rotina Lotes a integrar", () => {
  assert.match(page, /Lotes a integrar/);
  assert.match(page, /<PendingAccountingLots/);
  assert.match(page, /pending-lots-content/);
  assert.match(page, /pendingLotsAllCompanies/);
  assert.match(page, /pending-lots:update/);
  assert.match(page, /pendingLotsUpdating \? "Atualizando\.\.\." : "Atualizar"/);
  assert.match(page, /disabled=\{pendingLotsUpdating\}/);
  assert.match(page, /onLoadingChange=\{setPendingLotsUpdating\}/);
  assert.match(panel, /Atualizar/);
  assert.match(panel, /onLoadingChange\(true\)/);
  assert.match(panel, /onLoadingChange\(false\)/);
  assert.doesNotMatch(panel, /<h2>Lotes a integrar<\/h2>/);
  assert.match(panel, /Empresa<\/th><th>Lote/);
  const accountingMenuStart = page.indexOf('<nav className="accounting-nav">');
  const accountingMenu = page.slice(accountingMenuStart, page.indexOf('{selectedModule === "book"', accountingMenuStart));
  assert.ok(accountingMenu.indexOf('label: "Lotes a integrar"') < accountingMenu.indexOf('label: "Análise Balancete"'));
});

test("consulta usa a Planilha NET 5 e restringe as empresas autorizadas", () => {
  assert.match(route, /RAZAOSEMLOTE0/);
  assert.match(route, /authorizedCompanies/);
  assert.match(route, /company === "all"/);
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /PLN_B3_I=\$\{firstCompany\}/);
  assert.match(route, /PLN_B4_I=\$\{lastCompany\}/);
  assert.match(route, /CODCOLIGADA/);
  assert.match(route, /Pendente para integrar|lots/);
});

test("opção Todas realiza apenas uma requisição consolidada no navegador", () => {
  assert.match(panel, /allCompanies \? "all" : companyCode/);
  assert.doesNotMatch(panel, /for \(let index = 0; index < targets\.length/);
  assert.doesNotMatch(panel, /companies\.map/);
});
