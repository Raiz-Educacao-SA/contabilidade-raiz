import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const ENERGY_ACCOUNT = "4.2.1.02.04.01";
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeXml = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() || "");
const numeric = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};
const normalized = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  return (await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" })).ok;
}

async function queryTotvs(company: string, firstDay: string, lastDay: string) {
  const base = (process.env.TOTVS_WS_PRD_BASE_URL || "https://raizeducacao160286.rm.cloudtotvs.com.br:8051").replace(/\/$/, "");
  const user = process.env.TOTVS_WS_PRD_USER;
  const password = process.env.TOTVS_WS_PRD_PASSWORD;
  if (!user || !password) throw new Error("Credenciais técnicas do TOTVS não configuradas.");
  const parameters = `PLN_B7_S=${ENERGY_ACCOUNT};PLN_B5_D=${firstDay};PLN_B6_D=${lastDay};PLN_B3_S=${company};PLN_B4_S=${company}`;
  const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>METTA0909</codSentenca><codColigada>0</codColigada><codSistema>C</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "content-type": "text/xml; charset=utf-8", soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL" }, body: envelope, cache: "no-store", signal: AbortSignal.timeout(290_000) });
  const soap = await response.text();
  if (!response.ok || soap.includes(":Fault>")) throw new Error(tag(soap, "faultstring") || "Falha ao consultar a conta de Energia no TOTVS.");
  const result = decodeXml(tag(soap, "RealizarConsultaSQLResult"));
  return Array.from(result.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) => match[1]);
}

type ZeevInstance = Record<string, unknown>;

async function queryZeev(firstDay: string, lastDay: string) {
  const baseUrl = process.env.ZEEV_BASE_URL?.replace(/\/$/, "");
  const token = process.env.ZEEV_API_TOKEN;
  if (!baseUrl || !token) return { configured: false, instances: [] as ZeevInstance[], error: "Autenticação do Zeev necessária." };
  const formFieldNames = (process.env.ZEEV_ENERGY_FORM_FIELDS || "").split(",").map((item) => item.trim()).filter(Boolean);
  const body = {
    startDateIntervalBegin: `${firstDay}T00:00:00-03:00`,
    startDateIntervalEnd: `${lastDay}T23:59:59-03:00`,
    showPendingInstanceTasks: true,
    showFinishedInstanceTasks: true,
    ...(formFieldNames.length ? { formFieldNames } : {}),
  };
  const response = await fetch(`${baseUrl}/api/2/instances/report`, { method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(90_000) });
  if (!response.ok) return { configured: true, instances: [] as ZeevInstance[], error: response.status === 401 || response.status === 403 ? "Autenticação do Zeev inválida ou sem permissão para consultar solicitações." : `O Zeev respondeu com erro ${response.status}.` };
  const payload = await response.json();
  const instances = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.value) ? payload.value : [];
  return { configured: true, instances, error: "" };
}

function ticketInfo(instance: ZeevInstance) {
  const id = String(instance.instanceId ?? instance.id ?? "");
  const active = instance.active;
  return {
    id,
    status: active === true ? "Em andamento" : active === false ? String(instance.flowResult || "Concluído") : String(instance.status || "Localizado"),
    link: String(instance.reportLink || ""),
    name: String(instance.requestName || instance.name || "Solicitação Zeev"),
  };
}

function findTicket(row: { document: string; integrationKey: string; complement: string; value: number }, instances: ZeevInstance[]) {
  const document = normalized(row.document);
  const integrationKey = normalized(row.integrationKey);
  const amount = Math.abs(row.value).toFixed(2).replace(".", "");
  const supplierTokens = normalized(row.complement).match(/[a-z]{4,}/g)?.slice(0, 4) || [];
  const ranked = instances.map((instance) => {
    const haystack = normalized(JSON.stringify(instance));
    let score = 0;
    if (document && haystack.includes(document)) score += 100;
    if (integrationKey && haystack.includes(integrationKey)) score += 80;
    if (amount && haystack.includes(amount)) score += 20;
    score += supplierTokens.filter((token) => haystack.includes(token)).length * 5;
    return { instance, score };
  }).filter((item) => item.score >= 80).sort((a, b) => b.score - a.score);
  return ranked.length ? { ...ticketInfo(ranked[0].instance), matchScore: ranked[0].score } : null;
}

export async function GET(request: NextRequest) {
  try {
    if (!await authorized(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    const branches = new Set((request.nextUrl.searchParams.get("branches") || "").split(",").map((item) => item.trim()).filter(Boolean));
    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });
    const [year, month] = competence!.split("-").map(Number);
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const [records, zeev] = await Promise.all([queryTotvs(company, firstDay, lastDay), queryZeev(firstDay, lastDay)]);
    const rows = records.filter((record) => tag(record, "CODCONTA") === ENERGY_ACCOUNT && (!branches.size || branches.has(tag(record, "CODFILIAL")))).map((record) => {
      const base = {
        company: tag(record, "CODCOLIGADA"), branch: tag(record, "CODFILIAL"), entryId: tag(record, "IDLANCAMENTO"), document: tag(record, "DOCUMENTO"), integrationKey: tag(record, "INTEGRACHAVE"), sourceSystem: tag(record, "NOMESISTEMA"), date: tag(record, "DATA"), reduced: numeric(tag(record, "REDUZIDO")) || 913, account: tag(record, "CODCONTA"), description: tag(record, "DESCRICAO") || "Energia Elétrica", value: numeric(tag(record, "VALOR")), user: tag(record, "USUARIO"), complement: tag(record, "COMPLEMENTO"), costCenter: tag(record, "CCUSTO"),
      };
      return { ...base, ticket: findTicket(base, zeev.instances) };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch, "pt-BR", { numeric: true }));
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const ticketsFound = rows.filter((row) => row.ticket).length;
    return NextResponse.json({ source: "TOTVS RM — METTA0909 + Zeev", company, competence, account: ENERGY_ACCOUNT, rows, totals: { records: rows.length, accountingValue: total, ticketsFound, ticketsPending: rows.length - ticketsFound }, zeev: { configured: zeev.configured, error: zeev.error } }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins/credits/energy] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
