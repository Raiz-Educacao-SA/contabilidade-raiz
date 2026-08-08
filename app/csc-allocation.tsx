"use client";
import { useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, Download, RefreshCw, SlidersHorizontal } from "lucide-react";
import * as XLSX from "xlsx";

type Company = { code: string; name: string };
type Balance = { account: string; movement: number; debit: number; credit: number };
type Row = { code: string; name: string; revenue: number; share: number; rule: string; calculated: number; adjustment: number; finalValue: number };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const normalize = (value: string) => String(Number(value));

export default function CscAllocation({ companies, selectedCompanyCode, competence, accessToken }: { companies: Company[]; selectedCompanyCode: string; competence: string; accessToken: string }) {
  const list = useMemo(() => Array.from(new Map(companies.map((x) => ({ ...x, code: normalize(x.code) })).filter((x) => x.code !== "0").map((x) => [x.code, x])).values()), [companies]);
  const storageKey = `csc-allocation:${competence}`;
  const [costPool, setCostPool] = useState(0);
  const [revenues, setRevenues] = useState<Record<string, number>>({});
  const [sarahRate, setSarahRate] = useState(Number(competence.slice(0, 4)) >= 2025 ? .08 : .075);
  const [apogeu, setApogeu] = useState(0);
  const [integra, setIntegra] = useState(0);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<"cost" | "revenue" | "">("");
  const [message, setMessage] = useState("");
  const [parameters, setParameters] = useState(false);
  const [view, setView] = useState<"allocation" | "rules">("allocation");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!saved) { setCostPool(0); setRevenues({}); setAdjustments({}); setRows([]); return; }
      setCostPool(saved.costPool || 0); setRevenues(saved.revenues || {}); setSarahRate(saved.sarahRate ?? .08); setApogeu(saved.apogeu || 0); setIntegra(saved.integra || 0); setAdjustments(saved.adjustments || {}); setRows(saved.rows || []);
    } catch { localStorage.removeItem(storageKey); }
  }, [storageKey]);

  async function balance(company: string) {
    const response = await fetch(`/api/totvs/trial-balance?company=${company}&competence=${competence}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível consultar o balancete.");
    return (payload.rows || []) as Balance[];
  }
  const costValue = (data: Balance[]) => round(data.filter((x) => /^(4|5|6)\./.test(x.account)).reduce((sum, x) => sum + Math.abs(x.movement || x.debit - x.credit), 0));
  const revenueValue = (data: Balance[]) => round(data.filter((x) => /^3\./.test(x.account)).reduce((sum, x) => sum + Math.abs(x.movement || x.credit - x.debit), 0));

  async function updateCosts() {
    setLoading("cost"); setMessage(""); setRows([]);
    try { const value = costValue(await balance("1")); setCostPool(value); setMessage(`${money.format(value)} de custos carregados da Raiz.`); }
    catch (error) { setMessage((error as Error).message); } finally { setLoading(""); }
  }
  async function updateRevenue() {
    setLoading("revenue"); setMessage(""); setRows([]); const output: Record<string, number> = {}; const failures: string[] = [];
    for (let i = 0; i < list.length; i += 5) {
      const loaded = await Promise.all(list.slice(i, i + 5).map(async (company) => { try { return { company, data: await balance(company.code) }; } catch { return { company, data: null }; } }));
      loaded.forEach(({ company, data }) => data ? output[company.code] = revenueValue(data) : failures.push(company.code));
    }
    setRevenues(output); setLoading(""); setMessage(failures.length ? `Faturamento carregado. Falha nas coligadas: ${failures.join(", ")}.` : `Faturamento carregado para ${Object.keys(output).length} empresa(s).`);
  }
  function calculate() {
    const special = new Set(["18", "20", "25"]); const sarah = round((revenues["25"] || 0) * sarahRate);
    const generalPool = round(Math.max(0, costPool - sarah - apogeu - integra));
    const general = list.filter((x) => x.code !== "1" && !special.has(x.code));
    const generalRevenue = general.reduce((sum, x) => sum + (revenues[x.code] || 0), 0);
    const output = list.filter((x) => x.code !== "1").map<Row>((company) => {
      const revenue = revenues[company.code] || 0; let share = generalRevenue ? revenue / generalRevenue : 0; let calculated = round(generalPool * share); let rule = "Proporcional ao faturamento";
      if (company.code === "25") { share = 0; calculated = sarah; rule = `Contrato Sarah (${percent.format(sarahRate)})`; }
      if (company.code === "18") { share = 0; calculated = apogeu; rule = "Contrato Apogeu / Espaço Mágico"; }
      if (company.code === "20") { share = 0; calculated = integra; rule = "Contrato Integra"; }
      const adjustment = adjustments[company.code] || 0;
      return { ...company, revenue, share, rule, calculated, adjustment, finalValue: round(calculated + adjustment) };
    });
    const residual = round(costPool - output.reduce((sum, x) => sum + x.calculated, 0));
    const target = output.filter((x) => x.rule === "Proporcional ao faturamento").sort((a, b) => b.revenue - a.revenue)[0];
    if (target && Math.abs(residual) >= .01) { target.calculated = round(target.calculated + residual); target.finalValue = round(target.calculated + target.adjustment); }
    setRows(output); localStorage.setItem(storageKey, JSON.stringify({ costPool, revenues, sarahRate, apogeu, integra, adjustments, rows: output })); setMessage("Rateio calculado e memória preservada para a competência.");
  }
  const totals = useMemo(() => rows.reduce((t, x) => ({ revenue: t.revenue + x.revenue, calculated: t.calculated + x.calculated, adjustment: t.adjustment + x.adjustment, final: t.final + x.finalValue }), { revenue: 0, calculated: 0, adjustment: 0, final: 0 }), [rows]);
  const difference = round(costPool - totals.calculated);
  function exportFile() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Competência: competence, "Custos elegíveis": costPool, "Rateio calculado": totals.calculated, Ajustes: totals.adjustment, "Total final": totals.final, Diferença: difference }]), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((x) => ({ Coligada: x.code, Empresa: x.name, Faturamento: x.revenue, Participação: x.share, Regra: x.rule, "Rateio calculado": x.calculated, Ajuste: x.adjustment, "Rateio final": x.finalValue }))), "Memória do rateio");
    XLSX.writeFile(wb, `Rateio_CSC_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }
  return <section className="panel csc-panel">
    {loading && <div className="csc-processing"><RefreshCw className="spin" /><b>{loading === "cost" ? "Atualizando base contábil" : "Atualizando faturamento"}</b></div>}
    <div className="csc-heading"><div><h2>Rateio CSC</h2><p>Custos da Raiz distribuídos conforme faturamento e regras contratuais.</p></div><div className="csc-actions"><button className={`secondary ${costPool ? "source-loaded" : ""}`} onClick={updateCosts} disabled={!!loading}><RefreshCw />Atualizar base contábil</button><button className={`secondary ${Object.keys(revenues).length ? "source-loaded" : ""}`} onClick={updateRevenue} disabled={!!loading}><RefreshCw />Atualizar faturamento</button><button className="secondary" onClick={() => setParameters(!parameters)}><SlidersHorizontal />Parâmetros</button><button className="primary" onClick={calculate} disabled={!costPool || !Object.keys(revenues).length}><Calculator />Calcular rateio</button><button className="secondary" onClick={exportFile} disabled={!rows.length}><Download />Exportar memória</button></div></div>
    <div className="csc-tabs"><button className={view === "allocation" ? "active" : ""} onClick={() => setView("allocation")}>Apuração do rateio</button><button className={view === "rules" ? "active" : ""} onClick={() => setView("rules")}>Regras CSC</button></div>
    {message && <div className="notice">{message}</div>}
    {view === "rules" ? <div className="csc-rules">
      <div className="csc-rule-intro"><b>Premissas identificadas na planilha modelo</b><span>Estas regras formam a memória de cálculo e devem ser revisadas quando houver alteração contratual.</span></div>
      <ol>
        <li><b>1. Custos elegíveis da holding</b><span>A base parte dos movimentos contábeis da Raiz Educação na competência. Na planilha original, somente grupos gerenciais marcados como “SIM” compõem o custo compartilhável.</span></li>
        <li><b>2. Faturamento por empresa</b><span>O faturamento mensal de cada coligada forma o direcionador do rateio geral. A participação é calculada por: faturamento da empresa ÷ faturamento total elegível.</span></li>
        <li><b>3. Contratos específicos antes do rateio geral</b><span>Sarah (coligada 25) usa percentual contratual sobre o faturamento: 7,5% em 2024 e 8% a partir de 2025. Apogeu/Espaço Mágico (18) e Integra (20) usam valores contratuais mensais próprios.</span></li>
        <li><b>4. Base geral de distribuição</b><span>Custos elegíveis menos os valores dos contratos específicos. O saldo restante é distribuído proporcionalmente entre as demais empresas.</span></li>
        <li><b>5. Prevenção de duplicidade</b><span>Quando uma coligada possuir detalhamento por filial, o consolidado não deve ser somado novamente à base de participação.</span></li>
        <li><b>6. Ajustes manuais rastreáveis</b><span>Acréscimos ou deduções fora do cálculo padrão devem ser informados por empresa e mantidos separadamente do rateio calculado.</span></li>
        <li><b>7. Arredondamento</b><span>O cálculo é realizado com duas casas decimais. Eventual resíduo de centavos é absorvido pela empresa de maior faturamento do rateio proporcional.</span></li>
        <li><b>8. Validação de fechamento</b><span>A soma dos rateios calculados deve fechar com o total de custos elegíveis. A diferença aceita é de até R$ 0,10.</span></li>
        <li><b>9. Memória e exportação</b><span>A apuração permanece salva por competência e a exportação deve apresentar resumo, regra aplicada, faturamento, participação, ajustes e valor final por coligada.</span></li>
      </ol>
    </div> : <>
    {parameters && <div className="csc-parameters"><label>Taxa Sarah<input type="number" step=".001" value={sarahRate} onChange={(e) => setSarahRate(Number(e.target.value))} /></label><label>Contrato mensal Apogeu<input type="number" step=".01" value={apogeu} onChange={(e) => setApogeu(Number(e.target.value))} /></label><label>Contrato mensal Integra<input type="number" step=".01" value={integra} onChange={(e) => setIntegra(Number(e.target.value))} /></label><small>Os contratos específicos são retirados da base antes do rateio proporcional, como na planilha modelo.</small></div>}
    <div className="csc-summary"><article><span>Custos elegíveis</span><b>{money.format(costPool)}</b></article><article><span>Faturamento total</span><b>{money.format(totals.revenue || Object.values(revenues).reduce((a, b) => a + b, 0))}</b></article><article><span>Rateio calculado</span><b>{money.format(totals.calculated)}</b></article><article><span>Ajustes</span><b>{money.format(totals.adjustment)}</b></article><article className={rows.length && Math.abs(difference) <= .1 ? "is-balanced" : ""}><span>Diferença de fechamento</span><b>{money.format(difference)}</b><small>{rows.length && Math.abs(difference) <= .1 ? <><CheckCircle2 /> Fechado</> : "Aguardando cálculo"}</small></article></div>
    {rows.length ? <div className="table-wrap csc-table"><table><thead><tr><th>Coligada</th><th>Empresa</th><th>Faturamento</th><th>Participação</th><th>Regra</th><th>Rateio</th><th>Ajuste</th><th>Final</th></tr></thead><tbody>{rows.map((row) => <tr key={row.code} className={row.code === normalize(selectedCompanyCode) ? "selected-company" : ""}><td><b>{row.code}</b></td><td>{row.name}</td><td>{money.format(row.revenue)}</td><td>{row.share ? percent.format(row.share) : "—"}</td><td>{row.rule}</td><td><b>{money.format(row.calculated)}</b></td><td><input type="number" step=".01" value={adjustments[row.code] || 0} onChange={(e) => setAdjustments({ ...adjustments, [row.code]: Number(e.target.value) })} /></td><td><b>{money.format(row.finalValue)}</b></td></tr>)}</tbody></table></div> : <div className="csc-empty"><Calculator /><b>Atualize as duas bases para calcular</b><span>A última memória da competência será preservada.</span></div>}</>}
  </section>;
}
