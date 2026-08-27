import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/modules.css", import.meta.url), "utf8");

test("compacta o título e os filtros do módulo de empréstimos", () => {
  assert.match(page, /selectedModule === "emprestimos" \? "loan-current-module" : ""/);
  assert.match(css, /\.loan-content > header h1 \{[^}]*font-size: 24px;/s);
  assert.match(css, /\.loan-content \.filter-fields \{[^}]*grid-template-columns: minmax\(250px, 300px\) auto;/s);
  assert.match(css, /\.loan-content \.competence-control \{[^}]*grid-template-columns: 112px 118px;/s);
});

test("organiza o status e o botão da tarefa sem sobreposição", () => {
  assert.match(css, /\.loan-content \.module-completion-control \{[^}]*display: grid;[^}]*justify-items: end;/s);
  assert.match(css, /\.loan-content \.module-completion-control small \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
  assert.match(css, /\.loan-content \.module-completion-control button \{[^}]*min-height: 32px;[^}]*font-size: 9px;/s);
});

test("mantém o regime tributário dentro do filtro da empresa", () => {
  assert.match(css, /\.loan-content \.top-context \.company-control \{[^}]*height: 44px;/s);
  assert.match(css, /\.loan-content \.company-select-stack \{[^}]*grid-template-rows: 24px auto;[^}]*gap: 1px;/s);
  assert.match(css, /\.loan-content \.company-select-stack small \{[^}]*font-size: 7px;[^}]*line-height: 1;/s);
});
