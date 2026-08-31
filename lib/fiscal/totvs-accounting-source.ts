import type { DataEngineQuery } from "../totvs-dataengine.ts";
import {
  normalizeAccountingSourceRequest,
  normalizeAccountingSourceResult,
  TRIAL_BALANCE_CONTENT_SCHEMA_VERSION,
  TRIAL_BALANCE_SOURCE_TYPE,
  type AccountingSource,
  type AccountingSourceRequest,
  type AccountingTrialBalanceInputRecord,
} from "./accounting-source.ts";

export const TOTVS_RM_PROVIDER = "TOTVS_RM";
export const TOTVS_RM_TRIAL_BALANCE_SOURCE = "TOTVS_RM_TRIAL_BALANCE";
export const TOTVS_RM_TRIAL_BALANCE_ADAPTER_VERSION = 1;
export const TOTVS_TRIAL_BALANCE_QUERY_CODE = "CUBO.CTB.002";
export const TOTVS_TRIAL_BALANCE_SYSTEM = "C";
export const TOTVS_TRIAL_BALANCE_COMPANY_CONTEXT = 0;
export const TOTVS_TRIAL_BALANCE_DEFAULT_ACCOUNT_FILTER = "%";

export type TotvsDataEngineQueryRunner = (query: DataEngineQuery) => Promise<string[]>;

async function defaultTotvsDataEngineRunner(query: DataEngineQuery) {
  const { queryDataEngine } = await import("../totvs-dataengine.ts");
  return queryDataEngine(query);
}

function decodeXml(value: string) {
  return value
    .replace(/&#xD;|&#13;/gi, "\r")
    .replace(/&#xA;|&#10;/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlTag(xml: string, ...names: string[]) {
  return names
    .map((name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim())
    .find(Boolean) || "";
}

function decodedTag(xml: string, ...names: string[]) {
  return decodeXml(xmlTag(xml, ...names));
}

export function totvsClosingFlag(includeClosingEntries: boolean) {
  return includeClosingEntries ? "S" : "N";
}

function totvsAccountFilter(request: AccountingSourceRequest) {
  return normalizeAccountingSourceRequest(request).accountFilter ?? TOTVS_TRIAL_BALANCE_DEFAULT_ACCOUNT_FILTER;
}

export function buildTotvsTrialBalanceParameters(request: AccountingSourceRequest) {
  const normalized = normalizeAccountingSourceRequest(request);
  const accountFilter = normalized.accountFilter ?? TOTVS_TRIAL_BALANCE_DEFAULT_ACCOUNT_FILTER;
  return [
    `COLIGDADA_I=${normalized.externalCompanyRef}`,
    `DATA_INICIAL_D=${normalized.startDate}`,
    `DATA_FINAL_D=${normalized.endDate}`,
    `CONTA_S=${accountFilter}`,
    `CONSIDERAFECHAMENTO_S=${totvsClosingFlag(normalized.includeClosingEntries)}`,
  ].join(";");
}

function parseTotvsTrialBalanceRecord(record: string): AccountingTrialBalanceInputRecord {
  return {
    accountCode: decodedTag(
      record,
      "Conta_x0020_Contábil",
      "Conta_x0020_Contabil",
      "Conta",
      "CODCONTA",
    ),
    reducedCode: decodedTag(record, "Reduzido", "REDUZIDO"),
    description: decodedTag(
      record,
      "Descrição_x0020_Conta",
      "Descricao_x0020_Conta",
      "Descrição",
      "Descricao",
    ),
    openingBalance: decodedTag(record, "VR_SALDOANT"),
    debit: decodedTag(record, "VR_DEBITO"),
    credit: decodedTag(record, "VR_CREDITO"),
    movement: decodedTag(record, "VR_MOV"),
    closingBalance: decodedTag(record, "Saldo", "VR_SALDO"),
  };
}

export function createTotvsRmTrialBalanceAccountingSource(
  runner: TotvsDataEngineQueryRunner = defaultTotvsDataEngineRunner,
): AccountingSource {
  return {
    source: TOTVS_RM_TRIAL_BALANCE_SOURCE,
    sourceType: TRIAL_BALANCE_SOURCE_TYPE,
    provider: TOTVS_RM_PROVIDER,
    adapterVersion: TOTVS_RM_TRIAL_BALANCE_ADAPTER_VERSION,
    contentSchemaVersion: TRIAL_BALANCE_CONTENT_SCHEMA_VERSION,
    async fetchTrialBalance(request) {
      const normalized = normalizeAccountingSourceRequest(request);
      const accountFilter = totvsAccountFilter(normalized);
      const parametersText = buildTotvsTrialBalanceParameters(normalized);
      const closingFlag = totvsClosingFlag(normalized.includeClosingEntries);
      const rows = await runner({
        code: TOTVS_TRIAL_BALANCE_QUERY_CODE,
        system: TOTVS_TRIAL_BALANCE_SYSTEM,
        company: TOTVS_TRIAL_BALANCE_COMPANY_CONTEXT,
        parameters: parametersText,
        errorMessage: "O TOTVS/DataEngine não conseguiu gerar o balancete fiscal.",
      });
      return normalizeAccountingSourceResult({
        source: TOTVS_RM_TRIAL_BALANCE_SOURCE,
        sourceType: TRIAL_BALANCE_SOURCE_TYPE,
        provider: TOTVS_RM_PROVIDER,
        adapterVersion: TOTVS_RM_TRIAL_BALANCE_ADAPTER_VERSION,
        contentSchemaVersion: TRIAL_BALANCE_CONTENT_SCHEMA_VERSION,
        parameters: {
          canonical: {
            externalCompanyRef: normalized.externalCompanyRef,
            startDate: normalized.startDate,
            endDate: normalized.endDate,
            accountFilter,
            includeClosingEntries: normalized.includeClosingEntries,
          },
          sourceSpecific: {
            COLIGDADA_I: normalized.externalCompanyRef,
            DATA_INICIAL_D: normalized.startDate,
            DATA_FINAL_D: normalized.endDate,
            CONTA_S: accountFilter,
            CONSIDERAFECHAMENTO_S: closingFlag,
          },
          adapter: {
            queryCode: TOTVS_TRIAL_BALANCE_QUERY_CODE,
            system: TOTVS_TRIAL_BALANCE_SYSTEM,
            companyContext: String(TOTVS_TRIAL_BALANCE_COMPANY_CONTEXT),
            dataEngineParameters: parametersText,
          },
          additional: normalized.parameters ?? {},
        },
        records: rows.map(parseTotvsTrialBalanceRecord),
      });
    },
  };
}