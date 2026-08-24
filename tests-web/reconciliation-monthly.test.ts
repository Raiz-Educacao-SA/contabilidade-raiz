import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/reconciliation-monthly.ts", import.meta.url);

test("considera conciliado quando o líquido mensal fecha após somar os movimentos", async () => {
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
  assert.equal(validation.reconciled, true);
  assert.ok(validation.missingDays.length > 0);
  assert.ok(validation.dailyDifferences.length > 0);
});

test("prioriza a soma líquida diária quando vários lançamentos contábeis fecham um movimento do extrato", async () => {
  const { validateMonthly } = await import(moduleUrl.href);
  const date = new Date("2026-06-30T00:00:00Z");
  const validation = validateMonthly(
    [{ date, value: 4000 }],
    [
      { date, value: 4637.82 },
      { date, value: -637.82 },
    ],
    { openingBalance: null, closingBalance: null },
  );

  assert.equal(validation.bankNet, 4000);
  assert.equal(validation.accountingNet, 4000);
  assert.equal(validation.movementDifference, 0);
  assert.equal(validation.reconciled, true);
  assert.deepEqual(validation.dailyDifferences, []);
  assert.deepEqual(validation.missingDays, []);
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

test("considera conciliado quando as datas diferem, mas os totais mensais fecham", async () => {
  const { validateMonthly } = await import(moduleUrl.href);
  const validation = validateMonthly(
    [
      { date: new Date("2026-05-04T00:00:00Z"), value: 100 },
      { date: new Date("2026-05-10T00:00:00Z"), value: -40 },
    ],
    [
      { date: new Date("2026-05-29T00:00:00Z"), value: 100 },
      { date: new Date("2026-05-31T00:00:00Z"), value: -40 },
    ],
    { openingBalance: null, closingBalance: null },
  );

  assert.equal(validation.entryDifference, 0);
  assert.equal(validation.exitDifference, 0);
  assert.equal(validation.reconciled, true);
  assert.ok(validation.dailyDifferences.length > 0);
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

test("aplica a tolerância mensal de até R$ 1,00", async () => {
  const { validateMonthly } = await import(moduleUrl.href);
  const date = new Date("2026-06-30T00:00:00Z");
  const reconciled = validateMonthly(
    [{ date, value: 100 }],
    [{ date, value: 99 }],
    { openingBalance: null, closingBalance: null },
  );
  const divergent = validateMonthly(
    [{ date, value: 100.01 }],
    [{ date, value: 99 }],
    { openingBalance: null, closingBalance: null },
  );

  assert.equal(reconciled.movementDifference, 1);
  assert.equal(reconciled.reconciled, true);
  assert.deepEqual(reconciled.dailyDifferences, []);
  assert.equal(divergent.movementDifference, 1.01);
  assert.equal(divergent.reconciled, false);
  assert.equal(divergent.dailyDifferences.length, 1);
});

test("desconsidera os dias que se compensam e mantém somente os que explicam a diferença mensal", async () => {
  const { selectMonthlyDifferenceDays } = await import(moduleUrl.href);
  const row = (date: string, netDifference: number) => ({
    date,
    bankCredits: 0,
    accountingDebits: 0,
    entryDifference: 0,
    bankDebits: 0,
    accountingCredits: 0,
    exitDifference: 0,
    netDifference,
  });
  const dailyDifferences = [
    row("2026-06-01", 210.8),
    row("2026-06-03", 876),
    row("2026-06-11", -100000),
    row("2026-06-12", 100000),
    row("2026-06-15", -100000),
    row("2026-06-18", 100000),
    row("2026-06-22", 100),
    row("2026-06-24", 11156),
    row("2026-06-25", 20),
    row("2026-06-26", 3.1),
    row("2026-06-29", 1040),
    row("2026-06-30", 9.33),
  ];

  const selected = selectMonthlyDifferenceDays(dailyDifferences, 13415.23);

  assert.deepEqual(
    selected.map((item: { date: string }) => item.date),
    [
      "2026-06-01",
      "2026-06-03",
      "2026-06-22",
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
      "2026-06-29",
      "2026-06-30",
    ],
  );
  assert.equal(
    Math.round(selected.reduce((total: number, item: { netDifference: number }) => total + item.netDifference, 0) * 100) / 100,
    13415.23,
  );
});
