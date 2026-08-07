import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type TaxRegime = "Cumulativo" | "Não-Cumulativo" | "";

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .replace(/ª/g, "A")
  .toUpperCase();

const classifyService = (value: string): TaxRegime => {
  const service = normalize(value);
  if (["PRE-VESTIBULAR", "PRE VESTIBULAR", "ESCOLINHA", "ATIVIDADE EXTRA", "HIGH SCHOOL", "ORIENTACAO PEDAGOGICA"].some((term) => service.includes(term))) return "Não-Cumulativo";
  if (service.includes("ANUIDADE") && service.includes("HORARIO INTEGRAL")) return "Não-Cumulativo";
  if (["BERCARIO", "CRECHE", "PRE-ESCOLAR", "PRE ESCOLAR", "ENSINO INFANTIL", "ENSINO FUNDAMENTAL", "ENSINO REGULAR", "ENSINO MEDIO", "EDUCACAO BASICA", "MENSALIDADE", "SEMESTRALIDADE", "1A COTA"].some((term) => service.includes(term))) return "Cumulativo";
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
  const parameters = `PLN_B7_S=3.1.1.01;PLN_B5_D=${firstDay};PLN_B6_D=${lastDay};PLN_B3_S=${company};PLN_B4_S=${company}`;
  const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>METTA0909</codSentenca><codColigada>0</codColigada><codSistema>C</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "content-type": "text/xml; charset=utf-8", soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL" },
    body: envelope,
    cache: "no-store",
    signal: AbortSignal.timeout(290_000),
  });
  const soap = await response.text();
  if (!response.ok || soap.includes(":Fault>")) throw new Error(tag(soap, "faultstring") || "Falha ao consultar os rateios de anuidades no TOTVS.");
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
    const rows = records.flatMap((record, index) => {
      const sourceSystem = tag(record, "NOMESISTEMA");
      const document = tag(record, "DOCUMENTO");
      const complement = tag(record, "COMPLEMENTO");
      const account = tag(record, "CODCONTA");
      const value = number(tag(record, "VALOR"));
      const signature = normalize(`${document} ${complement}`);
      const isAllocation = normalize(sourceSystem).includes("RM SALDUS")
        && signature.includes("RATEIO")
        && (signature.includes("ANUIDADE") || signature.includes("COTA"))
        && account.startsWith("3.1.1.")
        && value < 0;
      if (!isAllocation) return [];
      const key = [tag(record, "CODCOLIGADA"), tag(record, "CODFILIAL"), tag(record, "IDLANCAMENTO"), account, value].join("|");
      if (seen.has(key)) return [];
      seen.add(key);
      const service = tag(record, "DESCRICAO") || complement || "Rateio de anuidades";
      const netRevenue = Math.abs(value);
      return [{
        line: index + 1,
        company: tag(record, "CODCOLIGADA"),
        branch: tag(record, "CODFILIAL"),
        entryId: tag(record, "IDLANCAMENTO"),
        document,
        sourceSystem,
        date: tag(record, "DATA"),
        reduced: number(tag(record, "REDUZIDO")),
        account,
        service,
        complement,
        costCenter: tag(record, "CCUSTO"),
        grossRevenue: netRevenue,
        discounts: 0,
        netRevenue,
        regime: classifyService(`${service} ${complement}`),
      }];
    }).sort((left, right) => left.branch.localeCompare(right.branch) || left.entryId.localeCompare(right.entryId));

    return NextResponse.json({
      source: "TOTVS RM Contábil — METTA0909 / RM Saldus",
      identification: "NOMESISTEMA=RM Saldus; DOCUMENTO=RAT-*; COMPLEMENTO contém RATEIO e ANUIDADE/COTA",
      company,
      competence,
      recordsChecked: records.length,
      rows,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins/annual-fee-allocations] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
