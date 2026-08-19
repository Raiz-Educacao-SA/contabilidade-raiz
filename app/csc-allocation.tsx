"use client";
import { useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, Download, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { applyRaizWorkbookStyle } from "@/lib/export-workbook-style";

type Company = { code: string; name: string };
type Balance = { id?: string; reduced?: string; account: string; description?: string; movement: number; debit: number; credit: number };
type Row = { code: string; name: string; revenue: number; share: number; rule: string; calculated: number; adjustment: number; finalValue: number };
type ResultMovement = { revenue: number; costs: number; net: number };
type BranchRevenue = { branch: string; revenue: number };
type MovementDetail = { company: string; companyName: string; account: string; description: string; classification: string; debit: number; credit: number; movement: number; considered: number };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const normalize = (value: string) => String(Number(value));
const normalizeName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const excludedFromAllocation = (company: Company) => {
  if (company.code === "20") return true;
  const name = normalizeName(company.name);
  return name.includes("RAIZ SUL") || name.includes("DIDACTA");
};
const isEligibleRevenue = (account: string) => /^(3\.1\.1\.01\.01\.|3\.1\.1\.01\.02\.|3\.1\.1\.01\.03\.|3\.1\.2\.02\.)/.test(account)
  || ["3.1.1.01.04.03", "3.1.1.01.05.03", "3.1.1.01.05.04", "3.1.1.01.05.05", "3.1.1.01.06.01", "3.1.3.01.01.50"].includes(account);
const isEligibleCost = (account: string) => /^(4\.1\.1\.|4\.1\.2\.|4\.2\.1\.0[1-9]\.)/.test(account)
  || ["4.2.1.10.01.13", "4.2.1.15.01.01", "4.2.1.15.01.02"].includes(account);
const branchTen: Record<string, Company> = {
  "1": { code: "10.1", name: "QI RECREIO" },
  "2": { code: "10.2", name: "ESCOLA SAP" },
  "7": { code: "10.2", name: "ESCOLA SAP" },
  "3": { code: "10.3", name: "SÁ PEREIRA" },
  "4": { code: "10.3", name: "SÁ PEREIRA" },
  "5": { code: "10.3", name: "SÁ PEREIRA" },
  "6": { code: "10.3", name: "SÁ PEREIRA" },
};
const branchTenOrder = [branchTen["1"], branchTen["2"], branchTen["3"]];
const sarahTijuca: Company = { code: "31", name: "SARAH TIJUCA" };
const closedRevenueByCompetence: Record<string, Record<string, number>> = {
  "2026-06": { "8": 4800556, "11": 814607, "25": 1171530, "29": 784499 },
};
const calculationCriteria = [
  ["1", "Competência", "Somente movimentos compreendidos entre o primeiro e o último dia do mês selecionado."],
  ["2", "Origem contábil", "Balancete CUBO.CTB.002 para todas as coligadas e Razão METTA0909 para segregar a coligada 10 por CODFILIAL."],
  ["3", "Custos elegíveis", "Somente contas vinculadas aos grupos gerenciais marcados como SIM no modelo: 1201–1208, 1301–1312, 1314, 1317, 1318 e 1409."],
  ["4", "Sinais", "Débitos aumentam o custo; créditos, estornos e reversões reduzem a base compartilhável."],
  ["5", "Faturamento", "Somente contas de receita vinculadas aos grupos gerenciais elegíveis 1100–1118, 1122, 1123 e 1125. ISS, PIS, COFINS e demais tributos do grupo 3.1.3.01.01 são excluídos; apenas 3.1.3.01.01.50 — benefício fiscal PAA permanece na base."],
  ["6", "Coligada 10", "Agrupada por CODFILIAL: filial 01 em 10.1; filiais 02 e 07 em 10.2; filiais 03, 04, 05 e 06 em 10.3."],
  ["7", "Exclusões", "Raiz Educação é a origem do custo. Raiz Sul, Didacta e a coligada 20 — Integra não participam do denominador e não recebem rateio."],
  ["8", "Sarah Tijuca", "A coligada 31 é calculada separadamente a 8,5% sobre seu faturamento-base e fica fora do denominador do rateio proporcional. Em 06/2026, a base contratual é R$ 1.413.705,88 e o valor do CSC é R$ 120.165,00."],
  ["9", "Rateio proporcional", "Coligadas 18 e 25 seguem o faturamento, como as demais participantes. A coligada 20 fica excluída. Base proporcional = custos elegíveis menos o valor da Sarah Tijuca; percentual = faturamento elegível da empresa ÷ faturamento elegível total das participantes proporcionais."],
  ["10", "Base fechada de junho", "Para reproduzir a memória aprovada de 06/2026, prevalecem os faturamentos congelados da Matriz Educação (R$ 4.800.556), GEU (R$ 814.607), Sarah (R$ 1.171.530) e Americano (R$ 784.499). Nos demais meses, a atualização utiliza diretamente o balancete corrente do TOTVS."],
  ["11", "Ajuste de multa IRPJ e CSLL", "A partir da competência 01/2024, a coligada 25 recebe o ajuste fixo de -R$ 3.184,40 referente à multa de IRPJ e CSLL. O valor permanece vigente nas competências seguintes até a definição de uma nova regra."],
  ["12", "Arredondamento e fechamento", "O faturamento-base de cada empresa é arredondado primeiro para reais inteiros, como na planilha. Depois, cada rateio é arredondado em centavos. A diferença de até R$ 0,10 é aceita como fechamento, sem redistribuir o centavo entre empresas."],
];

export default function CscAllocation({ companies, competence, accessToken }: { companies: Company[]; competence: string; accessToken: string }) {
  const list = useMemo(() => {
    const normalized = Array.from(new Map(companies.map((x) => ({ ...x, code: normalize(x.code) })).filter((x) => x.code !== "0").map((x) => [x.code, x])).values());
    if (!normalized.some((company) => company.code === "31")) normalized.push(sarahTijuca);
    return normalized;
  }, [companies]);
  const allocationList = useMemo(() => Array.from(new Map(list.flatMap((company) => company.code === "10" ? branchTenOrder : [company]).map((company) => [company.code, company])).values()), [list]);
  const storageKey = `csc-allocation:v9:${competence}`;
  const [costPool, setCostPool] = useState(0);
  const [revenues, setRevenues] = useState<Record<string, number>>({});
  const [resultMovements, setResultMovements] = useState<Record<string, ResultMovement>>({});
  const [movementDetails, setMovementDetails] = useState<MovementDetail[]>([]);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState("");
  const defaultSarahTijucaValue = competence === "2026-06" ? 120165 : 0;
  const [sarahTijucaValue, setSarahTijucaValue] = useState(defaultSarahTijucaValue);
  const defaultAdjustments = useMemo<Record<string, number>>(() => competence >= "2024-01" ? { "25": -3184.4 } : {} as Record<string, number>, [competence]);
  const [adjustments, setAdjustments] = useState<Record<string, number>>(defaultAdjustments);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<"accounting" | "">("");
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"allocation" | "accounting" | "rules">("allocation");

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (!saved) { setCostPool(0); setRevenues({}); setResultMovements({}); setMovementDetails([]); setBaseUpdatedAt(""); setAdjustments(defaultAdjustments); setRows([]); return; }
        setCostPool(saved.costPool || 0); setRevenues(saved.revenues || {}); setResultMovements(saved.resultMovements || {}); setMovementDetails(saved.movementDetails || []); setBaseUpdatedAt(saved.baseUpdatedAt || ""); setSarahTijucaValue(saved.sarahTijucaValue ?? defaultSarahTijucaValue); setAdjustments({ ...(saved.adjustments || {}), ...defaultAdjustments }); setRows(saved.rows || []);
      } catch { localStorage.removeItem(storageKey); }
    });
    return () => { active = false; };
  }, [storageKey, defaultAdjustments, defaultSarahTijucaValue]);

  async function balance(company: string) {
    const response = await fetch(`/api/totvs/trial-balance?company=${company}&competence=${competence}${company === "10" ? "&byBranch=1" : ""}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível consultar o balancete.");
    return { rows: (payload.rows || []) as Balance[], branches: (payload.branches || []) as BranchRevenue[] };
  }
  const costValue = (data: Balance[]) => round(Math.abs(data.filter((x) => isEligibleCost(x.account)).reduce((sum, x) => sum + (x.movement || x.debit - x.credit), 0)));
  const revenueValue = (data: Balance[]) => Math.round(Math.abs(data.filter((x) => isEligibleRevenue(x.account)).reduce((sum, x) => sum + (x.movement || x.credit - x.debit), 0)));
  const detailsFor = (company: Company, data: Balance[]) => {
    const create = (classification: string, eligible: (account: string) => boolean, rawValue: (row: Balance) => number) => {
      const selected = data.filter((row) => eligible(row.account));
      const rawTotal = selected.reduce((sum, row) => sum + rawValue(row), 0);
      const direction = rawTotal < 0 ? -1 : 1;
      return selected.map<MovementDetail>((row) => ({ company: company.code, companyName: company.name, account: row.account, description: row.description || "", classification, debit: row.debit, credit: row.credit, movement: row.movement, considered: round(rawValue(row) * direction) }));
    };
    return [...create("Receita elegível", isEligibleRevenue, (row) => row.movement || row.credit - row.debit), ...create("Custo elegível", isEligibleCost, (row) => row.movement || row.debit - row.credit)];
  };

  async function updateAccountingBase() {
    setLoading("accounting"); setMessage(""); setRows([]); setMovementDetails([]); setBaseUpdatedAt(""); const output: Record<string, number> = {}; const movements: Record<string, ResultMovement> = {}; const details: MovementDetail[] = []; const failures: string[] = [];
    for (let i = 0; i < list.length; i += 5) {
      const loaded = await Promise.all(list.slice(i, i + 5).map(async (company) => { try { return { company, data: await balance(company.code) }; } catch { return { company, data: null }; } }));
      loaded.forEach(({ company, data }) => {
        if (!data) { failures.push(company.code); return; }
        const revenue = revenueValue(data.rows); const costs = costValue(data.rows);
        if (company.code === "10" && data.branches.length) {
          const allocated = new Set<string>();
          data.branches.forEach(({ branch, revenue: branchValue }) => {
            const entity = branchTen[branch] || { code: `10.${branch}`, name: `FILIAL ${branch}` };
            const groupedRevenue = round((output[entity.code] || 0) + branchValue);
            output[entity.code] = groupedRevenue;
            movements[entity.code] = { revenue: groupedRevenue, costs: 0, net: groupedRevenue };
            allocated.add(entity.code);
          });
          data.branches.forEach(({ branch, revenue: branchValue }) => {
            const entity = branchTen[branch] || { code: `10.${branch}`, name: `FILIAL ${branch}` };
            details.push({ company: entity.code, companyName: entity.name, account: "METTA0909", description: `Faturamento da filial ${branch}`, classification: "Receita elegível por filial", debit: 0, credit: 0, movement: branchValue, considered: branchValue });
          });
          allocated.forEach((code) => {
            const groupedRevenue = Math.round(output[code] || 0);
            output[code] = groupedRevenue;
            movements[code] = { revenue: groupedRevenue, costs: 0, net: groupedRevenue };
          });
          branchTenOrder.filter((entity) => !allocated.has(entity.code)).forEach((entity) => { output[entity.code] = 0; movements[entity.code] = { revenue: 0, costs: 0, net: 0 }; });
          const branchTotal = data.branches.reduce((sum, branch) => sum + branch.revenue, 0);
          if (Math.abs(branchTotal - revenue) > 1) failures.push(`10 (diferença filial × balancete: ${money.format(branchTotal - revenue)})`);
        } else {
          const closedRevenue = closedRevenueByCompetence[competence]?.[company.code];
          const contractualRevenue = company.code === "31" && defaultSarahTijucaValue ? round(defaultSarahTijucaValue / .085) : undefined;
          const appliedRevenue = contractualRevenue ?? closedRevenue ?? revenue;
          output[company.code] = appliedRevenue;
          movements[company.code] = { revenue: appliedRevenue, costs, net: round(appliedRevenue - costs) };
          details.push(...detailsFor(company, data.rows));
          if (closedRevenue !== undefined && closedRevenue !== revenue) details.push({ company: company.code, companyName: company.name, account: "AJUSTE-BASE", description: `Ajuste para a base fechada de ${competence.slice(5)}/${competence.slice(0, 4)}`, classification: "Ajuste de receita", debit: 0, credit: 0, movement: round(closedRevenue - revenue), considered: round(closedRevenue - revenue) });
          if (contractualRevenue !== undefined && contractualRevenue !== revenue) details.push({ company: company.code, companyName: company.name, account: "BASE-CONTRATUAL", description: "Base contratual da Sarah Tijuca", classification: "Ajuste de receita contratual", debit: 0, credit: 0, movement: round(contractualRevenue - revenue), considered: round(contractualRevenue - revenue) });
        }
      });
    }
    setRevenues(output); setResultMovements(movements); setMovementDetails(details); setBaseUpdatedAt(new Date().toISOString()); setCostPool(movements["1"]?.costs || 0); setLoading("");
    setMessage(failures.length ? `Base contábil carregada para ${Object.keys(movements).length} empresa(s). Falha nas coligadas: ${failures.join(", ")}.` : `Contas de resultado de ${Object.keys(movements).length} empresa(s), inclusive a Raiz, carregadas para ${competence.slice(5)}/${competence.slice(0, 4)}.`);
  }
  function calculate() {
    const special = new Set(["31"]); const sarahTijucaBase = sarahTijucaValue ? round(sarahTijucaValue / .085) : 0;
    const generalPool = round(Math.max(0, costPool - sarahTijucaValue));
    const general = allocationList.filter((x) => x.code !== "1" && !special.has(x.code) && !excludedFromAllocation(x));
    const generalRevenue = general.reduce((sum, x) => sum + (revenues[x.code] || 0), 0);
    const output = allocationList.filter((x) => x.code !== "1" && !excludedFromAllocation(x)).map<Row>((company) => {
      const revenue = company.code === "31" ? sarahTijucaBase : revenues[company.code] || 0; const generalShare = generalRevenue ? revenue / generalRevenue : 0; const share = company.code === "31" ? 0 : generalShare; let calculated = round(generalPool * generalShare); let rule = "Proporcional ao faturamento";
      if (company.code === "31") { calculated = sarahTijucaValue; rule = `Sarah Tijuca (${percent.format(.085)})`; }
      const adjustment = adjustments[company.code] || 0;
      return { ...company, revenue, share, rule, calculated, adjustment, finalValue: round(calculated + adjustment) };
    });
    setRows(output); localStorage.setItem(storageKey, JSON.stringify({ costPool, revenues, resultMovements, movementDetails, baseUpdatedAt, sarahTijucaValue, adjustments, rows: output })); setMessage("Custos da Raiz rateados conforme a memória de cálculo da competência.");
  }
  const totals = useMemo(() => rows.reduce((t, x) => ({ revenue: t.revenue + x.revenue, calculated: t.calculated + x.calculated, adjustment: t.adjustment + x.adjustment, final: t.final + x.finalValue }), { revenue: 0, calculated: 0, adjustment: 0, final: 0 }), [rows]);
  const difference = round(costPool - totals.calculated);
  const calculationList = useMemo(() => allocationList.map((company) => {
    const calculated = rows.find((row) => row.code === company.code);
    const contractualRevenue = company.code === "31" && sarahTijucaValue ? round(sarahTijucaValue / .085) : 0;
    const movement = company.code === "31" ? { revenue: contractualRevenue, costs: 0, net: contractualRevenue } : resultMovements[company.code] || { revenue: 0, costs: 0, net: 0 };
    const excluded = excludedFromAllocation(company);
    const rule = company.code === "1" ? "Origem dos custos do CSC" : excluded ? "Não participa do rateio" : company.code === "31" ? "Sarah Tijuca — 8,5%" : "Proporcional ao faturamento";
    const status = excluded ? "Não participa" : calculated ? "Calculada" : Object.prototype.hasOwnProperty.call(resultMovements, company.code) ? "Base carregada" : "Aguardando base";
    return { ...company, ...movement, rule: calculated?.rule || rule, status };
  }), [allocationList, resultMovements, rows, sarahTijucaValue]);
  const baseUpdateLabel = baseUpdatedAt ? new Date(baseUpdatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
  function exportFile() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Competência: competence, "Base TOTVS atualizada em": baseUpdateLabel, "Custos elegíveis": costPool, "Base proporcional": rows.filter((row) => row.rule === "Proporcional ao faturamento").reduce((sum, row) => sum + row.revenue, 0), "Rateio calculado": totals.calculated, Ajustes: totals.adjustment, "Total final": totals.final, Diferença: difference }]), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((x) => ({ Competência: competence, "Base TOTVS atualizada em": baseUpdateLabel, Coligada: x.code, Empresa: x.name, Faturamento: x.revenue, Participação: x.share, Regra: x.rule, "Rateio calculado": x.calculated, Ajuste: x.adjustment, "Motivo do ajuste": x.code === "25" && competence >= "2024-01" ? "Ajuste de multa IRPJ e CSLL" : "", "Rateio final": x.finalValue }))), "Memória do rateio");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Etapa", "Critério", "Aplicação"], ...calculationCriteria]), "Critérios utilizados");
    applyRaizWorkbookStyle(wb);
    XLSX.writeFile(wb, `Rateio_CSC_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }
  function exportAccounting() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Competência: competence, "Base TOTVS atualizada em": baseUpdateLabel, "Custos elegíveis": costPool, "Base proporcional": rows.filter((row) => row.rule === "Proporcional ao faturamento").reduce((sum, row) => sum + row.revenue, 0), "Rateio calculado": totals.calculated, Ajustes: totals.adjustment, "Rateio final": totals.final, Diferença: difference }]), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((row) => ({ Competência: competence, "Base TOTVS atualizada em": baseUpdateLabel, Coligada: row.code, Empresa: row.name, "Faturamento considerado": row.revenue, "Percentual no rateio": row.share, Regra: row.rule, "Rateio calculado": row.calculated, Ajuste: row.adjustment, "Motivo do ajuste": row.code === "25" && competence >= "2024-01" ? "Ajuste de multa IRPJ e CSLL" : "", "Rateio final": row.finalValue }))), "Memória de Cálculo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(movementDetails.map((detail) => ({ Competência: competence, "Base TOTVS atualizada em": baseUpdateLabel, Coligada: detail.company, Empresa: detail.companyName, Conta: detail.account, Descrição: detail.description, Classificação: detail.classification, Débito: detail.debit, Crédito: detail.credit, Movimento: detail.movement, "Valor considerado": detail.considered }))), "Movimentos Considerados");
    applyRaizWorkbookStyle(wb);
    XLSX.writeFile(wb, `Memoria_Calculo_Rateio_CSC_${competence.slice(5)}_${competence.slice(0, 4)}.xlsx`);
  }
  return <section className="panel csc-panel">
    {loading && <div className="csc-processing"><RefreshCw className="spin" /><b>Atualizando Base TOTVS de todas as empresas</b></div>}
    <div className="csc-heading"><div><h2>Rateio CSC</h2><p>Primeiro carregue as contas de resultado; depois rateie os custos da Raiz entre as coligadas.</p></div><div className="csc-actions"><button className={`secondary ${Object.keys(resultMovements).length ? "source-loaded" : ""}`} onClick={updateAccountingBase} disabled={!!loading}><RefreshCw />Atualizar Base TOTVS</button><button className="primary" onClick={calculate} disabled={!costPool || !Object.keys(resultMovements).length}><Calculator />Ratear custos da Raiz</button><button className="secondary" onClick={exportFile} disabled={!rows.length}><Download />Exportar memória</button></div></div>
    <div className="csc-tabs"><button className={view === "allocation" ? "active" : ""} onClick={() => setView("allocation")}>Apuração do rateio</button><button className={view === "accounting" ? "active" : ""} onClick={() => setView("accounting")}>Memória de Cálculo</button><button className={view === "rules" ? "active" : ""} onClick={() => setView("rules")}>Regras CSC</button></div>
    {message && <div className="notice">{message}</div>}
    {view === "rules" ? <div className="csc-rules">
      <div className="csc-rule-intro"><b>Premissas identificadas na planilha modelo</b><span>Estas regras formam a memória de cálculo e devem ser revisadas quando houver alteração contratual.</span></div>
      <ol>
        {calculationCriteria.map(([step, title, description]) => <li key={step}><b>{step}. {title}</b><span>{description}</span></li>)}
      </ol>
    </div> : view === "accounting" ? <div className="csc-accounting">
      <div className="csc-accounting-heading"><div><b>Memória de Cálculo</b><span>Movimentos contábeis e etapas que formam o rateio final de cada empresa.</span></div><button className="secondary" onClick={exportAccounting} disabled={!rows.length}><Download />Exportar memória de cálculo</button></div>
      {rows.length ? <><div className="csc-accounting-summary"><article><span>Empresas calculadas</span><b>{rows.filter((row) => Math.abs(row.finalValue) >= .01).length}</b></article><article><span>Movimentos considerados</span><b>{movementDetails.length}</b></article><article><span>Rateio calculado</span><b>{money.format(totals.calculated)}</b></article><article className={Math.abs(difference) <= .1 ? "is-balanced" : ""}><span>Rateio final</span><b>{money.format(totals.final)}</b><small>{Math.abs(difference) <= .1 ? <><CheckCircle2 /> Fechado</> : `Diferença ${money.format(difference)}`}</small></article></div><div className="csc-company-list-title"><div><b>Composição do rateio por empresa</b><span>Da base de faturamento ao valor final</span></div></div><div className="table-wrap csc-accounting-table"><table><thead><tr><th>Coligada</th><th>Empresa</th><th>Faturamento considerado</th><th>% no rateio</th><th>Rateio calculado</th><th>Ajuste</th><th>Rateio final</th></tr></thead><tbody>{rows.map((row) => <tr key={`memory-${row.code}`}><td><b>{row.code}</b></td><td>{row.name}</td><td>{money.format(row.revenue)}</td><td>{row.share ? percent.format(row.share) : "—"}</td><td>{money.format(row.calculated)}</td><td>{money.format(row.adjustment)}</td><td><b>{money.format(row.finalValue)}</b></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Total</td><td>{money.format(rows.reduce((sum, row) => sum + row.revenue, 0))}</td><td>{percent.format(rows.reduce((sum, row) => sum + row.share, 0))}</td><td>{money.format(totals.calculated)}</td><td>{money.format(totals.adjustment)}</td><td>{money.format(totals.final)}</td></tr></tfoot></table></div><div className="csc-company-list-title"><div><b>Movimentos considerados no cálculo</b><span>Contas elegíveis de receitas e custos de todas as empresas</span></div></div><div className="table-wrap csc-accounting-table"><table><thead><tr><th>Coligada</th><th>Empresa</th><th>Conta</th><th>Descrição</th><th>Classificação</th><th>Débito</th><th>Crédito</th><th>Movimento</th><th>Valor considerado</th></tr></thead><tbody>{movementDetails.map((detail, index) => <tr key={`detail-${detail.company}-${detail.account}-${index}`}><td><b>{detail.company}</b></td><td>{detail.companyName}</td><td>{detail.account}</td><td>{detail.description}</td><td>{detail.classification}</td><td>{money.format(detail.debit)}</td><td>{money.format(detail.credit)}</td><td>{money.format(detail.movement)}</td><td><b>{money.format(detail.considered)}</b></td></tr>)}</tbody></table></div><p className="csc-accounting-note">A soma dos valores considerados forma as bases exibidas no resumo por empresa. Ajustes de base fechada são apresentados em linha própria para manter a rastreabilidade.</p></> : <div className="csc-empty"><Calculator /><b>Calcule o rateio para gerar a memória de cálculo</b><span>Os movimentos e os valores serão apresentados empresa por empresa.</span></div>}
    </div> : <>
    <div className="csc-summary"><article><span>Custos da Raiz no mês</span><b>{money.format(costPool)}</b><small>{competence.slice(5)}/{competence.slice(0, 4)}</small></article><article><span>Base proporcional do mês</span><b>{money.format(rows.length ? rows.filter((row) => row.rule === "Proporcional ao faturamento").reduce((sum, row) => sum + row.revenue, 0) : 0)}</b></article><article><span>Rateio calculado</span><b>{money.format(totals.calculated)}</b></article><article><span>Ajustes</span><b>{money.format(totals.adjustment)}</b></article><article className={rows.length && Math.abs(difference) <= .1 ? "is-balanced" : ""}><span>Diferença de fechamento</span><b>{money.format(difference)}</b><small>{rows.length && Math.abs(difference) <= .1 ? <><CheckCircle2 /> Fechado</> : "Aguardando cálculo"}</small></article></div>
    <div className="csc-company-list-title"><div><b>Base contábil mensal — contas de resultado</b><span>{calculationList.length} empresa(s), incluindo a Raiz · competência {competence.slice(5)}/{competence.slice(0, 4)}</span></div></div>
    <div className="table-wrap csc-table csc-company-preview"><table><thead><tr><th>Coligada</th><th>Empresa</th><th>Receitas do mês</th><th>Custos/despesas do mês</th><th>Movimento líquido</th><th>Função no rateio</th><th>Situação</th></tr></thead><tbody>{calculationList.map((row) => <tr key={`preview-${row.code}`}><td><b>{row.code}</b></td><td>{row.name}</td><td>{money.format(row.revenue)}</td><td>{money.format(row.costs)}</td><td className={row.net < 0 ? "negative" : ""}><b>{money.format(row.net)}</b></td><td>{row.rule}</td><td><span className={`csc-company-status ${row.status === "Calculada" ? "done" : row.status === "Base carregada" ? "ready" : ""}`}>{row.status}</span></td></tr>)}</tbody></table></div>
    {rows.length && <><div className="csc-company-list-title"><div><b>Rateio dos custos da Raiz entre as coligadas</b><span>A porcentagem corresponde ao faturamento da empresa dividido pelo faturamento total das participantes</span></div></div><div className="table-wrap csc-table"><table><thead><tr><th>Coligada</th><th>Empresa</th><th>Faturamento mensal</th><th>% no rateio</th><th>Regra</th><th>Rateio</th><th>Ajuste</th><th>Final</th></tr></thead><tbody>{rows.map((row) => <tr key={row.code}><td><b>{row.code}</b></td><td>{row.name}</td><td>{money.format(row.revenue)}</td><td><b>{row.share ? percent.format(row.share) : "—"}</b></td><td>{row.rule}</td><td><b>{money.format(row.calculated)}</b></td><td><input type="number" step=".01" value={adjustments[row.code] || 0} title={row.code === "25" && competence >= "2024-01" ? "Ajuste de multa IRPJ e CSLL" : "Ajuste"} disabled={row.code === "25" && competence >= "2024-01"} onChange={(e) => setAdjustments({ ...adjustments, [row.code]: Number(e.target.value) })} /></td><td><b>{money.format(row.finalValue)}</b></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Total das participantes</td><td>{money.format(rows.reduce((sum, row) => sum + row.revenue, 0))}</td><td>{percent.format(rows.reduce((sum, row) => sum + row.share, 0))}</td><td>—</td><td>{money.format(totals.calculated)}</td><td>{money.format(totals.adjustment)}</td><td>{money.format(totals.final)}</td></tr></tfoot></table></div></>}</>}
  </section>;
}
