"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  Download,
  FileCheck2,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { applyRevenueWorkbookStyle } from "@/lib/revenue-export-workbook";
import {
  classifyRevenueDivergence,
  classifyRevenueReconciliation,
  consolidateFiscalRevenueRows,
  EXTRA_REVENUE_ACCOUNTS,
  isExcludedRevenueGenerationType,
  REVENUE_TOLERANCE,
  revenueReconciliationExportFileName,
  summarizeAccountingRevenue,
} from "@/lib/revenue-reconciliation";
import {
  deleteRevenueReconciliationCache,
  readRevenueReconciliationCache,
  revenueReconciliationCacheKey,
  writeRevenueReconciliationCache,
} from "@/lib/revenue-reconciliation-cache";
import {
  financialCompletionIdentity,
  MODULE_COMPLETION_CHANGED_EVENT,
  type ModuleCompletionChangeDetail,
  type ScheduleCompletion,
} from "@/lib/schedule-completion";
import { supabase } from "@/lib/supabase";
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
  complement: string;
  generationType?: string;
  account?: string;
  description?: string;
};
type RevenueView = "divergences" | "generationTypes" | "extraRevenue";
type RevenueCacheSnapshot = {
  fiscalRows: F[];
  accountingRows: C[];
  fiscalLoaded: boolean;
  accountingLoaded: boolean;
  activeView: RevenueView;
  updatedAt: string;
  finalizedAt: string;
  finalizedBy: string;
};
const brl = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }),
  tol = REVENUE_TOLERANCE;
const excelMoney = 'R$ #,##0.00;[Red]-R$ #,##0.00';
const excelPercent = '0.0%';
const excelInteger = '#,##0';
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
    [activeView, setActiveView] = useState<RevenueView>("divergences"),
    [cacheReady, setCacheReady] = useState(false),
    [restoredCacheKey, setRestoredCacheKey] = useState(""),
    [isFinalized, setIsFinalized] = useState(false),
    [finalizedAt, setFinalizedAt] = useState(""),
    [finalizedBy, setFinalizedBy] = useState(""),
    [error, setError] = useState("");
  const competenceLabel = competence.split("-").reverse().join("/");
  const cacheKey = revenueReconciliationCacheKey(companyCode, competence);
  const scheduleIdentity = useMemo(
    () => financialCompletionIdentity("receita", companyCode, companyName),
    [companyCode, companyName],
  );

  useEffect(() => {
    let active = true;
    const loadLastClosedTask = async () => {
      if (!companyCode) {
        if (active) {
          setRestoredCacheKey(cacheKey);
          setCacheReady(true);
        }
        return;
      }
      const { data, error: completionError } = await supabase
        .from("cronograma_entregas")
        .select("modulo,setor,status,confirmado_email,confirmado_em")
        .eq("competencia", competence)
        .eq("modulo", scheduleIdentity.modulo)
        .maybeSingle();
      if (!active) return;
      const completion = completionError ? null : data as ScheduleCompletion | null;
      const finalized = completion?.status === "concluido";
      const snapshot = await readRevenueReconciliationCache<RevenueCacheSnapshot>(cacheKey);
      if (!active) return;
      setIsFinalized(finalized);
      setFinalizedAt(completion?.confirmado_em || snapshot?.finalizedAt || "");
      setFinalizedBy(completion?.confirmado_email || snapshot?.finalizedBy || "");

      if (snapshot) {
        setF(Array.isArray(snapshot.fiscalRows) ? snapshot.fiscalRows : []);
        setC(Array.isArray(snapshot.accountingRows) ? snapshot.accountingRows : []);
        setFr(Boolean(snapshot.fiscalLoaded));
        setCr(Boolean(snapshot.accountingLoaded));
        setActiveView(
          snapshot.activeView === "generationTypes" ||
            snapshot.activeView === "extraRevenue"
            ? snapshot.activeView
            : "divergences",
        );
      }
      setRestoredCacheKey(cacheKey);
      setCacheReady(true);
    };

    void loadLastClosedTask();
    const channel = supabase.channel(`receita-conclusao-${competence}-${companyCode}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cronograma_entregas",
          filter: `competencia=eq.${competence}`,
        },
        () => void loadLastClosedTask(),
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [cacheKey, companyCode, competence, scheduleIdentity.modulo]);

  useEffect(() => {
    if (!cacheReady || restoredCacheKey !== cacheKey || (!fr && !cr)) return;
    const snapshot: RevenueCacheSnapshot = {
      fiscalRows: f,
      accountingRows: c,
      fiscalLoaded: fr,
      accountingLoaded: cr,
      activeView,
      updatedAt: new Date().toISOString(),
      finalizedAt,
      finalizedBy,
    };
    void writeRevenueReconciliationCache(cacheKey, snapshot).catch(() => {
      console.warn("Não foi possível salvar a última conciliação de Receita no cache local.");
    });
  }, [activeView, c, cacheKey, cacheReady, f, finalizedAt, finalizedBy, fr, cr, isFinalized, restoredCacheKey]);

  useEffect(() => {
    const handleCompletionChange = (event: Event) => {
      const detail = (event as CustomEvent<ModuleCompletionChangeDetail>).detail;
      if (
        detail?.competence !== competence ||
        !detail.moduleKeys.includes(scheduleIdentity.modulo)
      ) return;
      const finalized = detail.status === "concluido";
      setIsFinalized(finalized);
      if (detail.confirmedAt) setFinalizedAt(detail.confirmedAt);
      if (detail.userEmail) setFinalizedBy(detail.userEmail);
    };
    window.addEventListener(MODULE_COMPLETION_CHANGED_EVENT, handleCompletionChange);
    return () => window.removeEventListener(MODULE_COMPLETION_CHANGED_EVENT, handleCompletionChange);
  }, [competence, scheduleIdentity.modulo]);

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
        setActiveView("divergences");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  function clearReconciliation() {
    if (isFinalized || (!fr && !cr)) return;
    if (!window.confirm("Deseja limpar a última conciliação desta empresa e competência?")) return;
    setF([]);
    setC([]);
    setFr(false);
    setCr(false);
    setActiveView("divergences");
    setError("");
    void deleteRevenueReconciliationCache(cacheKey);
  }
  const accountingRows = useMemo(
    () =>
      c.filter(
        (entry) => !isExcludedRevenueGenerationType(entry.generationType),
      ),
    [c],
  );
  const generationTypeRows = useMemo(
    () =>
      c.filter((entry) =>
        isExcludedRevenueGenerationType(entry.generationType),
      ),
    [c],
  );
  const fiscalRows = useMemo(() => consolidateFiscalRevenueRows(f), [f]);
  const rows = useMemo(() => {
    const fm = new Map<
      string,
      { name: string; status: string; rev: number; disc: number }
    >();
    fiscalRows.forEach((x) => {
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
    const cm = summarizeAccountingRevenue(accountingRows);
    return [...new Set([...fm.keys(), ...cm.keys()])].map((ra) => {
      const a = fm.get(ra),
        b = cm.get(ra),
        accountingRevenue = b?.revenue || 0,
        extraRevenue = b?.extraRevenue || 0,
        accountingDiscount = b?.discount || 0,
        fiscalRevenue = a?.rev || 0,
        fiscalDiscount = a?.disc || 0,
        dr = accountingRevenue - fiscalRevenue,
        dd = accountingDiscount - fiscalDiscount,
        status = classifyRevenueReconciliation({
          fiscalRevenue,
          accountingRevenue,
          fiscalDiscount,
          accountingDiscount,
        });
      const classification = classifyRevenueDivergence({
        status,
        revenueDifference: dr,
        discountDifference: dd,
        extraRevenue,
      });
      return {
        ra,
        competence: competenceLabel,
        name: a?.name || b?.name || "",
        fiscalStatus: a?.status || "",
        fiscalRevenue,
        accountingRevenue,
        extraRevenue,
        revenueDifference: dr,
        fiscalDiscount,
        accountingDiscount,
        discountDifference: dd,
        impact: dr - dd,
        status,
        classification,
        extraRevenueAccounts: b?.extraRevenueAccounts.join(" | ") || "",
        generationTypes: b?.generationTypes.join(" | ") || "",
        complements: b?.complements.join(" | ") || "",
        comment:
          classification ||
          (status !== "Divergente"
            ? status
            : Math.abs(dr) > tol && Math.abs(dd) > tol
              ? "Verificar receita e desconto"
              : Math.abs(dr) > tol
                ? "Verificar diferença de receita"
                : "Verificar diferença de desconto"),
      };
    });
  }, [fiscalRows, accountingRows, competenceLabel]);
  const extraRevenueRows = rows.filter(
      (row) => row.classification === "Receitas extras",
    ),
    pending = rows.filter(
      (row) => row.status !== "Conciliado" && !row.classification,
    ),
    reconciled = rows.filter((row) => row.status === "Conciliado").length,
    treated = reconciled + extraRevenueRows.length,
    reconciledPercentage = rows.length ? (treated / rows.length) * 100 : 0,
    fRev = fiscalRows.reduce((s, x) => s + x.originalValue, 0),
    cRev = rows.reduce((sum, row) => sum + row.accountingRevenue, 0),
    extraRevenueTotal = extraRevenueRows.reduce(
      (sum, row) => sum + row.extraRevenue,
      0,
    ),
    comparableAccountingRevenue = cRev - extraRevenueRows.reduce(
      (sum, row) => sum + row.revenueDifference,
      0,
    ),
    fDisc = fiscalRows.reduce((s, x) => s + x.discount, 0),
    cDisc = rows.reduce((sum, row) => sum + row.accountingDiscount, 0);
  function exportAnalysis() {
    const generatedAt = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    const mapRow = (x: (typeof rows)[number]) => ({
      Status: x.classification || x.status,
      RA: x.ra,
      Competência: x.competence,
      Aluno: x.name,
      "Status fiscal": x.fiscalStatus,
      "Receita fiscal": x.fiscalRevenue,
      "Receita contábil": x.accountingRevenue,
      "Receitas extras": x.extraRevenue,
      "Contas de receitas extras": x.extraRevenueAccounts,
      "Diferença receita": x.revenueDifference,
      "Desconto fiscal": x.fiscalDiscount,
      "Desconto contábil": x.accountingDiscount,
      "Diferença desconto": x.discountDifference,
      Impacto: x.impact,
      Orientação: x.comment,
      "Tipo de geração": x.generationTypes,
      "Complemento contábil": x.complements,
    });
    const workbook = XLSX.utils.book_new();
    const statusCounts = [
      { status: "Conciliado", count: rows.filter((x) => x.status === "Conciliado").length },
      { status: "Receitas extras", count: extraRevenueRows.length },
      { status: "Divergente", count: pending.filter((x) => x.status === "Divergente").length },
      { status: "Só no Fiscal", count: rows.filter((x) => x.status === "Só no Fiscal").length },
      { status: "Só no Contábil", count: rows.filter((x) => x.status === "Só no Contábil").length },
    ];
    const netFiscal = fRev - fDisc;
    const netAccounting = comparableAccountingRevenue - cDisc;
    const dashboardRows: (string | number)[][] = [
      ["CONCILIAÇÃO FATURAMENTO VS RECEITA EDUCACIONAL", "", "", "", "", "", "", ""],
      ["Empresa", companyName, "Coligada", companyCode, "Competência", competenceLabel, "Gerado em", generatedAt],
      ["", "", "", "", "", "", "", ""],
      ["INDICADORES DA CONCILIAÇÃO", "", "", "", "", "", "", ""],
      ["Total de RA analisados", rows.length, "Sem divergência", treated, "Divergências", pending.length, "Taxa sem divergência", reconciledPercentage / 100],
      ["", "", "", "", "", "", "", ""],
      ["COMPARAÇÃO FINANCEIRA", "", "", "", "", "", "", ""],
      ["Indicador", "Base fiscal", "Base TOTVS", "Diferença", "", "", "", ""],
      ["Receitas de mensalidades", fRev, comparableAccountingRevenue, comparableAccountingRevenue - fRev, "", "", "", ""],
      ["Bolsas e descontos", fDisc, cDisc, cDisc - fDisc, "", "", "", ""],
      ["Receita líquida", netFiscal, netAccounting, netAccounting - netFiscal, "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["GRÁFICO COMPACTO DE CONCILIAÇÃO", "", "", "", "", "", "", ""],
      ["Status", "Quantidade", "% sobre total", "", "", "", "", ""],
      ...statusCounts.map((item) => [
        item.status,
        item.count,
        rows.length ? item.count / rows.length : 0,
        "",
        "",
        "",
        "",
        "",
      ]),
      ["", "", "", "", "", "", "", ""],
      ["LEITURA DAS BASES", "", "", "", "", "", "", ""],
      ["Base fiscal recebida", f.length, "RA fiscais considerados", fiscalRows.length, "Base contábil recebida", c.length, "Base contábil considerada", accountingRows.length],
      ["TIPOGERACAO I/E isolado", generationTypeRows.length, "", "", "", "", "", ""],
    ];
    const dashboard = XLSX.utils.aoa_to_sheet(dashboardRows);
    dashboard["!cols"] = [
      { wch: 28 },
      { wch: 18 },
      { wch: 18 },
      { wch: 32 },
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
      { s: { r: 20, c: 0 }, e: { r: 20, c: 7 } },
    ];
    setNumberFormat(dashboard, 4, 4, [1, 3, 5], excelInteger);
    setNumberFormat(dashboard, 4, 4, [7], excelPercent);
    setNumberFormat(dashboard, 8, 10, [1, 2, 3], excelMoney);
    setNumberFormat(dashboard, 14, 18, [1], excelInteger);
    setNumberFormat(dashboard, 14, 18, [2], excelPercent);
    setNumberFormat(dashboard, 21, 22, [1, 3, 5, 7], excelInteger);
    XLSX.utils.book_append_sheet(workbook, dashboard, "Dashboard");

    const appendJsonSheet = (
      sheetName: string,
      data: Record<string, string | number>[],
      columns: { wch: number }[],
    ) => {
      const worksheet = XLSX.utils.json_to_sheet(data);
      worksheet["!cols"] = columns;
      const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
      setNumberFormat(worksheet, 1, Math.max(range.e.r, 1), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13], excelMoney);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    };
    const detailColumns = [
      { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 13 }, { wch: 34 }, { wch: 16 }, { wch: 17 }, { wch: 18 },
      { wch: 18 }, { wch: 18 }, { wch: 25 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 31 }, { wch: 58 },
    ];
    appendJsonSheet("Divergências", pending.map(mapRow), detailColumns);
    appendJsonSheet(
      "Receitas Extras",
      extraRevenueRows.map(mapRow),
      detailColumns,
    );
    appendJsonSheet("Conciliados", rows.filter((x) => x.status === "Conciliado").map(mapRow), detailColumns);
    appendJsonSheet("Resumo Geral", rows.map(mapRow), detailColumns);
    appendJsonSheet(
      "Receitas Contábil",
      accountingRows.map((x) => ({
        RA: x.ra,
        Competência: competenceLabel,
        Aluno: x.name,
        Tipo: x.kind === "revenue" ? "Receita" : "Desconto",
        Valor: x.value,
        "Tipo de geração": x.generationType || "Não informado",
        Complemento: x.complement,
      })),
      [{ wch: 14 }, { wch: 13 }, { wch: 34 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 70 }],
    );
    appendJsonSheet(
      "Tipos I e E Isolados",
      generationTypeRows.map((x) => ({
        RA: x.ra,
        Competência: competenceLabel,
        Aluno: x.name,
        Conta: x.account || "",
        Descrição: x.description || "",
        Tipo: x.kind === "revenue" ? "Receita" : "Desconto",
        Valor: x.value,
        "Tipo de geração": x.generationType || "",
        Complemento: x.complement,
      })),
      [{ wch: 14 }, { wch: 13 }, { wch: 34 }, { wch: 18 }, { wch: 34 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 80 }],
    );
    appendJsonSheet(
      "Receitas Fiscal",
      fiscalRows.map((x) => ({
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
    appendJsonSheet(
      "Fiscal Fonte Bruta",
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
      ["1", "Atualizar base Fiscal", `${f.length} registro(s) carregado(s)`, "Planilha Net 53"],
      ["2", "Prioridade do status fiscal", `${fiscalRows.length} RA fiscal(is) consolidado(s)`, "Na receita, AUTORIZADA prevalece sobre NÃO ENVIADA; os descontos permanecem consolidados. Sem AUTORIZADA, mantêm-se os registros disponíveis"],
      ["3", "Atualizar base Contábil", `${c.length} lançamento(s) recebido(s)`, `${accountingRows.length} lançamento(s) considerado(s) após as segregações`],
      ["4", "Tratamento de TIPOGERACAO", `${generationTypeRows.length} lançamento(s) com tipo I ou E isolado(s)`, "TIPOGERACAO I e E ficam fora dos totais e das divergências; O permanece na análise"],
      ["5", "Cruzamento", "RA + competência", "Registros conciliados não aparecem na lista principal da tela"],
      ["6", "Tolerância", "R$ 0,01", "Diferenças acima da tolerância entram em tratamento"],
      ["7", "Receitas extras", EXTRA_REVENUE_ACCOUNTS.join(" | "), "Quando o valor dessas contas explica integralmente a diferença de receita e não há diferença de desconto, o RA sai das divergências e é isolado na sheet Receitas Extras"],
      ["8", "Exportação", "Dashboard + detalhes", "Somente a primeira linha de cada aba possui cor; as demais ficam sem preenchimento"],
    ]);
    audit["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 32 }, { wch: 55 }];
    audit["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    XLSX.utils.book_append_sheet(workbook, audit, "Auditoria");
    applyRevenueWorkbookStyle(workbook);
    XLSX.writeFile(
      workbook,
      revenueReconciliationExportFileName(
        companyCode,
        companyName,
        competenceLabel,
      ),
      { compression: true },
    );
  }
  return (
    <section className="panel revenue-panel">
      <div className="revenue-head">
        <div className="revenue-actions">
          <button
            className="fiscal-button"
            disabled={loading !== null || isFinalized}
            onClick={() => void update("fiscal")}
          >
            <FileCheck2 />
            {loading === "fiscal" ? "Atualizando..." : "Atualizar base Fiscal"}
          </button>
          <button
            className="accounting-button"
            disabled={loading !== null || isFinalized}
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
          <button
            className="secondary"
            disabled={isFinalized || (!fr && !cr) || loading !== null}
            onClick={clearReconciliation}
            title={isFinalized ? "Reabra a tarefa antes de limpar os dados." : "Limpar a conciliação desta empresa e competência"}
          >
            <Trash2 />
            Limpar
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
          {fr && cr && extraRevenueRows.length > 0 && (
            <small>{brl.format(extraRevenueTotal)} em receitas extras</small>
          )}
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
          <span>Sem divergência</span>
          <b>
            {fr && cr
              ? `${reconciledPercentage.toFixed(1).replace(".", ",")}%`
              : "—"}
          </b>
          <small>{fr && cr ? `${treated} de ${rows.length} RA` : "RA sem diferença"}</small>
          <div
            className="revenue-progress"
            role="progressbar"
            aria-label="Percentual sem divergência"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={fr && cr ? Math.round(reconciledPercentage) : 0}
          >
            <span
              style={{
                width: `${fr && cr ? Math.min(100, Math.max(0, reconciledPercentage)) : 0}%`,
              }}
            />
          </div>
        </article>
        <article className={pending.length ? "has-warning" : ""}>
          <span>Inconsistências</span>
          <b>{fr && cr ? pending.length : "—"}</b>
          <small>Para tratamento</small>
        </article>
        <article className={generationTypeRows.length ? "has-generation" : ""}>
          <span>Tipos de geração I/E isolados</span>
          <b>{fr && cr ? generationTypeRows.length : "—"}</b>
          <small>Desconsiderados da análise</small>
        </article>
      </div>
      {fr && cr && (
        <div className="revenue-view-tabs" role="tablist" aria-label="Visualizações da conciliação de receita">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "divergences"}
            className={activeView === "divergences" ? "active" : ""}
            onClick={() => setActiveView("divergences")}
          >
            <TriangleAlert /> Divergências <span>{pending.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "extraRevenue"}
            className={activeView === "extraRevenue" ? "active" : ""}
            onClick={() => setActiveView("extraRevenue")}
          >
            <FileCheck2 /> Receitas extras isoladas{" "}
            <span>{extraRevenueRows.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "generationTypes"}
            className={activeView === "generationTypes" ? "active" : ""}
            onClick={() => setActiveView("generationTypes")}
          >
            <FileCheck2 /> Tipos de geração I/E desconsiderados{" "}
            <span>{generationTypeRows.length}</span>
          </button>
        </div>
      )}
      {!fr || !cr ? (
        <div className="revenue-empty">
          <RefreshCw />
          <b>Atualize as duas bases</b>
          <span>O cruzamento mensal será executado por RA + competência.</span>
        </div>
      ) : activeView === "extraRevenue" ? (
        extraRevenueRows.length ? (
          <>
            <div className="revenue-warning is-generation">
              <FileCheck2 />
              <div>
                <b>{extraRevenueRows.length} receita(s) extra(s) isolada(s)</b>
                <span>
                  As contas {EXTRA_REVENUE_ACCOUNTS.join(" e ")} explicam
                  integralmente a diferença. Estes valores não compõem as
                  inconsistências.
                </span>
              </div>
            </div>
            <div className="table-wrap revenue-table revenue-generation-table">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>RA</th>
                    <th>Competência</th>
                    <th>Aluno</th>
                    <th>Status fiscal</th>
                    <th>Conta</th>
                    <th>Receita fiscal</th>
                    <th>Receita contábil</th>
                    <th>Valor isolado</th>
                    <th>Complemento contábil</th>
                  </tr>
                </thead>
                <tbody>
                  {extraRevenueRows.map((row) => (
                    <tr key={row.ra}>
                      <td>
                        <span className="revenue-badge generation">
                          Receitas extras
                        </span>
                      </td>
                      <td><b>{row.ra}</b></td>
                      <td>{row.competence}</td>
                      <td>{row.name || "—"}</td>
                      <td>{row.fiscalStatus || "—"}</td>
                      <td>{row.extraRevenueAccounts || "—"}</td>
                      <td>{brl.format(row.fiscalRevenue)}</td>
                      <td>{brl.format(row.accountingRevenue)}</td>
                      <td><b>{brl.format(row.extraRevenue)}</b></td>
                      <td className="revenue-complement">
                        {row.complements || "—"}
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
            <b>Nenhuma receita extra identificada</b>
            <span>Não há valores dessa conta para isolar nesta competência.</span>
          </div>
        )
      ) : activeView === "generationTypes" ? (
        generationTypeRows.length ? (
          <>
            <div className="revenue-warning is-generation">
              <FileCheck2 />
              <div>
                <b>
                  {generationTypeRows.length} lançamento(s) com tipo de geração I/E
                  desconsiderado(s)
                </b>
                <span>
                  Lançamentos com TIPOGERACAO I ou E ficam fora dos totais e da
                  lista de divergências. O tipo O permanece na análise.
                </span>
              </div>
            </div>
            <div className="table-wrap revenue-table revenue-generation-table">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>RA</th>
                    <th>Competência</th>
                    <th>Aluno</th>
                    <th>Conta</th>
                    <th>Descrição</th>
                    <th>Tipo</th>
                    <th>Tipo de geração</th>
                    <th>Valor</th>
                    <th>Complemento contábil</th>
                  </tr>
                </thead>
                <tbody>
                  {generationTypeRows.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <span className="revenue-badge generation">
                          Desconsiderado
                        </span>
                      </td>
                      <td><b>{entry.ra}</b></td>
                      <td>{competenceLabel}</td>
                      <td>{entry.name || "—"}</td>
                      <td>{entry.account || "—"}</td>
                      <td>{entry.description || "—"}</td>
                      <td>{entry.kind === "revenue" ? "Receita" : "Desconto"}</td>
                      <td><b>{entry.generationType}</b></td>
                      <td>{brl.format(entry.value)}</td>
                      <td className="revenue-complement">{entry.complement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="revenue-empty success">
            <FileCheck2 />
            <b>Nenhum tipo de geração I/E identificado</b>
            <span>Não há TIPOGERACAO I ou E nesta competência.</span>
          </div>
        )
      ) : pending.length ? (
        <>
          <div className="revenue-warning">
            <TriangleAlert />
            <div>
              <b>{pending.length} inconsistência(s) para tratamento</b>
              <span>Registros conciliados não aparecem na lista.</span>
            </div>
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
                  <th>Tipo de geração</th>
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
                    <td>{x.generationTypes || "Não informado"}</td>
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
