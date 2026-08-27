import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyLoanTerm, isLoanAccount } from "../lib/loan-accounts.ts";
import { requiredModulesForApiPath } from "../lib/access-control.ts";
import { buildLoanPostingsCsv, generateLoanPostings, getLoanControlSchedule, getLoanPostingControls } from "../lib/loan-postings.ts";

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

test("inclui juros a apropriar dos empréstimos no respectivo curto ou longo prazo", () => {
  const shortTermInterest = {
    account: "2.1.1.02.11.12",
    description: "(-) Juros Emprést. e Financ Banco Sicoob - 872559",
  };
  const longTermInterest = {
    account: "2.3.1.02.11.12",
    description: "(-) Juros Emprést. e Financ Banco Sicoob - 872559",
  };

  assert.equal(isLoanAccount(shortTermInterest), true);
  assert.equal(classifyLoanTerm(shortTermInterest.account, shortTermInterest.description), "Curto prazo");
  assert.equal(isLoanAccount(longTermInterest), true);
  assert.equal(classifyLoanTerm(longTermInterest.account, longTermInterest.description), "Longo prazo");
  assert.equal(isLoanAccount({ account: "2.1.1.02", description: "(-) Juros e Custos a Apropriar" }), false);
});

test("módulo de empréstimos substitui a análise pelo gerador de lançamentos", () => {
  assert.match(page, /<LoanReconciliation/);
  assert.match(panel, /Gerar balancete/);
  assert.doesNotMatch(panel, />Analisar balancete</);
  assert.match(panel, /Exportar análise/);
  assert.match(panel, /Gerar lançamentos/);
  assert.match(panel, /Controle fixo:/);
  assert.match(panel, /Controle de Empréstimos/);
  assert.match(panel, /CONTROLE FIXO · COLIGADA 05/);
  assert.match(panel, /<th>Saldo final<\/th><th>Grupo<\/th>/);
  assert.doesNotMatch(panel, /<th>Prazo(?:\/Grupo)?<\/th>/);
});

test("mantém o controle fixo completo do contrato Sicoob da coligada 05", () => {
  const control = getLoanPostingControls("05")[0];
  const schedule = getLoanControlSchedule(control);
  assert.equal(control.principal, 5000000);
  assert.equal(control.financedTotal, 5176295.05);
  assert.equal(control.monthlyRate, 0.0174);
  assert.equal(control.monthlyAmortization, 89308.27);
  assert.equal(schedule.length, 60);
  assert.deepEqual(schedule[4], { competence: "2026-06", installment: 5, amortization: 89308.27, interest: 88877.43, totalInstallment: 178185.7, outstandingBalance: 4911955.4, status: "Ativa" });
  assert.equal(schedule.at(-1)?.competence, "2031-01");
  assert.equal(schedule.at(-1)?.outstandingBalance, 0);
});

test("gera os três lançamentos do controle fixo da coligada 05 em junho de 2026", () => {
  const controls = getLoanPostingControls("5");
  assert.equal(controls.length, 1);
  assert.equal(controls[0].contract, "872959");
  assert.equal(controls[0].document, "EMPRES_CUBO");

  assert.deepEqual(generateLoanPostings("05", "2026-06"), [
    {
      controlId: "05-sicoob-872959",
      contract: "872959",
      branchCode: "1",
      document: "EMPRES_CUBO",
      debitAccount: "2.3.1.01.11.11",
      creditAccount: "2.1.1.01.15.11",
      amount: 157433.4,
      history: "TRANSF CURTO X LONGO PRAZO - N/ MÊS",
    },
    {
      controlId: "05-sicoob-872959",
      contract: "872959",
      branchCode: "1",
      document: "EMPRES_CUBO",
      debitAccount: "2.1.1.01.15.11",
      creditAccount: "2.1.1.02.11.12",
      amount: 88877.43,
      history: "APROPRIAÇÃO DE JUROS N/ MÊS",
    },
    {
      controlId: "05-sicoob-872959",
      contract: "872959",
      branchCode: "1",
      document: "EMPRES_CUBO",
      debitAccount: "2.1.1.02.11.12",
      creditAccount: "2.3.1.02.14.11",
      amount: 68125.13,
      history: "TRANSF JUROS CURTO X LONGO PRAZO - N/ MÊS",
    },
  ]);
});

test("exporta os lançamentos da coligada 05 no padrão CSV do TOTVS", () => {
  const { postings, csv } = buildLoanPostingsCsv("05", "2026-06");
  assert.equal(postings.length, 3);
  assert.match(csv, /^M;99;IMPORTAÇÃO DE LANÇAMENTOS;30\/06\/2026;;;;;\r\n/);
  assert.match(csv, /\*P;EMPRÉSTIMOS;2\.3\.1\.01\.11\.11;2\.1\.1\.01\.15\.11;EMPRES_CUBO;157\.433,40;71;TRANSF CURTO X LONGO PRAZO - N\/ MÊS;1/);
  assert.match(csv, /\*P;EMPRÉSTIMOS;2\.1\.1\.01\.15\.11;2\.1\.1\.02\.11\.12;EMPRES_CUBO;88\.877,43;71;APROPRIAÇÃO DE JUROS N\/ MÊS;1/);
  assert.match(csv, /\*P;EMPRÉSTIMOS;2\.1\.1\.02\.11\.12;2\.3\.1\.02\.14\.11;EMPRES_CUBO;68\.125,13;71;TRANSF JUROS CURTO X LONGO PRAZO - N\/ MÊS;1/);
  assert.equal(buildLoanPostingsCsv("02", "2026-06").postings.length, 0);
});

test("API específica de empréstimos pertence ao módulo financeiro", () => {
  assert.deepEqual(requiredModulesForApiPath("/api/totvs/loans/trial-balance"), ["financeiro"]);
});
