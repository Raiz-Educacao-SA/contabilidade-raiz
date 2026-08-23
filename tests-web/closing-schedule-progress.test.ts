import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/closing-schedule-progress.ts", import.meta.url);
const {
  ACCOUNTING_SCHEDULE_TASK_IDS,
  FINANCIAL_SCHEDULE_TASK_IDS,
  calculateClosingScheduleProgress,
} = await import(moduleUrl.href);

function completed(modulo: string) {
  return { modulo, status: "concluido" as const };
}

test("conta somente os quatro módulos que alimentam o cronograma", () => {
  const records = [
    completed("fiscal"),
    completed("folha"),
    completed("book"),
    completed("compras"),
    completed("contabil:pis-cofins:02"),
    completed("financeiro:bancaria:02"),
  ];

  const progress = calculateClosingScheduleProgress(records, ["2"]);

  assert.equal(progress.totalModules, 4);
  assert.equal(progress.completedModulesCount, 2);
  assert.deepEqual(progress.completedModules, ["fiscal", "folha"]);
  assert.equal(progress.modulePercent.financeiro, 25);
  assert.equal(progress.modulePercent.contabil, 11);
  assert.equal(progress.overallPercent, 59);
});

test("conclui Financeiro e Contábil apenas quando todas as tarefas e empresas terminarem", () => {
  const companyCodes = ["01", "2"];
  const financialTaskIds = FINANCIAL_SCHEDULE_TASK_IDS as readonly string[];
  const accountingTaskIds = ACCOUNTING_SCHEDULE_TASK_IDS as readonly string[];
  const records = [
    ...financialTaskIds.flatMap((task) =>
      ["01", "02"].map((company) => completed(`financeiro:${task}:${company}`)),
    ),
    ...accountingTaskIds.flatMap((task) =>
      ["01", "02"].map((company) => completed(`contabil:${task}:${company}`)),
    ),
    completed("fiscal"),
    completed("folha"),
  ];

  const progress = calculateClosingScheduleProgress(records, companyCodes);

  assert.equal(progress.completedModulesCount, 4);
  assert.equal(progress.overallPercent, 100);
  assert.deepEqual(progress.modulePercent, {
    financeiro: 100,
    fiscal: 100,
    folha: 100,
    contabil: 100,
  });
});

test("ignora confirmações gerais antigas de Financeiro e Contábil", () => {
  const progress = calculateClosingScheduleProgress(
    [completed("financeiro"), completed("contabil")],
    ["01"],
  );

  assert.equal(progress.modulePercent.financeiro, 0);
  assert.equal(progress.modulePercent.contabil, 0);
  assert.equal(progress.completedModulesCount, 0);
  assert.equal(progress.overallPercent, 0);
});
