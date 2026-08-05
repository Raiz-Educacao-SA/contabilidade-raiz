"use client";

import { useMemo, useState } from "react";
import { Calculator, Download, RefreshCw, TriangleAlert } from "lucide-react";
import * as XLSX from "xlsx";

type TaxRegime = "Cumulativo" | "Não-Cumulativo" | "";
type RevenueRow = {
  service: string;
  grossRevenue: number;
  discounts: number;
  netRevenue: number;
  regime: TaxRegime;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const rates = {
  Cumulativo: { pis: 0.0065, cofins: 0.03 },
  "Não-Cumulativo": { pis: 0.0165, cofins: 0.076 },
} as const;

export default function PisCofinsAssessment({
  companyCode,
  companyName,
  competence,
  accessToken,
}: {
  companyCode: string;
  companyName: string;
  competence: string;
  accessToken: string;
}) {
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [classified, setClassified] = useState(false);
  const [ignoredCancelled, setIgnoredCancelled] = useState(0);
  const [error, setError] = useState("");
  const competenceLabel = competence.split("-").reverse().join("/");

  async function update() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/totvs/pis-cofins?company=${companyCode}&competence=${competence}`,
        { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao consultar a Planilha.NET 53.");
      setRows(payload.rows || []);
      setIgnoredCancelled(payload.ignoredCancelled || 0);
      setLoaded(true);
      setClassified(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    const result = {
      cumulativeBase: 0,
      nonCumulativeBase: 0,
      unclassifiedBase: 0,
      pis: 0,
      cofins: 0,
    };
    rows.forEach((row) => {
      if (row.regime === "Cumulativo") {
        result.cumulativeBase += row.netRevenue;
        result.pis += row.netRevenue * rates.Cumulativo.pis;
        result.cofins += row.netRevenue * rates.Cumulativo.cofins;
      } else if (row.regime === "Não-Cumulativo") {
        result.nonCumulativeBase += row.netRevenue;
        result.pis += row.netRevenue * rates["Não-Cumulativo"].pis;
        result.cofins += row.netRevenue * rates["Não-Cumulativo"].cofins;
      } else result.unclassifiedBase += row.netRevenue;
    });
    return result;
  }, [rows]);

  const unclassified = rows.filter((row) => !row.regime);

  function exportExcel() {
    const data = rows.map((row) => {
      const rate = row.regime ? rates[row.regime] : null;
      return {
        Coligada: companyCode,
        Competência: competenceLabel,
        Serviço: row.service,
        Classificação: row.regime,
        "Receita bruta": row.grossRevenue,
        "Bolsas/Descontos": row.discounts,
        "Base líquida": row.netRevenue,
        "Alíquota PIS": rate?.pis ?? 0,
        PIS: rate ? row.netRevenue * rate.pis : 0,
        "Alíquota COFINS": rate?.cofins ?? 0,
        COFINS: rate ? row.netRevenue * rate.cofins : 0,
      };
    });
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet["!cols"] = [10, 13, 38, 20, 18, 18, 18, 15, 18, 18, 18].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, worksheet, "Apuração PIS COFINS");
    XLSX.writeFile(workbook, `pis-cofins-coligada-${companyCode}-${competence}.xlsx`);
  }

  return (
    <section className="panel tax-panel">
      <div className="tax-head">
        <div>
          <span className="eyebrow">APURAÇÃO DE PIS E COFINS</span>
          <h2>{companyName}</h2>
          <p>Planilha.NET 53 · competência {competenceLabel} · classificação por serviço</p>
        </div>
        <div className="tax-actions">
          <button className={loaded ? "tax-source-ready" : ""} disabled={loading || !companyCode} onClick={() => void update()}>
            <RefreshCw className={loading ? "spin" : ""} />
            {loading ? "Atualizando..." : "Atualizar base fiscal"}
          </button>
          <button className={classified ? "tax-source-ready" : "tax-classify"} disabled={!loaded || loading} onClick={() => setClassified(true)}>
            <Calculator /> Classificar
          </button>
          <button className="tax-export" disabled={!classified} onClick={exportExcel}>
            <Download /> Exportar Excel
          </button>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="tax-summary">
        <article><span>Base cumulativa</span><b>{classified ? brl.format(totals.cumulativeBase) : "Aguardando"}</b><small>PIS 0,65% · COFINS 3%</small></article>
        <article><span>Base não cumulativa</span><b>{classified ? brl.format(totals.nonCumulativeBase) : "Aguardando"}</b><small>PIS 1,65% · COFINS 7,6%</small></article>
        <article className={classified && totals.unclassifiedBase ? "has-warning" : ""}><span>Sem classificação</span><b>{classified ? brl.format(totals.unclassifiedBase) : "—"}</b><small>{classified ? `${unclassified.length} serviço(s)` : "Aguardando classificação"}</small></article>
        <article><span>PIS calculado</span><b>{classified ? brl.format(totals.pis) : "—"}</b><small>Antes de créditos</small></article>
        <article><span>COFINS calculada</span><b>{classified ? brl.format(totals.cofins) : "—"}</b><small>Antes de créditos</small></article>
      </div>
      {!loaded ? (
        <div className="tax-empty"><Calculator /><b>Atualize a Planilha.NET 53</b><span>As receitas serão agrupadas por serviço e competência.</span></div>
      ) : !classified ? (
        <div className="tax-empty"><Calculator /><b>Base fiscal atualizada</b><span>Clique em Classificar para aplicar a matriz cumulativa e não cumulativa.</span></div>
      ) : (
        <>
          <div className="tax-view-heading">
            <div><b>Visão da classificação no sistema</b><span>{rows.length} serviço(s) na competência {competenceLabel}</span></div>
            <span>{ignoredCancelled} registro(s) cancelado(s) desconsiderado(s)</span>
          </div>
          {unclassified.length > 0 && <div className="tax-warning"><TriangleAlert /><div><b>{unclassified.length} serviço(s) sem classificação</b><span>A classificação permanece em branco e esses valores não entram no cálculo de PIS ou COFINS.</span></div></div>}
          <div className="table-wrap tax-table">
            <table>
              <thead><tr><th>Competência</th><th>Serviço</th><th>Classificação</th><th>Receita bruta</th><th>Bolsas/Descontos</th><th>Base líquida</th><th>PIS</th><th>COFINS</th></tr></thead>
              <tbody>{rows.map((row) => {
                const rate = row.regime ? rates[row.regime] : null;
                return <tr key={`${row.service}-${row.regime}`}><td>{competenceLabel}</td><td><b>{row.service}</b></td><td>{row.regime ? <span className="tax-badge">{row.regime}</span> : ""}</td><td>{brl.format(row.grossRevenue)}</td><td>{brl.format(row.discounts)}</td><td><b>{brl.format(row.netRevenue)}</b></td><td>{rate ? brl.format(row.netRevenue * rate.pis) : ""}</td><td>{rate ? brl.format(row.netRevenue * rate.cofins) : ""}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </>
      )}
      <p className="tax-note">Cálculo preliminar sobre a receita líquida, antes de créditos, retenções e demais ajustes fiscais. A validação final permanece sob responsabilidade da área fiscal.</p>
    </section>
  );
}
