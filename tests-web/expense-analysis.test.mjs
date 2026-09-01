import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const component = fs.readFileSync(new URL("../app/expense-analysis.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/totvs/expenses/route.ts", import.meta.url), "utf8");

test("Módulo Contábil renderiza a análise no item Despesas", () => {
  assert.match(page, /import ExpenseAnalysis/);
  assert.match(page, /accountingTab === "despesas"[\s\S]*?<ExpenseAnalysis/);
  assert.match(component, /Atualizar PlanilhaNet 08/);
  assert.match(component, /\/api\/totvs\/expenses/);
  assert.match(page, /accessToken=\{session\.access_token\}/);
});
test("análise aplica as regras aprovadas para agosto e ativos", () => {
  assert.match(component, /Divergência em comparação a meses anteriores/);
  assert.match(component, /Ativo Imobilizado/);
  assert.match(component, /LEFT|startsWith\("1\."\)/);
  assert.match(component, /DATASAIDA/);
  assert.match(component, /CODCOLIGADA/);
  assert.match(component, /DEBITO/);
});

test("atualização consulta o período em lotes mensais paralelos", () => {
  assert.match(route, /Promise\.all\(monthlyRanges/);
  assert.match(route, /monthCount > 12/);
  assert.match(component, /periodStart/);
  assert.match(component, /periodEnd/);
  assert.match(component, /Exportar Excel/);
  assert.match(component, /disabled=\{!analysis \|\| busy\}/);
  assert.match(component, /AbortSignal\.timeout\(120_000\)/);
  assert.match(page, /accountingTab === "despesas"/);
});

test("exportação segue o padrão contábil aprovado", () => {
  assert.match(component, /xlsx-js-style/);
  assert.match(component, /Análise de Despesa/);
  assert.match(component, /Lançamentos Contábeis/);
  assert.match(component, /Regras e Controles/);
  assert.match(component, /fileTitle\(companyName\)/);
  assert.match(component, /Calibri/);
});

test("identifica nova operação de fornecedor sem histórico anterior", () => {
  assert.match(component, /supplierPriorTotal/);
  assert.match(component, /Nova Operação Compra\/Serviço - Definir Conta Contábil/);
  assert.match(component, /supplierPriorTotal\.get\(row\.supplier\)/);
});

test("abre o ticket Zeev a partir do movimento mensal", () => {
  assert.match(component, /expense-movement-link/);
  assert.match(component, /Abrir NF no Zeev/);
  assert.match(component, /raizeducacao\.zeev\.it\/1\.0\/audit/);
  assert.match(component, /Ticket Zeev/);
});

test("detalhamento do valor mensal abre em janela visível", () => {
  assert.match(component, /expense-movement-modal/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /Tipo de movimento/);
  assert.match(component, /CODTMV/);
  assert.match(component, /Nenhum lançamento foi localizado/);
});

test("Excel conecta valores aos lançamentos e tickets ao Zeev", () => {
  assert.match(component, /movementRowByGroup/);
  assert.match(component, /#'Lançamentos Contábeis'!A/);
  assert.match(component, /Abrir movimentos e tickets/);
  assert.match(component, /Abrir nota fiscal no Zeev/);
  assert.match(component, /underline: true/);
});

test("Ticket Zeev ocupa a coluna B após IDMOV no Excel", () => {
  assert.match(component, /\["IDMOV", "Ticket Zeev", "Data saída"/);
  assert.match(component, /\{ r: index \+ 1, c: 1 \}/);
});
