import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseIntercompanyEntries } from "../lib/intercompany-entry-matcher.ts";

const entry = (value: number, complement = "MUTUO AO CUBO X RAIZ") => ({
  date: "2026-06-05T00:00:00",
  value,
  complement,
  document: "415922",
});

test("concilia débito e crédito usando o crédito com sinal negativo", () => {
  const result = diagnoseIntercompanyEntries(
    [entry(51_000)],
    [entry(-51_000)],
    [],
    [],
  );

  assert.equal(result.diagnostics[0].status, "Conferido");
});

test("indica alteração de contas quando o passivo foi lançado no ativo da outra empresa", () => {
  const result = diagnoseIntercompanyEntries(
    [entry(51_000)],
    [],
    [],
    [entry(51_000)],
  );

  assert.deepEqual(result.diagnostics[0], {
    receivableIndex: 0,
    payableIndex: null,
    wrongAccountSource: "debtorReceivable",
    wrongAccountIndex: 0,
    status: "Alteração de contas",
  });
});

test("indica alteração de contas quando o ativo foi lançado no passivo da mesma empresa", () => {
  const result = diagnoseIntercompanyEntries(
    [],
    [entry(-51_000)],
    [entry(-51_000)],
    [],
  );

  assert.deepEqual(result.diagnostics[0], {
    receivableIndex: null,
    payableIndex: 0,
    wrongAccountSource: "creditorPayable",
    wrongAccountIndex: 0,
    status: "Alteração de contas",
  });
});

test("mantém falta real quando o valor não existe na conta oposta", () => {
  const result = diagnoseIntercompanyEntries(
    [entry(51_000)],
    [],
    [],
    [entry(40_000)],
  );

  assert.equal(result.diagnostics[0].status, "Falta no passivo");
});
