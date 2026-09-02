import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  classifyHomologationPending,
  closeHomologationMonthly,
  compareHomologationDossierVersions,
  confirmHomologationAutomaticClassification,
  correctHomologationAutomaticClassification,
  generateHomologationDossier,
  getHomologationDossierArtifact,
  getHomologationDossierManifest,
  loadHomologationDashboard,
  openHomologationVersion,
  previewHomologationMonthly,
  reprocessHomologationMonthly,
  resetIrpjCsllHomologationStoreForTests,
  resolveHomologationConditional,
} from "../lib/fiscal/homologation-data.ts";
import { previewIrpjCsllMonthly } from "../lib/fiscal/monthly-workflow-service.ts";
import {
  IRPJ_CSLL_HOMOLOGATION_COMPANY,
  IRPJ_CSLL_HOMOLOGATION_TOKEN,
} from "../lib/fiscal/homologation-mode.ts";

const mutableEnv = process.env as Record<string, string | undefined>;
mutableEnv.NODE_ENV = "development";
mutableEnv.NEXT_PUBLIC_IRPJ_CSLL_HOMOLOGATION_MODE = "true";

function request(competence: string, params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/irpj-csll");
  url.searchParams.set("companyId", IRPJ_CSLL_HOMOLOGATION_COMPANY.id);
  url.searchParams.set("competence", competence);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url, {
    headers: { Authorization: `Bearer ${IRPJ_CSLL_HOMOLOGATION_TOKEN}` },
  });
}

function assertMoney(actual: string | undefined, expected: string) {
  assert.equal(actual, expected);
}

function sha256(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pdfPageCount(bytes: Buffer) {
  return bytes.toString("latin1").match(/\/Type\s+\/Page\b/g)?.length ?? 0;
}

describe("IRPJ/CSLL homologation local fixture", () => {
  it("loads the March 2026 closed current scenario with canonical golden numbers", async () => {
    resetIrpjCsllHomologationStoreForTests();

    const dashboard = await loadHomologationDashboard(request("2026-03"));

    assert.equal(dashboard.company.name, "Empresa Homologação IRPJ/CSLL");
    assert.equal(dashboard.engine.code, "ANNUAL_MONTHLY");
    assert.equal(dashboard.fiscalYearProfile?.taxRegime, "REAL_PROFIT");
    assert.equal(dashboard.fiscalYearProfile?.periodicity, "ANNUAL");
    assert.equal(dashboard.taxPeriod?.periodCode, "2026-M03");
    assert.equal(dashboard.taxPeriod?.version, 2);
    assert.equal(dashboard.taxPeriod?.status, "CLOSED_CURRENT");

    const v1 = dashboard.periodVersions.find((period) => period.version === 1);
    const v2 = dashboard.periodVersions.find((period) => period.version === 2);
    assert.equal(v1?.status, "CLOSED_SUPERSEDED");
    assert.equal(v2?.status, "CLOSED_CURRENT");

    assert.equal(dashboard.sourceSnapshot?.taxPeriod.startDate, "2026-01-01");
    assert.equal(dashboard.sourceSnapshot?.taxPeriod.endDate, "2026-03-31");
    assert.equal(dashboard.sourceSnapshot?.parameters.startDate, "2026-01-01");
    assert.equal(dashboard.sourceSnapshot?.parameters.endDate, "2026-03-31");
    assert.equal(dashboard.sourceSnapshot?.parameters.includeClosingEntries, false);
    assert.equal(dashboard.sourceSnapshot?.source, "TOTVS_BALANCETE_CANONICAL");
    assert.equal(dashboard.sourceSnapshot?.provider, "TOTVS_RM_ADAPTER");
    assert.match(dashboard.sourceSnapshot?.hash ?? "", /^[a-f0-9]{64}$/);

    const calculation = dashboard.taxCalculation;
    assert.ok(calculation, "March calculation should be selected");
    assert.equal(calculation.engine, "ANNUAL_MONTHLY");
    assert.equal(calculation.matrixVersion, "MATRIZ_FISCAL_V53");
    assertMoney(calculation.irpj.taxableBase, "850000.00");
    assertMoney(calculation.irpj.normalTax, "127500.00");
    assertMoney(calculation.irpj.additionalTax, "79000.00");
    assertMoney(calculation.irpj.taxDueCumulative, "206500.00");
    assertMoney(calculation.irpj.priorEstimateTaxDue, "128500.00");
    assertMoney(calculation.irpj.eligibleCreditsUsed, "10000.00");
    assertMoney(calculation.irpj.currentMonthTaxPayable, "68000.00");
    assertMoney(calculation.csll.baseBeforeCompensation, "1050000.00");
    assertMoney(calculation.csll.compensationUsed, "100000.00");
    assertMoney(calculation.csll.taxableBase, "950000.00");
    assertMoney(calculation.csll.taxDueCumulative, "85500.00");
    assertMoney(calculation.csll.priorEstimateTaxDue, "55600.00");
    assertMoney(calculation.csll.eligibleCreditsUsed, "4000.00");
    assertMoney(calculation.csll.currentMonthTaxPayable, "25900.00");

    const priorIrpj = calculation.irpj.priorEstimateReferences.map((item) => item.currentMonthTaxPayable);
    assert.deepEqual(priorIrpj, ["55000.00", "73500.00"]);
    assert.ok(dashboard.taxAdjustments.some((item) => item.accountCode === "4.2.1.02.03.11 — Brindes e Cortesias" && item.tax === "IRPJ" && item.adjustmentType === "ADDITION"));
    assert.ok(dashboard.taxAdjustments.some((item) => item.accountCode === "4.2.1.02.03.11 — Brindes e Cortesias" && item.tax === "CSLL" && item.adjustmentType === "ADDITION"));
    assert.ok(dashboard.taxAdjustments.some((item) => item.accountCode === "3.1.1.02.01.10 — Exclusão fiscal rastreada" && item.tax === "IRPJ" && item.adjustmentType === "EXCLUSION"));
    assert.ok(dashboard.taxAdjustments.some((item) => item.accountCode === "3.1.1.02.01.10 — Exclusão fiscal rastreada" && item.tax === "CSLL" && item.adjustmentType === "EXCLUSION"));
  });

  it("keeps every March version after V02 on the current IRPJ/CSLL fixture", async () => {
    resetIrpjCsllHomologationStoreForTests();
    const initial = await loadHomologationDashboard(request("2026-03"));
    const v2Period = initial.periodVersions.find((period) => period.version === 2);
    const v2Calculation = initial.taxCalculations.find((calculation) => calculation.taxPeriodId === v2Period?.id);
    assert.equal(v2Period?.status, "CLOSED_CURRENT");
    assert.ok(v2Calculation);

    const opened = await openHomologationVersion(request("2026-03"));
    assert.equal(opened.taxPeriod?.periodCode, "2026-M03");
    assert.equal(opened.taxPeriod?.version, 3);
    assert.equal(opened.taxPeriod?.status, "DRAFT");
    assert.equal(opened.sourceSnapshot?.taxPeriodId, opened.taxPeriod?.id);
    assert.equal(opened.sourceSnapshot?.parameters.startDate, "2026-01-01");
    assert.equal(opened.sourceSnapshot?.parameters.endDate, "2026-03-31");
    assert.equal(opened.sourceSnapshot?.parameters.accountingResultBeforeIrpjYtd, "910000.00");
    assert.equal(opened.sourceSnapshot?.parameters.accountingResultBeforeCsllYtd, "1000000.00");
    assert.equal(opened.taxCalculation, null);
    assert.equal(opened.periodVersions.find((period) => period.version === 2)?.status, "CLOSED_CURRENT");
    assert.equal(opened.taxCalculations.find((calculation) => calculation.id === v2Calculation.id)?.csll.currentMonthTaxPayable, v2Calculation.csll.currentMonthTaxPayable);
    assert.ok(opened.taxAdjustments.some((item) => item.accountCode === "4.2.1.02.03.11 — Brindes e Cortesias" && item.tax === "CSLL" && item.adjustmentType === "ADDITION"));
    assert.ok(opened.taxAdjustments.some((item) => item.accountCode === "3.1.1.02.01.10 — Exclusão fiscal rastreada" && item.tax === "CSLL" && item.adjustmentType === "EXCLUSION"));
    const csllDueAdjustment = opened.taxAdjustments.find((item) => item.accountCode === "HOMOLOGACAO_V03_CSLL_DEVIDA" && item.tax === "IRPJ" && item.adjustmentType === "ADDITION");
    assert.equal(csllDueAdjustment?.value, "90000.00");
    assert.equal(opened.ruleExecutionResults.find((item) => item.id === csllDueAdjustment?.ruleExecutionResultId)?.accountDescription, "CSLL devida");
    assert.equal(opened.taxAdjustments.some((item) => item.accountCode === "HOMOLOGACAO_V03_CSLL_DEVIDA" && item.tax === "CSLL"), false);

    const preview = await previewHomologationMonthly(request("2026-03"));
    assert.equal(preview.taxPeriod?.version, 3);
    assert.equal(preview.taxCalculation?.taxPeriodId, opened.taxPeriod?.id);
    assert.equal(preview.taxCalculation?.versionStatus, "DRAFT");
    assertMoney(preview.taxCalculation?.irpj.accountingResultYtd, "910000.00");
    assertMoney(preview.taxCalculation?.irpj.totalAdditions, "190000.00");
    assertMoney(preview.taxCalculation?.irpj.totalExclusions, "50000.00");
    assertMoney(preview.taxCalculation?.irpj.baseBeforeCompensation, "1050000.00");
    assertMoney(preview.taxCalculation?.csll.accountingResultYtd, "1000000.00");
    assertMoney(preview.taxCalculation?.csll.totalAdditions, "100000.00");
    assertMoney(preview.taxCalculation?.csll.totalExclusions, "50000.00");
    assertMoney(preview.taxCalculation?.csll.baseBeforeCompensation, "1050000.00");
    assertMoney(preview.taxCalculation?.csll.compensationUsed, "100000.00");
    assertMoney(preview.taxCalculation?.csll.taxableBase, "950000.00");
    assertMoney(preview.taxCalculation?.csll.taxDueCumulative, "85500.00");
    assertMoney(preview.taxCalculation?.csll.priorEstimateTaxDue, "55600.00");
    assertMoney(preview.taxCalculation?.csll.eligibleCreditsUsed, "4000.00");
    assertMoney(preview.taxCalculation?.csll.currentMonthTaxPayable, "25900.00");
    assert.equal(preview.periodVersions.find((period) => period.version === 2)?.status, "CLOSED_CURRENT");
    assert.equal(preview.closeAllowed, true);

    const closedV3 = await closeHomologationMonthly(request("2026-03"));
    assert.equal(closedV3.taxPeriod?.version, 3);
    assert.equal(closedV3.taxPeriod?.status, "CLOSED_CURRENT");

    const openedV4 = await openHomologationVersion(request("2026-03"));
    assert.equal(openedV4.taxPeriod?.version, 4);
    assert.equal(openedV4.taxPeriod?.status, "DRAFT");
    assert.equal(openedV4.sourceSnapshot?.parameters.accountingResultBeforeIrpjYtd, "910000.00");
    assert.equal(openedV4.sourceSnapshot?.parameters.accountingResultBeforeCsllYtd, "1000000.00");
    const v4CsllDueAdjustment = openedV4.taxAdjustments.find((item) => item.taxPeriodId === openedV4.taxPeriod?.id && item.accountCode === "HOMOLOGACAO_V03_CSLL_DEVIDA" && item.tax === "IRPJ" && item.adjustmentType === "ADDITION");
    assert.equal(v4CsllDueAdjustment?.value, "90000.00");
    assert.equal(openedV4.ruleExecutionResults.find((item) => item.id === v4CsllDueAdjustment?.ruleExecutionResultId)?.accountDescription, "CSLL devida");
    assert.equal(openedV4.taxAdjustments.some((item) => item.taxPeriodId === openedV4.taxPeriod?.id && item.accountCode === "HOMOLOGACAO_V03_CSLL_DEVIDA" && item.tax === "CSLL"), false);

    const previewV4 = await previewIrpjCsllMonthly(request("2026-03"));
    assert.equal(previewV4.taxPeriod?.version, 4);
    assert.equal(previewV4.taxPeriod?.status, "CALCULATED");
    assert.equal(previewV4.taxCalculation?.taxPeriodId, openedV4.taxPeriod?.id);
    assert.equal(previewV4.taxCalculation?.versionStatus, "DRAFT");
    assertMoney(previewV4.taxCalculation?.irpj.accountingResultYtd, "910000.00");
    assertMoney(previewV4.taxCalculation?.irpj.totalAdditions, "190000.00");
    assertMoney(previewV4.taxCalculation?.irpj.totalExclusions, "50000.00");
    assertMoney(previewV4.taxCalculation?.irpj.baseBeforeCompensation, "1050000.00");
    assertMoney(previewV4.taxCalculation?.csll.accountingResultYtd, "1000000.00");
    assertMoney(previewV4.taxCalculation?.csll.totalAdditions, "100000.00");
    assertMoney(previewV4.taxCalculation?.csll.totalExclusions, "50000.00");
    assertMoney(previewV4.taxCalculation?.csll.baseBeforeCompensation, "1050000.00");
  });
  it("keeps April open with accumulated snapshot dates, L2/L3/L4 and conditional pending flow", async () => {
    resetIrpjCsllHomologationStoreForTests();

    const initial = await loadHomologationDashboard(request("2026-04"));
    assert.equal(initial.taxPeriod?.periodCode, "2026-M04");
    assert.equal(initial.taxPeriod?.status, "DRAFT");
    assert.equal(initial.sourceSnapshot?.parameters.startDate, "2026-01-01");
    assert.equal(initial.sourceSnapshot?.parameters.endDate, "2026-04-30");
    assert.equal(initial.sourceSnapshot?.parameters.includeClosingEntries, false);
    assert.equal(initial.closeAllowed, false);
    assert.ok(initial.pendingItems.some((item) => item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED" && !item.blocking));
    assert.ok(initial.pendingItems.some((item) => item.type === "NEW_ACCOUNT_UNMAPPED" && item.blocking));
    assert.ok(initial.pendingItems.some((item) => item.type === "CONDITIONAL_TAX_DECISION" && item.blocking));

    const preview = await previewHomologationMonthly(request("2026-04"));
    assert.equal(preview.taxCalculation?.status, "CALCULATED_WITH_PENDING_ITEMS");
    assert.equal(preview.closeAllowed, false);

    const l3 = preview.pendingItems.find((item) => item.type === "NEW_ACCOUNT_UNMAPPED");
    const conditional = preview.pendingItems.find((item) => item.type === "CONDITIONAL_TAX_DECISION");
    assert.ok(l3);
    assert.ok(conditional);

    const afterClassify = await classifyHomologationPending(request("2026-04"), l3.id, {
      fiscalNatureCode: "HOMOLOG_L3",
      fiscalNatureName: "Natureza homologada L3",
      fiscalRuleCode: "HOMOLOG_L3_RULE",
      irpjTreatment: "NO_ADJUSTMENT",
      csllTreatment: "NO_ADJUSTMENT",
      amountBasis: "NET_DEBIT_MOVEMENT",
      justification: "Homologação local da conta L3.",
    });
    assert.equal(afterClassify.pendingItems.find((item) => item.id === l3.id)?.status, "RESOLVED");

    const afterConditional = await resolveHomologationConditional(request("2026-04"), conditional.id, {
      irpjDecision: "ADDITION",
      csllDecision: "NO_ADJUSTMENT",
      amount: "25000.00",
      justification: "Decisão condicional de homologação.",
    });
    assert.equal(afterConditional.pendingItems.find((item) => item.id === conditional.id)?.status, "RESOLVED");

    const reprocessed = await reprocessHomologationMonthly(request("2026-04"));
    assert.equal(reprocessed.pendingItems.filter((item) => item.blocking && item.status === "OPEN").length, 0);
    assert.equal(reprocessed.pendingItems.filter((item) => item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED" && item.status === "OPEN").length, 1);
    assert.ok(reprocessed.humanDecisions.length >= 2);
    assert.equal(reprocessed.closeAllowed, false);
    assert.ok(reprocessed.closeIssues.some((issue) => issue.code === "AUTO_CLASSIFICATION_CONFIRMATION_REQUIRED"));
    assert.ok(reprocessed.taxAdjustments.some((item) => item.accountCode === "4.2.1.07.04.09" && item.value === "25000.00"));

    const l2 = reprocessed.pendingItems.find((item) => item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED");
    assert.ok(l2);
    const afterConfirm = await confirmHomologationAutomaticClassification(request("2026-04"), l2.id);
    assert.equal(afterConfirm.pendingItems.find((item) => item.id === l2.id)?.status, "RESOLVED");
    assert.equal(afterConfirm.humanDecisions.at(-1)?.decisionType, "NEW_ACCOUNT_CLASSIFICATION");
    assert.equal(afterConfirm.humanDecisions.at(-1)?.afterState.confirmationStatus, "CONFIRMED");
    assert.equal(afterConfirm.closeAllowed, true);
  });

  it("keeps automatic classification correction auditable and requires justification", async () => {
    resetIrpjCsllHomologationStoreForTests();
    const preview = await previewHomologationMonthly(request("2026-04"));
    const l2 = preview.pendingItems.find((item) => item.type === "NEW_ACCOUNT_AUTO_CLASSIFIED");
    assert.ok(l2);

    await assert.rejects(
      () => correctHomologationAutomaticClassification(request("2026-04"), l2.id, {
        fiscalNatureCode: "HOMOLOG_L2_CORRIGIDA",
        fiscalNatureName: "Natureza homologada L2 corrigida",
        fiscalRuleCode: "HOMOLOG_L2_CORRIGIDA_RULE",
        irpjTreatment: "ADDITION",
        csllTreatment: "NO_ADJUSTMENT",
        amountBasis: "NET_DEBIT_MOVEMENT",
        justification: "curta",
      }),
      /Justificativa/,
    );

    const corrected = await correctHomologationAutomaticClassification(request("2026-04"), l2.id, {
      fiscalNatureCode: "HOMOLOG_L2_CORRIGIDA",
      fiscalNatureName: "Natureza homologada L2 corrigida",
      fiscalRuleCode: "HOMOLOG_L2_CORRIGIDA_RULE",
      irpjTreatment: "ADDITION",
      csllTreatment: "NO_ADJUSTMENT",
      amountBasis: "NET_DEBIT_MOVEMENT",
      justification: "Correção auditável da classificação automática L2.",
    });
    const decision = corrected.humanDecisions.at(-1);
    assert.equal(corrected.pendingItems.find((item) => item.id === l2.id)?.status, "RESOLVED");
    assert.equal((decision?.beforeState.originalAutomaticClassification as Record<string, unknown>).accountCode, "4.2.1.05.03.17");
    assert.equal((decision?.afterState.correctedClassification as Record<string, unknown>).irpjTreatment, "ADDITION");
  });

  it("generates, downloads and compares a March V02 dossier through the real dossier code", async () => {
    resetIrpjCsllHomologationStoreForTests();
    const dashboard = await loadHomologationDashboard(request("2026-03"));
    assert.ok(dashboard.taxPeriod);

    const generated = await generateHomologationDossier(request("2026-03"), { taxPeriodId: dashboard.taxPeriod.id });
    assert.equal(generated.status, "DOSSIER_GENERATED");
    assert.equal(generated.dossier.taxPeriodVersion, 2);
    assert.equal(generated.dossier.status, "AVAILABLE");
    assert.ok(generated.dossier.artifactMetadata.some((artifact) => artifact.type === "XLSX"));
    assert.ok(generated.dossier.artifactMetadata.some((artifact) => artifact.type === "PDF"));
    assert.ok(generated.dossier.artifactMetadata.some((artifact) => artifact.type === "COMPARISON_JSON"));

    const manifest = await getHomologationDossierManifest(request("2026-03", { dossierId: generated.dossier.id }));
    assert.equal(manifest.manifestHash, generated.dossier.manifestHash);
    assert.equal(manifest.manifest.companyName, "Empresa Homologação IRPJ/CSLL");
    assert.equal(manifest.manifest.periodCode, "2026-M03");

    const xlsx = await getHomologationDossierArtifact(request("2026-03", { dossierId: generated.dossier.id, artifact: "xlsx" }));
    const workbook = XLSX.read(xlsx.bytes, { type: "buffer", cellStyles: true });
    assert.ok(workbook.SheetNames.includes("Resumo"));
    assert.ok(workbook.SheetNames.includes("Comparativo_Versoes"));
    const workbookValues = workbook.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false }) as string[][]).flat().map(String);
    assert.ok(workbookValues.includes("APURAÇÃO IRPJ/CSLL — LUCRO REAL"));
    assert.ok(workbookValues.includes("Empresa Homologação IRPJ/CSLL"));
    assert.ok(workbookValues.includes("Março/2026"));

    const pdf = await getHomologationDossierArtifact(request("2026-03", { dossierId: generated.dossier.id, artifact: "pdf" }));
    assert.equal(pdf.bytes.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.match(pdf.bytes.toString("latin1"), /WinAnsiEncoding/);
    assert.match(pdf.bytes.toString("latin1"), /Competência: Março\/2026/);

    const comparison = await compareHomologationDossierVersions(request("2026-03", { dossierId: generated.dossier.id }));
    assert.equal(comparison.comparison?.previousVersion, "V01");
    assert.equal(comparison.comparison?.currentVersion, "V02");
    assert.ok((comparison.comparison?.rows.length ?? 0) > 0);
    assert.ok(!comparison.comparison?.rows.some((row) => row.metric === "sourceSnapshotHash" || row.metric === "Matrix version" || row.metric === "rule versions"));

    const second = await generateHomologationDossier(request("2026-03"), { taxPeriodId: dashboard.taxPeriod.id });
    assert.equal(second.status, "DOSSIER_ALREADY_EXISTS");
  });

  it("rematerializes stale homologation artifacts without changing the closed V02 fiscal version", async () => {
    const store = resetIrpjCsllHomologationStoreForTests();
    const dashboard = await loadHomologationDashboard(request("2026-03"));
    assert.ok(dashboard.taxPeriod);

    const generated = await generateHomologationDossier(request("2026-03"), { taxPeriodId: dashboard.taxPeriod.id });
    const pdfMetadata = generated.dossier.artifactMetadata.find((artifact) => artifact.type === "PDF");
    const xlsxMetadata = generated.dossier.artifactMetadata.find((artifact) => artifact.type === "XLSX");
    assert.ok(pdfMetadata);
    assert.ok(xlsxMetadata);

    const stalePdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF", "latin1");
    const staleXlsx = Buffer.from("old homologation xlsx bytes", "utf8");
    const storedArtifacts = store.artifacts.get(generated.dossier.id);
    assert.ok(storedArtifacts);
    storedArtifacts.set(pdfMetadata.relativePath, stalePdf);
    storedArtifacts.set(xlsxMetadata.relativePath, staleXlsx);

    const dossierIndex = store.dossiers.findIndex((dossier) => dossier.id === generated.dossier.id);
    assert.notEqual(dossierIndex, -1);
    store.dossiers[dossierIndex] = {
      ...generated.dossier,
      manifestHash: "0".repeat(64),
      artifactMetadata: generated.dossier.artifactMetadata.map((artifact) => {
        if (artifact.type === "PDF") return { ...artifact, hashSha256: sha256(stalePdf), sizeBytes: stalePdf.length };
        if (artifact.type === "XLSX") return { ...artifact, hashSha256: sha256(staleXlsx), sizeBytes: staleXlsx.length };
        return artifact;
      }),
    };

    const pdf = await getHomologationDossierArtifact(request("2026-03", { dossierId: generated.dossier.id, artifact: "pdf" }));
    assert.equal(pdf.dossier.id, generated.dossier.id);
    assert.equal(pdf.dossier.taxPeriodId, generated.dossier.taxPeriodId);
    assert.equal(pdf.dossier.taxPeriodVersion, 2);
    assert.notEqual(sha256(pdf.bytes), sha256(stalePdf));
    assert.equal(sha256(pdf.bytes), pdf.dossier.artifactMetadata.find((artifact) => artifact.type === "PDF")?.hashSha256);
    assert.equal(pdfPageCount(pdf.bytes), 3);
    assert.match(pdf.bytes.toString("latin1"), /APURAÇÃO IRPJ\/CSLL/);

    const xlsx = await getHomologationDossierArtifact(request("2026-03", { dossierId: generated.dossier.id, artifact: "xlsx" }));
    assert.notEqual(sha256(xlsx.bytes), sha256(staleXlsx));
    assert.equal(sha256(xlsx.bytes), xlsx.dossier.artifactMetadata.find((artifact) => artifact.type === "XLSX")?.hashSha256);
    const workbook = XLSX.read(xlsx.bytes, { type: "buffer", cellStyles: true });
    const resumo = XLSX.utils.sheet_to_json(workbook.Sheets.Resumo, { header: 1, raw: false }) as string[][];
    assert.ok(resumo.flat().map(String).includes("APURAÇÃO IRPJ/CSLL — LUCRO REAL"));

    const regenerated = await generateHomologationDossier(request("2026-03"), { taxPeriodId: dashboard.taxPeriod.id });
    assert.equal(regenerated.status, "DOSSIER_ALREADY_EXISTS");
    assert.equal(regenerated.dossier.manifestHash, xlsx.dossier.manifestHash);
  });

  it("is explicitly disabled outside the local development flag", async () => {
    resetIrpjCsllHomologationStoreForTests();
    const previous = mutableEnv.NEXT_PUBLIC_IRPJ_CSLL_HOMOLOGATION_MODE;
    mutableEnv.NEXT_PUBLIC_IRPJ_CSLL_HOMOLOGATION_MODE = "false";
    await assert.rejects(() => loadHomologationDashboard(request("2026-03")), { code: "HOMOLOGATION_MODE_DISABLED" });
    mutableEnv.NEXT_PUBLIC_IRPJ_CSLL_HOMOLOGATION_MODE = previous;
  });
});
