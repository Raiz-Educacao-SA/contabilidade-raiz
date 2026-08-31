import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeXml = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() || "");
const number = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};
const signedMovement = (value: string) => {
  const parsed = number(value);
  return parsed < 0 ? -Math.abs(parsed) : Math.abs(parsed);
};

async function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  return (await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" })).ok;
}

async function queryAccount(company: string, firstDay: string, lastDay: string, account: string) {
  const base = (process.env.TOTVS_WS_PRD_BASE_URL || "https://raizeducacao160286.rm.cloudtotvs.com.br:8051").replace(/\/$/, "");
  const user = process.env.TOTVS_WS_PRD_USER;
  const password = process.env.TOTVS_WS_PRD_PASSWORD;
  if (!user || !password) throw new Error("Credenciais técnicas do TOTVS não configuradas.");
  const parameters = `PLN_B7_S=${account};PLN_B5_D=${firstDay};PLN_B6_D=${lastDay};PLN_B3_S=${company};PLN_B4_S=${company}`;
  const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>METTA0909</codSentenca><codColigada>0</codColigada><codSistema>C</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
      "content-type": "text/xml; charset=utf-8",
      soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL",
    },
    body: envelope,
    cache: "no-store",
    signal: AbortSignal.timeout(290_000),
  });
  const soap = await response.text();
  if (!response.ok || soap.includes(":Fault>")) throw new Error(tag(soap, "faultstring") || "Falha ao consultar o Razão Completo no TOTVS.");
  const result = decodeXml(tag(soap, "RealizarConsultaSQLResult"));
  return Array.from(result.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) => match[1]);
}

export async function GET(request: NextRequest) {
  try {
    if (!await authorized(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const company = request.nextUrl.searchParams.get("company")?.trim() || "";
    const competence = request.nextUrl.searchParams.get("competence")?.trim() || "";
    const accounts = Array.from(new Set((request.nextUrl.searchParams.get("accounts") || "").split(",").map((value) => value.trim()).filter(Boolean)));
    if (!/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence)) return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });
    if (!accounts.length || accounts.length > 12 || accounts.some((account) => !/^\d+(?:\.\d+)*$/.test(account))) return NextResponse.json({ error: "Informe até 12 contas contábeis válidas." }, { status: 400 });

    const [year, month] = competence.split("-").map(Number);
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const records = (await Promise.all(accounts.map((account) => queryAccount(company, firstDay, lastDay, account)))).flat();
    const accountSet = new Set(accounts);
    const seen = new Set<string>();
    const rows = records.flatMap((record, index) => {
      const account = tag(record, "CODCONTA");
      if (!accountSet.has(account)) return [];
      const branch = tag(record, "CODFILIAL");
      const entryId = tag(record, "IDLANCAMENTO");
      const partId = tag(record, "IDPARTIDA");
      const date = tag(record, "DATA");
      const value = signedMovement(tag(record, "VALOR"));
      const key = [company, branch, entryId, partId || index, account, date, value].join("|");
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        id: `${entryId || "sem-lancamento"}-${partId || index}-${account}`,
        company,
        branch,
        entryId,
        partId,
        date,
        account,
        reduced: tag(record, "REDUZIDO"),
        accountName: tag(record, "DESCRICAO"),
        value,
        movementNature: value < 0 ? "Crédito" : "Débito",
        complement: tag(record, "COMPLEMENTO"),
        document: tag(record, "DOCUMENTO"),
        sourceSystem: tag(record, "NOMESISTEMA"),
        user: tag(record, "USUARIO"),
        costCenter: tag(record, "CCUSTO"),
      }];
    }).sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account) || a.entryId.localeCompare(b.entryId) || a.partId.localeCompare(b.partId));

    return NextResponse.json({ source: "TOTVS RM — METTA0909 / Razão Completo", company, competence, accounts, rows }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/intercompany/entries] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
