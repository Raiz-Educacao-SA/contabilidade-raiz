import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

async function authenticatedUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return null;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { authorization, apikey: key },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const user = await response.json();
  const email = String(user?.email || "").trim().toLowerCase();
  return email ? { id: String(user?.id || ""), email } : null;
}

function safeFileName(value: string) {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "documento-zeev";
}

function collectDocumentLinks(value: unknown, result = new Map<string, { name: string; url: string }>()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectDocumentLinks(item, result));
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidateUrl = [
      record.openUrl,
      record.url,
      record.link,
      record.downloadUrl,
      record.fileUrl,
      record.path,
    ].find((item) => typeof item === "string" && item.trim());

    if (typeof candidateUrl === "string") {
      const lowered = candidateUrl.toLowerCase();
      if (
        (/^https?:\/\//i.test(lowered) || lowered.startsWith("/")) &&
        (/\.(pdf|xlsx?|csv|docx?|xml|zip)(?:[?#]|$)/i.test(lowered) || /file|attachment|anexo|document/i.test(lowered))
      ) {
        const name = String(record.fileName || record.filename || record.name || record.label || `Documento ${result.size + 1}`);
        result.set(candidateUrl, { name, url: candidateUrl });
      }
    }

    Object.values(record).forEach((item) => collectDocumentLinks(item, result));
  } else if (typeof value === "string") {
    const urls = value.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    urls.forEach((url) => {
      if (/\.(pdf|xlsx?|csv|docx?|xml|zip)(?:[?#]|$)/i.test(url) || /file|attachment|anexo|document/i.test(url)) {
        result.set(url, { name: `Documento ${result.size + 1}`, url });
      }
    });
  }

  return [...result.values()];
}

async function zeevInstanceDocument(baseUrl: string, ticket: string) {
  const token = process.env.ZEEV_INTEGRATION_TOKEN || process.env.ZEEV_API_TOKEN;
  if (!token) throw new Error("Token técnico do Zeev não configurado para baixar documentos.");

  const query = new URLSearchParams({
    showPendingInstanceTasks: "true",
    showFinishedInstanceTasks: "true",
    showPendingAssignees: "true",
    allowOpenUrlsForFilesInForm: "true",
  });

  const response = await fetch(`${baseUrl}/api/2/instances/${encodeURIComponent(ticket)}?${query}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(50_000),
  });
  if (!response.ok) throw new Error(`O Zeev recusou a consulta do ticket ${ticket} (${response.status}).`);

  const instance = await response.json();
  const document = collectDocumentLinks(instance)[0];
  if (!document?.url) throw new Error(`Nenhum documento/anexo foi localizado no ticket Zeev ${ticket}.`);

  return {
    name: document.name || `ticket-${ticket}`,
    url: new URL(document.url, `${baseUrl}/`).toString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });

    const baseUrl = (process.env.ZEEV_BASE_URL || "https://raizeducacao.zeev.it").replace(/\/$/, "");
    const ticket = request.nextUrl.searchParams.get("ticket")?.trim();
    const documentFromTicket = ticket ? await zeevInstanceDocument(baseUrl, ticket) : null;
    const requestedUrl = documentFromTicket?.url || request.nextUrl.searchParams.get("url")?.trim();
    const requestedName = documentFromTicket?.name || request.nextUrl.searchParams.get("name")?.trim() || "documento-zeev";
    if (!requestedUrl) return NextResponse.json({ error: "Documento do Zeev não informado." }, { status: 400 });

    const base = new URL(baseUrl);
    const target = new URL(requestedUrl, `${base.origin}/`);
    if (target.hostname !== base.hostname) {
      return NextResponse.json({ error: "O documento informado não pertence ao Zeev configurado." }, { status: 400 });
    }

    const token = process.env.ZEEV_INTEGRATION_TOKEN || process.env.ZEEV_API_TOKEN;
    const response = await fetch(target.toString(), {
      headers: {
        accept: "*/*",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `O Zeev recusou o download do documento (${response.status}).` }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const fileName = safeFileName(requestedName);
    return new NextResponse(response.body, {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message || "Falha ao baixar o documento do Zeev." }, { status: 503 });
  }
}
