import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const classification: Record<string, "Cumulativo" | "Não-Cumulativo"> = {
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
const classifyService = (value: string): "Cumulativo" | "Não-Cumulativo" | "" => {
  const service = normalize(value);
  if (classification[service]) return classification[service];
  if (["PRE-VESTIBULAR", "PRE VESTIBULAR", "ESCOLINHA", "ATIVIDADE EXTRA", "HIGH SCHOOL", "ORIENTACAO PEDAGOGICA"].some((term) => service.includes(term))) return "Não-Cumulativo";
  if (service.includes("ANUIDADE") && service.includes("HORARIO INTEGRAL")) return "Não-Cumulativo";
  if (["BERCARIO", "CRECHE", "ENSINO INFANTIL", "ENSINO FUNDAMENTAL", "ENSINO REGULAR", "ENSINO MEDIO", "HORARIO INTEGRAL"].some((term) => service.includes(term))) return "Cumulativo";
  return "";
};
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeXml = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => decodeXml(xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() || "");
const number = (value: string) => { const direct = Number(value); if (Number.isFinite(direct)) return direct; const parsed = Number(value.replace(/\./g, "").replace(",", ".")); return Number.isFinite(parsed) ? parsed : 0; };

async function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  return (await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" })).ok;
}

async function query(parameters: string) {
  const base = (process.env.TOTVS_WS_PRD_BASE_URL || "https://raizeducacao160286.rm.cloudtotvs.com.br:8051").replace(/\/$/, "");
  const user = process.env.TOTVS_WS_PRD_USER;
  const password = process.env.TOTVS_WS_PRD_PASSWORD;
  if (!user || !password) throw new Error("Credenciais técnicas do TOTVS não configuradas.");
  const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>RAIZ.REC.FISCAL</codSentenca><codColigada>0</codColigada><codSistema>T</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "content-type": "text/xml; charset=utf-8", soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL" }, body: envelope, cache: "no-store" });
  const soap = await response.text();
  if (!response.ok || soap.includes(":Fault>")) throw new Error(tag(soap, "faultstring") || "Falha na consulta da Planilha.NET 53.");
  const result = decodeXml(tag(soap, "RealizarConsultaSQLResult"));
  return Array.from(result.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) => match[1]);
}

export async function GET(request: NextRequest) {
  try {
    if (!await authorized(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });
    const [year, month] = competence!.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const records = await query(`CODCOLIGADA=${company};DATAINI_D=${start};DATAFIM_D=${end}`);
    let ignoredCancelled = 0;
    const rows = records.flatMap((record, index) => {
      const status = tag(record, "STATUSNF") || tag(record, "STATUS");
      if (normalize(status).includes("CANCEL")) {
        ignoredCancelled += 1;
        return [];
      }
      const service = tag(record, "SERVICO_ED") || tag(record, "DESCRICAO") || tag(record, "NOMEFANTASIA1") || tag(record, "DESCRICAOSERVICO") || tag(record, "DESCSERVICO") || tag(record, "NOMESERVICO") || tag(record, "SERVICO") || "Serviço não informado pela consulta fiscal";
      const grossRevenue = number(tag(record, "VALORORIGINAL") || tag(record, "VALORLIQUIDO") || tag(record, "BC"));
      const discounts = number(tag(record, "BOLSA"));
      return [{ line: index + 1, service, grossRevenue, discounts, netRevenue: grossRevenue - discounts, regime: classifyService(service) }];
    });
    return NextResponse.json({ company, competence, rows, records: records.length, ignoredCancelled });
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
