import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const control = readFileSync(new URL("../app/module-completion-control.tsx", import.meta.url), "utf8");
const accessPolicy = readFileSync(new URL("../Supabase/controle_acesso.sql", import.meta.url), "utf8");

test("todas as telas com tarefas usam uma identidade detalhada por empresa", () => {
  assert.match(page, /financialCompletionIdentity\(selectedModule, selectedCompanyCode, selectedCompanyName\)/);
  assert.match(page, /fiscalCompletionIdentity\(fiscalTab, selectedCompanyCode, selectedCompanyName\)/);
  assert.match(page, /bookCompletionIdentity\(bookReport, selectedCompanyCode, selectedCompanyName\)/);
  assert.match(page, /PAYROLL_SCHEDULE_TASK_IDS\.map[\s\S]*payrollCompletionIdentity/);
  assert.match(page, /purchasesCompletionIdentity\(selectedCompanyCode, selectedCompanyName\)/);
});

test("finalizar e reabrir registram cronograma e histórico pelo e-mail", () => {
  assert.match(control, /upsert\(completionRows, \{ onConflict: "competencia,modulo" \}\)/);
  assert.match(control, /usuario_email: userEmail/);
  assert.match(control, /confirmado_email: userEmail/);
  assert.match(control, /done \? "Reabrir tarefa" : "Finalizar tarefa"/);
  assert.match(control, /A tarefa foi atualizada, mas o histórico não pôde ser registrado/);
});

test("as políticas reconhecem as chaves detalhadas dos módulos", () => {
  for (const prefix of ["fiscal", "compras", "folha", "book"]) {
    assert.match(accessPolicy, new RegExp(`modulo like '${prefix}:%'`));
  }
});
