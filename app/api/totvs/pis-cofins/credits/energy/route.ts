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

async function authenticatedUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return null;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" });
  if (!response.ok) return null;
  const user = await response.json();
  const email = String(user?.email || "").trim().toLowerCase();
  return email ? { id: String(user?.id || ""), email } : null;
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

function listFromPayload(payload: unknown): ZeevInstance[] {
  if (Array.isArray(payload)) return payload as ZeevInstance[];
  if (!payload || typeof payload !== "object") return [];
  const value = payload as Record<string, unknown>;
  for (const key of ["items", "value", "results", "data"]) {
    if (Array.isArray(value[key])) return value[key] as ZeevInstance[];
  }
  return [];
}

function collectFieldNames(value: unknown, result = new Set<string>()) {
  if (Array.isArray(value)) value.forEach((item) => collectFieldNames(item, result));
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string" && record.name.trim()) result.add(record.name.trim());
    Object.values(record).forEach((item) => collectFieldNames(item, result));
  }
  return result;
}

function collectDocumentLinks(value: unknown, result = new Map<string, { name: string; url: string }>()) {
  if (Array.isArray(value)) value.forEach((item) => collectDocumentLinks(item, result));
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidateUrl = [record.openUrl, record.url, record.link, record.downloadUrl, record.fileUrl, record.path].find((item) => typeof item === "string" && /^https?:\/\//i.test(item));
    if (typeof candidateUrl === "string") {
      const lowered = candidateUrl.toLowerCase();
      if (/\.(pdf|xlsx?|csv|docx?|xml|zip)(?:[?#]|$)/i.test(lowered) || /file|attachment|anexo|document/i.test(lowered)) {
        const name = String(record.fileName || record.filename || record.name || record.label || `Documento ${result.size + 1}`);
        result.set(candidateUrl, { name, url: candidateUrl });
      }
    }
    Object.values(record).forEach((item) => collectDocumentLinks(item, result));
  } else if (typeof value === "string") {
    const urls = value.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    urls.forEach((url) => {
      if (/\.(pdf|xlsx?|csv|docx?|xml|zip)(?:[?#]|$)/i.test(url) || /file|attachment|anexo|document/i.test(url)) result.set(url, { name: `Documento ${result.size + 1}`, url });
    });
  }
  return [...result.values()];
}

async function zeevRequest(baseUrl: string, token: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
}

async function reportInstances(baseUrl: string, token: string, body: Record<string, unknown>) {
  const all: ZeevInstance[] = [];
  const pageSize = 500;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ "$top": String(pageSize), "$skip": String(page * pageSize) });
    const response = await zeevRequest(baseUrl, token, `/api/2/instances/report?${query}`, { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) return { response, instances: all };
    const items = listFromPayload(await response.json());
    all.push(...items);
    if (items.length < pageSize) return { response, instances: all };
  }
  return { response: new Response(null, { status: 200 }), instances: all };
}

function userSuffix(email: string) {
  if (email === "luanda.silva@raizeducacao.com.br") return "LUANDA";
  return email.split("@")[0].replace(/[^a-z0-9]/gi, "_").toUpperCase();
}

async function temporaryToken(baseUrl: string, email: string) {
  const suffix = userSuffix(email);
  const login = process.env[`ZEEV_LOGIN_${suffix}`];
  const password = process.env[`ZEEV_PASSWORD_${suffix}`];
  if (!login || !password) return "";
  const response = await fetch(`${baseUrl}/api/2/tokens`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ login, password }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return "";
  const payload = await response.json();
  return String(payload?.token || payload?.accessToken || payload?.value || "");
}

async function queryZeev(firstDay: string, lastDay: string, email: string) {
  const baseUrl = process.env.ZEEV_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) return { configured: false, instances: [] as ZeevInstance[], error: "Endereço do Zeev não configurado." };
  const suffix = userSuffix(email);
  const token = process.env[`ZEEV_API_TOKEN_${suffix}`] || process.env.ZEEV_API_TOKEN || await temporaryToken(baseUrl, email);
  if (!token) return { configured: false, instances: [] as ZeevInstance[], error: `Credencial Zeev vinculada a ${email} ainda não configurada.` };
  const configuredFieldNames = (process.env.ZEEV_ENERGY_FORM_FIELDS || "").split(",").map((item) => item.trim()).filter(Boolean);
  const rangeStart = new Date(`${firstDay}T12:00:00-03:00`);
  const rangeEnd = new Date(`${lastDay}T12:00:00-03:00`);
  rangeStart.setDate(rangeStart.getDate() - 45);
  rangeEnd.setDate(rangeEnd.getDate() + 60);
  const baseBody: Record<string, unknown> = {
    startDateIntervalBegin: rangeStart.toISOString(),
    startDateIntervalEnd: rangeEnd.toISOString(),
    showPendingInstanceTasks: true,
    showFinishedInstanceTasks: true,
    showPendingAssignees: true,
    allowOpenUrlsForFilesInForm: true,
  };
  const initial = await reportInstances(baseUrl, token, baseBody);
  if (!initial.response.ok) return { configured: true, instances: [] as ZeevInstance[], error: initial.response.status === 401 || initial.response.status === 403 ? "Autenticação do Zeev inválida ou sem permissão para consultar solicitações." : `O Zeev respondeu com erro ${initial.response.status}.` };

  const discovered = new Set(configuredFieldNames);
  if (!discovered.size) {
    const flowIds = [...new Set(initial.instances.map((instance) => {
      const flow = instance.flow as Record<string, unknown> | undefined;
      return Number(instance.flowId || flow?.id || 0);
    }).filter(Boolean))].slice(0, 50);
    await Promise.all(flowIds.map(async (flowId) => {
      const response = await zeevRequest(baseUrl, token, `/api/2/flows/${flowId}/design/form`);
      if (response.ok) collectFieldNames(await response.json()).forEach((name) => discovered.add(name));
    }));
  }

  const formFieldNames = [...discovered].slice(0, 500);
  if (!formFieldNames.length) return { configured: true, instances: initial.instances, error: "O token acessou o Zeev, mas não possui permissão para descobrir os campos dos documentos." };
  const detailed = await reportInstances(baseUrl, token, { ...baseBody, formFieldNames });
  if (!detailed.response.ok) return { configured: true, instances: initial.instances, error: `O Zeev permitiu listar solicitações, mas recusou a leitura dos campos (${detailed.response.status}).` };
  return { configured: true, instances: detailed.instances, error: "", fieldNames: formFieldNames };
}

function ticketInfo(instance: ZeevInstance) {
  const id = String(instance.instanceId ?? instance.id ?? "");
  const active = instance.active;
  return {
    id,
    status: active === true ? "Em andamento" : active === false ? String(instance.flowResult || "Concluído") : String(instance.status || "Localizado"),
    link: String(instance.reportLink || ""),
    name: String(instance.requestName || instance.name || "Solicitação Zeev"),
    documents: collectDocumentLinks(instance),
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
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    const branches = new Set((request.nextUrl.searchParams.get("branches") || "").split(",").map((item) => item.trim()).filter(Boolean));
    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });
    const [year, month] = competence!.split("-").map(Number);
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const [records, zeev] = await Promise.all([queryTotvs(company, firstDay, lastDay), queryZeev(firstDay, lastDay, user.email)]);
    const rows = records.filter((record) => tag(record, "CODCONTA") === ENERGY_ACCOUNT && (!branches.size || branches.has(tag(record, "CODFILIAL")))).map((record) => {
      const base = {
        company: tag(record, "CODCOLIGADA"), branch: tag(record, "CODFILIAL"), entryId: tag(record, "IDLANCAMENTO"), document: tag(record, "DOCUMENTO"), integrationKey: tag(record, "INTEGRACHAVE"), sourceSystem: tag(record, "NOMESISTEMA"), date: tag(record, "DATA"), reduced: numeric(tag(record, "REDUZIDO")) || 913, account: tag(record, "CODCONTA"), description: tag(record, "DESCRICAO") || "Energia Elétrica", value: numeric(tag(record, "VALOR")), user: tag(record, "USUARIO"), complement: tag(record, "COMPLEMENTO"), costCenter: tag(record, "CCUSTO"),
      };
      return { ...base, ticket: findTicket(base, zeev.instances) };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch, "pt-BR", { numeric: true }));
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const ticketsFound = rows.filter((row) => row.ticket).length;
    return NextResponse.json({ source: "TOTVS RM — METTA0909 + Zeev", company, competence, account: ENERGY_ACCOUNT, authenticatedUser: user.email, rows, totals: { records: rows.length, accountingValue: total, ticketsFound, ticketsPending: rows.length - ticketsFound }, zeev: { configured: zeev.configured, error: zeev.error } }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins/credits/energy] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
