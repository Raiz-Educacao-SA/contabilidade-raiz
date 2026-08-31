"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Download, RefreshCw, Search } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { applyRaizWorkbookStyle } from "@/lib/export-workbook-style";

type CompanyOption = { code: string; name: string };
type BalanceRow = { reduced: string; account: string; description: string; movement: number };
type AccountingEntry = {
  id: string;
  branch: string;
  entryId: string;
  partId: string;
  date: string;
  account: string;
  reduced: string;
  accountName: string;
  value: number;
  complement: string;
  document: string;
  sourceSystem: string;
  costCenter: string;
};
type IdentifiedEntry = AccountingEntry & {
  companyCode: string;
  companyName: string;
  side: "Ativo a receber" | "Passivo a pagar";
  matchStatus: "Com contrapartida" | "Sem contrapartida";
};
type Nature = "Mútuo" | "Almoxarifado" | "Transação";
type AnalysisRow = {
  id: string;
  nature: Nature;
  creditorCode: string;
  creditorName: string;
  debtorCode: string;
  debtorName: string;
  receivableAccount: string;
  receivableReduced: string;
  receivableMovement: number;
  payableAccount: string;
  payableReduced: string;
  payableMovement: number;
  difference: number;
  status: "Conciliado" | "Divergente" | "Conta a receber ausente" | "Conta a pagar ausente" | "Contas ausentes";
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const tolerance = 1;
const hasMonthlyMovement = (value: number) => Math.abs(Number(value) || 0) >= 0.005;
const holdingCode = "1";
const normalizeCode = (value: string) => String(Number(value));
const intercompanyGroups: Nature[] = ["Mútuo", "Almoxarifado", "Transação"];

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
  { nature: "Almoxarifado", receivablePrefix: "1.1.2.03.06", payableAccount: "2.1.7.01.02.15" },
  { nature: "Transação", receivablePrefix: "1.1.2.03.05", payableAccount: "2.1.7.01.02.16" },
];
const mutualReceivableAccounts = new Set(Object.values(mutualReceivableByCounterparty));
const mutualPayableAccounts = new Set(Object.values(mutualPayableByCounterparty).flat());

const intercompanyAccountGroup = (account: string): Nature | null => {
  if (mutualReceivableAccounts.has(account) || mutualPayableAccounts.has(account)) return "Mútuo";
  return holdingRules.find((rule) => rule.payableAccount === account || account.startsWith(`${rule.receivablePrefix}.`))?.nature || null;
};
const isIntercompanyAccount = (account: string) => Boolean(intercompanyAccountGroup(account));
const intercompanyAccountNature = (account: string) => mutualReceivableAccounts.has(account) || holdingRules.some((rule) => account.startsWith(`${rule.receivablePrefix}.`)) ? "Ativo intercompany" : "Passivo intercompany";

function exact(rows: BalanceRow[], account: string) {
  return rows.find((row) => row.account === account);
}

function sumAccounts(rows: BalanceRow[], accounts: string[]) {
  const found = accounts.map((account) => exact(rows, account)).filter(Boolean) as BalanceRow[];
  const moving = found.filter((row) => hasMonthlyMovement(row.movement));
  return { found, moving, value: moving.reduce((sum, row) => sum + row.movement, 0), reduced: moving.map((row) => row.reduced).filter(Boolean).join(" + ") };
}

function holdingReceivableAccount(prefix: string, counterparty: string) {
  return `${prefix}.${String(Number(counterparty)).padStart(2, "0")}`;
}

function analysisStatus(receivableFound: boolean, payableFound: boolean, difference: number): AnalysisRow["status"] {
  if (!receivableFound && !payableFound) return "Contas ausentes";
  if (!receivableFound) return "Conta a receber ausente";
  if (!payableFound) return "Conta a pagar ausente";
  return Math.abs(difference) <= tolerance ? "Conciliado" : "Divergente";
}

function crossingDiagnosis(row: AnalysisRow) {
  if (row.status === "Conta a receber ausente") return `${row.debtorCode} — ${row.debtorName} possui movimento no passivo, mas ${row.creditorCode} — ${row.creditorName} não possui o movimento no ativo correspondente.`;
  if (row.status === "Conta a pagar ausente") return `${row.creditorCode} — ${row.creditorName} possui movimento no ativo, mas ${row.debtorCode} — ${row.debtorName} não possui o movimento no passivo correspondente.`;
  if (row.status === "Contas ausentes") return "As contas esperadas não foram localizadas nas duas empresas.";
  if (row.difference > tolerance) return `O movimento do ativo de ${row.creditorCode} — ${row.creditorName} supera a contrapartida do passivo de ${row.debtorCode} — ${row.debtorName}.`;
  if (row.difference < -tolerance) return `O movimento do passivo de ${row.debtorCode} — ${row.debtorName} supera a contrapartida do ativo de ${row.creditorCode} — ${row.creditorName}.`;
  return "Os movimentos mensais do ativo e do passivo estão conciliados.";
}

function accountsFromRow(row: AnalysisRow) {
  return { receivable: [row.receivableAccount], payable: row.payableAccount.split(" + ").map((account) => account.trim()).filter(Boolean) };
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
  const [search, setSearch] = useState("");
  const [selectedRow, setSelectedRow] = useState<AnalysisRow | null>(null);
  const [identifiedEntries, setIdentifiedEntries] = useState<IdentifiedEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const normalizedCompanies = useMemo(() => Array.from(new Map(companies.map((item) => ({ ...item, code: normalizeCode(item.code) })).filter((item) => item.code !== "0").map((item) => [item.code, item])).values()), [companies]);
  const selectedCode = normalizeCode(selectedCompanyCode || "0");
  const selectedCompany = normalizedCompanies.find((item) => item.code === selectedCode);
  const isUpdatedForSelection = updatedCompetence === competence && updatedCompanyCode === selectedCode;

  const intercompanyAccounts = useMemo(() => {
    if (!selectedCompany) return [];
    return (balances[selectedCompany.code] || []).filter((row) => isIntercompanyAccount(row.account) && hasMonthlyMovement(row.movement)).map((row) => ({ ...row, companyCode: selectedCompany.code, companyName: selectedCompany.name, group: intercompanyAccountGroup(row.account) as Nature, nature: intercompanyAccountNature(row.account) })).sort((a, b) => a.group.localeCompare(b.group) || a.account.localeCompare(b.account));
  }, [balances, selectedCompany]);

  const sourceGroups = useMemo(() => intercompanyGroups.map((group) => {
    const rows = intercompanyAccounts.filter((row) => row.group === group);
    return { group, rows, movement: rows.reduce((total, row) => total + row.movement, 0) };
  }), [intercompanyAccounts]);

  async function updateBalances() {
    setLoading(true); setUpdatedCompetence(""); setUpdatedCompanyCode(""); setHasAnalyzed(false); setSelectedRow(null); setIdentifiedEntries([]); setMessage(""); setResults([]);
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
    setAnalyzing(true); setSelectedRow(null); setIdentifiedEntries([]);
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
      const receivableMovement = receivable?.movement || 0;
      if (!hasMonthlyMovement(receivableMovement) && !hasMonthlyMovement(payable.value)) return;
      const difference = receivableMovement + payable.value;
      output.push({ id: `mutuo-${creditor.code}-${debtor.code}`, nature: "Mútuo", creditorCode: creditor.code, creditorName: creditor.name, debtorCode: debtor.code, debtorName: debtor.name, receivableAccount, receivableReduced: hasMonthlyMovement(receivableMovement) ? receivable?.reduced || "" : "", receivableMovement, payableAccount: payable.moving.length ? payable.moving.map((row) => row.account).join(" + ") : payableAccounts.join(" + "), payableReduced: payable.reduced, payableMovement: payable.value, difference, status: analysisStatus(Boolean(receivable), payable.found.length > 0, difference) });
    };
    available.filter((item) => item.code !== selectedCode).forEach((counterparty) => { appendMutual(selectedCompany, counterparty); appendMutual(counterparty, selectedCompany); });
    const holding = companyMap.get(holdingCode);
    if (holding && balances[holdingCode]) holdingRules.forEach((rule) => available.filter((item) => item.code !== holdingCode && (selectedCode === holdingCode || item.code === selectedCode)).forEach((counterparty) => {
      const receivableAccount = holdingReceivableAccount(rule.receivablePrefix, counterparty.code);
      const receivable = exact(balances[holdingCode], receivableAccount);
      const payable = exact(balances[counterparty.code], rule.payableAccount);
      const receivableMovement = receivable?.movement || 0;
      const payableMovement = payable?.movement || 0;
      if (!hasMonthlyMovement(receivableMovement) && !hasMonthlyMovement(payableMovement)) return;
      const difference = receivableMovement + payableMovement;
      output.push({ id: `${rule.nature}-${counterparty.code}`, nature: rule.nature, creditorCode: holdingCode, creditorName: holding.name, debtorCode: counterparty.code, debtorName: counterparty.name, receivableAccount, receivableReduced: hasMonthlyMovement(receivableMovement) ? receivable?.reduced || "" : "", receivableMovement, payableAccount: rule.payableAccount, payableReduced: hasMonthlyMovement(payableMovement) ? payable?.reduced || "" : "", payableMovement, difference, status: analysisStatus(Boolean(receivable), Boolean(payable), difference) });
    }));
    setResults(output); setAnalyzing(false); setHasAnalyzed(true);
    const treatmentCount = output.filter((row) => row.status !== "Conciliado").length;
    setMessage(treatmentCount ? `${treatmentCount} divergência(s) de movimento encontrada(s) para tratamento.` : "Nenhuma divergência encontrada. Os movimentos mensais estão conciliados.");
  }

  async function loadAccountingEntries(company: string, accounts: string[]) {
    const query = new URLSearchParams({ company, competence, accounts: accounts.join(",") });
    const response = await fetch(`/api/totvs/intercompany/entries?${query.toString()}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível consultar os lançamentos contábeis.");
    return (payload.rows || []) as AccountingEntry[];
  }

  function compareEntries(row: AnalysisRow, creditorRows: AccountingEntry[], debtorRows: AccountingEntry[]) {
    const matchedReceivables = new Set<number>();
    const matchedPayables = new Set<number>();
    creditorRows.forEach((entry, receivableIndex) => {
      const payableIndex = debtorRows.findIndex((candidate, index) => !matchedPayables.has(index) && candidate.date === entry.date && Math.abs(candidate.value + entry.value) <= tolerance);
      if (payableIndex >= 0) { matchedReceivables.add(receivableIndex); matchedPayables.add(payableIndex); }
    });
    return [
      ...creditorRows.map((entry, index) => ({ ...entry, companyCode: row.creditorCode, companyName: row.creditorName, side: "Ativo a receber" as const, matchStatus: matchedReceivables.has(index) ? "Com contrapartida" as const : "Sem contrapartida" as const })),
      ...debtorRows.map((entry, index) => ({ ...entry, companyCode: row.debtorCode, companyName: row.debtorName, side: "Passivo a pagar" as const, matchStatus: matchedPayables.has(index) ? "Com contrapartida" as const : "Sem contrapartida" as const })),
    ];
  }

  async function identifyDivergentEntries(row: AnalysisRow) {
    const accounts = accountsFromRow(row);
    setSelectedRow(row); setLoadingEntries(true); setIdentifiedEntries([]);
    try {
      const [creditorRows, debtorRows] = await Promise.all([loadAccountingEntries(row.creditorCode, accounts.receivable), loadAccountingEntries(row.debtorCode, accounts.payable)]);
      setIdentifiedEntries(compareEntries(row, creditorRows, debtorRows).sort((a, b) => a.companyCode.localeCompare(b.companyCode) || a.date.localeCompare(b.date) || a.account.localeCompare(b.account)));
    } catch (error) { setMessage((error as Error).message); }
    finally { setLoadingEntries(false); }
  }

  const summary = useMemo(() => ({ crossings: results.length, reconciled: results.filter((row) => row.status === "Conciliado").length, treatment: results.filter((row) => row.status !== "Conciliado").length, difference: results.filter((row) => row.status !== "Conciliado").reduce((sum, row) => sum + Math.abs(row.difference), 0) }), [results]);
  const groupedResults = useMemo(() => intercompanyGroups.map((group) => {
    const rows = results.filter((row) => row.nature === group);
    return { group, rows: rows.filter((row) => !search.trim() || `${row.creditorCode} ${row.creditorName} ${row.debtorCode} ${row.debtorName} ${row.receivableAccount} ${row.payableAccount}`.toLowerCase().includes(search.toLowerCase())), crossings: rows.length, reconciled: rows.filter((row) => row.status === "Conciliado").length, treatment: rows.filter((row) => row.status !== "Conciliado").length, difference: rows.filter((row) => row.status !== "Conciliado").reduce((sum, row) => sum + Math.abs(row.difference), 0) };
  }), [results, search]);
  const entryGroups = useMemo(() => selectedRow ? [
    { code: selectedRow.creditorCode, name: selectedRow.creditorName, side: "Ativo a receber", accounts: selectedRow.receivableAccount, rows: identifiedEntries.filter((entry) => entry.companyCode === selectedRow.creditorCode && entry.side === "Ativo a receber") },
    { code: selectedRow.debtorCode, name: selectedRow.debtorName, side: "Passivo a pagar", accounts: selectedRow.payableAccount, rows: identifiedEntries.filter((entry) => entry.companyCode === selectedRow.debtorCode && entry.side === "Passivo a pagar") },
  ] : [], [identifiedEntries, selectedRow]);

  function exportResults() {
    if (!results.length) return;
    const exportRows = (items: AnalysisRow[]) => items.map((row) => ({ Grupo: row.nature, "Empresa com ativo": `${row.creditorCode} — ${row.creditorName}`, "Conta a receber": row.receivableAccount, "Reduzido a receber": row.receivableReduced, "Movimento do ativo": row.receivableMovement, "Empresa com passivo": `${row.debtorCode} — ${row.debtorName}`, "Conta a pagar": row.payableAccount, "Reduzido a pagar": row.payableReduced, "Movimento do passivo": row.payableMovement, "Diferença do movimento": row.difference, Situação: row.status, Diagnóstico: crossingDiagnosis(row) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows(results)), "Conferência mensal");
    intercompanyGroups.forEach((item) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows(results.filter((row) => row.nature === item))), item));
    applyRaizWorkbookStyle(workbook);
    XLSX.writeFile(workbook, `Intercompany_${selectedCode}_${competence.replace("-", ".")}.xlsx`);
  }

  return <section className="module-panel intercompany-panel">
    <div className="intercompany-heading"><div><h2>Análise Intercompany por movimento mensal</h2><p>Mútuo, Almoxarifado e Transação são conferidos separadamente entre as empresas na competência selecionada.</p></div><div className="intercompany-actions"><button className="primary" onClick={() => void updateBalances()} disabled={loading || !selectedCompany}><RefreshCw className={loading ? "spin" : ""} />{loading ? "Atualizando..." : "Atualizar Intercompany"}</button><button onClick={analyze} disabled={!isUpdatedForSelection || analyzing}>{analyzing ? "Analisando..." : "Analisar movimentos"}</button><button onClick={exportResults} disabled={!results.length}><Download />Exportar</button></div></div>
    {message && <div className="notice">{message}</div>}
    {(loading || analyzing) && <div className="intercompany-processing"><RefreshCw className="spin" /><b>{loading ? "Consultando os balancetes..." : "Comparando os movimentos mensais..."}</b><span>Aguarde a conclusão da conferência entre as empresas.</span></div>}
    {isUpdatedForSelection && !hasAnalyzed && <div className="intercompany-source-view"><div className="intercompany-source-heading"><b>Movimentos Intercompany da empresa selecionada</b><span>{selectedCompany?.code} — {selectedCompany?.name} · {competence.slice(5)}/{competence.slice(0, 4)}</span></div><div className="intercompany-source-groups">{sourceGroups.map((section) => <section className="intercompany-source-group" key={section.group}><header><div><b>{section.group}</b><span>{section.rows.length} conta(s)</span></div><strong>{money.format(section.movement)}</strong></header><div className="table-wrap intercompany-source-table"><table><thead><tr><th>Natureza</th><th>Conta</th><th>Reduzido</th><th>Descrição</th><th>Movimento do mês</th></tr></thead><tbody>{section.rows.length ? section.rows.map((row) => <tr key={`${section.group}-${row.account}`}><td>{row.nature}</td><td><b>{row.account}</b></td><td>{row.reduced || "—"}</td><td>{row.description}</td><td className={row.movement < 0 ? "negative" : ""}><b>{money.format(row.movement)}</b></td></tr>) : <tr><td colSpan={5} className="empty-row">Nenhuma conta com movimento localizada neste grupo.</td></tr>}</tbody></table></div></section>)}</div></div>}
    {hasAnalyzed && <><div className="intercompany-summary intercompany-summary-divergences"><article><span>Cruzamentos analisados</span><b>{summary.crossings}</b></article><article><span>Movimentos conciliados</span><b>{summary.reconciled}</b></article><article className={summary.treatment ? "has-warning" : ""}><span>Divergências de movimento</span><b>{summary.treatment}</b></article><article className={summary.difference > tolerance ? "has-warning" : ""}><span>Diferença absoluta do movimento</span><b>{money.format(summary.difference)}</b></article></div><div className="intercompany-toolbar"><label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar empresa ou conta nos três grupos" /></label><span>{results.length} cruzamento(s)</span></div><div className="intercompany-group-sections">{groupedResults.map((section) => <section className="intercompany-group-section" key={section.group}><header className="intercompany-group-heading"><div><b>{section.group}</b><span>Conferência do movimento da competência entre as empresas</span></div><div><small>{section.reconciled} conciliado(s)</small><strong>{section.treatment} para tratar</strong><span>Diferença: {money.format(section.difference)}</span></div></header><div className="table-wrap intercompany-group-table"><table><thead><tr><th>Outra empresa</th><th>Empresa com ativo a receber</th><th>Movimento do ativo</th><th>Empresa com passivo a pagar</th><th>Movimento do passivo</th><th>Diferença mensal</th><th>Situação</th><th>Diagnóstico</th><th>Lançamentos</th></tr></thead><tbody>{section.rows.length ? section.rows.map((row) => { const counterpart = row.creditorCode === selectedCode ? { code: row.debtorCode, name: row.debtorName } : { code: row.creditorCode, name: row.creditorName }; return <tr key={row.id}><td><b>{counterpart.code}</b> — {counterpart.name}</td><td><div className="intercompany-account-cell"><strong>{row.creditorCode} — {row.creditorName}</strong><span>{row.receivableAccount}</span><small>Red. {row.receivableReduced || "—"}</small></div></td><td className={row.receivableMovement < 0 ? "negative" : ""}><b>{money.format(row.receivableMovement)}</b></td><td><div className="intercompany-account-cell"><strong>{row.debtorCode} — {row.debtorName}</strong><span>{row.payableAccount}</span><small>Red. {row.payableReduced || "—"}</small></div></td><td className={row.payableMovement < 0 ? "negative" : ""}><b>{money.format(row.payableMovement)}</b></td><td className={Math.abs(row.difference) > tolerance ? "negative" : ""}><b>{money.format(row.difference)}</b></td><td><span className={`intercompany-status ${row.status === "Conciliado" ? "ok" : "warning"}`}>{row.status === "Conciliado" ? <CheckCircle2 /> : <AlertTriangle />}{row.status}</span></td><td className="intercompany-diagnosis">{crossingDiagnosis(row)}</td><td><button className="intercompany-detail-button" onClick={() => void identifyDivergentEntries(row)} disabled={row.status === "Conciliado" || loadingEntries}>{loadingEntries && selectedRow?.id === row.id ? "Buscando..." : "Identificar"}</button></td></tr>; }) : <tr><td colSpan={9} className="empty-row">Nenhum cruzamento localizado neste grupo para a busca informada.</td></tr>}</tbody></table></div></section>)}</div>
      {selectedRow && <div className="intercompany-entry-panel"><div className="intercompany-entry-heading"><div><b>Lançamentos das contas por empresa</b><span>{selectedRow.creditorCode} × {selectedRow.debtorCode} · {selectedRow.nature} · diferença mensal {money.format(selectedRow.difference)}</span></div><button onClick={() => { setSelectedRow(null); setIdentifiedEntries([]); }}>Fechar</button></div>{loadingEntries ? <div className="intercompany-entry-empty"><RefreshCw className="spin" />Consultando o Razão das duas empresas...</div> : <div className="intercompany-company-entry-grid">{entryGroups.map((group) => <section className="intercompany-company-entries" key={`${group.code}-${group.side}`}><header><div><b>{group.code} — {group.name}</b><span>{group.side} · conta(s) {group.accounts}</span></div><strong>{money.format(group.rows.reduce((sum, entry) => sum + entry.value, 0))}</strong></header>{group.rows.length ? <div className="table-wrap intercompany-entry-table"><table><thead><tr><th>Conferência</th><th>Data</th><th>Conta</th><th>Reduzido</th><th>Lançamento</th><th>Partida</th><th>Documento</th><th>Descrição</th><th>Complemento</th><th>Valor</th></tr></thead><tbody>{group.rows.map((entry) => <tr key={`${group.code}-${entry.id}`}><td><span className={`intercompany-status ${entry.matchStatus === "Com contrapartida" ? "ok" : "warning"}`}>{entry.matchStatus}</span></td><td>{entry.date || "—"}</td><td>{entry.account}</td><td>{entry.reduced || "—"}</td><td>{entry.entryId || "—"}</td><td>{entry.partId || "—"}</td><td>{entry.document || "—"}</td><td>{entry.accountName || "—"}</td><td>{entry.complement || "—"}</td><td className={entry.value < 0 ? "negative" : ""}><b>{money.format(entry.value)}</b></td></tr>)}</tbody></table></div> : <div className="intercompany-entry-empty">Nenhum lançamento localizado no Razão para a conta e competência informadas.</div>}</section>)}</div>}</div>}
    </>}
    {!isUpdatedForSelection && !loading && <div className="intercompany-empty"><Building2 /><b>Atualize Intercompany para iniciar</b><span>Serão conferidos os movimentos da competência entre a empresa selecionada e as demais empresas.</span></div>}
  </section>;
}
