import { NextRequest, NextResponse } from "next/server";
import {
  loadDataEngineStatements,
  statementPeriod,
} from "@/lib/data-engine-statements";
import { isAuthorizedCompany } from "@/lib/server/authorized-company";

export const runtime = "nodejs";

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
  if (
    !(await isAuthorizedCompany({
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      authorization: request.headers.get("authorization"),
      company,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    }))
  ) {
    return NextResponse.json(
      { error: "Sessão inválida ou empresa não autorizada." },
      { status: 403 },
    );
  }

  const baseUrl = process.env.DATA_ENGINE_URL ?? process.env.DATA_ENGINE_API_URL;
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
      codColigadaCode: company.padStart(2, "0"),
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
