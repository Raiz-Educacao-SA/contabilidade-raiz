"use client";

import { useMemo, useState } from "react";
import { BarChart3, Download, FileSpreadsheet, RefreshCw, Search } from "lucide-react";
import * as XLSX from "xlsx";

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
};

type HistoricalRow = BalanceRow & { balances: number[] };
type AnalyzedRow = HistoricalRow & {
  category: string;
  absoluteVariation: number;
  percentageVariation: number | null;
  historicalAverage: number;
  relevantVariation: boolean;
  possibleError: boolean;
  expectedNature: "positivo" | "negativo" | "indefinido";
  currentSign: "positivo" | "negativo" | "zero";
  reversedAccount: boolean;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim().replace(/\s+/g, " ");

function category(account: string) {
  if (account.startsWith("1.")) return "Ativo";
  if (account.startsWith("2.4")) return "Patrimônio Líquido";
  if (account.startsWith("2.")) return "Passivo";
  if (account.startsWith("3.")) return "Receita";
  if (account.startsWith("4.1")) return "Custo";
  if (account.startsWith("4.2")) return "Despesa";
  return "Outros";
}

function expectedNature(account: string): "positivo" | "negativo" | "indefinido" {
  if (account.startsWith("1.")) return "positivo";
  if (account.startsWith("2.") || account.startsWith("3.")) return "negativo";
  if (account.startsWith("4.1") || account.startsWith("4.2")) return "positivo";
  return "indefinido";
}

function previousCompetences(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  return Array.from({ length: 4 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1 - (3 - offset), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default function TrialBalanceAnalysis({ companyCode, competence, accessToken }: { companyCode: string; competence: string; accessToken: string }) {
  const [base, setBase] = useState<HistoricalRow[]>([]);
  const [competences, setCompetences] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzedRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  async function generate() {
    if (!companyCode || !accessToken) return;
    setGenerating(true); setMessage(""); setAnalysis([]);
    try {
      const periods = previousCompetences(competence);
      const monthly = await Promise.all(periods.map(async (period) => {
        const response = await fetch(`/api/totvs/trial-balance?company=${encodeURIComponent(companyCode)}&competence=${period}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Não foi possível gerar o balancete de ${period}.`);
        return (payload.rows || []) as BalanceRow[];
      }));
      const accounts = new Map<string, HistoricalRow>();
      monthly.forEach((rows, periodIndex) => rows.forEach((row) => {
        const current = accounts.get(row.account) || { ...row, balances: Array(periods.length).fill(0) };
        current.balances[periodIndex] = row.closingBalance;
        if (periodIndex === periods.length - 1) Object.assign(current, row);
        accounts.set(row.account, current);
      }));
      const generated = Array.from(accounts.values()).sort((a, b) => a.account.localeCompare(b.account, "pt-BR", { numeric: true }));
      setCompetences(periods); setBase(generated);
      setMessage(`${generated.length} conta(s) gerada(s) no balancete da competência ${competence.slice(5)}/${competence.slice(0, 4)}.`);
    } catch (error) { setBase([]); setMessage((error as Error).message); }
    finally { setGenerating(false); }
  }

  function analyze() {
    if (!base.length) return;
    setAnalyzing(true);
    const positiveExceptions = new Set(["DESCONTO COMERCIAL S/ MENSALIDADES", "BOLSAS INSTITUCIONAIS", "ISS", "PIS", "COFINS"]);
    const negativeExceptions = new Set(["RECEBIMENTO DE MULTA/JUROS", "RECEITAS DE APLICACOES FINANCEIRAS", "DESCONTOS OBTIDOS"]);
    const output = base.map<AnalyzedRow>((row) => {
      const final = row.balances.at(-1) || 0;
      const previous = row.balances.at(-2) || 0;
      const absoluteVariation = final - previous;
      const percentageVariation = previous !== 0 ? (absoluteVariation / previous) * 100 : null;
      const changes = row.balances.slice(1, -1).map((value, index) => value - row.balances[index]);
      const historicalAverage = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0;
      let nature = expectedNature(row.account);
      const description = normalize(row.description);
      if (positiveExceptions.has(description)) nature = "positivo";
      if (negativeExceptions.has(description)) nature = "negativo";
      const currentSign = final > 0 ? "positivo" : final < 0 ? "negativo" : "zero";
      const reducer = /\(\s?-\s?\)/.test(row.description) || row.description.trim().startsWith("(-");
      return {
        ...row,
        category: category(row.account),
        absoluteVariation,
        percentageVariation,
        historicalAverage,
        relevantVariation: percentageVariation !== null && Math.abs(percentageVariation) >= 20 && Math.abs(absoluteVariation) > 2000 && Math.abs(absoluteVariation) > 1.5 * Math.abs(historicalAverage),
        possibleError: previous === 0 && final !== 0,
        expectedNature: nature,
        currentSign,
        reversedAccount: nature !== "indefinido" && currentSign !== "zero" && nature !== currentSign && !reducer,
      };
    });
    setAnalysis(output); setAnalyzing(false);
    setMessage("Análise concluída conforme as regras do script Arsenal Contábil.");
  }

  function exportAnalysis() {
    if (!analysis.length) return;
    const row = (item: AnalyzedRow) => ({
      Conta: item.account,
      "Cód. reduzido": item.reduced,
      Descrição: item.description,
      Categoria: item.category,
      "Saldo anterior": item.balances.at(-2) || 0,
      "Saldo final": item.balances.at(-1) || 0,
      "Variação absoluta": item.absoluteVariation,
      "Variação percentual": item.percentageVariation,
      "Média histórica": item.historicalAverage,
      "Variação relevante": item.relevantVariation ? "Sim" : "Não",
      "Possível erro": item.possibleError ? "Sim" : "Não",
      "Natureza esperada": item.expectedNature,
      "Sinal atual": item.currentSign,
      "Conta virada": item.reversedAccount ? "Sim" : "Não",
    });
    const summaryRows = Array.from(summary.totals, ([Categoria, Saldo]) => ({ Categoria, Saldo }));
    summaryRows.push({ Categoria: summary.result >= 0 ? "Lucro Contábil do Período" : "Prejuízo Líquido do Período", Saldo: summary.result });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Resumo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analysis.filter((item) => item.relevantVariation).map(row)), "Variacoes Relevantes");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analysis.filter((item) => item.possibleError).map(row)), "Erros Contabeis");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analysis.filter((item) => item.reversedAccount).map(row)), "Contas Viradas");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analysis.map(row)), "Base Tratada");
    XLSX.writeFile(workbook, `${String(companyCode).padStart(2, "0")}_Analise_Balancete_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }

  const summary = useMemo(() => {
    const totals = new Map<string, number>();
    analysis.forEach((row) => totals.set(row.category, (totals.get(row.category) || 0) + (row.balances.at(-1) || 0)));
    const revenue = totals.get("Receita") || 0, cost = totals.get("Custo") || 0, expense = totals.get("Despesa") || 0;
    return { totals, result: revenue - cost - expense };
  }, [analysis]);
  const inconsistencies = useMemo(() => analysis.filter((row) => row.relevantVariation || row.possibleError || row.reversedAccount), [analysis]);
  const filtered = useMemo(() => { const term = normalize(search); return term ? analysis.filter((row) => normalize(`${row.account} ${row.reduced} ${row.description}`).includes(term)) : analysis; }, [analysis, search]);

  return <section className="panel trial-analysis">
    <div className="trial-analysis-actions">
      <div><small>MÓDULO CONTÁBIL</small><h2>Análise de Balancete</h2><p>Geração oficial no TOTVS e crítica contábil da competência selecionada.</p></div>
      <div className="trial-action-buttons">
        <button className={`secondary ${base.length ? "source-loaded" : ""}`} onClick={() => void generate()} disabled={generating}><RefreshCw className={generating ? "spin" : ""} />{generating ? "Gerando..." : "Gerar balancete"}</button>
        <button className={`secondary ${analysis.length ? "source-loaded" : ""}`} onClick={analyze} disabled={!base.length || analyzing}><BarChart3 />{analyzing ? "Analisando..." : "Analisar balancete"}</button>
        <button className="secondary" onClick={exportAnalysis} disabled={!analysis.length}><Download />Exportar análise</button>
      </div>
    </div>
    {message && <div className={`notice ${!base.length && !generating ? "error" : ""}`}>{message}</div>}
    <div className="trial-summary">
      <article><span>Contas analisadas</span><b>{analysis.length.toLocaleString("pt-BR")}</b></article>
      <article><span>Variações relevantes</span><b>{analysis.filter((row) => row.relevantVariation).length}</b></article>
      <article><span>Possíveis erros</span><b>{analysis.filter((row) => row.possibleError).length}</b></article>
      <article><span>Contas viradas</span><b>{analysis.filter((row) => row.reversedAccount).length}</b></article>
      <article><span>Lucro/Prejuízo</span><b className={summary.result < 0 ? "negative" : ""}>{money.format(summary.result)}</b></article>
    </div>
    {analysis.length > 0 && <>
      <div className="trial-category-summary">{["Ativo", "Passivo", "Patrimônio Líquido", "Receita", "Custo", "Despesa", "Outros"].map((item) => <article key={item}><span>{item}</span><b>{money.format(summary.totals.get(item) || 0)}</b></article>)}</div>
      <div className="book-toolbar"><label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conta ou descrição no balancete" /></label><span>{filtered.length} conta(s) · {inconsistencies.length} divergência(s)</span></div>
      <div className="table-wrap trial-table"><table><thead><tr><th>Conta</th><th>Cód. reduzido</th><th>Descrição</th><th>Categoria</th><th>Saldo anterior</th><th>Saldo final</th><th>Variação</th><th>Variação %</th><th>Crítica</th></tr></thead><tbody>{filtered.length ? filtered.map((row) => <tr key={row.account}><td><b>{row.account}</b></td><td>{row.reduced || "—"}</td><td>{row.description}</td><td>{row.category}</td><td>{money.format(row.balances.at(-2) || 0)}</td><td>{money.format(row.balances.at(-1) || 0)}</td><td>{money.format(row.absoluteVariation)}</td><td>{row.percentageVariation === null ? "—" : `${percent.format(row.percentageVariation)}%`}</td><td><div className="trial-flags">{row.relevantVariation && <span>Variação relevante</span>}{row.possibleError && <span>Saldo novo</span>}{row.reversedAccount && <span>Conta virada</span>}{!row.relevantVariation && !row.possibleError && !row.reversedAccount && <em>Sem crítica</em>}</div></td></tr>) : <tr><td colSpan={9} className="empty-row">Nenhuma conta encontrada no balancete.</td></tr>}</tbody></table></div>
      <p className="trial-footnote"><FileSpreadsheet /> Período histórico: {competences.map((item) => `${item.slice(5)}/${item.slice(0, 4)}`).join(" · ")}</p>
    </>}
  </section>;
}
