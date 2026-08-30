import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  accountingRevenueQueryAccounts,
  classifyAccountingRevenue,
  classifyRevenueReconciliation,
  COMMERCIAL_DISCOUNT_ACCOUNT,
  deduplicateAccountingRecords,
  DISCOUNT_ACCOUNT_DESCRIPTIONS,
  DISCOUNT_ACCOUNT_PREFIX,
  isExcludedRevenueGenerationType,
  INSTITUTIONAL_DISCOUNT_ACCOUNT,
  isRevenueAppropriation,
  normalizeRevenueRa,
  PAA_DISCOUNT_ACCOUNT,
  REVENUE_ACCOUNT_DESCRIPTIONS,
  REVENUE_ACCOUNT_PREFIX,
  summarizeAccountingRevenue,
} from "../lib/revenue-reconciliation.ts";

test("consulta receitas e todos os grupos contábeis de descontos", () => {
  assert.deepEqual(accountingRevenueQueryAccounts(), [
    REVENUE_ACCOUNT_PREFIX,
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

test("consolida receitas e descontos por RA", () => {
  const summaries = summarizeAccountingRevenue([
    { ra: "123", name: "Aluno", value: -1_000, kind: "revenue", generationType: "O" },
    { ra: "123", name: "Aluno", value: 100, kind: "revenue", complement: "AJUSTE", generationType: " O " },
    { ra: "123", name: "Aluno", value: 200, kind: "discount", generationType: "O" },
    { ra: "123", name: "Aluno", value: -20, kind: "discount", complement: "AJUSTE" },
  ]);

  assert.equal(summaries.get("123")?.revenue, 900);
  assert.equal(summaries.get("123")?.discount, 180);
  assert.deepEqual(summaries.get("123")?.complements, ["AJUSTE"]);
  assert.deepEqual(summaries.get("123")?.generationTypes, ["O"]);
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
    /\.revenue-content \.revenue-actions button \{[\s\S]*?width: auto;[\s\S]*?min-height: 32px;[\s\S]*?padding: 6px 12px;/,
  );
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
