import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/warehouse-postings.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/modules.css", import.meta.url), "utf8");
const completion = readFileSync(new URL("../lib/schedule-completion.ts", import.meta.url), "utf8");
const scheduleProgress = readFileSync(new URL("../lib/closing-schedule-progress.ts", import.meta.url), "utf8");
const sharedLotsMigration = readFileSync(new URL("../Supabase/20260904_almoxarifado_lotes.sql", import.meta.url), "utf8");

test("Almoxarifado fica abaixo de Rateio CSC e acima de Intercompany", () => {
  const menuStart = page.indexOf('<nav className="accounting-nav">');
  const menu = page.slice(menuStart, page.indexOf('{selectedModule === "book"', menuStart));
  assert.ok(menu.indexOf('label: "Rateio CSC"') < menu.indexOf('label: "Almoxarifado"'));
  assert.ok(menu.indexOf('label: "Almoxarifado"') < menu.indexOf('label: "Intercompany"'));
  assert.match(page, /accountingTab === "almoxarifado"[\s\S]*<WarehousePostings/);
});

test("painel importa Excel, separa todas as empresas e gera um CSV por empresa", () => {
  assert.match(panel, /accept="\.xlsx,\.xls,\.xlsm"/);
  assert.match(panel, /parseWarehouseSheetsForAllCompanies/);
  assert.match(panel, /Selecionar Excel/);
  assert.match(panel, /isFinalized \? "Extrair lote" : "Lançamentos"/);
  assert.match(panel, /companyGroups\.map/);
  assert.match(panel, /exportCompanyPostings\(group\)/);
  assert.match(panel, /coligada\$\{group\.code\.padStart\(2, "0"\)\}-almoxarifado\.csv/);
  assert.match(panel, /localStorage\.setItem\(cacheKey/);
  assert.match(panel, /Sem movimento nesta competência/);
  assert.match(panel, /a tarefa pode ser finalizada normalmente/);
  assert.match(panel, /Arquivo aceito/);
  assert.match(panel, /Sem lançamentos/);
  assert.match(panel, /fileName && result\.errors\.length === 0 && result\.postings\.length === 0/);
});

test("mantém o texto da tabela de Almoxarifado compacto", () => {
  assert.match(styles, /\.warehouse-table table\s*\{[^}]*font-size:\s*11px/s);
});

test("arquivo fica fixado após o fechamento, mantendo a extração por empresa", () => {
  assert.match(panel, /isFinalized \? "Arquivo fixado"/);
  assert.match(panel, /disabled=\{loading \|\| isFinalized\}/);
  assert.match(panel, /disabled=\{!fileName \|\| loading \|\| isFinalized\}/);
  assert.match(panel, /className="primary warehouse-company-export"/);
  assert.match(panel, /from\("almoxarifado_lotes"\)\.upsert/);
  assert.match(panel, /from\("almoxarifado_lotes"\)\s*\.select\("arquivo_nome, resultado"\)/);
  assert.match(sharedLotsMigration, /lotes almoxarifado leitura autenticada/);
  assert.match(sharedLotsMigration, /to authenticated\s+using \(true\)/);
  assert.match(page, /onStatusChange=\{selectedModule === "contabil" && accountingTab === "almoxarifado" \? setWarehouseFinalized : undefined\}/);
  assert.match(page, /Importe e valide o controle do Almoxarifado antes de finalizar/);
  assert.match(panel, /onReadyChange\(Boolean\(fileName && result\.errors\.length === 0 && !sharingError\)\)/);
});

test("Almoxarifado alimenta o Cronograma por empresa", () => {
  assert.match(completion, /almoxarifado: "Almoxarifado"/);
  assert.match(scheduleProgress, /"rateio-csc",\s*"almoxarifado",\s*"intercompany"/);
  assert.match(page, /id: "almoxarifado", label: "Almoxarifado", description: "Importação do controle e geração dos lançamentos"/);
  assert.match(page, /warehouseItems\.slice\(1\)/);
});
