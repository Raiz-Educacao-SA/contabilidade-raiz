import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScheduleCompletion } from "../schedule-completion.ts";
import type { TaxCalculation } from "./annual-monthly-engine.ts";
import type {
  AccountFiscalMapping,
  AccountingChart,
  CompanyAccountingChart,
  CompanyAccountMappingOverride,
  CompanyRuleOverride,
  FiscalNature,
  FiscalRule,
  PendingItem,
  RuleExecutionResult,
  TaxAdjustment,
} from "./fiscal-matrix.ts";
import type {
  TaxPeriodCloseManifest,
  TaxWorkflowHumanDecision,
  WorkflowTaxPeriod,
} from "./monthly-workflow.ts";
import type {
  MonthlyTaxDossierArtifactMetadata,
  TaxDossierIntegrityStatus,
  TaxDossierRecord,
  TaxDossierStatus,
} from "./monthly-dossier.ts";
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
  TaxPeriodDraft,
  TaxPeriodIdentity,
  TaxPeriodStatus,
  TaxPeriodType,
} from "./types.ts";

type MonetaryRowValue = string | number;

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
  upstream_stale?: boolean;
  closed_manifest_id?: string | null;
  closed_manifest?: JsonObject;
  replaced_by_tax_period_id?: string | null;
  fechado_em?: string | null;
  fechado_por?: string | null;
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
  total_debito: MonetaryRowValue;
  total_credito: MonetaryRowValue;
  saldos: JsonValue;
  hash: string;
  versao_snapshot: number;
  criado_em?: string;
};

type AccountingChartRow = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  versao: number;
  criado_em?: string;
  atualizado_em?: string;
};

type CompanyAccountingChartRow = {
  id: string;
  empresa_id: string;
  accounting_chart_id: string;
  exercicio: number | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  versao: number;
  ativo: boolean;
  criado_em?: string;
  atualizado_em?: string;
};

type FiscalNatureRow = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  metadados_origem: JsonObject;
  ativo: boolean;
  criado_em?: string;
  atualizado_em?: string;
};

type AccountFiscalMappingRow = {
  id: string;
  accounting_chart_id: string;
  codigo_conta: string;
  codigo_reduzido: string | null;
  fiscal_nature_id: string;
  metadados_origem: JsonObject;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  versao: number;
  ativo: boolean;
  criado_em?: string;
  atualizado_em?: string;
};

type CompanyAccountMappingOverrideRow = {
  id: string;
  empresa_id: string;
  accounting_chart_id: string;
  codigo_conta: string;
  codigo_reduzido: string | null;
  fiscal_nature_id: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  versao: number;
  ativo: boolean;
  criado_em?: string;
  atualizado_em?: string;
};

type FiscalRuleRow = {
  id: string;
  codigo_regra: string;
  fiscal_nature_id: string;
  tratamento_irpj: FiscalRule["irpjTreatment"];
  tratamento_csll: FiscalRule["csllTreatment"];
  metodo_execucao: FiscalRule["executionMethod"];
  nivel_automacao: FiscalRule["automationLevel"];
  criterios: JsonObject;
  metadados_origem: JsonObject;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  versao: number;
  status: FiscalRule["status"];
  criado_em?: string;
  atualizado_em?: string;
};

type CompanyRuleOverrideRow = {
  id: string;
  empresa_id: string;
  fiscal_nature_id: string;
  tratamento_irpj: CompanyRuleOverride["irpjTreatment"] | null;
  tratamento_csll: CompanyRuleOverride["csllTreatment"] | null;
  metodo_execucao: CompanyRuleOverride["executionMethod"] | null;
  nivel_automacao: CompanyRuleOverride["automationLevel"] | null;
  criterios: JsonObject | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  versao: number;
  status: CompanyRuleOverride["status"];
  criado_em?: string;
  atualizado_em?: string;
};

type PendingItemRow = {
  id: string;
  empresa_id: string;
  tax_period_id: string;
  source_snapshot_id: string;
  tipo: PendingItem["type"];
  status: PendingItem["status"];
  bloqueante: boolean;
  chave_logica: string;
  descricao: string;
  dados_origem: JsonObject;
  criado_em?: string;
  criado_por?: string | null;
  resolvido_em?: string | null;
  resolvido_por?: string | null;
  observacao_resolucao?: string | null;
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
  valor_contabil_bruto: MonetaryRowValue;
  valor_calculado: MonetaryRowValue;
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
  valor: MonetaryRowValue;
  origem: TaxAdjustment["origin"];
  status: TaxAdjustment["status"];
  chave_logica: string;
  criado_em: string;
};

type TaxCalculationRow = {
  id: string;
  empresa_id: string;
  tax_period_id: string;
  source_snapshot_id: string;
  source_snapshot_hash: string;
  fiscal_year_profile_id: string;
  motor: TaxCalculation["engine"];
  model_version: number;
  calculation_version: number;
  version_status: TaxCalculation["versionStatus"];
  status: TaxCalculation["status"];
  periodo_identidade: TaxCalculation["taxPeriod"];
  accounting_result_source: JsonObject;
  matrix_version: string;
  rule_versions: JsonValue;
  tax_adjustment_ids: readonly string[];
  prior_calculation_ids: readonly string[];
  fiscal_balance_usages: JsonValue;
  credit_usages: JsonValue;
  irpj: JsonObject;
  csll: JsonObject;
  validation_issues: JsonValue;
  memoria: JsonObject;
  chave_logica: string;
  criado_em: string;
};


type TaxDossierRow = {
  id: string;
  chave_logica: string;
  empresa_id: string;
  tax_period_id: string;
  tax_period_version: number;
  status: TaxDossierStatus;
  storage_bucket: string;
  storage_prefix: string;
  manifest: JsonObject;
  manifest_hash: string;
  generated_at: string;
  generated_by: string;
  artifact_metadata: JsonValue;
  integrity_status: TaxDossierIntegrityStatus;
  failure_code: string | null;
  failure_message: string | null;
  comparison_source_versions: readonly string[];
  criado_em?: string;
  atualizado_em?: string;
};
type TaxWorkflowHumanDecisionRow = {
  id: string;
  chave_logica: string;
  empresa_id: string;
  tax_period_id: string;
  source_snapshot_id: string;
  pending_item_id: string;
  tipo_decisao: TaxWorkflowHumanDecision["decisionType"];
  usuario_id: string;
  usuario_email: string | null;
  justificativa: string;
  estado_anterior: JsonObject;
  estado_posterior: JsonObject;
  contexto_snapshot: JsonObject;
  matrix_version_before: number;
  matrix_version_after: number;
  tax_adjustment_ids: readonly string[];
  criado_em: string;
};

export type FiscalMatrixRepositoryContext = {
  readonly accountingCharts: readonly AccountingChart[];
  readonly companyAccountingCharts: readonly CompanyAccountingChart[];
  readonly mappings: readonly AccountFiscalMapping[];
  readonly companyAccountMappingOverrides: readonly CompanyAccountMappingOverride[];
  readonly fiscalNatures: readonly FiscalNature[];
  readonly fiscalRules: readonly FiscalRule[];
  readonly companyRuleOverrides: readonly CompanyRuleOverride[];
};

export type CommitTaxPeriodCloseInput = {
  readonly companyId: string;
  readonly closedPeriod: WorkflowTaxPeriod;
  readonly taxCalculation: TaxCalculation;
  readonly manifest: TaxPeriodCloseManifest;
  readonly scheduleCompetence: string;
  readonly scheduleCompletion: ScheduleCompletion;
  readonly supersededPeriods: readonly WorkflowTaxPeriod[];
  readonly stalePeriods: readonly WorkflowTaxPeriod[];
  readonly userId: string;
  readonly userEmail: string;
  readonly timestamp: string;
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

function taxPeriodRow(period: TaxPeriodDraft | WorkflowTaxPeriod) {
  const normalized = normalizeTaxPeriodDraft(period);
  const workflow = period as Partial<WorkflowTaxPeriod>;
  return {
    ...(workflow.id ? { id: workflow.id } : {}),
    empresa_id: normalized.companyId,
    fiscal_year_profile_id: normalized.fiscalYearProfileId,
    exercicio: normalized.fiscalYear,
    codigo_periodo: normalized.periodCode,
    data_inicial: normalized.startDate,
    data_final: normalized.endDate,
    tipo_periodo: normalized.periodType,
    status: normalized.status,
    upstream_stale: workflow.upstreamStale ?? false,
    closed_manifest_id: workflow.closedManifestId ?? null,
    closed_manifest: workflow.closedManifest ?? null,
    replaced_by_tax_period_id: workflow.replacedByTaxPeriodId ?? null,
    fechado_em: workflow.closedAt ?? null,
    fechado_por: workflow.closedBy ?? null,
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

function accountingChartRow(chart: AccountingChart): AccountingChartRow {
  return {
    id: chart.id,
    codigo: chart.code,
    nome: chart.name,
    descricao: chart.description,
    ativo: chart.active,
    versao: chart.version,
    criado_em: chart.createdAt,
    atualizado_em: chart.updatedAt,
  };
}

function companyAccountingChartRow(chart: CompanyAccountingChart): CompanyAccountingChartRow {
  return {
    id: chart.id,
    empresa_id: chart.companyId,
    accounting_chart_id: chart.accountingChartId,
    exercicio: chart.fiscalYear,
    vigencia_inicio: chart.validFrom,
    vigencia_fim: chart.validTo,
    versao: chart.version,
    ativo: chart.active,
    criado_em: chart.createdAt,
    atualizado_em: chart.updatedAt,
  };
}

function fiscalNatureRow(nature: FiscalNature): FiscalNatureRow {
  return {
    id: nature.id,
    codigo: nature.code,
    nome: nature.name,
    descricao: nature.description,
    metadados_origem: nature.sourceMetadata ?? {},
    ativo: nature.active,
    criado_em: nature.createdAt,
    atualizado_em: nature.updatedAt,
  };
}

function accountFiscalMappingRow(mapping: AccountFiscalMapping): AccountFiscalMappingRow {
  return {
    id: mapping.id,
    accounting_chart_id: mapping.accountingChartId,
    codigo_conta: mapping.accountCode,
    codigo_reduzido: mapping.reducedCode,
    fiscal_nature_id: mapping.fiscalNatureId,
    metadados_origem: mapping.sourceMetadata ?? {},
    vigencia_inicio: mapping.validFrom,
    vigencia_fim: mapping.validTo,
    versao: mapping.version,
    ativo: mapping.active,
    criado_em: mapping.createdAt,
    atualizado_em: mapping.updatedAt,
  };
}

function fiscalRuleRow(rule: FiscalRule): FiscalRuleRow {
  return {
    id: rule.id,
    codigo_regra: rule.ruleCode,
    fiscal_nature_id: rule.fiscalNatureId,
    tratamento_irpj: rule.irpjTreatment,
    tratamento_csll: rule.csllTreatment,
    metodo_execucao: rule.executionMethod,
    nivel_automacao: rule.automationLevel,
    criterios: rule.criteria,
    metadados_origem: rule.sourceMetadata ?? {},
    vigencia_inicio: rule.validFrom,
    vigencia_fim: rule.validTo,
    versao: rule.version,
    status: rule.status,
    criado_em: rule.createdAt,
    atualizado_em: rule.updatedAt,
  };
}

function pendingItemRow(item: PendingItem): PendingItemRow {
  return {
    id: item.id,
    empresa_id: item.companyId,
    tax_period_id: item.taxPeriodId,
    source_snapshot_id: item.sourceSnapshotId,
    tipo: item.type,
    status: item.status,
    bloqueante: item.blocking,
    chave_logica: item.logicalKey,
    descricao: item.description,
    dados_origem: item.originData,
    criado_em: item.createdAt,
    criado_por: item.createdBy ?? null,
    resolvido_em: item.resolvedAt ?? null,
    resolvido_por: item.resolvedBy ?? null,
    observacao_resolucao: item.resolutionNote ?? null,
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

function taxCalculationRow(calculation: TaxCalculation): TaxCalculationRow {
  return {
    id: calculation.id,
    empresa_id: calculation.companyId,
    tax_period_id: calculation.taxPeriodId,
    source_snapshot_id: calculation.sourceSnapshotId,
    source_snapshot_hash: calculation.sourceSnapshotHash,
    fiscal_year_profile_id: calculation.fiscalYearProfileId,
    motor: calculation.engine,
    model_version: calculation.modelVersion,
    calculation_version: calculation.calculationVersion,
    version_status: calculation.versionStatus,
    status: calculation.status,
    periodo_identidade: calculation.taxPeriod,
    accounting_result_source: calculation.accountingResultSource,
    matrix_version: calculation.matrixVersion,
    rule_versions: calculation.ruleVersions as unknown as JsonValue,
    tax_adjustment_ids: calculation.taxAdjustmentIds,
    prior_calculation_ids: calculation.priorCalculationIds,
    fiscal_balance_usages: calculation.fiscalBalanceUsages as unknown as JsonValue,
    credit_usages: calculation.creditUsages as unknown as JsonValue,
    irpj: calculation.irpj as unknown as JsonObject,
    csll: calculation.csll as unknown as JsonObject,
    validation_issues: calculation.validationIssues as unknown as JsonValue,
    memoria: calculation.memory,
    chave_logica: calculation.logicalKey,
    criado_em: calculation.createdAt,
  };
}

function taxWorkflowHumanDecisionRow(decision: TaxWorkflowHumanDecision): TaxWorkflowHumanDecisionRow {
  return {
    id: decision.id,
    chave_logica: decision.logicalKey,
    empresa_id: decision.companyId,
    tax_period_id: decision.taxPeriodId,
    source_snapshot_id: decision.sourceSnapshotId,
    pending_item_id: decision.pendingItemId,
    tipo_decisao: decision.decisionType,
    usuario_id: decision.userId,
    usuario_email: decision.userEmail,
    justificativa: decision.justification,
    estado_anterior: decision.beforeState,
    estado_posterior: decision.afterState,
    contexto_snapshot: decision.snapshotContext,
    matrix_version_before: decision.matrixVersionBefore,
    matrix_version_after: decision.matrixVersionAfter,
    tax_adjustment_ids: decision.taxAdjustmentIds,
    criado_em: decision.createdAt,
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

function taxPeriodFromRow(row: TaxPeriodRow): WorkflowTaxPeriod {
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
    upstreamStale: row.upstream_stale ?? false,
    closedManifestId: row.closed_manifest_id ?? null,
    closedManifest: row.closed_manifest ?? null,
    replacedByTaxPeriodId: row.replaced_by_tax_period_id ?? null,
    closedAt: row.fechado_em ?? null,
    closedBy: row.fechado_por ?? null,
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
    totalDebit: String(row.total_debito),
    totalCredit: String(row.total_credito),
    balances: row.saldos,
    hash: row.hash,
    snapshotVersion: row.versao_snapshot,
    createdAt: row.criado_em,
  };
}

function accountingChartFromRow(row: AccountingChartRow): AccountingChart {
  return {
    id: row.id,
    code: row.codigo,
    name: row.nome,
    description: row.descricao,
    active: row.ativo,
    version: row.versao,
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

function companyAccountingChartFromRow(row: CompanyAccountingChartRow): CompanyAccountingChart {
  return {
    id: row.id,
    companyId: row.empresa_id,
    accountingChartId: row.accounting_chart_id,
    fiscalYear: row.exercicio,
    validFrom: row.vigencia_inicio,
    validTo: row.vigencia_fim,
    version: row.versao,
    active: row.ativo,
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

function fiscalNatureFromRow(row: FiscalNatureRow): FiscalNature {
  return {
    id: row.id,
    code: row.codigo,
    name: row.nome,
    description: row.descricao,
    sourceMetadata: row.metadados_origem,
    active: row.ativo,
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

function accountFiscalMappingFromRow(row: AccountFiscalMappingRow): AccountFiscalMapping {
  return {
    id: row.id,
    accountingChartId: row.accounting_chart_id,
    accountCode: row.codigo_conta,
    reducedCode: row.codigo_reduzido,
    fiscalNatureId: row.fiscal_nature_id,
    sourceMetadata: row.metadados_origem,
    validFrom: row.vigencia_inicio,
    validTo: row.vigencia_fim,
    version: row.versao,
    active: row.ativo,
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

function companyAccountMappingOverrideFromRow(row: CompanyAccountMappingOverrideRow): CompanyAccountMappingOverride {
  return {
    id: row.id,
    companyId: row.empresa_id,
    accountingChartId: row.accounting_chart_id,
    accountCode: row.codigo_conta,
    reducedCode: row.codigo_reduzido,
    fiscalNatureId: row.fiscal_nature_id,
    validFrom: row.vigencia_inicio,
    validTo: row.vigencia_fim,
    version: row.versao,
    active: row.ativo,
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

function fiscalRuleFromRow(row: FiscalRuleRow): FiscalRule {
  return {
    id: row.id,
    ruleCode: row.codigo_regra,
    fiscalNatureId: row.fiscal_nature_id,
    irpjTreatment: row.tratamento_irpj,
    csllTreatment: row.tratamento_csll,
    executionMethod: row.metodo_execucao,
    automationLevel: row.nivel_automacao,
    criteria: row.criterios,
    sourceMetadata: row.metadados_origem,
    validFrom: row.vigencia_inicio,
    validTo: row.vigencia_fim,
    version: row.versao,
    status: row.status,
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

function companyRuleOverrideFromRow(row: CompanyRuleOverrideRow): CompanyRuleOverride {
  return {
    id: row.id,
    companyId: row.empresa_id,
    fiscalNatureId: row.fiscal_nature_id,
    irpjTreatment: row.tratamento_irpj,
    csllTreatment: row.tratamento_csll,
    executionMethod: row.metodo_execucao,
    automationLevel: row.nivel_automacao,
    criteria: row.criterios,
    validFrom: row.vigencia_inicio,
    validTo: row.vigencia_fim,
    version: row.versao,
    status: row.status,
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

function pendingItemFromRow(row: PendingItemRow): PendingItem {
  return {
    id: row.id,
    companyId: row.empresa_id,
    taxPeriodId: row.tax_period_id,
    sourceSnapshotId: row.source_snapshot_id,
    type: row.tipo,
    status: row.status,
    blocking: row.bloqueante,
    logicalKey: row.chave_logica,
    description: row.descricao,
    originData: row.dados_origem,
    createdAt: row.criado_em,
    createdBy: row.criado_por ?? null,
    resolvedAt: row.resolvido_em ?? null,
    resolvedBy: row.resolvido_por ?? null,
    resolutionNote: row.observacao_resolucao ?? null,
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
    rawAccountingValue: String(row.valor_contabil_bruto),
    calculatedValue: String(row.valor_calculado),
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
    value: String(row.valor),
    origin: row.origem,
    status: row.status,
    logicalKey: row.chave_logica,
    createdAt: row.criado_em,
  };
}

function taxCalculationFromRow(row: TaxCalculationRow): TaxCalculation {
  return {
    id: row.id,
    companyId: row.empresa_id,
    taxPeriodId: row.tax_period_id,
    sourceSnapshotId: row.source_snapshot_id,
    sourceSnapshotHash: row.source_snapshot_hash,
    fiscalYearProfileId: row.fiscal_year_profile_id,
    engine: row.motor,
    modelVersion: row.model_version,
    calculationVersion: row.calculation_version,
    versionStatus: row.version_status,
    status: row.status,
    taxPeriod: row.periodo_identidade,
    accountingResultSource: row.accounting_result_source,
    matrixVersion: row.matrix_version,
    ruleVersions: row.rule_versions as TaxCalculation["ruleVersions"],
    taxAdjustmentIds: row.tax_adjustment_ids,
    priorCalculationIds: row.prior_calculation_ids,
    fiscalBalanceUsages: row.fiscal_balance_usages as TaxCalculation["fiscalBalanceUsages"],
    creditUsages: row.credit_usages as TaxCalculation["creditUsages"],
    irpj: row.irpj as unknown as TaxCalculation["irpj"],
    csll: row.csll as unknown as TaxCalculation["csll"],
    validationIssues: row.validation_issues as TaxCalculation["validationIssues"],
    memory: row.memoria,
    logicalKey: row.chave_logica,
    createdAt: row.criado_em,
  };
}

function taxWorkflowHumanDecisionFromRow(row: TaxWorkflowHumanDecisionRow): TaxWorkflowHumanDecision {
  return {
    id: row.id,
    logicalKey: row.chave_logica,
    companyId: row.empresa_id,
    taxPeriodId: row.tax_period_id,
    sourceSnapshotId: row.source_snapshot_id,
    pendingItemId: row.pending_item_id,
    decisionType: row.tipo_decisao,
    userId: row.usuario_id,
    userEmail: row.usuario_email,
    justification: row.justificativa,
    beforeState: row.estado_anterior,
    afterState: row.estado_posterior,
    snapshotContext: row.contexto_snapshot,
    matrixVersionBefore: row.matrix_version_before,
    matrixVersionAfter: row.matrix_version_after,
    taxAdjustmentIds: row.tax_adjustment_ids,
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

export async function listFiscalYearProfiles(
  client: SupabaseClient,
  companyId: string,
  fiscalYear?: number,
) {
  let query = client
    .from("fiscal_year_profiles")
    .select("*")
    .eq("empresa_id", companyId);
  if (fiscalYear !== undefined) query = query.eq("exercicio", fiscalYear);
  const { data, error } = await query
    .order("exercicio", { ascending: false })
    .order("versao", { ascending: false });
  assertNoDatabaseError(error);
  return ((data ?? []) as FiscalYearProfileRow[]).map(profileFromRow);
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
    .order("codigo_periodo", { ascending: true })
    .order("versao", { ascending: true });
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxPeriodRow[]).map(taxPeriodFromRow);
}

export async function listTaxPeriodsByCode(
  client: SupabaseClient,
  companyId: string,
  fiscalYear: number,
  periodCode: string,
) {
  const { data, error } = await client
    .from("tax_periods")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("exercicio", fiscalYear)
    .eq("codigo_periodo", periodCode)
    .order("versao", { ascending: false });
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxPeriodRow[]).map(taxPeriodFromRow);
}

export async function upsertTaxPeriod(
  client: SupabaseClient,
  period: WorkflowTaxPeriod,
) {
  const { data, error } = await client
    .from("tax_periods")
    .upsert(taxPeriodRow(period), { onConflict: "id" })
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return taxPeriodFromRow(data as TaxPeriodRow);
}

export async function upsertTaxPeriods(
  client: SupabaseClient,
  periods: readonly WorkflowTaxPeriod[],
) {
  if (!periods.length) return [];
  const { data, error } = await client
    .from("tax_periods")
    .upsert(periods.map(taxPeriodRow), { onConflict: "id" })
    .select("*");
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxPeriodRow[]).map(taxPeriodFromRow);
}

export async function listSourceSnapshots(
  client: SupabaseClient,
  companyId: string,
  taxPeriodId: string,
) {
  const { data, error } = await client
    .from("source_snapshots")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("tax_period_id", taxPeriodId)
    .order("versao_snapshot", { ascending: false })
    .order("extraido_em", { ascending: false });
  assertNoDatabaseError(error);
  return ((data ?? []) as SourceSnapshotRow[]).map(sourceSnapshotFromRow);
}

export async function listPendingItems(
  client: SupabaseClient,
  companyId: string,
  taxPeriodId: string,
) {
  const { data, error } = await client
    .from("pending_items")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("tax_period_id", taxPeriodId)
    .order("status", { ascending: true })
    .order("criado_em", { ascending: true });
  assertNoDatabaseError(error);
  return ((data ?? []) as PendingItemRow[]).map(pendingItemFromRow);
}

export async function getPendingItem(
  client: SupabaseClient,
  companyId: string,
  pendingItemId: string,
) {
  const { data, error } = await client
    .from("pending_items")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("id", pendingItemId)
    .single();
  assertNoDatabaseError(error);
  return pendingItemFromRow(data as PendingItemRow);
}

export async function upsertPendingItems(
  client: SupabaseClient,
  pendingItems: readonly PendingItem[],
) {
  if (!pendingItems.length) return [];
  const { data, error } = await client
    .from("pending_items")
    .upsert(pendingItems.map(pendingItemRow), { onConflict: "chave_logica" })
    .select("*");
  assertNoDatabaseError(error);
  return ((data ?? []) as PendingItemRow[]).map(pendingItemFromRow);
}

export async function upsertPendingItem(
  client: SupabaseClient,
  pendingItem: PendingItem,
) {
  const [item] = await upsertPendingItems(client, [pendingItem]);
  if (!item) throw new Error("Pendência fiscal não persistida.");
  return item;
}

export async function upsertRuleExecutionResult(
  client: SupabaseClient,
  result: RuleExecutionResult,
) {
  const [item] = await upsertRuleExecutionResults(client, [result]);
  if (!item) throw new Error("Resultado de regra fiscal não persistido.");
  return item;
}

export async function upsertRuleExecutionResults(
  client: SupabaseClient,
  results: readonly RuleExecutionResult[],
) {
  if (!results.length) return [];
  const { data, error } = await client
    .from("rule_execution_results")
    .upsert(results.map(ruleExecutionResultRow), { onConflict: "chave_logica" })
    .select("*");
  assertNoDatabaseError(error);
  return ((data ?? []) as RuleExecutionResultRow[]).map(ruleExecutionResultFromRow);
}

export async function listRuleExecutionResults(
  client: SupabaseClient,
  companyId: string,
  taxPeriodId: string,
) {
  const { data, error } = await client
    .from("rule_execution_results")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("tax_period_id", taxPeriodId)
    .order("codigo_conta", { ascending: true });
  assertNoDatabaseError(error);
  return ((data ?? []) as RuleExecutionResultRow[]).map(ruleExecutionResultFromRow);
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

export async function listTaxAdjustments(
  client: SupabaseClient,
  companyId: string,
  taxPeriodId: string,
) {
  const { data, error } = await client
    .from("tax_adjustments")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("tax_period_id", taxPeriodId)
    .order("tributo", { ascending: true })
    .order("codigo_conta", { ascending: true });
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxAdjustmentRow[]).map(taxAdjustmentFromRow);
}

export async function upsertTaxCalculation(
  client: SupabaseClient,
  calculation: TaxCalculation,
) {
  const { data, error } = await client
    .from("tax_calculations")
    .upsert(taxCalculationRow(calculation), { onConflict: "chave_logica" })
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return taxCalculationFromRow(data as TaxCalculationRow);
}

export async function listTaxCalculations(
  client: SupabaseClient,
  companyId: string,
  taxPeriodId: string,
) {
  const { data, error } = await client
    .from("tax_calculations")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("tax_period_id", taxPeriodId)
    .order("calculation_version", { ascending: false })
    .order("criado_em", { ascending: false });
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxCalculationRow[]).map(taxCalculationFromRow);
}

export async function listTaxWorkflowHumanDecisions(
  client: SupabaseClient,
  companyId: string,
  taxPeriodId: string,
) {
  const { data, error } = await client
    .from("tax_workflow_human_decisions")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("tax_period_id", taxPeriodId)
    .order("criado_em", { ascending: true });
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxWorkflowHumanDecisionRow[]).map(taxWorkflowHumanDecisionFromRow);
}

export async function upsertTaxWorkflowHumanDecision(
  client: SupabaseClient,
  decision: TaxWorkflowHumanDecision,
) {
  const { data, error } = await client
    .from("tax_workflow_human_decisions")
    .upsert(taxWorkflowHumanDecisionRow(decision), { onConflict: "chave_logica" })
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return taxWorkflowHumanDecisionFromRow(data as TaxWorkflowHumanDecisionRow);
}


function taxDossierArtifactMetadata(value: JsonValue): readonly MonthlyTaxDossierArtifactMetadata[] {
  return Array.isArray(value) ? value as unknown as readonly MonthlyTaxDossierArtifactMetadata[] : [];
}

function taxDossierRow(record: TaxDossierRecord): TaxDossierRow {
  return {
    id: record.id,
    chave_logica: record.logicalKey,
    empresa_id: record.companyId,
    tax_period_id: record.taxPeriodId,
    tax_period_version: record.taxPeriodVersion,
    status: record.status,
    storage_bucket: record.storageBucket,
    storage_prefix: record.storagePrefix,
    manifest: record.manifest,
    manifest_hash: record.manifestHash,
    generated_at: record.generatedAt,
    generated_by: record.generatedBy,
    artifact_metadata: record.artifactMetadata as unknown as JsonValue,
    integrity_status: record.integrityStatus,
    failure_code: record.failureCode ?? null,
    failure_message: record.failureMessage ?? null,
    comparison_source_versions: record.comparisonSourceVersions,
  };
}

function taxDossierFromRow(row: TaxDossierRow): TaxDossierRecord {
  return {
    id: row.id,
    logicalKey: row.chave_logica,
    companyId: row.empresa_id,
    taxPeriodId: row.tax_period_id,
    taxPeriodVersion: row.tax_period_version,
    status: row.status,
    storageBucket: row.storage_bucket,
    storagePrefix: row.storage_prefix,
    manifest: row.manifest,
    manifestHash: row.manifest_hash,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    artifactMetadata: taxDossierArtifactMetadata(row.artifact_metadata),
    integrityStatus: row.integrity_status,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    comparisonSourceVersions: row.comparison_source_versions ?? [],
    createdAt: row.criado_em,
    updatedAt: row.atualizado_em,
  };
}

export async function listTaxDossiers(
  client: SupabaseClient,
  companyId: string,
  taxPeriodIds: readonly string[] = [],
) {
  let query = client
    .from("tax_dossiers")
    .select("*")
    .eq("empresa_id", companyId);
  if (taxPeriodIds.length) query = query.in("tax_period_id", [...taxPeriodIds]);
  const { data, error } = await query
    .order("tax_period_version", { ascending: true })
    .order("generated_at", { ascending: false });
  assertNoDatabaseError(error);
  return ((data ?? []) as TaxDossierRow[]).map(taxDossierFromRow);
}

export async function getTaxDossier(
  client: SupabaseClient,
  companyId: string,
  dossierId: string,
) {
  const { data, error } = await client
    .from("tax_dossiers")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("id", dossierId)
    .single();
  assertNoDatabaseError(error);
  return taxDossierFromRow(data as TaxDossierRow);
}

export async function getTaxDossierByTaxPeriod(
  client: SupabaseClient,
  companyId: string,
  taxPeriodId: string,
) {
  const { data, error } = await client
    .from("tax_dossiers")
    .select("*")
    .eq("empresa_id", companyId)
    .eq("tax_period_id", taxPeriodId)
    .maybeSingle();
  assertNoDatabaseError(error);
  return data ? taxDossierFromRow(data as TaxDossierRow) : null;
}

export async function insertTaxDossier(
  client: SupabaseClient,
  dossier: TaxDossierRecord,
) {
  const { data, error } = await client
    .from("tax_dossiers")
    .upsert(taxDossierRow(dossier), { onConflict: "chave_logica" })
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return taxDossierFromRow(data as TaxDossierRow);
}

export async function upsertTaxDossierGenerationFailure(
  client: SupabaseClient,
  input: {
    readonly id: string;
    readonly logicalKey: string;
    readonly companyId: string;
    readonly taxPeriodId: string;
    readonly taxPeriodVersion: number;
    readonly storageBucket: string;
    readonly storagePrefix: string;
    readonly generatedBy: string;
    readonly generatedAt: string;
    readonly failureCode: string;
    readonly failureMessage: string;
  },
) {
  const { data, error } = await client
    .from("tax_dossiers")
    .upsert({
      id: input.id,
      chave_logica: input.logicalKey,
      empresa_id: input.companyId,
      tax_period_id: input.taxPeriodId,
      tax_period_version: input.taxPeriodVersion,
      status: "GENERATION_FAILED",
      storage_bucket: input.storageBucket,
      storage_prefix: input.storagePrefix,
      manifest: {},
      manifest_hash: "",
      generated_at: input.generatedAt,
      generated_by: input.generatedBy,
      artifact_metadata: [],
      integrity_status: "FAILED",
      failure_code: input.failureCode,
      failure_message: input.failureMessage,
      comparison_source_versions: [],
    }, { onConflict: "chave_logica" })
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return taxDossierFromRow(data as TaxDossierRow);
}
export async function listFiscalMatrixContext(
  client: SupabaseClient,
  companyId: string,
  fiscalYear: number,
): Promise<FiscalMatrixRepositoryContext> {
  const [
    accountingCharts,
    companyAccountingCharts,
    mappings,
    companyAccountMappingOverrides,
    fiscalNatures,
    fiscalRules,
    companyRuleOverrides,
  ] = await Promise.all([
    client.from("accounting_charts").select("*").eq("ativo", true).order("codigo", { ascending: true }),
    client
      .from("company_accounting_charts")
      .select("*")
      .eq("empresa_id", companyId)
      .eq("ativo", true)
      .or(`exercicio.is.null,exercicio.eq.${fiscalYear}`)
      .order("versao", { ascending: false }),
    client.from("account_fiscal_mappings").select("*").eq("ativo", true).order("codigo_conta", { ascending: true }),
    client
      .from("company_account_mapping_overrides")
      .select("*")
      .eq("empresa_id", companyId)
      .eq("ativo", true)
      .order("versao", { ascending: false }),
    client.from("fiscal_natures").select("*").eq("ativo", true).order("codigo", { ascending: true }),
    client.from("fiscal_rules").select("*").eq("status", "ACTIVE").order("codigo_regra", { ascending: true }),
    client
      .from("company_rule_overrides")
      .select("*")
      .eq("empresa_id", companyId)
      .eq("status", "ACTIVE")
      .order("versao", { ascending: false }),
  ]);
  assertNoDatabaseError(accountingCharts.error);
  assertNoDatabaseError(companyAccountingCharts.error);
  assertNoDatabaseError(mappings.error);
  assertNoDatabaseError(companyAccountMappingOverrides.error);
  assertNoDatabaseError(fiscalNatures.error);
  assertNoDatabaseError(fiscalRules.error);
  assertNoDatabaseError(companyRuleOverrides.error);
  return {
    accountingCharts: ((accountingCharts.data ?? []) as AccountingChartRow[]).map(accountingChartFromRow),
    companyAccountingCharts: ((companyAccountingCharts.data ?? []) as CompanyAccountingChartRow[]).map(companyAccountingChartFromRow),
    mappings: ((mappings.data ?? []) as AccountFiscalMappingRow[]).map(accountFiscalMappingFromRow),
    companyAccountMappingOverrides: ((companyAccountMappingOverrides.data ?? []) as CompanyAccountMappingOverrideRow[]).map(companyAccountMappingOverrideFromRow),
    fiscalNatures: ((fiscalNatures.data ?? []) as FiscalNatureRow[]).map(fiscalNatureFromRow),
    fiscalRules: ((fiscalRules.data ?? []) as FiscalRuleRow[]).map(fiscalRuleFromRow),
    companyRuleOverrides: ((companyRuleOverrides.data ?? []) as CompanyRuleOverrideRow[]).map(companyRuleOverrideFromRow),
  };
}

export async function upsertFiscalNature(client: SupabaseClient, nature: FiscalNature) {
  const { data, error } = await client
    .from("fiscal_natures")
    .upsert(fiscalNatureRow(nature), { onConflict: "id" })
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return fiscalNatureFromRow(data as FiscalNatureRow);
}

export async function upsertAccountFiscalMapping(client: SupabaseClient, mapping: AccountFiscalMapping) {
  const { data, error } = await client
    .from("account_fiscal_mappings")
    .upsert(accountFiscalMappingRow(mapping), { onConflict: "id" })
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return accountFiscalMappingFromRow(data as AccountFiscalMappingRow);
}

export async function upsertFiscalRule(client: SupabaseClient, rule: FiscalRule) {
  const { data, error } = await client
    .from("fiscal_rules")
    .upsert(fiscalRuleRow(rule), { onConflict: "id" })
    .select("*")
    .single();
  assertNoDatabaseError(error);
  return fiscalRuleFromRow(data as FiscalRuleRow);
}

export async function commitTaxPeriodClose(
  client: SupabaseClient,
  input: CommitTaxPeriodCloseInput,
) {
  const { data, error } = await client.rpc("close_irpj_csll_period", {
    p_empresa_id: input.companyId,
    p_tax_period_id: input.closedPeriod.id,
    p_tax_calculation_id: input.taxCalculation.id,
    p_closed_manifest_id: input.manifest.id,
    p_closed_manifest: input.manifest as unknown as JsonObject,
    p_schedule_competencia: input.scheduleCompetence,
    p_schedule_modulo: input.scheduleCompletion.modulo,
    p_schedule_setor: input.scheduleCompletion.setor,
    p_usuario_id: input.userId,
    p_usuario_email: input.userEmail,
    p_fechado_em: input.timestamp,
    p_superseded_tax_period_ids: input.supersededPeriods.map((period) => period.id),
    p_stale_tax_period_ids: input.stalePeriods.map((period) => period.id),
  });
  assertNoDatabaseError(error);
  return data as JsonObject;
}
