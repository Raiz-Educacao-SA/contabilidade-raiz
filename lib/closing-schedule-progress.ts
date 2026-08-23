export const CLOSING_SCHEDULE_MODULES = ["financeiro", "fiscal", "folha", "contabil"] as const;

export type ClosingScheduleModule = (typeof CLOSING_SCHEDULE_MODULES)[number];

export const FINANCIAL_SCHEDULE_TASK_IDS = ["bancaria", "receita", "emprestimos", "parcelamentos"] as const;

export const ACCOUNTING_SCHEDULE_TASK_IDS = [
  "pis-cofins",
  "irpj-csll",
  "rateio-csc",
  "intercompany",
  "provisoes",
  "despesas",
  "imobilizado",
  "arrendamentos",
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
  prefix: "financeiro" | "contabil",
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
  prefix: "financeiro" | "contabil",
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
    fiscal: completed.has("fiscal") ? 100 : 0,
    folha: completed.has("folha") ? 100 : 0,
    contabil: detailedModulePercent(completed, "contabil", ACCOUNTING_SCHEDULE_TASK_IDS, companyCodes),
  };
  const completedModules = CLOSING_SCHEDULE_MODULES.filter((module) => modulePercent[module] === 100);
  const overallPercent = Math.round(
    CLOSING_SCHEDULE_MODULES.reduce((total, module) => total + modulePercent[module], 0) /
      CLOSING_SCHEDULE_MODULES.length,
  );

  return {
    modulePercent,
    completedModules,
    completedModulesCount: completedModules.length,
    totalModules: CLOSING_SCHEDULE_MODULES.length,
    overallPercent,
  };
}
