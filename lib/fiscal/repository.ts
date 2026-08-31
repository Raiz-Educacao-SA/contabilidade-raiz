import type { SupabaseClient } from "@supabase/supabase-js";
import type { RuleExecutionResult, TaxAdjustment } from "./fiscal-matrix.ts";
import {
  normalizeFiscalYearProfileDraft,
  normalizeTaxPeriodDraft,
} from "./periods.ts";
import {
  createSourceSnapshotDraft,
  verifySourceSnapshotIntegrity,
  type NormalizedSourceSnapshotDraft,
} from "./source-snapshot.ts";
import type {
  FiscalPeriodicity,
  FiscalSource,
  FiscalSourceProvider,
  FiscalSourceType,
  FiscalTaxRegime,
  FiscalYearProfile,
  FiscalYearProfileDraft,
  JsonObject,
  JsonValue,
  SourceSnapshot,
  SourceSnapshotDraft,
  TaxPeriod,
  TaxPeriodDraft,
  TaxPeriodIdentity,
  TaxPeriodStatus,
  TaxPeriodType,
} from "./types.ts";

type FiscalYearProfileRow = {
  id: string;
  empresa_id: string;
  exercicio: number;
  regime: FiscalTaxRegime;
  periodicidade: FiscalPeriodicity;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  versao: number;
  criado_em?: string;
  atualizado_em?: string;
};

type TaxPeriodRow = {
  id: string;
  empresa_id: string;
  fiscal_year_profile_id: string | null;
  exercicio: number;
  codigo_periodo: string;
  data_inicial: string;
  data_final: string;
  tipo_periodo: TaxPeriodType;
  status: TaxPeriodStatus;
  versao: number;
  criado_em?: string;
  atualizado_em?: string;
};

type SourceSnapshotRow = {
  id: string;
  empresa_id: string;
  empresa_referencia_externa: string;
  tax_period_id: string;
  periodo_identidade: TaxPeriodIdentity;
  fonte: FiscalSource;
  tipo_fonte: FiscalSourceType;
  provedor: FiscalSourceProvider;
  versao_adapter: number;
  versao_schema_conteudo: number;
  extraido_em: string;
  parametros: JsonObject;
  quantidade_registros: number;
  conteudo: readonly JsonObject[];
  total_debito: string;
  total_credito: string;
  saldos: JsonValue;
  hash: string;
  versao_snapshot: number;
  criado_em?: string;
};

type RuleExecutionResultRow = {
  id: string;
  empresa_id: string;
  tax_period_id: string;
  source_snapshot_id: string;
  accounting_chart_id: string;
  company_accounting_chart_id: string;
  codigo_conta: string;
  codigo_reduzido: string | null;
  descricao_conta: string;
  fiscal_nature_id: string;
  account_fiscal_mapping_id: string;
  account_fiscal_mapping_version: number;
  company_account_mapping_override_id: string | null;
  company_account_mapping_override_version: number | null;
  fiscal_rule_id: string;
  fiscal_rule_version: number;
  company_rule_override_id: string | null;
  company_rule_override_version: number | null;
  metodo_execucao: RuleExecutionResult["executionMethod"];
  nivel_automacao: RuleExecutionResult["automationLevel"];
  amount_basis: RuleExecutionResult["amountBasis"];
  valor_contabil_bruto: string;
  valor_calculado: string;
  status: RuleExecutionResult["status"];
  metadados_execucao: JsonObject;
  chave_logica: string;
  criado_em: string;
};

type TaxAdjustmentRow = {
  id: string;
  empresa_id: string;
  tax_period_id: string;
  source_snapshot_id: string;
  rule_execution_result_id: string;
  tributo: TaxAdjustment["tax"];
  tipo_ajuste: TaxAdjustment["adjustmentType"];
  codigo_conta: string;
  codigo_reduzido: string | null;
  fiscal_nature_id: string;
  fiscal_rule_id: string;
  fiscal_rule_version: number;
  valor: string;
  origem: TaxAdjustment["origin"];
  status: TaxAdjustment["status"];
  chave_logica: string;
  criado_em: string;
};

function profileRow(profile: FiscalYearProfileDraft) {
  const normalized = normalizeFiscalYearProfileDraft(profile);
  return {
    empresa_id: normalized.companyId,
    exercicio: normalized.fiscalYear,
    regime: normalized.taxRegime,
    periodicidade: normalized.periodicity,
    vigencia_inicio: normalized.validFrom,
    vigencia_fim: normalized.validTo,
    versao: normalized.version,
  };
}

function taxPeriodRow(period: TaxPeriodDraft) {
  const normalized = normalizeTaxPeriodDraft(period);
  return {
    empresa_id: normalized.companyId,
    fiscal_year_profile_id: normalized.fiscalYearProfileId,
    exercicio: normalized.fiscalYear,
    codigo_periodo: normalized.periodCode,
    data_inicial: normalized.startDate,
    data_final: normalized.endDate,
    tipo_periodo: normalized.periodType,
    status: normalized.status,
    versao: normalized.version,
  };
}

function sourceSnapshotRow(snapshot: NormalizedSourceSnapshotDraft) {
  return {
    empresa_id: snapshot.companyId,
    empresa_referencia_externa: snapshot.externalCompanyRef,
    tax_period_id: snapshot.taxPeriodId,
    periodo_identidade: snapshot.taxPeriod,
    fonte: snapshot.source,
    tipo_fonte: snapshot.sourceType,
    provedor: snapshot.provider,
    versao_adapter: snapshot.adapterVersion,
    versao_schema_conteudo: snapshot.contentSchemaVersion,
    extraido_em: snapshot.extractedAt,
    parametros: snapshot.parameters,
    quantidade_registros: snapshot.recordCount,
    conteudo: snapshot.records,
    total_debito: snapshot.totalDebit,
    total_credito: snapshot.totalCredit,
    saldos: snapshot.balances,
    hash: snapshot.hash,
    versao_snapshot: snapshot.snapshotVersion,
  };
}

function ruleExecutionResultRow(result: RuleExecutionResult): RuleExecutionResultRow {
  return {
    id: result.id,
    empresa_id: result.companyId,
    tax_period_id: result.taxPeriodId,
    source_snapshot_id: result.sourceSnapshotId,
    accounting_chart_id: result.accountingChartId,
    company_accounting_chart_id: result.companyAccountingChartId,
    codigo_conta: result.accountCode,
    codigo_reduzido: result.reducedCode,
    descricao_conta: result.accountDescription,
    fiscal_nature_id: result.fiscalNatureId,
    account_fiscal_mapping_id: result.accountFiscalMappingId,
    account_fiscal_mapping_version: result.accountFiscalMappingVersion,
    company_account_mapping_override_id: result.companyAccountMappingOverrideId,
    company_account_mapping_override_version: result.companyAccountMappingOverrideVersion,
    fiscal_rule_id: result.fiscalRuleId,
    fiscal_rule_version: result.fiscalRuleVersion,
    company_rule_override_id: result.companyRuleOverrideId,
    company_rule_override_version: result.companyRuleOverrideVersion,
    metodo_execucao: result.executionMethod,
    nivel_automacao: result.automationLevel,
    amount_basis: result.amountBasis,
    valor_contabil_bruto: result.rawAccountingValue,
    valor_calculado: result.calculatedValue,
    status: result.status,
    metadados_execucao: result.executionMetadata,
    chave_logica: result.logicalKey,
    criado_em: result.createdAt,
  };
}

function taxAdjustmentRow(adjustment: TaxAdjustment): TaxAdjustmentRow {
  return {
    id: adjustment.id,
    empresa_id: adjustment.companyId,
    tax_period_id: adjustment.taxPeriodId,
    source_snapshot_id: adjustment.sourceSnapshotId,
    rule_execution_result_id: adjustment.ruleExecutionResultId,
    tributo: adjustment.tax,
    tipo_ajuste: adjustment.adjustmentType,
    codigo_conta: adjustment.accountCode,
    codigo_reduzido: adjustment.reducedCode,
    fiscal_nature_id: adjustment.fiscalNatureId,
    fiscal_rule_id: adjustment.fiscalRuleId,
    fiscal_rule_version: adjustment.fiscalRuleVersion,
    valor: adjustment.value,
    origem: adjustment.origin,
    status: adjustment.status,
    chave_logica: adjustment.logicalKey,
    criado_em: adjustment.createdAt,
  };
}

function profileFromRow(row: FiscalYearProfileRow): FiscalYearProfile {
  return {
    id: row.id,
    companyId: row.empresa_id,
    fiscalYear: row.exercicio,
    taxRegime: row.regime,
    periodicity: row.periodicidade,
    validFrom: row.vigencia_inicio,
    validTo: row.vigencia_fim,
    version: row.versao,
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

function taxPeriodFromRow(row: TaxPeriodRow): TaxPeriod {
  return {
    id: row.id,
    companyId: row.empresa_id,
    fiscalYearProfileId: row.fiscal_year_profile_id,
    fiscalYear: row.exercicio,
    periodCode: row.codigo_periodo,
    startDate: row.data_inicial,
    endDate: row.data_final,
    periodType: row.tipo_periodo,
    status: row.status,
    version: row.versao,
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

function sourceSnapshotFromRow(row: SourceSnapshotRow): SourceSnapshot {
  return {
    id: row.id,
    companyId: row.empresa_id,
    externalCompanyRef: row.empresa_referencia_externa,
    taxPeriodId: row.tax_period_id,
    taxPeriod: row.periodo_identidade,
    source: row.fonte,
    sourceType: row.tipo_fonte,
    provider: row.provedor,
    adapterVersion: row.versao_adapter,
    contentSchemaVersion: row.versao_schema_conteudo,
    extractedAt: row.extraido_em,
    parameters: row.parametros,
    recordCount: row.quantidade_registros,
    records: row.conteudo,
    totalDebit: row.total_debito,
    totalCredit: row.total_credito,
    balances: row.saldos,
    hash: row.hash,
    snapshotVersion: row.versao_snapshot,
    createdAt: row.criado_em,
  };
}

function ruleExecutionResultFromRow(row: RuleExecutionResultRow): RuleExecutionResult {
  return {
    id: row.id,
    companyId: row.empresa_id,
    taxPeriodId: row.tax_period_id,
    sourceSnapshotId: row.source_snapshot_id,
    accountingChartId: row.accounting_chart_id,
    companyAccountingChartId: row.company_accounting_chart_id,
    accountCode: row.codigo_conta,
    reducedCode: row.codigo_reduzido,
    accountDescription: row.descricao_conta,
    fiscalNatureId: row.fiscal_nature_id,
    accountFiscalMappingId: row.account_fiscal_mapping_id,
    accountFiscalMappingVersion: row.account_fiscal_mapping_version,
    companyAccountMappingOverrideId: row.company_account_mapping_override_id,
    companyAccountMappingOverrideVersion: row.company_account_mapping_override_version,
    fiscalRuleId: row.fiscal_rule_id,
    fiscalRuleVersion: row.fiscal_rule_version,
    companyRuleOverrideId: row.company_rule_override_id,
    companyRuleOverrideVersion: row.company_rule_override_version,
    executionMethod: row.metodo_execucao,
    automationLevel: row.nivel_automacao,
    amountBasis: row.amount_basis,
    rawAccountingValue: row.valor_contabil_bruto,
    calculatedValue: row.valor_calculado,
    status: row.status,
    executionMetadata: row.metadados_execucao,
    logicalKey: row.chave_logica,
    createdAt: row.criado_em,
  };
}

function taxAdjustmentFromRow(row: TaxAdjustmentRow): TaxAdjustment {
  return {
    id: row.id,
    companyId: row.empresa_id,
    taxPeriodId: row.tax_period_id,
    sourceSnapshotId: row.source_snapshot_id,
    ruleExecutionResultId: row.rule_execution_result_id,
    tax: row.tributo,
    adjustmentType: row.tipo_ajuste,
    accountCode: row.codigo_conta,
    reducedCode: row.codigo_reduzido,
    fiscalNatureId: row.fiscal_nature_id,
    fiscalRuleId: row.fiscal_rule_id,
    fiscalRuleVersion: row.fiscal_rule_version,
    value: row.valor,
    origin: row.origem,
    status: row.status,
    logicalKey: row.chave_logica,
    createdAt: row.criado_em,
  };
}

function assertNoDatabaseError(error: { readonly message?: string } | null) {
  if (error) throw new Error(error.message || "Erro ao persistir dados fiscais.");
}

export async function insertFiscalYearProfile(
  client: SupabaseClient,
  profile: FiscalYearProfileDraft,
) {
  const { data, error } = await client
    .from("fiscal_year_profiles")
    .insert(profileRow(profile))
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return profileFromRow(data as FiscalYearProfileRow);
}

export async function insertTaxPeriods(
  client: SupabaseClient,
  periods: readonly TaxPeriodDraft[],
) {
  if (!periods.length) return [];
  const { data, error } = await client
    .from("tax_periods")
    .insert(periods.map(taxPeriodRow))
    .select("*");
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxPeriodRow[]).map(taxPeriodFromRow);
}

export async function insertSourceSnapshot(
  client: SupabaseClient,
  snapshot: SourceSnapshotDraft,
) {
  const normalized = createSourceSnapshotDraft(snapshot);
  if (!verifySourceSnapshotIntegrity(normalized)) {
    throw new Error("Hash do snapshot fiscal não confere com o conteúdo normalizado.");
  }
  const { data, error } = await client
    .from("source_snapshots")
    .insert(sourceSnapshotRow(normalized))
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return sourceSnapshotFromRow(data as SourceSnapshotRow);
}

export async function upsertRuleExecutionResult(
  client: SupabaseClient,
  result: RuleExecutionResult,
) {
  const { data, error } = await client
    .from("rule_execution_results")
    .upsert(ruleExecutionResultRow(result), { onConflict: "chave_logica" })
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return ruleExecutionResultFromRow(data as RuleExecutionResultRow);
}

export async function upsertTaxAdjustments(
  client: SupabaseClient,
  adjustments: readonly TaxAdjustment[],
) {
  if (!adjustments.length) return [];
  const { data, error } = await client
    .from("tax_adjustments")
    .upsert(adjustments.map(taxAdjustmentRow), { onConflict: "chave_logica" })
    .select("*");
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxAdjustmentRow[]).map(taxAdjustmentFromRow);
}

export async function listTaxPeriods(
  client: SupabaseClient,
  companyId: string,
  fiscalYear: number,
) {
  const { data, error } = await client
    .from("tax_periods")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("exercicio", fiscalYear)
    .order("data_inicial", { ascending: true })
    .order("codigo_periodo", { ascending: true });
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxPeriodRow[]).map(taxPeriodFromRow);
}