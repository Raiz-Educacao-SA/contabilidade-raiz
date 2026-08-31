import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../app/intercompany-analysis.tsx", import.meta.url), "utf8");
const detailRoute = readFileSync(new URL("../app/api/totvs/intercompany/entries/route.ts", import.meta.url), "utf8");

test("Intercompany separa visualmente Mútuo, Almoxarifado e Transação", () => {
  assert.match(component, /const intercompanyGroups: Nature\[\] = \["Mútuo", "Almoxarifado", "Transação"\]/);
  assert.match(component, /nature: "Almoxarifado", receivablePrefix: "1\.1\.2\.03\.06"/);
  assert.match(component, /nature: "Transação", receivablePrefix: "1\.1\.2\.03\.05"/);
  assert.match(component, /intercompanyGroups\.map\(\(group\) =>/);
  assert.match(component, /className="intercompany-group-section"/);
  assert.doesNotMatch(component, /nature: "Rateio CSC"/);
});

test("a conferência usa movimento mensal, não saldo de encerramento", () => {
  assert.match(component, /type BalanceRow = \{[^}]*movement: number/);
  assert.match(component, /sum \+ row\.movement/);
  assert.match(component, /const difference = \(receivable\?\.movement \|\| 0\) \+ payable\.value/);
  assert.match(component, /const difference = \(receivable\?\.movement \|\| 0\) \+ \(payable\?\.movement \|\| 0\)/);
  assert.match(component, /Movimento do ativo/);
  assert.match(component, /Movimento do passivo/);
  assert.doesNotMatch(component, /closingBalance/);
});

test("Identificar consulta o Razão da competência por conta e separa os lançamentos por empresa", () => {
  assert.match(component, /\/api\/totvs\/intercompany\/entries/);
  assert.match(component, /accounts: accounts\.join\(","\)/);
  assert.match(component, /Lançamentos das contas por empresa/);
  assert.match(component, /intercompany-company-entries/);
  assert.match(detailRoute, /<codSentenca>METTA0909<\/codSentenca>/);
  assert.match(detailRoute, /PLN_B7_S=\$\{account\};PLN_B5_D=\$\{firstDay\};PLN_B6_D=\$\{lastDay\};PLN_B3_S=\$\{company\};PLN_B4_S=\$\{company\}/);
  assert.match(detailRoute, /tag\(record, "IDPARTIDA"\)/);
  assert.match(detailRoute, /tag\(record, "COMPLEMENTO"\)/);
  assert.match(detailRoute, /accountSet\.has\(account\)/);
});

test("a exportação mantém uma aba para cada grupo", () => {
  assert.match(component, /intercompanyGroups\.forEach\(\(item\) => XLSX\.utils\.book_append_sheet/);
  assert.match(component, /"Diferença do movimento"/);
});
