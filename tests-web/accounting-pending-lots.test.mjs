import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/pending-accounting-lots.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/totvs/accounting/pending-lots/route.ts", import.meta.url), "utf8");

test("módulo contábil oferece a rotina Lotes a integrar", () => {
  assert.match(page, /Lotes a integrar/);
  assert.match(page, /<PendingAccountingLots/);
  assert.match(panel, /Atualizar/);
});

test("consulta usa a Planilha NET 5 e restringe a empresa autorizada", () => {
  assert.match(route, /RAZAOSEMLOTE0/);
  assert.match(route, /isAuthorizedCompany/);
  assert.match(route, /CODCOLIGADA/);
  assert.match(route, /Pendente para integrar|lots/);
});
