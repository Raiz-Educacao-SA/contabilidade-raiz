import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCompany } from "@/lib/server/authorized-company";
import { decodedTag, queryDataEngine } from "@/lib/totvs-dataengine";

export const runtime = "nodejs";
export const maxDuration = 300;

const APPLICATIONS = ["F", "P", "N", "A", "V"];
const APPLICATION_NAMES: Record<string, string> = {
  F: "Financeiro (Fluxus)",
  P: "Folha (Labore)",
  N: "Fiscal/Compras (Nucleus)",
  A: "Ponto",
  V: "Gestão de Pessoas",
};

const amount = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return Math.abs(direct);
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
};

function period(competence: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) return null;
  const [year, month] = competence.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    firstDay: `${competence}-01`,
    lastDay: `${competence}-${String(lastDay).padStart(2, "0")}`,
  };
}

async function query(company: string, firstDay: string, lastDay: string, application: string) {
  return queryDataEngine({
    code: "RAZAOSEMLOTE0",
    system: "C",
    parameters: `PLN_B7_S=${application};PLN_B3_I=${company};PLN_B4_I=${company};PLN_B5_D=${firstDay};PLN_B6_D=${lastDay}`,
    errorMessage: "O TOTVS não conseguiu consultar a Planilha NET 5 do módulo Contábil.",
  });
}

export async function GET(request: NextRequest) {
  try {
    const company = request.nextUrl.searchParams.get("company")?.trim() || "";
    const competence = request.nextUrl.searchParams.get("competence")?.trim() || "";
    const dates = period(competence);
    if (!/^\d+$/.test(company) || !dates) {
      return NextResponse.json({ error: "Empresa e competência válidas são obrigatórias." }, { status: 400 });
    }
    const allowed = await isAuthorizedCompany({
      authorization: request.headers.get("authorization"),
      company,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    if (!allowed) return NextResponse.json({ error: "Empresa não liberada ou sessão expirada." }, { status: 403 });

    let records = await query(company, dates.firstDay, dates.lastDay, "%");
    if (!records.length) {
      records = (await Promise.all(APPLICATIONS.map((application) => query(company, dates.firstDay, dates.lastDay, application)))).flat();
    }
    const unique = new Map<string, string>();
    records.forEach((record) => {
      if (Number(decodedTag(record, "CODCOLIGADA")) !== Number(company)) return;
      const date = decodedTag(record, "DATA");
      if (date && !date.startsWith(competence)) return;
      const key = [decodedTag(record, "CODCOLIGADA"), decodedTag(record, "CODLOTE"), decodedTag(record, "INTEGRAAPLICACAO"), decodedTag(record, "CODCONTA"), date, decodedTag(record, "DEBITO"), decodedTag(record, "CREDITO"), decodedTag(record, "COMPLEMENTO")].join("|");
      unique.set(key, record);
    });

    const grouped = new Map<string, { lotCode: string; application: string; date: string; records: number; debit: number; credit: number }>();
    unique.forEach((record) => {
      const lotCode = decodedTag(record, "CODLOTE") || "Sem código";
      const application = decodedTag(record, "INTEGRAAPLICACAO") || "—";
      const date = decodedTag(record, "DATA");
      const key = `${application}|${lotCode}`;
      const current = grouped.get(key) ?? { lotCode, application, date, records: 0, debit: 0, credit: 0 };
      current.records += 1;
      current.debit += amount(decodedTag(record, "DEBITO"));
      current.credit += amount(decodedTag(record, "CREDITO"));
      if (date && (!current.date || date < current.date)) current.date = date;
      grouped.set(key, current);
    });

    const lots = [...grouped.values()].map((lot) => ({
      ...lot,
      applicationName: APPLICATION_NAMES[lot.application] || `Origem ${lot.application}`,
      difference: Math.round((lot.debit - lot.credit) * 100) / 100,
    })).sort((left, right) => right.date.localeCompare(left.date) || right.lotCode.localeCompare(left.lotCode));

    return NextResponse.json({
      source: "TOTVS RM — Planilha NET 5 / RAZAOSEMLOTE0",
      company,
      competence,
      updatedAt: new Date().toISOString(),
      lots,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
