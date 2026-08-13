"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileCheck2, LoaderCircle, RefreshCw, Upload, X } from "lucide-react";
import {
  ExtractedDocument,
  exportPayrollAnalysis,
  parseProvisionFiles,
  parseSpreadsheetDocuments,
  PayrollAnalysis,
  PayrollLotRow,
  reconcilePayroll,
} from "@/lib/payroll-reconciliation";

type Props = { companyCode: string; companyName: string; competence: string; accessToken: string };
type TotvsLot = { lotCode: string; application: string; records: number; debit: number; credit: number; rows: PayrollLotRow[]; alternatives: string[] };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const acceptedSupport = ".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.xlsm";

export default function PayrollBatchReconciliation({ companyCode, companyName, competence, accessToken }: Props) {
  const [lot, setLot] = useState<TotvsLot | null>(null);
  const [lotLoading, setLotLoading] = useState(false);
  const [lotMessage, setLotMessage] = useState("");
  const [supportFiles, setSupportFiles] = useState<File[]>([]);
  const [tolerance, setTolerance] = useState(1);
  const [analysis, setAnalysis] = useState<PayrollAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const grouped = useMemo(() => ({
    liquids: analysis?.checks.filter((item) => item.group === "Líquidos") ?? [],
    inss: analysis?.checks.filter((item) => item.group === "INSS") ?? [],
    fgts: analysis?.checks.filter((item) => item.group === "FGTS") ?? [],
    irrf: analysis?.checks.filter((item) => item.group === "IRRF") ?? [],
    provisions: analysis?.checks.filter((item) => item.group === "Provisões") ?? [],
  }), [analysis]);

  async function loadLot() {
    if (!companyCode || !competence) return;
    setLotLoading(true);
    setLot(null);
    setAnalysis(null);
    setLotMessage("");
    try {
      const params = new URLSearchParams({ company: companyCode, competence });
      const response = await fetch(`/api/payroll/lot?${params}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json() as TotvsLot & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível localizar o lote pendente no TOTVS.");
      setLot(payload);
      setLotMessage(`Lote ${payload.lotCode} identificado automaticamente no Labore para ${competence}.`);
    } catch (error) {
      setLotMessage((error as Error).message);
    } finally {
      setLotLoading(false);
    }
  }

  useEffect(() => { void loadLot(); }, [companyCode, competence, accessToken]);

  function addSupport(files?: FileList | null) {
    if (!files) return;
    setSupportFiles((current) => {
      const merged = [...current];
      for (const file of Array.from(files)) if (!merged.some((item) => item.name === file.name && item.size === file.size)) merged.push(file);
      return merged;
    });
    setAnalysis(null);
  }

  async function runAnalysis() {
    if (!lot) return setMessage("Aguarde a identificação automática do lote pendente no TOTVS.");
    setBusy(true);
    setMessage("");
    setAnalysis(null);
    try {
      const provisions = await parseProvisionFiles(supportFiles);
      const visualFiles = supportFiles.filter((file) => /\.(pdf|png|jpe?g|webp)$/i.test(file.name));
      let documents: ExtractedDocument[] = await parseSpreadsheetDocuments(supportFiles);
      if (visualFiles.length) {
        const form = new FormData();
        visualFiles.forEach((file) => form.append("files", file));
        const response = await fetch("/api/payroll/documents", { method: "POST", body: form });
        const payload = await response.json() as { documents?: ExtractedDocument[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Não foi possível ler os documentos do DP.");
        documents = [...documents, ...(payload.documents ?? [])];
      }
      const result = reconcilePayroll(lot.rows, lot.lotCode, documents, provisions, tolerance, competence);
      setAnalysis(result);
      setMessage(result.canIntegrate
        ? "Conferência da análise de lote da folha x documentos finalizada; pode integrar o lote."
        : "Conferência concluída com pendências a verificar.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSupportFiles([]);
    setAnalysis(null);
    setMessage("");
  }

  return (
    <section className="payroll-flow">
      <div className="panel payroll-intro">
        <div>
          <span className="eyebrow">CONFERÊNCIA AUTOMATIZADA</span>
          <h2>Lote da Folha de Pagamento</h2>
          <p>O lote é obtido automaticamente no TOTVS pelo módulo Labore, coligada e competência; envie apenas os documentos do DP.</p>
          <span className="payroll-company-chip">Coligada selecionada: <b>{companyCode || "não informada"}</b> — {companyName.replace(/^\s*\d+\s*[—-]\s*/, "")}</span>
        </div>
        <label className="payroll-tolerance">
          <span>Tolerância por item</span>
          <div><span>R$</span><input type="number" min="0" step="0.01" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} /></div>
        </label>
      </div>

      <div className="payroll-upload-grid">
        <div className={`panel payroll-upload ${lot ? "ready" : ""}`}>
          {lotLoading ? <LoaderCircle className="spinning" /> : lot ? <FileCheck2 /> : <AlertTriangle />}
          <span>Lote automático do Labore</span>
          <b>{lot ? `Lote ${lot.lotCode} · aplicação ${lot.application}` : lotLoading ? "Consultando o TOTVS..." : "Lote pendente não localizado"}</b>
          <small>{lot ? `${lot.records} linhas · débitos ${brl.format(lot.debit)} · créditos ${brl.format(lot.credit)}` : lotMessage}</small>
          <button className="chart-toggle" type="button" onClick={() => void loadLot()} disabled={lotLoading}><RefreshCw /> Atualizar leitura</button>
        </div>
        <label className={`panel payroll-upload ${supportFiles.length ? "ready" : ""}`}>
          {supportFiles.length ? <FileCheck2 /> : <Upload />}
          <span>Documentos do DP</span>
          <b>{supportFiles.length ? `${supportFiles.length} arquivo(s) selecionado(s)` : "Selecione todos os documentos"}</b>
          <small>Folha Analítica, DCTFWeb, FGTS, IRRF, férias e 13º</small>
          <input type="file" multiple accept={acceptedSupport} onChange={(event) => addSupport(event.target.files)} />
        </label>
      </div>

      {supportFiles.length > 0 && <div className="panel payroll-file-list">
        <div><b>Documentos selecionados</b><button type="button" onClick={reset}><X /> Limpar</button></div>
        <ul>{supportFiles.map((file) => <li key={`${file.name}-${file.size}`}><FileCheck2 /><span>{file.name}</span><button aria-label={`Remover ${file.name}`} onClick={() => { setSupportFiles((files) => files.filter((item) => item !== file)); setAnalysis(null); }}><X /></button></li>)}</ul>
      </div>}

      <button className="primary payroll-run" disabled={!lot || busy || lotLoading} onClick={runAnalysis}>
        {busy ? <LoaderCircle className="spinning" /> : <CheckCircle2 />}
        {busy ? "Lendo e conferindo documentos..." : "Executar conferência do lote"}
      </button>

      {message && <div className={`payroll-message ${analysis?.canIntegrate ? "ok" : "review"}`}>
        {analysis?.canIntegrate ? <CheckCircle2 /> : <AlertTriangle />}<span>{message}</span>
      </div>}

      {analysis && <>
        <div className="payroll-summary">
          <article><span>Débitos</span><b>{brl.format(analysis.debit)}</b></article>
          <article><span>Créditos</span><b>{brl.format(analysis.credit)}</b></article>
          <article><span>Diferença do lote</span><b>{brl.format(analysis.difference)}</b></article>
          <article className={analysis.canIntegrate ? "ok" : "review"}><span>Situação</span><b>{analysis.canIntegrate ? "Pode integrar" : "Verificar pendências"}</b></article>
        </div>

        <ResultTable title="Líquidos da folha" subtitle="Salário, RPA, rescisão, férias e adiantamentos" rows={grouped.liquids} />
        <InssMemoryTable analysis={analysis} />
        <ResultTable title="Conciliação do INSS" subtitle="Comparação do lote com a DCTFWeb após os ajustes dos eventos 130 e 131" rows={grouped.inss} />
        <ResultTable title="FGTS por guia" subtitle="FGTS mensal e rescisório, sem encargos, com tolerância de até R$ 40,00" rows={grouped.fgts} />
        <ResultTable title="IRRF por código" subtitle="Lançamento do 0561 e recolhimentos 0561/0588 conforme o pagamento" rows={grouped.irrf} />
        <ResultTable title="Provisões" subtitle="Movimento mensal de férias e 13º salário" rows={grouped.provisions} />

        <div className="panel payroll-export">
          <div><span className="eyebrow">MEMÓRIA DA VERIFICAÇÃO</span><h3>Relatório pronto para arquivamento</h3><p>O Excel inclui resumo, conferências por grupo e o detalhamento do lote.</p></div>
          <button className="primary" onClick={() => exportPayrollAnalysis(analysis, companyCode, companyName, competence)}><Download /> Baixar memória em Excel</button>
        </div>
      </>}
    </section>
  );
}

function InssMemoryTable({ analysis }: { analysis: PayrollAnalysis }) {
  const memory = analysis.inssMemory;
  const rows: Array<[string, string, number | null]> = [
    ["Total contribuição previdenciária — segurados", "+", memory.insured],
    ["Total contribuição previdenciária — patronal", "+", memory.employer],
    ["Total para outras entidades e fundos", "+", memory.otherEntities],
    ["Código 1162 — INSS retido", "−", memory.retained1162],
    ["INSS da folha na guia", "=", memory.payrollGuide],
    ["Evento 130 — INSS férias ref. próximo mês", "−", memory.event130],
    ["Evento 131 — INSS férias desc. mês anterior", "+", memory.event131],
    ["Guia após os ajustes", "=", memory.adjustedGuide],
    ["INSS contabilizado no lote", "comparar", memory.lot],
    ["Diferença lote menos guia ajustada", "=", memory.difference],
  ];
  return <section className="panel payroll-results">
    <header><div><h3>Memória de cálculo do INSS</h3><p>Composição da DCTFWeb e ajustes obrigatórios da Folha Analítica</p></div></header>
    <div className="table-wrap"><table><thead><tr><th>Componente</th><th>Operação</th><th>Valor</th></tr></thead>
      <tbody>{rows.map(([label, operation, value]) => <tr key={label}><td><b>{label}</b></td><td>{operation}</td><td>{value === null ? "Não identificado" : brl.format(value)}</td></tr>)}</tbody>
    </table></div>
  </section>;
}

function ResultTable({ title, subtitle, rows }: { title: string; subtitle: string; rows: PayrollAnalysis["checks"] }) {
  return <section className="panel payroll-results">
    <header><div><h3>{title}</h3><p>{subtitle}</p></div><b>{rows.filter((item) => item.status === "PENDENTE").length} pendência(s)</b></header>
    <div className="table-wrap"><table><thead><tr><th>Item</th><th>Conta / evento</th><th>Lote</th><th>Documento DP</th><th>Diferença</th><th>Status</th><th>Fonte / observação</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.account}-${row.item}`}><td><b>{row.item}</b></td><td>{row.account}<small>{row.event}</small></td><td>{brl.format(row.lot)}</td><td>{row.document === null ? "Não identificado" : brl.format(row.document)}</td><td>{row.difference === null ? "—" : brl.format(row.difference)}</td><td><span className={`payroll-status ${row.status.toLowerCase()}`}>{row.status}</span></td><td className="payroll-source">{row.source}{row.note && <small>{row.note}</small>}</td></tr>)}</tbody>
    </table></div>
  </section>;
}
