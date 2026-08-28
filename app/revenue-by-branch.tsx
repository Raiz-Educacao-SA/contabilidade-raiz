"use client";

import { Fragment, useMemo, useState } from "react";
import { Download, RefreshCw, TrendingUp } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { applyRaizWorkbookStyle } from "@/lib/export-workbook-style";

type BranchAccountMovement = {
  branch: string;
  account: string;
  description?: string;
  movement?: number;
};

type RetrospectiveRow = {
  branch: string;
  account: string;
  description: string;
  movements: number[];
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function retrospectiveCompetences(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  return Array.from({ length: 4 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1 - (3 - offset), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const competenceLabel = (value: string) => `${value.slice(5)}/${value.slice(0, 4)}`;

export default function RevenueByBranch({ companyCode, competence, accessToken }: { companyCode: string; competence: string; accessToken: string }) {
  const [rows, setRows] = useState<RetrospectiveRow[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function update() {
    if (!companyCode || !competence || !accessToken) return;
    setLoading(true);
    setMessage("");
    try {
      const nextPeriods = retrospectiveCompetences(competence);
      const monthly = await Promise.all(nextPeriods.map(async (period) => {
        const response = await fetch(`/api/totvs/trial-balance?company=${encodeURIComponent(companyCode)}&competence=${period}&byBranch=1`, {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Não foi possível consultar ${competenceLabel(period)}.`);
        return (payload.branchAccounts || []) as BranchAccountMovement[];
      }));

      const detail = new Map<string, RetrospectiveRow>();
      monthly.forEach((items, periodIndex) => items.forEach((item) => {
        const branch = String(item.branch || "0").trim() || "0";
        const account = String(item.account || "").trim();
        if (!account.startsWith("3")) return;
        const key = `${branch}|${account}`;
        const current = detail.get(key) || {
          branch,
          account,
          description: String(item.description || "").trim(),
          movements: Array(nextPeriods.length).fill(0),
        };
        if (!current.description && item.description) current.description = String(item.description).trim();
        current.movements[periodIndex] = Number(item.movement || 0);
        detail.set(key, current);
      }));

      const generated = Array.from(detail.values()).sort((a, b) => {
        const branchOrder = Number(a.branch) - Number(b.branch);
        return branchOrder || a.account.localeCompare(b.account, "pt-BR", { numeric: true });
      });
      const branchCount = new Set(generated.map((row) => row.branch)).size;
      setPeriods(nextPeriods);
      setRows(generated);
      setMessage(generated.length ? `${branchCount} filial(is) carregada(s), com contas contábeis abertas na retrospectiva.` : "Nenhum movimento de contas iniciadas por 3 foi encontrado no período.");
    } catch (error) {
      setRows([]);
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const branches = useMemo(() => Array.from(new Set(rows.map((row) => row.branch))), [rows]);
  const totals = useMemo(() => periods.map((_, index) => rows.reduce((sum, row) => sum + (row.movements[index] || 0), 0)), [periods, rows]);
  const branchTotals = useMemo(() => new Map(branches.map((branch) => [branch, periods.map((_, index) => rows.filter((row) => row.branch === branch).reduce((sum, row) => sum + (row.movements[index] || 0), 0))])), [branches, periods, rows]);

  function exportRetrospective() {
    if (!rows.length) return;
    const data = rows.map((row) => Object.fromEntries([
      ["Filial", row.branch],
      ["Conta contábil", row.account],
      ["Descrição", row.description],
      ...periods.map((period, index) => [`Movimento ${competenceLabel(period)}`, row.movements[index] || 0]),
    ]));
    data.push(Object.fromEntries([
      ["Filial", "TOTAL"],
      ["Conta contábil", ""],
      ["Descrição", ""],
      ...periods.map((period, index) => [`Movimento ${competenceLabel(period)}`, totals[index] || 0]),
    ]));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), "Retrospectiva");
    applyRaizWorkbookStyle(workbook);
    XLSX.writeFile(workbook, `${String(companyCode).padStart(2, "0")}_Receita_por_Filial_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }

  return <section className="panel trial-analysis revenue-branch-retrospective">
    <div className="trial-analysis-actions">
      <div><h2>Retrospectiva · Receita por Filial</h2><p>Movimento mensal das contas contábeis iniciadas por 3, aberto por conta contábil e separado por filial.</p></div>
      <div className="trial-action-buttons">
        <button className={`secondary ${rows.length ? "source-loaded" : ""}`} onClick={() => void update()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} />{loading ? "Atualizando..." : "Atualizar retrospectiva"}</button>
        <button className="secondary" onClick={exportRetrospective} disabled={!rows.length}><Download />Exportar</button>
      </div>
    </div>
    {message && <div className={`notice ${!rows.length && !loading ? "error" : ""}`}>{message}</div>}
    {rows.length > 0 ? <>
      <div className="trial-summary">
        <article><span>Filiais</span><b>{branches.length}</b></article>
        <article><span>Movimento atual</span><b>{money.format(totals.at(-1) || 0)}</b></article>
        <article><span>Contas consideradas</span><b>3...</b></article>
        <article><span>Base do valor</span><b>Movimento</b></article>
      </div>
      <div className="table-wrap trial-table">
        <table>
          <thead><tr><th>Filial</th><th>Conta contábil</th><th>Descrição</th>{periods.map((period) => <th key={period}>Movimento {competenceLabel(period)}</th>)}</tr></thead>
          <tbody>
            {branches.map((branch) => {
              const branchRows = rows.filter((row) => row.branch === branch);
              const subtotals = branchTotals.get(branch) || [];
              return <Fragment key={branch}>
                <tr className="branch-group-row"><td colSpan={3 + periods.length}><b>Filial {branch}</b></td></tr>
                {branchRows.map((row) => <tr key={`${row.branch}-${row.account}`}><td>{row.branch}</td><td><b>{row.account}</b></td><td>{row.description || "—"}</td>{row.movements.map((movement, index) => <td key={`${row.branch}-${row.account}-${periods[index]}`}><b>{money.format(movement)}</b></td>)}</tr>)}
                <tr className="branch-subtotal-row"><td colSpan={3}><b>Total Filial {branch}</b></td>{subtotals.map((total, index) => <td key={`${branch}-subtotal-${periods[index]}`}><b>{money.format(total)}</b></td>)}</tr>
              </Fragment>;
            })}
          </tbody>
          <tfoot><tr><td colSpan={3}>TOTAL GERAL</td>{totals.map((total, index) => <td key={`total-${periods[index]}`}><b>{money.format(total)}</b></td>)}</tr></tfoot>
        </table>
      </div>
    </> : !loading && <div className="csc-empty"><TrendingUp /><b>Atualize para gerar a retrospectiva</b><span>A consulta usa somente contas iniciadas por 3 e o movimento de cada competência, aberto por conta e filial.</span></div>}
  </section>;
}
