import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../app/api/totvs/pis-cofins/other-revenues/route.ts", import.meta.url),
  "utf8",
);
const assessment = readFileSync(
  new URL("../app/pis-cofins-assessment.tsx", import.meta.url),
  "utf8",
);

test("inclui a conta 4.2.1.11.01.05 nas outras receitas financeiras", () => {
  assert.match(
    route,
    /account: "4\.2\.1\.11\.01\.05", description: "Outras Receitas Financeiras", group: "6\.4 - Outras Receitas Financeiras"/,
  );
});

test("classifica os grupos financeiros como não cumulativos", () => {
  assert.match(route, /rule\.group\.startsWith\("6\."\)/);
  assert.match(route, /classification: "Não-Cumulativo — Receita financeira"/);
});

test("segrega PIS e COFINS de receitas financeiras em partidas próprias no lote", () => {
  assert.match(assessment, /target\.financialRevenuePis \+= row\.pis/);
  assert.match(assessment, /target\.financialRevenueCofins \+= row\.cofins/);
  assert.match(
    assessment,
    /key: "financialRevenuePis" as const, debit: "4\.2\.1\.08\.01\.08", credit: "2\.1\.4\.01\.01\.02", history: "PIS S\/ OUTRAS RECEITAS NÃO CUMULATIVO - COD 6912 - N\/MÊS"/,
  );
  assert.match(
    assessment,
    /key: "financialRevenueCofins" as const, debit: "4\.2\.1\.08\.01\.09", credit: "2\.1\.4\.01\.01\.03", history: "COFINS S\/ OUTRAS RECEITAS NÃO CUMULATIVO - COD 5856 - N\/MÊS"/,
  );
});
