import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reconcilePayroll } from "../lib/payroll-reconciliation.ts";

const row = (account, credit, event = "", complement = "") => ({ account, description: "", event, complement, debit: 0, credit });

test("compõe o INSS sem 1162 e aplica os eventos 130 negativo e 131 positivo", () => {
  const rows = [
    row("2.1.2.01.03.01", 486321.35),
    row("2.1.4.01.02.02", 26478.72, "EV0004"),
    row("2.1.4.01.02.02", 3170.38, "EV0030"),
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

  const irrfPosting = analysis.checks.find((item) => item.item === "IRRF 0561 contabilizado x eventos do lote");
  assert.ok(Math.abs((irrfPosting?.document ?? 0) - 29649.10) < 0.001);
  assert.equal(irrfPosting?.account, "2.1.4.01.02.02");
  assert.equal(irrfPosting?.status, "OK");
});

test("confere FGTS pela conta passiva, IRRF pelos quatro eventos e líquido por EN0002 mais EN0020", () => {
  const rows = [
    row("2.1.2.01.01.01", 4331.20, "EN0002"),
    row("2.1.2.01.01.02", 100, "EN0020"),
    row("2.1.2.01.03.02", 1500, ""),
    row("2.1.4.01.02.03", 100, "EV0084"),
    row("2.1.4.01.02.02", 200, "EV0004"),
    row("2.1.4.01.02.02", 300, "EV0049"),
    row("2.1.4.01.02.02", 400, "EV0030"),
  ];
  const documents = [
    { name: "FolhaAnalitica.pdf", text: "Página 1\nLíquido 9.999,99\n\f\nPágina 2\nTotal de funcionários 1\n\f\nTOTAL GERAL\n1.990,22 Líquido 4.431,20\n0004 IRRF 999.999,99\n\f\nPágina 4\nTotal de funcionários 1" },
    { name: "Guia FGTS.pdf", text: "VALOR A RECOLHER 1.500,00" },
    { name: "Planilha IRRF - MENSAL.xlsx", text: [
      "0561 - Salarios",
      "CHAPA,NOME,MESCOMP,ANOCOMP,DTPAGTO,CODEVENTO,VALOR,CODFILIAL,CHAPA,NOME,MESCOMP,ANOCOMP,DTPAGTO,CODEVENTO,VALOR,CODFILIAL",
      "1,A,8,2026,9/1/26,4,200,1,,,,,,,,",
      "2,B,8,2026,9/1/26,49,300,1,,,,,,,,",
      "3,C,8,2026,9/1/26,30,400,1,4,D,8,2026,9/1/26,84,100,1",
    ].join("\n") },
  ];

  const analysis = reconcilePayroll(rows, "28082026", documents, new Map(), 1, "2026-08");
  const liquid = analysis.checks.find((item) => item.item === "Líquido da folha");
  assert.equal(liquid?.event, "EN0002 + EN0020");
  assert.equal(liquid?.lot, 4431.20);
  assert.equal(liquid?.document, 4431.20);
  assert.equal(liquid?.status, "OK");

  const fgts = analysis.checks.find((item) => item.item === "FGTS a recolher — lote x guias");
  assert.equal(fgts?.account, "2.1.2.01.03.02");
  assert.equal(fgts?.lot, 1500);
  assert.equal(fgts?.document, 1500);
  assert.equal(fgts?.status, "OK");

  const irrf0561 = analysis.checks.find((item) => item.item === "IRRF 0561 contabilizado x eventos do lote");
  assert.equal(irrf0561?.lot, 900);
  assert.equal(irrf0561?.document, 900);
  assert.equal(irrf0561?.status, "OK");
  assert.match(irrf0561?.event ?? "", /EV0004.*EV0049.*EV0030/);
  const irrf0588 = analysis.checks.find((item) => item.item === "IRRF 0588 contabilizado x evento do lote");
  assert.equal(irrf0588?.account, "2.1.4.01.02.03");
  assert.equal(irrf0588?.lot, 100);
  assert.equal(irrf0588?.document, 100);
  assert.equal(irrf0588?.status, "OK");
  assert.equal(analysis.checks.find((item) => item.item === "IRRF 0561 — provisão x planilha mensal")?.document, 900);
  assert.equal(analysis.checks.find((item) => item.item === "IRRF 0588 — provisão x planilha mensal")?.document, 100);
});

test("reconhece os totais previdenciários quando o OCR da DCTF perde partes dos títulos", () => {
  const rows = [row("2.1.2.01.03.01", 30531.03)];
  const documents = [
    { name: "FolhaAnalitica.pdf", text: "TOTAL GERAL\nProventos 94.022,70 Descontos 11.183,76 Líquido 82.838,94" },
    { name: "Guia DCTFWEB - mensal.pdf", text: [
      "de Rapos UIÇÃO PREVIDENCIÁRIA 8.093,1 6 67,54 8.025,62",
      "ESCASSO N DA |O PREVIDENCIÁRIA 18.576,66 - 18.576,66",
      "ENTIDADES FUNDOS 3.928,71 - 3.928,71",
    ].join("\n") },
  ];

  const analysis = reconcilePayroll(rows, "30082026", documents, new Map(), 1, "2026-08");
  assert.equal(analysis.inssMemory.insured, 8025.62);
  assert.equal(analysis.inssMemory.employer, 18576.66);
  assert.equal(analysis.inssMemory.otherEntities, 3928.71);
  assert.equal(analysis.inssMemory.adjustedGuide, 30530.99);
  assert.equal(analysis.checks.find((item) => item.item === "INSS ajustado x lote")?.status, "OK");
});

test("não soma provisões no FGTS e ignora histórico de IRRF fora da competência", () => {
  const rows = [row("2.1.2.01.03.02", 505.71)];
  const documents = [
    { name: "Guia FGTS - col 28.pdf", text: "GFD - Guia do FGTS Digital\nValor a recolher 505,71" },
    { name: "Guia DCTFWEB - col 28.pdf", text: "Período de Apuração: 08/2026\nTotal de débitos apurados 2.245,78\nNão há IRRF 0561 ou 0588 nesta guia" },
    { name: "Excel Férias.xlsx", text: "FGTS_MES,FGTS_BX\n900,100" },
    { name: "Excel 13º.xlsx", text: "FGTS_MES,FGTS_BX\n700,200" },
    { name: "Planilha IRRF - MENSAL.xlsx", text: [
      "0561 - Salarios",
      "CHAPA,NOME,MESCOMP,ANOCOMP,DTPAGTO,CODEVENTO,VALOR,CODFILIAL,CHAPA,NOME,MESCOMP,ANOCOMP,DTPAGTO,CODEVENTO,VALOR,CODFILIAL",
      ",,,,,,,,6300,Giovanna,11,2025,12/5/25,84,119.73,1",
      ",,,,,,,,6294,Marina,11,2025,12/5/25,84,11.81,6",
    ].join("\n") },
    { name: "Planilha IRRF - Mensal_07.2026.xlsx", text: [
      "0561 - Salarios",
      "CHAPA,NOME,MESCOMP,ANOCOMP,DTPAGTO,CODEVENTO,VALOR,CODFILIAL,CHAPA,NOME,MESCOMP,ANOCOMP,DTPAGTO,CODEVENTO,VALOR,CODFILIAL",
      ",,,,,,,,6300,Giovanna,11,2025,12/5/25,84,119.73,1",
      ",,,,,,,,6294,Marina,11,2025,12/5/25,84,11.81,6",
    ].join("\n") },
  ];
  const analysis = reconcilePayroll(rows, "28082026", documents, new Map(), 1, "2026-08");
  const fgts = analysis.checks.find((item) => item.item === "FGTS a recolher — lote x guias");
  assert.equal(fgts?.lot, 505.71);
  assert.equal(fgts?.document, 505.71);
  assert.equal(fgts?.status, "OK");
  const provision0561 = analysis.checks.find((item) => item.item === "IRRF 0561 — provisão x planilha mensal");
  const provision0588 = analysis.checks.find((item) => item.item === "IRRF 0588 — provisão x planilha mensal");
  assert.equal(provision0561?.lot, 0);
  assert.equal(provision0561?.document, 0);
  assert.equal(provision0561?.status, "OK");
  assert.equal(provision0588?.lot, 0);
  assert.equal(provision0588?.document, 0);
  assert.equal(provision0588?.status, "OK");
  const guide0561 = analysis.checks.find((item) => item.item === "IRRF 0561 — recolhimento");
  const guide0588 = analysis.checks.find((item) => item.item === "IRRF 0588 — recolhimento");
  assert.equal(guide0561?.lot, 0);
  assert.equal(guide0561?.document, 0);
  assert.equal(guide0561?.status, "OK");
  assert.equal(guide0588?.lot, 0);
  assert.equal(guide0588?.document, 0);
  assert.equal(guide0588?.status, "OK");
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
