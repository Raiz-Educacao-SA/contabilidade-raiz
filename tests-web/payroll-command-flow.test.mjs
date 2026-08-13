import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../app/payroll-batch-reconciliation.tsx", import.meta.url), "utf8");
const drive = readFileSync(new URL("../app/api/payroll/drive/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("a Conciliação Folha de Pagamento possui os três comandos operacionais", () => {
  assert.match(page, /Conciliação Folha de Pagamento/);
  assert.match(panel, /1\. Ler lote no TOTVS/);
  assert.match(panel, /2\. Ler documentos no Drive/);
  assert.match(panel, /3\. Executar análise/);
  assert.match(panel, /CONFERÊNCIA DO LOTE DA FOLHA/);
  assert.match(panel, /Documento \/ contraparte/);
  assert.match(panel, /Exportar documentação da análise/);
});

test("a leitura do Drive filtra coligada, competência e arquivos de análise anteriores", () => {
  assert.match(drive, /authorizedCompanies/);
  assert.match(drive, /GOOGLE_DRIVE_FOLHA_FOLDER_ID/);
  assert.match(drive, /00 - ANTERIORES/);
  assert.match(drive, /CONFERENCIA\.\*LOTE\|ANALISE DE FOLHA/);
  assert.match(drive, /application\/vnd\.google-apps\.folder/);
});
