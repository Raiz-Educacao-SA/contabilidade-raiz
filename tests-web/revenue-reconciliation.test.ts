import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import XLSX from "xlsx-js-style";

import {
  applyRevenueWorkbookStyle,
  compactRevenueBar,
} from "../lib/revenue-export-workbook.ts";

import {
  accountingRevenueQueryAccounts,
  classifyAccountingRevenue,
  classifyRevenueDivergence,
  classifyRevenueReconciliation,
  COMMERCIAL_DISCOUNT_ACCOUNT,
  consolidateFiscalRevenueRows,
  deduplicateAccountingRecords,
  DISCOUNT_ACCOUNT_DESCRIPTIONS,
  DISCOUNT_ACCOUNT_PREFIX,
  EXTRA_REVENUE_ACCOUNTS,
  EXTENDED_HOURS_REVENUE_ACCOUNT,
  isExcludedRevenueGenerationType,
  isExtraRevenueAccount,
  INSTITUTIONAL_DISCOUNT_ACCOUNT,
  isRevenueAppropriation,
  isValidRevenueRa,
  normalizeRevenueRa,
  OTHER_STUDENT_REVENUE_ACCOUNT,
  PAA_DISCOUNT_ACCOUNT,
  REVENUE_ACCOUNT_DESCRIPTIONS,
  REVENUE_ACCOUNT_PREFIX,
  revenueReconciliationExportFileName,
  summarizeAccountingRevenue,
} from "../lib/revenue-reconciliation.ts";
import { revenueReconciliationCacheKey } from "../lib/revenue-reconciliation-cache.ts";

test("consulta receitas e todos os grupos contábeis de descontos", () => {
  assert.deepEqual(accountingRevenueQueryAccounts(), [
    REVENUE_ACCOUNT_PREFIX,
    EXTENDED_HOURS_REVENUE_ACCOUNT,
    OTHER_STUDENT_REVENUE_ACCOUNT,
    COMMERCIAL_DISCOUNT_ACCOUNT,
    DISCOUNT_ACCOUNT_PREFIX,
  ]);
  assert.ok(INSTITUTIONAL_DISCOUNT_ACCOUNT.startsWith(DISCOUNT_ACCOUNT_PREFIX));
  assert.ok(PAA_DISCOUNT_ACCOUNT.startsWith(DISCOUNT_ACCOUNT_PREFIX));
});

test("classifica todas as receitas previstas na diretriz funcional", () => {
  REVENUE_ACCOUNT_DESCRIPTIONS.forEach((description) => {
    assert.equal(
      classifyAccountingRevenue(`${REVENUE_ACCOUNT_PREFIX}.99`, description),
      "revenue",
      description,
    );
  });

  [
    "Horario Integral (Estentido)",
    "Horário Integral (Estendido)",
    "Horário Estendido",
  ].forEach((description) => {
    assert.equal(
      classifyAccountingRevenue(EXTENDED_HOURS_REVENUE_ACCOUNT, description),
      "revenue",
      description,
    );
  });
  assert.equal(
    classifyAccountingRevenue(
      OTHER_STUDENT_REVENUE_ACCOUNT,
      "Outras Receitas de Alunos",
    ),
    "revenue",
  );
});

test("classifica todas as bolsas e descontos previstos na diretriz funcional", () => {
  DISCOUNT_ACCOUNT_DESCRIPTIONS.forEach((description) => {
    assert.equal(
      classifyAccountingRevenue(`${DISCOUNT_ACCOUNT_PREFIX}.99`, description),
      "discount",
      description,
    );
  });
  assert.equal(
    classifyAccountingRevenue(
      COMMERCIAL_DISCOUNT_ACCOUNT,
      "Desconto Comercial s/ Mensalidades",
    ),
    "discount",
  );
  assert.equal(
    classifyAccountingRevenue(INSTITUTIONAL_DISCOUNT_ACCOUNT, "Bolsas Institucionais"),
    "discount",
  );
  assert.equal(
    classifyAccountingRevenue(PAA_DISCOUNT_ACCOUNT, "Bolsas PAA"),
    "discount",
  );
});

test("normaliza acentos e espaços, sem incluir descrições fora da diretriz", () => {
  assert.equal(
    classifyAccountingRevenue(
      `${REVENUE_ACCOUNT_PREFIX}.04`,
      "  Mensalidade   Educação   Infantil  ",
    ),
    "revenue",
  );
  assert.equal(
    classifyAccountingRevenue(`${DISCOUNT_ACCOUNT_PREFIX}.99`, "Bolsa não parametrizada"),
    "other",
  );
  assert.equal(
    classifyAccountingRevenue("1.1.2.01.01.23", "Contas a Receber"),
    "other",
  );
  assert.equal(
    classifyAccountingRevenue(
      "9.9.9.99.99.99",
      "Desconto Comercial s/ Mensalidades",
    ),
    "other",
  );
});

test("remove apropriação de receita mesmo com variação de acento e espaços", () => {
  assert.equal(isRevenueAppropriation(" APROPRIAÇÃO   RECEITA "), true);
  assert.equal(isRevenueAppropriation("APROPRIACAO RECEITA"), true);
  assert.equal(isRevenueAppropriation("MENSALIDADE"), false);
});

test("mantém O e segrega os tipos de geração I e E", () => {
  assert.equal(isExcludedRevenueGenerationType("E"), true);
  assert.equal(isExcludedRevenueGenerationType("  e  "), true);
  assert.equal(isExcludedRevenueGenerationType("I"), true);
  assert.equal(isExcludedRevenueGenerationType(" i "), true);
  assert.equal(isExcludedRevenueGenerationType("O"), false);
  assert.equal(isExcludedRevenueGenerationType("   "), false);
  assert.equal(isExcludedRevenueGenerationType(undefined), false);
});

test("normaliza RA numérico sem alterar RA alfanumérico", () => {
  assert.equal(normalizeRevenueRa("1234567.0"), "1234567");
  assert.equal(normalizeRevenueRa("CA25034679"), "CA25034679");
});

test("aceita RA alfanumérico da Global Tree sem aceitar textos comuns", () => {
  assert.equal(isValidRevenueRa("9GT24004401"), true);
  assert.equal(isValidRevenueRa("CA25034679"), true);
  assert.equal(isValidRevenueRa("1234567.0"), true);
  assert.equal(isValidRevenueRa("ALUNO"), false);
  assert.equal(isValidRevenueRa("9GT 24004401"), false);
});

test("não duplica o código da empresa no nome do arquivo exportado", () => {
  assert.equal(
    revenueReconciliationExportFileName(
      "18",
      "18 — REDE DE ENSINO APOGEU LTDA",
      "07/2026",
    ),
    "18_REDE_DE_ENSINO_APOGEU_LTDA_Faturamento_VS_Educacional_07.2026.xlsx",
  );
  assert.equal(
    revenueReconciliationExportFileName("2", "02 — COLÉGIO QI", "07/2026"),
    "02_COLÉGIO_QI_Faturamento_VS_Educacional_07.2026.xlsx",
  );
});

test("consolida receitas e descontos por RA", () => {
  const summaries = summarizeAccountingRevenue([
    { ra: "123", name: "Aluno", value: -1_000, kind: "revenue", generationType: "O", account: REVENUE_ACCOUNT_PREFIX },
    { ra: "123", name: "Aluno", value: 100, kind: "revenue", complement: "AJUSTE", generationType: " O " },
    { ra: "123", name: "Aluno", value: -50, kind: "revenue", account: EXTENDED_HOURS_REVENUE_ACCOUNT },
    { ra: "123", name: "Aluno", value: -25, kind: "revenue", account: OTHER_STUDENT_REVENUE_ACCOUNT },
    { ra: "123", name: "Aluno", value: 200, kind: "discount", generationType: "O" },
    { ra: "123", name: "Aluno", value: -20, kind: "discount", complement: "AJUSTE" },
  ]);

  assert.equal(summaries.get("123")?.revenue, 975);
  assert.equal(summaries.get("123")?.extraRevenue, 75);
  assert.deepEqual(
    summaries.get("123")?.extraRevenueAccounts,
    EXTRA_REVENUE_ACCOUNTS,
  );
  assert.equal(summaries.get("123")?.discount, 180);
  assert.deepEqual(summaries.get("123")?.complements, ["AJUSTE"]);
  assert.deepEqual(summaries.get("123")?.generationTypes, ["O"]);
});

test("classifica como Receitas extras independentemente da soma da diferença", () => {
  assert.equal(isExtraRevenueAccount(EXTENDED_HOURS_REVENUE_ACCOUNT), true);
  assert.equal(isExtraRevenueAccount(OTHER_STUDENT_REVENUE_ACCOUNT), true);
  assert.equal(isExtraRevenueAccount(REVENUE_ACCOUNT_PREFIX), false);
  assert.equal(
    classifyRevenueDivergence({
      status: "Divergente",
      revenueDifference: 806,
      discountDifference: 0,
      extraRevenue: 806,
    }),
    "Receitas extras",
  );
  assert.equal(
    classifyRevenueDivergence({
      status: "Divergente",
      revenueDifference: -806,
      discountDifference: 0.01,
      extraRevenue: 806,
    }),
    "Receitas extras",
  );
  assert.equal(
    classifyRevenueDivergence({
      status: "Divergente",
      revenueDifference: 900,
      discountDifference: 0,
      extraRevenue: 806,
    }),
    "Receitas extras",
  );
  assert.equal(
    classifyRevenueDivergence({
      status: "Divergente",
      revenueDifference: 806,
      discountDifference: 0,
      extraRevenue: 1_612,
    }),
    "Receitas extras",
  );
  assert.equal(
    classifyRevenueDivergence({
      status: "Conciliado",
      revenueDifference: 0,
      discountDifference: 0,
      extraRevenue: 806,
    }),
    "Receitas extras",
  );
  assert.equal(
    classifyRevenueDivergence({
      status: "Divergente",
      revenueDifference: 806,
      discountDifference: 10,
      extraRevenue: 806,
    }),
    "",
  );
});

test("isola receitas extras da lista de divergências e da comparação exportada", () => {
  const component = readFileSync(
    new URL("../app/revenue-reconciliation.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /activeView === "extraRevenue"/);
  assert.match(component, /"Receitas Extras"/);
  assert.match(
    component,
    /row\.status !== "Conciliado" && !row\.classification/,
  );
  assert.match(component, /comparableAccountingRevenue/);
  assert.match(component, /independentemente da soma/);
  assert.match(component, /Estes valores não\s+compõem as inconsistências/);
});

test("prioriza receita AUTORIZADA e mantém todos os descontos fiscais", () => {
  const rows = consolidateFiscalRevenueRows([
    {
      id: "1",
      ra: "2012558363",
      name: "Aluno",
      status: "NÃO ENVIADA",
      originalValue: 511.06,
      discount: 100,
    },
    {
      id: "2",
      ra: "2012558363",
      name: "Aluno",
      status: "AUTORIZADA",
      originalValue: 2164.3,
      discount: 332.86,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "AUTORIZADA");
  assert.equal(rows[0].originalValue, 2164.3);
  assert.equal(rows[0].discount, 432.86);
});

test("mantém os registros fiscais disponíveis quando não há AUTORIZADA", () => {
  const rows = consolidateFiscalRevenueRows([
    {
      id: "1",
      ra: "9GT24004401",
      name: "Aluno A",
      status: "NÃO ENVIADA",
      originalValue: 2000,
      discount: 200,
    },
    {
      id: "2",
      ra: "9GT24004401",
      name: "Aluno A",
      status: "NÃO ENVIADA",
      originalValue: 500,
      discount: 50,
    },
    {
      id: "3",
      ra: "OUTRO123",
      name: "Aluno B",
      status: "NÃO ENVIADA",
      originalValue: 1000,
      discount: 0,
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.ra === "9GT24004401")?.originalValue, 2500);
  assert.equal(rows.find((row) => row.ra === "9GT24004401")?.discount, 250);
});

test("aplica a classificação e a tolerância da diretriz", () => {
  assert.equal(
    classifyRevenueReconciliation({
      fiscalRevenue: 100,
      accountingRevenue: 100.01,
      fiscalDiscount: 10,
      accountingDiscount: 10,
    }),
    "Conciliado",
  );
  assert.equal(
    classifyRevenueReconciliation({
      fiscalRevenue: 100,
      accountingRevenue: 0,
      fiscalDiscount: 0,
      accountingDiscount: 0,
    }),
    "Só no Fiscal",
  );
  assert.equal(
    classifyRevenueReconciliation({
      fiscalRevenue: 0,
      accountingRevenue: 100,
      fiscalDiscount: 0,
      accountingDiscount: 0,
    }),
    "Só no Contábil",
  );
});

test("não duplica a mesma partida retornada pelas consultas", () => {
  assert.deepEqual(
    deduplicateAccountingRecords([
      "<Resultado>1</Resultado>",
      "<Resultado>1</Resultado>",
    ]),
    ["<Resultado>1</Resultado>"],
  );
});

test("mantém os filtros e a finalização na mesma linha em telas de trabalho", () => {
  const css = readFileSync(
    new URL("../app/modules.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /@media \(max-width: 1050px\) \{\s*\.revenue-content \.top-context \{\s*flex-wrap: wrap;/,
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width: 1450px\) \{\s*\.revenue-content \.top-context/,
  );
});

test("mantém compactos os botões da conciliação de receita", () => {
  const css = readFileSync(
    new URL("../app/modules.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\.revenue-content \.revenue-actions \{[\s\S]*?width: auto;[\s\S]*?display: flex;/,
  );
  assert.match(
    css,
    /\.revenue-content \.revenue-actions button \{[\s\S]*?width: auto;[\s\S]*?min-height: 28px;[\s\S]*?padding: 4px 8px;/,
  );
  assert.match(
    css,
    /\.revenue-content \.revenue-status \{[\s\S]*?grid-template-columns: minmax\(125px, 1fr\)[\s\S]*?minmax\(220px, 1\.35fr\)/,
  );
});

test("isola a conciliação por empresa e competência", () => {
  assert.equal(
    revenueReconciliationCacheKey("5", "2026-07"),
    "revenue-reconciliation:05:2026-07",
  );

  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../app/revenue-reconciliation.tsx", import.meta.url), "utf8");
  const completion = readFileSync(new URL("../app/module-completion-control.tsx", import.meta.url), "utf8");
  assert.match(page, /<RevenueReconciliation\s+key=\{`\$\{companyId\}-\$\{competence\}`\}/);
  assert.match(panel, /readRevenueReconciliationCache<RevenueCacheSnapshot>\(cacheKey\)/);
  assert.match(panel, /completion\?\.status === "concluido"/);
  assert.match(completion, /MODULE_COMPLETION_CHANGED_EVENT/);
});

test("colore somente a primeira linha e preserva formatos numéricos no Excel", () => {
  const workbook = XLSX.utils.book_new();
  const dashboard = XLSX.utils.aoa_to_sheet([
    ["TÍTULO", ""],
    ["Quantidade", 293],
    ["Percentual", 0.166],
  ]);
  const details = XLSX.utils.aoa_to_sheet([
    ["RA", "Valor"],
    ["011153329", 4012],
  ]);
  dashboard.B2.z = "#,##0";
  dashboard.B3.z = "0.0%";
  XLSX.utils.book_append_sheet(workbook, dashboard, "Dashboard");
  XLSX.utils.book_append_sheet(workbook, details, "Divergências");

  applyRevenueWorkbookStyle(workbook);

  const dashboardTitle = dashboard.A1 as XLSX.CellObject & { s?: { fill?: { fgColor?: { rgb?: string } } } };
  const dashboardData = dashboard.A2 as XLSX.CellObject & { s?: { fill?: unknown } };
  const detailsTitle = details.A1 as XLSX.CellObject & { s?: { fill?: { fgColor?: { rgb?: string } } } };
  const detailsData = details.A2 as XLSX.CellObject & { s?: { fill?: unknown } };

  assert.equal(dashboardTitle.s?.fill?.fgColor?.rgb, "14213D");
  assert.equal(detailsTitle.s?.fill?.fgColor?.rgb, "14213D");
  assert.equal(dashboardData.s?.fill, undefined);
  assert.equal(detailsData.s?.fill, undefined);
  assert.equal(dashboard.B2.z, "#,##0");
  assert.equal(dashboard.B3.z, "0.0%");
});

test("gera barra compacta legível sem caracteres de erro do Excel", () => {
  const bar = compactRevenueBar(82.8);
  assert.match(bar, /82,8%$/);
  assert.doesNotMatch(bar, /#/);
  assert.equal(bar.length, 26);
});

test("remove a coluna Visual do dashboard exportado", () => {
  const panel = readFileSync(
    new URL("../app/revenue-reconciliation.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(panel, /"% sobre total", "Visual"/);
  assert.doesNotMatch(panel, /compactRevenueBar\(/);
});

test("exibe uma barra compacta com o percentual conciliado somente na tela", () => {
  const panel = readFileSync(
    new URL("../app/revenue-reconciliation.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../app/modules.css", import.meta.url),
    "utf8",
  );

  assert.match(panel, /className="revenue-progress"/);
  assert.match(panel, /role="progressbar"/);
  assert.match(panel, /Math\.min\(100, Math\.max\(0, reconciledPercentage\)\)/);
  assert.match(css, /\.revenue-content \.revenue-progress \{[\s\S]*?height: 4px;/);
});

test("não usa o histórico Estorno como regra de segregação", () => {
  const route = readFileSync(
    new URL("../app/api/totvs/revenue-reconciliation/route.ts", import.meta.url),
    "utf8",
  );
  const component = readFileSync(
    new URL("../app/revenue-reconciliation.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(route, /isRevenueReversal/);
  assert.doesNotMatch(component, /isRevenueReversal/);
  assert.doesNotMatch(component, /Estornos desconsiderados/);
  assert.doesNotMatch(component, /"Estornos Desconsiderados"/);
});

test("transporta e segrega o tipo de geração contábil da classificação", () => {
  const route = readFileSync(
    new URL("../app/api/totvs/revenue-reconciliation/route.ts", import.meta.url),
    "utf8",
  );
  const component = readFileSync(
    new URL("../app/revenue-reconciliation.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /readTag\(record, "TIPOGERACAO"\)/);
  assert.match(route, /generationType,/);
  assert.match(component, /Tipo de geração/);
  assert.match(
    component,
    /isExcludedRevenueGenerationType\(entry\.generationType\)/,
  );
  assert.match(component, /Tipos de geração I\/E desconsiderados/);
  assert.match(component, /TIPOGERACAO I ou E ficam fora dos totais/);
  assert.match(component, /"Tipos I e E Isolados"/);
});
