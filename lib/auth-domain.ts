export const allowedEmailDomain = "raizeducacao.com.br";

export function isAllowedCorporateEmail(email?: string | null) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized.endsWith(`@${allowedEmailDomain}`)
    && normalized.length > allowedEmailDomain.length + 1;
}
