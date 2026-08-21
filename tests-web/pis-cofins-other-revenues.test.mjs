import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../app/api/totvs/pis-cofins/other-revenues/route.ts", import.meta.url),
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
