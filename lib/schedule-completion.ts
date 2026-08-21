export type ScheduleCompletion = {
  modulo: string;
  setor: string;
  status: "pendente" | "concluido";
  confirmado_email: string | null;
  confirmado_em: string | null;
};

export function normalizeScheduleCompanyCode(code: string) {
  const value = String(code || "").trim();
  return value ? value.padStart(2, "0") : value;
}

export function accountingCompletionIdentity(taskId: string, companyCode: string, companyName: string) {
  const code = normalizeScheduleCompanyCode(companyCode);
  const cleanName = String(companyName || "")
    .replace(new RegExp(`^(?:${code}|${String(companyCode || "").trim()})\\s*[—-]\\s*`), "")
    .trim();
  const labels: Record<string, string> = {
    "pis-cofins": "PIS e COFINS",
    "irpj-csll": "IRPJ/CSLL",
    "rateio-csc": "Rateio CSC",
    intercompany: "Intercompany",
    provisoes: "Provisões",
    despesas: "Despesas",
    imobilizado: "Imobilizado",
    arrendamentos: "Arrendamentos",
    "analise-balancete": "Análise Balancete",
  };
  const label = labels[taskId] || taskId;
  return {
    modulo: `contabil:${taskId}:${code}`,
    setor: `Contabilidade · ${label} · ${code} — ${cleanName || companyName}`,
  };
}

export function financialCompletionIdentity(taskId: string, companyCode: string, companyName: string) {
  const code = normalizeScheduleCompanyCode(companyCode);
  const cleanName = String(companyName || "")
    .replace(new RegExp(`^(?:${code}|${String(companyCode || "").trim()})\\s*[—-]\\s*`), "")
    .trim();
  const labels: Record<string, string> = {
    bancaria: "Conciliação Bancária",
    receita: "Conciliação de Receita",
    emprestimos: "Conciliação de Empréstimos",
    parcelamentos: "Conciliação de Parcelamentos",
  };
  const label = labels[taskId] || taskId;
  return {
    modulo: `financeiro:${taskId}:${code}`,
    setor: `Financeiro · ${label} · ${code} — ${cleanName || companyName}`,
  };
}
