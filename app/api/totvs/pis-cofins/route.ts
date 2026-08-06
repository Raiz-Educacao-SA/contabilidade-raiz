import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  if (["BERCARIO", "CRECHE", "ENSINO INFANTIL", "ENSINO FUNDAMENTAL", "ENSINO REGULAR", "ENSINO MEDIO", "HORARIO INTEGRAL", "MENSALIDADE", "SEMESTRALIDADE"].some((term) => service.includes(term))) return "Cumulativo";
  if (/^(EI|EFI|EF1|EF2|EM)(\s|\-|$)/.test(service)) return "Cumulativo";
  return "";
};
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeXml = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => decodeXml(xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() || "");
const number = (value: string) => { const direct = Number(value); if (Number.isFinite(direct)) return direct; const parsed = Number(value.replace(/\./g, "").replace(",", ".")); return Number.isFinite(parsed) ? parsed : 0; };
const recordCompetence = (value: string) => {
  const normalized = value.trim();
  const iso = normalized.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const brazilian = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brazilian) return `${brazilian[3]}-${brazilian[2]}`;
  return "";
};

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
  // Planilha.NET 53 — sentença oficial "ANALISE NF COM CONTA".
  const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>METTA.108090</codSentenca><codColigada>10</codColigada><codSistema>T</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "content-type": "text/xml; charset=utf-8", soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL" }, body: envelope, cache: "no-store", signal: AbortSignal.timeout(290_000) });
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
    const [year] = competence!.split("-").map(Number);
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const sourceCompanyRecords = (await query(`CODCOLIGADA=${company};COMP_INI_D=${start};COMP_FIM_D=${end}`))
      .filter((record) => Number(tag(record, "CODCOLIGADA")) === Number(company));
    const records = sourceCompanyRecords.filter((record) =>
      recordCompetence(tag(record, "DTCOMPETENCIA") || tag(record, "COMPETENCIA") || tag(record, "DATAEMISSAO")) === competence,
    );
    let ignoredCancelled = 0;
    const rows = records.flatMap((record, index) => {
      const fiscalStatus = normalize(tag(record, "STATUSNF") || tag(record, "STATUS"));
      if (fiscalStatus.includes("CANCELAD")) {
        ignoredCancelled += 1;
        return [];
      }
      const service = tag(record, "DESCRICAO") || tag(record, "SERVICO_ED") || "Descrição não informada pela consulta fiscal";
      const grossRevenue = number(tag(record, "VALORORIGINAL") || tag(record, "VALORLIQUIDO") || tag(record, "BC"));
      const discounts = number(tag(record, "BOLSA"));
      const netRevenue = number(tag(record, "VALORNF") || tag(record, "VLRNF"));
      return [{ line: index + 1, service, grossRevenue, discounts, netRevenue, regime: classifyService(service) }];
    });
    const totals = rows.reduce((result, row) => ({
      grossRevenue: result.grossRevenue + row.grossRevenue,
      discounts: result.discounts + row.discounts,
      netRevenue: result.netRevenue + row.netRevenue,
    }), { grossRevenue: 0, discounts: 0, netRevenue: 0 });
    const reconciliationDifference = totals.grossRevenue - totals.discounts - totals.netRevenue;
    if (Math.abs(reconciliationDifference) > 0.01) {
      throw new Error(`A base da NET.53 não reconciliou para a coligada ${company} em ${competence}. Diferença: ${reconciliationDifference.toFixed(2)}.`);
    }
    return NextResponse.json({
      company,
      competence,
      sourceRecordsChecked: sourceCompanyRecords.length,
      records: records.length,
      ignoredCancelled,
      totals,
      reconciliationDifference,
      rows,
    });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins] consultation failed", {
      message: (cause as Error).message,
    });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
