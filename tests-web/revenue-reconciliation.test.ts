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
  INSTITUTIONAL_DISCOUNT_ACCOUNT,
  isRevenueAppropriation,
  isRevenueReversal,
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

test("identifica estorno somente quando o complemento começa com Estorno:", () => {
  assert.equal(
    isRevenueReversal(
      "Estorno: QI20011631 - ALUNO - Serviço: EM - Mensalidade - Parcela: 6/ Cota: 1",
    ),
    true,
  );
  assert.equal(isRevenueReversal("  ESTORNO : QI20011631 - ALUNO"), true);
  assert.equal(isRevenueReversal("Mensalidade - estorno solicitado"), false);
});

test("normaliza RA numérico sem alterar RA alfanumérico", () => {
  assert.equal(normalizeRevenueRa("1234567.0"), "1234567");
  assert.equal(normalizeRevenueRa("CA25034679"), "CA25034679");
});

test("compensa estornos antes de apurar receitas e descontos", () => {
  const summaries = summarizeAccountingRevenue([
    { ra: "123", name: "Aluno", value: -1_000, kind: "revenue" },
    { ra: "123", name: "Aluno", value: 100, kind: "revenue", complement: "ESTORNO" },
    { ra: "123", name: "Aluno", value: 200, kind: "discount" },
    { ra: "123", name: "Aluno", value: -20, kind: "discount", complement: "ESTORNO" },
  ]);

  assert.equal(summaries.get("123")?.revenue, 900);
  assert.equal(summaries.get("123")?.discount, 180);
  assert.deepEqual(summaries.get("123")?.complements, ["ESTORNO"]);
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

test("isola estornos da apuração e mantém uma aba separada", () => {
  const component = readFileSync(
    new URL("../app/revenue-reconciliation.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    component,
    /c\.filter\(\(entry\) => !isRevenueReversal\(entry\.complement\)\)/,
  );
  assert.match(
    component,
    /c\.filter\(\(entry\) => isRevenueReversal\(entry\.complement\)\)/,
  );
  assert.match(component, /Estornos desconsiderados/);
  assert.match(
    component,
    /não integram os totais nem a lista de divergências/,
  );
  assert.match(component, /"Estornos Desconsiderados"/);
});
