"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Download, RefreshCw, Search } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { applyRaizWorkbookStyle } from "@/lib/export-workbook-style";

type CompanyOption = { code: string; name: string };
type BalanceRow = { reduced: string; account: string; description: string; closingBalance: number };
type AccountingEntry = { id: string; date: string; account: string; accountName: string; value: number; nature: string };
type DivergentEntry = AccountingEntry & { companyCode: string; companyName: string; missingCompany: string; side: "Ativo a receber" | "Passivo a pagar"; crossing: string; reason: string; crossingDifference: number };
type Nature = "Mútuos" | "Rateio CSC" | "Almoxarifado" | "Transações individuais";
type AnalysisRow = {
  id: string;
  nature: Nature;
  creditorCode: string;
  creditorName: string;
  debtorCode: string;
  debtorName: string;
  receivableAccount: string;
  receivableReduced: string;
  receivableBalance: number;
  payableAccount: string;
  payableReduced: string;
  payableBalance: number;
  difference: number;
  status: "Conciliado" | "Divergente" | "Conta a receber ausente" | "Conta a pagar ausente" | "Contas ausentes";
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const tolerance = 1.0;
const holdingCode = "1";
const normalizeCode = (value: string) => String(Number(value));

const mutualReceivableByCounterparty: Record<string, string> = {
  "1": "1.2.1.01.01.07", "2": "1.2.1.01.01.01", "3": "1.2.1.01.01.19", "4": "1.2.1.01.01.03",
  "5": "1.2.1.01.01.09", "6": "1.2.1.01.01.06", "8": "1.2.1.01.01.11", "9": "1.2.1.01.01.12",
  "10": "1.2.1.01.01.02", "11": "1.2.1.01.01.20", "12": "1.2.1.01.01.21", "13": "1.2.1.01.01.22",
  "14": "1.2.1.01.01.23", "16": "1.2.1.01.01.29", "17": "1.2.1.01.01.30", "18": "1.2.1.01.01.34",
  "19": "1.2.1.01.01.35", "20": "1.2.1.01.01.36", "21": "1.2.1.01.01.37", "22": "1.2.1.01.01.38",
  "23": "1.2.1.01.01.39", "24": "1.2.1.01.01.40", "25": "1.2.1.01.01.31", "26": "1.2.1.01.01.41",
  "27": "1.2.1.01.01.42", "28": "1.2.1.01.01.43", "29": "1.2.1.01.01.46", "30": "1.2.1.01.01.47",
};

const mutualPayableByCounterparty: Record<string, string[]> = {
  "1": ["2.3.1.03.01.02"], "2": ["2.3.1.03.01.07"], "3": ["2.3.1.03.01.17"],
  "4": ["2.3.1.03.01.10", "2.3.1.03.02.02"], "5": ["2.3.1.03.01.08"], "6": ["2.3.1.03.01.09"],
  "8": ["2.3.1.03.01.14"], "9": ["2.3.1.03.01.15"], "10": ["2.3.1.03.01.03"], "11": ["2.3.1.03.01.18"],
  "12": ["2.3.1.03.01.19"], "13": ["2.3.1.03.01.20"], "14": ["2.3.1.03.01.21"], "16": ["2.3.1.03.01.27"],
  "17": ["2.3.1.03.01.28"], "18": ["2.3.1.03.01.32"], "19": ["2.3.1.03.01.33"], "20": ["2.3.1.03.01.34"],
  "21": ["2.3.1.03.01.35"], "22": ["2.3.1.03.01.36"], "23": ["2.3.1.03.01.37"], "24": ["2.3.1.03.01.38"],
  "25": ["2.1.9.01.03.09", "2.3.1.03.01.29"], "26": ["2.3.1.03.01.39"], "27": ["2.3.1.03.01.44"],
  "28": ["2.3.1.03.01.45"], "29": ["2.3.1.03.01.48"], "30": ["2.3.1.03.01.49"],
};

const holdingRules: Array<{ nature: Nature; receivablePrefix: string; payableAccount: string }> = [
  { nature: "Rateio CSC", receivablePrefix: "1.1.2.03.04", payableAccount: "2.1.7.01.02.07" },
  { nature: "Almoxarifado", receivablePrefix: "1.1.2.03.06", payableAccount: "2.1.7.01.02.15" },
  { nature: "Transações individuais", receivablePrefix: "1.1.2.03.05", payableAccount: "2.1.7.01.02.16" },
];
const mutualReceivableAccounts = new Set(Object.values(mutualReceivableByCounterparty));
const mutualPayableAccounts = new Set(Object.values(mutualPayableByCounterparty).flat());
const holdingPayableAccounts = new Set(holdingRules.map((rule) => rule.payableAccount));
const isIntercompanyAccount = (account: string) => mutualReceivableAccounts.has(account) || mutualPayableAccounts.has(account) || holdingPayableAccounts.has(account) || holdingRules.some((rule) => account.startsWith(`${rule.receivablePrefix}.`));
const intercompanyAccountNature = (account: string) => mutualReceivableAccounts.has(account) || holdingRules.some((rule) => account.startsWith(`${rule.receivablePrefix}.`)) ? "Ativo intercompany" : "Passivo intercompany";

function exact(rows: BalanceRow[], account: string) { return rows.find((row) => row.account === account); }
function sumAccounts(rows: BalanceRow[], accounts: string[]) {
  const found = accounts.map((account) => exact(rows, account)).filter(Boolean) as BalanceRow[];
  return { found, value: found.reduce((sum, row) => sum + row.closingBalance, 0), reduced: found.map((row) => row.reduced).filter(Boolean).join(" + ") };
}
function holdingReceivableAccount(prefix: string, counterparty: string) { return `${prefix}.${String(Number(counterparty)).padStart(2, "0")}`; }
function status(receivableFound: boolean, payableFound: boolean, difference: number): AnalysisRow["status"] {
  if (!receivableFound && !payableFound) return "Contas ausentes";
  if (!receivableFound) return "Conta a receber ausente";
  if (!payableFound) return "Conta a pagar ausente";
  return Math.abs(difference) <= tolerance ? "Conciliado" : "Divergente";
}
function crossingDiagnosis(row: AnalysisRow) {
  if (row.status === "Conta a receber ausente") return `${row.debtorCode} — ${row.debtorName} possui saldo no passivo, mas ${row.creditorCode} — ${row.creditorName} não possui o ativo correspondente.`;
  if (row.status === "Conta a pagar ausente") return `${row.creditorCode} — ${row.creditorName} possui saldo no ativo, mas ${row.debtorCode} — ${row.debtorName} não possui o passivo correspondente.`;
  if (row.status === "Contas ausentes") return "As contas esperadas não foram localizadas nas duas empresas.";
  if (row.difference > tolerance) return `${row.creditorCode} — ${row.creditorName} possui valor a mais no ativo ou falta contrapartida no passivo de ${row.debtorCode} — ${row.debtorName}.`;
  if (row.difference < -tolerance) return `${row.debtorCode} — ${row.debtorName} possui valor a mais no passivo ou falta contrapartida no ativo de ${row.creditorCode} — ${row.creditorName}.`;
  return "Ativo e passivo estão conciliados.";
}

export default function IntercompanyAnalysis({ companies, selectedCompanyCode, competence, accessToken }: { companies: CompanyOption[]; selectedCompanyCode: string; competence: string; accessToken: string }) {
  const [balances, setBalances] = useState<Record<string, BalanceRow[]>>({});
  const [updatedCompetence, setUpdatedCompetence] = useState("");
  const [updatedCompanyCode, setUpdatedCompanyCode] = useState("");
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [results, setResults] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [nature, setNature] = useState<"Todas" | Nature>("Todas");
  const [search, setSearch] = useState("");
  const [selectedRow, setSelectedRow] = useState<AnalysisRow | null>(null);
  const [entryScope, setEntryScope] = useState<"single" | "all" | null>(null);
  const [divergentEntries, setDivergentEntries] = useState<DivergentEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const normalizedCompanies = useMemo(() => Array.from(new Map(companies.map((item) => ({ ...item, code: normalizeCode(item.code) })).filter((item) => item.code !== "0").map((item) => [item.code, item])).values()), [companies]);
  const selectedCode = normalizeCode(selectedCompanyCode || "0");
  const selectedCompany = normalizedCompanies.find((item) => item.code === selectedCode);
  const isUpdatedForSelection = updatedCompetence === competence && updatedCompanyCode === selectedCode;
  const intercompanyAccounts = useMemo(() => {
    if (!selectedCompany) return [];
    return (balances[selectedCompany.code] || []).filter((row) => isIntercompanyAccount(row.account)).map((row) => ({ ...row, companyCode: selectedCompany.code, companyName: selectedCompany.name, nature: intercompanyAccountNature(row.account) })).sort((a, b) => a.account.localeCompare(b.account));
  }, [balances, selectedCompany]);
  const sourceTotals = useMemo(() => intercompanyAccounts.reduce((totals, row) => {
    if (row.nature === "Ativo intercompany") totals.asset += row.closingBalance;
    else totals.liability += row.closingBalance;
    totals.net += row.closingBalance;
    return totals;
  }, { asset: 0, liability: 0, net: 0 }), [intercompanyAccounts]);

  async function updateBalances() {
    setLoading(true); setUpdatedCompetence(""); setUpdatedCompanyCode(""); setHasAnalyzed(false); setEntryScope(null); setSelectedRow(null); setDivergentEntries([]); setMessage(""); setResults([]);
    const loaded: Record<string, BalanceRow[]> = {};
    const failures: string[] = [];
    for (let index = 0; index < normalizedCompanies.length; index += 5) {
      const batch = normalizedCompanies.slice(index, index + 5);
      const responses = await Promise.all(batch.map(async (company) => {
        try {
          const response = await fetch(`/api/totvs/trial-balance?company=${company.code}&competence=${competence}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Falha ao consultar o balancete.");
          return { company, rows: (payload.rows || []) as BalanceRow[] };
        } catch (error) { return { company, error: (error as Error).message }; }
      }));
      responses.forEach((item) => { if ("rows" in item) loaded[item.company.code] = item.rows || []; else failures.push(`${item.company.code} — ${item.company.name}`); });
    }
    setBalances(loaded); setLoading(false);
    const count = Object.keys(loaded).length;
    if (count > 0) { setUpdatedCompetence(competence); setUpdatedCompanyCode(selectedCode); }
    setMessage(failures.length ? `${count} balancete(s) carregado(s). Não foi possível consultar: ${failures.join(", ")}.` : `${count} balancete(s) carregado(s) para ${competence.slice(5)}/${competence.slice(0, 4)}.`);
  }

  function analyze() {
    if (!Object.keys(balances).length || !isUpdatedForSelection || !selectedCompany) return;
    setAnalyzing(true);
    const output: AnalysisRow[] = [];
    const companyMap = new Map(normalizedCompanies.map((item) => [item.code, item]));
    const available = normalizedCompanies.filter((item) => balances[item.code]);

    const appendMutual = (creditor: CompanyOption, debtor: CompanyOption) => {
      if (creditor.code === debtor.code) return;
      const receivableAccount = mutualReceivableByCounterparty[debtor.code];
      const payableAccounts = mutualPayableByCounterparty[creditor.code] || [];
      if (!receivableAccount || !payableAccounts.length) return;
      const receivable = exact(balances[creditor.code], receivableAccount);
      const payable = sumAccounts(balances[debtor.code], payableAccounts);
      if (!receivable && !payable.found.length) return;
      const difference = (receivable?.closingBalance || 0) + payable.value;
      output.push({ id: `mutuo-${creditor.code}-${debtor.code}`, nature: "Mútuos", creditorCode: creditor.code, creditorName: creditor.name, debtorCode: debtor.code, debtorName: debtor.name, receivableAccount, receivableReduced: receivable?.reduced || "", receivableBalance: receivable?.closingBalance || 0, payableAccount: payableAccounts.join(" + "), payableReduced: payable.reduced, payableBalance: payable.value, difference, status: status(Boolean(receivable), payable.found.length > 0, difference) });
    };

    available.filter((item) => item.code !== selectedCode).forEach((counterparty) => {
      appendMutual(selectedCompany, counterparty);
      appendMutual(counterparty, selectedCompany);
    });

    const holding = companyMap.get(holdingCode);
    if (holding && balances[holdingCode]) holdingRules.forEach((rule) => available.filter((item) => item.code !== holdingCode && (selectedCode === holdingCode || item.code === selectedCode)).forEach((counterparty) => {
      const receivableAccount = holdingReceivableAccount(rule.receivablePrefix, counterparty.code);
      const receivable = exact(balances[holdingCode], receivableAccount);
      const payable = exact(balances[counterparty.code], rule.payableAccount);
      if (!receivable && !payable) return;
      const difference = (receivable?.closingBalance || 0) + (payable?.closingBalance || 0);
      output.push({ id: `${rule.nature}-${counterparty.code}`, nature: rule.nature, creditorCode: holdingCode, creditorName: holding.name, debtorCode: counterparty.code, debtorName: counterparty.name, receivableAccount, receivableReduced: receivable?.reduced || "", receivableBalance: receivable?.closingBalance || 0, payableAccount: rule.payableAccount, payableReduced: payable?.reduced || "", payableBalance: payable?.closingBalance || 0, difference, status: status(Boolean(receivable), Boolean(payable), difference) });
    }));
    setResults(output); setAnalyzing(false);
    setHasAnalyzed(true);
    const treatmentCount = output.filter((row) => row.status !== "Conciliado").length;
    setMessage(treatmentCount ? `${treatmentCount} divergência(s) encontrada(s) para tratamento.` : "Nenhuma divergência encontrada. Ativo e passivo estão conciliados.");
  }

  const compareEntries = (row: AnalysisRow, creditorRows: AccountingEntry[], debtorRows: AccountingEntry[]) => {
    const payableAccounts = row.payableAccount.split(" + ").map((account) => account.trim());
    const receivables = creditorRows.filter((entry) => entry.account === row.receivableAccount);
    const payables = debtorRows.filter((entry) => payableAccounts.includes(entry.account));
    const matchedPayables = new Set<number>();
    const unmatchedReceivables = receivables.filter((entry) => {
      const match = payables.findIndex((candidate, index) => !matchedPayables.has(index) && candidate.date === entry.date && Math.abs(candidate.value + entry.value) <= tolerance);
      if (match >= 0) { matchedPayables.add(match); return false; }
      return true;
    });
    const crossing = `${row.creditorCode} × ${row.debtorCode} · ${row.nature}`;
    return [
      ...unmatchedReceivables.map((entry) => ({ ...entry, companyCode: row.creditorCode, companyName: row.creditorName, missingCompany: `${row.debtorCode} — ${row.debtorName}`, side: "Ativo a receber" as const, crossing, crossingDifference: row.difference, reason: `${row.creditorCode} — ${row.creditorName} possui este lançamento no ativo; não foi encontrada contrapartida equivalente no passivo de ${row.debtorCode} — ${row.debtorName}. Ativo + Passivo = ${money.format(row.difference)}.` })),
      ...payables.filter((_, index) => !matchedPayables.has(index)).map((entry) => ({ ...entry, companyCode: row.debtorCode, companyName: row.debtorName, missingCompany: `${row.creditorCode} — ${row.creditorName}`, side: "Passivo a pagar" as const, crossing, crossingDifference: row.difference, reason: `${row.debtorCode} — ${row.debtorName} possui este lançamento no passivo; não foi encontrada contrapartida equivalente no ativo de ${row.creditorCode} — ${row.creditorName}. Ativo + Passivo = ${money.format(row.difference)}.` })),
    ];
  };

  const loadAccountingEntries = async (company: string) => {
    const response = await fetch(`/api/totvs/accounting?company=${company}&competence=${competence}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível consultar os lançamentos contábeis.");
    return (payload.rows || []) as AccountingEntry[];
  };

  async function identifyDivergentEntries(row: AnalysisRow) {
    setSelectedRow(row); setEntryScope("single"); setLoadingEntries(true); setDivergentEntries([]);
    try {
      const [creditorRows, debtorRows] = await Promise.all([loadAccountingEntries(row.creditorCode), loadAccountingEntries(row.debtorCode)]);
      const output = compareEntries(row, creditorRows, debtorRows).sort((a, b) => a.date.localeCompare(b.date) || Math.abs(b.value) - Math.abs(a.value));
      setDivergentEntries(output);
    } catch (error) { setMessage((error as Error).message); }
    finally { setLoadingEntries(false); }
  }

  async function identifyAllDivergentEntries() {
    const divergentRows = results.filter((row) => row.status !== "Conciliado");
    if (!divergentRows.length) return;
    setSelectedRow(null); setEntryScope("all"); setLoadingEntries(true); setDivergentEntries([]);
    try {
      const companyCodes = Array.from(new Set(divergentRows.flatMap((row) => [row.creditorCode, row.debtorCode])));
      const cache: Record<string, AccountingEntry[]> = {};
      for (let index = 0; index < companyCodes.length; index += 5) {
        const batch = companyCodes.slice(index, index + 5);
        const loaded = await Promise.all(batch.map(async (company) => ({ company, rows: await loadAccountingEntries(company) })));
        loaded.forEach((item) => { cache[item.company] = item.rows; });
      }
      const output = divergentRows.flatMap((row) => compareEntries(row, cache[row.creditorCode] || [], cache[row.debtorCode] || []))
        .sort((a, b) => a.crossing.localeCompare(b.crossing) || a.date.localeCompare(b.date) || Math.abs(b.value) - Math.abs(a.value));
      setDivergentEntries(output);
      setMessage(`${output.length} lançamento(s) divergente(s) identificado(s) nos cruzamentos que requerem tratamento.`);
    } catch (error) { setMessage((error as Error).message); }
    finally { setLoadingEntries(false); }
  }

  const summary = useMemo(() => ({
    treatment: results.filter((row) => row.status !== "Conciliado").length,
    divergent: results.filter((row) => row.status === "Divergente").length,
    missing: results.filter((row) => row.status.includes("ausente") || row.status === "Contas ausentes").length,
    difference: results.filter((row) => row.status !== "Conciliado").reduce((sum, row) => sum + Math.abs(row.difference), 0),
  }), [results]);
  const filtered = useMemo(() => results.filter((row) => row.status !== "Conciliado" && (nature === "Todas" || row.nature === nature) && (!search.trim() || `${row.creditorCode} ${row.creditorName} ${row.debtorCode} ${row.debtorName} ${row.receivableAccount} ${row.payableAccount}`.toLowerCase().includes(search.toLowerCase()))), [results, nature, search]);

  function exportResults() {
    if (!results.length) return;
    const rows = results.filter((row) => row.status !== "Conciliado").map((row) => ({ Natureza: row.nature, "Empresa credora": `${row.creditorCode} — ${row.creditorName}`, "Empresa devedora": `${row.debtorCode} — ${row.debtorName}`, "Conta a receber": row.receivableAccount, "Reduzido a receber": row.receivableReduced, "Saldo a receber": row.receivableBalance, "Conta a pagar": row.payableAccount, "Reduzido a pagar": row.payableReduced, "Saldo a pagar": row.payableBalance, "Ativo + Passivo": row.difference, Situação: row.status, "Motivo da diferença": crossingDiagnosis(row) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.filter((row) => row.Situação !== "Conciliado")), "Divergências");
    (["Mútuos", "Rateio CSC", "Almoxarifado", "Transações individuais"] as Nature[]).forEach((item) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.filter((row) => row.Natureza === item)), item.slice(0, 31)));
    applyRaizWorkbookStyle(workbook);
    XLSX.writeFile(workbook, `Intercompany_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }

  return <section className={`panel intercompany-panel ${loading || analyzing ? "is-processing" : ""}`}>
    {(loading || analyzing) && <div className="intercompany-processing"><RefreshCw className="spin" /><b>{loading ? "Atualizando Intercompany" : "Analisando Intercompany"}</b><span>Aguarde a conclusão da etapa.</span></div>}
    <div className="intercompany-heading"><div><h2>Intercompany</h2><p>Análise da empresa selecionada contra os saldos das contrapartes.</p></div><div className="intercompany-actions"><button className={`secondary ${isUpdatedForSelection ? "source-loaded" : ""}`} onClick={() => void updateBalances()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} />{loading ? "Atualizando Intercompany" : "Atualizar Intercompany"}</button><button className="primary" onClick={analyze} disabled={!isUpdatedForSelection || analyzing}><Building2 />{analyzing ? "Analisando Intercompany" : "Analisar Intercompany"}</button><button className="secondary" onClick={() => void identifyAllDivergentEntries()} disabled={!results.some((row) => row.status !== "Conciliado") || loadingEntries}><Search />{loadingEntries && entryScope === "all" ? "Identificando..." : "Identificar"}</button><button className="secondary" onClick={exportResults} disabled={!results.length}><Download />Exportar análise</button></div></div>
    {message && <div className="notice">{message}</div>}
    {isUpdatedForSelection && !hasAnalyzed && (intercompanyAccounts.length ? <div className="intercompany-source-view"><div className="intercompany-source-heading"><b>Contas Intercompany de {selectedCompany?.code} — {selectedCompany?.name}</b><span>{intercompanyAccounts.length} conta(s) · competência {competence.slice(5)}/{competence.slice(0, 4)}</span></div><div className="intercompany-source-summary"><article><span>Total do ativo</span><b>{money.format(sourceTotals.asset)}</b></article><article><span>Total do passivo</span><b>{money.format(sourceTotals.liability)}</b></article><article><span>Ativo + Passivo</span><b className={Math.abs(sourceTotals.net) > tolerance ? "negative" : ""}>{money.format(sourceTotals.net)}</b></article></div><div className="table-wrap intercompany-source-table"><table><thead><tr><th>Natureza</th><th>Conta contábil</th><th>Cód. reduzido</th><th>Descrição</th><th>Saldo final</th></tr></thead><tbody>{intercompanyAccounts.map((row, index) => <tr key={`${row.companyCode}-${row.account}-${index}`}><td>{row.nature}</td><td>{row.account}</td><td>{row.reduced || "—"}</td><td>{row.description || "—"}</td><td className={row.closingBalance < 0 ? "negative" : ""}><b>{money.format(row.closingBalance)}</b></td></tr>)}</tbody></table></div></div> : <div className="intercompany-entry-empty">Nenhuma conta Intercompany foi localizada no balancete da empresa selecionada.</div>)}
    {hasAnalyzed && <><div className="intercompany-summary intercompany-summary-divergences"><article className={summary.treatment ? "has-warning" : ""}><span>Total para tratamento</span><b>{summary.treatment}</b></article><article className={summary.divergent ? "has-warning" : ""}><span>Divergências de saldo</span><b>{summary.divergent}</b></article><article className={summary.missing ? "has-warning" : ""}><span>Contas ausentes</span><b>{summary.missing}</b></article><article><span>Diferença absoluta</span><b>{money.format(summary.difference)}</b></article></div>
      <div className="intercompany-toolbar"><label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar empresa ou conta" /></label><select value={nature} onChange={(event) => setNature(event.target.value as typeof nature)}><option>Todas</option><option>Mútuos</option><option>Rateio CSC</option><option>Almoxarifado</option><option>Transações individuais</option></select><span>{filtered.length} divergência(s)</span></div>
      <div className="table-wrap intercompany-table"><table><thead><tr><th>Natureza</th><th>Contraparte</th><th>Ativo a receber</th><th>Passivo a pagar</th><th>Ativo + Passivo</th><th>Situação</th><th>Motivo da diferença</th><th>Lançamentos</th></tr></thead><tbody>{filtered.length ? filtered.map((row) => { const counterpart = row.creditorCode === selectedCode ? { code: row.debtorCode, name: row.debtorName } : { code: row.creditorCode, name: row.creditorName }; return <tr key={row.id}><td>{row.nature}</td><td><b>{counterpart.code}</b> — {counterpart.name}</td><td><div className="intercompany-account-cell"><span>{row.receivableAccount}</span><small>Red. {row.receivableReduced || "—"}</small><b>{money.format(row.receivableBalance)}</b></div></td><td><div className="intercompany-account-cell"><span>{row.payableAccount}</span><small>Red. {row.payableReduced || "—"}</small><b>{money.format(row.payableBalance)}</b></div></td><td className={Math.abs(row.difference) > tolerance ? "negative" : ""}><b>{money.format(row.difference)}</b></td><td><span className={`intercompany-status ${row.status === "Conciliado" ? "ok" : "warning"}`}>{row.status === "Conciliado" ? <CheckCircle2 /> : <AlertTriangle />}{row.status}</span></td><td className="intercompany-diagnosis">{crossingDiagnosis(row)}</td><td><button className="intercompany-detail-button" onClick={() => void identifyDivergentEntries(row)} disabled={row.status === "Conciliado" || loadingEntries}>{loadingEntries && selectedRow?.id === row.id ? "Buscando..." : "Identificar"}</button></td></tr>; }) : <tr><td colSpan={8} className="empty-row">Nenhuma divergência encontrada para os filtros selecionados.</td></tr>}</tbody></table></div>
      {entryScope && <div className="intercompany-entry-panel"><div className="intercompany-entry-heading"><div><b>Lançamentos divergentes</b><span>{entryScope === "all" ? "Todos os cruzamentos que requerem tratamento" : `${selectedRow?.creditorCode} × ${selectedRow?.debtorCode} · ${selectedRow?.nature}`}</span></div><button onClick={() => { setEntryScope(null); setSelectedRow(null); setDivergentEntries([]); }}>Fechar</button></div>{loadingEntries ? <div className="intercompany-entry-empty"><RefreshCw className="spin" />Identificando lançamentos sem contrapartida...</div> : divergentEntries.length ? <div className="table-wrap intercompany-entry-table"><table><thead><tr><th>Cruzamento</th><th>Lado</th><th>Empresa com lançamento</th><th>Empresa sem lançamento</th><th>Data</th><th>Conta</th><th>Descrição</th><th>Valor</th><th>Ativo + Passivo</th><th>Motivo</th></tr></thead><tbody>{divergentEntries.map((entry, index) => <tr key={`${entry.companyCode}-${entry.id}-${index}`}><td>{entry.crossing}</td><td><b>{entry.side}</b></td><td><b>{entry.companyCode}</b> — {entry.companyName}</td><td>{entry.missingCompany}</td><td>{entry.date || "—"}</td><td>{entry.account}</td><td>{entry.accountName}</td><td className={entry.value < 0 ? "negative" : ""}><b>{money.format(entry.value)}</b></td><td className={Math.abs(entry.crossingDifference) > tolerance ? "negative" : ""}><b>{money.format(entry.crossingDifference)}</b></td><td className="intercompany-entry-reason">{entry.reason}</td></tr>)}</tbody></table></div> : <div className="intercompany-entry-empty">Nenhum lançamento individual sem contrapartida foi localizado nessa consulta.</div>}</div>}</>}
    {!isUpdatedForSelection && !loading && <div className="intercompany-empty"><Building2 /><b>Atualize Intercompany para iniciar</b><span>Será analisado o balancete da empresa selecionada e os saldos correspondentes nas demais empresas.</span></div>}
  </section>;
}
