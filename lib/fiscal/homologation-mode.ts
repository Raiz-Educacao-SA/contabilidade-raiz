export const IRPJ_CSLL_HOMOLOGATION_FLAG = "NEXT_PUBLIC_IRPJ_CSLL_HOMOLOGATION_MODE";
export const IRPJ_CSLL_SERVER_HOMOLOGATION_FLAG = "IRPJ_CSLL_HOMOLOGATION_MODE";

export const IRPJ_CSLL_HOMOLOGATION_TOKEN = "irpj-csll-homologation-token";

export const IRPJ_CSLL_HOMOLOGATION_USER = {
  id: "00000000-0000-5000-9000-000000000001",
  email: "homologacao.irpj-csll@raizeducacao.com.br",
  name: "Homologação IRPJ/CSLL",
} as const;

export const IRPJ_CSLL_HOMOLOGATION_COMPANY = {
  id: "00000000-0000-5000-9000-000000000099",
  code: "99",
  name: "Empresa Homologação IRPJ/CSLL",
  cnpj: "00.000.000/0001-99",
  profile: "Contábil",
} as const;

export function isIrpjCsllHomologationMode() {
  const env = process.env as Record<string, string | undefined>;
  const enabled =
    env[IRPJ_CSLL_SERVER_HOMOLOGATION_FLAG]
    ?? process.env.NEXT_PUBLIC_IRPJ_CSLL_HOMOLOGATION_MODE
    ?? env[IRPJ_CSLL_HOMOLOGATION_FLAG];
  return env.NODE_ENV === "development" && enabled === "true";
}

export function isIrpjCsllHomologationToken(token: string | null | undefined) {
  return isIrpjCsllHomologationMode() && token === IRPJ_CSLL_HOMOLOGATION_TOKEN;
}