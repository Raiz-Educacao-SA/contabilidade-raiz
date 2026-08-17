"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Calculator, ChevronDown, ChevronUp, Download, ReceiptText, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import * as XLSX from "xlsx";

const subscribeToDocument = () => () => {};
const getActionsTarget = () => document.getElementById("pis-cofins-filter-actions");
const getServerActionsTarget = () => null;

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
type EnergyCreditRow = {
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
  value: number;
  user: string;
  complement: string;
  costCenter: string;
  ticket: null | { id: string; status: string; link: string; name: string; matchScore: number; documents: { name: string; url: string }[] };
};
type LeaseCreditRow = Omit<EnergyCreditRow, "ticket">;

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

export default function PisCofinsAssessment({
  companyCode,
  companyName,
  taxRegime,
  competence,
  accessToken,
}: {
  companyCode: string;
  companyName: string;
  taxRegime: string;
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
  const [creditsVisible, setCreditsVisible] = useState(true);
  const [creditsCategory, setCreditsCategory] = useState<"energy" | "leases">("energy");
  const [energyRows, setEnergyRows] = useState<EnergyCreditRow[]>([]);
  const [energyLoading, setEnergyLoading] = useState(false);
  const [energyLoaded, setEnergyLoaded] = useState(false);
  const [energyError, setEnergyError] = useState("");
  const [leaseRows, setLeaseRows] = useState<LeaseCreditRow[]>([]);
  const [leaseLoading, setLeaseLoading] = useState(false);
  const [leaseLoaded, setLeaseLoaded] = useState(false);
  const [leaseError, setLeaseError] = useState("");
  const [zeevMessage, setZeevMessage] = useState("");
  const [monthlyBranches, setMonthlyBranches] = useState<string[]>([]);
  const [otherRevenueBranches, setOtherRevenueBranches] = useState<string[]>([]);
  const [annualFeeBranches, setAnnualFeeBranches] = useState<string[]>([]);
  const [cancelledBranches, setCancelledBranches] = useState<string[]>([]);
  const [requestedBranches, setRequestedBranches] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [restoredStorageKey, setRestoredStorageKey] = useState("");
  const [error, setError] = useState("");
  const actionsTarget = useSyncExternalStore(
    subscribeToDocument,
    getActionsTarget,
    getServerActionsTarget,
  );
  const competenceLabel = competence.split("-").reverse().join("/");
  const completeAssessmentReady = classified && otherRevenueLoaded && annualFeeLoaded && cancelledLoaded;
  const hasAssessment = loaded || otherRevenueLoaded || annualFeeLoaded || cancelledLoaded || energyLoaded;
  const storageKey = `pis-cofins-assessment:${companyCode}:${competence}`;
  const branchQuery = requestedBranches.length
    ? `&branches=${encodeURIComponent(requestedBranches.join(","))}`
    : "";

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setStorageReady(false);
      setOtherRevenueError("");
      setAnnualFeeError("");
      setCancelledError("");
      setEnergyError("");
      setZeevMessage("");
      setError("");
      try {
        const saved = window.localStorage.getItem(storageKey);
        const assessment = saved ? JSON.parse(saved) : null;
        const restoredRows = Array.isArray(assessment?.rows) ? assessment.rows : [];
        const restoredCancelledRows = Array.isArray(assessment?.cancelledRows) ? assessment.cancelledRows : [];
        const restoredOtherRevenueRows = Array.isArray(assessment?.otherRevenueRows) ? assessment.otherRevenueRows : [];
        const restoredAnnualFeeRows = Array.isArray(assessment?.annualFeeRows) ? assessment.annualFeeRows : [];
        const restoredEnergyRows = Array.isArray(assessment?.energyRows) ? assessment.energyRows : [];
        const restoredLeaseRows = Array.isArray(assessment?.leaseRows) ? assessment.leaseRows : [];
        setRows(restoredRows);
        setCancelledRows(restoredCancelledRows);
        setLoaded(Boolean(assessment?.loaded && restoredRows.length));
        setClassified(Boolean(assessment?.loaded && restoredRows.length));
        setIgnoredCancelled(Number(assessment?.ignoredCancelled || 0));
        setOtherRevenueRows(restoredOtherRevenueRows);
        setOtherRevenueLoaded(Boolean(assessment?.otherRevenueLoaded && restoredOtherRevenueRows.length));
        setAnnualFeeRows(restoredAnnualFeeRows);
        setAnnualFeeLoaded(Boolean(assessment?.annualFeeLoaded && restoredAnnualFeeRows.length));
        setCancelledLoaded(Boolean(assessment?.cancelledLoaded && restoredCancelledRows.length));
        setDetailsOpen(Boolean(assessment?.detailsOpen));
        setMonthlyVisible(assessment?.monthlyVisible ?? true);
        setOtherRevenueVisible(assessment?.otherRevenueVisible ?? true);
        setAnnualFeeVisible(assessment?.annualFeeVisible ?? true);
        setCancelledVisible(assessment?.cancelledVisible ?? true);
        setCreditsVisible(assessment?.creditsVisible ?? true);
        setCreditsCategory(assessment?.creditsCategory === "leases" ? "leases" : "energy");
        setEnergyRows(restoredEnergyRows);
        setEnergyLoaded(Boolean(assessment?.energyLoaded && restoredEnergyRows.length));
        setLeaseRows(restoredLeaseRows);
        setLeaseLoaded(Boolean(assessment?.leaseLoaded && restoredLeaseRows.length));
        setZeevMessage(String(assessment?.zeevMessage || ""));
        setMonthlyBranches(restoredBranches(assessment?.monthlyBranches, restoredRows));
        setOtherRevenueBranches(restoredBranches(assessment?.otherRevenueBranches, restoredOtherRevenueRows));
        setAnnualFeeBranches(restoredBranches(assessment?.annualFeeBranches, restoredAnnualFeeRows));
        setCancelledBranches(restoredBranches(assessment?.cancelledBranches, restoredCancelledRows));
        setRequestedBranches([]);
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
        setEnergyRows([]);
        setEnergyLoaded(false);
        setLeaseRows([]);
        setLeaseLoaded(false);
        setZeevMessage("");
        setMonthlyBranches([]); setOtherRevenueBranches([]); setAnnualFeeBranches([]); setCancelledBranches([]);
        setRequestedBranches([]);
      } finally {
        setRestoredStorageKey(storageKey);
        setStorageReady(true);
      }
    });
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    if (!storageReady || restoredStorageKey !== storageKey) return;
    try {
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
        creditsVisible,
        creditsCategory,
        energyRows,
        energyLoaded,
        leaseRows,
        leaseLoaded,
        zeevMessage,
        monthlyBranches, otherRevenueBranches, annualFeeBranches, cancelledBranches,
        requestedBranches,
      }));
    } catch {
      try {
        window.localStorage.removeItem(storageKey);
        window.localStorage.setItem(storageKey, JSON.stringify({
          loaded: false,
          classified: false,
          ignoredCancelled,
          otherRevenueLoaded: false,
          annualFeeLoaded: false,
          cancelledLoaded: false,
          detailsOpen,
          monthlyVisible,
          otherRevenueVisible,
          annualFeeVisible,
          cancelledVisible,
          creditsVisible,
          creditsCategory,
          energyLoaded: false,
          leaseLoaded: false,
          zeevMessage: "A última apuração ficou grande demais para salvar no navegador. Atualize as bases para recarregar os dados.",
          monthlyBranches, otherRevenueBranches, annualFeeBranches, cancelledBranches,
        }));
      } catch {
        // O armazenamento local não pode impedir a atualização das bases.
      }
    }
  }, [storageReady, restoredStorageKey, storageKey, rows, cancelledRows, loaded, classified, ignoredCancelled, otherRevenueRows, otherRevenueLoaded, annualFeeRows, annualFeeLoaded, cancelledLoaded, detailsOpen, monthlyVisible, otherRevenueVisible, annualFeeVisible, cancelledVisible, creditsVisible, creditsCategory, energyRows, energyLoaded, leaseRows, leaseLoaded, zeevMessage, monthlyBranches, otherRevenueBranches, annualFeeBranches, cancelledBranches]);

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
    setEnergyRows([]);
    setEnergyLoaded(false);
    setLeaseRows([]);
    setLeaseLoaded(false);
    setMonthlyBranches([]); setOtherRevenueBranches([]); setAnnualFeeBranches([]); setCancelledBranches([]);
    setRequestedBranches([]);
    setDetailsOpen(false);
    setOtherRevenueError("");
    setAnnualFeeError("");
    setCancelledError("");
    setEnergyError("");
    setLeaseError("");
    setZeevMessage("");
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

  async function updateEnergyCredits() {
    setEnergyLoading(true);
    setEnergyError("");
    setZeevMessage("");
    try {
      const response = await fetch(`/api/totvs/pis-cofins/credits/energy?company=${companyCode}&competence=${competence}${branchQuery}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao consultar os lançamentos de Energia.");
      setEnergyRows(payload.rows || []);
      setEnergyLoaded(true);
      setZeevMessage(payload.zeev?.error || "");
    } catch (cause) {
      setEnergyError((cause as Error).message);
    } finally {
      setEnergyLoading(false);
    }
  }

  function exportEnergyCredits() {
    if (!energyRows.length) return;
    const sheet = XLSX.utils.json_to_sheet(energyRows.map((row) => ({ Coligada: row.company, Filial: row.branch, Data: row.date.slice(0, 10).split("-").reverse().join("/"), Conta: row.account, "Cód. reduzido": row.reduced, Lançamento: row.entryId, Documento: row.document, "IDMOV de origem": row.integrationKey, Complemento: row.complement, "Centro de custo": row.costCenter, "Valor contábil": row.value, "Ticket Zeev": row.ticket?.id || "Não localizado", "Situação Zeev": row.ticket?.status || "Pendente", "Link Zeev": row.ticket?.link || "", "Documentos Zeev": row.ticket?.documents?.map((document) => document.url).join(" | ") || "" })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Energia");
    XLSX.writeFile(workbook, `creditos-energia-coligada-${companyCode}-${competence}.xlsx`, { compression: true });
  }

  async function updateLeaseCredits() {
    setLeaseLoading(true);
    setLeaseError("");
    try {
      const response = await fetch(`/api/totvs/pis-cofins/credits/leases?company=${companyCode}&competence=${competence}${branchQuery}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao consultar os lançamentos de Arrendamentos.");
      setLeaseRows(payload.rows || []);
      setLeaseLoaded(true);
    } catch (cause) {
      setLeaseError((cause as Error).message);
    } finally {
      setLeaseLoading(false);
    }
  }

  function exportLeaseCredits() {
    if (!leaseRows.length) return;
    const sheet = XLSX.utils.json_to_sheet(leaseRows.map((row) => ({ Coligada: row.company, Filial: row.branch, Data: row.date.slice(0, 10).split("-").reverse().join("/"), Conta: row.account, "Cód. reduzido": row.reduced, Lançamento: row.entryId, Documento: row.document, "IDMOV de origem": row.integrationKey, Origem: row.sourceSystem, Complemento: row.complement, "Centro de custo": row.costCenter, "Valor débito": row.value })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Arrendamentos");
    XLSX.writeFile(workbook, `creditos-arrendamentos-coligada-${companyCode}-${competence}.xlsx`, { compression: true });
  }

  async function downloadZeevDocument(ticketId: string, file?: { name: string; url: string }) {
    if (!ticketId) return;
    setEnergyError("");
    try {
      const params = new URLSearchParams({ ticket: ticketId });
      if (file?.url) params.set("url", file.url);
      if (file?.name) params.set("name", file.name);
      const response = await fetch(`/api/zeev/document?${params.toString()}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Não foi possível baixar o documento do Zeev.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = file?.name || `ticket-${ticketId}`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (cause) {
      setEnergyError((cause as Error).message);
    }
  }

  const filteredRows = useMemo(() => rows.filter((row) => monthlyBranches.includes(String(row.branch || "").trim())), [rows, monthlyBranches]);
  const filteredOtherRevenueRows = useMemo(() => otherRevenueRows.filter((row) => otherRevenueBranches.includes(String(row.branch || "").trim())), [otherRevenueRows, otherRevenueBranches]);
  const filteredAnnualFeeRows = useMemo(() => annualFeeRows.filter((row) => annualFeeBranches.includes(String(row.branch || "").trim())), [annualFeeRows, annualFeeBranches]);
  const filteredCancelledRows = useMemo(() => cancelledRows.filter((row) => cancelledBranches.includes(String(row.branch || "").trim())), [cancelledRows, cancelledBranches]);
  const selectableBranches = useMemo(() => Array.from({ length: 15 }, (_, index) => String(index + 1)), []);

  function selectAllBranches() {
    setRequestedBranches([]);
    setEnergyRows([]);
    setEnergyLoaded(false);
    setEnergyError("");
    setZeevMessage("");
    setMonthlyBranches(branchValues(rows));
    setOtherRevenueBranches(branchValues(otherRevenueRows));
    setAnnualFeeBranches(branchValues(annualFeeRows));
    setCancelledBranches(branchValues(cancelledRows));
  }

  function toggleGlobalBranch(branch: string, checked: boolean) {
    setRequestedBranches((current) => checked
      ? [...new Set([...current, branch])].sort((a, b) => Number(a) - Number(b))
      : current.filter((item) => item !== branch));
    setEnergyRows([]);
    setEnergyLoaded(false);
    setEnergyError("");
    setZeevMessage("");
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

  function exportItemRows(rowsToExport: Record<string, string | number>[], sheetName: string, fileName: string) {
    if (!rowsToExport.length) return;
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rowsToExport);
    worksheet["!cols"] = Object.keys(rowsToExport[0]).map((key) => ({ wch: Math.min(38, Math.max(12, key.length + 2)) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, fileName);
  }

  function exportOtherRevenuesExcel() {
    exportItemRows(filteredOtherRevenueRows.filter((row) => [row.taxBase, row.pis, row.cofins].some((value) => Math.abs(value) > 0.000001)).map((row) => ({
      Coligada: row.company,
      Filial: row.branch,
      Competência: competenceLabel,
      Data: row.date,
      "Cód. reduzido": row.reduced,
      Conta: row.account,
      Descrição: row.description,
      Agrupamento: row.group,
      Classificação: row.classification,
      "Base tributável": row.taxBase,
      PIS: row.pis,
      COFINS: row.cofins,
      "ID lançamento": row.entryId,
      Complemento: row.complement,
    })), "Outras Receitas", `outras-receitas-${companyCode}-${competence}.xlsx`);
  }

  function exportAnnualFeesExcel() {
    exportItemRows(filteredAnnualFeeRows.filter((row) => Math.abs(row.netRevenue) > 0.000001).map((row) => {
      const rate = row.regime ? rates[row.regime] : null;
      return {
        Coligada: row.company,
        Filial: row.branch,
        Competência: competenceLabel,
        Data: row.date,
        Conta: row.account,
        Descrição: row.service,
        Classificação: row.regime,
        "Valor bruto": row.grossRevenue,
        Descontos: row.discounts,
        "Base tributável": row.netRevenue,
        PIS: rate ? row.netRevenue * rate.pis : 0,
        COFINS: rate ? row.netRevenue * rate.cofins : 0,
        "ID lançamento": row.entryId,
        Complemento: row.complement,
      };
    }), "Rateios Anuidades", `rateios-anuidades-${companyCode}-${competence}.xlsx`);
  }

  function exportCancelledInvoicesExcel() {
    exportItemRows(filteredCancelledRows.filter((row) => Math.abs(row.netValue) > 0.000001).map((row) => {
      const rate = row.regime ? rates[row.regime] : null;
      return {
        Coligada: row.company,
        Filial: row.branch,
        "Competência da apuração": competenceLabel,
        "Competência de origem": row.sourceCompetence,
        Cancelamento: row.cancellationDate,
        "NF-e": row.invoice,
        RPS: row.rps,
        Aluno: row.student,
        Serviço: row.service,
        Classificação: row.regime,
        "Valor bruto": row.grossValue,
        Descontos: row.discountValue,
        "Valor líquido excluído": row.netValue,
        "PIS excluído": rate ? row.netValue * rate.pis : 0,
        "COFINS excluída": rate ? row.netValue * rate.cofins : 0,
      };
    }), "Notas Canceladas", `notas-canceladas-${companyCode}-${competence}.xlsx`);
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
    type Components = { monthly: number; other: number; annual: number; cancelled: number };
    type BranchConsolidated = Record<"cumulativePis" | "cumulativeCofins" | "nonCumulativePis" | "nonCumulativeCofins", Components>;
    const emptyBranch = (): BranchConsolidated => ({
      cumulativePis: { monthly: 0, other: 0, annual: 0, cancelled: 0 },
      cumulativeCofins: { monthly: 0, other: 0, annual: 0, cancelled: 0 },
      nonCumulativePis: { monthly: 0, other: 0, annual: 0, cancelled: 0 },
      nonCumulativeCofins: { monthly: 0, other: 0, annual: 0, cancelled: 0 },
    });
    const byBranch = new Map<string, BranchConsolidated>();
    const branchTotals = (branch: string) => {
      const key = String(branch || "").trim() || "Sem filial";
      if (!byBranch.has(key)) byBranch.set(key, emptyBranch());
      return byBranch.get(key)!;
    };

    filteredRows.forEach((row) => {
      if (!row.regime) return;
      const rate = rates[row.regime];
      const target = branchTotals(row.branch);
      const pisKey = row.regime === "Cumulativo" ? "cumulativePis" : "nonCumulativePis";
      const cofinsKey = row.regime === "Cumulativo" ? "cumulativeCofins" : "nonCumulativeCofins";
      target[pisKey].monthly += row.netRevenue * rate.pis;
      target[cofinsKey].monthly += row.netRevenue * rate.cofins;
    });
    filteredOtherRevenueRows.forEach((row) => {
      const target = branchTotals(row.branch);
      target.nonCumulativePis.other += row.pis;
      target.nonCumulativeCofins.other += row.cofins;
    });
    filteredAnnualFeeRows.forEach((row) => {
      if (!row.regime) return;
      const rate = rates[row.regime];
      const target = branchTotals(row.branch);
      const pisKey = row.regime === "Cumulativo" ? "cumulativePis" : "nonCumulativePis";
      const cofinsKey = row.regime === "Cumulativo" ? "cumulativeCofins" : "nonCumulativeCofins";
      target[pisKey].annual += row.netRevenue * rate.pis;
      target[cofinsKey].annual += row.netRevenue * rate.cofins;
    });
    filteredCancelledRows.forEach((row) => {
      if (!row.regime) return;
      const rate = rates[row.regime];
      const target = branchTotals(row.branch);
      const pisKey = row.regime === "Cumulativo" ? "cumulativePis" : "nonCumulativePis";
      const cofinsKey = row.regime === "Cumulativo" ? "cumulativeCofins" : "nonCumulativeCofins";
      target[pisKey].cancelled -= row.netValue * rate.pis;
      target[cofinsKey].cancelled -= row.netValue * rate.cofins;
    });

    const makeRow = (view: string, branch: string, tax: string, values: Components) => ({
      "Visão": view,
      Coligada: companyCode,
      Filial: branch,
      "Competência": competenceLabel,
      Tributo: tax,
      "Faturamento Mensal": values.monthly,
      "Outras Receitas": values.other,
      "Rateios Anuidades": values.annual,
      "Notas Canceladas (dedução)": values.cancelled,
      "Total consolidado": values.monthly + values.other + values.annual + values.cancelled,
    });
    const general = [
      makeRow("TOTAL GERAL", "Todas", "PIS cumulativo", { monthly: totals.cumulativePis, other: 0, annual: annualFeeTotals.cumulativePis, cancelled: -cancelledTotals.cumulativePis }),
      makeRow("TOTAL GERAL", "Todas", "COFINS cumulativo", { monthly: totals.cumulativeCofins, other: 0, annual: annualFeeTotals.cumulativeCofins, cancelled: -cancelledTotals.cumulativeCofins }),
      makeRow("TOTAL GERAL", "Todas", "PIS não cumulativo", { monthly: totals.nonCumulativePis, other: otherRevenueTotals.pis, annual: annualFeeTotals.nonCumulativePis, cancelled: -cancelledTotals.nonCumulativePis }),
      makeRow("TOTAL GERAL", "Todas", "COFINS não cumulativo", { monthly: totals.nonCumulativeCofins, other: otherRevenueTotals.cofins, annual: annualFeeTotals.nonCumulativeCofins, cancelled: -cancelledTotals.nonCumulativeCofins }),
    ];
    const branches = [...byBranch.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "pt-BR", { numeric: true }))
      .flatMap(([branch, values]) => [
        makeRow("POR FILIAL", branch, "PIS cumulativo", values.cumulativePis),
        makeRow("POR FILIAL", branch, "COFINS cumulativo", values.cumulativeCofins),
        makeRow("POR FILIAL", branch, "PIS não cumulativo", values.nonCumulativePis),
        makeRow("POR FILIAL", branch, "COFINS não cumulativo", values.nonCumulativeCofins),
      ]);
    return [...general, ...branches].filter((row) => Math.abs(row["Total consolidado"]) > 0.000001);
  }

  function consolidatedWorksheet() {
    const consolidatedRows = consolidatedExportRows().filter((row) => Math.abs(row["Total consolidado"]) > 0.000001);
    const cumulativeRevenue = totals.cumulativeBase + annualFeeTotals.cumulativeBase - cancelledTotals.cumulativeBase;
    const nonCumulativeRevenue = totals.nonCumulativeBase + otherRevenueTotals.taxBase + annualFeeTotals.nonCumulativeBase - cancelledTotals.nonCumulativeBase;
    const totalRevenue = cumulativeRevenue + nonCumulativeRevenue;
    const revenueCompositionRows: (string | number)[][] = [
      ["BASE CONSOLIDADA - APURAÇÃO PIS E COFINS", "", "", "", "", "", "", "", "", ""],
      ["Empresa", companyName, "Coligada", companyCode, "Competência", competenceLabel, "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", ""],
      ["COMPOSIÇÃO DAS RECEITAS", "", "", "", "", "", "", "", "", ""],
      ["Tipo de receita", "Valor", "% sobre o total", "", "", "", "", "", "", ""],
      ["Receita cumulativa", cumulativeRevenue, totalRevenue ? cumulativeRevenue / totalRevenue : 0, "", "", "", "", "", "", ""],
      ["Receita não cumulativa", nonCumulativeRevenue, totalRevenue ? nonCumulativeRevenue / totalRevenue : 0, "", "", "", "", "", "", ""],
      ["TOTAL", totalRevenue, totalRevenue ? 1 : 0, "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", ""],
      ["APURAÇÃO CONSOLIDADA POR TRIBUTO", "", "", "", "", "", "", "", "", ""],
    ];
    const consolidatedTable = consolidatedRows.map((row) => [
      row["Visão"],
      row.Coligada,
      row.Filial,
      row["Competência"],
      row.Tributo,
      row["Faturamento Mensal"],
      row["Outras Receitas"],
      row["Rateios Anuidades"],
      row["Notas Canceladas (dedução)"],
      row["Total consolidado"],
    ]);
    const worksheet = XLSX.utils.aoa_to_sheet([
      ...revenueCompositionRows,
      ["Visão", "Coligada", "Filial", "Competência", "Tributo", "Faturamento Mensal", "Outras Receitas", "Rateios Anuidades", "Notas Canceladas (dedução)", "Total consolidado"],
      ...consolidatedTable,
    ]);
    worksheet["!cols"] = [18, 18, 16, 14, 25, 20, 20, 22, 28, 20].map((wch) => ({ wch }));
    worksheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 9 } },
      { s: { r: 9, c: 0 }, e: { r: 9, c: 9 } },
    ];
    [5, 6, 7].forEach((row) => {
      const valueCell = worksheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
      const percentCell = worksheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
      if (valueCell?.t === "n") valueCell.z = "#,##0.00";
      if (percentCell?.t === "n") percentCell.z = "0.00%";
    });
    for (let row = 11; row <= 10 + consolidatedRows.length; row += 1) {
      for (let column = 5; column <= 9; column += 1) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell?.t === "n") cell.z = "#,##0.00";
      }
    }
    Object.keys(worksheet).filter((address) => !address.startsWith("!")).forEach((address) => {
      const cell = worksheet[address];
      const { r } = XLSX.utils.decode_cell(address);
      if ([0, 3, 9, 10].includes(r)) {
        cell.s = {
          font: { name: "Arial", sz: r === 0 ? 12 : 10, bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: r === 3 ? "2F80C0" : "14213D" } },
          alignment: { horizontal: "center", vertical: "center" },
        };
      } else if ([5, 6, 7].includes(r)) {
        cell.s = {
          font: { name: "Arial", sz: 10, bold: r === 7 },
          fill: { fgColor: { rgb: r === 7 ? "E8F1FA" : "FFFFFF" } },
        };
      }
    });
    return worksheet;
  }

  async function exportCompleteAssessment() {
    setError("");
    // A PACONT é criada do zero para não herdar nomes definidos, fórmulas
    // quebradas, vínculos externos e estilos ocultos do modelo legado.
    const workbook = XLSX.utils.book_new();
    const generatedAt = new Date();
    const generatedAtLabel = generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const monthlyByRegime = (regime: Exclude<TaxRegime, "">) => filteredRows.filter((row) => row.regime === regime).reduce((sum, row) => ({
      gross: sum.gross + row.grossRevenue,
      discounts: sum.discounts + row.discounts,
    }), { gross: 0, discounts: 0 });
    const annualByRegime = (regime: Exclude<TaxRegime, "">) => filteredAnnualFeeRows.filter((row) => row.regime === regime).reduce((sum, row) => sum + row.netRevenue, 0);
    const cancelledByRegime = (regime: Exclude<TaxRegime, "">) => filteredCancelledRows.filter((row) => row.regime === regime).reduce((sum, row) => sum + row.netValue, 0);

    const createCompactPacont = (
      sheetName: string,
      regime: Exclude<TaxRegime, "">,
      financialBase = 0,
      financialPis = 0,
      financialCofins = 0,
      otherBase = 0,
      otherPis = 0,
      otherCofins = 0,
    ) => {
      const rate = rates[regime];
      const monthly = monthlyByRegime(regime);
      const annual = annualByRegime(regime);
      const cancelled = cancelledByRegime(regime);
      const movements = [
        { description: "Faturamento mensal", base: monthly.gross, pisRate: rate.pis, pis: monthly.gross * rate.pis, cofinsRate: rate.cofins, cofins: monthly.gross * rate.cofins },
        { description: "Descontos incondicionais", base: -monthly.discounts, pisRate: rate.pis, pis: -monthly.discounts * rate.pis, cofinsRate: rate.cofins, cofins: -monthly.discounts * rate.cofins },
        { description: "Rateios Anuidades", base: annual, pisRate: rate.pis, pis: annual * rate.pis, cofinsRate: rate.cofins, cofins: annual * rate.cofins },
        { description: "Notas canceladas", base: -cancelled, pisRate: rate.pis, pis: -cancelled * rate.pis, cofinsRate: rate.cofins, cofins: -cancelled * rate.cofins },
        ...(regime === "Não-Cumulativo" ? [
          { description: "Outras receitas", base: otherBase, pisRate: otherBase ? otherPis / otherBase : 0, pis: otherPis, cofinsRate: otherBase ? otherCofins / otherBase : 0, cofins: otherCofins },
          { description: "Receitas financeiras", base: financialBase, pisRate: financialBase ? financialPis / financialBase : 0, pis: financialPis, cofinsRate: financialBase ? financialCofins / financialBase : 0, cofins: financialCofins },
        ] : []),
      ].filter((row) => [row.base, row.pis, row.cofins].some((value) => Math.abs(value) > 0.000001));

      if (!movements.length) return false;
      const totals = movements.reduce((sum, row) => ({
        base: sum.base + row.base,
        pis: sum.pis + row.pis,
        cofins: sum.cofins + row.cofins,
      }), { base: 0, pis: 0, cofins: 0 });
      if (![totals.base, totals.pis, totals.cofins].some((value) => Math.abs(value) > 0.000001)) return false;
      const rows: (string | number)[][] = [
        ["PACONT - PLANILHA DE APURAÇÃO DAS CONTRIBUIÇÕES", "", "", "", "", ""],
        ["Empresa", companyName, "Competência", competenceLabel, "Gerado em", generatedAtLabel],
        ["Tributação", taxRegime, "Regime PIS/COFINS", regime, "", ""],
        ["Elaborado por", "", "Revisado por", "", "", ""],
        ["", "", "", "", "", ""],
        ["RESUMO DA APURAÇÃO", "", "", "", "", ""],
        ["Base tributável", totals.base, "PIS apurado", totals.pis, "COFINS apurada", totals.cofins],
        ["", "", "", "", "", ""],
        ["Composição", "Base tributável", "Alíquota PIS", "PIS", "Alíquota COFINS", "COFINS"],
        ...movements.map((row) => [row.description, row.base, row.pisRate, row.pis, row.cofinsRate, row.cofins]),
        ["TOTAL", totals.base, "", totals.pis, "", totals.cofins],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet["!cols"] = [{ wch: 31 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 18 }];
      worksheet["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
        { s: { r: 5, c: 0 }, e: { r: 5, c: 5 } },
      ];
      for (let row = 6; row < rows.length; row += 1) {
        [1, 3, 5].forEach((column) => {
          const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (cell?.t === "n") cell.z = "#,##0.00";
        });
        [2, 4].forEach((column) => {
          const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (cell?.t === "n") cell.z = "0.00%";
        });
      }
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      return true;
    };

    const hasCumulativeBalance = createCompactPacont("PACONT CUMULATIVO", "Cumulativo");
    const hasNonCumulativeBalance = createCompactPacont(
      "PACONT NÃO CUMULATIVO",
      "Não-Cumulativo",
      otherRevenueTotals.financialBase,
      otherRevenueTotals.financialPis,
      otherRevenueTotals.financialCofins,
      otherRevenueTotals.otherBase,
      otherRevenueTotals.otherPis,
      otherRevenueTotals.otherCofins,
    );
    const deliveredSheets = [
      hasCumulativeBalance ? "PACONT CUMULATIVO" : "",
      hasNonCumulativeBalance ? "PACONT NÃO CUMULATIVO" : "",
      consolidatedExportRows().some((row) => Math.abs(row["Total consolidado"]) > 0.000001) ? "Base consolidada" : "",
      filteredRows.some((row) => Math.abs(row.netRevenue) > 0.000001) ? "Faturamento Mensal" : "",
      filteredOtherRevenueRows.some((row) => [row.taxBase, row.pis, row.cofins].some((value) => Math.abs(value) > 0.000001)) ? "Outras Receitas" : "",
      filteredAnnualFeeRows.some((row) => Math.abs(row.netRevenue) > 0.000001) ? "Rateios Anuidades" : "",
      filteredCancelledRows.some((row) => Math.abs(row.netValue) > 0.000001) ? "Notas Canceladas" : "",
      "Instruções",
    ].filter(Boolean);
    const selectedBranchesLabel = requestedBranches.length ? requestedBranches.join(", ") : "Todas as filiais disponíveis nas bases";
    const instructionRows: (string | number)[][] = [
      ["INSTRUÇÕES DA APURAÇÃO COMPLETA DE PIS E COFINS", "", "", ""],
      ["Arquivo", "Empresa", companyName, ""],
      ["Arquivo", "Regime tributário", taxRegime, ""],
      ["Arquivo", "Competência", competenceLabel, ""],
      ["Arquivo", "Filiais consideradas", selectedBranchesLabel, ""],
      ["Arquivo", "Gerado em", generatedAtLabel, ""],
      ["", "", "", ""],
      ["SEÇÃO", "ITEM", "PREMISSA / ENTREGA AUTOMÁTICA", "REFERÊNCIA"],
      ["Fluxo", "Filtros", "Empresa, ano, mês e uma ou várias filiais (1 a 15) determinam todas as consultas e cálculos do arquivo.", "Regra operacional Contabilidade Raiz"],
      ["Fluxo", "Persistência", "Cada etapa mantém a última apuração até o usuário acionar Limpar. Ocultar/Exibir altera somente a visualização.", "Regra operacional Contabilidade Raiz"],
      ["Faturamento Mensal", "Origem", "Planilha.NET 53 do módulo Gestão de Estoque, Compras e Faturamento; consulta METTA.108090, aplicação T, título ANALISE NF COM CONTA.", "TOTVS RM"],
      ["Faturamento Mensal", "Competência e base", "Considera somente a competência filtrada. A base tributável final é o campo VLRNF; notas canceladas são retiradas e tratadas na etapa própria.", "Regra operacional Contabilidade Raiz"],
      ["Faturamento Mensal", "Classificação", "Classificação linha a linha pelo campo DESCRIÇÃO, usando SERVICO_ED como identificação do serviço quando disponibilizado pela consulta.", "Matriz aprovada pela Contabilidade"],
      ["Faturamento Mensal", "Entrega desta exportação", `${filteredRows.length} linha(s); bruto ${brl.format(totals.grossRevenue)}; descontos ${brl.format(totals.discounts)}; base VLRNF ${brl.format(totals.nfBase)}.`, "Dados da competência exportada"],
      ["Outras Receitas", "Origem", "Movimentos mensais das contas parametrizadas na Base contas, consultados no razão contábil do TOTVS para a empresa e filiais selecionadas.", "TOTVS RM Contábil"],
      ["Outras Receitas", "Classificação", "Para empresas no Lucro Real: receitas financeiras são não cumulativas a 0,65% de PIS e 4,00% de COFINS; demais receitas parametrizadas são não cumulativas a 1,65% e 7,60%. Itens sem regra permanecem em branco e não entram no cálculo.", "Decreto nº 8.426/2015 e parametrização interna"],
      ["Outras Receitas", "Entrega desta exportação", `${filteredOtherRevenueRows.length} lançamento(s); base tributável ${brl.format(otherRevenueTotals.taxBase)}; PIS ${brl.format(otherRevenueTotals.pis)}; COFINS ${brl.format(otherRevenueTotals.cofins)}.`, "Dados da competência exportada"],
      ["Rateios Anuidades", "Origem e tratamento", "Lançamentos contábeis RAT-* gerados no RM Saldus. São classificados linha a linha pela mesma matriz de serviços do faturamento.", "TOTVS RM Contábil"],
      ["Rateios Anuidades", "Entrega desta exportação", `${filteredAnnualFeeRows.length} lançamento(s); base líquida ${brl.format(annualFeeTotals.netRevenue)}; PIS ${brl.format(annualFeeTotals.pis)}; COFINS ${brl.format(annualFeeTotals.cofins)}.`, "Dados da competência exportada"],
      ["Notas Canceladas", "Origem", "Planilha.NET 37; consulta METTA.100, codColigada técnico 0, aplicação C, título NOTAS MUNICIPAIS CANCELADAS.", "TOTVS RM"],
      ["Notas Canceladas", "Tratamento", "As notas são classificadas como cumulativas ou não cumulativas pelo serviço e seus valores são deduzidos da apuração consolidada.", "Regra operacional Contabilidade Raiz"],
      ["Notas Canceladas", "Entrega desta exportação", `${filteredCancelledRows.length} nota(s); valor líquido excluído ${brl.format(cancelledTotals.net)}; PIS deduzido ${brl.format(cancelledTotals.pis)}; COFINS deduzida ${brl.format(cancelledTotals.cofins)}.`, "Dados da competência exportada"],
      ["Apuração Consolidada", "Fórmula", "Faturamento Mensal + Outras Receitas + Rateios Anuidades - Notas Canceladas, mantendo a separação entre regimes cumulativo e não cumulativo.", "Regra operacional Contabilidade Raiz"],
      ["Apuração Consolidada", "Entrega desta exportação", `PIS cumulativo ${brl.format(consolidatedTotals.cumulativePis)}; COFINS cumulativa ${brl.format(consolidatedTotals.cumulativeCofins)}; PIS não cumulativo ${brl.format(consolidatedTotals.nonCumulativePis)}; COFINS não cumulativa ${brl.format(consolidatedTotals.nonCumulativeCofins)}.`, "Base consolidada"],
      ["Apuração Completa", "Abas entregues", `${deliveredSheets.join(", ")}. Abas sem saldo não são incluídas.`, "Este arquivo"],
      ["", "", "", ""],
      ["MATRIZ DE CLASSIFICAÇÃO", "SERVIÇO / DESCRIÇÃO", "CLASSIFICAÇÃO", ""],
      ["Serviços", "Berçário", "Cumulativo", ""],
      ["Serviços", "Creche", "Cumulativo", ""],
      ["Serviços", "Pré-Escolar", "Cumulativo", ""],
      ["Serviços", "Ensino Infantil", "Cumulativo", ""],
      ["Serviços", "Ensino Fundamental", "Cumulativo", ""],
      ["Serviços", "Ensino Regular", "Cumulativo", ""],
      ["Serviços", "Ensino Médio", "Cumulativo", ""],
      ["Serviços", "Pré-Vestibular - Cursos", "Não-Cumulativo", ""],
      ["Serviços", "1ª Cota Ensino Infantil", "Cumulativo", ""],
      ["Serviços", "1ª Cota Ensino Fundamental", "Cumulativo", ""],
      ["Serviços", "1ª Cota Ensino Médio", "Cumulativo", ""],
      ["Serviços", "Horário Integral", "Cumulativo", ""],
      ["Serviços", "Escolinhas / Atividades Extras", "Não-Cumulativo", ""],
      ["Serviços", "High School - Cursos", "Não-Cumulativo", ""],
      ["Serviços", "Orientação Pedagógica", "Não-Cumulativo", ""],
      ["Serviços", "Anuidade - Ensino Fundamental", "Cumulativo", ""],
      ["Serviços", "Anuidade - Ensino Médio", "Cumulativo", ""],
      ["Serviços", "Anuidade - Ensino Infantil", "Cumulativo", ""],
      ["Serviços", "Anuidade - Orientação Pedagógica", "Não-Cumulativo", ""],
      ["Serviços", "Anuidade - Horário Integral", "Não-Cumulativo", ""],
      ["Serviços", "Semestralidade - Ensino Fundamental", "Cumulativo", ""],
      ["Serviços", "Semestralidade - Ensino Médio", "Cumulativo", ""],
      ["Serviços", "Descrição não parametrizada", "Em branco; não entra no cálculo até validação da área fiscal.", "Controle de exceção"],
      ["", "", "", ""],
      ["RESUMO LEGAL", "TEMA", "ORIENTAÇÃO RESUMIDA", "FONTE OFICIAL"],
      ["Legislação", "Incidência", "PIS/Pasep e COFINS incidem, em regra, sobre o faturamento ou as receitas das pessoas jurídicas de direito privado.", "https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/pis-pasep-cofins"],
      ["Legislação", "Regime cumulativo", "Alíquotas gerais de 0,65% para PIS e 3,00% para COFINS, ressalvadas hipóteses específicas. Não há desconto ordinário de créditos da não cumulatividade.", "https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/ecf/erguntas-e-respostas-pessoa-juridica-2019-arquivos/capitulo-xxii-contribuicao-para-o-pis-pasep-e-cofins-incidentes-sobre-a-receita-ou-o-faturamento-2019.pdf"],
      ["Legislação", "Regime não cumulativo", "Para pessoas jurídicas no Lucro Real, a regra geral é a não cumulatividade, com alíquotas usuais de 1,65% para PIS e 7,60% para COFINS, observadas as receitas que a lei mantém no cumulativo e as regras próprias de créditos.", "https://www.planalto.gov.br/ccivil_03/leis/2002/l10637.htm | https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm"],
      ["Legislação", "Receitas financeiras", "Nas pessoas jurídicas sujeitas ao regime não cumulativo, a parametrização utiliza 0,65% de PIS e 4,00% de COFINS para receitas financeiras, observadas as exceções legais.", "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/decreto/d8426.htm"],
      ["Legislação", "Escolas", "A tributação de escolas depende da natureza jurídica, do regime do IRPJ e da espécie da receita. Instituições sem fins lucrativos que atendam aos requisitos legais possuem tratamento próprio; este arquivo não presume isenção. A matriz de serviços acima é uma premissa operacional aprovada pela Contabilidade e deve ser revisada pela área fiscal quando houver novo serviço ou mudança legal.", "https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/ecf/erguntas-e-respostas-pessoa-juridica-2019-arquivos/capitulo-xxii-contribuicao-para-o-pis-pasep-e-cofins-incidentes-sobre-a-receita-ou-o-faturamento-2019.pdf"],
      ["Atenção", "Validação", "Resumo informativo. A classificação final, os créditos, retenções, benefícios e demais ajustes devem ser validados pela área fiscal antes da escrituração e do recolhimento.", "IN RFB nº 2.121/2022 e alterações posteriores"],
    ];
    const wrapInstruction = (value: string | number, maxLength: number) => {
      if (typeof value !== "string" || value.length <= maxLength) return value;
      const words = value.split(" ");
      const lines: string[] = [];
      let line = "";
      words.forEach((word) => {
        if (line && `${line} ${word}`.length > maxLength) {
          lines.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      });
      if (line) lines.push(line);
      return lines.join("\n");
    };
    const compactInstructionRows = instructionRows
      .filter((row) => row.some((value) => String(value).trim()))
      .map((row) => row.map((value, column) => wrapInstruction(value, column === 2 ? 62 : column === 3 ? 48 : 30)));
    const instructionSheet = XLSX.utils.aoa_to_sheet(compactInstructionRows);
    instructionSheet["!cols"] = [{ wch: 19 }, { wch: 27 }, { wch: 64 }, { wch: 50 }];
    instructionSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    instructionSheet["!rows"] = compactInstructionRows.map((row, index) => ({
      hpt: index === 0 ? 22 : Math.max(18, Math.max(...row.map((value) => String(value).split("\n").length)) * 11),
    }));
    Object.keys(instructionSheet).filter((address) => !address.startsWith("!")).forEach((address) => {
      const cell = instructionSheet[address];
      cell.s = {
        font: { name: "Arial", sz: address === "A1" ? 10 : 8, bold: address === "A1" },
        alignment: { wrapText: true, vertical: "top" },
      };
    });
    const monthly = filteredRows.filter((row) => Math.abs(row.netRevenue) > 0.000001).map((row) => {
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
    const otherRevenues = filteredOtherRevenueRows.filter((row) => [row.taxBase, row.pis, row.cofins].some((value) => Math.abs(value) > 0.000001)).map((row) => ({
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
    const annualFeeAllocations = filteredAnnualFeeRows.filter((row) => Math.abs(row.netRevenue) > 0.000001).map((row) => {
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
    const cancelled = filteredCancelledRows.filter((row) => Math.abs(row.netValue) > 0.000001).map((row) => ({
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
    if (consolidatedExportRows().some((row) => Math.abs(row["Total consolidado"]) > 0.000001)) XLSX.utils.book_append_sheet(workbook, consolidatedWorksheet(), "Base consolidada");
    if (monthly.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(monthly), "Faturamento Mensal");
    if (otherRevenues.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(otherRevenues), "Outras Receitas");
    if (annualFeeAllocations.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(annualFeeAllocations), "Rateios Anuidades");
    if (cancelled.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cancelled), "Notas Canceladas");
    XLSX.utils.book_append_sheet(workbook, instructionSheet, "Instruções");
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
                <label className="tax-all-branches">
                  <input type="checkbox" checked={!requestedBranches.length} onChange={(event) => { if (event.target.checked) selectAllBranches(); }} />
                  Todas
                </label>
                {selectableBranches.map((branch) => <label key={branch}>
                  <input type="checkbox" checked={requestedBranches.includes(branch)} onChange={(event) => toggleGlobalBranch(branch, event.target.checked)} />
                  Filial {branch}
                </label>)}
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
      <section className={`tax-secondary-section ${monthlyVisible ? "" : "is-collapsed"}`}>
      <div className="tax-section-heading">
        <div><b>Faturamento Mensal</b><span>Planilha.NET 53 · ANÁLISE NF COM CONTA</span></div>
        <button
          className={loaded ? "tax-secondary-update is-ready" : "tax-secondary-update"}
          disabled={loading || !companyCode}
          onClick={() => void update()}
        >
          <RefreshCw className={loading ? "spin" : ""} />
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
        <button className="tax-detail-export" disabled={!loaded || !filteredRows.length} onClick={exportExcel}>
          <Download /> Exportar
        </button>
        <button className="tax-visibility-toggle" onClick={() => setMonthlyVisible((visible) => !visible)}>
          {monthlyVisible ? <ChevronUp /> : <ChevronDown />}
          {monthlyVisible ? "Ocultar" : "Exibir"}
        </button>
      </div>
      <div>
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
      </section>
      <section className={`tax-secondary-section ${otherRevenueVisible ? "" : "is-collapsed"}`}>
        <div className="tax-section-heading">
          <div><b>Outras Receitas</b><span>Razão Completo · contas definidas na aba Base contas</span></div>
          <button
            className={otherRevenueLoaded ? "tax-secondary-update is-ready" : "tax-secondary-update"}
            disabled={otherRevenueLoading || !companyCode}
            onClick={() => void updateOtherRevenues()}
          >
            <RefreshCw className={otherRevenueLoading ? "spin" : ""} />
            {otherRevenueLoading ? "Atualizando..." : "Atualizar"}
          </button>
          <button className="tax-detail-export" disabled={!otherRevenueLoaded || !filteredOtherRevenueRows.length} onClick={exportOtherRevenuesExcel}>
            <Download /> Exportar
          </button>
          <button className="tax-visibility-toggle" onClick={() => setOtherRevenueVisible((visible) => !visible)}>
            {otherRevenueVisible ? <ChevronUp /> : <ChevronDown />}
            {otherRevenueVisible ? "Ocultar" : "Exibir"}
          </button>
        </div>
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
            {annualFeeLoading ? "Atualizando..." : "Atualizar"}
          </button>
          <button className="tax-detail-export" disabled={!annualFeeLoaded || !filteredAnnualFeeRows.length} onClick={exportAnnualFeesExcel}>
            <Download /> Exportar
          </button>
          <button className="tax-visibility-toggle" onClick={() => setAnnualFeeVisible((visible) => !visible)}>
            {annualFeeVisible ? <ChevronUp /> : <ChevronDown />}
            {annualFeeVisible ? "Ocultar" : "Exibir"}
          </button>
        </div>
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
            {cancelledLoading ? "Atualizando..." : "Atualizar"}
          </button>
          <button className="tax-detail-export" disabled={!cancelledLoaded || !filteredCancelledRows.length} onClick={exportCancelledInvoicesExcel}>
            <Download /> Exportar
          </button>
          <button className="tax-visibility-toggle" onClick={() => setCancelledVisible((visible) => !visible)}>
            {cancelledVisible ? <ChevronUp /> : <ChevronDown />}
            {cancelledVisible ? "Ocultar" : "Exibir"}
          </button>
        </div>
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
      <section className={`tax-secondary-section ${creditsVisible ? "" : "is-collapsed"}`}>
        <div className="tax-section-heading">
          <div><b>Créditos</b><span>Créditos de PIS e COFINS · conferência contábil e documentos no Zeev</span></div>
          <button className={(creditsCategory === "energy" ? energyLoaded : leaseLoaded) ? "tax-secondary-update is-ready" : "tax-secondary-update"} disabled={creditsCategory === "energy" ? energyLoading : leaseLoading} onClick={creditsCategory === "energy" ? updateEnergyCredits : updateLeaseCredits} title={creditsCategory === "energy" ? "Consultar Energia no TOTVS e localizar os tickets no Zeev" : "Consultar Arrendamentos no Razão 25, conta 2.1.7.01.01.53"}>
            <RefreshCw className={(creditsCategory === "energy" ? energyLoading : leaseLoading) ? "is-spinning" : ""} /> {(creditsCategory === "energy" ? energyLoading : leaseLoading) ? "Atualizando" : "Atualizar"}
          </button>
          <button className="tax-detail-export" disabled={creditsCategory === "energy" ? !energyRows.length : !leaseRows.length} onClick={creditsCategory === "energy" ? exportEnergyCredits : exportLeaseCredits} title={creditsCategory === "energy" ? "Exportar os lançamentos de Energia e os tickets localizados" : "Exportar os lançamentos de Arrendamentos"}>
            <Download /> Exportar
          </button>
          <button className="tax-visibility-toggle" onClick={() => setCreditsVisible((visible) => !visible)}>
            {creditsVisible ? <ChevronUp /> : <ChevronDown />}
            {creditsVisible ? "Ocultar" : "Exibir"}
          </button>
        </div>
        {creditsVisible && <>
          <div className="tax-credit-tabs" role="tablist" aria-label="Tipos de crédito">
            <button role="tab" aria-selected={creditsCategory === "energy"} className={creditsCategory === "energy" ? "is-active" : ""} onClick={() => setCreditsCategory("energy")}>Energia</button>
            <button role="tab" aria-selected={creditsCategory === "leases"} className={creditsCategory === "leases" ? "is-active" : ""} onClick={() => setCreditsCategory("leases")}>Arrendamentos</button>
          </div>
          {creditsCategory === "leases" ? <>
            {leaseError && <div className="notice error">{leaseError}</div>}
            {!leaseLoaded ? <div className="tax-source-empty"><Calculator /><b>Arrendamentos · conta 2.1.7.01.01.53</b><span>Clique em Atualizar para carregar os débitos lançados pelo sistema financeiro na competência filtrada.</span></div> : <>
              <div className="tax-other-summary">
                <article><span>Lançamentos</span><b>{leaseRows.length}</b><small>Conta 2.1.7.01.01.53</small></article>
                <article><span>Valor a débito</span><b>{brl.format(leaseRows.reduce((sum, row) => sum + row.value, 0))}</b><small>Competência {competenceLabel}</small></article>
                <article><span>Origem</span><b>Financeiro</b><small>RM Fluxus / Financeiro</small></article>
                <article><span>Filiais</span><b>{new Set(leaseRows.map((row) => row.branch)).size}</b><small>Filtro aplicado</small></article>
              </div>
              {leaseRows.length ? <div className="table-wrap energy-credit-table"><table><thead><tr><th>Filial</th><th>Data</th><th>Conta</th><th>Cód. reduzido</th><th>Lançamento</th><th>Documento</th><th>IDMOV de origem</th><th>Origem</th><th>Complemento</th><th>Centro de custo</th><th>Valor débito</th></tr></thead><tbody>{leaseRows.map((row) => <tr key={`${row.branch}-${row.entryId}-${row.document}-${row.value}`}><td>{row.branch}</td><td>{row.date.slice(0, 10).split("-").reverse().join("/")}</td><td>{row.account}</td><td>{row.reduced}</td><td>{row.entryId}</td><td>{row.document || "—"}</td><td><b>{row.integrationKey || "—"}</b></td><td>{row.sourceSystem || "Financeiro"}</td><td>{row.complement || "—"}</td><td>{row.costCenter || "—"}</td><td><b>{brl.format(row.value)}</b></td></tr>)}</tbody><tfoot><tr><td colSpan={10}>Subtotal da competência</td><td>{brl.format(leaseRows.reduce((sum, row) => sum + row.value, 0))}</td></tr></tfoot></table></div> : <div className="tax-source-empty"><Calculator /><b>Sem movimento de Arrendamentos</b><span>Nenhum débito financeiro foi encontrado na conta 2.1.7.01.01.53 para os filtros selecionados.</span></div>}
            </>}
          </> : <>
            {energyError && <div className="notice error">{energyError}</div>}
            {zeevMessage && <div className="notice energy-credit-notice">{zeevMessage} Os lançamentos contábeis permanecem disponíveis para conferência.</div>}
            {!energyLoaded ? <div className="tax-source-empty"><Calculator /><b>Energia Elétrica · conta 4.2.1.02.04.01</b><span>Clique em Atualizar para carregar os movimentos contábeis e localizar o ticket de cada linha no Zeev.</span></div> : <>
              <div className="tax-other-summary">
                <article><span>Lançamentos</span><b>{energyRows.length}</b><small>Conta 913</small></article>
                <article><span>Valor contábil</span><b>{brl.format(energyRows.reduce((sum, row) => sum + row.value, 0))}</b><small>Competência {competenceLabel}</small></article>
                <article><span>Tickets localizados</span><b>{energyRows.filter((row) => row.ticket).length}</b><small>Vínculo com o Zeev</small></article>
                <article className={energyRows.some((row) => !row.ticket) ? "has-warning" : ""}><span>Sem ticket</span><b>{energyRows.filter((row) => !row.ticket).length}</b><small>Requer tratamento</small></article>
              </div>
              {energyRows.length ? <div className="table-wrap energy-credit-table"><table><thead><tr><th>Filial</th><th>Data</th><th>Conta</th><th>Cód. reduzido</th><th>Lançamento</th><th>Documento</th><th>IDMOV de origem</th><th>Fornecedor / complemento</th><th>Centro de custo</th><th>Valor contábil</th><th>Ticket Zeev</th><th>Situação</th><th>Documentos Zeev</th></tr></thead><tbody>{energyRows.map((row) => { const firstDocument = row.ticket?.documents?.[0]; return <tr key={`${row.branch}-${row.entryId}-${row.document}`}><td>{row.branch}</td><td>{row.date.slice(0, 10).split("-").reverse().join("/")}</td><td>{row.account}</td><td>{row.reduced}</td><td>{row.entryId}</td><td>{row.document || "—"}</td><td><b>{row.integrationKey || "—"}</b></td><td>{row.complement || "—"}</td><td>{row.costCenter || "—"}</td><td><b>{brl.format(row.value)}</b></td><td>{row.ticket ? <div className="zeev-ticket-cell"><b>#{row.ticket.id}</b>{row.ticket.link && <a className="zeev-ticket-action" href={row.ticket.link} target="_blank" rel="noreferrer">Consultar</a>}<button type="button" className="zeev-ticket-action zeev-ticket-download" onClick={() => downloadZeevDocument(row.ticket!.id, firstDocument)}>Baixar</button></div> : <span className="tax-badge">Não localizado</span>}</td><td>{row.ticket?.status || "Pendente"}</td><td>{row.ticket?.documents?.length ? row.ticket.documents.map((document, index) => <span key={document.url}>{index ? " · " : ""}<a href={document.url} target="_blank" rel="noreferrer">{document.name}</a></span>) : "—"}</td></tr>; })}</tbody><tfoot><tr><td colSpan={9}>Subtotal da competência</td><td>{brl.format(energyRows.reduce((sum, row) => sum + row.value, 0))}</td><td colSpan={3}></td></tr></tfoot></table></div> : <div className="tax-source-empty"><Calculator /><b>Sem movimento de Energia</b><span>Nenhum lançamento foi encontrado na conta 4.2.1.02.04.01 para os filtros selecionados.</span></div>}
            </>}
          </>}
        </>}
      </section>
    </section>
  );
}
