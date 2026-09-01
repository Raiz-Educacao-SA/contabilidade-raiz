"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import * as XLSX from "xlsx";

type Props = {
  companyCode: string;
  companyName: string;
  competence: string;
};

type ExpenseRow = {
  supplier: string;
  account: string;
  description: string;
  months: Record<string, number>;
  total: number;
  comment: string;
};

type Analysis = {
  fileName: string;
  rows: ExpenseRow[];
  movements: number;
  suppliers: number;
  periodTotal: number;
  targetTotal: number;
  months: string[];
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function normalized(value: unknown) {
  return String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim().replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : "";
}

function monthWindow(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 6 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function fileSafe(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase();
}

export default function ExpenseAnalysis({ companyCode, companyName, competence }: Props) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targetMonth = competence;
  const targetLabel = `${competence.slice(5, 7)}/${competence.slice(0, 4)}`;
  const divergences = useMemo(() => analysis?.rows.filter((row) => row.comment.includes("Divergência")).length ?? 0, [analysis]);
  const assets = useMemo(() => analysis?.rows.filter((row) => row.comment === "Ativo Imobilizado").length ?? 0, [analysis]);

  async function load(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
      const headerIndex = matrix.findIndex((row) => {
        const names = row.map(normalized);
        return names.includes("CODCOLIGADA") && names.includes("DATASAIDA") && names.includes("DEBITO");
      });
      if (headerIndex < 0) throw new Error("Cabeçalho da PlanilhaNet 08 não localizado.");
      const headers = matrix[headerIndex].map(normalized);
      const records = matrix.slice(headerIndex + 1).map((row) => Object.fromEntries(headers.map((name, index) => [name, row[index]])));
      const months = monthWindow(competence);
      const grouped = new Map<string, ExpenseRow>();
      const movementIds = new Set<string>();
      const suppliers = new Set<string>();

      for (const record of records) {
        if (String(Math.trunc(numberValue(record.CODCOLIGADA))) !== String(Number(companyCode))) continue;
        const date = isoDate(record.DATASAIDA);
        const month = date.slice(0, 7);
        if (!months.includes(month)) continue;
        const account = String(record.DEBITO ?? "").trim();
        if (!account || normalized(account) === "NENHUM REGISTRO ENCONTRADO.") continue;
        const supplier = String(record.NOMEFANTASIA || record.NOME || "SEM FORNECEDOR").trim();
        const description = String(record.DESCRICAO || "SEM DESCRIÇÃO").trim();
        const value = numberValue(record.VALOR);
        const key = [supplier, account, description].join("\u001f");
        if (!grouped.has(key)) grouped.set(key, { supplier, account, description, months: Object.fromEntries(months.map((item) => [item, 0])), total: 0, comment: "" });
        const item = grouped.get(key)!;
        item.months[month] = Math.round((item.months[month] + value) * 100) / 100;
        item.total = Math.round((item.total + value) * 100) / 100;
        suppliers.add(supplier);
        movementIds.add(String(record.IDMOV ?? ""));
      }

      const rows = [...grouped.values()];
      const accountCount = new Map<string, number>();
      rows.forEach((row) => accountCount.set(row.supplier, (accountCount.get(row.supplier) ?? 0) + 1));
      rows.forEach((row) => {
        const prior = months.slice(0, -1).reduce((sum, month) => sum + row.months[month], 0);
        const target = row.months[targetMonth] ?? 0;
        row.comment = accountCount.get(row.supplier)! > 1 && target > 0 && prior === 0
          ? "Divergência em comparação a meses anteriores"
          : row.account.startsWith("1.") && target > 0
            ? "Ativo Imobilizado"
            : "";
      });
      rows.sort((a, b) => a.supplier.localeCompare(b.supplier, "pt-BR") || a.account.localeCompare(b.account));
      const periodTotal = rows.reduce((sum, row) => sum + row.total, 0);
      const targetTotal = rows.reduce((sum, row) => sum + (row.months[targetMonth] ?? 0), 0);
      setAnalysis({ fileName: file.name, rows, movements: movementIds.size, suppliers: suppliers.size, periodTotal, targetTotal, months });
    } catch (cause) {
      setAnalysis(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível analisar o arquivo.");
    } finally {
      setBusy(false);
    }
  }

  function exportAnalysis() {
    if (!analysis) return;
    const rows = analysis.rows.map((row) => ({
      Fornecedor: row.supplier,
      Natureza: "DÉBITO",
      "Conta contábil": row.account,
      "Descrição da conta": row.description,
      ...Object.fromEntries(analysis.months.map((month) => [month, row.months[month]])),
      "Total Geral": row.total,
      Comentários: row.comment,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1:M1" };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Análise de Despesas");
    XLSX.writeFile(workbook, `${companyCode}_${fileSafe(companyName)}_ANALISE_DE_DESPESA_${competence.slice(5, 7)}_${competence.slice(0, 4)}.xlsx`);
  }

  return <section className="expense-analysis">
    <div className="expense-upload">
      <div><span className="eyebrow">PLANILHANET 08 · COMPRAS</span><h2>Análise de despesas</h2><p>Importe a base do TOTVS RM. O processamento ocorre somente neste navegador.</p></div>
      <label className="primary expense-file"><Upload />{busy ? "Processando..." : "Selecionar PlanilhaNet 08"}<input type="file" accept=".xlsx,.xlsm,.xls" disabled={busy} onChange={(event) => void load(event.target.files?.[0])} /></label>
    </div>
    {error && <div className="notice error"><AlertTriangle />{error}</div>}
    {!analysis ? <div className="expense-empty"><FileSpreadsheet /><b>Aguardando a PlanilhaNet 08</b><span>Coligada {companyCode} · competência {targetLabel} · somente contas a débito</span></div> : <>
      <div className="expense-source"><span>{analysis.fileName}</span><small>{companyCode} — {companyName}</small><button onClick={() => setAnalysis(null)}><RefreshCw />Trocar arquivo</button><button className="primary" onClick={exportAnalysis}><Download />Exportar análise</button></div>
      <div className="expense-kpis">
        <article className="target"><span>Despesas {targetLabel}</span><b>{money.format(analysis.targetTotal)}</b></article>
        <article><span>Total da retrospectiva</span><b>{money.format(analysis.periodTotal)}</b></article>
        <article><span>Fornecedores</span><b>{analysis.suppliers}</b></article>
        <article><span>Movimentos</span><b>{analysis.movements}</b></article>
        <article className={divergences ? "warning" : ""}><span>Divergências</span><b>{divergences}</b></article>
        <article className={assets ? "asset" : ""}><span>Ativos no mês</span><b>{assets}</b></article>
      </div>
      <div className="expense-table-wrap"><table><thead><tr><th>Fornecedor</th><th>Conta contábil</th><th>Descrição da conta</th>{analysis.months.map((month) => <th key={month} className={month === targetMonth ? "target-month" : ""}>{month}</th>)}<th>Total Geral</th><th>Comentários</th></tr></thead><tbody>{analysis.rows.map((row) => <tr key={`${row.supplier}-${row.account}`}><td>{row.supplier}</td><td>{row.account}</td><td>{row.description}</td>{analysis.months.map((month) => <td key={month} className={month === targetMonth ? "target-month" : ""}>{row.months[month] ? money.format(row.months[month]) : "—"}</td>)}<td><b>{money.format(row.total)}</b></td><td className={row.comment.includes("Divergência") ? "comment-warning" : row.comment ? "comment-asset" : ""}>{row.comment}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>TOTAL DÉBITO</td>{analysis.months.map((month) => <td key={month}>{money.format(analysis.rows.reduce((sum, row) => sum + row.months[month], 0))}</td>)}<td>{money.format(analysis.periodTotal)}</td><td /></tr></tfoot></table></div>
    </>}
  </section>;
}
