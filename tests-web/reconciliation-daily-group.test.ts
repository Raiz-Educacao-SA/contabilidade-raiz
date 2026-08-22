import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/reconciliation-matcher.ts", import.meta.url);

test("concilia vários movimentos do extrato contra um total diário do TOTVS", async () => {
  const { reconcileMovements: reconcile } = await import(moduleUrl.href);
  const date = new Date("2026-05-04T00:00:00Z");
  const rows = reconcile(
    [
      { id: "b1", date, description: "Entrada 1", value: 69000 },
      { id: "b2", date, description: "Entrada 2", value: 67000 },
      { id: "b3", date, description: "Saída 1", value: -136000 },
    ],
    [
      { id: "c1", date, value: 136000, nature: "Débito", account: "1", accountName: "Santander" },
      { id: "c2", date, value: -136000, nature: "Crédito", account: "1", accountName: "Santander" },
    ],
  );

  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente no banco").length, 0);
  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente na contabilidade").length, 0);
  assert.equal(rows.filter((row: { description?: string }) => row.description?.includes("Total diário agrupado")).length, 1);
});

test("mantém como exceção o total diário que realmente não fecha", async () => {
  const { reconcileMovements: reconcile } = await import(moduleUrl.href);
  const date = new Date("2026-05-04T00:00:00Z");
  const rows = reconcile(
    [
      { id: "b1", date, description: "Entrada 1", value: 69000 },
      { id: "b2", date, description: "Entrada 2", value: 67000 },
    ],
    [{ id: "c1", date, value: 135000, nature: "Débito", account: "1", accountName: "Santander" }],
  );

  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente no banco").length, 2);
  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente na contabilidade").length, 1);
});
