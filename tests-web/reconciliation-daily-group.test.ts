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
  assert.equal(rows.filter((row: { description?: string }) => row.description?.includes("Total líquido diário agrupado")).length, 1);
});

test("concilia R$ 4.000,00 do extrato pela soma líquida dos lançamentos contábeis do dia", async () => {
  const { reconcileMovements: reconcile } = await import(moduleUrl.href);
  const date = new Date("2026-06-30T00:00:00Z");
  const rows = reconcile(
    [{ id: "b1", date, description: "Aplicação", value: 4000 }],
    [
      { id: "c1", date, value: 4637.82, nature: "Débito" },
      { id: "c2", date, value: -637.82, nature: "Crédito" },
    ],
  );

  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente no banco").length, 0);
  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente na contabilidade").length, 0);
  assert.equal(rows.filter((row: { description?: string }) => row.description?.includes("Total líquido diário agrupado")).length, 1);
});

test("resume em uma única diferença líquida o total diário que não fecha", async () => {
  const { reconcileMovements: reconcile } = await import(moduleUrl.href);
  const date = new Date("2026-05-04T00:00:00Z");
  const rows = reconcile(
    [
      { id: "b1", date, description: "Entrada 1", value: 69000 },
      { id: "b2", date, description: "Entrada 2", value: 67000 },
    ],
    [{ id: "c1", date, value: 135000, nature: "Débito", account: "1", accountName: "Santander" }],
  );

  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente no banco").length, 0);
  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente na contabilidade").length, 0);
  assert.equal(rows.filter((row: { status: string }) => row.status === "Possível conciliação").length, 1);
  assert.equal(rows.find((row: { difference?: number }) => row.difference === 1000)?.difference, 1000);
});

test("considera conciliada a diferença líquida diária de R$ 0,29", async () => {
  const { reconcileMovements: reconcile } = await import(moduleUrl.href);
  const date = new Date("2026-06-30T00:00:00Z");
  const rows = reconcile(
    [{ id: "b1", date, description: "Aplicação", value: 4000 }],
    [
      { id: "c1", date, value: 4638.11, nature: "Débito" },
      { id: "c2", date, value: -637.82, nature: "Crédito" },
    ],
  );

  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente no banco").length, 0);
  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente na contabilidade").length, 0);
  const difference = rows.find((row: { status: string }) => row.status === "Conciliado");
  assert.equal(difference?.bankValue, 4000);
  assert.equal(difference?.accountingValue, 4000.29);
  assert.equal(difference?.difference, -0.29);
});

test("considera conciliada a diferença de exatamente R$ 1,00", async () => {
  const { reconcileMovements: reconcile } = await import(moduleUrl.href);
  const date = new Date("2026-06-30T00:00:00Z");
  const rows = reconcile(
    [{ id: "b1", date, description: "Movimento", value: 100 }],
    [{ id: "c1", date, value: 99, nature: "Débito" }],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Conciliado");
  assert.equal(rows[0].difference, 1);
});

test("mantém como diferença o valor de R$ 1,01", async () => {
  const { reconcileMovements: reconcile } = await import(moduleUrl.href);
  const date = new Date("2026-06-30T00:00:00Z");
  const rows = reconcile(
    [{ id: "b1", date, description: "Movimento", value: 100.01 }],
    [{ id: "c1", date, value: 99, nature: "Débito" }],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Possível conciliação");
  assert.equal(rows[0].difference, 1.01);
});

test("desconsidera diferenças de data quando entradas e saídas fecham no mês", async () => {
  const { reconcileMovements: reconcile } = await import(moduleUrl.href);
  const rows = reconcile(
    [
      { id: "b1", date: new Date("2026-05-04T00:00:00Z"), description: "Entrada 1", value: 69000 },
      { id: "b2", date: new Date("2026-05-07T00:00:00Z"), description: "Entrada 2", value: 67000 },
      { id: "b3", date: new Date("2026-05-09T00:00:00Z"), description: "Saída 1", value: -36000 },
      { id: "b4", date: new Date("2026-05-12T00:00:00Z"), description: "Saída 2", value: -100000 },
    ],
    [
      { id: "c1", date: new Date("2026-05-30T00:00:00Z"), value: 136000, nature: "Débito", account: "1", accountName: "Santander" },
      { id: "c2", date: new Date("2026-05-31T00:00:00Z"), value: -136000, nature: "Crédito", account: "1", accountName: "Santander" },
    ],
  );

  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente no banco").length, 0);
  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente na contabilidade").length, 0);
  assert.equal(rows.filter((row: { description?: string }) => row.description?.includes("Total líquido mensal agrupado")).length, 1);
});

test("mantém a diferença real quando o total mensal não fecha", async () => {
  const { reconcileMovements: reconcile } = await import(moduleUrl.href);
  const rows = reconcile(
    [
      { id: "b1", date: new Date("2026-05-04T00:00:00Z"), description: "Entrada 1", value: 69000 },
      { id: "b2", date: new Date("2026-05-07T00:00:00Z"), description: "Entrada 2", value: 67000 },
    ],
    [{ id: "c1", date: new Date("2026-05-30T00:00:00Z"), value: 135998.99, nature: "Débito", account: "1", accountName: "Santander" }],
  );

  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente no banco").length, 2);
  assert.equal(rows.filter((row: { status: string }) => row.status === "Somente na contabilidade").length, 1);
});
