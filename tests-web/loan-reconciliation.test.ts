import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyLoanTerm, isLoanAccount } from "../lib/loan-accounts.ts";
import { requiredModulesForApiPath } from "../lib/access-control.ts";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/loan-reconciliation.tsx", import.meta.url), "utf8");

test("classifica empréstimos de curto e longo prazo pelo grupo contábil", () => {
  assert.equal(classifyLoanTerm("2.1.5.01.01"), "Curto prazo");
  assert.equal(classifyLoanTerm("2.3.2.01.01"), "Longo prazo");
  assert.equal(classifyLoanTerm("2.4.4.01.01"), null);
  assert.equal(classifyLoanTerm("1.1.1.01.01"), null);
});

test("mantém somente contas de empréstimos e exclui rotinas próprias", () => {
  assert.equal(isLoanAccount({ account: "2.1.5.01.01", description: "Empréstimos bancários - curto prazo" }), true);
  assert.equal(isLoanAccount({ account: "2.3.2.01.01", description: "Financiamento BNDES - longo prazo" }), true);
  assert.equal(isLoanAccount({ account: "2.1.2.01.02.02", description: "Empréstimos Bancários Consignado a Pagar" }), false);
  assert.equal(isLoanAccount({ account: "2.1.8.01.01.05", description: "Empréstimo Yuri Barbeito" }), false);
  assert.equal(isLoanAccount({ account: "2.1.7.01.01", description: "Arrendamento a pagar - imóveis" }), false);
  assert.equal(isLoanAccount({ account: "2.3.1.04.07", description: "Parcelamento PGFN" }), false);
  assert.equal(isLoanAccount({ account: "4.2.1.10.01", description: "Juros sobre empréstimos" }), true);
  assert.equal(isLoanAccount({ account: "4.2.1.10.01.05", description: "Juros de Empréstimos" }), true);
  assert.equal(isLoanAccount({ account: "4.2.1.10.02", description: "Encargos financeiros de financiamentos" }), true);
  assert.equal(classifyLoanTerm("4.2.1.10.01", "Juros sobre empréstimos"), "Juros");
  assert.equal(isLoanAccount({ account: "3.1.1.01.01", description: "Receita de juros sobre empréstimos" }), false);
});

test("módulo de empréstimos expõe o fluxo preparado sem gerar lançamentos ainda", () => {
  assert.match(page, /<LoanReconciliation/);
  assert.match(panel, /Gerar balancete/);
  assert.match(panel, /Analisar balancete/);
  assert.match(panel, /Exportar análise/);
  assert.match(panel, /Gerar lançamentos/);
  assert.match(panel, /Aguardando os lançamentos-padrão e a lógica contábil/);
  assert.match(panel, /<th>Saldo final<\/th><th>Grupo<\/th>/);
  assert.doesNotMatch(panel, /<th>Prazo(?:\/Grupo)?<\/th>/);
});

test("API específica de empréstimos pertence ao módulo financeiro", () => {
  assert.deepEqual(requiredModulesForApiPath("/api/totvs/loans/trial-balance"), ["financeiro"]);
});
