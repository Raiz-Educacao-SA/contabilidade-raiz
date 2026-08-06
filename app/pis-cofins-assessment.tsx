"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator, ChevronDown, ChevronUp, Download, RefreshCw, TriangleAlert } from "lucide-react";
import * as XLSX from "xlsx";

type TaxRegime = "Cumulativo" | "Não-Cumulativo" | "";
type RevenueRow = {
  line: number;
  service: string;
  grossRevenue: number;
  discounts: number;
  netRevenue: number;
  regime: TaxRegime;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const rates = {
  Cumulativo: { pis: 0.0065, cofins: 0.03 },
  "Não-Cumulativo": { pis: 0.0165, cofins: 0.076 },
} as const;

export default function PisCofinsAssessment({
  companyCode,
  competence,
  accessToken,
}: {
  companyCode: string;
  competence: string;
  accessToken: string;
}) {
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [classified, setClassified] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ignoredCancelled, setIgnoredCancelled] = useState(0);
  const [error, setError] = useState("");
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  const competenceLabel = competence.split("-").reverse().join("/");

  useEffect(() => {
    setActionsTarget(document.getElementById("pis-cofins-filter-actions"));
  }, []);

  useEffect(() => {
    setRows([]);
    setLoaded(false);
    setClassified(false);
    setIgnoredCancelled(0);
    setError("");
  }, [companyCode, competence]);

  async function update() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/totvs/pis-cofins?company=${companyCode}&competence=${competence}`,
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
      setRows(payload.rows || []);
      setIgnoredCancelled(payload.ignoredCancelled || 0);
      setLoaded(true);
      setClassified(false);
      setDetailsOpen(false);
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
    rows.forEach((row) => {
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
  }, [rows]);

  const unclassified = rows.filter((row) => !row.regime);

  function classify() {
    setClassifying(true);
    window.requestAnimationFrame(() =>
      window.setTimeout(() => {
        setClassified(true);
        setClassifying(false);
      }, 120),
    );
  }

  function exportExcel() {
    const data = rows.map((row) => {
      const rate = row.regime ? rates[row.regime] : null;
      return {
        Coligada: companyCode,
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

  return (
    <section
      className={`panel tax-panel ${loading || classifying ? "is-processing" : ""}`}
    >
      {(loading || classifying) && (
        <div className="tax-processing">
          <div className="spinner" />
          <b>
            {loading
              ? "Atualizando a base faturamento..."
              : "Classificando e calculando PIS e COFINS..."}
          </b>
          <span>Aguarde até o processamento ser concluído.</span>
        </div>
      )}
      {actionsTarget &&
        createPortal(
          <div className="tax-actions">
            <button
              className={loaded ? "tax-source-ready" : ""}
              disabled={loading || !companyCode}
              onClick={() => void update()}
            >
              <RefreshCw className={loading ? "spin" : ""} />
              {loading ? "Atualizando..." : "Atualizar faturamento"}
            </button>
            <button
              className={classified ? "tax-source-ready" : "tax-classify"}
              disabled={!loaded || loading || classifying}
              onClick={classify}
            >
              <Calculator /> {classifying ? "Classificando..." : "Classificar"}
            </button>
          </div>,
          actionsTarget,
        )}
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
              <button className="tax-detail-export" onClick={exportExcel}>
                <Download /> Exportar Excel
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
                {rows.map((row) => {
                  const rate = row.regime ? rates[row.regime] : null;
                  return (
                    <tr key={row.line}>
                      <td>{row.line}</td>
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
                  <td colSpan={4}>Subtotal da competência</td>
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
    </section>
  );
}
