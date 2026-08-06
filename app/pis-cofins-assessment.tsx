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
type CancelledRow = Omit<RevenueRow, "regime"> & { status: string };
type OtherRevenueRow = {
  company: string;
  branch: string;
  entryId: string;
  document: string;
  integrationKey: string;
  sourceSystem: string;
  date: string;
  reduced: number;
  account: string;
  description: string;
  group: string;
  value: number;
  classification: string;
  taxBase: number;
  pisRate: number;
  cofinsRate: number;
  pis: number;
  cofins: number;
  user: string;
  complement: string;
  costCenter: string;
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
  const [cancelledRows, setCancelledRows] = useState<CancelledRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [classified, setClassified] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ignoredCancelled, setIgnoredCancelled] = useState(0);
  const [otherRevenueRows, setOtherRevenueRows] = useState<OtherRevenueRow[]>([]);
  const [otherRevenueLoading, setOtherRevenueLoading] = useState(false);
  const [otherRevenueLoaded, setOtherRevenueLoaded] = useState(false);
  const [otherRevenueError, setOtherRevenueError] = useState("");
  const [error, setError] = useState("");
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  const competenceLabel = competence.split("-").reverse().join("/");

  useEffect(() => {
    setActionsTarget(document.getElementById("pis-cofins-filter-actions"));
  }, []);

  useEffect(() => {
    setRows([]);
    setCancelledRows([]);
    setLoaded(false);
    setClassified(false);
    setIgnoredCancelled(0);
    setOtherRevenueRows([]);
    setOtherRevenueLoaded(false);
    setOtherRevenueError("");
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
      setCancelledRows(payload.cancelledRows || []);
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
  const otherRevenueTotals = useMemo(() => otherRevenueRows.reduce((result, row) => {
    result.accountingValue += row.value;
    result.taxBase += row.taxBase;
    result.pis += row.pis;
    result.cofins += row.cofins;
    if (row.classification === "Receita financeira") {
      result.financialBase += row.taxBase;
      result.financialPis += row.pis;
      result.financialCofins += row.cofins;
    } else if (row.classification === "Demais receitas") {
      result.otherBase += row.taxBase;
      result.otherPis += row.pis;
      result.otherCofins += row.cofins;
    } else result.unclassifiedBase += -row.value;
    return result;
  }, {
    accountingValue: 0,
    taxBase: 0,
    pis: 0,
    cofins: 0,
    financialBase: 0,
    financialPis: 0,
    financialCofins: 0,
    otherBase: 0,
    otherPis: 0,
    otherCofins: 0,
    unclassifiedBase: 0,
  }), [otherRevenueRows]);

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

  async function updateOtherRevenues() {
    setOtherRevenueLoading(true);
    setOtherRevenueError("");
    try {
      const response = await fetch(
        `/api/totvs/pis-cofins/other-revenues?company=${companyCode}&competence=${competence}`,
        { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao consultar as outras receitas no Razão Completo.");
      setOtherRevenueRows(payload.rows || []);
      setOtherRevenueLoaded(true);
    } catch (cause) {
      setOtherRevenueError((cause as Error).message);
    } finally {
      setOtherRevenueLoading(false);
    }
  }

  function exportCompleteAssessment() {
    const workbook = XLSX.utils.book_new();
    const monthly = rows.map((row) => {
      const rate = row.regime ? rates[row.regime] : null;
      return {
        Coligada: companyCode,
        Competência: competenceLabel,
        Descrição: row.service,
        Classificação: row.regime,
        "Valor bruto": row.grossRevenue,
        Descontos: row.discounts,
        "Base final (VALORNF)": row.netRevenue,
        PIS: rate ? row.netRevenue * rate.pis : 0,
        COFINS: rate ? row.netRevenue * rate.cofins : 0,
      };
    });
    const otherRevenues = otherRevenueRows.map((row) => ({
      Coligada: row.company,
      Filial: row.branch,
      Competência: competenceLabel,
      Data: row.date,
      "Cód. reduzido": row.reduced,
      Conta: row.account,
      Descrição: row.description,
      Agrupamento: row.group,
      Classificação: row.classification,
      "ID lançamento": row.entryId,
      Documento: row.document,
      Sistema: row.sourceSystem,
      Complemento: row.complement,
      "Centro de custo": row.costCenter,
      Valor: row.value,
      "Base tributável": row.taxBase,
      "Alíquota PIS": row.pisRate,
      PIS: row.pis,
      "Alíquota COFINS": row.cofinsRate,
      COFINS: row.cofins,
    }));
    const cancelled = cancelledRows.map((row) => ({
      Coligada: companyCode,
      Competência: competenceLabel,
      Descrição: row.service,
      Status: row.status,
      "Valor bruto": row.grossRevenue,
      Descontos: row.discounts,
      "VALORNF excluído": row.netRevenue,
      Tratamento: "Excluída da apuração",
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(monthly), "Faturamento mensal");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(otherRevenues), "Outras receitas");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cancelled), "Notas canceladas");
    XLSX.writeFile(workbook, `apuracao-completa-pis-cofins-${companyCode}-${competence}.xlsx`);
  }

  return (
    <section
      className={`panel tax-panel ${loading || classifying || otherRevenueLoading ? "is-processing" : ""}`}
    >
      {(loading || classifying || otherRevenueLoading) && (
        <div className="tax-processing">
          <div className="spinner" />
          <b>
            {otherRevenueLoading
              ? "Atualizando as outras receitas..."
              : loading
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
            <button className="tax-export" disabled={!classified} onClick={exportCompleteAssessment}>
              <Download /> Exportar apuração completa
            </button>
          </div>,
          actionsTarget,
        )}
      <div className="tax-section-heading"><b>Faturamento mensal</b><span>Planilha.NET 53 · ANÁLISE NF COM CONTA</span></div>
      <div>
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
      </div>
      <section className="tax-secondary-section">
        <div className="tax-section-heading">
          <div><b>Outras receitas</b><span>Razão Completo · contas definidas na aba Base contas</span></div>
          <button
            className={otherRevenueLoaded ? "tax-secondary-update is-ready" : "tax-secondary-update"}
            disabled={otherRevenueLoading || !companyCode}
            onClick={() => void updateOtherRevenues()}
          >
            <RefreshCw className={otherRevenueLoading ? "spin" : ""} />
            {otherRevenueLoading ? "Atualizando..." : "Atualizar outras receitas"}
          </button>
        </div>
        {otherRevenueError && <div className="notice error">{otherRevenueError}</div>}
        {!otherRevenueLoaded ? (
          <div className="tax-source-empty"><Calculator /><span>Atualize para carregar todos os movimentos das contas configuradas na competência selecionada.</span></div>
        ) : otherRevenueRows.length === 0 ? (
          <div className="tax-source-empty"><Calculator /><b>Sem movimento na competência</b><span>Nenhuma das contas da aba Base contas apresentou movimentação.</span></div>
        ) : (
          <>
            <div className="tax-other-summary">
              <article><span>Contas com movimento</span><b>{new Set(otherRevenueRows.map((row) => row.account)).size}</b></article>
              <article><span>Base financeira</span><b>{brl.format(otherRevenueTotals.financialBase)}</b><small>PIS 0,65% · COFINS 4,00%</small></article>
              <article><span>Base demais receitas</span><b>{brl.format(otherRevenueTotals.otherBase)}</b><small>PIS 1,65% · COFINS 7,60%</small></article>
              <article><span>PIS apurado</span><b>{brl.format(otherRevenueTotals.pis)}</b><small>{brl.format(otherRevenueTotals.financialPis)} + {brl.format(otherRevenueTotals.otherPis)}</small></article>
              <article><span>COFINS apurada</span><b>{brl.format(otherRevenueTotals.cofins)}</b><small>{brl.format(otherRevenueTotals.financialCofins)} + {brl.format(otherRevenueTotals.otherCofins)}</small></article>
              <article className={Math.abs(otherRevenueTotals.unclassifiedBase) > 0.004 ? "has-warning" : ""}><span>Sem classificação</span><b>{brl.format(otherRevenueTotals.unclassifiedBase)}</b><small>Sem cálculo automático</small></article>
            </div>
            <div className="table-wrap tax-other-table">
              <table>
                <thead><tr><th>Data</th><th>Filial</th><th>Cód. reduzido</th><th>Conta</th><th>Descrição</th><th>Agrupamento</th><th>Classificação</th><th>Base tributável</th><th>Alíquota PIS</th><th>PIS</th><th>Alíquota COFINS</th><th>COFINS</th><th>ID lançamento</th><th>Complemento</th></tr></thead>
                <tbody>{otherRevenueRows.map((row, index) => <tr key={`${row.entryId}-${row.account}-${index}`}><td>{row.date.slice(0, 10).split("-").reverse().join("/")}</td><td>{row.branch}</td><td>{row.reduced}</td><td>{row.account}</td><td>{row.description}</td><td>{row.group || ""}</td><td>{row.classification ? <span className="tax-badge">{row.classification}</span> : ""}</td><td>{row.classification ? brl.format(row.taxBase) : ""}</td><td>{row.classification ? `${(row.pisRate * 100).toFixed(2).replace(".", ",")}%` : ""}</td><td>{row.classification ? brl.format(row.pis) : ""}</td><td>{row.classification ? `${(row.cofinsRate * 100).toFixed(2).replace(".", ",")}%` : ""}</td><td>{row.classification ? brl.format(row.cofins) : ""}</td><td>{row.entryId}</td><td>{row.complement}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan={7}>Subtotal da competência</td><td>{brl.format(otherRevenueTotals.taxBase)}</td><td></td><td>{brl.format(otherRevenueTotals.pis)}</td><td></td><td>{brl.format(otherRevenueTotals.cofins)}</td><td colSpan={2}></td></tr></tfoot>
              </table>
            </div>
          </>
        )}
      </section>
      <section className="tax-secondary-section">
        <div className="tax-section-heading"><b>Notas canceladas</b><span>{cancelledRows.length} registro(s) excluído(s) da apuração</span></div>
        {cancelledRows.length ? (
          <div className="table-wrap tax-cancelled-table"><table><thead><tr><th>Competência</th><th>Descrição</th><th>Status</th><th>Valor bruto</th><th>Desconto</th><th>VALORNF excluído</th></tr></thead><tbody>{cancelledRows.map((row) => <tr key={row.line}><td>{competenceLabel}</td><td>{row.service}</td><td>{row.status}</td><td>{brl.format(row.grossRevenue)}</td><td>{brl.format(row.discounts)}</td><td>{brl.format(row.netRevenue)}</td></tr>)}</tbody></table></div>
        ) : <div className="tax-source-empty"><span>Nenhuma nota cancelada carregada para esta competência.</span></div>}
      </section>
    </section>
  );
}
