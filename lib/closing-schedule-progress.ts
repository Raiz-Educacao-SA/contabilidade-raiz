export const CLOSING_SCHEDULE_MODULES = ["financeiro", "fiscal", "folha", "contabil", "book"] as const;
export const CLOSING_SCHEDULE_MODULES_WITH_TASKS = [...CLOSING_SCHEDULE_MODULES] as const;

export type ClosingScheduleModule = (typeof CLOSING_SCHEDULE_MODULES)[number];

export const FINANCIAL_SCHEDULE_TASK_IDS = ["bancaria", "receita", "emprestimos", "parcelamentos"] as const;

export const PAYROLL_SCHEDULE_TASK_IDS = [
  "lote",
  "liquidos",
  "inss",
  "fgts",
  "irrf",
  "provisoes",
] as const;

export const FISCAL_SCHEDULE_TASK_IDS = ["paa", "iss", "ecd"] as const;

export const BOOK_SCHEDULE_TASK_IDS = ["balancete", "razao", "plano-contas"] as const;

export const ACCOUNTING_SCHEDULE_TASK_IDS = [
  "pis-cofins",
  "irpj-csll",
  "rateio-csc",
  "almoxarifado",
  "intercompany",
  "provisoes",
  "despesas",
  "arrendamentos",
  "receita-filial",
  "lotes-integrar",
  "analise-balancete",
] as const;

export type ClosingScheduleRecord = {
  modulo: string;
  status: "pendente" | "concluido";
};

function normalizeCompanyCode(code: string) {
  const value = String(code || "").trim();
  return value ? value.padStart(2, "0") : "";
}

export function summarizeScheduleCompanyProgress(
  records: readonly ClosingScheduleRecord[],
  prefix: ClosingScheduleModule,
  taskIds: readonly string[],
  rawCompanyCode: string,
) {
  const companyCode = normalizeCompanyCode(rawCompanyCode);
  const completed = new Set(
    records.filter((record) => record.status === "concluido").map((record) => record.modulo),
  );
  const completedCount = taskIds.filter((taskId) =>
    completed.has(`${prefix}:${taskId}:${companyCode}`),
  ).length;
  const totalCount = taskIds.length;
  const status = completedCount === totalCount && totalCount > 0
    ? "concluido"
    : completedCount > 0
      ? "andamento"
      : "pendente";

  return {
    completedCount,
    totalCount,
    status,
    observation: status === "concluido"
      ? "Todas as atividades concluídas."
      : status === "andamento"
        ? `${completedCount} de ${totalCount} atividades concluídas.`
        : "Aguardando início das atividades.",
  } as const;
}

function detailedModulePercent(
  completed: Set<string>,
  prefix: ClosingScheduleModule,
  taskIds: readonly string[],
  companyCodes: readonly string[],
) {
  const expectedItems = taskIds.flatMap((taskId) =>
    companyCodes.map((companyCode) => `${prefix}:${taskId}:${companyCode}`),
  );
  if (expectedItems.length === 0) return 0;
  const completedItems = expectedItems.filter((item) => completed.has(item)).length;
  return Math.round((completedItems / expectedItems.length) * 100);
}

export function calculateClosingScheduleProgress(
  records: readonly ClosingScheduleRecord[],
  rawCompanyCodes: readonly string[],
) {
  const companyCodes = [...new Set(rawCompanyCodes.map(normalizeCompanyCode).filter(Boolean))];
  const completed = new Set(
    records.filter((record) => record.status === "concluido").map((record) => record.modulo),
  );

  const modulePercent: Record<ClosingScheduleModule, number> = {
    financeiro: detailedModulePercent(completed, "financeiro", FINANCIAL_SCHEDULE_TASK_IDS, companyCodes),
    fiscal: detailedModulePercent(completed, "fiscal", FISCAL_SCHEDULE_TASK_IDS, companyCodes),
    folha: detailedModulePercent(completed, "folha", PAYROLL_SCHEDULE_TASK_IDS, companyCodes),
    contabil: detailedModulePercent(completed, "contabil", ACCOUNTING_SCHEDULE_TASK_IDS, companyCodes),
    book: detailedModulePercent(completed, "book", BOOK_SCHEDULE_TASK_IDS, companyCodes),
  };
  const includedModules = [...CLOSING_SCHEDULE_MODULES_WITH_TASKS];
  const completedModules = includedModules.filter((module) => modulePercent[module] === 100);
  const overallPercent = Math.round(
    includedModules.reduce((total, module) => total + modulePercent[module], 0) /
      includedModules.length,
  );

  return {
    modulePercent,
    includedModules,
    completedModules,
    completedModulesCount: completedModules.length,
    totalModules: includedModules.length,
    overallPercent,
  };
}
