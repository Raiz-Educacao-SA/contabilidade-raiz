import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reconcilePayroll } from "../lib/payroll-reconciliation.ts";

const row = (account, credit, event = "", complement = "") => ({ account, description: "", event, complement, debit: 0, credit });

test("compõe o INSS sem 1162 e aplica os eventos 130 negativo e 131 positivo", () => {
  const rows = [
    row("2.1.2.01.03.01", 486321.35),
    row("2.1.4.01.02.02", 29649.10),
  ];
  const documents = [
    { name: "FolhaAnalitica_08.pdf", text: [
      "TOTAL GERAL",
      "0004 IRRF 46 0,00 26.478,72",
      "0030 IRRF FERIAS 7 0,00 3.170,38",
      "0130 INSS FERIAS REF. PROXIMO MES 29 0,00 1.004,33",
      "0131 INSS FERIAS DESC. MES ANT. 1 7,50 17,39 B",
    ].join("\n") },
    { name: "DCTFWEB.pdf", text: [
      "Total CONTRIBUIÇÃO PREVIDENCIÁRIA SEGURADOS 129.863,15 3.617,89 4.754,49 121.490,77",
      "Total CONTRIBUIÇÃO PREVIDENCIÁRIA PATRONAL 303.996,20 - - 303.996,20",
      "1162-01 CP PATRONAL - RETENÇÃO LEI 9.711/98 07/2026 1.221,00 - - 1.221,00",
      "Total CONTRIBUIÇÃO PARA OUTRAS ENTIDADES E FUNDOS 65.285,92 - - 65.285,92",
      "0561-07 IRRF 07/2026 29.914,97 - - 29.914,97",
    ].join("\n") },
    { name: "IRRF 062026 LOTE.xlsx", text: "COLIGADA,8,,,,,561,,588\nFILIAL INICIAL,0,,,,,30512.15,,941.58" },
    { name: "RELATORIO IRRF LOTE.xlsx", text: "COLIGADA,8,,,,,561,,588\nFILIAL INICIAL,0,,,,,26478.72,,391.36" },
  ];

  const analysis = reconcilePayroll(rows, "8072026", documents, new Map(), 1);
  assert.equal(analysis.inssMemory.payrollGuide, 489551.89);
  assert.equal(analysis.inssMemory.event130, 1004.33);
  assert.equal(analysis.inssMemory.event131, 17.39);
  assert.equal(analysis.inssMemory.adjustedGuide, 488564.95);
  assert.ok(Math.abs(analysis.inssMemory.difference - (-2243.60)) < 0.001);

  const irrf0588 = analysis.checks.find((item) => item.item === "IRRF 0588 — recolhimento");
  assert.equal(irrf0588?.lot, 941.58);
  assert.equal(irrf0588?.document, 0);
  assert.equal(irrf0588?.status, "PENDENTE");

  const irrf0561Lot = analysis.checks.find((item) => item.item === "IRRF 0561 — lançamento do lote");
  assert.ok(Math.abs((irrf0561Lot?.document ?? 0) - 29649.10) < 0.001);
  assert.equal(irrf0561Lot?.status, "OK");
});

test("mantém filtros de coligada e competência e exportação segregada", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../app/payroll-batch-reconciliation.tsx", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../lib/payroll-reconciliation.ts", import.meta.url), "utf8");
  assert.match(page, /Qual a coligada analisar\?/);
  assert.match(page, /competence=/);
  assert.match(panel, /CONFERÊNCIA DO LOTE DA FOLHA/);
  assert.match(panel, /Documento \/ contraparte/);
  assert.match(engine, /"INSS"/);
  assert.match(engine, /"IRRF"/);
});
