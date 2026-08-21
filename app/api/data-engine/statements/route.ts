import { NextRequest, NextResponse } from "next/server";
import {
  DataEngineHttpError,
  loadDataEngineStatementSnapshot,
  statementPeriod,
} from "@/lib/data-engine-statements";
import { isAuthorizedCompany } from "@/lib/server/authorized-company";
import { getDataEngineOAuthClient } from "@/lib/server/data-engine-oauth";

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

  const baseUrl =
    process.env.DATA_ENGINE_BASE_URL ??
    process.env.DATA_ENGINE_URL ??
    process.env.DATA_ENGINE_API_URL;
  const clientId = process.env.DATA_ENGINE_CONSUMER_ID;
  const kid = process.env.DATA_ENGINE_KID;
  const privateKeyPem = process.env.DATA_ENGINE_PRIVATE_KEY;
  if (!baseUrl || !clientId || !kid || !privateKeyPem) {
    return NextResponse.json(
      { error: "A integração com o Data Engine não está configurada." },
      { status: 503 },
    );
  }

  try {
    const oauthClient = getDataEngineOAuthClient({
      audience: process.env.DATA_ENGINE_JWT_AUDIENCE,
      baseUrl,
      clientId,
      kid,
      privateKeyPem,
      scope: "read:tesouraria",
      tokenUrl: process.env.DATA_ENGINE_TOKEN_URL,
    });
    const { fromDate, toDate } = statementPeriod(competence);
    const loadSnapshot = (accessToken: string) =>
      loadDataEngineStatementSnapshot({
        accessToken,
        baseUrl,
        codColigada: Number(company),
        codColigadaCode: company.padStart(2, "0"),
        fromDate,
        toDate,
      });
    let accessToken = await oauthClient.getAccessToken();
    let snapshot;
    try {
      snapshot = await loadSnapshot(accessToken);
    } catch (error) {
      if (!(error instanceof DataEngineHttpError) || error.status !== 401) {
        throw error;
      }
      oauthClient.invalidateAccessToken(accessToken);
      accessToken = await oauthClient.getAccessToken();
      snapshot = await loadSnapshot(accessToken);
    }
    return NextResponse.json(
      {
        company,
        competence,
        records: snapshot.operations.movimentos,
        source: "Raiz Data Engine",
        statements: snapshot.statements,
        operations: snapshot.operations,
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
