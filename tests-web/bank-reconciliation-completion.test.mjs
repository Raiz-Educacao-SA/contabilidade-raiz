import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("../app/monthly-reconciliation.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const reconciliation = await readFile(new URL("../lib/reconciliation.ts", import.meta.url), "utf8");
const matcher = await readFile(new URL("../lib/reconciliation-matcher.ts", import.meta.url), "utf8");
const monthly = await readFile(new URL("../lib/reconciliation-monthly.ts", import.meta.url), "utf8");
const dataEngine = await readFile(new URL("../lib/data-engine-statements.ts", import.meta.url), "utf8");
const policy = await readFile(new URL("../lib/bank-reconciliation-policy.ts", import.meta.url), "utf8");
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

test("usa o cabeçalho de preparação no topo sem repetir o título mensal", () => {
  assert.doesNotMatch(panel, /Conciliação mensal por movimento/);
  assert.match(
    panel,
    /<div className="panel-title">[\s\S]*?<div className="source-control-title">[\s\S]*?<h2>Preparar conciliação por movimento<\/h2>/,
  );
  assert.doesNotMatch(
    panel,
    /<div className="source-control">\s*<div className="source-control-title">/,
  );
  assert.match(monthlyCss, /\.source-steps \{[\s\S]*?margin-top: 0;/);
});

test("leva as ações para depois dos filtros e explica todas as regras aplicadas", () => {
  assert.match(page, /id="bank-reconciliation-filter-actions"/);
  assert.match(panel, /createPortal\([\s\S]*bank-history-actions[\s\S]*actionsTarget/);
  assert.match(panel, /Relatório consolidado[\s\S]*Regra aplicada[\s\S]*Limpar histórico/);
  assert.match(panel, /BANK_RECONCILIATION_POLICY_STEPS\.map/);
  assert.match(policy, /Excel tem prioridade/);
  assert.match(policy, /PDF só é usado quando não existe Excel/);
  assert.match(policy, /Lançamentos repetidos que pertencem ao mesmo Excel são mantidos/i);
  assert.match(policy, /Diferenças de datas que se compensam dentro da competência são desconsideradas/);
  assert.match(policy, /Diferenças líquidas mensais de até R\$ 1,00/);
  assert.match(modulesCss, /\.bank-content \.filter-fields \{[\s\S]*?flex: 0 1 650px;[\s\S]*?grid-template-columns: minmax\(240px, 380px\) auto;/);
  assert.match(monthlyCss, /\.bank-content \.source-steps article button \{ min-height: 26px;/);
});

test("aplica uma política única de conciliação a todas as coligadas", () => {
  assert.match(policy, /tratamento técnico é único e não cria exceções para empresas específicas/);
  assert.match(dataEngine, /BANK_RECONCILIATION_TOLERANCE_CENTS/);
  assert.match(dataEngine, /BANK_STATEMENT_SOURCE_PRIORITY/);
  assert.match(matcher, /toleranceValue = BANK_RECONCILIATION_TOLERANCE/);
  assert.match(monthly, /tolerance = BANK_RECONCILIATION_TOLERANCE/);
  assert.doesNotMatch(dataEngine, /options\.codColigada\s*===\s*(?:1|2|3)\b/);
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
  assert.match(panel, /const dailyDifferences = result\.validation\.reconciled[\s\S]*\? \[\][\s\S]*selectMonthlyDifferenceDays\([\s\S]*result\.validation\.dailyDifferences[\s\S]*result\.validation\.movementDifference/);
  assert.match(panel, /Localização diária da diferença mensal/);
  assert.match(panel, /Dias que explicam a diferença/);
  assert.match(panel, /Diferenças diárias que se compensam dentro da competência/);
  assert.match(panel, /Quando o mês não fecha, a análise abaixo/);
  assert.match(panel, /Movimento líquido no extrato/);
  assert.match(panel, /Movimento líquido contábil/);
  assert.match(panel, /Diferença líquida/);
  assert.match(panel, /Alertas internos informados pela Planilha 18/);
  assert.doesNotMatch(panel, /Total das pendências detalhadas/);
});

test("pagina as exceções para não sobrecarregar o navegador", () => {
  assert.match(panel, /const EXCEPTION_PAGE_SIZE = 25/);
  assert.match(panel, /section\.rows\.slice\(start, start \+ EXCEPTION_PAGE_SIZE\)/);
  assert.match(panel, /O relatório consolidado mantém todos os itens/);
  assert.match(panel, /<ReconciliationExceptionTable key=\{section\.key\}/);
  assert.doesNotMatch(panel, /section\.rows\.map\(\(row, index\)/);
  assert.match(monthlyCss, /\.exception-pagination \{[\s\S]*?justify-content: space-between/);
});

test("mantém uma ficha detalhada por vez e usa cache para grandes históricos", () => {
  assert.match(panel, /contabilidade-raiz-reconciliation-cache/);
  assert.match(panel, /writeReconciliationCache\(historyKey, updated\)/);
  assert.doesNotMatch(
    panel,
    /localStorage\.setItem\(historyKey, JSON\.stringify\(updated\)\)/,
  );
  assert.match(
    panel,
    /if \(cachedKey !== historyKey\) workflowCache\.delete\(cachedKey\)/,
  );
  assert.match(
    panel,
    /expanded=\{expandedResultCode === result\.account\.code\}/,
  );
  assert.match(panel, /expanded && \([\s\S]*?<ReconciliationFormView/);
  assert.match(panel, /Ver ficha de conciliação/);
  assert.match(monthlyCss, /\.reconciliation-detail-toggle \{/);
});

test("mantém fichas recolhidas também para as contas conciliadas", () => {
  assert.match(
    panel,
    /const reconciledResults = useMemo\([\s\S]*result\.validation\.reconciled/,
  );
  assert.match(panel, /reconciledResults\.map\(\(result\) =>/);
  assert.match(panel, /As fichas permanecem recolhidas/);
  assert.match(
    panel,
    /value\.reconciled \? \([\s\S]*Entradas no extrato[\s\S]*Débitos contábeis[\s\S]*Saídas no extrato[\s\S]*Créditos contábeis/,
  );
  assert.match(
    panel,
    /result\.validation\.reconciled \? \([\s\S]*reconciled-form-summary[\s\S]*result\.validation\.bankCredits[\s\S]*result\.validation\.accountingDebits[\s\S]*result\.validation\.bankDebits[\s\S]*result\.validation\.accountingCredits/,
  );
  assert.match(
    monthlyCss,
    /\.monthly-metrics\.reconciled-metrics \{[\s\S]*grid-template-columns: repeat\(2/,
  );
  assert.match(
    monthlyCss,
    /\.form-summary\.reconciled-form-summary \{[\s\S]*grid-template-columns: repeat\(4/,
  );
});

test("não libera a conciliação quando o Data Engine só devolve pendências", () => {
  assert.match(panel, /if \(sources\.length > 0\)/);
  assert.match(panel, /setStatementsUpdated\(false\)/);
  assert.match(panel, /LEGACY_DOCUMENT_INVALID/);
  assert.match(panel, /aguardando reprocessamento na origem/);
});

test("prioriza a soma líquida diária e depois a soma líquida mensal", () => {
  assert.match(matcher, /exactDate \? dayKey\(a\.date\) === dayKey\(b\.date\)/);
  assert.match(matcher, /monthKey\(a\.date\) === monthKey\(b\.date\)/);
  assert.match(matcher, /matchDailyNetGroups\(\)/);
  assert.match(matcher, /Total líquido diário agrupado/);
  assert.match(matcher, /matchMonthlyNetGroups\(\)/);
  assert.match(matcher, /Total líquido mensal agrupado/);
  assert.match(matcher, /groupDailyNetDifferences\(\)/);
  assert.match(matcher, /Diferença líquida diária agrupada/);
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
  assert.match(panel, /status: "Diferença diária informativa"/);
  assert.match(panel, /Informativa — não gera pendência na ficha de conciliação/);
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
  assert.match(modulesCss, /\.bank-content > header h1 \{ font-size: 18px/);
  assert.match(modulesCss, /\.bank-content \.filter-heading b \{ font-size: 8px/);
  assert.match(modulesCss, /\.bank-content \.top-context select \{ font-size: 9px/);
  assert.match(modulesCss, /\.bank-content \.company-select-stack \{ grid-template-rows: 22px auto; gap: 1px; \}/);
  assert.match(modulesCss, /\.bank-content \.company-select-stack select \{ height: 22px; \}/);
  assert.match(modulesCss, /\.bank-content \.company-control \{ overflow: hidden; \}/);
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

test("não desmonta a conciliação quando a sessão renova o token", () => {
  assert.match(page, /const sessionUserId = session\?\.user\.id \?\? ""/);
  assert.match(
    page,
    /setCompaniesLoading\(true\)[\s\S]*?\.eq\("usuario_id", sessionUserId\)[\s\S]*?\}, \[sessionUserId\]\);/,
  );
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
  assert.match(panel, /accountingStepComplete \? "is-complete" : "is-available"/);
  assert.match(panel, /disabled=\{accountingBusy \|\| dataEngineBusy\}/);
  assert.match(panel, /statementsStepComplete \? "is-complete" : accountingFresh \? "is-available" : "is-locked"/);
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
});

test("mantém coloridas as três etapas depois da conciliação automática", () => {
  assert.match(panel, /const accountingStepComplete = accountingFresh \|\| resultsCurrent/);
  assert.match(panel, /const statementsStepComplete = statementsFresh \|\| resultsCurrent/);
  assert.match(panel, /accountingStepComplete \? "ready" : "waiting"/);
  assert.match(panel, /statementsStepComplete \? "ready" : "waiting"/);
  assert.match(panel, /resultsCurrent[\s\S]*?"completed reconcile-step"/);
});
