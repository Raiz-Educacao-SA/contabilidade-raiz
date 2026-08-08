"use client";
import { useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, Download, RefreshCw, SlidersHorizontal } from "lucide-react";
import * as XLSX from "xlsx";

type Company = { code: string; name: string };
type Balance = { account: string; movement: number; debit: number; credit: number };
type Row = { code: string; name: string; revenue: number; share: number; rule: string; calculated: number; adjustment: number; finalValue: number };
type ResultMovement = { revenue: number; costs: number; net: number };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const normalize = (value: string) => String(Number(value));
const normalizeName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const excludedFromAllocation = (company: Company) => {
  const name = normalizeName(company.name);
  return name.includes("RAIZ SUL") || name.includes("DIDACTA");
};

export default function CscAllocation({ companies, competence, accessToken }: { companies: Company[]; competence: string; accessToken: string }) {
  const list = useMemo(() => Array.from(new Map(companies.map((x) => ({ ...x, code: normalize(x.code) })).filter((x) => x.code !== "0").map((x) => [x.code, x])).values()), [companies]);
  const storageKey = `csc-allocation:${competence}`;
  const [costPool, setCostPool] = useState(0);
  const [revenues, setRevenues] = useState<Record<string, number>>({});
  const [resultMovements, setResultMovements] = useState<Record<string, ResultMovement>>({});
  const [sarahRate, setSarahRate] = useState(Number(competence.slice(0, 4)) >= 2025 ? .08 : .075);
  const [apogeu, setApogeu] = useState(0);
  const [integra, setIntegra] = useState(0);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<"accounting" | "">("");
  const [message, setMessage] = useState("");
  const [parameters, setParameters] = useState(false);
  const [view, setView] = useState<"allocation" | "accounting" | "rules">("allocation");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!saved) { setCostPool(0); setRevenues({}); setResultMovements({}); setAdjustments({}); setRows([]); return; }
      setCostPool(saved.costPool || 0); setRevenues(saved.revenues || {}); setResultMovements(saved.resultMovements || {}); setSarahRate(saved.sarahRate ?? .08); setApogeu(saved.apogeu || 0); setIntegra(saved.integra || 0); setAdjustments(saved.adjustments || {}); setRows(saved.rows || []);
    } catch { localStorage.removeItem(storageKey); }
  }, [storageKey]);

  async function balance(company: string) {
    const response = await fetch(`/api/totvs/trial-balance?company=${company}&competence=${competence}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível consultar o balancete.");
    return (payload.rows || []) as Balance[];
  }
  const costValue = (data: Balance[]) => round(Math.abs(data.filter((x) => /^(4|5|6)\./.test(x.account)).reduce((sum, x) => sum + (x.movement || x.debit - x.credit), 0)));
  const revenueValue = (data: Balance[]) => round(Math.abs(data.filter((x) => /^3\./.test(x.account)).reduce((sum, x) => sum + (x.movement || x.credit - x.debit), 0)));

  async function updateAccountingBase() {
    setLoading("accounting"); setMessage(""); setRows([]); const output: Record<string, number> = {}; const movements: Record<string, ResultMovement> = {}; const failures: string[] = [];
    for (let i = 0; i < list.length; i += 5) {
      const loaded = await Promise.all(list.slice(i, i + 5).map(async (company) => { try { return { company, data: await balance(company.code) }; } catch { return { company, data: null }; } }));
      loaded.forEach(({ company, data }) => {
        if (!data) { failures.push(company.code); return; }
        const revenue = revenueValue(data); const costs = costValue(data);
        output[company.code] = revenue; movements[company.code] = { revenue, costs, net: round(revenue - costs) };
      });
    }
    setRevenues(output); setResultMovements(movements); setCostPool(movements["1"]?.costs || 0); setLoading("");
    setMessage(failures.length ? `Base contábil carregada para ${Object.keys(movements).length} empresa(s). Falha nas coligadas: ${failures.join(", ")}.` : `Contas de resultado de ${Object.keys(movements).length} empresa(s), inclusive a Raiz, carregadas para ${competence.slice(5)}/${competence.slice(0, 4)}.`);
  }
  function calculate() {
    const special = new Set(["18", "20", "25"]); const sarah = round((revenues["25"] || 0) * sarahRate);
    const generalPool = round(Math.max(0, costPool - sarah - apogeu - integra));
    const participating = list.filter((x) => x.code !== "1" && !excludedFromAllocation(x));
    const participatingRevenue = participating.reduce((sum, x) => sum + (revenues[x.code] || 0), 0);
    const general = list.filter((x) => x.code !== "1" && !special.has(x.code) && !excludedFromAllocation(x));
    const generalRevenue = general.reduce((sum, x) => sum + (revenues[x.code] || 0), 0);
    const output = list.filter((x) => x.code !== "1" && !excludedFromAllocation(x)).map<Row>((company) => {
      const revenue = revenues[company.code] || 0; const share = participatingRevenue ? revenue / participatingRevenue : 0; const generalShare = generalRevenue ? revenue / generalRevenue : 0; let calculated = round(generalPool * generalShare); let rule = "Proporcional ao faturamento";
      if (company.code === "25") { calculated = sarah; rule = `Contrato Sarah (${percent.format(sarahRate)})`; }
      if (company.code === "18") { calculated = apogeu; rule = "Contrato Apogeu / Espaço Mágico"; }
      if (company.code === "20") { calculated = integra; rule = "Contrato Integra"; }
      const adjustment = adjustments[company.code] || 0;
      return { ...company, revenue, share, rule, calculated, adjustment, finalValue: round(calculated + adjustment) };
    });
    const residual = round(costPool - output.reduce((sum, x) => sum + x.calculated, 0));
    const target = output.filter((x) => x.rule === "Proporcional ao faturamento").sort((a, b) => b.revenue - a.revenue)[0];
    if (target && Math.abs(residual) >= .01) { target.calculated = round(target.calculated + residual); target.finalValue = round(target.calculated + target.adjustment); }
    setRows(output); localStorage.setItem(storageKey, JSON.stringify({ costPool, revenues, resultMovements, sarahRate, apogeu, integra, adjustments, rows: output })); setMessage("Custos da Raiz rateados conforme o movimento mensal das coligadas.");
  }
  const totals = useMemo(() => rows.reduce((t, x) => ({ revenue: t.revenue + x.revenue, calculated: t.calculated + x.calculated, adjustment: t.adjustment + x.adjustment, final: t.final + x.finalValue }), { revenue: 0, calculated: 0, adjustment: 0, final: 0 }), [rows]);
  const difference = round(costPool - totals.calculated);
  const calculationList = useMemo(() => list.map((company) => {
    const calculated = rows.find((row) => row.code === company.code);
    const movement = resultMovements[company.code] || { revenue: 0, costs: 0, net: 0 };
    const excluded = excludedFromAllocation(company);
    const rule = company.code === "1" ? "Origem dos custos do CSC" : excluded ? "Não participa do rateio" : company.code === "25" ? "Contrato Sarah" : company.code === "18" ? "Contrato Apogeu / Espaço Mágico" : company.code === "20" ? "Contrato Integra" : "Proporcional ao faturamento";
    const status = excluded ? "Não participa" : calculated ? "Calculada" : Object.prototype.hasOwnProperty.call(resultMovements, company.code) ? "Base carregada" : "Aguardando base";
    return { ...company, ...movement, rule: calculated?.rule || rule, status };
  }), [list, resultMovements, rows]);
  function exportFile() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Competência: competence, "Custos elegíveis": costPool, "Rateio calculado": totals.calculated, Ajustes: totals.adjustment, "Total final": totals.final, Diferença: difference }]), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((x) => ({ Coligada: x.code, Empresa: x.name, Faturamento: x.revenue, Participação: x.share, Regra: x.rule, "Rateio calculado": x.calculated, Ajuste: x.adjustment, "Rateio final": x.finalValue }))), "Memória do rateio");
    XLSX.writeFile(wb, `Rateio_CSC_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }
  function exportAccounting() {
    const accounting = rows.flatMap((row) => [
      { Competência: competence, Coligada: row.code, Empresa: row.name, Lado: "Empresa beneficiária", Débito: "Despesa com CSC", Crédito: "CSC a pagar para a Raiz", Valor: row.finalValue },
      { Competência: competence, Coligada: "1", Empresa: "RAIZ EDUCAÇÃO", Lado: `Contrapartida da coligada ${row.code}`, Débito: `CSC a receber — ${row.name}`, Crédito: "Receita de CSC", Valor: row.finalValue },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(accounting), "Contabilização");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((row) => ({ Coligada: row.code, Empresa: row.name, "Valor a contabilizar": row.finalValue }))), "Valores por empresa");
    XLSX.writeFile(wb, `Contabilizacao_Rateio_CSC_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }
  return <section className="panel csc-panel">
    {loading && <div className="csc-processing"><RefreshCw className="spin" /><b>Atualizando base contábil de todas as empresas</b></div>}
    <div className="csc-heading"><div><h2>Rateio CSC</h2><p>Primeiro carregue as contas de resultado; depois rateie os custos da Raiz entre as coligadas.</p></div><div className="csc-actions"><button className={`secondary ${Object.keys(resultMovements).length ? "source-loaded" : ""}`} onClick={updateAccountingBase} disabled={!!loading}><RefreshCw />Atualizar base contábil</button><button className="secondary" onClick={() => setParameters(!parameters)}><SlidersHorizontal />Parâmetros</button><button className="primary" onClick={calculate} disabled={!costPool || !Object.keys(resultMovements).length}><Calculator />Ratear custos da Raiz</button><button className="secondary" onClick={exportFile} disabled={!rows.length}><Download />Exportar memória</button></div></div>
    <div className="csc-tabs"><button className={view === "allocation" ? "active" : ""} onClick={() => setView("allocation")}>Apuração do rateio</button><button className={view === "accounting" ? "active" : ""} onClick={() => setView("accounting")}>Contabilização</button><button className={view === "rules" ? "active" : ""} onClick={() => setView("rules")}>Regras CSC</button></div>
    {message && <div className="notice">{message}</div>}
    {view === "rules" ? <div className="csc-rules">
      <div className="csc-rule-intro"><b>Premissas identificadas na planilha modelo</b><span>Estas regras formam a memória de cálculo e devem ser revisadas quando houver alteração contratual.</span></div>
      <ol>
        <li><b>1. Custos mensais elegíveis da holding</b><span>A base considera exclusivamente os movimentos contábeis da Raiz Educação dentro do mês selecionado. Créditos, estornos e reversões reduzem o custo mensal. Na planilha original, somente grupos gerenciais marcados como “SIM” compõem o custo compartilhável.</span></li>
        <li><b>2. Movimento das contas de resultado</b><span>A base contábil mensal é atualizada para todas as empresas, inclusive a Raiz. O movimento de receitas de cada coligada forma o direcionador: movimento da empresa ÷ movimento total elegível.</span></li>
        <li><b>3. Contratos específicos antes do rateio geral</b><span>Sarah (coligada 25) usa percentual contratual sobre o faturamento: 7,5% em 2024 e 8% a partir de 2025. Apogeu/Espaço Mágico (18) e Integra (20) usam valores contratuais mensais próprios.</span></li>
        <li><b>4. Base geral de distribuição</b><span>Custos elegíveis menos os valores dos contratos específicos. O saldo restante é distribuído proporcionalmente entre as demais empresas.</span></li>
        <li><b>5. Empresas não participantes</b><span>Raiz Sul e Didacta permanecem visíveis na base contábil para conferência, mas não integram o denominador nem recebem parcela do Rateio CSC.</span></li>
        <li><b>6. Ajustes manuais rastreáveis</b><span>Acréscimos ou deduções fora do cálculo padrão devem ser informados por empresa e mantidos separadamente do rateio calculado.</span></li>
        <li><b>7. Arredondamento</b><span>O cálculo é realizado com duas casas decimais. Eventual resíduo de centavos é absorvido pela empresa de maior faturamento do rateio proporcional.</span></li>
        <li><b>8. Validação de fechamento</b><span>A soma dos rateios calculados deve fechar com o total de custos elegíveis. A diferença aceita é de até R$ 0,10.</span></li>
        <li><b>9. Memória e exportação</b><span>A apuração permanece salva por competência e a exportação deve apresentar resumo, regra aplicada, faturamento, participação, ajustes e valor final por coligada.</span></li>
      </ol>
    </div> : view === "accounting" ? <div className="csc-accounting">
      <div className="csc-accounting-heading"><div><b>Valores para contabilização</b><span>Um lançamento na empresa beneficiária e a contrapartida correspondente na Raiz Educação.</span></div><button className="secondary" onClick={exportAccounting} disabled={!rows.length}><Download />Exportar contabilização</button></div>
      {rows.length ? <><div className="csc-accounting-summary"><article><span>Empresas para contabilizar</span><b>{rows.filter((row) => Math.abs(row.finalValue) >= .01).length}</b></article><article><span>Total a debitar nas empresas</span><b>{money.format(totals.final)}</b></article><article><span>Total a creditar na Raiz</span><b>{money.format(totals.final)}</b></article><article className="is-balanced"><span>Conferência débito × crédito</span><b>{money.format(0)}</b><small><CheckCircle2 /> Fechado</small></article></div><div className="table-wrap csc-accounting-table"><table><thead><tr><th>Coligada</th><th>Empresa</th><th>Valor</th><th>Débito na empresa</th><th>Crédito na empresa</th><th>Débito na Raiz</th><th>Crédito na Raiz</th></tr></thead><tbody>{rows.filter((row) => Math.abs(row.finalValue) >= .01).map((row) => <tr key={`accounting-${row.code}`}><td><b>{row.code}</b></td><td>{row.name}</td><td><b>{money.format(row.finalValue)}</b></td><td>Despesa com CSC</td><td>CSC a pagar para a Raiz</td><td>CSC a receber — {row.name}</td><td>Receita de CSC</td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Total</td><td>{money.format(totals.final)}</td><td colSpan={4}>Débitos e créditos conferidos</td></tr></tfoot></table></div><p className="csc-accounting-note">Os códigos das contas contábeis devem seguir o plano de contas parametrizado no TOTVS RM. A memória identifica a natureza e o valor de cada lançamento.</p></> : <div className="csc-empty"><Calculator /><b>Calcule o rateio para gerar a contabilização</b><span>Os valores serão apresentados empresa por empresa.</span></div>}
    </div> : <>
    {parameters && <div className="csc-parameters"><label>Taxa Sarah<input type="number" step=".001" value={sarahRate} onChange={(e) => setSarahRate(Number(e.target.value))} /></label><label>Contrato mensal Apogeu<input type="number" step=".01" value={apogeu} onChange={(e) => setApogeu(Number(e.target.value))} /></label><label>Contrato mensal Integra<input type="number" step=".01" value={integra} onChange={(e) => setIntegra(Number(e.target.value))} /></label><small>Os contratos específicos são retirados da base antes do rateio proporcional, como na planilha modelo.</small></div>}
    <div className="csc-summary"><article><span>Custos da Raiz no mês</span><b>{money.format(costPool)}</b><small>{competence.slice(5)}/{competence.slice(0, 4)}</small></article><article><span>Faturamento total do mês</span><b>{money.format(totals.revenue || Object.values(revenues).reduce((a, b) => a + b, 0))}</b></article><article><span>Rateio calculado</span><b>{money.format(totals.calculated)}</b></article><article><span>Ajustes</span><b>{money.format(totals.adjustment)}</b></article><article className={rows.length && Math.abs(difference) <= .1 ? "is-balanced" : ""}><span>Diferença de fechamento</span><b>{money.format(difference)}</b><small>{rows.length && Math.abs(difference) <= .1 ? <><CheckCircle2 /> Fechado</> : "Aguardando cálculo"}</small></article></div>
    <div className="csc-company-list-title"><div><b>Base contábil mensal — contas de resultado</b><span>{calculationList.length} empresa(s), incluindo a Raiz · competência {competence.slice(5)}/{competence.slice(0, 4)}</span></div></div>
    <div className="table-wrap csc-table csc-company-preview"><table><thead><tr><th>Coligada</th><th>Empresa</th><th>Receitas do mês</th><th>Custos/despesas do mês</th><th>Movimento líquido</th><th>Função no rateio</th><th>Situação</th></tr></thead><tbody>{calculationList.map((row) => <tr key={`preview-${row.code}`}><td><b>{row.code}</b></td><td>{row.name}</td><td>{money.format(row.revenue)}</td><td>{money.format(row.costs)}</td><td className={row.net < 0 ? "negative" : ""}><b>{money.format(row.net)}</b></td><td>{row.rule}</td><td><span className={`csc-company-status ${row.status === "Calculada" ? "done" : row.status === "Base carregada" ? "ready" : ""}`}>{row.status}</span></td></tr>)}</tbody></table></div>
    {rows.length && <><div className="csc-company-list-title"><div><b>Rateio dos custos da Raiz entre as coligadas</b><span>A porcentagem corresponde ao faturamento da empresa dividido pelo faturamento total das participantes</span></div></div><div className="table-wrap csc-table"><table><thead><tr><th>Coligada</th><th>Empresa</th><th>Faturamento mensal</th><th>% no rateio</th><th>Regra</th><th>Rateio</th><th>Ajuste</th><th>Final</th></tr></thead><tbody>{rows.map((row) => <tr key={row.code}><td><b>{row.code}</b></td><td>{row.name}</td><td>{money.format(row.revenue)}</td><td><b>{row.share ? percent.format(row.share) : "—"}</b></td><td>{row.rule}</td><td><b>{money.format(row.calculated)}</b></td><td><input type="number" step=".01" value={adjustments[row.code] || 0} onChange={(e) => setAdjustments({ ...adjustments, [row.code]: Number(e.target.value) })} /></td><td><b>{money.format(row.finalValue)}</b></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Total das participantes</td><td>{money.format(rows.reduce((sum, row) => sum + row.revenue, 0))}</td><td>{percent.format(rows.reduce((sum, row) => sum + row.share, 0))}</td><td>—</td><td>{money.format(totals.calculated)}</td><td>{money.format(totals.adjustment)}</td><td>{money.format(totals.final)}</td></tr></tfoot></table></div></>}</>}
  </section>;
}
