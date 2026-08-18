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
const excelMoney = 'R$ #,##0.00;[Red]-R$ #,##0.00';
const excelPercent = '0.0%';
const excelColors = {
  navy: "14213D",
  blue: "2F80C0",
  paleBlue: "F3F8FE",
  white: "FFFFFF",
};
type StyledCell = XLSX.CellObject & { s?: unknown };
type SheetStyle = NonNullable<StyledCell["s"]>;
function setCellStyle(worksheet: XLSX.WorkSheet, address: string, style: SheetStyle) {
  const cell = worksheet[address] as StyledCell | undefined;
  if (cell) cell.s = style;
}
function styleRange(
  worksheet: XLSX.WorkSheet,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
  style: SheetStyle,
) {
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      setCellStyle(worksheet, XLSX.utils.encode_cell({ r: row, c: col }), style);
    }
  }
}
function setNumberFormat(
  worksheet: XLSX.WorkSheet,
  rowStart: number,
  rowEnd: number,
  columns: number[],
  format: string,
) {
  for (let row = rowStart; row <= rowEnd; row += 1) {
    columns.forEach((column) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
      if (cell?.t === "n") cell.z = format;
    });
  }
}
function compactBar(percent: number) {
  const safe = Math.max(0, Math.min(100, percent));
  const filled = Math.round(safe / 5);
  return `${"█".repeat(filled)}${"░".repeat(20 - filled)} ${safe.toFixed(1).replace(".", ",")}%`;
}
function compactPercentBar(percent: number) {
  const safe = Math.max(0, Math.min(100, percent));
  const filled = Math.round(safe / 5);
  return `${"#".repeat(filled)}${".".repeat(20 - filled)} ${safe.toFixed(1).replace(".", ",")}%`;
}
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
  function exportAnalysis() {
    const generatedAt = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    const mapRow = (x: (typeof rows)[number]) => ({
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
    });
    const workbook = XLSX.utils.book_new();
    const border = {
      top: { style: "thin", color: { rgb: "D9E2EF" } },
      bottom: { style: "thin", color: { rgb: "D9E2EF" } },
      left: { style: "thin", color: { rgb: "D9E2EF" } },
      right: { style: "thin", color: { rgb: "D9E2EF" } },
    };
    const titleStyle = {
      font: { name: "Arial", sz: 13, bold: true, color: { rgb: excelColors.white } },
      fill: { fgColor: { rgb: excelColors.navy } },
      alignment: { horizontal: "center", vertical: "center" },
      border,
    };
    const sectionStyle = {
      font: { name: "Arial", sz: 10, bold: true, color: { rgb: excelColors.white } },
      fill: { fgColor: { rgb: excelColors.blue } },
      alignment: { horizontal: "center", vertical: "center" },
      border,
    };
    const headerStyle = {
      font: { name: "Arial", sz: 10, bold: true, color: { rgb: excelColors.white } },
      fill: { fgColor: { rgb: excelColors.navy } },
      alignment: { horizontal: "center", vertical: "center" },
      border,
    };
    const cardStyle = {
      font: { name: "Arial", sz: 10, bold: true, color: { rgb: excelColors.navy } },
      fill: { fgColor: { rgb: excelColors.paleBlue } },
      alignment: { vertical: "center" },
      border,
    };
    const statusCounts = [
      { status: "Conciliado", count: rows.filter((x) => x.status === "Conciliado").length },
      { status: "Divergente", count: rows.filter((x) => x.status === "Divergente").length },
      { status: "Só no Fiscal", count: rows.filter((x) => x.status === "Só no Fiscal").length },
      { status: "Só no Contábil", count: rows.filter((x) => x.status === "Só no Contábil").length },
    ];
    const netFiscal = fRev - fDisc;
    const netAccounting = cRev - cDisc;
    const dashboardRows: (string | number)[][] = [
      ["CONCILIAÇÃO FATURAMENTO VS RECEITA EDUCACIONAL", "", "", "", "", "", "", ""],
      ["Empresa", companyName, "Coligada", companyCode, "Competência", competenceLabel, "Gerado em", generatedAt],
      ["", "", "", "", "", "", "", ""],
      ["INDICADORES DA CONCILIAÇÃO", "", "", "", "", "", "", ""],
      ["Total de RA analisados", rows.length, "Conciliados", reconciled, "Divergências", pending.length, "Taxa de conciliação", reconciledPercentage / 100],
      ["", "", "", "", "", "", "", ""],
      ["COMPARAÇÃO FINANCEIRA", "", "", "", "", "", "", ""],
      ["Indicador", "Base fiscal", "Base TOTVS", "Diferença", "", "", "", ""],
      ["Receitas de mensalidades", fRev, cRev, cRev - fRev, "", "", "", ""],
      ["Bolsas e descontos", fDisc, cDisc, cDisc - fDisc, "", "", "", ""],
      ["Receita líquida", netFiscal, netAccounting, netAccounting - netFiscal, "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["GRÁFICO COMPACTO DE CONCILIAÇÃO", "", "", "", "", "", "", ""],
      ["Status", "Quantidade", "% sobre total", "Visual", "", "", "", ""],
      ...statusCounts.map((item) => [
        item.status,
        item.count,
        rows.length ? item.count / rows.length : 0,
        compactPercentBar(rows.length ? (item.count / rows.length) * 100 : 0),
        "",
        "",
        "",
        "",
      ]),
      ["", "", "", "", "", "", "", ""],
      ["LEITURA DAS BASES", "", "", "", "", "", "", ""],
      ["Base fiscal", f.length, "Base contábil", c.length, "Chave", "RA + Competência", "Tolerância", "R$ 0,01"],
    ];
    const dashboard = XLSX.utils.aoa_to_sheet(dashboardRows);
    dashboard["!cols"] = [
      { wch: 28 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 24 },
    ];
    dashboard["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } },
      { s: { r: 6, c: 0 }, e: { r: 6, c: 7 } },
      { s: { r: 12, c: 0 }, e: { r: 12, c: 7 } },
      { s: { r: 19, c: 0 }, e: { r: 19, c: 7 } },
    ];
    styleRange(dashboard, 0, 0, 0, 7, titleStyle);
    styleRange(dashboard, 3, 3, 0, 7, sectionStyle);
    styleRange(dashboard, 6, 6, 0, 7, sectionStyle);
    styleRange(dashboard, 12, 12, 0, 7, sectionStyle);
    styleRange(dashboard, 19, 19, 0, 7, sectionStyle);
    styleRange(dashboard, 4, 4, 0, 7, cardStyle);
    styleRange(dashboard, 7, 7, 0, 3, headerStyle);
    styleRange(dashboard, 13, 13, 0, 3, headerStyle);
    setNumberFormat(dashboard, 4, 4, [7], excelPercent);
    setNumberFormat(dashboard, 8, 10, [1, 2, 3], excelMoney);
    setNumberFormat(dashboard, 14, 17, [2], excelPercent);
    XLSX.utils.book_append_sheet(workbook, dashboard, "Dashboard");

    const appendJsonSheet = (
      sheetName: string,
      data: Record<string, string | number>[],
      columns: { wch: number }[],
    ) => {
      const worksheet = XLSX.utils.json_to_sheet(data);
      worksheet["!cols"] = columns;
      const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
      styleRange(worksheet, 0, 0, range.s.c, range.e.c, headerStyle);
      setNumberFormat(worksheet, 1, Math.max(range.e.r, 1), [4, 5, 6, 7, 8, 9, 10, 11], excelMoney);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    };
    const detailColumns = [
      { wch: 16 }, { wch: 14 }, { wch: 13 }, { wch: 34 }, { wch: 16 }, { wch: 17 }, { wch: 18 },
      { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 31 }, { wch: 58 },
    ];
    appendJsonSheet("Divergências", pending.map(mapRow), detailColumns);
    appendJsonSheet("Conciliados", rows.filter((x) => x.status === "Conciliado").map(mapRow), detailColumns);
    appendJsonSheet("Resumo Geral", rows.map(mapRow), detailColumns);
    appendJsonSheet(
      "Receitas Contábil",
      c.map((x) => ({
        RA: x.ra,
        Competência: competenceLabel,
        Aluno: x.name,
        Tipo: x.kind === "revenue" ? "Receita" : "Desconto",
        Valor: x.value,
        Estorno: x.isReversal ? "Sim" : "Não",
        Complemento: x.complement,
      })),
      [{ wch: 14 }, { wch: 13 }, { wch: 34 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 70 }],
    );
    appendJsonSheet(
      "Receitas Fiscal",
      f.map((x) => ({
        RA: x.ra,
        Competência: competenceLabel,
        Aluno: x.name,
        Status: x.status,
        "Valor original": x.originalValue,
        Bolsa: x.discount,
        "Valor líquido": x.originalValue - x.discount,
      })),
      [{ wch: 14 }, { wch: 13 }, { wch: 34 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 }],
    );
    const audit = XLSX.utils.aoa_to_sheet([
      ["AUDITORIA DA CONCILIAÇÃO", "", "", ""],
      ["Etapa", "Regra", "Resultado", "Observação"],
      ["1", "Atualizar base fiscal", `${f.length} registro(s) carregado(s)`, "Planilha Net 53"],
      ["2", "Atualizar Base TOTVS", `${c.length} lançamento(s) carregado(s)`, "Grupo contábil parametrizado na API"],
      ["3", "Cruzamento", "RA + competência", "Registros conciliados não aparecem na lista principal da tela"],
      ["4", "Tolerância", "R$ 0,01", "Diferenças acima da tolerância entram em tratamento"],
      ["5", "Exportação", "Dashboard + detalhes", "Layout padronizado com títulos azuis e quadros"],
    ]);
    audit["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 32 }, { wch: 55 }];
    audit["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    styleRange(audit, 0, 0, 0, 3, titleStyle);
    styleRange(audit, 1, 1, 0, 3, headerStyle);
    XLSX.utils.book_append_sheet(workbook, audit, "Auditoria");
    XLSX.writeFile(
      workbook,
      `${String(companyCode).padStart(2, "0")}_${companyName.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "")}_Faturamento_VS_Educacional_${competenceLabel.replace("/", ".")}.xlsx`,
      { compression: true },
    );
  }
  return (
    <section className="panel revenue-panel">
      <div className="revenue-head">
        <div className="revenue-actions">
          <button
            className="fiscal-button"
            disabled={loading !== null}
            onClick={() => void update("fiscal")}
          >
            <FileCheck2 />
            {loading === "fiscal" ? "Atualizando..." : "Atualizar base Fiscal"}
          </button>
          <button
            className="accounting-button"
            disabled={loading !== null}
            onClick={() => void update("accounting")}
          >
            <Calculator />
            {loading === "accounting"
              ? "Atualizando..."
              : "Atualizar base Contábil"}
          </button>
          <button
            className="export-revenue"
            disabled={!fr || !cr || loading !== null}
            onClick={exportAnalysis}
            title={
              fr && cr
                ? "Exportar análise completa"
                : "Atualize as duas bases antes de exportar"
            }
          >
            <Download />
            Exportar
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
            <button className="export-revenue" onClick={exportAnalysis}>
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
