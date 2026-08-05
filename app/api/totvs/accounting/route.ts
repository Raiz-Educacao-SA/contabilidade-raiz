import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type TotvsResult = {
  CODCOLPROP?: string;
  CODCXA?: string;
  DESCRICAO?: string;
  CODCONTA?: string;
  DATACOMPENSACAO?: string;
  DEBITO2?: string;
  CREDITO2?: string;
};

const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const xmlDecode = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim();
const number = (value?: string) => {
  const parsed = Number(String(value || "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

async function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" });
  return response.ok;
}

export async function GET(request: NextRequest) {
  try {
    if (!await authorized(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });

    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) {
      return NextResponse.json({ error: "Coligada e competência são obrigatórias." }, { status: 400 });
    }

    const baseUrl = (process.env.TOTVS_WS_PRD_BASE_URL || "https://raizeducacao160286.rm.cloudtotvs.com.br:8051").replace(/\/$/, "");
    const user = process.env.TOTVS_WS_PRD_USER;
    const password = process.env.TOTVS_WS_PRD_PASSWORD;
    if (!user || !password) throw new Error("As credenciais técnicas do TOTVS ainda não foram configuradas na Vercel.");

    const [year, month] = competence!.split("-").map(Number);
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const parameters = `PLN_B1_D=${firstDay};PLN_B2_D=${lastDay};PLN_B3_S=${company}`;
    const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>METTA1701</codSentenca><codColigada>0</codColigada><codSistema>C</codSistema><parameters>${xmlEscape(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
    const response = await fetch(`${baseUrl}/wsConsultaSQL/IwsConsultaSQL`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "content-type": "text/xml; charset=utf-8", soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL" },
      body: envelope,
      cache: "no-store",
    });
    const soap = await response.text();
    if (!response.ok || soap.includes("<s:Fault>") || soap.includes(":Fault>")) {
      const fault = xmlDecode(tag(soap, "faultstring") || "O TOTVS não conseguiu executar a consulta contábil.");
      throw new Error(fault);
    }

    const resultXml = xmlDecode(tag(soap, "RealizarConsultaSQLResult") || "");
    const records = Array.from(resultXml.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) => {
      const record = match[1];
      return ["CODCOLPROP", "CODCXA", "DESCRICAO", "CODCONTA", "DATACOMPENSACAO", "DEBITO2", "CREDITO2"].reduce<TotvsResult>((output, field) => ({ ...output, [field]: xmlDecode(tag(record, field) || "") }), {});
    });
    const rows = records.flatMap((record, index) => {
      const common = { date: record.DATACOMPENSACAO || "", account: record.CODCONTA || "", accountName: record.DESCRICAO || record.CODCONTA || "Conta bancária" };
      const debit = number(record.DEBITO2); const credit = number(record.CREDITO2);
      return [
        ...(Math.abs(debit) > 0.004 ? [{ ...common, id: `TOTVS-D-${index}`, value: debit, nature: `Débito contábil — caixa ${record.CODCXA || ""}` }] : []),
        ...(Math.abs(credit) > 0.004 ? [{ ...common, id: `TOTVS-C-${index}`, value: -Math.abs(credit), nature: `Crédito contábil — caixa ${record.CODCXA || ""}` }] : []),
      ];
    });

    return NextResponse.json({ source: "TOTVS RM — METTA1701 / Planilha 18", company, competence, records: records.length, rows }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
