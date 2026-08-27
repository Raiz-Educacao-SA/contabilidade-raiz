import { NextRequest, NextResponse } from "next/server";
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

type AuthorizedCompany = { code: string; name: string };

async function authorizedCompanies(request: NextRequest): Promise<AuthorizedCompany[] | null> {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return null;
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" });
  if (!userResponse.ok) return null;
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return null;
  const accessResponse = await fetch(`${url}/rest/v1/usuarios_empresas?select=empresas(codcoligada,razao_social)&usuario_id=eq.${encodeURIComponent(user.id)}`, { headers: { authorization, apikey: key }, cache: "no-store" });
  if (!accessResponse.ok) throw new Error("Não foi possível validar as empresas liberadas para este usuário.");
  const links = await accessResponse.json() as Array<{ empresas?: { codcoligada?: string | number; razao_social?: string } | null }>;
  const unique = new Map<string, AuthorizedCompany>();
  links.forEach((link) => {
    if (link.empresas?.codcoligada == null) return;
    const code = String(link.empresas.codcoligada);
    unique.set(code, { code, name: link.empresas.razao_social || `Coligada ${code}` });
  });
  return [...unique.values()].sort((left, right) => Number(left.code) - Number(right.code));
}

async function query(firstCompany: string, lastCompany: string, firstDay: string, lastDay: string, application: string) {
  return queryDataEngine({
    code: "RAZAOSEMLOTE0",
    system: "C",
    parameters: `PLN_B7_S=${application};PLN_B3_I=${firstCompany};PLN_B4_I=${lastCompany};PLN_B5_D=${firstDay};PLN_B6_D=${lastDay}`,
    errorMessage: "O TOTVS não conseguiu consultar a Planilha NET 5 do módulo Contábil.",
  });
}

export async function GET(request: NextRequest) {
  try {
    const company = request.nextUrl.searchParams.get("company")?.trim() || "";
    const competence = request.nextUrl.searchParams.get("competence")?.trim() || "";
    const dates = period(competence);
    if (!(company === "all" || /^\d+$/.test(company)) || !dates) {
      return NextResponse.json({ error: "Empresa e competência válidas são obrigatórias." }, { status: 400 });
    }
    const authorized = await authorizedCompanies(request);
    if (!authorized) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const selected = company === "all" ? authorized : authorized.filter((item) => Number(item.code) === Number(company));
    if (!selected.length) return NextResponse.json({ error: "Empresa não liberada para este usuário." }, { status: 403 });
    const allowedCodes = new Set(selected.map((item) => String(Number(item.code))));
    const companyNames = new Map(selected.map((item) => [String(Number(item.code)), item.name]));
    const sortedCodes = selected.map((item) => Number(item.code)).sort((left, right) => left - right);
    const firstCompany = String(sortedCodes[0]);
    const lastCompany = String(sortedCodes.at(-1));

    console.log("[pending-lots] consolidated query started", { competence, companies: selected.length, firstCompany, lastCompany });
    const attempts = await Promise.allSettled(APPLICATIONS.map((application) => query(firstCompany, lastCompany, dates.firstDay, dates.lastDay, application)));
    const records = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? attempt.value : []);
    if (!attempts.some((attempt) => attempt.status === "fulfilled")) throw new Error("O TOTVS não respondeu à consulta consolidada dos lotes pendentes.");
    const unique = new Map<string, string>();
    records.forEach((record) => {
      const recordCompany = String(Number(decodedTag(record, "CODCOLIGADA")));
      if (!allowedCodes.has(recordCompany)) return;
      const date = decodedTag(record, "DATA");
      if (date && !date.startsWith(competence)) return;
      const key = [decodedTag(record, "CODCOLIGADA"), decodedTag(record, "CODLOTE"), decodedTag(record, "INTEGRAAPLICACAO"), decodedTag(record, "CODCONTA"), date, decodedTag(record, "DEBITO"), decodedTag(record, "CREDITO"), decodedTag(record, "COMPLEMENTO")].join("|");
      unique.set(key, record);
    });

    const grouped = new Map<string, { companyCode: string; companyName: string; lotCode: string; application: string; date: string; records: number; debit: number; credit: number }>();
    unique.forEach((record) => {
      const companyCode = String(Number(decodedTag(record, "CODCOLIGADA")));
      const lotCode = decodedTag(record, "CODLOTE") || "Sem código";
      const application = decodedTag(record, "INTEGRAAPLICACAO") || "—";
      const date = decodedTag(record, "DATA");
      const key = `${companyCode}|${application}|${lotCode}`;
      const current = grouped.get(key) ?? { companyCode, companyName: companyNames.get(companyCode) || `Coligada ${companyCode}`, lotCode, application, date, records: 0, debit: 0, credit: 0 };
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
    })).sort((left, right) => Number(left.companyCode) - Number(right.companyCode) || right.date.localeCompare(left.date) || right.lotCode.localeCompare(left.lotCode));

    console.log("[pending-lots] consolidated query completed", { competence, companies: selected.length, records: unique.size, lots: lots.length, failedApplications: attempts.filter((attempt) => attempt.status === "rejected").length });

    return NextResponse.json({
      source: "TOTVS RM — Planilha NET 5 / RAZAOSEMLOTE0",
      company: company === "all" ? "all" : selected[0].code,
      companies: selected.length,
      competence,
      updatedAt: new Date().toISOString(),
      lots,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
