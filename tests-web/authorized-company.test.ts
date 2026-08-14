import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../lib/server/authorized-company.ts", import.meta.url);

test("falha fechado sem sessão e não consulta o Supabase", async () => {
  assert.equal(existsSync(moduleUrl), true, "Company authorization module is missing");
  const { isAuthorizedCompany } = await import(moduleUrl.href);
  let requests = 0;
  const authorized = await isAuthorizedCompany({
    anonKey: "public-anon-key",
    authorization: null,
    company: "10",
    fetcher: async () => {
      requests += 1;
      return Response.json([{ id: "company-id" }]);
    },
    supabaseUrl: "https://supabase.example",
  });
  assert.equal(authorized, false);
  assert.equal(requests, 0);
});

test("autoriza somente a coligada visível por RLS", async () => {
  assert.equal(existsSync(moduleUrl), true, "Company authorization module is missing");
  const { isAuthorizedCompany } = await import(moduleUrl.href);
  const requests: Array<{ headers: Headers; url: URL }> = [];
  const authorized = await isAuthorizedCompany({
    anonKey: "public-anon-key",
    authorization: "Bearer user-token",
    company: "10",
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ headers: new Headers(init?.headers), url: new URL(String(input)) });
      return Response.json([{ id: "company-id" }]);
    },
    supabaseUrl: "https://supabase.example",
  });
  assert.equal(authorized, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, "/rest/v1/empresas");
  assert.equal(requests[0].url.searchParams.get("codcoligada"), "eq.10");
  assert.equal(requests[0].headers.get("authorization"), "Bearer user-token");
  assert.equal(requests[0].headers.get("apikey"), "public-anon-key");

  const denied = await isAuthorizedCompany({
    anonKey: "public-anon-key",
    authorization: "Bearer user-token",
    company: "11",
    fetcher: async () => Response.json([]),
    supabaseUrl: "https://supabase.example",
  });
  assert.equal(denied, false);
});
