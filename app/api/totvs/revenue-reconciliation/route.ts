import { NextRequest, NextResponse } from "next/server";
import {
  accountingRevenueQueryAccountsForCompany,
  classifyAccountingRevenue,
  deduplicateAccountingRecords,
  isCompany18MdRevenue,
  isRevenueAppropriation,
  isValidRevenueRa,
  normalizeRevenueRa,
} from "@/lib/revenue-reconciliation";

export const runtime = "nodejs";

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const decodeXml = (value: string) =>
  value
    .replace(/&#xD;|&#13;/gi, "\r")
    .replace(/&#xA;|&#10;/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const readTag = (xml: string, name: string) =>
  decodeXml(
    xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() ||
      "",
  );

const parseNumber = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const localized = Number(String(value || "0").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(localized) ? localized : 0;
};

async function authenticate(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !supabaseUrl || !supabaseKey) return false;
  return (
    await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { authorization, apikey: supabaseKey },
      cache: "no-store",
    })
  ).ok;
}

async function queryTotvs(code: string, system: string, parameters: string) {
  const base = (
    process.env.TOTVS_WS_PRD_BASE_URL ||
    "https://raizeducacao160286.rm.cloudtotvs.com.br:8051"
  ).replace(/\/$/, "");
  const user = process.env.TOTVS_WS_PRD_USER;
  const password = process.env.TOTVS_WS_PRD_PASSWORD;
  if (!user || !password) {
    throw new Error("Credenciais técnicas do TOTVS não configuradas.");
  }

  const body = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>${code}</codSentenca><codColigada>0</codColigada><codSistema>${system}</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
      "content-type": "text/xml; charset=utf-8",
      soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL",
    },
    body,
    cache: "no-store",
  });
  const soap = await response.text();
  if (!response.ok || soap.includes(":Fault>")) {
    throw new Error(readTag(soap, "faultstring") || "Falha na consulta TOTVS.");
  }
  const xml = decodeXml(readTag(soap, "RealizarConsultaSQLResult"));
  return Array.from(xml.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) =>
    match[1],
  );
}

function extractStudent(complement: string) {
  const parts = complement.replace(/^\s*ESTORNO\s*:\s*/i, "").split(/\s+-\s+/);
  const ra = normalizeRevenueRa((parts[0] || "").trim());
  return {
    ra: isValidRevenueRa(ra) ? ra : "",
    name: (parts[1] || "").trim(),
  };
}

export async function GET(request: NextRequest) {
  try {
    if (!(await authenticate(request))) {
      return NextResponse.json(
        { error: "Sessão inválida ou expirada." },
        { status: 401 },
      );
    }

    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    const source = request.nextUrl.searchParams.get("source");
    if (
      !company ||
      !/^\d+$/.test(company) ||
      !/^\d{4}-\d{2}$/.test(competence || "") ||
      !["fiscal", "accounting"].includes(source || "")
    ) {
      return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
    }

    const [year, month] = competence!.split("-").map(Number);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(
      new Date(Date.UTC(year, month, 0)).getUTCDate(),
    ).padStart(2, "0")}`;

    if (source === "fiscal") {
      const records = await queryTotvs(
        "RAIZ.REC.FISCAL",
        "T",
        `CODCOLIGADA=${company};DATAINI_D=${startDate};DATAFIM_D=${endDate}`,
      );
      const rows = records
        .map((record, index) => ({
          id: `F-${index}`,
          ra: normalizeRevenueRa(readTag(record, "RA")),
          name: readTag(record, "ALUNO").trim(),
          status: readTag(record, "STATUS"),
          originalValue: parseNumber(readTag(record, "VALORORIGINAL")),
          discount: parseNumber(readTag(record, "BOLSA")),
        }))
        .filter((row) => row.ra);
      return NextResponse.json({ source, rows, records: rows.length });
    }

    const recordGroups = await Promise.all(
      accountingRevenueQueryAccountsForCompany(company).map((account) =>
        queryTotvs(
          "PLAN.C.0002.0001",
          "C",
          `CODCOLINI=${company};CODCOLFIM=${company};DATAINI_D=${startDate};DATAFIM_D=${endDate};CONTA=${account}`,
        ),
      ),
    );
    const records = deduplicateAccountingRecords(recordGroups.flat());
    const rows = records.flatMap((record, index) => {
      const complement = readTag(record, "COMPLEMENTO");
      if (isRevenueAppropriation(complement)) return [];

      const student = extractStudent(complement);
      const account = readTag(record, "CODCONTA");
      const description = readTag(record, "DESCRICAO");
      const generationType = readTag(record, "TIPOGERACAO").trim();
      const isMdRevenue = isCompany18MdRevenue(company, account, complement);
      const kind = isMdRevenue
        ? "revenue"
        : classifyAccountingRevenue(account, description);
      if (!student.ra || kind === "other") return [];

      return [
        {
          id: `C-${index}`,
          entryId: readTag(record, "IDLANCAMENTO"),
          branch: readTag(record, "CODFILIAL"),
          date: readTag(record, "DATA"),
          ra: student.ra,
          name: student.name,
          description,
          complement,
          generationType,
          account,
          value: parseNumber(readTag(record, "VALOR")),
          kind,
          isMdRevenue,
        },
      ];
    });
    return NextResponse.json({ source, rows, records: rows.length });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 503 },
    );
  }
}
