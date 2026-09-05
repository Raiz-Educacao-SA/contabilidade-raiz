import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
const xmlDecode = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, ...names: string[]) => names.map((name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim()).find(Boolean) || "";
const number = (value: string) => { const parsed = Number(String(value || "0").replace(",", ".")); return Number.isFinite(parsed) ? parsed : 0; };
const isRevenueAccount = (account: string) => account.trim().startsWith("3");

async function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  return (await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" })).ok;
}

async function branchRevenue(baseUrl: string, user: string, password: string, company: string, firstDay: string, lastDay: string, accountPrefix = "3") {
  const parameters = `PLN_B7_S=${accountPrefix};PLN_B5_D=${firstDay};PLN_B6_D=${lastDay};PLN_B3_S=${company};PLN_B4_S=${company}`;
  const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>METTA0909</codSentenca><codColigada>0</codColigada><codSistema>C</codSistema><parameters>${xmlEscape(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${baseUrl}/wsConsultaSQL/IwsConsultaSQL`, {
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
  if (!response.ok || soap.includes(":Fault>")) throw new Error(xmlDecode(tag(soap, "faultstring")) || "O TOTVS não conseguiu segregar o faturamento por filial.");

  const resultXml = xmlDecode(tag(soap, "RealizarConsultaSQLResult"));
  const seen = new Set<string>();
  const totals: Record<string, number> = {};
  const accountTotals: Record<string, { branch: string; account: string; movement: number }> = {};

  Array.from(resultXml.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi)).forEach((match) => {
    const record = match[1];
    const account = tag(record, "CODCONTA").trim();
    if (accountPrefix === "3" ? !isRevenueAccount(account) : !account.startsWith(accountPrefix)) return;
    const branch = tag(record, "CODFILIAL").trim() || "0";
    const value = number(tag(record, "VALOR"));
    const key = [branch, tag(record, "IDLANCAMENTO"), account, value].join("|");
    if (seen.has(key)) return;
    seen.add(key);

    totals[branch] = (totals[branch] || 0) + value;
    const accountKey = `${branch}|${account}`;
    const current = accountTotals[accountKey] || { branch, account, movement: 0 };
    current.movement += value;
    accountTotals[accountKey] = current;
  });

  const branches = Object.entries(totals)
    .map(([branch, movement]) => ({ branch, movement: Math.abs(movement), revenue: Math.abs(movement) }))
    .sort((a, b) => Number(a.branch) - Number(b.branch));

  const branchAccounts = Object.values(accountTotals)
    .map((item) => ({ ...item, movement: Math.abs(item.movement) }))
    .sort((a, b) => Number(a.branch) - Number(b.branch) || a.account.localeCompare(b.account, "pt-BR", { numeric: true }));

  return { branches, branchAccounts };
}

export async function GET(request: NextRequest) {
  try {
    if (!await authorized(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) return NextResponse.json({ error: "Coligada e competência são obrigatórias." }, { status: 400 });

    const baseUrl = (process.env.TOTVS_WS_PRD_BASE_URL || "https://raizeducacao160286.rm.cloudtotvs.com.br:8051").replace(/\/$/, "");
    const user = process.env.TOTVS_WS_PRD_USER;
    const password = process.env.TOTVS_WS_PRD_PASSWORD;
    if (!user || !password) throw new Error("As credenciais técnicas do TOTVS ainda não foram configuradas na Vercel.");

    const [year, month] = competence!.split("-").map(Number);
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const parameters = `COLIGDADA_I=${company};DATA_INICIAL_D=${firstDay};DATA_FINAL_D=${lastDay};CONTA_S=%;CONSIDERAFECHAMENTO_S=N`;
    const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>CUBO.CTB.002</codSentenca><codColigada>0</codColigada><codSistema>C</codSistema><parameters>${xmlEscape(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
    const response = await fetch(`${baseUrl}/wsConsultaSQL/IwsConsultaSQL`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
        "content-type": "text/xml; charset=utf-8",
        soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL",
      },
      body: envelope,
      cache: "no-store",
    });
    const soap = await response.text();
    if (!response.ok || soap.includes("<s:Fault>") || soap.includes(":Fault>")) throw new Error(xmlDecode(tag(soap, "faultstring")) || "O TOTVS não conseguiu gerar o balancete.");

    const resultXml = xmlDecode(tag(soap, "RealizarConsultaSQLResult"));
    const rows = Array.from(resultXml.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match, index) => {
      const record = match[1];
      return {
        id: tag(record, "ID") || `${company}-${index}`,
        reduced: tag(record, "Reduzido"),
        account: xmlDecode(tag(record, "Conta_x0020_Contábil", "Conta_x0020_Contabil", "Conta")),
        description: xmlDecode(tag(record, "Descrição_x0020_Conta", "Descricao_x0020_Conta", "Descrição", "Descricao")),
        openingBalance: number(tag(record, "VR_SALDOANT")),
        debit: number(tag(record, "VR_DEBITO")),
        credit: number(tag(record, "VR_CREDITO")),
        movement: number(tag(record, "VR_MOV")),
        closingBalance: number(tag(record, "Saldo")),
      };
    }).filter((row) => row.account);

    let branches: Array<{ branch: string; movement: number; revenue: number }> = [];
    let branchAccounts: Array<{ branch: string; account: string; description: string; movement: number }> = [];
    if (request.nextUrl.searchParams.get("byBranch") === "1") {
      const accountPrefix = request.nextUrl.searchParams.get("scope") === "fixed-assets" ? "1.2.3" : "3";
      const detail = await branchRevenue(baseUrl, user, password, company, firstDay, lastDay, accountPrefix);
      branches = detail.branches;
      const descriptions = new Map(rows.map((row) => [row.account.trim(), row.description]));
      branchAccounts = detail.branchAccounts.map((item) => ({
        ...item,
        description: descriptions.get(item.account.trim()) || "",
      }));
    }

    return NextResponse.json({
      source: "TOTVS RM — CUBO.CTB.002 + METTA0909",
      company,
      competence,
      records: rows.length,
      rows,
      branches,
      branchAccounts,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
