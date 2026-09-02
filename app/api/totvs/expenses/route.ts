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
    const firstDay = request.nextUrl.searchParams.get("start")?.trim() || "";
    const lastDay = request.nextUrl.searchParams.get("end")?.trim() || "";
    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}-\d{2}$/.test(firstDay) || !/^\d{4}-\d{2}-\d{2}$/.test(lastDay) || firstDay > lastDay) {
      return NextResponse.json({ error: "Coligada, data inicial e data final válidas são obrigatórias." }, { status: 400 });
    }

    const startDate = new Date(`${firstDay}T00:00:00Z`);
    const endDate = new Date(`${lastDay}T00:00:00Z`);
    const monthCount = (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + endDate.getUTCMonth() - startDate.getUTCMonth() + 1;
    if (monthCount > 12) return NextResponse.json({ error: "O período máximo da análise é de 12 meses." }, { status: 400 });
    const monthlyRanges = Array.from({ length: monthCount }, (_, index) => {
      const date = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + index, 1));
      const rangeYear = date.getUTCFullYear();
      const rangeMonth = date.getUTCMonth() + 1;
      const prefix = `${rangeYear}-${String(rangeMonth).padStart(2, "0")}`;
      const monthFirst = `${prefix}-01`;
      const monthLast = `${prefix}-${String(new Date(Date.UTC(rangeYear, rangeMonth, 0)).getUTCDate()).padStart(2, "0")}`;
      return { firstDay: monthFirst < firstDay ? firstDay : monthFirst, lastDay: monthLast > lastDay ? lastDay : monthLast };
    });
    const batches = await Promise.all(monthlyRanges.map((range) => queryDataEngine({
      code: "PLAN.T.0003.001",
      system: "T",
      parameters: `PLN_B1_D=${range.firstDay};PLN_B2_D=${range.lastDay}`,
      errorMessage: `Falha ao atualizar a PlanilhaNet 08 em ${range.firstDay.slice(0, 7)}.`,
    })));
    const records = batches.flat();

    const rows = records
      .filter((record) => Number(tag(record, "CODCOLIGADA")) === Number(company))
      .map((record) => ({
        CODCOLIGADA: tag(record, "CODCOLIGADA"),
        CODFILIAL: tag(record, "CODFILIAL"),
        IDMOV: tag(record, "IDMOV"),
        NOMEFANTASIA: firstTag(record, ["NOMEFANTASIA", "NOME"]),
        CGCCFO: firstTag(record, ["CGCCFO", "CNPJCPF"]),
        CODTMV: tag(record, "CODTMV"),
        NUMEROMOV: tag(record, "NUMEROMOV"),
        DATAEMISSAO: tag(record, "DATAEMISSAO"),
        DATASAIDA: tag(record, "DATASAIDA"),
        CODUSUARIO: tag(record, "CODUSUARIO"),
        TICKET: firstTag(record, ["TICKET", "CODTICKET", "NUMEROTICKET"]),
        REDUZIDO: firstTag(record, ["REDUZIDO", "CODREDUZIDO", "REDUZIDODEBITO"]),
        DEBITO: tag(record, "DEBITO"),
        DESCRICAO: firstTag(record, ["DESCDEBITO", "DESCRICAO", "DESCCONTA"]),
        VALOR: numeric(tag(record, "VALOR")),
      }));

    return NextResponse.json({
      source: "TOTVS RM — PlanilhaNet 08 / FORNECEDOR X MOVIMENTOS",
      company,
      period: { firstDay, lastDay },
      records: rows.length,
      rows,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/expenses] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
