import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const QUERY = {
  code: "METTA.100",
  company: 0,
  application: "C",
  title: "NOTAS MUNICIPAIS CANCELADAS",
  spreadsheetId: 37,
  queryGuid: "928ed1ec-7cef-443d-93df-ad8cdee48b76",
  spreadsheetGuid: "ead42866-0978-4ea8-a485-3d57304be049",
} as const;

type TaxRegime = "Cumulativo" | "Não-Cumulativo" | "";

const classification: Record<string, Exclude<TaxRegime, "">> = {
  "BERCARIO": "Cumulativo",
  "CRECHE": "Cumulativo",
  "ENSINO INFANTIL": "Cumulativo",
  "ENSINO FUNDAMENTAL": "Cumulativo",
  "ENSINO REGULAR": "Cumulativo",
  "ENSINO MEDIO": "Cumulativo",
  "PRE-VESTIBULAR - CURSOS": "Não-Cumulativo",
  "1A COTA ENSINO INFANTIL": "Cumulativo",
  "1A COTA ENSINO FUNDAMENTAL": "Cumulativo",
  "1A COTA ENSINO MEDIO": "Cumulativo",
  "HORARIO INTEGRAL": "Cumulativo",
  "ESCOLINHAS / ATIVIDADES EXTRAS": "Não-Cumulativo",
  "HIGH SCHOOL - CURSOS": "Não-Cumulativo",
  "ORIENTACAO PEDAGOGICA": "Não-Cumulativo",
  "ANUIDADE - ENSINO FUNDAMENTAL": "Cumulativo",
  "ANUIDADE - ENSINO MEDIO": "Cumulativo",
  "ANUIDADE - ENSINO INFANTIL": "Cumulativo",
  "ANUIDADE - ORIENTACAO PEDAGOGICA": "Não-Cumulativo",
  "ANUIDADE - HORARIO INTEGRAL": "Não-Cumulativo",
  "SEMESTRALIDADE - ENSINO FUNDAMENTAL": "Cumulativo",
  "SEMESTRALIDADE - ENSINO MEDIO": "Cumulativo",
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/ª/g, "A").toUpperCase();
const classifyService = (value: string): TaxRegime => {
  const service = normalize(value);
  if (classification[service]) return classification[service];
  if (["PRE-VESTIBULAR", "PRE VESTIBULAR", "ESCOLINHA", "ATIVIDADE EXTRA", "HIGH SCHOOL", "ORIENTACAO PEDAGOGICA"].some((term) => service.includes(term))) return "Não-Cumulativo";
  if (service.includes("ANUIDADE") && service.includes("HORARIO INTEGRAL")) return "Não-Cumulativo";
  if (["BERCARIO", "CRECHE", "ENSINO INFANTIL", "ENSINO FUNDAMENTAL", "ENSINO REGULAR", "ENSINO MEDIO", "HORARIO INTEGRAL", "MENSALIDADE", "SEMESTRALIDADE"].some((term) => service.includes(term))) return "Cumulativo";
  if (/^(EI|EFI|EF1|EF2|EM)(\s|\-|$)/.test(service)) return "Cumulativo";
  return "";
};

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeXml = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() || "");
const number = (value: string) => {
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

async function query(company: string, firstDay: string, lastDay: string) {
  const base = (process.env.TOTVS_WS_PRD_BASE_URL || "https://raizeducacao160286.rm.cloudtotvs.com.br:8051").replace(/\/$/, "");
  const user = process.env.TOTVS_WS_PRD_USER;
  const password = process.env.TOTVS_WS_PRD_PASSWORD;
  if (!user || !password) throw new Error("Credenciais técnicas do TOTVS não configuradas.");
  const parameters = `DATAINICIAL_D=${firstDay};DATAFINAL_D=${lastDay};CODCOLIGADA=${company}`;
  const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>${QUERY.code}</codSentenca><codColigada>${QUERY.company}</codColigada><codSistema>${QUERY.application}</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "content-type": "text/xml; charset=utf-8", soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL" },
    body: envelope,
    cache: "no-store",
    signal: AbortSignal.timeout(290_000),
  });
  const soap = await response.text();
  if (!response.ok || soap.includes(":Fault>")) throw new Error(tag(soap, "faultstring") || "Falha ao consultar as notas municipais canceladas no TOTVS.");
  const result = decodeXml(tag(soap, "RealizarConsultaSQLResult"));
  return Array.from(result.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) => match[1]);
}

export async function GET(request: NextRequest) {
  try {
    if (!await authorized(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    const requestedBranches = new Set((request.nextUrl.searchParams.get("branches") || "").split(",").map((value) => value.trim()).filter(Boolean));
    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });

    const [year, month] = competence!.split("-").map(Number);
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const records = (await query(company, firstDay, lastDay))
      .filter((record) => !requestedBranches.size || requestedBranches.has(tag(record, "CODFILIAL").trim()));
    const seen = new Set<string>();
    const rows = records.flatMap((record) => {
      const key = `${tag(record, "IDMOV")}|${tag(record, "IDLAN")}|${tag(record, "NUMERONFSE")}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const history = tag(record, "HISTORICOLONGO");
      const service = history.split(/\r?\n/).map((part) => part.trim()).find(Boolean) || "Serviço não informado";
      return [{
        studentCode: tag(record, "RA"),
        student: tag(record, "ALUNO"),
        customer: tag(record, "CLIENTE"),
        invoice: tag(record, "NUMERONFSE"),
        rps: tag(record, "RPS"),
        sourceCompetence: tag(record, "DATA_COMPETENCIA"),
        entryId: tag(record, "IDLAN"),
        company: tag(record, "CODCOLIGADA"),
        branch: tag(record, "CODFILIAL"),
        movementId: tag(record, "IDMOV"),
        movementType: tag(record, "CODTMV"),
        issueDate: tag(record, "DATAEMISSAO"),
        cancellationDate: tag(record, "DATA_CANCELAMENTO"),
        grossValue: number(tag(record, "VALOR_NF")),
        discountValue: number(tag(record, "VALOR_BOLSA")),
        netValue: number(tag(record, "VALOR_LIQUIDONF")),
        service,
        regime: classifyService(service),
        history,
        treatment: "Excluída da apuração",
      }];
    }).sort((a, b) => a.cancellationDate.localeCompare(b.cancellationDate) || a.invoice.localeCompare(b.invoice));
    const totals = rows.reduce((result, row) => ({
      grossValue: result.grossValue + row.grossValue,
      discountValue: result.discountValue + row.discountValue,
      netValue: result.netValue + row.netValue,
      cumulativeValue: result.cumulativeValue + (row.regime === "Cumulativo" ? row.netValue : 0),
      nonCumulativeValue: result.nonCumulativeValue + (row.regime === "Não-Cumulativo" ? row.netValue : 0),
      unclassifiedValue: result.unclassifiedValue + (!row.regime ? row.netValue : 0),
    }), { grossValue: 0, discountValue: 0, netValue: 0, cumulativeValue: 0, nonCumulativeValue: 0, unclassifiedValue: 0 });
    return NextResponse.json({ source: QUERY, company, competence, records: rows.length, totals, rows }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins/cancelled-invoices] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
