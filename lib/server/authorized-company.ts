type AuthorizationOptions = {
  anonKey?: string;
  authorization: string | null;
  company: string;
  fetcher?: typeof fetch;
  supabaseUrl?: string;
};

export async function isAuthorizedCompany({
  anonKey,
  authorization,
  company,
  fetcher = fetch,
  supabaseUrl,
}: AuthorizationOptions) {
  if (!authorization || !anonKey || !supabaseUrl || !/^\d+$/.test(company)) {
    return false;
  }
  try {
    const endpoint = new URL("/rest/v1/empresas", supabaseUrl);
    endpoint.searchParams.set("select", "id");
    endpoint.searchParams.set("codcoligada", `eq.${company}`);
    endpoint.searchParams.set("limit", "1");
    const response = await fetcher(endpoint, {
      cache: "no-store",
      headers: { apikey: anonKey, authorization },
    });
    if (!response.ok) return false;
    const companies = (await response.json()) as unknown;
    return Array.isArray(companies) && companies.length === 1;
  } catch {
    return false;
  }
}
