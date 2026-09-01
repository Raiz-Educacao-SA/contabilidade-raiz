import { NextRequest, NextResponse } from "next/server";
import { queryDataEngine } from "@/lib/totvs-dataengine";

export const runtime = "nodejs";
export const maxDuration = 300;

const tag = (xml: string, name: string) => {
  const value = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() || "";
  return value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
};
const firstTag = (xml: string, names: string[]) => names.map((name) => tag(xml, name)).find(Boolean) || "";
const numeric = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

async function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  return (await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" })).ok;
}

export async function GET(request: NextRequest) {
  try {
    if (!await authorized(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) {
      return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });
    }

    const [year, month] = competence!.split("-").map(Number);
    const periodStart = new Date(Date.UTC(year, month - 6, 1));
    const firstDay = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const records = await queryDataEngine({
      code: "PLAN.T.0003.001",
      system: "T",
      parameters: `PLN_B1_D=${firstDay};PLN_B2_D=${lastDay}`,
      errorMessage: "Falha ao atualizar a PlanilhaNet 08 do módulo de Compras.",
    });

    const rows = records
      .filter((record) => Number(tag(record, "CODCOLIGADA")) === Number(company))
      .map((record) => ({
        CODCOLIGADA: tag(record, "CODCOLIGADA"),
        CODFILIAL: tag(record, "CODFILIAL"),
        IDMOV: tag(record, "IDMOV"),
        NOMEFANTASIA: firstTag(record, ["NOMEFANTASIA", "NOME"]),
        DATASAIDA: tag(record, "DATASAIDA"),
        DEBITO: tag(record, "DEBITO"),
        DESCRICAO: firstTag(record, ["DESCDEBITO", "DESCRICAO", "DESCCONTA"]),
        VALOR: numeric(tag(record, "VALOR")),
      }));

    return NextResponse.json({
      source: "TOTVS RM — PlanilhaNet 08 / FORNECEDOR X MOVIMENTOS",
      company,
      competence,
      period: { firstDay, lastDay },
      records: rows.length,
      rows,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/expenses] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
