import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const company = request.nextUrl.searchParams.get("company")?.trim();
  const competence = request.nextUrl.searchParams.get("competence")?.trim();

  if (!company || !/^\d{4}-\d{2}$/.test(competence || "")) {
    return NextResponse.json({ error: "Empresa e competência são obrigatórias." }, { status: 400 });
  }

  return NextResponse.json({
    status: "blocked",
    source: "TOTVS RM — Planilha 18",
    error: "A atualização contábil está preparada, mas a conta técnica ainda precisa de permissão somente leitura para consultar a Planilha 18 no TOTVS.",
  }, { status: 503 });
}
