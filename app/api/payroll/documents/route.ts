import { NextRequest, NextResponse } from "next/server";
import { tmpdir } from "node:os";

export const runtime = "nodejs";
export const maxDuration = 300;

const accepted = /\.(pdf|png|jpe?g|webp)$/i;

async function extractPdfText(buffer: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => "str" in item ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }] : []);
    items.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
    const lines: Array<{ y: number; parts: string[] }> = [];
    for (const item of items) {
      const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
      if (line) line.parts.push(item.text);
      else lines.push({ y: item.y, parts: [item.text] });
    }
    pages.push(lines.map((line) => line.parts.join(" ").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"));
  }
  return pages.join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File && accepted.test(value.name));
    if (!files.length) return NextResponse.json({ documents: [] });
    if (files.length > 20) return NextResponse.json({ error: "Envie no máximo 20 documentos por conferência." }, { status: 400 });

    const [{ pdf }, { createWorker }] = await Promise.all([import("pdf-to-img"), import("tesseract.js")]);
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    const recognize = async (image: Buffer | Uint8Array) => {
      worker ??= await createWorker("por", 1, { cachePath: process.env.VERCEL ? "/tmp" : tmpdir() });
      return (await worker.recognize(Buffer.from(image))).data.text;
    };
    const documents: Array<{ name: string; text: string }> = [];
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`O arquivo ${file.name} ultrapassa o limite de 20 MB.`);
        const buffer = Buffer.from(await file.arrayBuffer());
        const pages: string[] = [];
        if (/\.pdf$/i.test(file.name)) {
          const embeddedText = await extractPdfText(buffer);
          if (embeddedText.replace(/\s/g, "").length > 80) pages.push(embeddedText);
          else {
            const document = await pdf(buffer, { scale: 2 });
            for await (const image of document) pages.push(await recognize(image));
          }
        } else {
          pages.push(await recognize(buffer));
        }
        documents.push({ name: file.name, text: pages.join("\n") });
      }
    } finally {
      if (worker) await worker.terminate();
    }
    return NextResponse.json({ documents }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Não foi possível ler os documentos do DP." }, { status: 500 });
  }
}
