"use client";

import { useMemo, useState } from "react";
import { Download, RefreshCw, TrendingUp } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { applyRaizWorkbookStyle } from "@/lib/export-workbook-style";

type BranchMovement = { branch: string; movement?: number; revenue?: number };
type RetrospectiveRow = { branch: string; movements: number[] };

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
    setLoading(true); setMessage("");
    try {
      const nextPeriods = retrospectiveCompetences(competence);
      const monthly = await Promise.all(nextPeriods.map(async (period) => {
        const response = await fetch(`/api/totvs/trial-balance?company=${encodeURIComponent(companyCode)}&competence=${period}&byBranch=1`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Não foi possível consultar ${competenceLabel(period)}.`);
        return (payload.branches || []) as BranchMovement[];
      }));
      const branches = new Map<string, RetrospectiveRow>();
      monthly.forEach((items, periodIndex) => items.forEach((item) => {
        const branch = String(item.branch || "0").trim() || "0";
        const current = branches.get(branch) || { branch, movements: Array(nextPeriods.length).fill(0) };
        current.movements[periodIndex] = Number(item.movement ?? item.revenue ?? 0);
        branches.set(branch, current);
      }));
      const generated = Array.from(branches.values()).sort((a, b) => Number(a.branch) - Number(b.branch));
      setPeriods(nextPeriods); setRows(generated);
      setMessage(generated.length ? `${generated.length} filial(is) carregada(s) na retrospectiva.` : "Nenhum movimento de contas iniciadas por 3 foi encontrado no período.");
    } catch (error) { setRows([]); setMessage((error as Error).message); }
    finally { setLoading(false); }
  }

  const totals = useMemo(() => periods.map((_, index) => rows.reduce((sum, row) => sum + (row.movements[index] || 0), 0)), [periods, rows]);

  function exportRetrospective() {
    if (!rows.length) return;
    const data = rows.map((row) => Object.fromEntries([["Filial", row.branch], ...periods.map((period, index) => [`Movimento ${competenceLabel(period)}`, row.movements[index] || 0])]));
    data.push(Object.fromEntries([["Filial", "TOTAL"], ...periods.map((period, index) => [`Movimento ${competenceLabel(period)}`, totals[index] || 0])]));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), "Retrospectiva");
    applyRaizWorkbookStyle(workbook);
    XLSX.writeFile(workbook, `${String(companyCode).padStart(2, "0")}_Receita_por_Filial_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }

  return <section className="panel trial-analysis revenue-branch-retrospective">
    <div className="trial-analysis-actions">
      <div><h2>Retrospectiva · Receita por Filial</h2><p>Movimento mensal das contas contábeis iniciadas por 3, separado por filial.</p></div>
      <div className="trial-action-buttons">
        <button className={`secondary ${rows.length ? "source-loaded" : ""}`} onClick={() => void update()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} />{loading ? "Atualizando..." : "Atualizar retrospectiva"}</button>
        <button className="secondary" onClick={exportRetrospective} disabled={!rows.length}><Download />Exportar</button>
      </div>
    </div>
    {message && <div className={`notice ${!rows.length && !loading ? "error" : ""}`}>{message}</div>}
    {rows.length > 0 ? <>
      <div className="trial-summary">
        <article><span>Filiais</span><b>{rows.length}</b></article>
        <article><span>Movimento atual</span><b>{money.format(totals.at(-1) || 0)}</b></article>
        <article><span>Contas consideradas</span><b>3...</b></article>
        <article><span>Base do valor</span><b>Movimento</b></article>
      </div>
      <div className="table-wrap trial-table"><table><thead><tr><th>Filial</th>{periods.map((period) => <th key={period}>Movimento {competenceLabel(period)}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.branch}><td><b>{row.branch}</b></td>{row.movements.map((movement, index) => <td key={`${row.branch}-${periods[index]}`}><b>{money.format(movement)}</b></td>)}</tr>)}</tbody><tfoot><tr><td>TOTAL</td>{totals.map((total, index) => <td key={`total-${periods[index]}`}><b>{money.format(total)}</b></td>)}</tr></tfoot></table></div>
    </> : !loading && <div className="csc-empty"><TrendingUp /><b>Atualize para gerar a retrospectiva</b><span>A consulta usa somente contas iniciadas por 3 e o movimento de cada competência.</span></div>}
  </section>;
}
