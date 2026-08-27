"use client";

import { Fragment, useMemo, useState } from "react";
import { BarChart3, ClipboardList, Download, FilePlus2, FileSpreadsheet, RefreshCw, Scale, Table2 } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { applyRaizWorkbookStyle } from "@/lib/export-workbook-style";
import { classifyLoanTerm, type LoanTerm } from "@/lib/loan-accounts";
import { buildLoanPostingsCsv, encodeWindows1252, getLoanAccountControlReconciliation, getLoanControlSchedule, getLoanPostingControls, isLoanBalanceReconciled } from "@/lib/loan-postings";

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
const roundAmount = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

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
  const [activeView, setActiveView] = useState<"balancete" | "controle" | "analise">("balancete");
  const [selectedControlId, setSelectedControlId] = useState("");
  const [reconciledAccount, setReconciledAccount] = useState("");

  async function generate() {
    if (!companyCode || !accessToken) return;
    setGenerating(true);
    setMessage("");
    setHasError(false);
    setAnalysis([]);
    setReconciledAccount("");

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
        const term = row.term || classifyLoanTerm(row.account, row.description);
        if (!term) return;
        const current = accounts.get(row.account) || { ...row, term, balances: Array(periods.length).fill(0) };
        current.balances[periodIndex] = row.closingBalance;
        if (periodIndex === periods.length - 1) Object.assign(current, row, { term });
        accounts.set(row.account, current);
      }));

      const generated = Array.from(accounts.values()).sort((a, b) => {
        const order: Record<LoanTerm, number> = { "Curto prazo": 0, "Longo prazo": 1, Juros: 2 };
        if (a.term !== b.term) return order[a.term] - order[b.term];
        return a.account.localeCompare(b.account, "pt-BR", { numeric: true });
      });

      setCompetences(periods);
      setBase(generated);
      setActiveView("balancete");
      setMessage(generated.length
        ? `${generated.length} conta(s) de empréstimos e juros gerada(s) para ${competence.slice(5)}/${competence.slice(0, 4)}.`
        : `Nenhuma conta de empréstimo, financiamento ou juros foi localizada em ${competence.slice(5)}/${competence.slice(0, 4)}.`);
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
    const interest = base.filter((row) => row.term === "Juros");
    return {
      shortBalance: short.reduce((sum, row) => sum + row.closingBalance, 0),
      longBalance: long.reduce((sum, row) => sum + row.closingBalance, 0),
      interestBalance: interest.reduce((sum, row) => sum + row.closingBalance, 0),
      movement: base.reduce((sum, row) => sum + row.movement, 0),
      total: [...short, ...long].reduce((sum, row) => sum + row.closingBalance, 0),
      shortCount: short.length,
      longCount: long.length,
      interestCount: interest.length,
    };
  }, [base]);

  const issues = useMemo(() => analysis.filter((row) => row.relevantVariation || row.newBalance), [analysis]);
  const postingControls = useMemo(() => getLoanPostingControls(companyCode), [companyCode]);
  const controlReconciliations = useMemo(() => new Map(base.map((row) => [
    row.account,
    getLoanAccountControlReconciliation(companyCode, competence, row.account),
  ])), [base, companyCode, competence]);
  const reconciliationStats = useMemo(() => {
    const matched = base.flatMap((row) => {
      const reconciliation = controlReconciliations.get(row.account);
      return reconciliation ? [roundAmount(row.closingBalance - reconciliation.expectedBalance)] : [];
    });
    return {
      matched: matched.length,
      reconciled: matched.filter(isLoanBalanceReconciled).length,
      divergent: matched.filter((difference) => !isLoanBalanceReconciled(difference)).length,
    };
  }, [base, controlReconciliations]);
  const fixedControl = postingControls.find((control) => control.id === selectedControlId) || postingControls[0];
  const fixedSchedule = useMemo(() => fixedControl ? getLoanControlSchedule(fixedControl) : [], [fixedControl]);
  const variableAmortization = new Set(fixedSchedule.filter((row) => row.amortization > 0).map((row) => row.amortization.toFixed(2))).size > 1;
  const postingPreview = useMemo(() => buildLoanPostingsCsv(companyCode, competence), [companyCode, competence]);

  function reconcileAccount(account: string) {
    const reconciliation = controlReconciliations.get(account);
    if (!reconciliation) return;
    setSelectedControlId(reconciliation.contributions[0].controlId);
    setReconciledAccount((current) => current === account ? "" : account);
  }

  function exportAnalysis() {
    if (!base.length) return;
    const workbook = XLSX.utils.book_new();
    const rows = (analysis.length ? analysis : base).map((row) => {
      const reconciliation = getLoanAccountControlReconciliation(companyCode, competence, row.account);
      const closingBalance = row.balances.at(-1) || 0;
      const difference = reconciliation ? roundAmount(closingBalance - reconciliation.expectedBalance) : null;
      return {
        Prazo: row.term,
        Conta: row.account,
        "Cód. reduzido": row.reduced,
        Descrição: row.description,
        "Saldo anterior": row.balances.at(-2) || 0,
        "Saldo final": closingBalance,
        "Saldo do controle": reconciliation?.expectedBalance ?? null,
        "Diferença da conciliação": difference,
        "Situação da conciliação": difference === null ? "Sem controle" : isLoanBalanceReconciled(difference) ? "Conciliado" : "Divergente",
        Contratos: reconciliation?.contributions.map((item) => `${item.bank} ${item.contract}`).join(" · ") || "",
        "Variação absoluta": "absoluteVariation" in row ? row.absoluteVariation : closingBalance - (row.balances.at(-2) || 0),
        "Variação percentual": "percentageVariation" in row ? row.percentageVariation : null,
        "Variação relevante": "relevantVariation" in row && row.relevantVariation ? "Sim" : "Não",
        "Saldo novo": "newBalance" in row && row.newBalance ? "Sim" : "Não",
      };
    });
    const summaryRows = [
      { Indicador: "Empréstimos de curto prazo", Valor: summary.shortBalance },
      { Indicador: "Empréstimos de longo prazo", Valor: summary.longBalance },
      { Indicador: "Juros de empréstimos", Valor: summary.interestBalance },
      { Indicador: "Saldo total do passivo de empréstimos", Valor: summary.total },
      { Indicador: "Movimento da competência", Valor: summary.movement },
      { Indicador: "Contas vinculadas aos controles", Valor: reconciliationStats.matched },
      { Indicador: "Contas conciliadas", Valor: reconciliationStats.reconciled },
      { Indicador: "Divergências entre balancete e controle", Valor: reconciliationStats.divergent },
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Resumo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Emprestimos");
    applyRaizWorkbookStyle(workbook);
    XLSX.writeFile(workbook, `${String(companyCode).padStart(2, "0")}_Emprestimos_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }

  function generateEntriesCsv() {
    if (!postingPreview.postings.length) {
      setHasError(true);
      setMessage(postingControls.length
        ? "Não há lançamentos previstos no controle fixo para esta competência."
        : "O controle fixo de empréstimos ainda não foi cadastrado para esta empresa.");
      return;
    }

    const url = URL.createObjectURL(new Blob(
      [encodeWindows1252(postingPreview.csv)],
      { type: "text/csv;charset=windows-1252" },
    ));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `coligada${String(companyCode).padStart(2, "0")}-emprestimos.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setHasError(false);
    setMessage(`${postingPreview.postings.length} lançamento(s) do contrato ${postingControls[0].contract} gerado(s) para importação no TOTVS.`);
  }

  return <section className="panel trial-analysis loan-analysis">
    <div className="trial-analysis-actions">
      <div><small>MÓDULO FINANCEIRO</small><h2>Conciliação de Empréstimos</h2><p>Balancete específico das contas de empréstimos, financiamentos e respectivos juros.</p></div>
      <div className="trial-action-buttons">
        <button className={`secondary ${base.length ? "source-loaded" : ""}`} onClick={() => void generate()} disabled={generating}><RefreshCw className={generating ? "spin" : ""} />{generating ? "Gerando..." : "Gerar balancete"}</button>
        <button
          className={`secondary ${postingPreview.postings.length ? "source-loaded" : ""}`}
          onClick={generateEntriesCsv}
          disabled={!postingPreview.postings.length}
          title={postingControls.length
            ? "Gerar o arquivo CSV dos lançamentos definidos no controle fixo da empresa."
            : "Controle de empréstimos ainda não cadastrado para esta empresa."}
        ><FilePlus2 />Gerar lançamentos</button>
        <button className="secondary" onClick={exportAnalysis} disabled={!base.length}><Download />Exportar análise</button>
      </div>
    </div>
    {message && <div className={`notice ${hasError ? "error" : ""}`}>{message}</div>}
    {!base.length && !fixedControl && !generating && !message && <div className="loan-empty"><FileSpreadsheet /><b>Gere o balancete de empréstimos para iniciar</b><span>Serão consideradas as contas de passivo de curto e longo prazo e as contas de juros identificadas com empréstimos ou financiamentos.</span></div>}
    {(base.length > 0 || fixedControl) && <>
      {base.length > 0 && <div className="trial-summary">
        <article><span>Contas de curto prazo</span><b>{summary.shortCount} · {money.format(summary.shortBalance)}</b></article>
        <article><span>Contas de longo prazo</span><b>{summary.longCount} · {money.format(summary.longBalance)}</b></article>
        <article><span>Contas de juros</span><b>{summary.interestCount} · {money.format(summary.interestBalance)}</b></article>
        <article><span>Movimento da competência</span><b>{money.format(summary.movement)}</b></article>
        <article><span>Saldo total do passivo</span><b>{money.format(summary.total)}</b></article>
        <article className={reconciliationStats.divergent ? "has-warning" : ""}><span>Divergências no controle</span><b>{reconciliationStats.divergent} de {reconciliationStats.matched}</b></article>
      </div>}
      <nav className="trial-view-tabs">
        <button className={activeView === "balancete" ? "active" : ""} onClick={() => setActiveView("balancete")}><Table2 />Balancete de Empréstimos <span>{base.length}</span></button>
        <button className={activeView === "controle" ? "active" : ""} onClick={() => setActiveView("controle")}><ClipboardList />Controle de Empréstimos <span>{postingControls.length}</span></button>
        {analysis.length > 0 && <button className={activeView === "analise" ? "active" : ""} onClick={() => setActiveView("analise")}><BarChart3 />Análise do Balancete <span>{issues.length}</span></button>}
      </nav>
      <div className="trial-view-content">
        {activeView === "controle" ? fixedControl ? <div className="loan-control">
          {postingControls.length > 1 && <div className="loan-contract-tabs">{postingControls.map((control) => <button key={control.id} className={control.id === fixedControl.id ? "active" : ""} onClick={() => setSelectedControlId(control.id)}><span>{control.bank}</span><b>{control.contract}</b></button>)}</div>}
          <div className="loan-control-heading"><div><small>CONTROLE FIXO · COLIGADA {fixedControl.companyCode}</small><h3>{fixedControl.bank} · Contrato {fixedControl.contract}</h3><p>{fixedControl.companyName} · {fixedControl.companyCnpj}</p></div><span>Origem <b>{fixedControl.sourceSheet}</b></span></div>
          <div className="loan-control-summary"><article><span>Valor principal</span><b>{money.format(fixedControl.principal)}</b></article><article><span>Total financiado</span><b>{money.format(fixedControl.financedTotal)}</b></article><article><span>Parcelas</span><b>{fixedControl.installments}</b></article><article><span>Taxa mensal</span><b>{percent.format(fixedControl.monthlyRate * 100)}%</b></article><article><span>Amortização mensal</span><b>{variableAmortization ? "Variável" : money.format(fixedControl.monthlyAmortization)}</b></article><article><span>{fixedControl.interestSummaryLabel || "Juros da carência"}</span><b>{money.format(fixedControl.graceInterest)}</b></article></div>
          <div className="table-wrap loan-control-table"><table><thead><tr><th>Parcela</th><th>Competência</th><th>Amortização</th><th>Juros</th><th>Parcela total</th><th>Saldo devedor</th><th>Status</th></tr></thead><tbody>{fixedSchedule.map((row) => <tr key={row.competence} className={row.competence === competence ? "current-installment" : ""}><td>{row.installment}</td><td><b>{row.competence.slice(5)}/{row.competence.slice(0, 4)}</b></td><td>{money.format(row.amortization)}</td><td>{money.format(row.interest)}</td><td><b>{money.format(row.totalInstallment)}</b></td><td>{money.format(row.outstandingBalance)}</td><td><span className="loan-control-status">{row.competence === competence ? "Competência atual" : row.status}</span></td></tr>)}</tbody></table></div>
        </div> : <div className="loan-empty"><ClipboardList /><b>Controle fixo ainda não cadastrado</b><span>O modelo de empréstimos desta empresa será incluído quando estiver disponível.</span></div>
        : activeView === "balancete" ? base.length ? <div className="table-wrap trial-table loan-reconciliation-table"><table><thead><tr><th>Conta</th><th>Cód. reduzido</th><th>Descrição</th><th>Saldo anterior</th><th>Débitos</th><th>Créditos</th><th>Saldo final</th><th>Grupo</th><th>Saldo controle</th><th>Diferença</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{base.map((row) => {
          const reconciliation = controlReconciliations.get(row.account);
          const difference = reconciliation ? roundAmount(row.closingBalance - reconciliation.expectedBalance) : null;
          const reconciled = difference !== null && isLoanBalanceReconciled(difference);
          return <Fragment key={row.account}>
            <tr className={reconciliation ? reconciled ? "loan-row-reconciled" : "loan-row-divergent" : ""}>
              <td><b>{row.account}</b></td><td>{row.reduced || "—"}</td><td>{row.description}</td><td>{money.format(row.openingBalance)}</td><td>{money.format(row.debit)}</td><td>{money.format(Math.abs(row.credit))}</td><td><b>{money.format(row.closingBalance)}</b></td><td><span className={`loan-term ${row.term === "Curto prazo" ? "short" : row.term === "Longo prazo" ? "long" : "interest"}`}>{row.term}</span></td>
              <td>{reconciliation ? <b>{money.format(reconciliation.expectedBalance)}</b> : "—"}</td>
              <td>{difference === null ? "—" : <b>{money.format(difference)}</b>}</td>
              <td><span className={`loan-reconciliation-status ${!reconciliation ? "missing" : reconciled ? "ok" : "divergent"}`}>{!reconciliation ? "Sem controle" : reconciled ? "Conciliado" : "Divergente"}</span></td>
              <td><button className="loan-reconcile-button" onClick={() => reconcileAccount(row.account)} disabled={!reconciliation} title={reconciliation ? `Comparar com ${reconciliation.contributions.map((item) => `${item.bank} ${item.contract}`).join(" e ")}` : "Nenhum controle cadastrado para esta conta"}><Scale />Conciliar</button></td>
            </tr>
            {reconciledAccount === row.account && reconciliation && <tr className="loan-reconciliation-detail"><td colSpan={12}>
              <div><header><span>Conciliação da conta <b>{row.account}</b></span><em>{reconciliation.label} · tolerância de até R$ 1,00</em></header><section><article><span>Saldo no balancete</span><b>{money.format(row.closingBalance)}</b></article><article><span>Saldo no controle</span><b>{money.format(reconciliation.expectedBalance)}</b></article><article className={reconciled ? "ok" : "divergent"}><span>Diferença</span><b>{money.format(difference || 0)}</b></article><article><span>Competência</span><b>{competence.slice(5)}/{competence.slice(0, 4)}</b></article></section><footer>{reconciliation.contributions.map((item) => <span key={item.controlId}>{item.bank} · Contrato {item.contract}: <b>{money.format(item.expectedBalance)}</b></span>)}</footer></div>
            </td></tr>}
          </Fragment>;
        })}</tbody></table></div> : <div className="loan-empty"><FileSpreadsheet /><b>Gere o balancete de empréstimos</b><span>O controle fixo pode ser consultado sem gerar o balancete.</span></div>
        : <div className="table-wrap trial-table"><table><thead><tr><th>Conta</th><th>Cód. reduzido</th><th>Descrição</th><th>Saldo anterior</th><th>Saldo final</th><th>Grupo</th><th>Variação</th><th>Variação %</th><th>Crítica</th></tr></thead><tbody>{issues.length ? issues.map((row) => <tr key={row.account}><td><b>{row.account}</b></td><td>{row.reduced || "—"}</td><td>{row.description}</td><td>{money.format(row.balances.at(-2) || 0)}</td><td>{money.format(row.balances.at(-1) || 0)}</td><td><span className={`loan-term ${row.term === "Curto prazo" ? "short" : row.term === "Longo prazo" ? "long" : "interest"}`}>{row.term}</span></td><td>{money.format(row.absoluteVariation)}</td><td>{row.percentageVariation === null ? "—" : `${percent.format(row.percentageVariation)}%`}</td><td><div className="trial-flags">{row.relevantVariation && <span>Variação relevante</span>}{row.newBalance && <span>Saldo novo</span>}</div></td></tr>) : <tr><td colSpan={9} className="empty-row">Nenhuma variação de empréstimos foi criticada pelas regras atuais.</td></tr>}</tbody></table></div>}
        <p className="trial-footnote"><FileSpreadsheet /> Período histórico: {competences.map((item) => `${item.slice(5)}/${item.slice(0, 4)}`).join(" · ")} · {postingControls.length
          ? `${postingControls.length} controle(s) fixo(s) cadastrado(s) · contrato atual ${fixedControl?.contract} · aba ${fixedControl?.sourceSheet}.`
          : "Aguardando o controle fixo de empréstimos desta empresa."}</p>
      </div>
    </>}
  </section>;
}
