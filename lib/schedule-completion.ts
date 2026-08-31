export type ScheduleCompletion = {
  modulo: string;
  setor: string;
  status: "pendente" | "concluido";
  confirmado_email: string | null;
  confirmado_em: string | null;
};

export type ScheduleCompletionIdentity = Pick<ScheduleCompletion, "modulo" | "setor">;

export const MODULE_COMPLETION_CHANGED_EVENT = "contabilidade-raiz:module-completion-changed";

export type ModuleCompletionChangeDetail = {
  competence: string;
  moduleKeys: string[];
  status: ScheduleCompletion["status"];
  confirmedAt: string;
  userEmail: string;
};

export function normalizeScheduleCompanyCode(code: string) {
  const value = String(code || "").trim();
  return value ? value.padStart(2, "0") : value;
}

function scopedCompletionIdentity(
  prefix: "financeiro" | "fiscal" | "folha" | "contabil" | "book" | "compras",
  areaLabel: string,
  taskId: string,
  taskLabel: string,
  companyCode: string,
  companyName: string,
): ScheduleCompletionIdentity {
  const code = normalizeScheduleCompanyCode(companyCode);
  const cleanName = String(companyName || "")
    .replace(new RegExp(`^(?:${code}|${String(companyCode || "").trim()})\\s*[—-]\\s*`), "")
    .trim();

  return {
    modulo: `${prefix}:${taskId}:${code}`,
    setor: `${areaLabel} · ${taskLabel} · ${code} — ${cleanName || companyName}`,
  };
}

export function accountingCompletionIdentity(taskId: string, companyCode: string, companyName: string) {
  const labels: Record<string, string> = {
    "pis-cofins": "PIS e COFINS",
    "irpj-csll": "IRPJ/CSLL",
    "rateio-csc": "Rateio CSC",
    intercompany: "Intercompany",
    provisoes: "Provisões",
    despesas: "Despesas",
    arrendamentos: "Arrendamentos",
    "receita-filial": "Receita por Filial",
    "lotes-integrar": "Lotes a integrar",
    "analise-balancete": "Análise Balancete",
  };
  const label = labels[taskId] || taskId;
  return scopedCompletionIdentity("contabil", "Contabilidade", taskId, label, companyCode, companyName);
}

export function financialCompletionIdentity(taskId: string, companyCode: string, companyName: string) {
  const labels: Record<string, string> = {
    bancaria: "Conciliação Bancária",
    receita: "Conciliação de Receita",
    emprestimos: "Conciliação de Empréstimos",
    parcelamentos: "Conciliação de Parcelamentos",
  };
  const label = labels[taskId] || taskId;
  return scopedCompletionIdentity("financeiro", "Financeiro", taskId, label, companyCode, companyName);
}

export function fiscalCompletionIdentity(taskId: string, companyCode: string, companyName: string) {
  const labels: Record<string, string> = {
    paa: "PAA",
    iss: "ISS",
    ecd: "ECD",
  };
  return scopedCompletionIdentity("fiscal", "Fiscal", taskId, labels[taskId] || taskId, companyCode, companyName);
}

export function payrollCompletionIdentity(taskId: string, companyCode: string, companyName: string) {
  const labels: Record<string, string> = {
    lote: "Conferência do Lote",
    liquidos: "Líquidos da Folha",
    inss: "INSS",
    fgts: "FGTS",
    irrf: "IRRF",
    provisoes: "Provisões",
  };
  return scopedCompletionIdentity("folha", "Folha de Pagamento", taskId, labels[taskId] || taskId, companyCode, companyName);
}

export function bookCompletionIdentity(taskId: string, companyCode: string, companyName: string) {
  const labels: Record<string, string> = {
    balancete: "Balancete",
    razao: "Razão",
    "plano-contas": "Plano de Contas",
  };
  return scopedCompletionIdentity("book", "Book Contábil", taskId, labels[taskId] || taskId, companyCode, companyName);
}

export function purchasesCompletionIdentity(companyCode: string, companyName: string) {
  return scopedCompletionIdentity("compras", "Compras", "rotina", "Rotina de Compras", companyCode, companyName);
}
