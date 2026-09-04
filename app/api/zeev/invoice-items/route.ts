import { NextRequest, NextResponse } from "next/server";
import { parseNfeOcr, parseNfeXml } from "@/lib/nfe-items";
import { authenticatedCorporateUser } from "@/lib/server/supabase-access";

export const runtime = "nodejs";
export const maxDuration = 120;

type DocumentLink = { name: string; url: string };

function collectDocuments(value: unknown, result = new Map<string, DocumentLink>()) {
  if (Array.isArray(value)) value.forEach((item) => collectDocuments(item, result));
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const url = [record.openUrl, record.url, record.link, record.downloadUrl, record.fileUrl, record.path].find((item) => typeof item === "string" && item.trim());
    if (typeof url === "string" && (/^https?:\/\//i.test(url) || url.startsWith("/"))) {
      const name = String(record.fileName || record.filename || record.name || record.label || `documento-${result.size + 1}`);
      if (/\.(xml|pdf|png|jpe?g)(?:[?#]|$)/i.test(`${name} ${url}`) || /anexo|document|file/i.test(url)) result.set(url, { name, url });
    }
    Object.values(record).forEach((item) => collectDocuments(item, result));
  }
  return [...result.values()];
}

async function download(baseUrl: string, token: string, document: DocumentLink) {
  const target = new URL(document.url, `${baseUrl}/`);
  if (target.hostname !== new URL(baseUrl).hostname) throw new Error("Anexo fora do domínio configurado do Zeev.");
  const response = await fetch(target, { headers: { authorization: `Bearer ${token}`, accept: "*/*" }, cache: "no-store", signal: AbortSignal.timeout(50_000) });
  if (!response.ok) throw new Error(`O Zeev recusou o anexo (${response.status}).`);
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "" };
}

export async function GET(request: NextRequest) {
  try {
    if (!await authenticatedCorporateUser(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const ticket = request.nextUrl.searchParams.get("ticket")?.trim() || "";
    if (!/^\d+$/.test(ticket)) return NextResponse.json({ error: "Ticket Zeev inválido." }, { status: 400 });
    const baseUrl = (process.env.ZEEV_BASE_URL || "https://raizeducacao.zeev.it").replace(/\/$/, "");
    const token = process.env.ZEEV_INTEGRATION_TOKEN || process.env.ZEEV_API_TOKEN;
    if (!token) return NextResponse.json({ error: "Integração técnica do Zeev não configurada." }, { status: 503 });
    const query = new URLSearchParams({ showPendingInstanceTasks: "true", showFinishedInstanceTasks: "true", allowOpenUrlsForFilesInForm: "true" });
    const instanceResponse = await fetch(`${baseUrl}/api/2/instances/${encodeURIComponent(ticket)}?${query}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(50_000) });
    if (!instanceResponse.ok) throw new Error(`O Zeev recusou a consulta do ticket (${instanceResponse.status}).`);
    const documents = collectDocuments(await instanceResponse.json());
    const xmlDocument = documents.find((item) => /\.xml(?:[?#]|$)/i.test(`${item.name} ${item.url}`));
    if (xmlDocument) {
      const file = await download(baseUrl, token, xmlDocument);
      const items = parseNfeXml(file.buffer.toString("utf8"));
      if (items.length) return NextResponse.json({ items, source: "XML da NF-e", documentName: xmlDocument.name });
    }
    const visualDocument = documents.find((item) => /\.(pdf|png|jpe?g)(?:[?#]|$)/i.test(`${item.name} ${item.url}`));
    if (!visualDocument) return NextResponse.json({ items: [], source: "Zeev", warning: "O ticket não possui XML, PDF ou imagem da nota fiscal acessível." });
    const file = await download(baseUrl, token, visualDocument);
    const [{ createWorker }, { pdf }] = await Promise.all([import("tesseract.js"), import("pdf-to-img")]);
    const worker = await createWorker("por");
    const texts: string[] = [];
    try {
      if (/pdf/i.test(file.contentType) || /\.pdf/i.test(visualDocument.name)) {
        let page = 0;
        for await (const image of await pdf(file.buffer, { scale: 2 })) {
          texts.push((await worker.recognize(Buffer.from(image))).data.text);
          if (++page >= 4) break;
        }
      } else texts.push((await worker.recognize(file.buffer)).data.text);
    } finally { await worker.terminate(); }
    const items = parseNfeOcr(texts.join("\n"));
    return NextResponse.json({ items, source: "Leitura do PDF/imagem da NF", documentName: visualDocument.name, warning: items.length ? null : "A leitura automática não separou os itens. Consulte o documento antes de confirmar." });
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message || "Falha ao ler os itens da nota fiscal." }, { status: 503 });
  }
}
