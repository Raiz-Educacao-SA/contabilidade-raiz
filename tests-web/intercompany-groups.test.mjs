import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../app/intercompany-analysis.tsx", import.meta.url), "utf8");

test("Intercompany segrega os cruzamentos em Mútuo, Almoxarifado e Transação", () => {
  assert.match(component, /const intercompanyGroups: Nature\[\] = \["Mútuo", "Almoxarifado", "Transação"\]/);
  assert.match(component, /nature: "Almoxarifado", receivablePrefix: "1\.1\.2\.03\.06"/);
  assert.match(component, /nature: "Transação", receivablePrefix: "1\.1\.2\.03\.05"/);
  assert.doesNotMatch(component, /nature: "Rateio CSC"/);
  assert.doesNotMatch(component, /Transações individuais/);
});

test("cada grupo confere ativo e passivo nas duas empresas do cruzamento", () => {
  assert.match(component, /Empresa com ativo a receber/);
  assert.match(component, /Empresa com passivo a pagar/);
  assert.match(component, /row\.creditorCode/);
  assert.match(component, /row\.debtorCode/);
  assert.match(component, /const difference = \(receivable\?\.closingBalance \|\| 0\) \+ \(payable\?\.closingBalance \|\| 0\)/);
  assert.match(component, /intercompanyGroups\.forEach\(\(item\) => XLSX\.utils\.book_append_sheet/);
});
