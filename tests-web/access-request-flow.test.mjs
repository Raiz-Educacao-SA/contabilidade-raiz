import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminRoute = await readFile(new URL("../app/api/admin/access-requests/route.ts", import.meta.url), "utf8");
const accessScreen = await readFile(new URL("../app/access-management.tsx", import.meta.url), "utf8");
const passwordScreen = await readFile(new URL("../app/definir-senha/page.tsx", import.meta.url), "utf8");
const schema = await readFile(new URL("../Supabase/controle_acesso.sql", import.meta.url), "utf8");

test("aprovação libera automaticamente todas as empresas ativas", () => {
  assert.match(adminRoute, /\.from\("empresas"\)[\s\S]*\.eq\("ativa", true\)/);
  assert.match(adminRoute, /perfil: "Membro"/);
  assert.doesNotMatch(accessScreen, /Selecionar todas|Empresas liberadas/);
  assert.match(accessScreen, /Todas as empresas ativas serão liberadas automaticamente/);
  assert.match(schema, /vincular_nova_empresa_a_membros_trigger/);
});

test("convite cria senha em tela própria e nunca concede administrador", () => {
  assert.match(adminRoute, /inviteUserByEmail/);
  assert.match(adminRoute, /\/definir-senha/);
  assert.match(passwordScreen, /updateUser\(\{ password \}\)/);
  assert.doesNotMatch(adminRoute, /perfil: "Administrador"/);
});

test("chave administrativa permanece somente no servidor", () => {
  assert.doesNotMatch(accessScreen, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(passwordScreen, /SUPABASE_SERVICE_ROLE_KEY/);
});
