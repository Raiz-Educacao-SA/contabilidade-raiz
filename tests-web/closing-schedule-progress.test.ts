import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/closing-schedule-progress.ts", import.meta.url);
const {
  ACCOUNTING_SCHEDULE_TASK_IDS,
  BOOK_SCHEDULE_TASK_IDS,
  FISCAL_SCHEDULE_TASK_IDS,
  FINANCIAL_SCHEDULE_TASK_IDS,
  PAYROLL_SCHEDULE_TASK_IDS,
  calculateClosingScheduleProgress,
  summarizeScheduleCompanyProgress,
} = await import(moduleUrl.href);

function completed(modulo: string) {
  return { modulo, status: "concluido" as const };
}

test("calcula somente confirmações detalhadas por tarefa e empresa", () => {
  const records = [
    completed("fiscal"),
    completed("folha:lote:02"),
    completed("book"),
    completed("compras"),
    completed("contabil:pis-cofins:02"),
    completed("financeiro:bancaria:02"),
  ];

  const progress = calculateClosingScheduleProgress(records, ["2"]);

  assert.equal(progress.totalModules, 5);
  assert.equal(progress.completedModulesCount, 0);
  assert.deepEqual(progress.completedModules, []);
  assert.deepEqual(progress.includedModules, ["financeiro", "fiscal", "folha", "contabil", "book"]);
  assert.equal(progress.modulePercent.financeiro, 25);
  assert.equal(progress.modulePercent.folha, 17);
  assert.equal(progress.modulePercent.contabil, 9);
  assert.equal(progress.overallPercent, 10);
});

test("não inclui Imobilizado nas tarefas do módulo Contábil", () => {
  assert.equal(ACCOUNTING_SCHEDULE_TASK_IDS.length, 11);
  assert.equal(ACCOUNTING_SCHEDULE_TASK_IDS.includes("imobilizado" as never), false);
});

test("conclui todos os módulos quando todas as tarefas por empresa foram finalizadas", () => {
  const companyCodes = ["01", "2"];
  const financialTaskIds = FINANCIAL_SCHEDULE_TASK_IDS as readonly string[];
  const accountingTaskIds = ACCOUNTING_SCHEDULE_TASK_IDS as readonly string[];
  const payrollTaskIds = PAYROLL_SCHEDULE_TASK_IDS as readonly string[];
  const fiscalTaskIds = FISCAL_SCHEDULE_TASK_IDS as readonly string[];
  const bookTaskIds = BOOK_SCHEDULE_TASK_IDS as readonly string[];
  const records = [
    ...financialTaskIds.flatMap((task) =>
      ["01", "02"].map((company) => completed(`financeiro:${task}:${company}`)),
    ),
    ...accountingTaskIds.flatMap((task) =>
      ["01", "02"].map((company) => completed(`contabil:${task}:${company}`)),
    ),
    ...fiscalTaskIds.flatMap((task) =>
      ["01", "02"].map((company) => completed(`fiscal:${task}:${company}`)),
    ),
    ...payrollTaskIds.flatMap((task) =>
      ["01", "02"].map((company) => completed(`folha:${task}:${company}`)),
    ),
    ...bookTaskIds.flatMap((task) =>
      ["01", "02"].map((company) => completed(`book:${task}:${company}`)),
    ),
  ];

  const progress = calculateClosingScheduleProgress(records, companyCodes);

  assert.equal(progress.completedModulesCount, 5);
  assert.equal(progress.overallPercent, 100);
  assert.deepEqual(progress.modulePercent, {
    financeiro: 100,
    fiscal: 100,
    folha: 100,
    contabil: 100,
    book: 100,
  });
});

test("ignora confirmações gerais antigas dos módulos", () => {
  const progress = calculateClosingScheduleProgress(
    [completed("financeiro"), completed("fiscal"), completed("folha"), completed("contabil"), completed("book")],
    ["01"],
  );

  assert.equal(progress.modulePercent.financeiro, 0);
  assert.equal(progress.modulePercent.folha, 0);
  assert.equal(progress.modulePercent.contabil, 0);
  assert.equal(progress.modulePercent.fiscal, 0);
  assert.equal(progress.modulePercent.book, 0);
  assert.equal(progress.completedModulesCount, 0);
  assert.equal(progress.overallPercent, 0);
});

test("resume o andamento de cada empresa para a matriz do cronograma", () => {
  const records = [
    completed("financeiro:bancaria:02"),
    completed("financeiro:emprestimos:02"),
  ];

  assert.deepEqual(
    summarizeScheduleCompanyProgress(records, "financeiro", FINANCIAL_SCHEDULE_TASK_IDS, "2"),
    {
      completedCount: 2,
      totalCount: 4,
      status: "andamento",
      observation: "2 de 4 atividades concluídas.",
    },
  );
});

test("resume separadamente o andamento da Folha por empresa", () => {
  const records = [
    completed("folha:lote:03"),
    completed("folha:inss:03"),
    completed("folha:fgts:03"),
  ];

  assert.deepEqual(
    summarizeScheduleCompanyProgress(records, "folha", PAYROLL_SCHEDULE_TASK_IDS, "3"),
    {
      completedCount: 3,
      totalCount: 6,
      status: "andamento",
      observation: "3 de 6 atividades concluídas.",
    },
  );
});

test("resume separadamente Fiscal e Book por empresa", () => {
  const records = [
    completed("fiscal:paa:02"),
    completed("fiscal:iss:02"),
    completed("book:balancete:02"),
  ];

  assert.equal(
    summarizeScheduleCompanyProgress(records, "fiscal", FISCAL_SCHEDULE_TASK_IDS, "2").completedCount,
    2,
  );
  assert.equal(
    summarizeScheduleCompanyProgress(records, "book", BOOK_SCHEDULE_TASK_IDS, "2").completedCount,
    1,
  );
});
