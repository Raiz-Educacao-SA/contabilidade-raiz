import assert from "node:assert/strict";
import test from "node:test";
const moduleUrl = new URL("../lib/auth-domain.ts", import.meta.url);
const { isAllowedCorporateEmail } = await import(moduleUrl.href);

test("aceita somente o domínio corporativo da Raiz", () => {
  assert.equal(isAllowedCorporateEmail("luanda.silva@raizeducacao.com.br"), true);
  assert.equal(isAllowedCorporateEmail(" USUARIO@RAIZEDUCACAO.COM.BR "), true);
});

test("rejeita domínios externos e endereços disfarçados", () => {
  assert.equal(isAllowedCorporateEmail("usuario@gmail.com"), false);
  assert.equal(isAllowedCorporateEmail("usuario@raizeducacao.com.br.evil.test"), false);
  assert.equal(isAllowedCorporateEmail("@raizeducacao.com.br"), false);
  assert.equal(isAllowedCorporateEmail(null), false);
});
