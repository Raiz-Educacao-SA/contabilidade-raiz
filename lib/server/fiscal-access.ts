import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { isAllowedCorporateEmail } from "../auth-domain.ts";
import { resolveAllowedModules, type AccessModule } from "../access-control.ts";
import { bearerToken } from "./supabase-access.ts";

export type FiscalAccessScope = {
  readonly companyId?: string | null;
  readonly companyCode?: string | null;
  readonly competence?: string | null;
};

export type FiscalAccessCompany = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly cnpj: string;
  readonly profile: string;
};

export type FiscalAccessContext = {
  readonly client: SupabaseClient;
  readonly user: User;
  readonly accessToken: string;
  readonly company: FiscalAccessCompany;
  readonly canWrite: boolean;
  readonly allowedModules: readonly AccessModule[];
  readonly competence: string;
};

type UserCompanyRow = {
  readonly empresa_id: string;
  readonly perfil: string;
  readonly empresas:
    | {
        readonly id: string;
        readonly codcoligada: string;
        readonly razao_social: string;
        readonly cnpj: string;
      }
    | {
        readonly id: string;
        readonly codcoligada: string;
        readonly razao_social: string;
        readonly cnpj: string;
      }[]
    | null;
};

type UserModuleRow = {
  readonly modulo: string;
};

export class FiscalAccessError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function publicConfiguration() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
  };
}

function createRequestSupabase(accessToken: string) {
  const { url, anonKey } = publicConfiguration();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function assertFiscalCompetence(competence: string | null | undefined) {
  const value = String(competence ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new FiscalAccessError(400, "INVALID_COMPETENCE", "Competência fiscal inválida.");
  }
  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12) {
    throw new FiscalAccessError(400, "INVALID_COMPETENCE", "Mês da competência fiscal inválido.");
  }
  return value;
}

export function parseFiscalRequestScope(request: Request): FiscalAccessScope {
  const url = new URL(request.url);
  return {
    companyId: url.searchParams.get("companyId"),
    companyCode: url.searchParams.get("company"),
    competence: url.searchParams.get("competence"),
  };
}

function relationOne<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function sameCompany(row: UserCompanyRow, scope: FiscalAccessScope) {
  const company = relationOne(row.empresas);
  if (!company) return false;
  if (scope.companyId && row.empresa_id === scope.companyId) return true;
  if (scope.companyCode && company.codcoligada === scope.companyCode) return true;
  return false;
}

function normalizeProfile(value: string) {
  return String(value || "").trim().toLowerCase();
}

export async function requireFiscalAccess(
  request: Request,
  scope: FiscalAccessScope,
  options: { readonly write?: boolean } = {},
): Promise<FiscalAccessContext> {
  const accessToken = bearerToken(request);
  const competence = assertFiscalCompetence(scope.competence);
  if (!accessToken) {
    throw new FiscalAccessError(401, "MISSING_TOKEN", "Autenticação obrigatória.");
  }
  if (!scope.companyId && !scope.companyCode) {
    throw new FiscalAccessError(400, "MISSING_COMPANY", "Empresa obrigatória.");
  }
  const client = createRequestSupabase(accessToken);
  if (!client) {
    throw new FiscalAccessError(500, "SUPABASE_NOT_CONFIGURED", "Supabase não configurado.");
  }
  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  const user = userData.user;
  if (userError || !user || !isAllowedCorporateEmail(user.email)) {
    throw new FiscalAccessError(401, "INVALID_TOKEN", "Usuário não autenticado para o domínio corporativo.");
  }
  const [companiesResult, modulesResult] = await Promise.all([
    client
      .from("usuarios_empresas")
      .select("empresa_id,perfil,empresas(id,codcoligada,razao_social,cnpj)")
      .eq("usuario_id", user.id),
    client
      .from("usuarios_modulos")
      .select("modulo")
      .eq("usuario_id", user.id),
  ]);
  if (companiesResult.error) {
    throw new FiscalAccessError(403, "COMPANY_ACCESS_LOOKUP_FAILED", "Não foi possível validar vínculo com empresa.");
  }
  const companyRows = (companiesResult.data ?? []) as UserCompanyRow[];
  const target = companyRows.find((row) => sameCompany(row, scope));
  const profiles = companyRows.map((row) => normalizeProfile(row.perfil)).filter(Boolean);
  const grants = modulesResult.error ? [] : ((modulesResult.data ?? []) as UserModuleRow[]).map((row) => row.modulo);
  const allowedModules = resolveAllowedModules(profiles, grants);
  const company = target ? relationOne(target.empresas) : null;
  if (!target || !company) {
    throw new FiscalAccessError(403, "COMPANY_NOT_LINKED", "Usuário não está vinculado à empresa informada.");
  }
  if (!allowedModules.includes("contabil")) {
    throw new FiscalAccessError(403, "MISSING_CONTABIL_MODULE", "Usuário sem acesso ao módulo contabil.");
  }
  const profile = normalizeProfile(target.perfil);
  const canWrite = profile !== "consulta";
  if (options.write && !canWrite) {
    throw new FiscalAccessError(403, "READONLY_PROFILE", "Perfil Consulta não pode executar ação mutável.");
  }
  return {
    client,
    user,
    accessToken,
    canWrite,
    allowedModules,
    competence,
    company: {
      id: target.empresa_id,
      code: company.codcoligada,
      name: company.razao_social,
      cnpj: company.cnpj,
      profile: target.perfil,
    },
  };
}

export function fiscalAccessErrorResponse(error: unknown) {
  if (error instanceof FiscalAccessError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : "Erro inesperado no backend fiscal.";
  return { status: 500, body: { ok: false, code: "FISCAL_BACKEND_ERROR", message } };
}



