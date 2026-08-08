"use client";
import { useMemo, useState } from "react";
import {
  Calculator,
  Download,
  FileCheck2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import * as XLSX from "xlsx";
type F = {
  id: string;
  ra: string;
  name: string;
  status: string;
  originalValue: number;
  discount: number;
};
type C = {
  id: string;
  ra: string;
  name: string;
  value: number;
  kind: "revenue" | "discount";
  isReversal: boolean;
  complement: string;
};
const brl = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }),
  tol = 0.01;
export default function RevenueReconciliation({
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
  const [f, setF] = useState<F[]>([]),
    [c, setC] = useState<C[]>([]),
    [fr, setFr] = useState(false),
    [cr, setCr] = useState(false),
    [loading, setLoading] = useState<"fiscal" | "accounting" | null>(null),
    [error, setError] = useState("");
  const competenceLabel = competence.split("-").reverse().join("/");
  async function update(source: "fiscal" | "accounting") {
    setLoading(source);
    setError("");
    try {
      const r = await fetch(
          `/api/totvs/revenue-reconciliation?company=${companyCode}&competence=${competence}&source=${source}`,
          {
            headers: { authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          },
        ),
        p = await r.json();
      if (!r.ok) throw new Error(p.error || "Falha ao atualizar a base.");
      if (source === "fiscal") {
        setF(p.rows || []);
        setFr(true);
      } else {
        setC(p.rows || []);
        setCr(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }
  const rows = useMemo(() => {
    const fm = new Map<
      string,
      { name: string; status: string; rev: number; disc: number }
    >();
    f.forEach((x) => {
      const a = fm.get(x.ra) || {
        name: x.name,
        status: x.status,
        rev: 0,
        disc: 0,
      };
      a.rev += x.originalValue;
      a.disc += x.discount;
      fm.set(x.ra, a);
    });
    const cm = new Map<
      string,
      { name: string; rev: number; disc: number; complements: string[] }
    >();
    c.forEach((x) => {
      const a = cm.get(x.ra) || {
        name: x.name,
        rev: 0,
        disc: 0,
        complements: [],
      };
      if (x.kind === "revenue") a.rev += x.value;
      else a.disc += x.value;
      const complement = x.complement?.trim();
      if (complement && !a.complements.includes(complement))
        a.complements.push(complement);
      cm.set(x.ra, a);
    });
    return [...new Set([...fm.keys(), ...cm.keys()])].map((ra) => {
      const a = fm.get(ra),
        b = cm.get(ra),
        dr = (b?.rev || 0) - (a?.rev || 0),
        dd = (b?.disc || 0) - (a?.disc || 0),
        status = !a
          ? "Só no Contábil"
          : !b
            ? "Só no Fiscal"
            : Math.abs(dr) <= tol && Math.abs(dd) <= tol
              ? "Conciliado"
              : "Divergente";
      return {
        ra,
        competence: competenceLabel,
        name: a?.name || b?.name || "",
        fiscalStatus: a?.status || "",
        fiscalRevenue: a?.rev || 0,
        accountingRevenue: b?.rev || 0,
        revenueDifference: dr,
        fiscalDiscount: a?.disc || 0,
        accountingDiscount: b?.disc || 0,
        discountDifference: dd,
        impact: dr - dd,
        status,
        complements: b?.complements.join(" | ") || "",
        comment:
          status !== "Divergente"
            ? status
            : Math.abs(dr) > tol && Math.abs(dd) > tol
              ? "Verificar receita e desconto"
              : Math.abs(dr) > tol
                ? "Verificar diferença de receita"
                : "Verificar diferença de desconto",
      };
    });
  }, [f, c, competenceLabel]);
  const pending = rows.filter((x) => x.status !== "Conciliado"),
    reconciled = rows.length - pending.length,
    reconciledPercentage = rows.length ? (reconciled / rows.length) * 100 : 0,
    fRev = f.reduce((s, x) => s + x.originalValue, 0),
    cRev = c
      .filter((x) => x.kind === "revenue")
      .reduce((s, x) => s + x.value, 0),
    fDisc = f.reduce((s, x) => s + x.discount, 0),
    cDisc = c
      .filter((x) => x.kind === "discount")
      .reduce((s, x) => s + x.value, 0);
  function exportDivergences() {
    const data = pending.map((x) => ({
      Status: x.status,
      RA: x.ra,
      Competência: x.competence,
      Aluno: x.name,
      "Status fiscal": x.fiscalStatus,
      "Receita fiscal": x.fiscalRevenue,
      "Receita contábil": x.accountingRevenue,
      "Diferença receita": x.revenueDifference,
      "Desconto fiscal": x.fiscalDiscount,
      "Desconto contábil": x.accountingDiscount,
      "Diferença desconto": x.discountDifference,
      Impacto: x.impact,
      Orientação: x.comment,
      "Complemento contábil": x.complements,
    }));
    const workbook = XLSX.utils.book_new(),
      worksheet = XLSX.utils.json_to_sheet(data);
    worksheet["!cols"] = [
      { wch: 16 },
      { wch: 14 },
      { wch: 13 },
      { wch: 34 },
      { wch: 16 },
      { wch: 17 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 20 },
      { wch: 16 },
      { wch: 31 },
      { wch: 58 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, "Divergências");
    XLSX.writeFile(
      workbook,
      `conciliacao-receita-${companyCode}-${competence}.xlsx`,
    );
  }
  return (
    <section className="panel revenue-panel">
      <div className="revenue-head">
        <div>
          <span className="eyebrow">CONCILIAÇÃO DE RECEITA</span>
          <h2>{companyName}</h2>
          <p>RA + competência {competenceLabel} · tolerância R$ 0,01</p>
        </div>
        <div className="revenue-actions">
          <button
            className="fiscal-button"
            disabled={loading !== null}
            onClick={() => void update("fiscal")}
          >
            <FileCheck2 />
            {loading === "fiscal" ? "Atualizando..." : "Atualizar base fiscal"}
          </button>
          <button
            className="accounting-button"
            disabled={loading !== null}
            onClick={() => void update("accounting")}
          >
            <Calculator />
            {loading === "accounting"
              ? "Atualizando..."
              : "Atualizar Base TOTVS"}
          </button>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="revenue-status">
        <article>
          <span>Receita fiscal</span>
          <b>{fr ? brl.format(fRev) : "Aguardando"}</b>
          <small>Planilha Net 53</small>
        </article>
        <article>
          <span>Receita contábil</span>
          <b>{cr ? brl.format(cRev) : "Aguardando"}</b>
          <small>Grupo 3.1.1.01.01</small>
        </article>
        <article>
          <span>Desconto fiscal × contábil</span>
          <b>
            {fr && cr
              ? `${brl.format(fDisc)} × ${brl.format(cDisc)}`
              : "Aguardando"}
          </b>
          <small>Bolsas e descontos</small>
        </article>
        <article>
          <span>Conciliados</span>
          <b>
            {fr && cr
              ? `${reconciledPercentage.toFixed(1).replace(".", ",")}%`
              : "—"}
          </b>
          <small>{fr && cr ? `${reconciled} de ${rows.length} RA` : "RA sem diferença"}</small>
        </article>
        <article className={pending.length ? "has-warning" : ""}>
          <span>Inconsistências</span>
          <b>{fr && cr ? pending.length : "—"}</b>
          <small>Para tratamento</small>
        </article>
      </div>
      {!fr || !cr ? (
        <div className="revenue-empty">
          <RefreshCw />
          <b>Atualize as duas bases</b>
          <span>O cruzamento mensal será executado por RA + competência.</span>
        </div>
      ) : pending.length ? (
        <>
          <div className="revenue-warning">
            <TriangleAlert />
            <div>
              <b>{pending.length} inconsistência(s) para tratamento</b>
              <span>Registros conciliados não aparecem na lista.</span>
            </div>
            <button className="export-revenue" onClick={exportDivergences}>
              <Download />
              Exportar Excel
            </button>
          </div>
          <div className="table-wrap revenue-table">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>RA</th>
                  <th>Competência</th>
                  <th>Aluno</th>
                  <th>Status fiscal</th>
                  <th>Receita fiscal</th>
                  <th>Receita contábil</th>
                  <th>Δ Receita</th>
                  <th>Desconto fiscal</th>
                  <th>Desconto contábil</th>
                  <th>Δ Desconto</th>
                  <th>Impacto</th>
                  <th>Orientação</th>
                  <th>Complemento contábil</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((x) => (
                  <tr key={x.ra}>
                    <td>
                      <span className="revenue-badge">{x.status}</span>
                    </td>
                    <td>
                      <b>{x.ra}</b>
                    </td>
                    <td>{x.competence}</td>
                    <td>{x.name || "—"}</td>
                    <td>{x.fiscalStatus || "—"}</td>
                    <td>{brl.format(x.fiscalRevenue)}</td>
                    <td>{brl.format(x.accountingRevenue)}</td>
                    <td
                      className={
                        Math.abs(x.revenueDifference) > tol ? "negative" : ""
                      }
                    >
                      {brl.format(x.revenueDifference)}
                    </td>
                    <td>{brl.format(x.fiscalDiscount)}</td>
                    <td>{brl.format(x.accountingDiscount)}</td>
                    <td
                      className={
                        Math.abs(x.discountDifference) > tol ? "negative" : ""
                      }
                    >
                      {brl.format(x.discountDifference)}
                    </td>
                    <td className={Math.abs(x.impact) > tol ? "negative" : ""}>
                      <b>{brl.format(x.impact)}</b>
                    </td>
                    <td>{x.comment}</td>
                    <td className="revenue-complement">
                      {x.complements || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="revenue-empty success">
          <FileCheck2 />
          <b>Bases conciliadas</b>
          <span>Nenhuma inconsistência encontrada.</span>
        </div>
      )}
    </section>
  );
}
