import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const service = readFileSync(resolve(root, "lib/fiscal/monthly-workflow-service.ts"), "utf8");
const access = readFileSync(resolve(root, "lib/server/fiscal-access.ts"), "utf8");
const repository = readFileSync(resolve(root, "lib/fiscal/repository.ts"), "utf8");
const schema = readFileSync(resolve(root, "Supabase/schema.sql"), "utf8");

function route(path) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("IRPJ/CSLL API integration", () => {
  it("exposes a dashboard route backed by the fiscal workflow service", () => {
    const source = route("app/api/irpj-csll/route.ts");
    assert.match(source, /loadIrpjCsllDashboard/);
    assert.match(source, /fiscalWorkflowErrorResponse/);
    assert.match(source, /Response\.json/);
  });

  it("exposes preview and reprocess endpoints without client-side calculation", () => {
    assert.match(route("app/api/irpj-csll/preview/route.ts"), /previewIrpjCsllMonthly/);
    assert.match(route("app/api/irpj-csll/reprocess/route.ts"), /reprocessIrpjCsllMonthly/);
    assert.match(service, /previewTaxPeriod\(input\)/);
    assert.match(service, /reprocessTaxPeriod\(input\)/);
  });

  it("exposes pending classification and conditional decision endpoints", () => {
    assert.match(route("app/api/irpj-csll/pending/[pendingId]/classify/route.ts"), /classifyIrpjCsllPending/);
    assert.match(route("app/api/irpj-csll/pending/[pendingId]/resolve-conditional/route.ts"), /resolveIrpjCsllConditional/);
    assert.match(service, /classifyNewAccount/);
    assert.match(service, /resolveConditionalOccurrence/);
  });

  it("exposes version opening and close endpoints", () => {
    assert.match(route("app/api/irpj-csll/versions/open/route.ts"), /openIrpjCsllVersion/);
    assert.match(route("app/api/irpj-csll/close/route.ts"), /closeIrpjCsllMonthly/);
    assert.match(service, /openNewTaxPeriodVersion/);
    assert.match(service, /commitTaxPeriodClose/);
  });

  it("enforces auth, linked company and contabil module on the backend", () => {
    assert.match(access, /bearerToken/);
    assert.match(access, /usuarios_empresas/);
    assert.match(access, /usuarios_modulos/);
    assert.match(access, /MISSING_CONTABIL_MODULE/);
    assert.match(access, /READONLY_PROFILE/);
    assert.match(access, /contabil/);
  });

  it("requires write access for mutable workflow operations", () => {
    const writeChecks = service.match(/\{ write: true \}/g) ?? [];
    assert.ok(writeChecks.length >= 5);
  });

  it("keeps the required persisted snapshot sequence before the engine", () => {
    assert.match(service, /MISSING_SOURCE_SNAPSHOT/);
    assert.match(service, /SOURCE_SNAPSHOT persistido/);
    assert.match(service, /sourceSequence: "TOTVS -> SOURCE_SNAPSHOT persistido -> motor fiscal"/);
    assert.doesNotMatch(service.toLowerCase(), /querydataengine|fetchtrialbalance|totvs.*fetch|fetch.*totvs/);
  });

  it("does not invent accounting result when the snapshot lacks YTD data", () => {
    assert.match(service, /MISSING_ACCOUNTING_RESULT_YTD/);
    assert.match(service, /accountingResultYtdFromSnapshot/);
    assert.match(service, /accountingResultYtdByTaxFromSnapshot/);
    assert.doesNotMatch(service, /accountingResultYtd:\s*0/);
  });

  it("loads fiscal matrix state from Supabase instead of hardcoding rules in routes", () => {
    assert.match(service, /listFiscalMatrixContext/);
    assert.match(repository, /fiscal_natures/);
    assert.match(repository, /account_fiscal_mappings/);
    assert.match(repository, /fiscal_rules/);
  });

  it("persists workflow outputs through fiscal repository tables", () => {
    assert.match(repository, /listSourceSnapshots/);
    assert.match(repository, /upsertPendingItems/);
    assert.match(repository, /upsertRuleExecutionResults/);
    assert.match(repository, /upsertTaxAdjustments/);
    assert.match(repository, /upsertTaxCalculation/);
    assert.match(repository, /tax_workflow_human_decisions/);
  });

  it("adds a human-decision audit table with RLS for the contabil module", () => {
    assert.match(schema, /create table if not exists public\.tax_workflow_human_decisions/);
    assert.match(schema, /alter table public\.tax_workflow_human_decisions enable row level security/);
    assert.match(schema, /usuario_tem_modulo\('contabil'/);
    assert.match(schema, /lower\(trim\(ue\.perfil\)\) <> 'consulta'/);
  });

  it("adds tax-period version metadata for close and supersede", () => {
    assert.match(schema, /closed_manifest_id uuid/);
    assert.match(schema, /replaced_by_tax_period_id uuid references public\.tax_periods\(id\)/);
    assert.match(schema, /CLOSED_CURRENT/);
    assert.match(schema, /CLOSED_SUPERSEDED/);
  });

  it("uses one backend RPC for close-side status updates", () => {
    assert.match(schema, /create or replace function public\.close_irpj_csll_period/);
    assert.match(schema, /for update/);
    assert.match(schema, /v_current_count <> 1/);
    assert.match(repository, /\.rpc\("close_irpj_csll_period"/);
  });

  it("marks superseded and downstream stale periods during backend close", () => {
    assert.match(schema, /replaced_by_tax_period_id = p_tax_period_id/);
    assert.match(schema, /upstream_stale = true/);
    assert.match(service, /supersededPeriods: result\.supersededPeriods/);
    assert.match(service, /stalePeriods: result\.stalePeriods/);
  });

  it("updates the closing schedule only from the backend close flow", () => {
    assert.match(schema, /insert into public\.cronograma_entregas/);
    assert.match(schema, /insert into public\.cronograma_historico/);
    assert.match(service, /scheduleCompletion: result\.scheduleCompletion/);
  });
});


