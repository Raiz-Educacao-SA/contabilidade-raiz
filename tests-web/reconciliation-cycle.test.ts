import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/reconciliation-cycle.ts", import.meta.url);

test("libera somente quando a fonte foi atualizada depois da última conciliação", async () => {
  const { sourceReadyForReconciliation } = await import(moduleUrl.href);

  assert.equal(sourceReadyForReconciliation(true, true, 101, 100), true);
  assert.equal(sourceReadyForReconciliation(true, true, 100, 100), false);
  assert.equal(sourceReadyForReconciliation(true, true, 99, 100), false);
  assert.equal(sourceReadyForReconciliation(false, true, 101, 100), false);
  assert.equal(sourceReadyForReconciliation(true, false, 101, 100), false);
});

test("consome as duas atualizações ao concluir a conciliação", async () => {
  const { completedReconciliationRevision, sourceReadyForReconciliation } = await import(moduleUrl.href);
  const completed = completedReconciliationRevision(101, 102);

  assert.equal(completed, 102);
  assert.equal(sourceReadyForReconciliation(true, true, 101, completed), false);
  assert.equal(sourceReadyForReconciliation(true, true, 102, completed), false);
  assert.equal(sourceReadyForReconciliation(true, true, 103, completed), true);
});
