import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  accountingRevenueQueryAccounts,
  classifyAccountingRevenue,
  deduplicateAccountingRecords,
  PAA_DISCOUNT_ACCOUNT,
} from "../lib/revenue-reconciliation.ts";

test("consulta mensalidades e a conta de Bolsas PAA", () => {
  assert.deepEqual(accountingRevenueQueryAccounts(), [
    "3.1.1.01.01",
    PAA_DISCOUNT_ACCOUNT,
  ]);
});

test("classifica Bolsas PAA como desconto contábil", () => {
  assert.equal(
    classifyAccountingRevenue("3.1.2.02.02.03", "Bolsas PAA"),
    "discount",
  );
});

test("mantém mensalidade como receita e ignora conta fora do escopo", () => {
  assert.equal(
    classifyAccountingRevenue("3.1.1.01.01.04", "Mensalidade Ensino Médio"),
    "revenue",
  );
  assert.equal(
    classifyAccountingRevenue("1.1.2.01.01.23", "Contas a Receber"),
    "other",
  );
});

test("não duplica a mesma partida retornada pelas duas consultas", () => {
  assert.deepEqual(
    deduplicateAccountingRecords(["<Resultado>1</Resultado>", "<Resultado>1</Resultado>"]),
    ["<Resultado>1</Resultado>"],
  );
});

test("mantém os filtros e a finalização na mesma linha em telas de trabalho", () => {
  const css = readFileSync(
    new URL("../app/modules.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /@media \(max-width: 1050px\) \{\s*\.revenue-content \.top-context \{\s*flex-wrap: wrap;/,
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width: 1450px\) \{\s*\.revenue-content \.top-context/,
  );
});
