"use client";

import { useState } from "react";
import { CheckCircle2, ListChecks, RefreshCw, TriangleAlert } from "lucide-react";

type Lot = { lotCode: string; application: string; applicationName: string; date: string; records: number; debit: number; credit: number; difference: number };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function PendingAccountingLots({ companyCode, companyName, competence, accessToken }: { companyCode: string; companyName: string; competence: string; accessToken: string }) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Selecione a empresa e clique em Atualizar.");
  const [updatedAt, setUpdatedAt] = useState("");

  async function update() {
    if (!companyCode || !competence || !accessToken) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/totvs/accounting/pending-lots?company=${encodeURIComponent(companyCode)}&competence=${encodeURIComponent(competence)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível consultar os lotes pendentes.");
      setLots(payload.lots || []); setUpdatedAt(payload.updatedAt || "");
      setMessage(payload.lots?.length ? `${payload.lots.length} lote(s) pendente(s) encontrado(s).` : "Nenhum lote pendente de integração para esta empresa e competência.");
    } catch (error) { setLots([]); setMessage((error as Error).message); }
    finally { setLoading(false); }
  }

  const totals = lots.reduce((result, lot) => ({ records: result.records + lot.records, debit: result.debit + lot.debit, credit: result.credit + lot.credit }), { records: 0, debit: 0, credit: 0 });
  const [year, month] = competence.split("-");

  return <section className="panel pending-lots">
    <header className="pending-lots-header"><div><span><ListChecks /></span><div><small>MÓDULO CONTÁBIL · PLANILHA NET 5</small><h2>Lotes a integrar</h2><p>{companyCode} — {companyName} · competência {month}/{year}</p></div></div><button className="primary" onClick={() => void update()} disabled={loading || !companyCode}><RefreshCw className={loading ? "spin" : ""} />{loading ? "Atualizando..." : "Atualizar"}</button></header>
    <div className="pending-lots-summary"><article><span>Lotes pendentes</span><b>{lots.length}</b></article><article><span>Lançamentos</span><b>{totals.records}</b></article><article><span>Total de débitos</span><b>{money.format(totals.debit)}</b></article><article><span>Total de créditos</span><b>{money.format(totals.credit)}</b></article></div>
    {message && <div className={`notice ${message.includes("não") || message.includes("Não") ? "" : "success"}`}>{lots.length ? <TriangleAlert /> : <CheckCircle2 />}{message}{updatedAt && <small>Atualizado em {new Date(updatedAt).toLocaleString("pt-BR")}</small>}</div>}
    <div className="table-wrap pending-lots-table"><table><thead><tr><th>Lote</th><th>Origem</th><th>Data</th><th>Lançamentos</th><th>Débitos</th><th>Créditos</th><th>Diferença</th><th>Situação</th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="empty-row">Consultando a Planilha NET 5 no TOTVS...</td></tr> : lots.length ? lots.map((lot) => <tr key={`${lot.application}-${lot.lotCode}`}><td><b>{lot.lotCode}</b></td><td>{lot.applicationName}</td><td>{lot.date ? new Date(`${lot.date.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—"}</td><td>{lot.records}</td><td>{money.format(lot.debit)}</td><td>{money.format(lot.credit)}</td><td className={Math.abs(lot.difference) > .01 ? "negative" : ""}>{money.format(lot.difference)}</td><td><span className="pending-lot-status">Pendente para integrar</span></td></tr>) : <tr><td colSpan={8} className="empty-row">Clique em Atualizar para buscar os lotes pendentes da empresa filtrada.</td></tr>}</tbody></table></div>
  </section>;
}
