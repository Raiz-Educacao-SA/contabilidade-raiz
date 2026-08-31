import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountingSourceRequestFromTaxPeriod,
  normalizeAccountingSourceResult,
  taxPeriodIdentityFromTaxPeriod,
  type AccountingSource,
} from "./accounting-source.ts";
import { insertSourceSnapshot } from "./repository.ts";
import type { SnapshotInputObject, SourceSnapshot, TaxPeriod } from "./types.ts";

export type CaptureAccountingSourceSnapshotInput = {
  readonly client: SupabaseClient;
  readonly accountingSource: AccountingSource;
  readonly companyId: string;
  readonly externalCompanyRef: string;
  readonly taxPeriod: TaxPeriod;
  readonly accountFilter?: string;
  readonly includeClosingEntries?: boolean;
  readonly parameters?: SnapshotInputObject;
  readonly extractedAt?: string | Date;
  readonly snapshotVersion?: number;
};

function trimRequired(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

export async function captureAccountingSourceSnapshot({
  client,
  accountingSource,
  companyId,
  externalCompanyRef,
  taxPeriod,
  accountFilter,
  includeClosingEntries,
  parameters,
  extractedAt = new Date(),
  snapshotVersion,
}: CaptureAccountingSourceSnapshotInput): Promise<SourceSnapshot> {
  const normalizedCompanyId = trimRequired(companyId, "Empresa");
  const normalizedExternalCompanyRef = trimRequired(
    externalCompanyRef,
    "Identificação externa da empresa",
  );
  if (taxPeriod.companyId !== normalizedCompanyId) {
    throw new Error("Período fiscal não pertence à empresa informada.");
  }

  const request = accountingSourceRequestFromTaxPeriod(taxPeriod, {
    companyId: normalizedCompanyId,
    externalCompanyRef: normalizedExternalCompanyRef,
    accountFilter,
    includeClosingEntries,
    parameters,
  });
  const liveResult = await accountingSource.fetchTrialBalance(request);
  const normalizedResult = normalizeAccountingSourceResult(liveResult);

  return insertSourceSnapshot(client, {
    companyId: normalizedCompanyId,
    externalCompanyRef: normalizedExternalCompanyRef,
    taxPeriodId: taxPeriod.id,
    taxPeriod: taxPeriodIdentityFromTaxPeriod(taxPeriod),
    source: normalizedResult.source,
    sourceType: normalizedResult.sourceType,
    provider: normalizedResult.provider,
    adapterVersion: normalizedResult.adapterVersion,
    contentSchemaVersion: normalizedResult.contentSchemaVersion,
    extractedAt,
    parameters: normalizedResult.parameters,
    recordCount: normalizedResult.recordCount,
    records: normalizedResult.records,
    totalDebit: normalizedResult.totalDebit,
    totalCredit: normalizedResult.totalCredit,
    balances: normalizedResult.balances,
    snapshotVersion,
  });
}