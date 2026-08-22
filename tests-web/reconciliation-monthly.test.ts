import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/reconciliation-monthly.ts", import.meta.url);

test("considera conciliado quando o movimento do mês fecha mesmo com diferenças diárias", async () => {
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
  assert.equal(validation.reconciled, true);
  assert.ok(validation.missingDays.length > 0);
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
