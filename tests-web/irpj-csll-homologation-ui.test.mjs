import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const page = readFileSync(resolve(root, "app/page.tsx"), "utf8");
const workflowService = readFileSync(resolve(root, "lib/fiscal/monthly-workflow-service.ts"), "utf8");
const dossierService = readFileSync(resolve(root, "lib/fiscal/monthly-dossier-service.ts"), "utf8");
const mode = readFileSync(resolve(root, "lib/fiscal/homologation-mode.ts"), "utf8");
const data = readFileSync(resolve(root, "lib/fiscal/homologation-data.ts"), "utf8");
const envExample = readFileSync(resolve(root, ".env.example"), "utf8");
const proxy = readFileSync(resolve(root, "proxy.ts"), "utf8");

describe("IRPJ/CSLL local homologation wiring", () => {
  it("keeps the homologation switch local and explicitly disabled by default", () => {
    assert.match(mode, /env\.NODE_ENV === "development"/);
    assert.match(mode, /IRPJ_CSLL_SERVER_HOMOLOGATION_FLAG/);
    assert.match(mode, /process\.env\.NEXT_PUBLIC_IRPJ_CSLL_HOMOLOGATION_MODE/);
    assert.match(mode, /enabled === "true"/);
    assert.match(envExample, /^IRPJ_CSLL_HOMOLOGATION_MODE=false$/m);
    assert.match(envExample, /^NEXT_PUBLIC_IRPJ_CSLL_HOMOLOGATION_MODE=false$/m);
  });

  it("keeps fiscal logic out of the React component", () => {
    assert.match(page, /IrpjCsllAssessment/);
    assert.match(page, /isIrpjCsllHomologationMode/);
    assert.doesNotMatch(page, /homologation-data/);
    assert.doesNotMatch(page, /calculateAnnualMonthly/);
    assert.match(page, /!configured && !homologationMode/);
  });

  it("lets only the IRPJ/CSLL homologation token bypass the global API proxy in local mode", () => {
    assert.match(proxy, /isIrpjCsllHomologationToken/);
    assert.match(proxy, /request\.nextUrl\.pathname\.startsWith\("\/api\/irpj-csll"\)/);
    assert.doesNotMatch(proxy, /api\/totvs[\s\S]*isIrpjCsllHomologationToken/);
  });

  it("routes the real services to the fixture only when homologation mode is active", () => {
    assert.match(workflowService, /if \(isIrpjCsllHomologationMode\(\)\) return loadHomologationDashboard\(request\)/);
    assert.match(workflowService, /if \(isIrpjCsllHomologationMode\(\)\) return previewHomologationMonthly\(request, payload\)/);
    assert.match(workflowService, /if \(isIrpjCsllHomologationMode\(\)\) return reprocessHomologationMonthly\(request, payload\)/);
    assert.match(dossierService, /if \(isIrpjCsllHomologationMode\(\)\) return generateHomologationDossier\(request, payload\)/);
    assert.match(dossierService, /if \(isIrpjCsllHomologationMode\(\)\) return getHomologationDossierArtifact\(request\)/);
  });

  it("uses the existing fiscal engine, period foundation and dossier builders", () => {
    assert.match(data, /buildTaxPeriodsForProfile\(FISCAL_YEAR_PROFILE\)/);
    assert.match(data, /calculateAnnualMonthly\(/);
    assert.match(data, /buildMonthlyTaxDossierPackage\(/);
    assert.match(data, /includeClosingEntries: false/);
    assert.match(data, /TOTVS_BALANCETE_CANONICAL/);
    assert.doesNotMatch(data, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(data, /DATA_ENGINE_PRIVATE_KEY/);
  });
});