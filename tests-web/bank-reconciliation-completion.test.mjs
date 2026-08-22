import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("../app/monthly-reconciliation.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const reconciliation = await readFile(new URL("../lib/reconciliation.ts", import.meta.url), "utf8");
const matcher = await readFile(new URL("../lib/reconciliation-matcher.ts", import.meta.url), "utf8");
const cycle = await readFile(new URL("../lib/reconciliation-cycle.ts", import.meta.url), "utf8");
const monthlyCss = await readFile(new URL("../app/monthly.css", import.meta.url), "utf8");
const modulesCss = await readFile(new URL("../app/modules.css", import.meta.url), "utf8");

test("conciliação bancária finaliza a tarefa por empresa e competência", () => {
  assert.match(panel, /financialCompletionIdentity\("bancaria", companyCode, companyName\)/);
  assert.match(panel, /<ModuleCompletionControl/);
  assert.match(panel, /disabled=\{!results\.length\}/);
  assert.match(page, /userId=\{session\.user\.id\}/);
});

test("não duplica o controle de finalização no cabeçalho geral", () => {
  assert.match(page, /selectedModule === "bancaria"\) return null/);
});

test("detalha o que não confere entre o extrato e a contabilidade", () => {
  assert.match(panel, /row\.status === "Somente no banco"/);
  assert.match(panel, /row\.status === "Somente na contabilidade"/);
  assert.match(panel, /Entradas no extrato sem lançamento correspondente na contabilidade/);
  assert.match(panel, /Saídas no extrato sem lançamento correspondente na contabilidade/);
  assert.match(panel, /Débitos lançados na contabilidade não identificados no extrato/);
  assert.match(panel, /Créditos lançados na contabilidade não identificados no extrato/);
  assert.match(panel, /Sem lançamento na contabilidade/);
  assert.match(panel, /Sem movimento no extrato/);
  assert.match(panel, /const dailyDifferences = result\.validation\.reconciled[\s\S]*\? \[\][\s\S]*result\.validation\.dailyDifferences/);
  assert.match(panel, /Localização diária da diferença mensal/);
  assert.match(panel, /Dias que explicam a diferença/);
  assert.match(panel, /Diferenças de data que se compensam dentro da competência/);
  assert.match(panel, /Quando o mês não fecha, a análise diária abaixo/);
  assert.match(panel, /Diferença nas entradas/);
  assert.match(panel, /Diferença nas saídas/);
  assert.match(panel, /Diferença líquida/);
  assert.match(panel, /Alertas internos informados pela Planilha 18/);
  assert.doesNotMatch(panel, /Total das pendências detalhadas/);
});

test("procura no dia e depois agrupa os valores que fecham na competência", () => {
  assert.match(matcher, /exactDate \? dayKey\(a\.date\) === dayKey\(b\.date\)/);
  assert.match(matcher, /monthKey\(a\.date\) === monthKey\(b\.date\)/);
  assert.match(matcher, /matchDailyGroups\(\)/);
  assert.match(matcher, /Total diário agrupado/);
  assert.match(matcher, /matchMonthlyGroups\(\)/);
  assert.match(matcher, /Total mensal agrupado/);
  assert.doesNotMatch(matcher, /days <= toleranceDays/);
  assert.match(reconciliation, /reconcileMovements/);
});

test("usa fonte compacta na ficha de divergências", () => {
  assert.match(monthlyCss, /\.reconciliation-form th,[\s\S]*?font-size: 8px/);
  assert.match(monthlyCss, /\.form-identification b \{[\s\S]*?font-size: 8px/);
  assert.match(monthlyCss, /\.form-summary b \{[\s\S]*?font-size: 10px/);
  assert.match(monthlyCss, /\.reconciliation-form > header h2 \{[\s\S]*?font-size: 13px/);
  assert.match(monthlyCss, /\.bank-content \.saved-history h3 \{[^}]*font-size: 10px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-account h3 \{[^}]*font-size: 10px/);
  assert.match(monthlyCss, /\.bank-content \.reconciliation-form > header h2 \{[^}]*font-size: 12px/);
  assert.match(monthlyCss, /\.bank-content \.form-identification b \{ font-size: 8px/);
  assert.match(monthlyCss, /\.bank-content \.form-summary b \{ font-size: 10px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-metrics b \{ font-size: 11px/);
});

test("gera o relatório consolidado com todos os resultados da conciliação", () => {
  assert.match(panel, /const reportRows = useMemo\([\s\S]*results\.flatMap\(\(result\) => result\.rows\)/);
  assert.match(panel, /exportReport\(reportRows, `conciliacao_mensal_\$\{competence\}`\)/);
  assert.match(panel, /disabled=\{!results\.length\}[\s\S]*onClick=\{downloadConsolidatedReport\}/);
  assert.match(panel, /Relatório consolidado gerado com/);
  assert.match(panel, /Erro: não foi possível gerar o relatório consolidado/);
  assert.doesNotMatch(panel, /disabled=\{!allRows\.length\}/);
});

test("compacta as etapas e os valores da conciliação bancária", () => {
  assert.match(monthlyCss, /\.bank-content \.source-control \{[^}]*padding: 10px 12px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-account \{[^}]*padding: 10px 12px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-metrics b \{ font-size: 11px/);
});

test("usa melhor a área útil e reduz os espaços em branco", () => {
  assert.match(modulesCss, /\.bank-shell \{ grid-template-columns: 210px minmax\(0, 1fr\)/);
  assert.match(modulesCss, /\.bank-content \{ padding: 18px clamp\(14px, 2vw, 28px\) 32px/);
  assert.match(monthlyCss, /\.bank-content \.panel\.monthly-flow \{ padding: 16px/);
  assert.match(monthlyCss, /\.bank-content \.account-coverage \{ margin-top: 10px; padding: 12px/);
  assert.match(monthlyCss, /\.bank-content \.reconciliation-form \{ margin-top: 10px; padding: 10px/);
  assert.match(monthlyCss, /\.bank-content \.form-sections \{ gap: 8px; margin-top: 10px/);
});

test("reduz também as fontes do cabeçalho, filtros e ações", () => {
  assert.match(modulesCss, /\.bank-content > header h1 \{ font-size: 21px/);
  assert.match(modulesCss, /\.bank-content \.filter-heading b \{ font-size: 8px/);
  assert.match(modulesCss, /\.bank-content \.top-context select \{ font-size: 9px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-flow \.panel-title h2 \{ font-size: 12px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-flow \.panel-title p \{ font-size: 8px/);
  assert.match(monthlyCss, /\.bank-content \.monthly-flow \.history-actions button \{ font-size: 8px/);
});

test("mostra nominalmente as contas encontradas e não encontradas", () => {
  assert.match(panel, /Contas encontradas e não encontradas/);
  assert.match(panel, /Encontradas nas duas bases/);
  assert.match(panel, /Conta contábil sem extrato/);
  assert.match(panel, /Extrato sem conta contábil/);
  assert.match(panel, /unmatchedAccounts\.map\(\(account\)/);
  assert.match(panel, /unmatchedSources\.map\(\(source\)/);
  assert.match(panel, /statements\.map\(\(statement\)/);
  assert.match(panel, /Detalhes técnicos da atualização dos extratos/);
});

test("preserva a conciliação ao mudar de tela e só substitui dados após atualizar", () => {
  assert.match(panel, /const workflowCache = new Map<string, WorkflowState>\(\)/);
  assert.match(panel, /initialWorkflow\?\.accounting \?\? \[\]/);
  assert.match(panel, /workflowCache\.set\(historyKey/);
  assert.doesNotMatch(panel, /setAccounting\(\[\]\)/);
  assert.doesNotMatch(panel, /setDataEngineSources\(\[\]\)/);
  assert.match(panel, /!accountingBusy &&\s*!dataEngineBusy/);
});

test("libera a conciliação somente após as duas bases atualizarem com sucesso", () => {
  assert.match(panel, /const accountingFresh = sourceReadyForReconciliation/);
  assert.match(panel, /const statementsFresh = sourceReadyForReconciliation/);
  assert.match(cycle, /sourceRevision > reconciliationRevision/);
  assert.match(panel, /accountingFresh &&[\s\S]*statementsFresh &&[\s\S]*!accountingBusy &&[\s\S]*!dataEngineBusy/);
  assert.match(panel, /setAccountingUpdated\(false\)[\s\S]*setAccountingUpdated\(true\)/);
  assert.match(panel, /setStatementsUpdated\(false\)[\s\S]*setStatementsUpdated\(true\)/);
  assert.match(panel, /disabled=\{!reconciliationReady\}/);
  assert.match(panel, /Atualize primeiro a base contábil/);
  assert.match(panel, /Atualize agora os extratos bancários/);
  assert.match(panel, /Bases prontas; clique para executar a conciliação/);
});

test("executa as três etapas em sequência e usa cor somente após a conclusão", () => {
  assert.match(panel, /accountingFresh \? "is-complete" : "is-available"/);
  assert.match(panel, /disabled=\{accountingBusy \|\| dataEngineBusy\}/);
  assert.match(panel, /statementsFresh \? "is-complete" : accountingFresh \? "is-available" : "is-locked"/);
  assert.match(panel, /disabled=\{!accountingFresh \|\| dataEngineBusy\}/);
  assert.match(panel, /resultsCurrent \? "is-complete" : reconciliationReady \? "is-available" : "is-locked"/);
  assert.match(panel, /disabled=\{!reconciliationReady\}/);
  assert.match(panel, /resultsCurrent \? "Conciliação concluída" : "Conciliação automática"/);
  assert.match(monthlyCss, /button\.workflow-action\.is-available \{[\s\S]*?background: #fff !important;[\s\S]*?color: #566071 !important;/);
  assert.match(monthlyCss, /button\.workflow-action\.is-locked \{[\s\S]*?background: #eef1f5 !important;/);
  assert.match(monthlyCss, /button\.accounting-action\.is-complete \{[\s\S]*?background: var\(--success\) !important;/);
  assert.match(monthlyCss, /button\.statements-action\.is-complete \{[\s\S]*?background: #f18700 !important;/);
  assert.match(monthlyCss, /button\.reconciliation-action\.is-complete \{[\s\S]*?background: var\(--violet\) !important;/);
});

test("bloqueia uma nova conciliação até as duas fontes serem atualizadas novamente", () => {
  assert.match(panel, /setAccountingRevision\(nextSourceRevision\(\)\)/);
  assert.match(panel, /setStatementsRevision\(nextSourceRevision\(\)\)/);
  assert.match(panel, /sourceRevisionSequenceRef\.current \+= 1/);
  assert.match(panel, /setReconciliationRevision\([\s\S]*completedReconciliationRevision\(accountingRevision, statementsRevision\)/);
  assert.match(cycle, /Math\.max\(accountingRevision, statementsRevision\)/);
  assert.match(panel, /atualize as duas bases para executar novamente/);
  assert.match(panel, /accountingFresh \? "ready" : "waiting"/);
  assert.match(panel, /statementsFresh \? "ready" : "waiting"/);
});
