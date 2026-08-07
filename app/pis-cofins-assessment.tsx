"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator, ChevronDown, ChevronUp, Download, ReceiptText, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import * as XLSX from "xlsx";

type TaxRegime = "Cumulativo" | "Não-Cumulativo" | "";
type RevenueRow = {
  line: number;
  branch: string;
  service: string;
  grossRevenue: number;
  discounts: number;
  netRevenue: number;
  regime: TaxRegime;
};
type AnnualFeeAllocationRow = RevenueRow & {
  company: string;
  entryId: string;
  document: string;
  sourceSystem: string;
  date: string;
  reduced: number;
  account: string;
  complement: string;
  costCenter: string;
};
type CancelledRow = {
  studentCode: string;
  student: string;
  customer: string;
  invoice: string;
  rps: string;
  sourceCompetence: string;
  entryId: string;
  company: string;
  branch: string;
  movementId: string;
  movementType: string;
  issueDate: string;
  cancellationDate: string;
  grossValue: number;
  discountValue: number;
  netValue: number;
  service: string;
  regime: TaxRegime;
  history: string;
  treatment: string;
};
type OtherRevenueRow = {
  company: string;
  branch: string;
  entryId: string;
  document: string;
  integrationKey: string;
  sourceSystem: string;
  date: string;
  reduced: number;
  account: string;
  description: string;
  group: string;
  value: number;
  classification: string;
  taxBase: number;
  pisRate: number;
  cofinsRate: number;
  pis: number;
  cofins: number;
  user: string;
  complement: string;
  costCenter: string;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const rates = {
  Cumulativo: { pis: 0.0065, cofins: 0.03 },
  "Não-Cumulativo": { pis: 0.0165, cofins: 0.076 },
} as const;

function branchValues<T extends { branch: string }>(rows: T[]) {
  return [...new Set(rows.map((row) => String(row.branch || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
}

function restoredBranches<T extends { branch: string }>(saved: unknown, rows: T[]) {
  return Array.isArray(saved) && saved.length ? saved.map(String) : branchValues(rows);
}

function BranchSelector({ branches, selected, onChange }: { branches: string[]; selected: string[]; onChange: (branches: string[]) => void }) {
  if (!branches.length) return null;
  return <fieldset className="tax-branch-selector" data-branch-filter="true"><legend>Selecionar filiais</legend>{branches.map((branch) => <label key={branch}><input type="checkbox" checked={selected.includes(branch)} onChange={(event) => onChange(event.target.checked ? [...selected, branch] : selected.filter((item) => item !== branch))} />Filial {branch}</label>)}</fieldset>;
}

export default function PisCofinsAssessment({
  companyCode,
  competence,
  accessToken,
}: {
  companyCode: string;
  competence: string;
  accessToken: string;
}) {
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [cancelledRows, setCancelledRows] = useState<CancelledRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [classified, setClassified] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ignoredCancelled, setIgnoredCancelled] = useState(0);
  const [otherRevenueRows, setOtherRevenueRows] = useState<OtherRevenueRow[]>([]);
  const [otherRevenueLoading, setOtherRevenueLoading] = useState(false);
  const [otherRevenueLoaded, setOtherRevenueLoaded] = useState(false);
  const [otherRevenueError, setOtherRevenueError] = useState("");
  const [annualFeeRows, setAnnualFeeRows] = useState<AnnualFeeAllocationRow[]>([]);
  const [annualFeeLoading, setAnnualFeeLoading] = useState(false);
  const [annualFeeLoaded, setAnnualFeeLoaded] = useState(false);
  const [annualFeeError, setAnnualFeeError] = useState("");
  const [cancelledLoading, setCancelledLoading] = useState(false);
  const [cancelledLoaded, setCancelledLoaded] = useState(false);
  const [cancelledError, setCancelledError] = useState("");
  const [monthlyVisible, setMonthlyVisible] = useState(true);
  const [otherRevenueVisible, setOtherRevenueVisible] = useState(true);
  const [annualFeeVisible, setAnnualFeeVisible] = useState(true);
  const [cancelledVisible, setCancelledVisible] = useState(true);
  const [monthlyBranches, setMonthlyBranches] = useState<string[]>([]);
  const [otherRevenueBranches, setOtherRevenueBranches] = useState<string[]>([]);
  const [annualFeeBranches, setAnnualFeeBranches] = useState<string[]>([]);
  const [cancelledBranches, setCancelledBranches] = useState<string[]>([]);
  const [requestedBranches, setRequestedBranches] = useState<string[]>([]);
  const [branchDraft, setBranchDraft] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [error, setError] = useState("");
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  const competenceLabel = competence.split("-").reverse().join("/");
  const completeAssessmentReady = classified && otherRevenueLoaded && annualFeeLoaded && cancelledLoaded;
  const hasAssessment = loaded || otherRevenueLoaded || annualFeeLoaded || cancelledLoaded;
  const storageKey = `pis-cofins-assessment:${companyCode}:${competence}`;
  const branchQuery = requestedBranches.length
    ? `&branches=${encodeURIComponent(requestedBranches.join(","))}`
    : "";

  useEffect(() => {
    setActionsTarget(document.getElementById("pis-cofins-filter-actions"));
  }, []);

  useEffect(() => {
    setStorageReady(false);
    setOtherRevenueError("");
    setAnnualFeeError("");
    setCancelledError("");
    setError("");
    try {
      const saved = window.localStorage.getItem(storageKey);
      const assessment = saved ? JSON.parse(saved) : null;
      setRows(assessment?.rows || []);
      setCancelledRows(assessment?.cancelledRows || []);
      setLoaded(Boolean(assessment?.loaded));
      setClassified(Boolean(assessment?.loaded));
      setIgnoredCancelled(Number(assessment?.ignoredCancelled || 0));
      setOtherRevenueRows(assessment?.otherRevenueRows || []);
      setOtherRevenueLoaded(Boolean(assessment?.otherRevenueLoaded));
      setAnnualFeeRows(assessment?.annualFeeRows || []);
      setAnnualFeeLoaded(Boolean(assessment?.annualFeeLoaded));
      setCancelledLoaded(Boolean(assessment?.cancelledLoaded));
      setDetailsOpen(Boolean(assessment?.detailsOpen));
      setMonthlyVisible(assessment?.monthlyVisible ?? true);
      setOtherRevenueVisible(assessment?.otherRevenueVisible ?? true);
      setAnnualFeeVisible(assessment?.annualFeeVisible ?? true);
      setCancelledVisible(assessment?.cancelledVisible ?? true);
      setMonthlyBranches(restoredBranches(assessment?.monthlyBranches, assessment?.rows || []));
      setOtherRevenueBranches(restoredBranches(assessment?.otherRevenueBranches, assessment?.otherRevenueRows || []));
      setAnnualFeeBranches(restoredBranches(assessment?.annualFeeBranches, assessment?.annualFeeRows || []));
      setCancelledBranches(restoredBranches(assessment?.cancelledBranches, assessment?.cancelledRows || []));
      setRequestedBranches(Array.isArray(assessment?.requestedBranches) ? assessment.requestedBranches.map(String) : []);
    } catch {
      setRows([]);
      setCancelledRows([]);
      setLoaded(false);
      setClassified(false);
      setIgnoredCancelled(0);
      setOtherRevenueRows([]);
      setOtherRevenueLoaded(false);
      setAnnualFeeRows([]);
      setAnnualFeeLoaded(false);
      setCancelledLoaded(false);
      setMonthlyBranches([]); setOtherRevenueBranches([]); setAnnualFeeBranches([]); setCancelledBranches([]);
      setRequestedBranches([]); setBranchDraft("");
    } finally {
      setStorageReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(storageKey, JSON.stringify({
      rows,
      cancelledRows,
      loaded,
      classified,
      ignoredCancelled,
      otherRevenueRows,
      otherRevenueLoaded,
      annualFeeRows,
      annualFeeLoaded,
      cancelledLoaded,
      detailsOpen,
      monthlyVisible,
      otherRevenueVisible,
      annualFeeVisible,
      cancelledVisible,
      monthlyBranches, otherRevenueBranches, annualFeeBranches, cancelledBranches,
      requestedBranches,
    }));
  }, [storageReady, storageKey, rows, cancelledRows, loaded, classified, ignoredCancelled, otherRevenueRows, otherRevenueLoaded, annualFeeRows, annualFeeLoaded, cancelledLoaded, detailsOpen, monthlyVisible, otherRevenueVisible, annualFeeVisible, cancelledVisible, monthlyBranches, otherRevenueBranches, annualFeeBranches, cancelledBranches, requestedBranches]);

  function clearAssessment() {
    setRows([]);
    setCancelledRows([]);
    setLoaded(false);
    setClassified(false);
    setIgnoredCancelled(0);
    setOtherRevenueRows([]);
    setOtherRevenueLoaded(false);
    setAnnualFeeRows([]);
    setAnnualFeeLoaded(false);
    setCancelledLoaded(false);
    setMonthlyBranches([]); setOtherRevenueBranches([]); setAnnualFeeBranches([]); setCancelledBranches([]);
    setRequestedBranches([]); setBranchDraft("");
    setDetailsOpen(false);
    setOtherRevenueError("");
    setAnnualFeeError("");
    setCancelledError("");
    setError("");
    window.localStorage.removeItem(storageKey);
  }

  async function update() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/totvs/pis-cofins?company=${companyCode}&competence=${competence}${branchQuery}`,
        {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error || "Falha ao consultar a Planilha.NET 53.",
        );
      if (!payload.rows?.length)
        throw new Error(
          "Nenhuma linha foi encontrada para a empresa e competência selecionadas.",
        );
      const nextRows = payload.rows || [];
      setRows(nextRows);
      setMonthlyBranches(requestedBranches.length
        ? requestedBranches.filter((branch) => branchValues(nextRows).includes(branch))
        : branchValues(nextRows));
      setIgnoredCancelled(payload.ignoredCancelled || 0);
      setLoaded(true);
      setClassified(true);
      setDetailsOpen(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => rows.filter((row) => monthlyBranches.includes(String(row.branch || "").trim())), [rows, monthlyBranches]);
  const filteredOtherRevenueRows = useMemo(() => otherRevenueRows.filter((row) => otherRevenueBranches.includes(String(row.branch || "").trim())), [otherRevenueRows, otherRevenueBranches]);
  const filteredAnnualFeeRows = useMemo(() => annualFeeRows.filter((row) => annualFeeBranches.includes(String(row.branch || "").trim())), [annualFeeRows, annualFeeBranches]);
  const filteredCancelledRows = useMemo(() => cancelledRows.filter((row) => cancelledBranches.includes(String(row.branch || "").trim())), [cancelledRows, cancelledBranches]);
  const allBranches = useMemo(() => branchValues([...rows, ...otherRevenueRows, ...annualFeeRows, ...cancelledRows]), [rows, otherRevenueRows, annualFeeRows, cancelledRows]);
  const selectableBranches = useMemo(
    () => [...new Set([...requestedBranches, ...allBranches])].sort((a, b) => Number(a) - Number(b)),
    [requestedBranches, allBranches],
  );

  function applyBranchFilter() {
    const branches = [...new Set(
      branchDraft.split(/[,;\s]+/).map((value) => value.trim()).filter((value) => /^\d+$/.test(value)),
    )].sort((a, b) => Number(a) - Number(b));
    if (!branches.length) {
      selectAllBranches();
      return;
    }
    setRequestedBranches(branches);
    setMonthlyBranches(branches.filter((branch) => branchValues(rows).includes(branch)));
    setOtherRevenueBranches(branches.filter((branch) => branchValues(otherRevenueRows).includes(branch)));
    setAnnualFeeBranches(branches.filter((branch) => branchValues(annualFeeRows).includes(branch)));
    setCancelledBranches(branches.filter((branch) => branchValues(cancelledRows).includes(branch)));
  }

  function selectAllBranches() {
    setRequestedBranches([]);
    setBranchDraft("");
    setMonthlyBranches(branchValues(rows));
    setOtherRevenueBranches(branchValues(otherRevenueRows));
    setAnnualFeeBranches(branchValues(annualFeeRows));
    setCancelledBranches(branchValues(cancelledRows));
  }

  function branchSelectedEverywhere(branch: string) {
    const sources = [
      { available: branchValues(rows), selected: monthlyBranches },
      { available: branchValues(otherRevenueRows), selected: otherRevenueBranches },
      { available: branchValues(annualFeeRows), selected: annualFeeBranches },
      { available: branchValues(cancelledRows), selected: cancelledBranches },
    ];
    return sources.every((source) => !source.available.includes(branch) || source.selected.includes(branch));
  }

  function toggleGlobalBranch(branch: string, checked: boolean) {
    setRequestedBranches((current) => {
      const base = current.length ? current : allBranches;
      return checked
        ? [...new Set([...base, branch])].sort((a, b) => Number(a) - Number(b))
        : base.filter((item) => item !== branch);
    });
    const update = (available: string[], selected: string[], setter: (branches: string[]) => void) => {
      if (!available.includes(branch)) return;
      setter(checked ? [...new Set([...selected, branch])] : selected.filter((item) => item !== branch));
    };
    update(branchValues(rows), monthlyBranches, setMonthlyBranches);
    update(branchValues(otherRevenueRows), otherRevenueBranches, setOtherRevenueBranches);
    update(branchValues(annualFeeRows), annualFeeBranches, setAnnualFeeBranches);
    update(branchValues(cancelledRows), cancelledBranches, setCancelledBranches);
  }
  const totals = useMemo(() => {
    const result = {
      cumulativeBase: 0,
      nonCumulativeBase: 0,
      unclassifiedBase: 0,
      cumulativePis: 0,
      cumulativeCofins: 0,
      nonCumulativePis: 0,
      nonCumulativeCofins: 0,
      grossRevenue: 0,
      discounts: 0,
      nfBase: 0,
      totalPis: 0,
      totalCofins: 0,
    };
    filteredRows.forEach((row) => {
      result.grossRevenue += row.grossRevenue;
      result.discounts += row.discounts;
      result.nfBase += row.netRevenue;
      if (row.regime === "Cumulativo") {
        result.cumulativeBase += row.netRevenue;
        result.cumulativePis += row.netRevenue * rates.Cumulativo.pis;
        result.cumulativeCofins += row.netRevenue * rates.Cumulativo.cofins;
        result.totalPis += row.netRevenue * rates.Cumulativo.pis;
        result.totalCofins += row.netRevenue * rates.Cumulativo.cofins;
      } else if (row.regime === "Não-Cumulativo") {
        result.nonCumulativeBase += row.netRevenue;
        result.nonCumulativePis += row.netRevenue * rates["Não-Cumulativo"].pis;
        result.nonCumulativeCofins +=
          row.netRevenue * rates["Não-Cumulativo"].cofins;
        result.totalPis += row.netRevenue * rates["Não-Cumulativo"].pis;
        result.totalCofins += row.netRevenue * rates["Não-Cumulativo"].cofins;
      } else result.unclassifiedBase += row.netRevenue;
    });
    return result;
  }, [filteredRows]);

  const unclassified = filteredRows.filter((row) => !row.regime);
  const otherRevenueTotals = useMemo(() => filteredOtherRevenueRows.reduce((result, row) => {
    result.accountingValue += row.value;
    result.taxBase += row.taxBase;
    result.pis += row.pis;
    result.cofins += row.cofins;
    if (row.classification.includes("Receita financeira")) {
      result.financialBase += row.taxBase;
      result.financialPis += row.pis;
      result.financialCofins += row.cofins;
    } else if (row.classification) {
      result.otherBase += row.taxBase;
      result.otherPis += row.pis;
      result.otherCofins += row.cofins;
    } else result.unclassifiedBase += -row.value;
    return result;
  }, {
    accountingValue: 0,
    taxBase: 0,
    pis: 0,
    cofins: 0,
    financialBase: 0,
    financialPis: 0,
    financialCofins: 0,
    otherBase: 0,
    otherPis: 0,
    otherCofins: 0,
    unclassifiedBase: 0,
  }), [filteredOtherRevenueRows]);

  const annualFeeTotals = useMemo(() => filteredAnnualFeeRows.reduce((result, row) => {
    result.grossRevenue += row.grossRevenue;
    result.discounts += row.discounts;
    result.netRevenue += row.netRevenue;
    const rate = row.regime ? rates[row.regime] : null;
    if (!rate) {
      result.unclassifiedBase += row.netRevenue;
      return result;
    }
    if (row.regime === "Cumulativo") {
      result.cumulativeBase += row.netRevenue;
      result.cumulativePis += row.netRevenue * rate.pis;
      result.cumulativeCofins += row.netRevenue * rate.cofins;
    } else {
      result.nonCumulativeBase += row.netRevenue;
      result.nonCumulativePis += row.netRevenue * rate.pis;
      result.nonCumulativeCofins += row.netRevenue * rate.cofins;
    }
    result.pis += row.netRevenue * rate.pis;
    result.cofins += row.netRevenue * rate.cofins;
    return result;
  }, {
    grossRevenue: 0,
    discounts: 0,
    netRevenue: 0,
    cumulativeBase: 0,
    nonCumulativeBase: 0,
    unclassifiedBase: 0,
    cumulativePis: 0,
    cumulativeCofins: 0,
    nonCumulativePis: 0,
    nonCumulativeCofins: 0,
    pis: 0,
    cofins: 0,
  }), [filteredAnnualFeeRows]);

  const cancelledTotals = useMemo(() => filteredCancelledRows.reduce((result, row) => {
    const rate = row.regime ? rates[row.regime] : null;
    result.gross += row.grossValue;
    result.discounts += row.discountValue;
    result.net += row.netValue;
    if (row.regime === "Cumulativo") result.cumulativeBase += row.netValue;
    else if (row.regime === "Não-Cumulativo") result.nonCumulativeBase += row.netValue;
    else result.unclassifiedBase += row.netValue;
    if (rate) {
      result.pis += row.netValue * rate.pis;
      result.cofins += row.netValue * rate.cofins;
      if (row.regime === "Cumulativo") {
        result.cumulativePis += row.netValue * rate.pis;
        result.cumulativeCofins += row.netValue * rate.cofins;
      } else {
        result.nonCumulativePis += row.netValue * rate.pis;
        result.nonCumulativeCofins += row.netValue * rate.cofins;
      }
    }
    return result;
  }, {
    gross: 0,
    discounts: 0,
    net: 0,
    cumulativeBase: 0,
    nonCumulativeBase: 0,
    unclassifiedBase: 0,
    pis: 0,
    cofins: 0,
    cumulativePis: 0,
    cumulativeCofins: 0,
    nonCumulativePis: 0,
    nonCumulativeCofins: 0,
  }), [filteredCancelledRows]);

  const consolidatedTotals = useMemo(() => ({
    cumulativePis: totals.cumulativePis + annualFeeTotals.cumulativePis - cancelledTotals.cumulativePis,
    cumulativeCofins: totals.cumulativeCofins + annualFeeTotals.cumulativeCofins - cancelledTotals.cumulativeCofins,
    nonCumulativePis: totals.nonCumulativePis + otherRevenueTotals.pis + annualFeeTotals.nonCumulativePis - cancelledTotals.nonCumulativePis,
    nonCumulativeCofins: totals.nonCumulativeCofins + otherRevenueTotals.cofins + annualFeeTotals.nonCumulativeCofins - cancelledTotals.nonCumulativeCofins,
  }), [totals, otherRevenueTotals, annualFeeTotals, cancelledTotals]);

  function exportExcel() {
    const data = filteredRows.map((row) => {
      const rate = row.regime ? rates[row.regime] : null;
      return {
        Coligada: companyCode,
        Filial: row.branch,
        Linha: row.line,
        Competência: competenceLabel,
        Descrição: row.service,
        Classificação: row.regime,
        "Receita bruta": row.grossRevenue,
        "Bolsas/Descontos": row.discounts,
        "Valor líquido (VLRNF)": row.netRevenue,
        "Alíquota PIS": rate?.pis ?? 0,
        PIS: rate ? row.netRevenue * rate.pis : 0,
        "Alíquota COFINS": rate?.cofins ?? 0,
        COFINS: rate ? row.netRevenue * rate.cofins : 0,
      };
    });
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet["!cols"] = [10, 8, 13, 38, 20, 18, 18, 18, 15, 18, 18, 18].map(
      (wch) => ({ wch }),
    );
    XLSX.utils.book_append_sheet(workbook, worksheet, "Apuração PIS COFINS");
    XLSX.writeFile(
      workbook,
      `pis-cofins-coligada-${companyCode}-${competence}.xlsx`,
    );
  }

  async function updateOtherRevenues() {
    setOtherRevenueLoading(true);
    setOtherRevenueError("");
    try {
      const response = await fetch(
        `/api/totvs/pis-cofins/other-revenues?company=${companyCode}&competence=${competence}${branchQuery}`,
        { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao consultar as outras receitas no Razão Completo.");
      const nextRows = payload.rows || []; setOtherRevenueRows(nextRows); setOtherRevenueBranches(requestedBranches.length ? requestedBranches.filter((branch) => branchValues(nextRows).includes(branch)) : branchValues(nextRows));
      setOtherRevenueLoaded(true);
    } catch (cause) {
      setOtherRevenueError((cause as Error).message);
    } finally {
      setOtherRevenueLoading(false);
    }
  }

  async function updateAnnualFeeAllocations() {
    setAnnualFeeLoading(true);
    setAnnualFeeError("");
    try {
      const response = await fetch(
        `/api/totvs/pis-cofins/annual-fee-allocations?company=${companyCode}&competence=${competence}${branchQuery}`,
        { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao consultar os rateios de anuidades no módulo Contábil.");
      const nextRows = payload.rows || []; setAnnualFeeRows(nextRows); setAnnualFeeBranches(requestedBranches.length ? requestedBranches.filter((branch) => branchValues(nextRows).includes(branch)) : branchValues(nextRows));
      setAnnualFeeLoaded(true);
    } catch (cause) {
      setAnnualFeeError((cause as Error).message);
    } finally {
      setAnnualFeeLoading(false);
    }
  }

  async function updateCancelledInvoices() {
    setCancelledLoading(true);
    setCancelledError("");
    try {
      const response = await fetch(
        `/api/totvs/pis-cofins/cancelled-invoices?company=${companyCode}&competence=${competence}${branchQuery}`,
        { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao consultar a Planilha.NET 37.");
      const nextRows = payload.rows || []; setCancelledRows(nextRows); setCancelledBranches(requestedBranches.length ? requestedBranches.filter((branch) => branchValues(nextRows).includes(branch)) : branchValues(nextRows));
      setCancelledLoaded(true);
    } catch (cause) {
      setCancelledError((cause as Error).message);
    } finally {
      setCancelledLoading(false);
    }
  }

  function consolidatedExportRows() {
    return [
      {
        Coligada: companyCode,
        "Competência": competenceLabel,
        Tributo: "PIS cumulativo",
        "Faturamento Mensal": totals.cumulativePis,
        "Outras Receitas": 0,
        "Rateios Anuidades": annualFeeTotals.cumulativePis,
        "Notas Canceladas (dedução)": -cancelledTotals.cumulativePis,
        "Total consolidado": consolidatedTotals.cumulativePis,
      },
      {
        Coligada: companyCode,
        "Competência": competenceLabel,
        Tributo: "COFINS cumulativo",
        "Faturamento Mensal": totals.cumulativeCofins,
        "Outras Receitas": 0,
        "Rateios Anuidades": annualFeeTotals.cumulativeCofins,
        "Notas Canceladas (dedução)": -cancelledTotals.cumulativeCofins,
        "Total consolidado": consolidatedTotals.cumulativeCofins,
      },
      {
        Coligada: companyCode,
        "Competência": competenceLabel,
        Tributo: "PIS não cumulativo",
        "Faturamento Mensal": totals.nonCumulativePis,
        "Outras Receitas": otherRevenueTotals.pis,
        "Rateios Anuidades": annualFeeTotals.nonCumulativePis,
        "Notas Canceladas (dedução)": -cancelledTotals.nonCumulativePis,
        "Total consolidado": consolidatedTotals.nonCumulativePis,
      },
      {
        Coligada: companyCode,
        "Competência": competenceLabel,
        Tributo: "COFINS não cumulativo",
        "Faturamento Mensal": totals.nonCumulativeCofins,
        "Outras Receitas": otherRevenueTotals.cofins,
        "Rateios Anuidades": annualFeeTotals.nonCumulativeCofins,
        "Notas Canceladas (dedução)": -cancelledTotals.nonCumulativeCofins,
        "Total consolidado": consolidatedTotals.nonCumulativeCofins,
      },
    ];
  }

  function consolidatedWorksheet() {
    const worksheet = XLSX.utils.json_to_sheet(consolidatedExportRows());
    worksheet["!cols"] = [12, 14, 25, 20, 20, 22, 28, 20].map((wch) => ({ wch }));
    return worksheet;
  }

  function exportConsolidatedBase() {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, consolidatedWorksheet(), "Base consolidada");
    XLSX.writeFile(workbook, `base-consolidada-pis-cofins-${companyCode}-${competence}.xlsx`);
  }

  function exportCompleteAssessment() {
    const workbook = XLSX.utils.book_new();
    const monthly = filteredRows.map((row) => {
      const rate = row.regime ? rates[row.regime] : null;
      return {
        Filial: row.branch,
        Coligada: companyCode,
        Competência: competenceLabel,
        Descrição: row.service,
        Classificação: row.regime,
        "Valor bruto": row.grossRevenue,
        Descontos: row.discounts,
        "Base final (VALORNF)": row.netRevenue,
        PIS: rate ? row.netRevenue * rate.pis : 0,
        COFINS: rate ? row.netRevenue * rate.cofins : 0,
      };
    });
    const otherRevenues = filteredOtherRevenueRows.map((row) => ({
      Coligada: row.company,
      Filial: row.branch,
      Competência: competenceLabel,
      Data: row.date,
      "Cód. reduzido": row.reduced,
      Conta: row.account,
      Descrição: row.description,
      Agrupamento: row.group,
      Classificação: row.classification,
      "ID lançamento": row.entryId,
      Documento: row.document,
      Sistema: row.sourceSystem,
      Complemento: row.complement,
      "Centro de custo": row.costCenter,
      Valor: row.value,
      "Base tributável": row.taxBase,
      "Alíquota PIS": row.pisRate,
      PIS: row.pis,
      "Alíquota COFINS": row.cofinsRate,
      COFINS: row.cofins,
    }));
    const annualFeeAllocations = filteredAnnualFeeRows.map((row) => {
      const rate = row.regime ? rates[row.regime] : null;
      return {
        Coligada: row.company,
        Filial: row.branch,
        Competência: competenceLabel,
        Data: row.date,
        "Cód. reduzido": row.reduced,
        Conta: row.account,
        Descrição: row.service,
        Classificação: row.regime,
        "ID lançamento": row.entryId,
        Documento: row.document,
        Sistema: row.sourceSystem,
        Complemento: row.complement,
        "Centro de custo": row.costCenter,
        "Valor bruto": row.grossRevenue,
        Descontos: row.discounts,
        "Base tributável": row.netRevenue,
        "Alíquota PIS": rate?.pis ?? 0,
        PIS: rate ? row.netRevenue * rate.pis : 0,
        "Alíquota COFINS": rate?.cofins ?? 0,
        COFINS: rate ? row.netRevenue * rate.cofins : 0,
      };
    });
    const cancelled = filteredCancelledRows.map((row) => ({
      Coligada: row.company,
      Filial: row.branch,
      "Competência da apuração": competenceLabel,
      "Competência de origem": row.sourceCompetence,
      "Data do cancelamento": row.cancellationDate,
      "Data de emissão": row.issueDate,
      "NF-e municipal": row.invoice,
      RPS: row.rps,
      RA: row.studentCode,
      Aluno: row.student,
      Cliente: row.customer,
      Serviço: row.service,
      Classificação: row.regime,
      "ID movimento": row.movementId,
      "ID lançamento": row.entryId,
      "Valor bruto": row.grossValue,
      Descontos: row.discountValue,
      "Valor líquido excluído": row.netValue,
      Histórico: row.history,
      Tratamento: row.treatment,
    }));
    XLSX.utils.book_append_sheet(workbook, consolidatedWorksheet(), "Base consolidada");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(monthly), "Faturamento Mensal");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(otherRevenues), "Outras Receitas");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(annualFeeAllocations), "Rateios Anuidades");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cancelled), "Notas Canceladas");
    XLSX.writeFile(workbook, `apuracao-completa-pis-cofins-${companyCode}-${competence}.xlsx`);
  }

  function exportEntriesCsv() {
    type BranchTotals = {
      cumulativePis: number;
      cumulativeCofins: number;
      nonCumulativePis: number;
      nonCumulativeCofins: number;
    };
    const byBranch = new Map<string, BranchTotals>();
    const branchTotals = (branch?: string) => {
      const key = String(branch || companyCode).trim() || companyCode;
      if (!byBranch.has(key)) byBranch.set(key, {
        cumulativePis: 0,
        cumulativeCofins: 0,
        nonCumulativePis: 0,
        nonCumulativeCofins: 0,
      });
      return byBranch.get(key)!;
    };

    filteredRows.forEach((row) => {
      const target = branchTotals(row.branch);
      if (row.regime === "Cumulativo") {
        target.cumulativePis += row.netRevenue * rates.Cumulativo.pis;
        target.cumulativeCofins += row.netRevenue * rates.Cumulativo.cofins;
      } else if (row.regime === "Não-Cumulativo") {
        target.nonCumulativePis += row.netRevenue * rates["Não-Cumulativo"].pis;
        target.nonCumulativeCofins += row.netRevenue * rates["Não-Cumulativo"].cofins;
      }
    });
    filteredOtherRevenueRows.forEach((row) => {
      const target = branchTotals(row.branch);
      if (row.classification) {
        target.nonCumulativePis += row.pis;
        target.nonCumulativeCofins += row.cofins;
      }
    });
    filteredAnnualFeeRows.forEach((row) => {
      const target = branchTotals(row.branch);
      const rate = row.regime ? rates[row.regime] : null;
      if (!rate) return;
      if (row.regime === "Cumulativo") {
        target.cumulativePis += row.netRevenue * rate.pis;
        target.cumulativeCofins += row.netRevenue * rate.cofins;
      } else {
        target.nonCumulativePis += row.netRevenue * rate.pis;
        target.nonCumulativeCofins += row.netRevenue * rate.cofins;
      }
    });
    filteredCancelledRows.forEach((row) => {
      const target = branchTotals(row.branch);
      const rate = row.regime ? rates[row.regime] : null;
      if (!rate) return;
      if (row.regime === "Cumulativo") {
        target.cumulativePis -= row.netValue * rate.pis;
        target.cumulativeCofins -= row.netValue * rate.cofins;
      } else {
        target.nonCumulativePis -= row.netValue * rate.pis;
        target.nonCumulativeCofins -= row.netValue * rate.cofins;
      }
    });

    const [year, month] = competence.split("-").map(Number);
    const postingDay = Math.min(30, new Date(year, month, 0).getDate());
    const postingDate = `${String(postingDay).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
    const formatAmount = (value: number) => new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    }).format(Math.abs(value));
    const csvRows: string[][] = [["M", "99", "IMPORTAÇÃO DE LANÇAMENTOS", postingDate, "", "", "", "", ""]];
    const postingTypes = [
      { key: "cumulativePis" as const, debit: "3.1.3.01.01.03", credit: "2.1.4.01.01.03", history: "PIS CUMULATIVO - COD 8109 - N/MÊS" },
      { key: "cumulativeCofins" as const, debit: "3.1.3.01.01.03", credit: "2.1.4.01.01.03", history: "COFINS CUMULATIVO - COD 2172 - N/MÊS" },
      { key: "nonCumulativePis" as const, debit: "3.1.3.01.01.02", credit: "2.1.4.01.01.02", history: "PIS NÃO CUMULATIVO - COD 6912 - N/MÊS" },
      { key: "nonCumulativeCofins" as const, debit: "3.1.3.01.01.03", credit: "2.1.4.01.01.03", history: "COFINS NÃO CUMULATIVO - COD 5856 - N/MÊS" },
    ];
    [...byBranch.entries()]
      .sort(([left], [right]) => Number(left) - Number(right))
      .forEach(([branch, values]) => postingTypes.forEach((posting) => {
        const value = values[posting.key];
        if (Math.abs(value) < 0.005) return;
        csvRows.push(["*P", "PIS E COFINS", posting.debit, posting.credit, "", formatAmount(value), "71", posting.history, branch]);
      }));

    const csv = `${csvRows.map((fields) => fields.join(";")).join("\r\n")}\r\n`;
    const windows1252 = Uint8Array.from(Array.from(csv), (character) => {
      const code = character.charCodeAt(0);
      return code <= 255 ? code : 63;
    });
    const url = URL.createObjectURL(new Blob([windows1252], { type: "text/csv;charset=windows-1252" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `coligada${companyCode.padStart(2, "0")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      className={`panel tax-panel ${loading || otherRevenueLoading || annualFeeLoading || cancelledLoading ? "is-processing" : ""}`}
    >
      {(loading || otherRevenueLoading || annualFeeLoading || cancelledLoading) && (
        <div className="tax-processing">
          <div className="spinner" />
          <b>
            {cancelledLoading
              ? "Atualizando as notas canceladas..."
              : annualFeeLoading
              ? "Atualizando os rateios de anuidades..."
              : otherRevenueLoading
              ? "Atualizando as outras receitas..."
              : loading
              ? "Atualizando a base faturamento..."
              : "Classificando e calculando PIS e COFINS..."}
          </b>
          <span>Aguarde até o processamento ser concluído.</span>
        </div>
      )}
      {actionsTarget &&
        createPortal(
          <div className="tax-actions">
            <details className="tax-top-branches">
              <summary>Filiais {requestedBranches.length ? `(${requestedBranches.join(", ")})` : "(todas)"}</summary>
              <div>
                <div className="tax-branch-entry">
                  <input value={branchDraft} onChange={(event) => setBranchDraft(event.target.value)} placeholder="Ex.: 1, 2, 6" aria-label="Filiais" />
                  <button type="button" onClick={applyBranchFilter}>Aplicar</button>
                  <button type="button" onClick={selectAllBranches}>Todas</button>
                </div>
                {selectableBranches.map((branch) => <label key={branch}>
                  <input type="checkbox" checked={requestedBranches.length ? requestedBranches.includes(branch) : branchSelectedEverywhere(branch)} onChange={(event) => toggleGlobalBranch(branch, event.target.checked)} />
                  Filial {branch}
                </label>)}
                {!selectableBranches.length && <span>Informe uma ou mais filiais antes de atualizar as bases.</span>}
              </div>
            </details>
            <button
              className="tax-export"
              disabled={!completeAssessmentReady}
              onClick={exportCompleteAssessment}
              title={completeAssessmentReady ? "Extrair as quatro bases da apuração" : "Atualize e processe as quatro etapas da apuração"}
            >
              <Download /> Apuração completa
            </button>
            <button className="tax-future-action" disabled={!completeAssessmentReady} onClick={exportEntriesCsv} title={completeAssessmentReady ? "Gerar CSV para importação dos lançamentos" : "Atualize e processe as quatro etapas antes de gerar os lançamentos"}>
              <ReceiptText /> Lançamentos
            </button>
            <button className="tax-clear-action" disabled={!hasAssessment} onClick={clearAssessment} title="Apagar a apuração salva desta empresa e competência">
              <Trash2 /> Limpar
            </button>
          </div>,
          actionsTarget,
        )}
      <div className="tax-consolidated-summary">
        <div className="tax-consolidated-title">
          <b>Apuração consolidada</b>
          <span>Soma do Faturamento Mensal, Outras Receitas e Rateios Anuidades, com dedução das Notas Canceladas</span>
        </div>
        <article><span>PIS cumulativo</span><b>{brl.format(consolidatedTotals.cumulativePis)}</b><small>Faturamento + outras receitas + rateios − canceladas</small></article>
        <article><span>COFINS cumulativo</span><b>{brl.format(consolidatedTotals.cumulativeCofins)}</b><small>Faturamento + outras receitas + rateios − canceladas</small></article>
        <article><span>PIS não cumulativo</span><b>{brl.format(consolidatedTotals.nonCumulativePis)}</b><small>Faturamento + outras receitas + rateios − canceladas</small></article>
        <article><span>COFINS não cumulativo</span><b>{brl.format(consolidatedTotals.nonCumulativeCofins)}</b><small>Faturamento + outras receitas + rateios − canceladas</small></article>
      </div>
      <div className="tax-section-heading">
        <div><b>Faturamento Mensal</b><span>Planilha.NET 53 · ANÁLISE NF COM CONTA</span></div>
        <button
          className={loaded ? "tax-secondary-update is-ready" : "tax-secondary-update"}
          disabled={loading || !companyCode}
          onClick={() => void update()}
        >
          <RefreshCw className={loading ? "spin" : ""} />
          {loading ? "Atualizando..." : "Atualizar faturamento"}
        </button>
        <button className="tax-visibility-toggle" onClick={() => setMonthlyVisible((visible) => !visible)}>
          {monthlyVisible ? <ChevronUp /> : <ChevronDown />}
          {monthlyVisible ? "Ocultar" : "Exibir"}
        </button>
      </div>
      <div hidden={!monthlyVisible}>
      <BranchSelector branches={branchValues(rows)} selected={monthlyBranches} onChange={setMonthlyBranches} />
      {error && <div className="notice error">{error}</div>}
      <div className="tax-summary">
        <article>
          <span>Valor bruto</span>
          <b>{loaded ? brl.format(totals.grossRevenue) : "Aguardando"}</b>
          <small>Soma de VALORORIGINAL</small>
        </article>
        <article>
          <span>Descontos</span>
          <b>{loaded ? brl.format(totals.discounts) : "Aguardando"}</b>
          <small>Soma de BOLSA</small>
        </article>
        <article>
          <span>Valor líquido</span>
          <b>{loaded ? brl.format(totals.nfBase) : "Aguardando"}</b>
          <small>Soma de VLRNF</small>
        </article>
        <article>
          <span>PIS cumulativo</span>
          <b>{classified ? brl.format(totals.cumulativePis) : "—"}</b>
          <small>0,65% da base cumulativa</small>
        </article>
        <article>
          <span>COFINS cumulativo</span>
          <b>{classified ? brl.format(totals.cumulativeCofins) : "—"}</b>
          <small>3% da base cumulativa</small>
        </article>
        <article>
          <span>PIS não cumulativo</span>
          <b>{classified ? brl.format(totals.nonCumulativePis) : "—"}</b>
          <small>1,65% da base não cumulativa</small>
        </article>
        <article>
          <span>COFINS não cumulativo</span>
          <b>{classified ? brl.format(totals.nonCumulativeCofins) : "—"}</b>
          <small>7,6% da base não cumulativa</small>
        </article>
      </div>
      {!loaded ? (
        <div className="tax-empty">
          <Calculator />
          <b>Atualize a Planilha.NET 53</b>
          <span>
            Cada linha será classificada pelo campo DESCRIÇÃO e pela
            competência.
          </span>
        </div>
      ) : !classified ? (
        <div className="tax-empty">
          <Calculator />
          <b>Base faturamento atualizada</b>
          <span>
            Clique em Classificar para aplicar a matriz cumulativa e não
            cumulativa.
          </span>
        </div>
      ) : (
        <>
          <div className="tax-view-heading">
            <div>
              <b>Visão da classificação no sistema</b>
              <span>
                {rows.length} descrição(ões) na competência {competenceLabel}
              </span>
            </div>
            <span>
              {ignoredCancelled} registro(s) cancelado(s) desconsiderado(s)
            </span>
            <div className="tax-detail-actions">
              <button
                className="tax-detail-toggle"
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {detailsOpen ? <ChevronUp /> : <ChevronDown />}
                {detailsOpen ? "Ocultar detalhamento" : "Abrir detalhamento"}
              </button>
              <button className="tax-detail-export" onClick={exportExcel}>
                <Download /> Exportar Excel
              </button>
            </div>
          </div>
          {unclassified.length > 0 && (
            <div className="tax-warning">
              <TriangleAlert />
              <div>
                <b>{unclassified.length} descrição(ões) sem classificação</b>
                <span>
                  A classificação permanece em branco e esses valores não entram
                  no cálculo de PIS ou COFINS.
                </span>
              </div>
            </div>
          )}
          {detailsOpen && <div className="table-wrap tax-table">
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Filial</th>
                  <th>Competência</th>
                  <th>Descrição</th>
                  <th>Classificação</th>
                  <th>Valor bruto</th>
                  <th>Desconto</th>
                  <th>Valor líquido (VLRNF)</th>
                  <th>PIS</th>
                  <th>COFINS</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const rate = row.regime ? rates[row.regime] : null;
                  return (
                    <tr key={row.line}>
                      <td>{row.line}</td>
                      <td>{row.branch}</td>
                      <td>{competenceLabel}</td>
                      <td>
                        <b>{row.service}</b>
                      </td>
                      <td>
                        {row.regime ? (
                          <span className="tax-badge">{row.regime}</span>
                        ) : (
                          ""
                        )}
                      </td>
                      <td>{brl.format(row.grossRevenue)}</td>
                      <td>{brl.format(row.discounts)}</td>
                      <td>
                        <b>{brl.format(row.netRevenue)}</b>
                      </td>
                      <td>
                        {rate ? brl.format(row.netRevenue * rate.pis) : ""}
                      </td>
                      <td>
                        {rate ? brl.format(row.netRevenue * rate.cofins) : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Subtotal da competência</td>
                  <td>{brl.format(totals.grossRevenue)}</td>
                  <td>{brl.format(totals.discounts)}</td>
                  <td>{brl.format(totals.nfBase)}</td>
                  <td>{brl.format(totals.totalPis)}</td>
                  <td>{brl.format(totals.totalCofins)}</td>
                </tr>
              </tfoot>
            </table>
          </div>}
        </>
      )}
      <p className="tax-note">
        Cálculo realizado exclusivamente sobre o campo VLRNF de cada linha da
        competência selecionada, antes de créditos, retenções e demais ajustes
        fiscais.
      </p>
      </div>
      <section className={`tax-secondary-section ${otherRevenueVisible ? "" : "is-collapsed"}`}>
        <div className="tax-section-heading">
          <div><b>Outras Receitas</b><span>Razão Completo · contas definidas na aba Base contas</span></div>
          <button
            className={otherRevenueLoaded ? "tax-secondary-update is-ready" : "tax-secondary-update"}
            disabled={otherRevenueLoading || !companyCode}
            onClick={() => void updateOtherRevenues()}
          >
            <RefreshCw className={otherRevenueLoading ? "spin" : ""} />
            {otherRevenueLoading ? "Atualizando..." : "Atualizar outras receitas"}
          </button>
          <button className="tax-visibility-toggle" onClick={() => setOtherRevenueVisible((visible) => !visible)}>
            {otherRevenueVisible ? <ChevronUp /> : <ChevronDown />}
            {otherRevenueVisible ? "Ocultar" : "Exibir"}
          </button>
        </div>
        <BranchSelector branches={branchValues(otherRevenueRows)} selected={otherRevenueBranches} onChange={setOtherRevenueBranches} />
        {otherRevenueError && <div className="notice error">{otherRevenueError}</div>}
        {!otherRevenueLoaded ? (
          <div className="tax-source-empty"><Calculator /><span>Atualize para carregar todos os movimentos das contas configuradas na competência selecionada.</span></div>
        ) : otherRevenueRows.length === 0 ? (
          <div className="tax-source-empty"><Calculator /><b>Sem movimento na competência</b><span>Nenhuma das contas da aba Base contas apresentou movimentação.</span></div>
        ) : (
          <>
            <div className="tax-other-summary">
              <article><span>Contas com movimento</span><b>{new Set(filteredOtherRevenueRows.map((row) => row.account)).size}</b></article>
              <article><span>Base financeira</span><b>{brl.format(otherRevenueTotals.financialBase)}</b><small>PIS 0,65% · COFINS 4,00%</small></article>
              <article><span>Base demais receitas</span><b>{brl.format(otherRevenueTotals.otherBase)}</b><small>PIS 1,65% · COFINS 7,60%</small></article>
              <article><span>PIS apurado</span><b>{brl.format(otherRevenueTotals.pis)}</b><small>{brl.format(otherRevenueTotals.financialPis)} + {brl.format(otherRevenueTotals.otherPis)}</small></article>
              <article><span>COFINS apurada</span><b>{brl.format(otherRevenueTotals.cofins)}</b><small>{brl.format(otherRevenueTotals.financialCofins)} + {brl.format(otherRevenueTotals.otherCofins)}</small></article>
              <article className={Math.abs(otherRevenueTotals.unclassifiedBase) > 0.004 ? "has-warning" : ""}><span>Sem classificação</span><b>{brl.format(otherRevenueTotals.unclassifiedBase)}</b><small>Sem cálculo automático</small></article>
            </div>
            <div className="table-wrap tax-other-table">
              <table>
                <thead><tr><th>Data</th><th>Filial</th><th>Cód. reduzido</th><th>Conta</th><th>Descrição</th><th>Agrupamento</th><th>Classificação</th><th>Base tributável</th><th>Alíquota PIS</th><th>PIS</th><th>Alíquota COFINS</th><th>COFINS</th><th>ID lançamento</th><th>Complemento</th></tr></thead>
                <tbody>{filteredOtherRevenueRows.map((row, index) => <tr key={`${row.entryId}-${row.account}-${index}`}><td>{row.date.slice(0, 10).split("-").reverse().join("/")}</td><td>{row.branch}</td><td>{row.reduced}</td><td>{row.account}</td><td>{row.description}</td><td>{row.group || ""}</td><td>{row.classification ? <span className="tax-badge">{row.classification}</span> : ""}</td><td>{row.classification ? brl.format(row.taxBase) : ""}</td><td>{row.classification ? `${(row.pisRate * 100).toFixed(2).replace(".", ",")}%` : ""}</td><td>{row.classification ? brl.format(row.pis) : ""}</td><td>{row.classification ? `${(row.cofinsRate * 100).toFixed(2).replace(".", ",")}%` : ""}</td><td>{row.classification ? brl.format(row.cofins) : ""}</td><td>{row.entryId}</td><td>{row.complement}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan={7}>Subtotal da competência</td><td>{brl.format(otherRevenueTotals.taxBase)}</td><td></td><td>{brl.format(otherRevenueTotals.pis)}</td><td></td><td>{brl.format(otherRevenueTotals.cofins)}</td><td colSpan={2}></td></tr></tfoot>
              </table>
            </div>
          </>
        )}
      </section>
      <section className={`tax-secondary-section ${annualFeeVisible ? "" : "is-collapsed"}`}>
        <div className="tax-section-heading">
          <div><b>Rateios Anuidades</b><span>RM Contábil · lançamentos RAT-* gerados no RM Saldus</span></div>
          <button
            className={annualFeeLoaded ? "tax-secondary-update is-ready" : "tax-secondary-update"}
            disabled={annualFeeLoading || !companyCode}
            onClick={() => void updateAnnualFeeAllocations()}
          >
            <RefreshCw className={annualFeeLoading ? "spin" : ""} />
            {annualFeeLoading ? "Atualizando..." : "Atualizar rateios"}
          </button>
          <button className="tax-visibility-toggle" onClick={() => setAnnualFeeVisible((visible) => !visible)}>
            {annualFeeVisible ? <ChevronUp /> : <ChevronDown />}
            {annualFeeVisible ? "Ocultar" : "Exibir"}
          </button>
        </div>
        <BranchSelector branches={branchValues(annualFeeRows)} selected={annualFeeBranches} onChange={setAnnualFeeBranches} />
        {annualFeeError && <div className="notice error">{annualFeeError}</div>}
        {!annualFeeLoaded ? (
          <div className="tax-source-empty"><Calculator /><span>Atualize para localizar os lançamentos contábeis de rateio de anuidades da competência.</span></div>
        ) : annualFeeRows.length === 0 ? (
          <div className="tax-source-empty"><Calculator /><b>Sem rateios na competência</b><span>Nenhum lançamento RAT-* de anuidades foi encontrado no módulo Contábil.</span></div>
        ) : (
          <>
            <div className="tax-other-summary">
              <article><span>Lançamentos</span><b>{annualFeeRows.length}</b><small>RM Saldus · RAT-*</small></article>
              <article><span>Valor bruto</span><b>{brl.format(annualFeeTotals.grossRevenue)}</b></article>
              <article><span>Descontos</span><b>{brl.format(annualFeeTotals.discounts)}</b></article>
              <article><span>Base tributável</span><b>{brl.format(annualFeeTotals.netRevenue)}</b></article>
              <article><span>PIS apurado</span><b>{brl.format(annualFeeTotals.pis)}</b><small>Conforme classificação</small></article>
              <article><span>COFINS apurada</span><b>{brl.format(annualFeeTotals.cofins)}</b><small>Conforme classificação</small></article>
              <article className={Math.abs(annualFeeTotals.unclassifiedBase) > 0.004 ? "has-warning" : ""}><span>Sem classificação</span><b>{brl.format(annualFeeTotals.unclassifiedBase)}</b><small>Sem cálculo automático</small></article>
            </div>
            <div className="table-wrap tax-other-table">
              <table>
                <thead><tr><th>Data</th><th>Filial</th><th>Cód. reduzido</th><th>Conta</th><th>Descrição</th><th>Classificação</th><th>Valor bruto</th><th>Desconto</th><th>Base tributável</th><th>Alíquota PIS</th><th>PIS</th><th>Alíquota COFINS</th><th>COFINS</th><th>ID lançamento</th><th>Documento</th><th>Complemento</th></tr></thead>
                <tbody>{filteredAnnualFeeRows.map((row) => {
                  const rate = row.regime ? rates[row.regime] : null;
                  return <tr key={`${row.entryId}-${row.account}`}><td>{row.date.slice(0, 10).split("-").reverse().join("/")}</td><td>{row.branch}</td><td>{row.reduced}</td><td>{row.account}</td><td>{row.service}</td><td>{row.regime ? <span className="tax-badge">{row.regime}</span> : ""}</td><td>{brl.format(row.grossRevenue)}</td><td>{brl.format(row.discounts)}</td><td>{brl.format(row.netRevenue)}</td><td>{rate ? `${(rate.pis * 100).toFixed(2).replace(".", ",")}%` : ""}</td><td>{rate ? brl.format(row.netRevenue * rate.pis) : ""}</td><td>{rate ? `${(rate.cofins * 100).toFixed(2).replace(".", ",")}%` : ""}</td><td>{rate ? brl.format(row.netRevenue * rate.cofins) : ""}</td><td>{row.entryId}</td><td>{row.document}</td><td>{row.complement}</td></tr>;
                })}</tbody>
                <tfoot><tr><td colSpan={6}>Subtotal da competência</td><td>{brl.format(annualFeeTotals.grossRevenue)}</td><td>{brl.format(annualFeeTotals.discounts)}</td><td>{brl.format(annualFeeTotals.netRevenue)}</td><td></td><td>{brl.format(annualFeeTotals.pis)}</td><td></td><td>{brl.format(annualFeeTotals.cofins)}</td><td colSpan={3}></td></tr></tfoot>
              </table>
            </div>
          </>
        )}
      </section>
      <section className={`tax-secondary-section ${cancelledVisible ? "" : "is-collapsed"}`}>
        <div className="tax-section-heading">
          <div><b>Notas Canceladas</b><span>Planilha.NET 37 · NF MUNICIPAIS CANCELADAS</span></div>
          <button
            className={cancelledLoaded ? "tax-secondary-update is-ready" : "tax-secondary-update"}
            disabled={cancelledLoading || !companyCode}
            onClick={() => void updateCancelledInvoices()}
          >
            <RefreshCw className={cancelledLoading ? "spin" : ""} />
            {cancelledLoading ? "Atualizando..." : "Atualizar notas canceladas"}
          </button>
          <button className="tax-visibility-toggle" onClick={() => setCancelledVisible((visible) => !visible)}>
            {cancelledVisible ? <ChevronUp /> : <ChevronDown />}
            {cancelledVisible ? "Ocultar" : "Exibir"}
          </button>
        </div>
        <BranchSelector branches={branchValues(cancelledRows)} selected={cancelledBranches} onChange={setCancelledBranches} />
        {cancelledError && <div className="notice error">{cancelledError}</div>}
        {!cancelledLoaded ? (
          <div className="tax-source-empty"><Calculator /><span>Atualize para consultar os cancelamentos registrados na competência selecionada.</span></div>
        ) : cancelledRows.length ? (
          <>
            <div className="tax-other-summary">
              <article><span>Notas canceladas</span><b>{cancelledRows.length}</b><small>Excluídas da apuração</small></article>
              <article><span>Valor bruto</span><b>{brl.format(cancelledTotals.gross)}</b></article>
              <article><span>Descontos</span><b>{brl.format(cancelledTotals.discounts)}</b></article>
              <article><span>Valor líquido excluído</span><b>{brl.format(cancelledTotals.net)}</b></article>
              <article><span>Base cumulativa cancelada</span><b>{brl.format(cancelledTotals.cumulativeBase)}</b><small>Sem efeito na apuração</small></article>
              <article><span>Base não cumulativa cancelada</span><b>{brl.format(cancelledTotals.nonCumulativeBase)}</b><small>Sem efeito na apuração</small></article>
              <article><span>PIS excluído</span><b>{brl.format(cancelledTotals.pis)}</b><small>Conforme classificação</small></article>
              <article><span>COFINS excluída</span><b>{brl.format(cancelledTotals.cofins)}</b><small>Conforme classificação</small></article>
              <article className={cancelledRows.some((row) => !row.regime) ? "has-warning" : ""}><span>Sem classificação</span><b>{cancelledRows.filter((row) => !row.regime).length}</b><small>Requer análise</small></article>
            </div>
            <div className="table-wrap tax-cancelled-table"><table>
              <thead><tr><th>Cancelamento</th><th>Competência de origem</th><th>Filial</th><th>NF-e</th><th>RPS</th><th>Aluno</th><th>Serviço</th><th>Classificação</th><th>Valor bruto</th><th>Desconto</th><th>Valor líquido excluído</th><th>Alíquota PIS</th><th>PIS excluído</th><th>Alíquota COFINS</th><th>COFINS excluída</th></tr></thead>
              <tbody>{filteredCancelledRows.map((row) => {
                const rate = row.regime ? rates[row.regime] : null;
                return <tr key={`${row.movementId}-${row.entryId}-${row.invoice}`}><td>{row.cancellationDate.slice(0, 10).split("-").reverse().join("/")}</td><td>{row.sourceCompetence.slice(0, 7).split("-").reverse().join("/")}</td><td>{row.branch}</td><td>{row.invoice}</td><td>{row.rps}</td><td>{row.student}</td><td>{row.service}</td><td>{row.regime ? <span className="tax-badge">{row.regime}</span> : ""}</td><td>{brl.format(row.grossValue)}</td><td>{brl.format(row.discountValue)}</td><td>{brl.format(row.netValue)}</td><td>{rate ? `${(rate.pis * 100).toFixed(2).replace(".", ",")}%` : ""}</td><td>{rate ? brl.format(row.netValue * rate.pis) : ""}</td><td>{rate ? `${(rate.cofins * 100).toFixed(2).replace(".", ",")}%` : ""}</td><td>{rate ? brl.format(row.netValue * rate.cofins) : ""}</td></tr>;
              })}</tbody>
              <tfoot><tr><td colSpan={8}>Subtotal da competência</td><td>{brl.format(cancelledTotals.gross)}</td><td>{brl.format(cancelledTotals.discounts)}</td><td>{brl.format(cancelledTotals.net)}</td><td></td><td>{brl.format(cancelledTotals.pis)}</td><td></td><td>{brl.format(cancelledTotals.cofins)}</td></tr></tfoot>
            </table></div>
          </>
        ) : <div className="tax-source-empty"><Calculator /><b>Sem cancelamentos na competência</b><span>A consulta 37 não retornou notas municipais canceladas no período.</span></div>}
      </section>
    </section>
  );
}
