import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWarehousePostingsCsv,
  parseWarehouseSheets,
} from "../lib/warehouse-postings.ts";

test("segrega os lançamentos das coligadas por filial com as contas fixas", () => {
  const result = parseWarehouseSheets([
    {
      name: "Controle",
      rows: [
        ["Coligada", "Filial", "Valor"],
        ["05", "02", "3.262,28"],
        ["05", "05", 598.23],
        ["05", "02", 100],
        ["06", "01", 999],
      ],
    },
  ], { selectedCompanyCode: "05", selectedCompanyName: "05 — AO CUBO" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.sourceRows, 3);
  assert.equal(result.postings.length, 2);
  assert.deepEqual(result.postings.map((posting) => ({
    branch: posting.branchCode,
    debit: posting.debitAccount,
    debitReduced: posting.debitReduced,
    credit: posting.creditAccount,
    creditReduced: posting.creditReduced,
    value: posting.amount,
    history: posting.history,
  })), [
    {
      branch: "2",
      debit: "4.2.1.03.01.20",
      debitReduced: "2404",
      credit: "2.1.7.01.02.15",
      creditReduced: "2403",
      value: 3362.28,
      history: "CONSUMO MATERIAL DE ALMOXARIFADO - N/MÊS",
    },
    {
      branch: "5",
      debit: "4.2.1.03.01.20",
      debitReduced: "2404",
      credit: "2.1.7.01.02.15",
      creditReduced: "2403",
      value: 598.23,
      history: "CONSUMO MATERIAL DE ALMOXARIFADO - N/MÊS",
    },
  ]);
});

test("na Raiz usa filial 01, débito por destino e crédito fixo", () => {
  const result = parseWarehouseSheets([
    {
      name: "Raiz",
      rows: [
        ["Empresa", "Filial", "Valor Total"],
        ["Global Tree", "09", 7_299.36],
        ["Creche IPE", "05", 200],
        ["02 — COLÉGIO QI", "02", 18_639.87],
      ],
    },
  ], { selectedCompanyCode: "01", selectedCompanyName: "01 — RAIZ EDUCAÇÃO" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.postings.length, 2);
  const globalTree = result.postings.find((posting) => posting.destinationCode === "9");
  assert.ok(globalTree);
  assert.equal(globalTree.branchCode, "1");
  assert.equal(globalTree.debitAccount, "1.1.2.03.06.05");
  assert.equal(globalTree.debitReduced, "2830");
  assert.equal(globalTree.creditAccount, "1.1.5.01.01.05");
  assert.equal(globalTree.creditReduced, "2401");
  assert.equal(globalTree.amount, 7499.36);
  assert.equal(globalTree.history, "CONSUMO ALMOXARIFADO RAIZ X GLOBAL TREE N/MÊS");
});

test("bloqueia empresa da Raiz sem conta cadastrada", () => {
  const result = parseWarehouseSheets([
    { name: "Raiz", rows: [["Empresa destino", "Valor"], ["Empresa desconhecida", 100]] },
  ], { selectedCompanyCode: "1", selectedCompanyName: "RAIZ EDUCAÇÃO" });

  assert.equal(result.postings.length, 0);
  assert.match(result.errors.join(" "), /sem conta de Almoxarifado cadastrada/);
});

test("gera o CSV padrão TOTVS com o último dia real da competência", () => {
  const parsed = parseWarehouseSheets([
    { name: "Controle", rows: [["Filial", "Valor"], ["01", 1234.56]] },
  ], { selectedCompanyCode: "05", selectedCompanyName: "AO CUBO" });
  const csv = buildWarehousePostingsCsv(parsed.postings, "2026-07");

  assert.match(csv, /^M;99;IMPORTAÇÃO DE LANÇAMENTOS;31\/07\/2026;;;;;\r\n/);
  assert.match(csv, /\*P;ALMOXARIFADO;4\.2\.1\.03\.01\.20;2\.1\.7\.01\.02\.15;AJ ALMOXARIFADO;1\.234,56;71;CONSUMO MATERIAL DE ALMOXARIFADO - N\/MÊS;1/);
});

test("lê o modelo real de Materiais, filtra a competência e segrega o Ao Cubo", () => {
  const result = parseWarehouseSheets([
    {
      name: "Materiais",
      rows: [
        ["Ano", "Mês", "Data aplicação", "Material", "Quantidade", " Preço total ", "Unidade", "Marca"],
        [2025, "JUNHO", "01/06/2025", "Item antigo", 1, 999, "CUBO BARRA", "CUBO"],
        [2026, "JUNHO", "01/06/2026", "Item A", 1, 3262.28, "CUBO BARRA", "CUBO"],
        [2026, "JUNHO", "01/06/2026", "Item B", 1, 598.23, "CUBO BOTAFOGO", "CUBO"],
        [2026, "JUNHO", "01/06/2026", "Item C", 1, 74.6, "CUBO BARRA GOLF", "CUBO"],
        [2026, "JULHO", "01/07/2026", "Item futuro", 1, 500, "CUBO BARRA", "CUBO"],
      ],
    },
  ], { selectedCompanyCode: "05", selectedCompanyName: "05 — AO CUBO", competence: "2026-06" });

  assert.equal(result.errors.length, 0);
  assert.equal(result.sourceRows, 3);
  assert.deepEqual(result.postings.map(({ branchCode, amount }) => ({ branchCode, amount })), [
    { branchCode: "2", amount: 3262.28 },
    { branchCode: "5", amount: 598.23 },
    { branchCode: "6", amount: 74.6 },
  ]);
});

test("na Raiz reconhece Global Tree e os demais destinos do modelo real", () => {
  const result = parseWarehouseSheets([
    {
      name: "Materiais",
      rows: [
        ["Ano", "Mês", " Preço total ", "Unidade", "Marca"],
        [2026, "JUNHO", 100, "GLOBAL TREE MARAPENDI", "GLOBAL TREE"],
        [2026, "JUNHO", 200, "QI METROPOLITANO", "QI"],
        [2026, "JUNHO", 300, "QI RECREIO", "QI"],
        [2026, "JUNHO", 400, "SARAH DAWSEY TIJUCA", "SARAH DAWSEY"],
      ],
    },
  ], { selectedCompanyCode: "01", selectedCompanyName: "01 — RAIZ EDUCAÇÃO", competence: "2026-06" });

  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.postings.map(({ destinationCode, amount, branchCode }) => ({ destinationCode, amount, branchCode })), [
    { destinationCode: "6", amount: 200, branchCode: "1" },
    { destinationCode: "9", amount: 100, branchCode: "1" },
    { destinationCode: "10", amount: 300, branchCode: "1" },
    { destinationCode: "25", amount: 400, branchCode: "1" },
  ]);
});
