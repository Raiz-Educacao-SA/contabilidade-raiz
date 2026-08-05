"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, BookText, ListTree, RefreshCw, Search } from "lucide-react";

type Row = { id: string; reduced: string; account: string; description: string; openingBalance: number; debit: number; credit: number; movement: number; closingBalance: number };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type BookReport = "balancete" | "razao" | "plano-contas";

export default function BookAccountingPanel({ report, companyCode, companyName, competence, accessToken }: { report: BookReport; companyCode: string; companyName: string; competence: string; accessToken: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!companyCode || !competence || !accessToken) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/totvs/trial-balance?company=${encodeURIComponent(companyCode)}&competence=${encodeURIComponent(competence)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o balancete.");
      setRows(payload.rows || []);
    } catch (cause) { setRows([]); setError((cause as Error).message); }
    finally { setLoading(false); }
  }, [companyCode, competence, accessToken]);

  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => { const term = search.trim().toLocaleLowerCase("pt-BR"); return term ? rows.filter((row) => `${row.account} ${row.reduced} ${row.description}`.toLocaleLowerCase("pt-BR").includes(term)) : rows; }, [rows, search]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({ debit: sum.debit + row.debit, credit: sum.credit + Math.abs(row.credit), debtor: sum.debtor + Math.max(row.closingBalance, 0), creditor: sum.creditor + Math.abs(Math.min(row.closingBalance, 0)) }), { debit: 0, credit: 0, debtor: 0, creditor: 0 }), [rows]);
  const [year, month] = competence.split("-");

  if (report === "razao") return <ReportPreparation
    icon={BookText}
    eyebrow="RELATÓRIOS BASE · RAZÃO"
    title="Razão contábil"
    description="Esta área receberá os lançamentos detalhados da conta selecionada no Plano de Contas, respeitando a empresa e a competência atuais."
    companyName={companyName}
    competence={`${month}/${year}`}
  />;

  if (report === "plano-contas") return <ReportPreparation
    icon={ListTree}
    eyebrow="RELATÓRIOS BASE · PLANO DE CONTAS"
    title="Plano de Contas"
    description="Aqui serão selecionadas as contas patrimoniais do Book e cadastradas suas categorias, documentações suporte e regras de conciliação."
    companyName={companyName}
    competence={`${month}/${year}`}
  />;

  return <section className="panel book-balance">
    <div className="book-balance-header"><div className="book-title"><span><BookOpenCheck /></span><div><small>BOOK CONTÁBIL · BALANCETE MENSAL</small><h2>{companyName}</h2><p>Competência {month}/{year} · dados oficiais do TOTVS RM</p></div></div><button className="primary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} />{loading ? "Atualizando..." : "Atualizar balancete"}</button></div>
    {error && <div className="notice error">{error}</div>}
    <div className="book-summary"><article><span>Contas no balancete</span><b>{rows.length.toLocaleString("pt-BR")}</b></article><article><span>Total de débitos</span><b>{money.format(totals.debit)}</b></article><article><span>Total de créditos</span><b>{money.format(totals.credit)}</b></article><article><span>Saldo devedor</span><b>{money.format(totals.debtor)}</b></article><article><span>Saldo credor</span><b>{money.format(totals.creditor)}</b></article></div>
    <div className="book-toolbar"><label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conta, código reduzido ou descrição" /></label><span>{filtered.length} conta(s) exibida(s)</span></div>
    <div className="table-wrap book-table"><table><thead><tr><th>Conta</th><th>Cód. reduzido</th><th>Descrição</th><th>Saldo anterior</th><th>Débitos</th><th>Créditos</th><th>Saldo final</th></tr></thead><tbody>{loading && !rows.length ? <tr><td colSpan={7} className="empty-row">Consultando o balancete no TOTVS...</td></tr> : filtered.length ? filtered.map((row) => <tr key={`${row.id}-${row.account}`}><td><b>{row.account}</b></td><td className="reduced-code">{row.reduced || "—"}</td><td>{row.description}</td><td>{money.format(row.openingBalance)}</td><td>{money.format(row.debit)}</td><td>{money.format(Math.abs(row.credit))}</td><td className={row.closingBalance < 0 ? "negative" : ""}><b>{money.format(row.closingBalance)}</b></td></tr>) : <tr><td colSpan={7} className="empty-row">Nenhuma conta encontrada para esta empresa e competência.</td></tr>}</tbody></table></div>
  </section>;
}

function ReportPreparation({ icon: Icon, eyebrow, title, description, companyName, competence }: { icon: typeof BookText; eyebrow: string; title: string; description: string; companyName: string; competence: string }) {
  return <section className="panel book-report-preparation">
    <span className="book-report-icon"><Icon /></span>
    <small>{eyebrow}</small>
    <h2>{title}</h2>
    <p>{description}</p>
    <div className="book-report-context"><b>{companyName}</b><span>Competência {competence}</span></div>
    <div className="notice">Estrutura de navegação criada. A integração on-line deste relatório será a próxima etapa.</div>
  </section>;
}
