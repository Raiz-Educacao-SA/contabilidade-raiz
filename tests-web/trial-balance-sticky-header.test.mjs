import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/modules.css", import.meta.url), "utf8");
const trial = readFileSync(new URL("../app/trial-balance-analysis.tsx", import.meta.url), "utf8");
const loans = readFileSync(new URL("../app/loan-reconciliation.tsx", import.meta.url), "utf8");

test("mantém o cabeçalho fixo nas tabelas de balancete e análise", () => {
  assert.match(css, /\.trial-table th \{[^}]*position: sticky;[^}]*top: 0;[^}]*z-index: 3;/s);
  assert.match(trial, /className="table-wrap trial-table"/);
  assert.match(loans, /className="table-wrap trial-table"/);
});
