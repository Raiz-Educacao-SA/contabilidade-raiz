import assert from "node:assert/strict";
import test from "node:test";
const moduleUrl = new URL("../lib/access-control.ts", import.meta.url);
const { requiredModulesForApiPath, resolveAllowedModules } = await import(moduleUrl.href);

test("usa permissões explícitas para novos membros", () => {
  assert.deepEqual(resolveAllowedModules(["membro"], ["folha"]), ["folha"]);
  assert.deepEqual(resolveAllowedModules(["membro"], ["financeiro", "contabil"]), ["financeiro", "contabil"]);
});

test("mantém compatibilidade com perfis existentes e libera tudo ao administrador", () => {
  assert.deepEqual(resolveAllowedModules(["financeiro"], []), ["cronograma", "financeiro"]);
  assert.deepEqual(resolveAllowedModules(["contábil"], []), ["cronograma", "contabil", "book"]);
  assert.deepEqual(resolveAllowedModules(["administrador"], ["folha"]), [
    "financeiro", "fiscal", "compras", "folha", "contabil", "book", "cronograma",
  ]);
});

test("protege as APIs conforme o módulo liberado", () => {
  assert.deepEqual(requiredModulesForApiPath("/api/data-engine/statements"), ["financeiro"]);
  assert.deepEqual(requiredModulesForApiPath("/api/payroll/lot"), ["folha"]);
  assert.deepEqual(requiredModulesForApiPath("/api/totvs/pis-cofins"), ["contabil"]);
  assert.deepEqual(requiredModulesForApiPath("/api/totvs/accounting"), ["financeiro", "contabil"]);
  assert.deepEqual(requiredModulesForApiPath("/api/access-requests"), []);
});
