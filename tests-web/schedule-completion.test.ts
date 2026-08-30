import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/schedule-completion.ts", import.meta.url);
const {
  accountingCompletionIdentity,
  bookCompletionIdentity,
  financialCompletionIdentity,
  fiscalCompletionIdentity,
  payrollCompletionIdentity,
} = await import(moduleUrl.href);

test("gera a mesma chave usada pelo Cronograma para PIS/COFINS da coligada 30", () => {
  assert.deepEqual(accountingCompletionIdentity("pis-cofins", "30", "30 — COLÉGIO UNIÃO"), {
    modulo: "contabil:pis-cofins:30",
    setor: "Contabilidade · PIS e COFINS · 30 — COLÉGIO UNIÃO",
  });
});

test("gera chave por empresa para tarefas financeiras", () => {
  assert.equal(financialCompletionIdentity("bancaria", "7", "Empresa Teste").modulo, "financeiro:bancaria:07");
});

test("identifica Receita por Filial e Lotes a integrar no Cronograma", () => {
  assert.equal(accountingCompletionIdentity("receita-filial", "18", "Espaço Mágico").setor, "Contabilidade · Receita por Filial · 18 — Espaço Mágico");
  assert.equal(accountingCompletionIdentity("lotes-integrar", "18", "Espaço Mágico").setor, "Contabilidade · Lotes a integrar · 18 — Espaço Mágico");
});

test("gera chaves detalhadas por empresa para Fiscal, Folha e Book", () => {
  assert.equal(fiscalCompletionIdentity("iss", "2", "02 — COLÉGIO QI").modulo, "fiscal:iss:02");
  assert.equal(payrollCompletionIdentity("fgts", "2", "02 — COLÉGIO QI").modulo, "folha:fgts:02");
  assert.deepEqual(bookCompletionIdentity("plano-contas", "2", "02 — COLÉGIO QI"), {
    modulo: "book:plano-contas:02",
    setor: "Book Contábil · Plano de Contas · 02 — COLÉGIO QI",
  });
});
