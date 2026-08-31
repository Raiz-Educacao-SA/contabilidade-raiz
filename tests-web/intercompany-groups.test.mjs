import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../app/intercompany-analysis.tsx", import.meta.url), "utf8");
const detailRoute = readFileSync(new URL("../app/api/totvs/intercompany/entries/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/modules.css", import.meta.url), "utf8");

test("Intercompany separa visualmente Mútuo, Almoxarifado e Transação", () => {
  assert.match(component, /const intercompanyGroups: Nature\[\] = \["Mútuo", "Almoxarifado", "Transação"\]/);
  assert.match(component, /nature:\s*"Almoxarifado",[\s\S]*?receivablePrefix:\s*"1\.1\.2\.03\.06"/);
  assert.match(component, /nature:\s*"Transação",[\s\S]*?receivablePrefix:\s*"1\.1\.2\.03\.05"/);
  assert.match(component, /intercompanyGroups\.map\(\(group\) =>/);
  assert.match(component, /className="intercompany-group-section intercompany-tab-panel"/);
  assert.doesNotMatch(component, /nature: "Rateio CSC"/);
});

test("após analisar, cada grupo possui uma aba ampliada", () => {
  assert.match(component, /const \[activeGroup, setActiveGroup\] = useState<Nature>\("Mútuo"\)/);
  assert.match(component, /className="intercompany-analysis-tabs"/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /aria-selected=\{activeGroup === section\.group\}/);
  assert.match(component, /role="tabpanel"/);
  assert.match(component, /activeGroupResult\.rows\.map/);
  assert.match(styles, /\.intercompany-analysis-tabs \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/s);
  assert.match(styles, /\.intercompany-tab-panel \.intercompany-group-table \{[^}]*min-height: 280px;/s);
});

test("a conferência usa movimento mensal, não saldo de encerramento", () => {
  assert.match(component, /type BalanceRow = \{[^}]*movement: number/);
  assert.match(component, /sum \+ row\.movement/);
  assert.match(component, /const difference = receivableMovement \+ payable\.value/);
  assert.match(component, /const difference = receivableMovement \+ payableMovement/);
  assert.match(component, /Movimento do ativo/);
  assert.match(component, /Movimento do passivo/);
  assert.doesNotMatch(component, /closingBalance/);
});

test("contas sem movimento e cruzamentos totalmente zerados não são exibidos", () => {
  assert.match(component, /isIntercompanyAccount\(row\.account\)[\s\S]*?hasMonthlyMovement\(row\.movement\)/);
  assert.match(component, /const moving = found\.filter\(\(row\) => hasMonthlyMovement\(row\.movement\)\)/);
  assert.match(component, /if \([\s\S]*?!hasMonthlyMovement\(receivableMovement\)[\s\S]*?!hasMonthlyMovement\(payable\.value\)[\s\S]*?\)\s*return/);
  assert.match(component, /if \([\s\S]*?!hasMonthlyMovement\(receivableMovement\)[\s\S]*?!hasMonthlyMovement\(payableMovement\)[\s\S]*?\)\s*return/);
});

test("Identificar consulta o Razão da competência por conta e separa os lançamentos por empresa", () => {
  assert.match(component, /\/api\/totvs\/intercompany\/entries/);
  assert.match(component, /accounts: accounts\.join\(","\)/);
  assert.match(component, /Lançamentos do Razão das contas por empresa/);
  assert.match(component, /intercompany-company-entries/);
  assert.match(component, /disabled=\{loadingEntries\}/);
  assert.match(detailRoute, /<codSentenca>METTA0909<\/codSentenca>/);
  assert.match(detailRoute, /PLN_B7_S=\$\{account\};PLN_B5_D=\$\{firstDay\};PLN_B6_D=\$\{lastDay\};PLN_B3_S=\$\{company\};PLN_B4_S=\$\{company\}/);
  assert.match(detailRoute, /tag\(record, "IDPARTIDA"\)/);
  assert.match(detailRoute, /tag\(record, "COMPLEMENTO"\)/);
  assert.match(detailRoute, /accountSet\.has\(account\)/);
});

test("a exportação mantém uma aba para cada grupo", () => {
  assert.match(component, /intercompanyGroups\.forEach\([\s\S]*?XLSX\.utils\.book_append_sheet/);
  assert.match(component, /"Diferença do movimento"/);
});

test("a identificação da finalização fica abaixo do botão no Intercompany", () => {
  assert.match(page, /accountingTab === "intercompany" \? "intercompany-content"/);
  assert.match(styles, /\.intercompany-content \.top-context \.module-completion-control \{[^}]*max-width: 170px;[^}]*flex-direction: column;/s);
  assert.match(styles, /\.intercompany-content \.top-context \.module-completion-control button \{[^}]*order: 1;/s);
  assert.match(styles, /\.intercompany-content \.top-context \.module-completion-control small \{[^}]*order: 2;/s);
});
