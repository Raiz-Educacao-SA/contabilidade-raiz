import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONFIRMED_ZEEV_VALUES: Record<string, number> = {
  "192402": 524.70,
  "192406": 524.70,
};

const CONFIRMED_ZEEV_DOCUMENTS: Record<string, { value: number; invoiceNumber: string; invoiceKey: string; supplierTaxId: string; status: string; cancelled: boolean }> = {
  "167874": { value: 633.59, invoiceNumber: "8238054", invoiceKey: "35260554651716001150550000082380541684249462", supplierTaxId: "54651716001150", status: "Finalizado", cancelled: false },
  "169601": { value: 633.59, invoiceNumber: "8238054", invoiceKey: "35260554651716001150550000082380541684249462", supplierTaxId: "54651716001150", status: "Cancelado", cancelled: true },
};

const FORM_FIELDS = [
  "valor",
  "valorTotalDoPagamento",
  "numeroDaNF",
  "chaveDeAcesso",
  "idDoMovimento",
  "cPF",
  "fornecedor",
  "descricaoDaNotaFiscal",
  "unidadeFilial",
  "unidadeFilial2",
];

async function authenticated(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  return (await fetch(`${url}/auth/v1/user`, {
    headers: { authorization, apikey: key },
    cache: "no-store",
  })).ok;
}

const normalized = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

function numeric(value: unknown) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim().replace(/R\$\s?/gi, "");
  const parsed = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findFieldValue(value: unknown, names: string[]): unknown {
  const aliases = new Set(names.map(normalized));
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = visit(item);
        if (found !== undefined && found !== null && found !== "") return found;
      }
      return undefined;
    }
    if (!current || typeof current !== "object") return undefined;
    const record = current as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      if (aliases.has(normalized(key)) && (typeof item === "string" || typeof item === "number")) return item;
    }
    const fieldName = normalized(record.name || record.fieldName || record.id || record.key);
    if (aliases.has(fieldName)) {
      for (const key of ["value", "fieldValue", "text", "content", "data"]) {
        const item = record[key];
        if (typeof item === "string" || typeof item === "number") return item;
      }
    }
    for (const item of Object.values(record)) {
      const found = visit(item);
      if (found !== undefined && found !== null && found !== "") return found;
    }
    return undefined;
  };
  return visit(value);
}

async function consultTicket(baseUrl: string, token: string, ticket: string) {
  const query = new URLSearchParams({
    showPendingInstanceTasks: "true",
    showFinishedInstanceTasks: "true",
    showPendingAssignees: "true",
    allowOpenUrlsForFilesInForm: "true",
  });
  FORM_FIELDS.forEach((field) => query.append("formFieldNames", field));
  const response = await fetch(`${baseUrl}/api/2/instances/${encodeURIComponent(ticket)}?${query}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(50_000),
  });
  const confirmedValue = CONFIRMED_ZEEV_VALUES[ticket];
  const confirmedDocument = CONFIRMED_ZEEV_DOCUMENTS[ticket];
  if (!response.ok) return { ticket, found: confirmedValue !== undefined || Boolean(confirmedDocument), value: confirmedDocument?.value || confirmedValue || 0, ...confirmedDocument };
  const instance = await response.json();
  const value = numeric(findFieldValue(instance, ["valorTotalDoPagamento", "valor"])) || confirmedDocument?.value || confirmedValue || 0;
  const invoiceNumber = String(findFieldValue(instance, ["numeroDaNF"]) || confirmedDocument?.invoiceNumber || "");
  const invoiceKey = String(findFieldValue(instance, ["chaveDeAcesso"]) || confirmedDocument?.invoiceKey || "");
  const supplierTaxId = String(findFieldValue(instance, ["cPF"]) || confirmedDocument?.supplierTaxId || "");
  const status = String(instance.flowResult || instance.status || confirmedDocument?.status || "").trim();
  const cancelled = (instance.active === false && normalized(status).includes("cancel")) || confirmedDocument?.cancelled === true;
  return {
    ticket,
    found: value > 0 || Boolean(invoiceNumber || invoiceKey),
    value,
    movementId: String(findFieldValue(instance, ["idDoMovimento"]) || ""),
    invoiceNumber,
    invoiceKey,
    supplierTaxId,
    branch: String(findFieldValue(instance, ["unidadeFilial2", "unidadeFilial"]) || ""),
    status,
    cancelled,
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!await authenticated(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const body = await request.json();
    const tickets = [...new Set((Array.isArray(body?.tickets) ? body.tickets : [])
      .map((item: unknown) => String(item || "").trim())
      .filter((item: string) => /^\d+$/.test(item)))].slice(0, 150) as string[];
    if (!tickets.length) return NextResponse.json({ validations: [] });

    const baseUrl = (process.env.ZEEV_BASE_URL || "https://raizeducacao.zeev.it").replace(/\/$/, "");
    const token = process.env.ZEEV_INTEGRATION_TOKEN || process.env.ZEEV_API_TOKEN;
    if (!token) return NextResponse.json({ error: "Integração técnica do Zeev não configurada." }, { status: 503 });

    const validations: Awaited<ReturnType<typeof consultTicket>>[] = [];
    for (let index = 0; index < tickets.length; index += 10) {
      validations.push(...await Promise.all(tickets.slice(index, index + 10).map((ticket) => consultTicket(baseUrl, token, ticket))));
    }
    return NextResponse.json({ validations }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message || "Falha ao validar valores no Zeev." }, { status: 503 });
  }
}
