"use client";

import type { ExtractedDocument } from "./payroll-reconciliation";

type Progress = (message: string) => void;
type OcrWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

function textFromItems(items: Array<{ str?: string; transform?: number[] }>) {
  const positioned = items.flatMap((item) => item.str && item.transform ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }] : []);
  positioned.sort((left, right) => Math.abs(right.y - left.y) > 2 ? right.y - left.y : left.x - right.x);
  const lines: Array<{ y: number; parts: string[] }> = [];
  for (const item of positioned) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
    if (line) line.parts.push(item.text);
    else lines.push({ y: item.y, parts: [item.text] });
  }
  return lines.map((line) => line.parts.join(" ").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export async function extractVisualDocumentsInBrowser(files: File[], onProgress: Progress): Promise<ExtractedDocument[]> {
  if (!files.length) return [];
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  let ocrWorker: OcrWorker | null = null;
  const recognize = async (source: File | HTMLCanvasElement) => {
    if (!ocrWorker) {
      onProgress("Preparando o reconhecimento dos documentos digitalizados...");
      const { createWorker } = await import("tesseract.js");
      ocrWorker = await createWorker("por");
    }
    return (await ocrWorker.recognize(source)).data.text;
  };
  const documents: ExtractedDocument[] = [];
  try {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      onProgress(`Lendo ${fileIndex + 1} de ${files.length}: ${file.name}`);
      if (!/\.pdf$/i.test(file.name)) {
        documents.push({ name: file.name, text: await recognize(file) });
        continue;
      }
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true, disableFontFace: true }).promise;
      const pages = [] as Array<{ page: Awaited<ReturnType<typeof pdf.getPage>>; text: string }>;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push({ page, text: textFromItems(content.items as Array<{ str?: string; transform?: number[] }>) });
      }
      const embeddedText = pages.map((page) => page.text).join("\n");
      if (embeddedText.replace(/\s/g, "").length > 80) {
        documents.push({ name: file.name, text: embeddedText });
        continue;
      }
      const recognizedPages: string[] = [];
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        onProgress(`Reconhecendo ${file.name} — página ${pageIndex + 1} de ${pages.length}`);
        const viewport = pages[pageIndex].page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error(`Não foi possível preparar a página ${pageIndex + 1} de ${file.name}.`);
        await pages[pageIndex].page.render({ canvas, canvasContext: context, viewport }).promise;
        recognizedPages.push(await recognize(canvas));
        canvas.width = 0;
        canvas.height = 0;
      }
      documents.push({ name: file.name, text: recognizedPages.join("\n") });
    }
    return documents;
  } finally {
    if (ocrWorker) await ocrWorker.terminate();
  }
}
