import { NextRequest, NextResponse } from "next/server";
import { decodedTag, isAuthorized, queryDataEngine } from "@/lib/totvs-dataengine";

export const runtime = "nodejs";
export const maxDuration = 300;

const LEASE_REDUCED_CODE = 2026;

const numeric = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

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

    const records = await queryDataEngine({
      code: "METTA0909",
      system: "C",
      parameters: `PLN_B7_S=4.2.1;PLN_B5_D=${firstDay};PLN_B6_D=${lastDay};PLN_B3_S=${company};PLN_B4_S=${company}`,
      errorMessage: "Falha ao consultar os créditos de Arrendamentos no TOTVS/DataEngine.",
    });

    const seen = new Set<string>();
    const rows = records.flatMap((record) => {
      const reduced = numeric(decodedTag(record, "REDUZIDO"));
      const value = numeric(decodedTag(record, "VALOR"));
      const sourceSystem = decodedTag(record, "NOMESISTEMA");
      const source = normalize(sourceSystem);
      const branch = decodedTag(record, "CODFILIAL");
      const isFinancial = source.includes("FINANCEIRO") || source.includes("FLUXUS");
      if (reduced !== LEASE_REDUCED_CODE || value <= 0 || !isFinancial || (branches.size && !branches.has(branch))) return [];

      const key = [
        decodedTag(record, "CODCOLIGADA"),
        branch,
        decodedTag(record, "IDLANCAMENTO"),
        decodedTag(record, "DOCUMENTO"),
        value,
      ].join("|");
      if (seen.has(key)) return [];
      seen.add(key);

      return [{
        company: decodedTag(record, "CODCOLIGADA"),
        branch,
        entryId: decodedTag(record, "IDLANCAMENTO"),
        document: decodedTag(record, "DOCUMENTO"),
        integrationKey: decodedTag(record, "INTEGRACHAVE", "IDMOV"),
        sourceSystem,
        date: decodedTag(record, "DATA"),
        reduced,
        account: decodedTag(record, "CODCONTA"),
        description: decodedTag(record, "DESCRICAO") || "Arrendamentos",
        value,
        user: decodedTag(record, "USUARIO"),
        complement: decodedTag(record, "COMPLEMENTO"),
        costCenter: decodedTag(record, "CCUSTO"),
      }];
    }).sort((left, right) => left.date.localeCompare(right.date) || left.branch.localeCompare(right.branch, "pt-BR", { numeric: true }));

    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return NextResponse.json({
      source: "TOTVS RM — METTA0909 / Razão Completo",
      company,
      competence,
      reduced: LEASE_REDUCED_CODE,
      identification: "REDUZIDO=2026; VALOR > 0; NOMESISTEMA Financeiro/RM Fluxus",
      rows,
      totals: { records: rows.length, accountingValue: total },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins/credits/leases] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
