import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/user-display-name.ts", import.meta.url);
const { displayNameFromIdentity, resolveUserDisplayName } = await import(moduleUrl.href);

test("converte o e-mail corporativo no nome exibido", () => {
  assert.equal(displayNameFromIdentity("luanda.silva@raizeducacao.com.br"), "Luanda Silva");
});

test("prioriza o nome completo registrado no perfil", () => {
  assert.equal(
    resolveUserDisplayName({ full_name: "Luanda Soares da Silva" }, "luanda.silva@raizeducacao.com.br"),
    "Luanda Soares da Silva",
  );
});

test("mantém o campo preenchido mesmo sem metadados ou e-mail", () => {
  assert.equal(resolveUserDisplayName({}, ""), "Usuário");
});
