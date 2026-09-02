import { createHash } from "node:crypto";
import {
  compareHomologationDossierVersions,
  generateHomologationDossier,
  getHomologationDossierArtifact,
  getHomologationDossierManifest,
  listHomologationDossiers,
} from "./homologation-data.ts";
import { isIrpjCsllHomologationMode } from "./homologation-mode.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMonthlyTaxDossierModel,
  buildMonthlyTaxDossierPackage,
  buildTaxDossierRecord,
  monthlyDossierStoragePrefix,
  TAX_DOSSIER_BUCKET,
  TaxDossierError,
  verifyExistingDossierIntegrity,
  type MonthlyTaxDossierArtifact,
  type MonthlyTaxDossierComparison,
  type TaxDossierRecord,
} from "./monthly-dossier.ts";
import type { TaxCalculation } from "./annual-monthly-engine.ts";
import type { TaxPeriodCloseManifest, WorkflowTaxPeriod } from "./monthly-workflow.ts";
import {
  getTaxDossier,
  getTaxDossierByTaxPeriod,
  insertTaxDossier,
  listFiscalYearProfiles,
  listPendingItems,
  listRuleExecutionResults,
  listSourceSnapshots,
  listTaxAdjustments,
  listTaxCalculations,
  listTaxDossiers,
  listTaxWorkflowHumanDecisions,
  listTaxPeriods,
  upsertTaxDossierGenerationFailure,
} from "./repository.ts";
import type { JsonObject, SourceSnapshot } from "./types.ts";
import {
  fiscalAccessErrorResponse,
  parseFiscalRequestScope,
  requireFiscalAccess,
  type FiscalAccessContext,
} from "../server/fiscal-access.ts";

export type DossierOperationStatus = "DOSSIER_GENERATED" | "DOSSIER_ALREADY_EXISTS";

export type IrpjCsllDossierListResponse = {
  readonly ok: true;
  readonly bucketPrivate: true;
  readonly bucket: typeof TAX_DOSSIER_BUCKET;
  readonly dossiers: readonly TaxDossierRecord[];
};

export type GenerateMonthlyDossierResponse = {
  readonly ok: true;
  readonly status: DossierOperationStatus;
  readonly dossier: TaxDossierRecord;
};

export type MonthlyDossierArtifactResponse = {
  readonly dossier: TaxDossierRecord;
  readonly artifact: MonthlyTaxDossierArtifact;
  readonly bytes: Buffer;
};

export type MonthlyDossierManifestResponse = {
  readonly ok: true;
  readonly dossier: TaxDossierRecord;
  readonly manifest: JsonObject;
  readonly manifestHash: string;
};

export type MonthlyDossierCompareResponse = {
  readonly ok: true;
  readonly dossier: TaxDossierRecord;
  readonly comparison: MonthlyTaxDossierComparison | null;
};

type DossierPayload = {
  readonly taxPeriodId?: unknown;
};

export class DossierServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function dossierServiceErrorResponse(error: unknown) {
  if (error instanceof DossierServiceError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message } };
  }
  if (error instanceof TaxDossierError) {
    return { status: 409, body: { ok: false, code: error.code, message: error.message } };
  }
  return fiscalAccessErrorResponse(error);
}

function fiscalYearFromCompetence(competence: string) {
  return Number(competence.slice(0, 4));
}

function requiredText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new DossierServiceError(400, "MISSING_FIELD", `${label} obrigatório.`);
  return text;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function dossierLogicalKey(period: WorkflowTaxPeriod) {
  return `TAX_DOSSIER:${period.id}:${period.version}`;
}

function deterministicDossierId(period: WorkflowTaxPeriod) {
  return createHash("sha256")
    .update(dossierLogicalKey(period))
    .digest("hex")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

function asClosedManifest(period: WorkflowTaxPeriod): TaxPeriodCloseManifest | JsonObject {
  if (period.closedManifest && Object.keys(period.closedManifest).length) return period.closedManifest;
  throw new DossierServiceError(409, "MISSING_CLOSED_MANIFEST", "Versão fechada não possui manifesto lógico congelado.");
}

function assertClosedPeriod(period: WorkflowTaxPeriod) {
  if (period.status !== "CLOSED_CURRENT" && period.status !== "CLOSED_SUPERSEDED") {
    throw new DossierServiceError(409, "DOSSIER_VERSION_NOT_CLOSED", "Dossiê oficial só pode ser gerado para CLOSED_CURRENT ou CLOSED_SUPERSEDED.");
  }
}


function assertMonthlyEstimatePeriod(period: WorkflowTaxPeriod) {
  if (period.periodType !== "MONTHLY_ESTIMATE") {
    throw new DossierServiceError(409, "DOSSIER_PERIOD_NOT_MONTHLY", "Dossiê mensal oficial só pode ser gerado para MONTHLY_ESTIMATE nesta fase.");
  }
}
function artifactByKind(dossier: TaxDossierRecord, kind: string) {
  const normalized = kind.toLowerCase();
  return dossier.artifactMetadata.find((artifact) => {
    if (normalized === "xlsx") return artifact.type === "XLSX";
    if (normalized === "pdf") return artifact.type === "PDF";
    if (normalized === "comparison") return artifact.type === "COMPARISON_JSON";
    return artifact.type === kind;
  }) ?? null;
}

async function readArtifactFromStorage(client: SupabaseClient, dossier: TaxDossierRecord, relativePath: string) {
  const storage = client.storage.from(dossier.storageBucket);
  const { data, error } = await storage.download(`${dossier.storagePrefix}${relativePath}`);
  if (error || !data) {
    throw new DossierServiceError(404, "DOSSIER_ARTIFACT_NOT_FOUND", "Artefato do dossiê não encontrado no Storage privado.");
  }
  return Buffer.from(await data.arrayBuffer());
}

async function uploadArtifactIfNeeded(client: SupabaseClient, bucket: string, prefix: string, artifact: MonthlyTaxDossierArtifact) {
  const storage = client.storage.from(bucket);
  const path = `${prefix}${artifact.relativePath}`;
  const existing = await storage.download(path);
  if (existing.data) {
    const existingBytes = Buffer.from(await existing.data.arrayBuffer());
    if (sha256(existingBytes) !== artifact.hashSha256) {
      throw new TaxDossierError("DOSSIER_ARTIFACT_HASH_MISMATCH", "Artefato existente no Storage privado possui hash divergente.");
    }
    return;
  }
  const uploaded = await storage.upload(path, artifact.bytes, {
    contentType: artifact.contentType,
    upsert: false,
  });
  if (uploaded.error) {
    const retry = await storage.download(path);
    if (retry.data) {
      const retryBytes = Buffer.from(await retry.data.arrayBuffer());
      if (sha256(retryBytes) === artifact.hashSha256) return;
    }
    throw new DossierServiceError(500, "DOSSIER_STORAGE_UPLOAD_FAILED", uploaded.error.message || "Falha ao gravar artefato no Storage privado.");
  }
}

async function uploadDossierArtifacts(client: SupabaseClient, dossierPackage: ReturnType<typeof buildMonthlyTaxDossierPackage>) {
  for (const artifact of dossierPackage.artifacts) {
    await uploadArtifactIfNeeded(client, dossierPackage.model.storageBucket, dossierPackage.model.storagePrefix, artifact);
  }
}

async function periodVersions(access: FiscalAccessContext) {
  const fiscalYear = fiscalYearFromCompetence(access.competence);
  return listTaxPeriods(access.client, access.company.id, fiscalYear);
}

function selectedTaxPeriod(periods: readonly WorkflowTaxPeriod[], taxPeriodId: unknown, competence: string) {
  if (taxPeriodId) {
    const target = periods.find((period) => period.id === String(taxPeriodId));
    if (!target) throw new DossierServiceError(404, "TAX_PERIOD_NOT_FOUND", "Período fiscal não encontrado para a empresa informada.");
    return target;
  }
  const closed = periods
    .filter((period) => period.status === "CLOSED_CURRENT")
    .filter((period) => period.periodType === "MONTHLY_ESTIMATE" && period.endDate.slice(0, 7) === competence)
    .sort((left, right) => right.version - left.version || right.endDate.localeCompare(left.endDate));
  const target = closed[0] ?? null;
  if (!target) throw new DossierServiceError(404, "CLOSED_TAX_PERIOD_NOT_FOUND", "Nenhuma versão fechada encontrada para a competência informada.");
  return target;
}

function taxCalculationForPeriod(period: WorkflowTaxPeriod, calculations: readonly TaxCalculation[]) {
  const manifest = period.closedManifest ?? {};
  const manifestCalculationId = typeof manifest.taxCalculationId === "string" ? manifest.taxCalculationId : null;
  const selected = manifestCalculationId
    ? calculations.find((calculation) => calculation.id === manifestCalculationId)
    : calculations.find((calculation) => calculation.versionStatus === "CLOSED_CURRENT" || calculation.versionStatus === "CLOSED_SUPERSEDED");
  if (!selected) throw new DossierServiceError(409, "MISSING_TAX_CALCULATION", "Cálculo congelado da versão fechada não encontrado.");
  return selected;
}

function sourceSnapshotForPeriod(period: WorkflowTaxPeriod, calculation: TaxCalculation, snapshots: readonly SourceSnapshot[]) {
  const manifest = period.closedManifest ?? {};
  const manifestSnapshotId = typeof manifest.sourceSnapshotId === "string" ? manifest.sourceSnapshotId : null;
  const selected = snapshots.find((snapshot) => snapshot.id === (manifestSnapshotId ?? calculation.sourceSnapshotId));
  if (!selected) throw new DossierServiceError(409, "MISSING_SOURCE_SNAPSHOT", "SOURCE_SNAPSHOT congelado da versão fechada não encontrado.");
  return selected;
}

async function loadDossierModel(access: FiscalAccessContext, taxPeriod: WorkflowTaxPeriod) {
  assertClosedPeriod(taxPeriod);
  const [profiles, snapshots, pendingItems, ruleExecutionResults, taxAdjustments, taxCalculations, humanDecisions] = await Promise.all([
    listFiscalYearProfiles(access.client, access.company.id, taxPeriod.fiscalYear),
    listSourceSnapshots(access.client, access.company.id, taxPeriod.id),
    listPendingItems(access.client, access.company.id, taxPeriod.id),
    listRuleExecutionResults(access.client, access.company.id, taxPeriod.id),
    listTaxAdjustments(access.client, access.company.id, taxPeriod.id),
    listTaxCalculations(access.client, access.company.id, taxPeriod.id),
    listTaxWorkflowHumanDecisions(access.client, access.company.id, taxPeriod.id),
  ]);
  const taxCalculation = taxCalculationForPeriod(taxPeriod, taxCalculations);
  const sourceSnapshot = sourceSnapshotForPeriod(taxPeriod, taxCalculation, snapshots);
  return buildMonthlyTaxDossierModel({
    company: {
      id: access.company.id,
      code: access.company.code,
      name: access.company.name,
      cnpj: access.company.cnpj,
    },
    fiscalYearProfile: profiles.find((profile) => profile.id === taxCalculation.fiscalYearProfileId) ?? profiles[0] ?? null,
    taxPeriod,
    sourceSnapshot,
    taxCalculation,
    taxAdjustments,
    ruleExecutionResults,
    humanDecisions,
    pendingItems,
    closedManifest: asClosedManifest(taxPeriod),
  });
}

async function previousClosedModel(access: FiscalAccessContext, current: WorkflowTaxPeriod, periods: readonly WorkflowTaxPeriod[]) {
  const previous = periods
    .filter((period) => period.periodCode === current.periodCode)
    .filter((period) => period.status === "CLOSED_CURRENT" || period.status === "CLOSED_SUPERSEDED")
    .filter((period) => period.version < current.version)
    .sort((left, right) => right.version - left.version)[0] ?? null;
  return previous ? loadDossierModel(access, previous) : null;
}

async function recordGenerationFailure(access: FiscalAccessContext, taxPeriod: WorkflowTaxPeriod, error: unknown) {
  const message = error instanceof Error ? error.message : "Falha desconhecida ao gerar dossiê.";
  const code = error instanceof TaxDossierError ? error.code : error instanceof DossierServiceError ? error.code : "DOSSIER_GENERATION_FAILED";
  return upsertTaxDossierGenerationFailure(access.client, {
    id: deterministicDossierId(taxPeriod),
    logicalKey: dossierLogicalKey(taxPeriod),
    companyId: access.company.id,
    taxPeriodId: taxPeriod.id,
    taxPeriodVersion: taxPeriod.version,
    storageBucket: TAX_DOSSIER_BUCKET,
    storagePrefix: monthlyDossierStoragePrefix(access.company.id, taxPeriod.fiscalYear, taxPeriod.endDate.slice(0, 7), taxPeriod.version),
    generatedBy: access.user.id,
    generatedAt: new Date().toISOString(),
    failureCode: code,
    failureMessage: message,
  });
}

export async function listIrpjCsllMonthlyDossiers(request: Request): Promise<IrpjCsllDossierListResponse> {
  if (isIrpjCsllHomologationMode()) return listHomologationDossiers(request);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request));
  const periods = await periodVersions(access);
  const dossiers = await listTaxDossiers(access.client, access.company.id, periods.map((period) => period.id));
  return { ok: true, bucketPrivate: true, bucket: TAX_DOSSIER_BUCKET, dossiers };
}

export async function generateMonthlyDossier(request: Request, payload: DossierPayload = {}): Promise<GenerateMonthlyDossierResponse> {
  if (isIrpjCsllHomologationMode()) return generateHomologationDossier(request, payload);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request), { write: true });
  const periods = await periodVersions(access);
  const taxPeriod = selectedTaxPeriod(periods, payload.taxPeriodId, access.competence);
  assertMonthlyEstimatePeriod(taxPeriod);
  assertClosedPeriod(taxPeriod);
  try {
    const model = await loadDossierModel(access, taxPeriod);
    const previous = await previousClosedModel(access, taxPeriod, periods);
    const dossierPackage = buildMonthlyTaxDossierPackage(model, previous);
    const existing = await getTaxDossierByTaxPeriod(access.client, access.company.id, taxPeriod.id);
    if (existing?.status === "AVAILABLE") {
      verifyExistingDossierIntegrity(existing, dossierPackage);
      return { ok: true, status: "DOSSIER_ALREADY_EXISTS", dossier: existing };
    }
    await uploadDossierArtifacts(access.client, dossierPackage);
    const dossier = buildTaxDossierRecord({ package: dossierPackage, generatedBy: access.user.id, generatedAt: new Date() });
    const inserted = await insertTaxDossier(access.client, dossier);
    return { ok: true, status: "DOSSIER_GENERATED", dossier: inserted };
  } catch (error) {
    await recordGenerationFailure(access, taxPeriod, error).catch(() => null);
    throw error;
  }
}

export async function getMonthlyDossierManifest(request: Request): Promise<MonthlyDossierManifestResponse> {
  if (isIrpjCsllHomologationMode()) return getHomologationDossierManifest(request);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request));
  const dossierId = requiredText(new URL(request.url).searchParams.get("dossierId"), "Dossiê");
  const dossier = await getTaxDossier(access.client, access.company.id, dossierId);
  return { ok: true, dossier, manifest: dossier.manifest, manifestHash: dossier.manifestHash };
}

export async function getMonthlyDossierArtifact(request: Request): Promise<MonthlyDossierArtifactResponse> {
  if (isIrpjCsllHomologationMode()) return getHomologationDossierArtifact(request);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request));
  const url = new URL(request.url);
  const dossierId = requiredText(url.searchParams.get("dossierId"), "Dossiê");
  const artifactKind = requiredText(url.searchParams.get("artifact"), "Artefato");
  const dossier = await getTaxDossier(access.client, access.company.id, dossierId);
  const metadata = artifactByKind(dossier, artifactKind);
  if (!metadata) throw new DossierServiceError(404, "DOSSIER_ARTIFACT_NOT_FOUND", "Artefato não consta no manifest do dossiê.");
  const bytes = await readArtifactFromStorage(access.client, dossier, metadata.relativePath);
  if (sha256(bytes) !== metadata.hashSha256) {
    throw new DossierServiceError(409, "DOSSIER_ARTIFACT_HASH_MISMATCH", "Hash do artefato baixado diverge do manifest.");
  }
  return { dossier, artifact: { ...metadata, bytes }, bytes };
}

export async function compareMonthlyDossierVersions(request: Request): Promise<MonthlyDossierCompareResponse> {
  if (isIrpjCsllHomologationMode()) return compareHomologationDossierVersions(request);
  const access = await requireFiscalAccess(request, parseFiscalRequestScope(request));
  const dossierId = requiredText(new URL(request.url).searchParams.get("dossierId"), "Dossiê");
  const dossier = await getTaxDossier(access.client, access.company.id, dossierId);
  const artifact = artifactByKind(dossier, "comparison");
  if (!artifact) return { ok: true, dossier, comparison: null };
  const bytes = await readArtifactFromStorage(access.client, dossier, artifact.relativePath);
  if (sha256(bytes) !== artifact.hashSha256) {
    throw new DossierServiceError(409, "DOSSIER_ARTIFACT_HASH_MISMATCH", "Hash do comparativo diverge do manifest.");
  }
  return { ok: true, dossier, comparison: JSON.parse(bytes.toString("utf8")) as MonthlyTaxDossierComparison };
}
