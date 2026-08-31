import test from "node:test";
import assert from "node:assert/strict";
import { findHoldingAccountByCompanyName } from "../lib/intercompany-account-matcher.ts";

const accounts = [
  {
    account: "1.1.2.03.06.01",
    description: "QI Qualidade Integral de Ensino Ltda",
  },
  {
    account: "1.1.2.03.06.02",
    description: "Colégio e Curso Ao Cubo Ltda",
  },
  {
    account: "1.1.2.03.06.03",
    description: "Colégio QI Metropolitano S.A",
  },
];

test("localiza a conta de Almoxarifado pelo nome real da empresa", () => {
  assert.equal(
    findHoldingAccountByCompanyName(accounts, "1.1.2.03.06", {
      code: "02",
      name: "COLÉGIO QI",
    })?.account,
    "1.1.2.03.06.01",
  );
  assert.equal(
    findHoldingAccountByCompanyName(accounts, "1.1.2.03.06", {
      code: "05",
      name: "AO CUBO",
    })?.account,
    "1.1.2.03.06.02",
  );
  assert.equal(
    findHoldingAccountByCompanyName(accounts, "1.1.2.03.06", {
      code: "06",
      name: "METROPOLITANO",
    })?.account,
    "1.1.2.03.06.03",
  );
});

test("não usa o final da conta como código da coligada", () => {
  assert.equal(
    findHoldingAccountByCompanyName(accounts, "1.1.2.03.06", {
      code: "07",
      name: "EMPRESA SEM CONTA",
    }),
    undefined,
  );
});
