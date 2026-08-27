"use client";

import { useMemo, useState } from "react";
import { BarChart3, Download, FilePlus2, FileSpreadsheet, RefreshCw, Search, Table2 } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { applyRaizWorkbookStyle } from "@/lib/export-workbook-style";
import { classifyLoanTerm, type LoanTerm } from "@/lib/loan-accounts";

type BalanceRow = {
  id: string;
  reduced: string;
  account: string;
  description: string;
  openingBalance: number;
  debit: number;
  credit: number;
  movement: number;
  closingBalance: number;
  term?: LoanTerm | null;
};

type HistoricalLoanRow = BalanceRow & {
  balances: number[];
  term: LoanTerm;
};

type AnalyzedLoanRow = HistoricalLoanRow & {
  absoluteVariation: number;
  percentageVariation: number | null;
  historicalAverage: number;
  relevantVariation: boolean;
  newBalance: boolean;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim().replace(/\s+/g, " ");

function previousCompetences(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  return Array.from({ length: 4 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1 - (3 - offset), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default function LoanReconciliation({
  companyCode,
  competence,
  accessToken,
}: {
  companyCode: string;
  competence: string;
  accessToken: string;
}) {
  const [base, setBase] = useState<HistoricalLoanRow[]>([]);
  const [competences, setCompetences] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzedLoanRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [search, setSearch] = useState("");
  const [activeView, setActiveView] = useState<"balancete" | "analise">("balancete");

  async function generate() {
    if (!companyCode || !accessToken) return;
    setGenerating(true);
    setMessage("");
    setHasError(false);
    setAnalysis([]);

    try {
      const periods = previousCompetences(competence);
      const monthly = await Promise.all(periods.map(async (period) => {
        const response = await fetch(
          `/api/totvs/loans/trial-balance?company=${encodeURIComponent(companyCode)}&competence=${period}`,
          { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Não foi possível gerar o balancete de empréstimos de ${period}.`);
        return (payload.rows || []) as BalanceRow[];
      }));

      const accounts = new Map<string, HistoricalLoanRow>();
      monthly.forEach((rows, periodIndex) => rows.forEach((row) => {
        const term = row.term || classifyLoanTerm(row.account);
        if (!term) return;
        const current = accounts.get(row.account) || { ...row, term, balances: Array(periods.length).fill(0) };
        current.balances[periodIndex] = row.closingBalance;
        if (periodIndex === periods.length - 1) Object.assign(current, row, { term });
        accounts.set(row.account, current);
      }));

      const generated = Array.from(accounts.values()).sort((a, b) => {
        if (a.term !== b.term) return a.term === "Curto prazo" ? -1 : 1;
        return a.account.localeCompare(b.account, "pt-BR", { numeric: true });
      });

      setCompetences(periods);
      setBase(generated);
      setActiveView("balancete");
      setMessage(generated.length
        ? `${generated.length} conta(s) de empréstimos gerada(s) para ${competence.slice(5)}/${competence.slice(0, 4)}.`
        : `Nenhuma conta de empréstimo de curto ou longo prazo foi localizada em ${competence.slice(5)}/${competence.slice(0, 4)}.`);
    } catch (error) {
      setBase([]);
      setHasError(true);
      setMessage((error as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function analyze() {
    if (!base.length) return;
    setAnalyzing(true);
    const output = base.map<AnalyzedLoanRow>((row) => {
      const final = row.balances.at(-1) || 0;
      const previous = row.balances.at(-2) || 0;
      const absoluteVariation = final - previous;
      const percentageVariation = previous !== 0 ? (absoluteVariation / previous) * 100 : null;
      const changes = row.balances.slice(1, -1).map((value, index) => value - row.balances[index]);
      const historicalAverage = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0;
      return {
        ...row,
        absoluteVariation,
        percentageVariation,
        historicalAverage,
        relevantVariation: percentageVariation !== null
          && Math.abs(percentageVariation) >= 20
          && Math.abs(absoluteVariation) > 2000
          && Math.abs(absoluteVariation) > 1.5 * Math.abs(historicalAverage),
        newBalance: previous === 0 && final !== 0,
      };
    });

    setAnalysis(output);
    setActiveView("analise");
    setAnalyzing(false);
    setMessage("Análise dos empréstimos concluída. As variações relevantes foram destacadas para conferência.");
  }

  const summary = useMemo(() => {
    const short = base.filter((row) => row.term === "Curto prazo");
    const long = base.filter((row) => row.term === "Longo prazo");
    return {
      shortBalance: short.reduce((sum, row) => sum + row.closingBalance, 0),
      longBalance: long.reduce((sum, row) => sum + row.closingBalance, 0),
      movement: base.reduce((sum, row) => sum + row.movement, 0),
      total: base.reduce((sum, row) => sum + row.closingBalance, 0),
      shortCount: short.length,
      longCount: long.length,
    };
  }, [base]);

  const issues = useMemo(() => analysis.filter((row) => row.relevantVariation || row.newBalance), [analysis]);
  const visibleBase = useMemo(() => {
    const term = normalize(search);
    return term ? base.filter((row) => normalize(`${row.account} ${row.reduced} ${row.description} ${row.term}`).includes(term)) : base;
  }, [base, search]);
  const visibleAnalysis = useMemo(() => {
    const term = normalize(search);
    return term ? issues.filter((row) => normalize(`${row.account} ${row.reduced} ${row.description} ${row.term}`).includes(term)) : issues;
  }, [issues, search]);

  function exportAnalysis() {
    if (!base.length) return;
    const workbook = XLSX.utils.book_new();
    const rows = (analysis.length ? analysis : base).map((row) => ({
      Prazo: row.term,
      Conta: row.account,
      "Cód. reduzido": row.reduced,
      Descrição: row.description,
      "Saldo anterior": row.balances.at(-2) || 0,
      "Saldo final": row.balances.at(-1) || 0,
      "Variação absoluta": "absoluteVariation" in row ? row.absoluteVariation : (row.balances.at(-1) || 0) - (row.balances.at(-2) || 0),
      "Variação percentual": "percentageVariation" in row ? row.percentageVariation : null,
      "Variação relevante": "relevantVariation" in row && row.relevantVariation ? "Sim" : "Não",
      "Saldo novo": "newBalance" in row && row.newBalance ? "Sim" : "Não",
    }));
    const summaryRows = [
      { Indicador: "Empréstimos de curto prazo", Valor: summary.shortBalance },
      { Indicador: "Empréstimos de longo prazo", Valor: summary.longBalance },
      { Indicador: "Saldo total", Valor: summary.total },
      { Indicador: "Movimento da competência", Valor: summary.movement },
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Resumo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Emprestimos");
    applyRaizWorkbookStyle(workbook);
    XLSX.writeFile(workbook, `${String(companyCode).padStart(2, "0")}_Emprestimos_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }

  return <section className="panel trial-analysis loan-analysis">
    <div className="trial-analysis-actions">
      <div><small>MÓDULO FINANCEIRO</small><h2>Conciliação de Empréstimos</h2><p>Balancete específico das contas de empréstimos de curto e longo prazo.</p></div>
      <div className="trial-action-buttons">
        <button className={`secondary ${base.length ? "source-loaded" : ""}`} onClick={() => void generate()} disabled={generating}><RefreshCw className={generating ? "spin" : ""} />{generating ? "Gerando..." : "Gerar balancete"}</button>
        <button className={`secondary ${analysis.length ? "source-loaded" : ""}`} onClick={analyze} disabled={!base.length || analyzing}><BarChart3 />{analyzing ? "Analisando..." : "Analisar balancete"}</button>
        <button className="secondary" onClick={exportAnalysis} disabled={!base.length}><Download />Exportar análise</button>
        <button className="secondary" disabled title="Aguardando os lançamentos-padrão e a lógica contábil"><FilePlus2 />Gerar lançamentos</button>
      </div>
    </div>
    {message && <div className={`notice ${hasError ? "error" : ""}`}>{message}</div>}
    {!base.length && !generating && !message && <div className="loan-empty"><FileSpreadsheet /><b>Gere o balancete de empréstimos para iniciar</b><span>Serão consideradas apenas contas de passivo de curto e longo prazo identificadas como empréstimos ou financiamentos.</span></div>}
    {base.length > 0 && <>
      <div className="trial-summary">
        <article><span>Contas de curto prazo</span><b>{summary.shortCount} · {money.format(summary.shortBalance)}</b></article>
        <article><span>Contas de longo prazo</span><b>{summary.longCount} · {money.format(summary.longBalance)}</b></article>
        <article><span>Movimento da competência</span><b>{money.format(summary.movement)}</b></article>
        <article><span>Saldo total</span><b>{money.format(summary.total)}</b></article>
        <article><span>Variações para análise</span><b>{issues.length}</b></article>
      </div>
      <nav className="trial-view-tabs">
        <button className={activeView === "balancete" ? "active" : ""} onClick={() => setActiveView("balancete")}><Table2 />Balancete de Empréstimos <span>{base.length}</span></button>
        {analysis.length > 0 && <button className={activeView === "analise" ? "active" : ""} onClick={() => setActiveView("analise")}><BarChart3 />Análise do Balancete <span>{issues.length}</span></button>}
      </nav>
      <div className="trial-view-content">
        <div className="book-toolbar"><label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conta, descrição ou prazo" /></label><span>{activeView === "balancete" ? visibleBase.length : visibleAnalysis.length} conta(s)</span></div>
        {activeView === "balancete" ? <div className="table-wrap trial-table"><table><thead><tr><th>Prazo</th><th>Conta</th><th>Cód. reduzido</th><th>Descrição</th><th>Saldo anterior</th><th>Débitos</th><th>Créditos</th><th>Saldo final</th></tr></thead><tbody>{visibleBase.map((row) => <tr key={row.account}><td><span className={`loan-term ${row.term === "Curto prazo" ? "short" : "long"}`}>{row.term}</span></td><td><b>{row.account}</b></td><td>{row.reduced || "—"}</td><td>{row.description}</td><td>{money.format(row.openingBalance)}</td><td>{money.format(row.debit)}</td><td>{money.format(Math.abs(row.credit))}</td><td><b>{money.format(row.closingBalance)}</b></td></tr>)}</tbody></table></div> : <div className="table-wrap trial-table"><table><thead><tr><th>Prazo</th><th>Conta</th><th>Cód. reduzido</th><th>Descrição</th><th>Saldo anterior</th><th>Saldo final</th><th>Variação</th><th>Variação %</th><th>Crítica</th></tr></thead><tbody>{visibleAnalysis.length ? visibleAnalysis.map((row) => <tr key={row.account}><td><span className={`loan-term ${row.term === "Curto prazo" ? "short" : "long"}`}>{row.term}</span></td><td><b>{row.account}</b></td><td>{row.reduced || "—"}</td><td>{row.description}</td><td>{money.format(row.balances.at(-2) || 0)}</td><td>{money.format(row.balances.at(-1) || 0)}</td><td>{money.format(row.absoluteVariation)}</td><td>{row.percentageVariation === null ? "—" : `${percent.format(row.percentageVariation)}%`}</td><td><div className="trial-flags">{row.relevantVariation && <span>Variação relevante</span>}{row.newBalance && <span>Saldo novo</span>}</div></td></tr>) : <tr><td colSpan={9} className="empty-row">Nenhuma variação de empréstimos foi criticada pelas regras atuais.</td></tr>}</tbody></table></div>}
        <p className="trial-footnote"><FileSpreadsheet /> Período histórico: {competences.map((item) => `${item.slice(5)}/${item.slice(0, 4)}`).join(" · ")} · A geração de lançamentos será configurada quando as regras forem recebidas.</p>
      </div>
    </>}
  </section>;
}
