import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../app/payroll-batch-reconciliation.tsx", import.meta.url), "utf8");
const drive = readFileSync(new URL("../app/api/payroll/drive/route.ts", import.meta.url), "utf8");
const documents = readFileSync(new URL("../app/api/payroll/documents/route.ts", import.meta.url), "utf8");
const browserDocuments = readFileSync(new URL("../lib/browser-document-extraction.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/payroll-overrides.css", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");

test("a Conciliação Folha de Pagamento possui os três comandos operacionais", () => {
  assert.match(page, /Conciliação Folha de Pagamento/);
  assert.match(panel, /Atualizar TOTVS/);
  assert.match(panel, /Selecionar pasta/);
  assert.match(panel, /payroll-action-button is-primary[\s\S]*?Analisar/);
  assert.match(panel, /CONFERÊNCIA DO LOTE DA FOLHA/);
  assert.match(panel, /Documento \/ contraparte/);
  assert.match(panel, /Exportar documentação da análise/);
});

test("a leitura do Drive filtra coligada, competência e arquivos de análise anteriores", () => {
  assert.match(drive, /authorizedCompanies/);
  assert.match(drive, /00 - ANTERIORES/);
  assert.match(drive, /CONFERENCIA\.\*LOTE\|ANALISE DE FOLHA/);
  assert.match(drive, /application\/vnd\.google-apps\.folder/);
  assert.match(drive, /DEFAULT_FOLHA_ROOT_ID = "1A41TkfKUG3jsNu7Z8Eyq8tvu7qPo7GE7"/);
  assert.match(drive, /normalized\(folhaRoot\.name\) !== "11\. FOLHA"/);
  assert.match(drive, /conta técnica do sistema ainda não possui acesso à pasta 11\. FOLHA/);
  assert.match(drive, /normalized\(folder\.name\) === `\$\{monthPrefix\} \$\{monthNames\[month - 1\]\}`/);
  assert.doesNotMatch(drive, /name contains/);
});

test("permite selecionar a pasta sincronizada sem depender das credenciais do Drive na Vercel", () => {
  assert.match(panel, /showDirectoryPicker/);
  assert.match(panel, /collectLocalFiles/);
  assert.match(panel, /Pasta local sincronizada/);
  assert.match(panel, /Chrome ou Microsoft Edge atualizado/);
  assert.match(panel, /CONFERENCIA\.\*LOTE\|ANALISE DE FOLHA/);
  assert.match(panel, /extractVisualDocumentsInBrowser\(visualFiles, setAnalysisProgress\)/);
  assert.match(panel, /parseProvisionData/);
  assert.match(panel, /Saldos das provisões/);
  assert.doesNotMatch(panel, /\.\.\.checkRows\("Saldos das provisões"\)/);
  assert.doesNotMatch(panel, /fetch\("\/api\/payroll\/documents"/);
  assert.match(browserDocuments, /document\.createElement\("canvas"\)/);
  assert.match(browserDocuments, /createWorker\("por"\)/);
  assert.match(browserDocuments, /Lendo \$\{fileIndex \+ 1\} de \$\{files\.length\}/);
});

test("prepara o runtime gráfico do Node antes de converter PDFs digitalizados", () => {
  assert.match(documents, /import\("@napi-rs\/canvas"\)/);
  assert.match(documents, /runtime\.DOMMatrix \?\?= canvas\.DOMMatrix/);
  assert.ok(documents.indexOf("await preparePdfRuntime();") < documents.indexOf('await import("pdf-to-img")'));
  assert.match(nextConfig, /serverExternalPackages: \[[^\]]*"pdfjs-dist"/);
  assert.match(nextConfig, /pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs/);
  assert.match(nextConfig, /pdfjs-dist\/standard_fonts\/\*\*\/\*/);
});

test("o painel da Folha mantém ações e finalização na mesma linha e compacta os três cards", () => {
  assert.match(css, /\.payroll-top-context \{[^}]*grid-template-columns: 210px minmax\(360px, 1fr\) auto auto;/s);
  assert.match(css, /\.payroll-top-context \.module-completion-control \{[^}]*margin-left: 0;[^}]*flex-wrap: nowrap;[^}]*justify-content: flex-end;/s);
  assert.match(css, /\.payroll-command-card \{[^}]*min-height: 68px;[^}]*padding: 8px 10px;/s);
  assert.match(panel, /title="Lote TOTVS"/);
  assert.match(panel, /title="Pasta da Folha"/);
  assert.match(panel, /title="Análise da folha"/);
});
