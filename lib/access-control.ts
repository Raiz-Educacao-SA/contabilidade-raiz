export const ACCESS_MODULES = [
  "financeiro",
  "fiscal",
  "compras",
  "folha",
  "contabil",
  "book",
  "cronograma",
] as const;

export type AccessModule = (typeof ACCESS_MODULES)[number];

export const ACCESS_MODULE_LABELS: Record<AccessModule, string> = {
  financeiro: "Módulo Financeiro",
  fiscal: "Módulo Fiscal",
  compras: "Módulo Compras",
  folha: "Módulo Folha de Pagamento",
  contabil: "Módulo Contábil",
  book: "Book Contábil",
  cronograma: "Cronograma de Fechamento",
};

export function isAccessModule(value: unknown): value is AccessModule {
  return typeof value === "string" && ACCESS_MODULES.includes(value as AccessModule);
}

export function legacyProfilesToModules(profiles: string[]): AccessModule[] {
  const normalized = new Set(profiles.map((profile) => profile.trim().toLowerCase()));
  if (normalized.has("administrador")) return [...ACCESS_MODULES];

  const modules: AccessModule[] = ["cronograma"];
  if (normalized.has("financeiro")) modules.push("financeiro");
  if (normalized.has("fiscal")) modules.push("fiscal");
  if (normalized.has("compras")) modules.push("compras");
  if (normalized.has("folha") || normalized.has("folha de pagamento")) modules.push("folha");
  if (normalized.has("contabil") || normalized.has("contábil") || normalized.has("contabilidade")) {
    modules.push("contabil", "book");
  }
  return [...new Set(modules)];
}

export function resolveAllowedModules(profiles: string[], grants: string[]): AccessModule[] {
  if (profiles.some((profile) => profile.trim().toLowerCase() === "administrador")) {
    return [...ACCESS_MODULES];
  }
  const explicit = grants.filter(isAccessModule);
  return explicit.length ? [...new Set(explicit)] : legacyProfilesToModules(profiles);
}

export function requiredModulesForApiPath(pathname: string): AccessModule[] {
  if (pathname.startsWith("/api/data-engine") || pathname.startsWith("/api/drive")) return ["financeiro"];
  if (pathname.startsWith("/api/payroll")) return ["folha"];
  if (pathname.startsWith("/api/totvs/revenue-reconciliation")) return ["financeiro"];
  if (pathname.startsWith("/api/totvs/loans")) return ["financeiro"];
  if (pathname.startsWith("/api/totvs/accounting")) return ["financeiro", "contabil"];
  if (pathname.startsWith("/api/totvs/expenses")) return ["contabil"];
  if (pathname.startsWith("/api/totvs/pis-cofins") || pathname.startsWith("/api/totvs/trial-balance")) return ["contabil"];
  if (pathname.startsWith("/api/zeev")) return ["contabil"];
  return [];
}
