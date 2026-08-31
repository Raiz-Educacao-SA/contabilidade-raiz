import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const revenue = readFileSync(new URL("../app/revenue-reconciliation.tsx", import.meta.url), "utf8");
const pisCofins = readFileSync(new URL("../app/pis-cofins-assessment.tsx", import.meta.url), "utf8");
const bank = readFileSync(new URL("../app/monthly-reconciliation.tsx", import.meta.url), "utf8");

test("mantém a última posição de módulo e visualização", () => {
  assert.match(page, /contabilidade-raiz:last-position/);
  assert.match(page, /selectedModule/);
  assert.match(page, /accountingTab/);
  assert.match(page, /fiscalTab/);
  assert.match(page, /bookReport/);
  assert.match(page, /selectedScheduleModule/);
});

test("conciliação de receita restaura o último resultado mesmo após reabrir", () => {
  assert.match(revenue, /const snapshot = await readRevenueReconciliationCache<RevenueCacheSnapshot>\(cacheKey\)/);
  assert.match(revenue, /setIsFinalized\(finalized\)/);
  assert.match(revenue, /if \(snapshot\) \{/);
  assert.match(revenue, /finalizedAt,\s*finalizedBy,/);
  assert.match(revenue, /disabled=\{isFinalized \|\| \(!fr && !cr\) \|\| loading !== null\}/);
  assert.match(revenue, /Reabra a tarefa antes de limpar os dados/);
});

test("PIS e COFINS só permite limpar depois da reabertura", () => {
  assert.match(pisCofins, /function clearAssessment\(\) \{\s*if \(isFinalized\) return;/);
  assert.match(pisCofins, /disabled=\{isFinalized \|\| !hasAssessment\}/);
  assert.doesNotMatch(pisCofins, /const snapshotToClear = isFinalized/);
});

test("conciliação bancária trava atualização e limpeza enquanto concluída", () => {
  assert.match(bank, /const \[taskFinalized, setTaskFinalized\] = useState\(true\)/);
  assert.match(bank, /onStatusChange=\{setTaskFinalized\}/);
  assert.match(bank, /disabled=\{taskFinalized \|\| !results.length\}/);
  assert.match(bank, /if \(taskFinalized\) return;/);
});
