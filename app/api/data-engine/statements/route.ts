import { NextRequest, NextResponse } from "next/server";
import {
  loadDataEngineStatements,
  statementPeriod,
} from "@/lib/data-engine-statements";

export const runtime = "nodejs";

async function authorizedForCompany(request: NextRequest, company: string) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  try {
    const endpoint = new URL("/rest/v1/empresas", url);
    endpoint.searchParams.set("select", "id");
    endpoint.searchParams.set("codcoligada", `eq.${company}`);
    endpoint.searchParams.set("limit", "1");
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { apikey: key, authorization },
    });
    if (!response.ok) return false;
    const companies = (await response.json()) as unknown;
    return Array.isArray(companies) && companies.length === 1;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const company = request.nextUrl.searchParams.get("company")?.trim() ?? "";
  const competence =
    request.nextUrl.searchParams.get("competence")?.trim() ?? "";
  if (!/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence)) {
    return NextResponse.json(
      { error: "Coligada e competência são obrigatórias." },
      { status: 400 },
    );
  }
  if (!(await authorizedForCompany(request, company))) {
    return NextResponse.json(
      { error: "Sessão inválida ou empresa não autorizada." },
      { status: 403 },
    );
  }

  const baseUrl = process.env.DATA_ENGINE_URL;
  const apiKey = process.env.DATA_ENGINE_API_KEY;
  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { error: "A integração com o Data Engine não está configurada." },
      { status: 503 },
    );
  }

  try {
    const { fromDate, toDate } = statementPeriod(competence);
    const statements = await loadDataEngineStatements({
      apiKey,
      baseUrl,
      codColigada: Number(company),
      fromDate,
      toDate,
    });
    return NextResponse.json(
      {
        company,
        competence,
        records: statements.reduce(
          (total, statement) => total + statement.rows.length,
          0,
        ),
        source: "Raiz Data Engine",
        statements,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error &&
      /^(Data Engine|A integração|A coligada|O período|A competência)/.test(
        error.message,
      )
        ? error.message
        : "Não foi possível consultar os extratos no Data Engine.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
