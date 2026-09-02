import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (...segments) => readFileSync(resolve(root, ...segments), "utf8");

const dossier = read("lib", "fiscal", "monthly-dossier.ts");
const service = read("lib", "fiscal", "monthly-dossier-service.ts");
const repository = read("lib", "fiscal", "repository.ts");
const schema = read("Supabase", "schema.sql");
const ui = read("app", "irpj-csll-assessment.tsx");
const listRoute = read("app", "api", "irpj-csll", "dossier", "route.ts");
const generateRoute = read("app", "api", "irpj-csll", "dossier", "generate", "route.ts");
const artifactRoute = read("app", "api", "irpj-csll", "dossier", "artifact", "route.ts");
const manifestRoute = read("app", "api", "irpj-csll", "dossier", "manifest", "route.ts");
const compareRoute = read("app", "api", "irpj-csll", "dossier", "compare", "route.ts");

describe("IRPJ/CSLL monthly dossier API and UI integration", () => {
  it("exposes the dossier routes through the authorized service layer", () => {
    assert.match(listRoute, /listIrpjCsllMonthlyDossiers/);
    assert.match(generateRoute, /generateMonthlyDossier/);
    assert.match(artifactRoute, /getMonthlyDossierArtifact/);
    assert.match(manifestRoute, /getMonthlyDossierManifest/);
    assert.match(compareRoute, /compareMonthlyDossierVersions/);
    assert.match(generateRoute, /export async function POST/);
    assert.match(listRoute, /export async function GET/);
    assert.match(artifactRoute, /export async function GET/);
    assert.match(manifestRoute, /export async function GET/);
    assert.match(compareRoute, /export async function GET/);
    for (const route of [listRoute, generateRoute, artifactRoute, manifestRoute, compareRoute]) {
      assert.match(route, /dossierServiceErrorResponse/);
    }
  });

  it("requires fiscal access and write access for generation", () => {
    assert.match(service, /parseFiscalRequestScope/);
    assert.match(service, /requireFiscalAccess\(request, parseFiscalRequestScope\(request\)\)/);
    assert.match(service, /requireFiscalAccess\(request, parseFiscalRequestScope\(request\), \{ write: true \}\)/);
  });

  it("keeps artifacts private and downloaded through the server", () => {
    assert.match(artifactRoute, /Content-Disposition/);
    assert.match(artifactRoute, /attachment; filename=/);
    assert.match(artifactRoute, /Cache-Control/);
    assert.match(artifactRoute, /private, no-store/);
    assert.match(service, /client\.storage\.from\(dossier\.storageBucket\)/);
    assert.match(service, /storage\.download/);
    for (const source of [service, artifactRoute, ui]) {
      assert.doesNotMatch(source, /createSignedUrl|getPublicUrl|publicUrl|service_role|SUPABASE_SERVICE_ROLE/i);
    }
  });

  it("declares a private Supabase bucket with company-scoped access", () => {
    assert.match(schema, /values \('irpj-csll-dossiers', 'irpj-csll-dossiers',\s*false\)/);
    assert.match(schema, /on conflict \(id\) do update set public = false/);
    assert.match(schema, /bucket_id = 'irpj-csll-dossiers'/);
    assert.match(schema, /\(storage\.foldername\(name\)\)\[1\] = 'IRPJ-CSLL'/);
    assert.match(schema, /ue\.empresa_id::text =\s*\(storage\.foldername\(name\)\)\[2\]/);
    assert.match(schema, /public\.usuario_tem_modulo\('contabil', auth\.uid\(\)\)/);
    assert.match(schema, /lower\(trim\(ue\.perfil\)\) <> 'consulta'/);
  });

  it("persists dossier metadata separately from closed period data", () => {
    assert.match(schema, /create table if not exists public\.tax_dossiers/);
    assert.match(schema, /artifact_metadata jsonb not null default '\[\]'::jsonb/);
    assert.match(schema, /manifest_hash text not null/);
    assert.match(schema, /tax_dossiers_chave_logica_unica unique \(chave_logica\)/);
    assert.match(schema, /alter table public\.tax_dossiers enable row level security/);
    assert.match(repository, /export async function listTaxDossiers/);
    assert.match(repository, /export async function getTaxDossierByTaxPeriod/);
    assert.match(repository, /export async function insertTaxDossier/);
    assert.match(repository, /export async function upsertTaxDossierGenerationFailure/);
  });

  it("does not query live TOTVS or recalculate tax while building a dossier", () => {
    assert.doesNotMatch(service, /QueryDataEngine|fetchTrialBalance|fetchAccounting|TOTVS|totvs/i);
    assert.doesNotMatch(service, /calculateAnnualMonthly|previewTaxPeriod|openNewTaxPeriodVersion|reprocessTaxPeriod/);
    assert.match(service, /loadDossierModel/);
    assert.match(service, /listSourceSnapshots/);
    assert.match(service, /listTaxCalculations/);
    assert.match(service, /buildMonthlyTaxDossierPackage/);
  });

  it("limits the official dossier to closed monthly estimate versions", () => {
    assert.match(dossier, /period\.status !== "CLOSED_CURRENT" && period\.status !== "CLOSED_SUPERSEDED"/);
    assert.match(dossier, /DOSSIER_VERSION_NOT_CLOSED/);
    assert.match(service, /assertMonthlyEstimatePeriod/);
    assert.match(service, /period\.periodType !== "MONTHLY_ESTIMATE"/);
    assert.match(service, /DOSSIER_PERIOD_NOT_MONTHLY/);
    assert.match(service, /period\.periodType === "MONTHLY_ESTIMATE" && period\.endDate\.slice\(0, 7\) === competence/);
  });

  it("exposes UI dossier actions without fiscal logic or direct storage credentials", () => {
    assert.match(ui, /runDossierGenerate/);
    assert.match(ui, /downloadDossierArtifact/);
    assert.match(ui, /viewDossierManifest/);
    assert.match(ui, /viewDossierComparison/);
    assert.match(ui, /Authorization: `Bearer \$\{accessToken\}`/);
    assert.doesNotMatch(ui, /calculateAnnualMonthly|IRPJ_RATE|CSLL_RATE|taxDueCumulative\s*=|currentMonthTaxPayable\s*=/);
    assert.doesNotMatch(ui, /service_role|SUPABASE_SERVICE_ROLE|createSignedUrl|getPublicUrl/i);
  });

  it("keeps IRRF evidence split by nature instead of producing a synthetic total", () => {
    assert.match(dossier, /IRRF_SERVICOS/);
    assert.match(dossier, /IRRF_APLICACOES_FINANCEIRAS/);
    assert.match(ui, /IRRF – Serviços/);
    assert.match(ui, /IRRF – Aplicações Financeiras/);
    assert.doesNotMatch(dossier, /Total IRRF/);
    assert.doesNotMatch(ui, /Total IRRF/);
  });
});
