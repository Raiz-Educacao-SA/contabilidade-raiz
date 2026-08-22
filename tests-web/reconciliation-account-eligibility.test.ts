import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL(
  "../lib/reconciliation-account-eligibility.ts",
  import.meta.url,
);

test("desconsidera Caixa Tesouraria na conciliação bancária de qualquer empresa", async () => {
  const { isAccountingAccountEligibleForBankReconciliation } = await import(
    moduleUrl.href
  );

  assert.equal(
    isAccountingAccountEligibleForBankReconciliation(
      "CAIXA TESOURARIA - RAIZ EDUCAÇÃO",
    ),
    false,
  );
  assert.equal(
    isAccountingAccountEligibleForBankReconciliation(
      "Caixa-Tesouraria - outra empresa",
    ),
    false,
  );
  assert.equal(
    isAccountingAccountEligibleForBankReconciliation(
      "Banco Caixa Econômica Federal - conta corrente",
    ),
    true,
  );
});
