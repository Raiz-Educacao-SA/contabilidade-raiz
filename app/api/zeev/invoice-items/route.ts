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
  } else if (typeof value === "string") {
    for (const url of value.match(/https?:\/\/[^\s"'<>]+/gi) ?? []) result.set(url, { name: `documento-${result.size + 1}`, url });
  }
  return [...result.values()];
}

const digits = (value: string) => value.replace(/\D/g, "");
const documentScore = (document: DocumentLink, invoiceKey: string, invoiceNumber: string) => {
  const label = `${document.name} ${document.url}`.toLowerCase();
  return (/xml/.test(label) ? 50 : 0) + (/danfe|nf-?e|nota.?fiscal/.test(label) ? 30 : 0) + (invoiceKey && digits(label).includes(invoiceKey) ? 100 : 0) + (invoiceNumber && digits(label).includes(invoiceNumber) ? 20 : 0) - (/boleto|pedido|comprovante/.test(label) ? 60 : 0);
};

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
    const invoiceKey = digits(request.nextUrl.searchParams.get("invoiceKey") || "");
    const invoiceNumber = digits(request.nextUrl.searchParams.get("invoiceNumber") || "");
    if (!/^\d+$/.test(ticket)) return NextResponse.json({ error: "Ticket Zeev inválido." }, { status: 400 });
    const baseUrl = (process.env.ZEEV_BASE_URL || "https://raizeducacao.zeev.it").replace(/\/$/, "");
    const token = process.env.ZEEV_INTEGRATION_TOKEN || process.env.ZEEV_API_TOKEN;
    if (!token) return NextResponse.json({ error: "Integração técnica do Zeev não configurada." }, { status: 503 });
    const query = new URLSearchParams({ showPendingInstanceTasks: "true", showFinishedInstanceTasks: "true", allowOpenUrlsForFilesInForm: "true" });
    const instanceResponse = await fetch(`${baseUrl}/api/2/instances/${encodeURIComponent(ticket)}?${query}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(50_000) });
    if (!instanceResponse.ok) throw new Error(`O Zeev recusou a consulta do ticket (${instanceResponse.status}).`);
    const documents = collectDocuments(await instanceResponse.json()).sort((a, b) => documentScore(b, invoiceKey, invoiceNumber) - documentScore(a, invoiceKey, invoiceNumber));
    for (const document of documents.slice(0, 12)) {
      if (!/xml/i.test(`${document.name} ${document.url}`)) continue;
      const file = await download(baseUrl, token, document);
      const xml = file.buffer.toString("utf8");
      if (invoiceKey && !digits(xml).includes(invoiceKey)) continue;
      const items = parseNfeXml(xml);
      if (items.length) return NextResponse.json({ items, source: "Dados do produto/serviço · XML da NF-e", documentName: document.name });
    }
    const visualDocument = documents.find((item) => /\.(pdf|png|jpe?g)(?:[?#]|$)/i.test(`${item.name} ${item.url}`) && !/boleto|pedido|comprovante/i.test(item.name));
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
    return NextResponse.json({ items, source: "Dados do produto/serviço · DANFE", documentName: visualDocument.name, warning: items.length ? null : "A tabela Dados do produto/serviço não pôde ser separada. Consulte a DANFE antes de confirmar." });
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message || "Falha ao ler os itens da nota fiscal." }, { status: 503 });
  }
}
