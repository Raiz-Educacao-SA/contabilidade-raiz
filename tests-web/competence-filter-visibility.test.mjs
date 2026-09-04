import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const modulesCss = readFileSync(new URL("../app/modules.css", import.meta.url), "utf8");
const payrollCss = readFileSync(new URL("../app/payroll-overrides.css", import.meta.url), "utf8");

test("mantém o mês e o ano selecionados identificados nos filtros", () => {
  assert.match(page, /aria-label="Mês selecionado"/);
  assert.match(page, /title=\{`Mês selecionado: \$\{months\[month - 1\]\}`\}/);
  assert.match(page, /aria-label="Ano selecionado"/);
  assert.match(page, /title=\{`Ano selecionado: \$\{year\}`\}/);
});

test("abre o cronograma com a competência selecionada na tela inicial", () => {
  assert.match(
    page,
    /if \(area === "cronograma"\) \{\s+const \[selectedYear, selectedMonth\] = closingDate\.split\("-"\)\.map\(Number\);\s+if \(selectedYear >= 2000 && selectedYear <= 2100\) setYear\(selectedYear\);\s+if \(selectedMonth >= 1 && selectedMonth <= 12\) setMonth\(selectedMonth\);\s+\}/s,
  );
});

test("reserva espaço para exibir os valores da competência em todos os módulos", () => {
  assert.match(modulesCss, /\.competence-control select \{[^}]*min-width: 62px;[^}]*padding-right: 20px;/s);
  assert.match(modulesCss, /\.tax-content \.competence-control \{[^}]*grid-template-columns: 112px 118px;/s);
  assert.match(modulesCss, /\.bank-content \.competence-control \{[^}]*grid-template-columns: 112px 145px;/s);
  assert.match(modulesCss, /\.schedule-filters \.competence-control \{[^}]*grid-template-columns: 112px 150px;/s);
  assert.match(payrollCss, /\.payroll-top-context \.competence-control \{[^}]*grid-template-columns: 112px 118px;/s);
});
