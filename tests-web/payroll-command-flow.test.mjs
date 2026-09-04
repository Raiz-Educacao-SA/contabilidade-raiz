import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../app/payroll-batch-reconciliation.tsx", import.meta.url), "utf8");
const drive = readFileSync(new URL("../app/api/payroll/drive/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/payroll-overrides.css", import.meta.url), "utf8");

test("a Conciliação Folha de Pagamento possui os três comandos operacionais", () => {
  assert.match(page, /Conciliação Folha de Pagamento/);
  assert.match(panel, /Atualizar TOTVS/);
  assert.match(panel, /Atualizar Drive/);
  assert.match(panel, /payroll-action-button is-primary[\s\S]*?Analisar/);
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
  assert.match(drive, /DEFAULT_FOLHA_ROOT_ID = "1A41TkfKUG3jsNu7Z8Eyq8tvu7qPo7GE7"/);
  assert.match(drive, /EXPECTED_ROOT_SEGMENTS = \["4\. CONTABIL", "2\. ROTINA", "2026", "02\. DOC_SUPORTE", "11\. FOLHA"\]/);
  assert.match(drive, /normalized\(folder\.name\) === `\$\{monthPrefix\} \$\{monthNames\[month - 1\]\}`/);
  assert.doesNotMatch(drive, /name contains/);
});

test("o painel da Folha mantém ações e finalização na mesma linha e compacta os três cards", () => {
  assert.match(css, /\.payroll-top-context \{[^}]*grid-template-columns: 210px minmax\(360px, 1fr\) auto auto;/s);
  assert.match(css, /\.payroll-top-context \.module-completion-control \{[^}]*margin-left: 0;[^}]*flex-wrap: nowrap;[^}]*justify-content: flex-end;/s);
  assert.match(css, /\.payroll-command-card \{[^}]*min-height: 68px;[^}]*padding: 8px 10px;/s);
  assert.match(panel, /title="Lote TOTVS"/);
  assert.match(panel, /title="Documentos no Drive"/);
  assert.match(panel, /title="Análise da folha"/);
});
