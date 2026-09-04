export async function zeevRequest(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
}

const userSuffix = (email: string) => email === "luanda.silva@raizeducacao.com.br" ? "LUANDA" : email.split("@")[0].replace(/[^a-z0-9]/gi, "_").toUpperCase();
const tokenFromPayload = (payload: Record<string, unknown>) => String(payload.temporaryToken || payload.token || payload.accessToken || payload.value || "").trim();

async function temporaryToken(baseUrl: string, email: string) {
  const suffix = userSuffix(email);
  const login = process.env[`ZEEV_LOGIN_${suffix}`];
  const password = process.env[`ZEEV_PASSWORD_${suffix}`];
  if (!login || !password) return "";
  const response = await fetch(`${baseUrl}/api/2/tokens`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ login, password }), cache: "no-store", signal: AbortSignal.timeout(30_000) });
  return response.ok ? tokenFromPayload(await response.json()) : "";
}

export async function zeevTokenForUser(baseUrl: string, email: string) {
  const personalToken = process.env[`ZEEV_API_TOKEN_${userSuffix(email)}`];
  if (personalToken) return personalToken;
  const integrationToken = process.env.ZEEV_INTEGRATION_TOKEN || process.env.ZEEV_API_TOKEN;
  if (integrationToken) {
    const impersonation = await zeevRequest(baseUrl, integrationToken, `/api/2/tokens/impersonate/${encodeURIComponent(email)}`);
    if (impersonation.ok) {
      const delegated = tokenFromPayload(await impersonation.json());
      if (delegated) return delegated;
    }
    return integrationToken;
  }
  return temporaryToken(baseUrl, email);
}
