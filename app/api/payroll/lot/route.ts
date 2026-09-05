import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const LABORE_APPLICATION = "P";
const PROVISION_ACCOUNTS = new Set(["2.1.2.01.04.01", "2.1.2.01.04.02", "2.1.2.01.04.08", "2.1.2.01.04.03", "2.1.2.01.04.04", "2.1.2.01.04.09"]);
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeXml = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, ...names: string[]) => names.map((name) => decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() || "")).find(Boolean) || "";
const number = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return Math.abs(direct);
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
};

async function authorizedCompanies(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return null;
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" });
  if (!userResponse.ok) return null;
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return null;
  const accessResponse = await fetch(`${url}/rest/v1/usuarios_empresas?select=empresas(codcoligada)&usuario_id=eq.${encodeURIComponent(user.id)}`, { headers: { authorization, apikey: key }, cache: "no-store" });
  if (!accessResponse.ok) throw new Error("Não foi possível validar as empresas liberadas para este usuário.");
  const links = await accessResponse.json() as Array<{ empresas?: { codcoligada?: string | number } | null }>;
  return new Set(links.flatMap((link) => link.empresas?.codcoligada == null ? [] : [String(link.empresas.codcoligada)]));
}

function competenceDates(competence: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) return null;
  const [year, month] = competence.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { firstDay: `${competence}-01`, lastDay: `${competence}-${String(lastDay).padStart(2, "0")}`, suffix: `${String(month).padStart(2, "0")}${year}` };
}

async function queryPendingLaboreLot(company: string, firstDay: string, lastDay: string) {
  const base = (process.env.TOTVS_WS_PRD_BASE_URL || "https://raizeducacao160286.rm.cloudtotvs.com.br:8051").replace(/\/$/, "");
  const user = process.env.TOTVS_WS_PRD_USER;
  const password = process.env.TOTVS_WS_PRD_PASSWORD;
  if (!user || !password) throw new Error("Credenciais técnicas do TOTVS não configuradas.");
  const parameters = `PLN_B7_S=${LABORE_APPLICATION};PLN_B3_I=${company};PLN_B4_I=${company};PLN_B5_D=${firstDay};PLN_B6_D=${lastDay}`;
  const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>RAZAOSEMLOTE0</codSentenca><codColigada>0</codColigada><codSistema>C</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "content-type": "text/xml; charset=utf-8", soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL" }, body: envelope, cache: "no-store", signal: AbortSignal.timeout(290_000) });
  const soap = await response.text();
  if (!response.ok || soap.includes(":Fault>")) throw new Error(tag(soap, "faultstring") || "O TOTVS não conseguiu localizar o lote pendente da Folha.");
  const result = decodeXml(tag(soap, "RealizarConsultaSQLResult"));
  return Array.from(result.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) => match[1]);
}

async function queryProvisionBalances(company: string, firstDay: string, lastDay: string) {
  const base = (process.env.TOTVS_WS_PRD_BASE_URL || "https://raizeducacao160286.rm.cloudtotvs.com.br:8051").replace(/\/$/, "");
  const user = process.env.TOTVS_WS_PRD_USER;
  const password = process.env.TOTVS_WS_PRD_PASSWORD;
  if (!user || !password) throw new Error("Credenciais técnicas do TOTVS não configuradas.");
  const parameters = `COLIGDADA_I=${company};DATA_INICIAL_D=${firstDay};DATA_FINAL_D=${lastDay};CONTA_S=2.1.2.01.04%;CONSIDERAFECHAMENTO_S=N`;
  const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>CUBO.CTB.002</codSentenca><codColigada>0</codColigada><codSistema>C</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "content-type": "text/xml; charset=utf-8", soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL" }, body: envelope, cache: "no-store", signal: AbortSignal.timeout(290_000) });
  const soap = await response.text();
  if (!response.ok || soap.includes(":Fault>")) throw new Error(tag(soap, "faultstring") || "O TOTVS não conseguiu consultar o balancete das provisões.");
  const result = decodeXml(tag(soap, "RealizarConsultaSQLResult"));
  return Array.from(result.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) => {
    const record = match[1];
    const account = tag(record, "Conta_x0020_Contábil", "Conta_x0020_Contabil", "Conta", "CODCONTA").trim();
    return { account, description: tag(record, "Descrição_x0020_Conta", "Descricao_x0020_Conta", "Descrição", "Descricao"), balance: number(tag(record, "VR_SALDOANT")) };
  }).filter((row) => PROVISION_ACCOUNTS.has(row.account));
}

export async function GET(request: NextRequest) {
  try {
    const company = request.nextUrl.searchParams.get("company")?.trim() || "";
    const competence = request.nextUrl.searchParams.get("competence")?.trim() || "";
    const dates = competenceDates(competence);
    if (!/^\d+$/.test(company) || !dates) return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });
    const allowed = await authorizedCompanies(request);
    if (!allowed) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    if (!allowed.has(company)) return NextResponse.json({ error: "Esta coligada não está liberada para o usuário." }, { status: 403 });

    const [lotRecords, balanceResult] = await Promise.all([
      queryPendingLaboreLot(company, dates.firstDay, dates.lastDay),
      queryProvisionBalances(company, dates.firstDay, dates.lastDay).then((rows) => ({ rows, warning: "" })).catch((error: Error) => ({ rows: [], warning: error.message })),
    ]);
    const records = lotRecords.filter((record) => Number(tag(record, "CODCOLIGADA")) === Number(company) && tag(record, "INTEGRAAPLICACAO") === LABORE_APPLICATION && tag(record, "DATA").startsWith(competence));
    const byLot = new Map<string, typeof records>();
    records.forEach((record) => {
      const lot = tag(record, "CODLOTE");
      if (lot) byLot.set(lot, [...(byLot.get(lot) ?? []), record]);
    });
    const candidates = [...byLot.entries()].map(([lotCode, lotRecords]) => ({
      lotCode,
      rows: lotRecords.map((record) => {
        const description = tag(record, "DESCRICAO");
        const complement = tag(record, "COMPLEMENTO");
        return { account: tag(record, "CODCONTA"), description, event: `${description} ${complement}`.match(/\b(?:EV|EN)\d{4}\b/i)?.[0]?.toUpperCase() || "", complement, debit: number(tag(record, "DEBITO")), credit: number(tag(record, "CREDITO")) };
      }).filter((row) => /^\d+(?:\.\d+)+$/.test(row.account) && (row.debit || row.credit)),
    })).filter((candidate) => candidate.rows.length);
    if (!candidates.length) return NextResponse.json({ error: `Nenhum lote pendente do Labore (aplicação P) foi encontrado para a coligada ${company} em ${competence}. Se o lote já foi integrado, ele não aparece nesta consulta.` }, { status: 404 });

    candidates.sort((left, right) => Number(right.lotCode.endsWith(dates.suffix)) - Number(left.lotCode.endsWith(dates.suffix)) || right.rows.length - left.rows.length || right.lotCode.localeCompare(left.lotCode));
    const selected = candidates[0];
    const debit = selected.rows.reduce((sum, row) => sum + row.debit, 0);
    const credit = selected.rows.reduce((sum, row) => sum + row.credit, 0);
    return NextResponse.json({ source: "TOTVS RM — RAZAOSEMLOTE0 — aplicação P (Labore) + CUBO.CTB.002", company, competence, application: LABORE_APPLICATION, lotCode: selected.lotCode, records: selected.rows.length, debit, credit, rows: selected.rows, alternatives: candidates.slice(1).map((candidate) => candidate.lotCode), provisionBalances: balanceResult.rows, provisionBalanceWarning: balanceResult.warning }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
