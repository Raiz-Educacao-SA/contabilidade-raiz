import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/book-accounting.tsx", import.meta.url), "utf8");

test("Book Contábil expõe o menu Relatórios Base", () => {
  assert.match(page, /Relatórios Base/);
  assert.match(page, /label: "Balancete"/);
  assert.match(page, /label: "Razão"/);
  assert.match(page, /label: "Plano de Contas"/);
  assert.match(page, /report=\{bookReport\}/);
});

test("painel mantém o balancete e prepara Razão e Plano de Contas", () => {
  assert.match(panel, /report === "razao"/);
  assert.match(panel, /report === "plano-contas"/);
  assert.match(panel, /\/api\/totvs\/trial-balance/);
});

test("Módulo Contábil expõe a área Receita por Filial", () => {
  assert.match(page, /"receita-filial"/);
  assert.match(page, /label: "Receita por Filial"/);
  assert.match(page, /accountingTab === "receita-filial"/);
  assert.match(page, /<h2>[\s\S]*?"Receita por Filial"/);
  assert.match(page, /label: "Arrendamentos"[\s\S]*label: "Receita por Filial"[\s\S]*label: "Lotes a integrar"[\s\S]*label: "Análise Balancete"/);
});
