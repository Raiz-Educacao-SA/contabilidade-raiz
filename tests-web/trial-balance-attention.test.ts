import assert from "node:assert/strict";
import test from "node:test";
import { trialBalanceAttentionFlags } from "../lib/trial-balance-attention.ts";

const equityBase = {
  category: "Patrimônio Líquido",
  previousBalance: 0,
  currentBalance: 100_000,
  expectedNature: "negativo" as const,
  currentSign: "positivo" as const,
  reducerAccount: false,
};

test("Patrimônio Líquido não é criticado pelo sinal do saldo nem por saldo novo", () => {
  const creditBalance = trialBalanceAttentionFlags({ ...equityBase, relevantVariation: false });
  const debitBalance = trialBalanceAttentionFlags({
    ...equityBase,
    currentBalance: -100_000,
    currentSign: "negativo",
    relevantVariation: false,
  });

  assert.deepEqual(creditBalance, {
    relevantVariation: false,
    possibleError: false,
    reversedAccount: false,
    requiresAttention: false,
  });
  assert.equal(debitBalance.requiresAttention, false);
  assert.equal(debitBalance.possibleError, false);
  assert.equal(debitBalance.reversedAccount, false);
});

test("Patrimônio Líquido é criticado somente quando a variação é relevante", () => {
  const flags = trialBalanceAttentionFlags({ ...equityBase, relevantVariation: true });

  assert.equal(flags.relevantVariation, true);
  assert.equal(flags.requiresAttention, true);
  assert.equal(flags.possibleError, false);
  assert.equal(flags.reversedAccount, false);
});

test("mantém as críticas de saldo novo e conta virada para as demais categorias", () => {
  const flags = trialBalanceAttentionFlags({
    category: "Receita",
    previousBalance: 0,
    currentBalance: 500,
    relevantVariation: false,
    expectedNature: "negativo",
    currentSign: "positivo",
    reducerAccount: false,
  });

  assert.equal(flags.possibleError, true);
  assert.equal(flags.reversedAccount, true);
  assert.equal(flags.requiresAttention, true);
});
