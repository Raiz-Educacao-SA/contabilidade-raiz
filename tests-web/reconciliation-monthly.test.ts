import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/reconciliation-monthly.ts", import.meta.url);

test("não mascara diferenças iguais de entrada e saída quando o líquido fecha", async () => {
  const { validateMonthly } = await import(moduleUrl.href);
  const bank = [
    { id: "b1", date: new Date("2026-06-01T00:00:00Z"), description: "Entrada", value: 100 },
    { id: "b2", date: new Date("2026-06-02T00:00:00Z"), description: "Saída", value: -40 },
  ];
  const accounting = [
    { id: "c1", date: new Date("2026-06-03T00:00:00Z"), value: 60, nature: "Débito", account: "1", accountName: "Banco" },
  ];
  const validation = validateMonthly(bank, accounting, {
    agency: "", account: "", period: "06/2026", name: "Banco", openingBalance: 0, closingBalance: 999,
  });
  assert.equal(validation.movementDifference, 0);
  assert.equal(validation.entryDifference, 40);
  assert.equal(validation.exitDifference, 40);
  assert.equal(validation.reconciled, false);
  assert.ok(validation.missingDays.length > 0);
  assert.ok(validation.dailyDifferences.length > 0);
});

test("aponta somente quando o total mensal diverge", async () => {
  const { validateMonthly } = await import(moduleUrl.href);
  const validation = validateMonthly(
    [{ id: "b1", date: new Date("2026-06-01T00:00:00Z"), description: "Entrada", value: 100 }],
    [{ id: "c1", date: new Date("2026-06-30T00:00:00Z"), value: 90, nature: "Débito", account: "1", accountName: "Banco" }],
    { agency: "", account: "", period: "06/2026", name: "Banco", openingBalance: null, closingBalance: null },
  );
  assert.equal(validation.movementDifference, 10);
  assert.equal(validation.reconciled, false);
});

test("considera débitos e créditos na diferença mensal exibida", async () => {
  const { validateMonthly } = await import(moduleUrl.href);
  const validation = validateMonthly(
    [
      { id: "b1", date: new Date("2026-06-01T00:00:00Z"), description: "Entradas", value: 103203.4 },
      { id: "b2", date: new Date("2026-06-30T00:00:00Z"), description: "Saídas", value: -107353.66 },
    ],
    [
      { id: "c1", date: new Date("2026-06-01T00:00:00Z"), value: 65277.87, nature: "Débito", account: "1", accountName: "Banco" },
      { id: "c2", date: new Date("2026-06-30T00:00:00Z"), value: -67353, nature: "Crédito", account: "1", accountName: "Banco" },
    ],
    { agency: "", account: "", period: "06/2026", name: "Banco", openingBalance: null, closingBalance: null },
  );

  assert.equal(validation.bankNet, -4150.26);
  assert.equal(validation.accountingNet, -2075.13);
  assert.equal(validation.entryDifference, 37925.53);
  assert.equal(validation.exitDifference, 40000.66);
  assert.equal(validation.movementDifference, -2075.13);
});

test("separa corretamente as diferenças de entradas e saídas do Santander", async () => {
  const { validateMonthly } = await import(moduleUrl.href);
  const validation = validateMonthly(
    [
      { date: new Date("2026-05-01T00:00:00Z"), value: 6018850.04 },
      { date: new Date("2026-05-31T00:00:00Z"), value: -6017861.05 },
    ],
    [
      { date: new Date("2026-05-01T00:00:00Z"), value: 5617764.6 },
      { date: new Date("2026-05-31T00:00:00Z"), value: -5617764.6 },
    ],
    { openingBalance: null, closingBalance: null },
  );

  assert.equal(validation.entryDifference, 401085.44);
  assert.equal(validation.exitDifference, 400096.45);
  assert.equal(validation.movementDifference, 988.99);
  assert.equal(validation.reconciled, false);
});
