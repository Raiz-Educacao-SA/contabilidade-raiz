import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const component = readFileSync(resolve(root, "app/irpj-csll-assessment.tsx"), "utf8");
const page = readFileSync(resolve(root, "app/page.tsx"), "utf8");
const css = readFileSync(resolve(root, "app/modules.css"), "utf8");

function assertOrdered(source, labels) {
  let previous = -1;
  for (const label of labels) {
    const current = source.indexOf(label);
    assert.ok(current > previous, `${label} should appear after the previous tab`);
    previous = current;
  }
}

function blockBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0, `${start} should exist`);
  assert.ok(to > from, `${end} should appear after ${start}`);
  return source.slice(from, to);
}

describe("IRPJ/CSLL native UI", () => {
  it("preserves the approved native tab order from the full-screen prototype", () => {
    assertOrdered(component, [
      'label: "Visão Geral"',
      'label: "Memória de Cálculo"',
      'label: "Ajustes Fiscais"',
      'label: "Pendências"',
      'label: "Saldos e Créditos"',
      'label: "Apuração do Exercício"',
      'label: "Versões e Dossiê"',
    ]);
  });

  it("is mounted from the contabil module with global company and competence selectors", () => {
    assert.match(page, /import IrpjCsllAssessment from "@\/app\/irpj-csll-assessment";/);
    assert.match(page, /selectedModule === "contabil" && accountingTab === "irpj-csll"/);
    assert.match(page, /companyId=\{companyId\}/);
    assert.match(page, /competence=\{competence\}/);
    assert.match(page, /companyCode=\{company\?\.empresas\?\.codcoligada \?\? ""\}/);
    assert.match(page, /accessToken=\{session\.access_token\}/);
    assert.match(page, /canWrite=\{canWrite\}/);
  });

  it("keeps the fiscal engine field read-only and sourced from FISCAL_YEAR_PROFILE", () => {
    assert.match(component, /data-field="motor-readonly"/);
    assert.match(component, /readOnly aria-readonly="true"/);
    assert.match(component, /FISCAL_YEAR_PROFILE/);
    assert.doesNotMatch(component, /onChange=\{[^}]*engine/i);
  });

  it("routes mutable UI actions through backend endpoints including automatic confirmation", () => {
    assert.match(component, /runCommand\("preview"/);
    assert.match(component, /runCommand\("reprocess"/);
    assert.match(component, /runCommand\("close"/);
    assert.match(component, /runCommand\("versions\/open"/);
    assert.match(component, /confirm-auto/);
    assert.match(component, /correct-auto/);
    assert.match(component, /method: "POST"/);
  });

  it("does not implement tax calculation logic in React", () => {
    assert.doesNotMatch(component, /calculateAnnualMonthly|ANNUAL_MONTHLY_ENGINE|IRPJ_RATE|CSLL_RATE|COMPENSATION_LIMIT|normalTax\s*=|additionalTax\s*=/);
  });

  it("formats money with the Brazilian BRL formatter", () => {
    assert.match(component, /new Intl\.NumberFormat\("pt-BR"/);
    assert.match(component, /style: "currency"/);
    assert.match(component, /currency: "BRL"/);
    assert.match(component, /minimumFractionDigits: 2/);
  });

  it("shows source snapshot interval and closing-entry choice as operational source", () => {
    assert.match(component, /Fonte da apuração/);
    assert.match(component, /operationalSourceLabel\(sourceSnapshot\?\.source\)/);
    assert.match(component, /sourceSnapshot\.taxPeriod\.startDate/);
    assert.match(component, /sourceSnapshot\.taxPeriod\.endDate/);
    assert.match(component, /yesNo\(sourceSnapshot\?\.parameters\.includeClosingEntries\)/);
    assert.match(component, /shortHash\(sourceSnapshot\?\.hash\)/);
    assert.doesNotMatch(component, /Rastreabilidade da fonte/);
  });

  it("does not show closed current versions as pending close in the overview", () => {
    assert.match(component, /const closeIssues = isClosedPeriod \? \[\] : dashboard\?\.closeIssues \?\? \[\]/);
    assert.match(component, /taxPeriod\?\.status === "CLOSED_CURRENT" \? "Fechado vigente"/);
    assert.match(component, /Versão fechada vigente; alterações exigem nova versão/);
    assert.match(component, /Abrir \{nextVersionLabel\}/);
  });

  it("opens additions and exclusions by account in Memory and Annual views", () => {
    assert.match(component, /memory-breakdown/);
    assert.match(component, /adjustmentsForBreakdown/);
    assert.match(component, /\(\+\) Adições IRPJ/);
    assert.match(component, /\(-\) Exclusões IRPJ/);
    assert.match(component, /\(\+\) Adições CSLL/);
    assert.match(component, /\(-\) Exclusões CSLL/);
    assert.doesNotMatch(component, /Demais/);
  });

  it("uses final fiscal memory labels without available balance or compensation limit", () => {
    assert.match(component, /\(-\) Prejuízo Fiscal utilizado/);
    assert.match(component, /\(-\) Base Negativa utilizada/);
    assert.match(component, /\(-\) CSLL Retida/);
    assert.match(component, /IRPJ a recolher no mês/);
    assert.match(component, /CSLL a recolher no mês/);
    assert.match(component, /Resultado contábil antes do IRPJ/);
    assert.match(component, /Resultado contábil antes da CSLL/);
    assert.doesNotMatch(component, /Prejuízo Fiscal disponível/);
    assert.doesNotMatch(component, /Base Negativa disponível/);
    assert.doesNotMatch(component, /Limite de compensação/);
    assert.doesNotMatch(component, /Deduções explicitamente suportadas|Deduções CSLL suportadas|Dedução explícita CSLL/);
  });

  it("shows adjustment base and does not force launch composition for full-account balances", () => {
    const adjustments = blockBetween(component, 'activeTab === "adjustments"', 'activeTab === "pending"');
    assert.match(adjustments, /Base do ajuste/);
    assert.match(component, /Saldo integral da conta/);
    assert.match(component, /Lançamentos específicos/);
    assert.match(adjustments, /adjustmentSupportLabel/);
    assert.doesNotMatch(adjustments, /Conta\/saldo/);
    assert.match(adjustments, /Ver composição/);
    assert.match(component, /accountCodeOnly\(item\.accountCode\)/);
    assert.match(component, /adjustmentDescription\(item, result\)/);
    assert.match(component, /groupAdjustmentRows/);
    assert.match(component, /adjustment-treatment-stack/);
  });
  it("renders occurrence summary and automatic classification governance", () => {
    const pending = blockBetween(component, 'activeTab === "pending"', 'activeTab === "balances"');
    assert.match(pending, /Ocorrências da competência/);
    assert.match(pending, /Contas novas identificadas/);
    assert.match(pending, /Classificadas automaticamente/);
    assert.match(pending, /Aguardando classificação/);
    assert.match(pending, /Ocorrências condicionais/);
    assert.match(pending, /Impedimentos para fechamento/);
    assert.match(pending, /Aguardando confirmação/);
    assert.match(pending, /Confirmar classificação/);
    assert.match(pending, /Corrigir classificação/);
    assert.match(pending, /Justificativa da correção/);
    assert.doesNotMatch(pending, /Total aberto|Automática L2|OK AUTOMÁTICO|L1\/L2/);
  });

  it("separates accumulated movement from launch samples in pending details", () => {
    assert.match(component, /MOVIMENTAÇÃO ACUMULADA/);
    assert.match(component, /AMOSTRA DOS LANÇAMENTOS/);
    assert.match(component, /Sugestão fiscal não disponível/);
    assert.doesNotMatch(component, /Amostra de movimentos não disponível no payload atual/);
  });


  it("requires explicit IRPJ and CSLL treatment selection for pending classifications", () => {
    const pending = blockBetween(component, 'activeTab === "pending"', 'activeTab === "balances"');
    assert.match(component, /const treatmentSelectOptions = \[\["", "Selecione o tratamento"\]/);
    assert.match(component, /const conditionalSelectOptions = \[\["", "Selecione o tratamento"\]/);
    assert.match(component, /name="irpjTreatment" defaultValue="" required/);
    assert.match(component, /name="csllTreatment" defaultValue="" required/);
    assert.match(component, /name="irpjDecision" defaultValue="" required/);
    assert.match(component, /name="csllDecision" defaultValue="" required/);
    const newAccountForm = blockBetween(component, "Classificação fiscal da nova conta", "Vigência da classificação");
    assert.doesNotMatch(newAccountForm, /defaultValue="NO_ADJUSTMENT"/);
  });
  it("renders balances with current saldo and on-demand composition", () => {
    const balances = blockBetween(component, 'activeTab === "balances"', 'activeTab === "annual"');
    assert.match(balances, /Saldo atual após utilização/);
    assert.match(balances, /Disponível: \{money\(card\.row\?\.available\)\}/);
    assert.match(balances, /Utilizado: \{money\(card\.row\?\.used\)\}/);
    assert.match(balances, /Disponível<\/th><th className="num-head">Utilizado<\/th><th className="num-head">Saldo/);
    assert.match(balances, /Ver composição/);
    assert.match(component, /compositionLabel: "Ano\/período de origem"/);
    assert.match(balances, /selectedBalance\.compositionLabel/);
    assert.match(balances, /CSLL Retida/);
    assert.doesNotMatch(balances, /Enriquecimentos de ECF|Deduções CSLL/);
    assert.doesNotMatch(component, /Total IRRF/i);
  });

  it("keeps Annual as a monthly available-data view without starting phase 9", () => {
    const annual = blockBetween(component, 'activeTab === "annual"', 'activeTab === "versions"');
    const annualRows = blockBetween(component, "const irpjAnnualRows", "function isRecord");
    assert.match(annual, /Esta aba apresenta somente as apurações mensais já disponíveis/);
    assert.match(annual, /renderAnnualTable\("IRPJ", "IRPJ — Apuração do Exercício", irpjAnnualRows\)/);
    assert.match(annual, /renderAnnualTable\("CSLL", "CSLL — Apuração do Exercício", csllAnnualRows\)/);
    assert.match(annualRows, /\(-\) Prejuízo Fiscal utilizado/);
    assert.match(annualRows, /\(-\) Base Negativa utilizada/);
    assert.match(annualRows, /\(-\) CSLL Retida/);
    assert.match(css, /\.annual-table td:first-child[\s\S]*position: sticky/);
    assert.doesNotMatch(annual, /Fase 9|FASE 9/);
  });

  it("shows version cards with IRPJ and CSLL, comparison, and separated dossier sections", () => {
    const versions = blockBetween(component, 'activeTab === "versions"', '</section>\n  );');
    assert.match(versions, /IRPJ: \{money\(supersededCalculation\?\.irpj\.currentMonthTaxPayable\)\}/);
    assert.match(versions, /CSLL: \{money\(supersededCalculation\?\.csll\.currentMonthTaxPayable\)\}/);
    assert.match(versions, /IRPJ: \{money\(officialCalculation\?\.irpj\.currentMonthTaxPayable\)\}/);
    assert.match(versions, /CSLL: \{money\(officialCalculation\?\.csll\.currentMonthTaxPayable\)\}/);
    assert.match(versions, /Comparativo ainda não gerado/);
    assert.match(versions, /V01 × V02|Comparativo \$\{versionLabel/);
    assert.match(versions, /Composição/);
    assert.match(versions, /Diferença/);
    assert.match(versions, /Causa/);
    assert.match(versions, /comparisonView/);
    assert.match(versions, /por conta/);
    assert.match(versions, /Causa não identificada/);
    assert.match(versions, /Trilha da versão \/ Conteúdo da versão/);
    assert.match(versions, /Dossiê materializado/);
    assert.match(versions, /Gerar dossiê/);
    assert.match(versions, /Baixar XLSX/);
    assert.match(versions, /Baixar PDF/);
    assert.match(versions, /Matriz/);
    assert.match(versions, /Disponível após gerar o dossiê\./);
    assert.match(versions, /Manifest/);
    assert.match(versions, /Ver manifest/);
    assert.match(versions, /Comparar versões/);
    assert.match(versions, /Detalhes técnicos \/ Auditoria/);
    assert.doesNotMatch(versions, /ação Baixar|Dossiê não gerado/);
  });
  it("keeps visual changes scoped to the IRPJ/CSLL workspace", () => {
    assert.match(css, /\.irpj-csll-workspace/);
    assert.match(css, /\.memory-breakdown/);
    assert.match(css, /\.occurrence-summary/);
    assert.match(css, /\.balance-kpis/);
    assert.match(css, /\.compare-matrix/);
    assert.doesNotMatch(css, /\.irpj-pending-item/);
  });
});