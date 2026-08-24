import { NextRequest, NextResponse } from "next/server";
import { decodedTag, isAuthorized, readDataServerView } from "@/lib/totvs-dataengine";

export const runtime = "nodejs";
export const maxDuration = 300;

const LEASE_ACCOUNT = "2.1.7.01.01.53";
const LEASE_REDUCED_CODE = 2026;

const numeric = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthorized(request))) {
      return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    }

    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    const branches = new Set(
      (request.nextUrl.searchParams.get("branches") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );

    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) {
      return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });
    }

    const [year, month] = competence!.split("-").map(Number);
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;

    const dataSet = await readDataServerView({
      dataServerName: "CtbLanData",
      filter: [
        `CLANCAMENTO.CODCOLIGADA=${Number(company)}`,
        `CPARTIDA.DATA >= '${firstDay}'`,
        `CPARTIDA.DATA <= '${lastDay}'`,
        `DEBITO='${LEASE_ACCOUNT}'`,
        "INTEGRAAPLICACAO='F'",
      ].join(" AND "),
      context: `CODSISTEMA=C,CODCOLIGADA=${Number(company)}`,
      errorMessage: "Falha ao consultar os créditos de Arrendamentos no TOTVS/DataEngine.",
    });
    const records = Array.from(
      dataSet.matchAll(/<CLANCAMENTO_CPARTIDA>([\s\S]*?)<\/CLANCAMENTO_CPARTIDA>/gi),
      (match) => match[1],
    );

    const seen = new Set<string>();
    const rows = records.flatMap((record) => {
      const reduced = numeric(decodedTag(record, "REDUZIDODEBITO"));
      const value = numeric(decodedTag(record, "VALOR"));
      const account = decodedTag(record, "DEBITO");
      const financialOrigin = decodedTag(record, "INTEGRAAPLICACAO") === "F";
      const branch = decodedTag(record, "CODFILIAL");
      if (account !== LEASE_ACCOUNT || value <= 0 || !financialOrigin || (branches.size && !branches.has(branch))) return [];

      const key = [
        decodedTag(record, "CODCOLIGADA"),
        branch,
        decodedTag(record, "IDLANCAMENTO"),
        decodedTag(record, "IDPARTIDA"),
      ].join("|");
      if (seen.has(key)) return [];
      seen.add(key);

      return [{
        company: decodedTag(record, "CODCOLIGADA"),
        branch,
        entryId: decodedTag(record, "IDLANCAMENTO"),
        document: decodedTag(record, "DOCUMENTO"),
        integrationKey: decodedTag(record, "INTEGRACHAVE", "IDMOV"),
        sourceSystem: "Financeiro",
        date: decodedTag(record, "DATA"),
        reduced: reduced || LEASE_REDUCED_CODE,
        account,
        description: decodedTag(record, "DESCRICAODEBITO", "DESCRICAO") || "Arrendamentos",
        value,
        user: decodedTag(record, "USUARIO"),
        complement: decodedTag(record, "COMPLEMENTO"),
        costCenter: decodedTag(record, "CODCCUSTO", "CODCCUSTODEBITO", "CCUSTO"),
      }];
    }).sort((left, right) => left.date.localeCompare(right.date) || left.branch.localeCompare(right.branch, "pt-BR", { numeric: true }));

    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return NextResponse.json({
      source: "TOTVS RM — CtbLanData / Lançamentos contábeis",
      company,
      competence,
      account: LEASE_ACCOUNT,
      reduced: LEASE_REDUCED_CODE,
      identification: "Conta a débito 2.1.7.01.01.53; REDUZIDODEBITO=2026; VALOR > 0; INTEGRAAPLICACAO=F (Financeiro)",
      rows,
      totals: { records: rows.length, accountingValue: total },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins/credits/leases] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
