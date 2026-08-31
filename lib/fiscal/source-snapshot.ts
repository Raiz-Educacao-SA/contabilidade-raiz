import { createHash } from "node:crypto";
import { assertFiscalYear, assertIsoDate } from "./periods.ts";
import type {
  FiscalSourceType,
  JsonObject,
  JsonValue,
  MonetaryAmount,
  SnapshotInputObject,
  SnapshotInputValue,
  SourceSnapshot,
  SourceSnapshotDraft,
  TaxPeriodIdentity,
} from "./types.ts";
import { FISCAL_SOURCE_TYPES } from "./types.ts";
import { assertValidVersion } from "./versioning.ts";

export type NormalizedSourceSnapshotDraft = Omit<
  SourceSnapshot,
  "createdAt" | "id"
>;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

function normalizeTimestamp(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Data/hora de extração inválida.");
  }
  return parsed.toISOString();
}

function normalizeCalendarDate(value: string) {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return value;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Data do snapshot inválida.");
  }
  return value;
}

function normalizeSnapshotString(value: string) {
  if (CALENDAR_DATE.test(value)) return normalizeCalendarDate(value);
  if (ISO_TIMESTAMP.test(value)) return normalizeTimestamp(value);
  return value;
}

function normalizeJsonValue(value: SnapshotInputValue | undefined): JsonValue {
  if (value === undefined) throw new Error("JSON do snapshot contém valor indefinido.");
  if (value instanceof Date) return normalizeTimestamp(value);
  if (value === null) return value;
  if (typeof value === "string") return normalizeSnapshotString(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON do snapshot contém número inválido.");
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeJsonValue);

  const object = value as SnapshotInputObject;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, normalizeJsonValue(object[key])]),
  );
}

export function canonicalJson(value: SnapshotInputValue) {
  return JSON.stringify(normalizeJsonValue(value));
}

function normalizeSnapshotRecord(record: SnapshotInputObject): JsonObject {
  const normalized = normalizeJsonValue(record);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error("Registro do snapshot inválido.");
  }
  return normalized as JsonObject;
}

function normalizedDecimal(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Valor monetário deve ter no máximo duas casas decimais.");
  }
  const sign = normalized.startsWith("-") ? "-" : "";
  const unsigned = sign ? normalized.slice(1) : normalized;
  const [integer, fraction = ""] = unsigned.split(".");
  const normalizedFraction = fraction.padEnd(2, "0");
  const cents = BigInt(`${integer}${normalizedFraction}`);
  return cents === 0n ? "0.00" : `${sign}${BigInt(integer)}.${normalizedFraction}`;
}

export function normalizeMoney(value: MonetaryAmount) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Valor monetário inválido.");
    return normalizedDecimal(String(value));
  }

  return normalizedDecimal(value);
}

function normalizeNonNegativeMoney(value: MonetaryAmount, label: string) {
  const normalized = normalizeMoney(value);
  if (normalized.startsWith("-")) {
    throw new Error(`${label} não pode ser negativo.`);
  }
  return normalized;
}

function normalizeTaxPeriodIdentity(input: TaxPeriodIdentity): TaxPeriodIdentity {
  assertFiscalYear(input.fiscalYear);
  const periodCode = input.periodCode.trim();
  if (!periodCode) throw new Error("Código do período fiscal é obrigatório para o snapshot.");
  assertIsoDate(input.startDate, "data inicial do período fiscal");
  assertIsoDate(input.endDate, "data final do período fiscal");
  if (input.startDate > input.endDate) {
    throw new Error("Identidade do período fiscal contém intervalo inválido.");
  }
  return {
    fiscalYear: input.fiscalYear,
    periodCode,
    startDate: input.startDate,
    endDate: input.endDate,
  };
}

function normalizeSourceType(sourceType: FiscalSourceType) {
  if (!isOneOf(sourceType, FISCAL_SOURCE_TYPES)) {
    throw new Error("Tipo de fonte do snapshot inválido.");
  }
  return sourceType;
}

function normalizeSnapshotCore(input: SourceSnapshotDraft) {
  const companyId = input.companyId.trim();
  const externalCompanyRef = input.externalCompanyRef.trim();
  const taxPeriodId = input.taxPeriodId.trim();
  const source = input.source.trim();
  const provider = input.provider.trim();
  const adapterVersion = input.adapterVersion;
  const contentSchemaVersion = input.contentSchemaVersion;
  const snapshotVersion = input.snapshotVersion ?? 1;
  assertValidVersion(snapshotVersion, "versão do snapshot");
  assertValidVersion(adapterVersion, "versão do adapter");
  assertValidVersion(contentSchemaVersion, "versão do schema do conteúdo");
  if (!companyId) throw new Error("Empresa é obrigatória.");
  if (!externalCompanyRef) throw new Error("Identificação externa da empresa é obrigatória.");
  if (!taxPeriodId) throw new Error("Período fiscal é obrigatório.");
  if (!source) throw new Error("Fonte do snapshot é obrigatória.");
  if (!provider) throw new Error("Provedor do snapshot é obrigatório.");
  if (!Number.isSafeInteger(input.recordCount) || input.recordCount < 0) {
    throw new Error("Quantidade de registros do snapshot inválida.");
  }
  const records = input.records
    .map(normalizeSnapshotRecord)
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  if (records.length !== input.recordCount) {
    throw new Error("Quantidade de registros do snapshot não confere com o conteúdo persistido.");
  }
  return {
    companyId,
    externalCompanyRef,
    taxPeriodId,
    taxPeriod: normalizeTaxPeriodIdentity(input.taxPeriod),
    source,
    sourceType: normalizeSourceType(input.sourceType),
    provider,
    adapterVersion,
    contentSchemaVersion,
    extractedAt: normalizeTimestamp(input.extractedAt),
    parameters: normalizeJsonValue(input.parameters ?? {}) as JsonObject,
    recordCount: input.recordCount,
    records,
    totalDebit: normalizeNonNegativeMoney(input.totalDebit, "Total débito"),
    totalCredit: normalizeNonNegativeMoney(input.totalCredit, "Total crédito"),
    balances: normalizeJsonValue(input.balances ?? {}),
    snapshotVersion,
  };
}

export function sourceSnapshotHashPayload(input: SourceSnapshotDraft): JsonObject {
  const normalized = normalizeSnapshotCore(input);
  return {
    company: {
      externalRef: normalized.externalCompanyRef,
    },
    taxPeriod: normalized.taxPeriod,
    source: {
      id: normalized.source,
      type: normalized.sourceType,
      provider: normalized.provider,
      adapterVersion: normalized.adapterVersion,
      contentSchemaVersion: normalized.contentSchemaVersion,
    },
    parameters: normalized.parameters,
    recordCount: normalized.recordCount,
    records: normalized.records,
    totalDebit: normalized.totalDebit,
    totalCredit: normalized.totalCredit,
    balances: normalized.balances,
  };
}

export function calculateSourceSnapshotHash(input: SourceSnapshotDraft) {
  return createHash("sha256")
    .update(canonicalJson(sourceSnapshotHashPayload(input)))
    .digest("hex");
}

export function createSourceSnapshotDraft(
  input: SourceSnapshotDraft,
): NormalizedSourceSnapshotDraft {
  const normalized = normalizeSnapshotCore(input);
  return {
    ...normalized,
    hash: calculateSourceSnapshotHash(normalized),
  };
}

export function verifySourceSnapshotIntegrity(
  snapshot: SourceSnapshotDraft & { readonly hash: string },
) {
  return calculateSourceSnapshotHash(snapshot) === snapshot.hash.toLowerCase();
}