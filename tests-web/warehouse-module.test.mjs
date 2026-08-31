import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/warehouse-postings.tsx", import.meta.url), "utf8");
const completion = readFileSync(new URL("../lib/schedule-completion.ts", import.meta.url), "utf8");
const scheduleProgress = readFileSync(new URL("../lib/closing-schedule-progress.ts", import.meta.url), "utf8");

test("Almoxarifado fica abaixo de Rateio CSC e acima de Intercompany", () => {
  const menuStart = page.indexOf('<nav className="accounting-nav">');
  const menu = page.slice(menuStart, page.indexOf('{selectedModule === "book"', menuStart));
  assert.ok(menu.indexOf('label: "Rateio CSC"') < menu.indexOf('label: "Almoxarifado"'));
  assert.ok(menu.indexOf('label: "Almoxarifado"') < menu.indexOf('label: "Intercompany"'));
  assert.match(page, /accountingTab === "almoxarifado"[\s\S]*<WarehousePostings/);
});

test("painel importa Excel, apresenta prévia e gera Lançamentos em CSV", () => {
  assert.match(panel, /accept="\.xlsx,\.xls,\.xlsm"/);
  assert.match(panel, /parseWarehouseSheets/);
  assert.match(panel, /Selecionar Excel/);
  assert.match(panel, /> Lançamentos/);
  assert.match(panel, /coligada\$\{normalizedCompanyCode\.padStart\(2, "0"\)\}-almoxarifado\.csv/);
  assert.match(panel, /localStorage\.setItem\(cacheKey/);
  assert.match(panel, /Sem movimento nesta competência/);
  assert.match(panel, /a tarefa pode ser finalizada normalmente/);
  assert.match(panel, /Arquivo aceito/);
  assert.match(panel, /Sem lançamentos/);
  assert.match(panel, /fileName && result\.errors\.length === 0 && result\.postings\.length === 0/);
});

test("Almoxarifado alimenta o Cronograma por empresa", () => {
  assert.match(completion, /almoxarifado: "Almoxarifado"/);
  assert.match(scheduleProgress, /"rateio-csc",\s*"almoxarifado",\s*"intercompany"/);
  assert.match(page, /id: "almoxarifado", label: "Almoxarifado", description: "Importação do controle e geração dos lançamentos"/);
});
