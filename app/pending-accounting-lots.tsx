"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";

type Lot = { companyCode: string; companyName: string; lotCode: string; application: string; applicationName: string; date: string; records: number; debit: number; credit: number; difference: number };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function PendingAccountingLots({ companyCode, allCompanies, competence, accessToken, onLoadingChange }: { companyCode: string; allCompanies: boolean; competence: string; accessToken: string; onLoadingChange: (loading: boolean) => void }) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Selecione a empresa e clique em Atualizar.");
  const [updatedAt, setUpdatedAt] = useState("");

  const update = useCallback(async () => {
    if (!companyCode || !competence || !accessToken) return;
    setLoading(true); onLoadingChange(true); setMessage("");
    try {
      const target = allCompanies ? "all" : companyCode;
      const response = await fetch(`/api/totvs/accounting/pending-lots?company=${encodeURIComponent(target)}&competence=${encodeURIComponent(competence)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível consultar os lotes pendentes.");
      const collected = (payload.lots || []) as Lot[];
      setLots(collected); setUpdatedAt(payload.updatedAt || new Date().toISOString());
      setMessage(collected.length ? `${collected.length} lote(s) pendente(s) encontrado(s).` : `Nenhum lote pendente de integração para ${allCompanies ? "as empresas liberadas" : "esta empresa"} e competência.`);
    } catch (error) { setLots([]); setMessage((error as Error).message); }
    finally { setLoading(false); onLoadingChange(false); }
  }, [accessToken, allCompanies, companyCode, competence, onLoadingChange]);

  useEffect(() => {
    const listener = () => { void update(); };
    window.addEventListener("pending-lots:update", listener);
    return () => window.removeEventListener("pending-lots:update", listener);
  }, [update]);

  const totals = lots.reduce((result, lot) => ({ records: result.records + lot.records, debit: result.debit + lot.debit, credit: result.credit + lot.credit }), { records: 0, debit: 0, credit: 0 });
  return <section className="panel pending-lots">
    <div className="pending-lots-summary"><article><span>Lotes pendentes</span><b>{lots.length}</b></article><article><span>Lançamentos</span><b>{totals.records}</b></article><article><span>Total de débitos</span><b>{money.format(totals.debit)}</b></article><article><span>Total de créditos</span><b>{money.format(totals.credit)}</b></article></div>
    {message && <div className={`notice ${message.includes("não") || message.includes("Não") ? "" : "success"}`}>{lots.length ? <TriangleAlert /> : <CheckCircle2 />}{message}{updatedAt && <small>Atualizado em {new Date(updatedAt).toLocaleString("pt-BR")}</small>}</div>}
    <div className="table-wrap pending-lots-table"><table><thead><tr><th>Empresa</th><th>Lote</th><th>Origem</th><th>Data</th><th>Lançamentos</th><th>Débitos</th><th>Créditos</th><th>Diferença</th><th>Situação</th></tr></thead><tbody>{loading ? <tr><td colSpan={9} className="empty-row">Consultando a Planilha NET 5 no TOTVS...</td></tr> : lots.length ? lots.map((lot) => <tr key={`${lot.companyCode}-${lot.application}-${lot.lotCode}`}><td><b>{lot.companyCode}</b> — {lot.companyName}</td><td><b>{lot.lotCode}</b></td><td>{lot.applicationName}</td><td>{lot.date ? new Date(`${lot.date.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—"}</td><td>{lot.records}</td><td>{money.format(lot.debit)}</td><td>{money.format(lot.credit)}</td><td className={Math.abs(lot.difference) > .01 ? "negative" : ""}>{money.format(lot.difference)}</td><td><span className="pending-lot-status">Pendente para integrar</span></td></tr>) : <tr><td colSpan={9} className="empty-row">Clique em Atualizar para buscar os lotes pendentes {allCompanies ? "de todas as empresas" : "da empresa filtrada"}.</td></tr>}</tbody></table></div>
  </section>;
}
