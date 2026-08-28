import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../app/api/totvs/pis-cofins/credits/leases/route.ts", import.meta.url),
  "utf8",
);

test("consulta Arrendamentos na visão oficial de lançamentos contábeis", () => {
  assert.match(route, /dataServerName: "CtbLanData"/);
  assert.match(route, /`DEBITO='\$\{LEASE_ACCOUNT\}'`/);
  assert.match(route, /"INTEGRAAPLICACAO='F'"/);
  assert.match(route, /CPARTIDA\.DATA >=/);
  assert.match(route, /CPARTIDA\.DATA <=/);
});

test("mantém apenas lançamentos de origem Financeiro e lê a conta a débito", () => {
  assert.match(route, /decodedTag\(record, "DEBITO"\)/);
  assert.match(route, /decodedTag\(record, "INTEGRAAPLICACAO"\) === "F"/);
  assert.match(route, /sourceSystem: "Financeiro"/);
  assert.doesNotMatch(route, /NOMESISTEMA/);
  assert.doesNotMatch(route, /RM Saldus/);
});

test("mantém a fonte contábil e valida no Financeiro somente fornecedor com CNPJ", () => {
  assert.match(route, /dataServerName: "FinLanDataBR"/);
  assert.match(route, /decodedTag\(record, "CGCCFO"\)/);
  assert.match(route, /isValidCnpj/);
  assert.match(route, /supplierDocument\.length === 11/);
  assert.match(route, /supplierDocumentType: "CNPJ"/);
});

test("considera todos os valores positivos lançados a débito na conta de Arrendamentos", () => {
  assert.match(route, /account === LEASE_ACCOUNT/);
  assert.match(route, /value > 0/);
  assert.doesNotMatch(route, /reduced === LEASE_REDUCED_CODE/);
});

test("elimina apenas a repetição da mesma partida contábil", () => {
  assert.match(route, /decodedTag\(record, "IDPARTIDA"\)/);
});
