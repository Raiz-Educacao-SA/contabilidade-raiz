import { NextRequest, NextResponse } from "next/server";
import { queryDataEngine } from "@/lib/totvs-dataengine";

export const runtime = "nodejs";
export const maxDuration = 300;

const ENERGY_ACCOUNT = "4.2.1.02.04.01";
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeXml = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() || "");
const firstTag = (xml: string, names: string[]) => names.map((name) => tag(xml, name)).find(Boolean) || "";
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
  for (const key of ["items", "value", "results", "data", "instances", "instanceDtos", "report", "records", "rows"]) {
    if (Array.isArray(value[key])) return value[key] as ZeevInstance[];
  }
  // Algumas versões do Zeev encapsulam o relatório em um objeto intermediário.
  // A busca permanece restrita aos campos conhecidos para não confundir tarefas,
  // anexos ou campos de formulário com solicitações.
  for (const key of ["data", "result", "report", "response"]) {
    const nested = listFromPayload(value[key]);
    if (nested.length) return nested;
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
    const candidateUrl = [record.openUrl, record.url, record.link, record.downloadUrl, record.fileUrl, record.path].find((item) => typeof item === "string" && item.trim());
    if (typeof candidateUrl === "string") {
      const lowered = candidateUrl.toLowerCase();
      if ((/^https?:\/\//i.test(lowered) || lowered.startsWith("/")) && (/\.(pdf|xlsx?|csv|docx?|xml|zip)(?:[?#]|$)/i.test(lowered) || /file|attachment|anexo|document/i.test(lowered))) {
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
  // A instalação da Raiz não habilita $top/$skip neste endpoint. O relatório
  // já devolve o conjunto limitado pelos filtros enviados no corpo.
  const response = await zeevRequest(baseUrl, token, "/api/2/instances/report", { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) return { response, instances: [] as ZeevInstance[] };
  return { response, instances: listFromPayload(await response.json()) };
}

async function consultSpecificInstances(baseUrl: string, token: string, instanceIds: string[], formFieldNames: string[]) {
  const uniqueIds = [...new Set(instanceIds.filter((id) => /^\d+$/.test(id)))].slice(0, 100);
  const instances = await Promise.all(uniqueIds.map(async (id) => {
    const query = new URLSearchParams({
      showPendingInstanceTasks: "true",
      showFinishedInstanceTasks: "true",
      showPendingAssignees: "true",
      allowOpenUrlsForFilesInForm: "true",
    });
    formFieldNames.slice(0, 150).forEach((fieldName) => query.append("formFieldNames", fieldName));
    const response = await zeevRequest(baseUrl, token, `/api/2/instances/${encodeURIComponent(id)}?${query}`);
    if (response.ok) return response.json().catch(() => null);
    return null;
  }));
  return instances.filter((instance): instance is ZeevInstance => Boolean(instance && typeof instance === "object"));
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
  return String(payload?.temporaryToken || payload?.token || payload?.accessToken || payload?.value || "");
}

function tokenFromPayload(payload: Record<string, unknown>) {
  return String(payload.temporaryToken || payload.token || payload.accessToken || payload.value || "").trim();
}

async function zeevTokenForUser(baseUrl: string, email: string) {
  const suffix = userSuffix(email);
  const personalToken = process.env[`ZEEV_API_TOKEN_${suffix}`];
  if (personalToken) return { token: personalToken, mode: "personal" as const };

  const integrationToken = process.env.ZEEV_INTEGRATION_TOKEN || process.env.ZEEV_API_TOKEN;
  if (integrationToken) {
    const impersonation = await zeevRequest(baseUrl, integrationToken, `/api/2/tokens/impersonate/${encodeURIComponent(email)}`);
    if (impersonation.ok) {
      const delegatedToken = tokenFromPayload(await impersonation.json());
      if (delegatedToken) return { token: delegatedToken, mode: "delegated" as const };
    }
    return { token: integrationToken, mode: "integration" as const };
  }

  const loginToken = await temporaryToken(baseUrl, email);
  return loginToken ? { token: loginToken, mode: "login" as const } : { token: "", mode: "missing" as const };
}

async function queryZeev(firstDay: string, lastDay: string, email: string, ticketIds: string[]) {
  const baseUrl = process.env.ZEEV_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) return { configured: false, instances: [] as ZeevInstance[], error: "Endereço do Zeev não configurado." };
  const zeevAuthentication = await zeevTokenForUser(baseUrl, email);
  const token = zeevAuthentication.token;
  if (!token) return { configured: false, instances: [] as ZeevInstance[], error: `Credencial Zeev vinculada a ${email} ainda não configurada.` };
  const configuredFieldNames = (process.env.ZEEV_ENERGY_FORM_FIELDS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!ticketIds.length) {
    return { configured: true, instances: [] as ZeevInstance[], error: "", fieldNames: configuredFieldNames, authenticationMode: zeevAuthentication.mode };
  }
  // Com o TICKET vindo do TOTVS, a consulta deve ser pontual. O relatório
  // amplo de solicitações retorna erro 500 neste ambiente e não é
  // necessário para estabelecer o vínculo IDMOV -> TICKET.
  if (ticketIds.length) {
    const exactInstances = await consultSpecificInstances(baseUrl, token, ticketIds, configuredFieldNames);
    return {
      configured: true,
      instances: exactInstances,
      error: exactInstances.length < new Set(ticketIds).size ? "Alguns documentos não puderam ser detalhados pelo Zeev; os tickets identificados no TOTVS continuam disponíveis." : "",
      fieldNames: configuredFieldNames,
      authenticationMode: zeevAuthentication.mode,
    };
  }
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
  const exactInstances = await consultSpecificInstances(baseUrl, token, ticketIds, formFieldNames);
  if (!formFieldNames.length) return { configured: true, instances: [...exactInstances, ...initial.instances], error: "O token acessou o Zeev, mas não possui permissão para descobrir os campos dos documentos." };
  const detailed = await reportInstances(baseUrl, token, { ...baseBody, formFieldNames });
  if (!detailed.response.ok) return { configured: true, instances: initial.instances, error: `O Zeev permitiu listar solicitações, mas recusou a leitura dos campos (${detailed.response.status}).` };
  const instances = [...exactInstances, ...detailed.instances].filter((instance, index, list) => list.findIndex((item) => String(item.id ?? item.instanceId ?? "") === String(instance.id ?? instance.instanceId ?? "")) === index);
  return { configured: true, instances, error: "", fieldNames: formFieldNames, authenticationMode: zeevAuthentication.mode };
}

function ticketInfo(instance: ZeevInstance, baseUrl: string) {
  const id = String(instance.instanceId ?? instance.id ?? "");
  const active = instance.active;
  const reportLink = String(instance.reportLink || "").trim();
  return {
    id,
    status: active === true ? "Em andamento" : active === false ? String(instance.flowResult || "Concluído") : String(instance.status || "Localizado"),
    link: reportLink ? new URL(reportLink, `${baseUrl}/`).toString() : id ? `${baseUrl}/1.0/audit?c=${encodeURIComponent(id)}` : "",
    name: String(instance.requestName || instance.name || "Solicitação Zeev"),
    documents: collectDocumentLinks(instance).map((document) => ({ ...document, url: new URL(document.url, `${baseUrl}/`).toString() })),
  };
}

function findTicket(row: { document: string; integrationKey: string; ticketHint: string; complement: string; value: number }, instances: ZeevInstance[], baseUrl: string) {
  const document = normalized(row.document);
  const movementId = normalized(row.integrationKey);
  const ticketHint = normalized(row.ticketHint);
  const amount = Math.abs(row.value).toFixed(2).replace(".", "");
  const supplierTokens = normalized(row.complement).match(/[a-z]{4,}/g)?.slice(0, 4) || [];

  // O TICKET informado no anexo FLUIG do razão é a chave de verdade.
  // Se ele existir, não pode ser substituído por uma solicitação semelhante.
  if (ticketHint) {
    const exact = instances.find((instance) => normalized(instance.instanceId ?? instance.id) === ticketHint);
    return exact
      ? { ...ticketInfo(exact, baseUrl), id: row.ticketHint.trim(), matchScore: 1_000 }
      : {
          id: row.ticketHint.trim(),
          status: "Identificado no TOTVS",
          link: `${baseUrl}/1.0/audit?c=${encodeURIComponent(row.ticketHint.trim())}`,
          name: "Solicitação Zeev",
          documents: [],
          matchScore: 1_000,
        };
  }

  const ranked = instances.map((instance) => {
    const searchable = { ...instance };
    delete searchable.id;
    delete searchable.instanceId;
    delete searchable.reportLink;
    const haystack = normalized(JSON.stringify(searchable));
    let score = 0;
    if (movementId && haystack.includes(movementId)) score += 500;
    if (document && haystack.includes(document)) score += 150;
    if (amount && haystack.includes(amount)) score += 20;
    score += supplierTokens.filter((token) => haystack.includes(token)).length * 5;
    return { instance, score };
  }).filter((item) => item.score >= 150).sort((a, b) => b.score - a.score);
  return ranked.length ? { ...ticketInfo(ranked[0].instance, baseUrl), matchScore: ranked[0].score } : null;
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
    const records = await queryDataEngine({ code: "METTA0909", system: "C", parameters: `PLN_B7_S=${ENERGY_ACCOUNT};PLN_B5_D=${firstDay};PLN_B6_D=${lastDay};PLN_B3_S=${company};PLN_B4_S=${company}`, errorMessage: "Falha ao consultar a conta de Energia no TOTVS/DataEngine." });
    // Planilha Net 08 — FORNECEDOR X MOVIMENTO. Ela enriquece a lista
    // contábil com o TICKET, sem substituir os lançamentos da conta 913.
    const movementRecords = await queryDataEngine({
      code: "PLAN.T.0003.001",
      system: "T",
      parameters: `PLN_B1_D=${firstDay};PLN_B2_D=${lastDay}`,
      errorMessage: "Falha ao consultar a Planilha Net 08 do módulo de Compras.",
    });
    const key = (value: string) => value.trim().replace(/^0+(?=\d)/, "");
    const valueKey = (value: number) => Math.abs(value).toFixed(2);
    const companyMovements = movementRecords.filter((record) => Number(tag(record, "CODCOLIGADA")) === Number(company));
    const ticketByMovement = new Map<string, string>();
    const ticketByDocument = new Map<string, string>();
    const ticketsByBranchValue = new Map<string, Set<string>>();
    companyMovements.forEach((record) => {
      const ticket = firstTag(record, ["TICKET", "CODTICKET", "NUMEROTICKET"]);
      if (!ticket) return;
      const movement = key(tag(record, "IDMOV"));
      const document = key(tag(record, "NUMEROMOV"));
      if (movement) ticketByMovement.set(movement, ticket);
      if (document) ticketByDocument.set(document, ticket);
      const branchValue = `${key(tag(record, "CODFILIAL"))}|${valueKey(numeric(tag(record, "VALOR")))}`;
      const found = ticketsByBranchValue.get(branchValue) || new Set<string>();
      found.add(ticket);
      ticketsByBranchValue.set(branchValue, found);
    });
    const movementFromRecord = (record: string) => key(firstTag(record, ["IDMOV", "INTEGRACHAVE"]));
    const ticketFromRecord = (record: string) => {
      const direct = firstTag(record, ["TICKET", "CODTICKET", "NUMEROTICKET"]);
      if (direct) return direct;
      const byMovement = ticketByMovement.get(movementFromRecord(record));
      if (byMovement) return byMovement;
      const byDocument = ticketByDocument.get(key(tag(record, "DOCUMENTO")));
      if (byDocument) return byDocument;
      const candidates = ticketsByBranchValue.get(`${key(tag(record, "CODFILIAL"))}|${valueKey(numeric(tag(record, "VALOR")))}`);
      return candidates?.size === 1 ? [...candidates][0] : "";
    };
    const ticketIds = records.map(ticketFromRecord).filter(Boolean);
    const zeev = await queryZeev(firstDay, lastDay, user.email, ticketIds);
    const rows = records.filter((record) => tag(record, "CODCONTA") === ENERGY_ACCOUNT && (!branches.size || branches.has(tag(record, "CODFILIAL")))).map((record) => {
      const base = {
        company: tag(record, "CODCOLIGADA"), branch: tag(record, "CODFILIAL"), entryId: tag(record, "IDLANCAMENTO"), document: tag(record, "DOCUMENTO"), integrationKey: movementFromRecord(record), ticketHint: ticketFromRecord(record), sourceSystem: tag(record, "NOMESISTEMA"), date: tag(record, "DATA"), reduced: numeric(tag(record, "REDUZIDO")) || 913, account: tag(record, "CODCONTA"), description: tag(record, "DESCRICAO") || "Energia Elétrica", value: numeric(tag(record, "VALOR")), user: tag(record, "USUARIO"), complement: tag(record, "COMPLEMENTO"), costCenter: tag(record, "CCUSTO"),
      };
      const zeevBaseUrl = (process.env.ZEEV_BASE_URL || "https://raizeducacao.zeev.it").replace(/\/$/, "");
      return { ...base, ticket: findTicket(base, zeev.instances, zeevBaseUrl) };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch, "pt-BR", { numeric: true }));
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const ticketsFound = rows.filter((row) => row.ticket).length;
    return NextResponse.json({ source: "TOTVS RM — conta 913 + Planilha Net 08 (PLAN.T.0003.001) + Zeev", company, competence, account: ENERGY_ACCOUNT, authenticatedUser: user.email, rows, totals: { records: rows.length, accountingValue: total, ticketsFound, ticketsPending: rows.length - ticketsFound }, zeev: { configured: zeev.configured, error: zeev.error } }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins/credits/energy] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
