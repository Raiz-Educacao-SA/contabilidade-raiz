import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/totvs-accounting.ts", import.meta.url);

test("expõe somente os alertas não zerados informados pela Planilha 18", async () => {
  const { collectTotvsAccountingDiagnostics } = await import(moduleUrl.href);
  const diagnostics = collectTotvsAccountingDiagnostics([
    {
      CODCONTA: "1.1.1.02.03.03",
      DESCRICAO: "Banco Santander",
      CODCXA: "019",
      DATACOMPENSACAO: "2026-05-18T00:00:00",
      DIF_DEB: "-1657.40",
      DIF_CRED: "-1657.40",
    },
    {
      CODCONTA: "1.1.1.02.03.03",
      DATACOMPENSACAO: "2026-05-19T00:00:00",
      DIF_DEB: "0.00",
      DIF_CRED: "0.00",
    },
  ]);

  assert.deepEqual(diagnostics, [{
    account: "1.1.1.02.03.03",
    accountName: "Banco Santander",
    cashCode: "019",
    date: "2026-05-18T00:00:00",
    debitDifference: -1657.4,
    creditDifference: -1657.4,
  }]);
});
