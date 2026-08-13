"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CloudDownload, Database, Download, FileCheck2, LoaderCircle, Play, RotateCcw } from "lucide-react";
import {
  ExtractedDocument,
  exportPayrollAnalysis,
  parseProvisionFiles,
  parseSpreadsheetDocuments,
  PayrollAnalysis,
  PayrollCheck,
  PayrollLotRow,
  reconcilePayroll,
} from "@/lib/payroll-reconciliation";

type Props = { companyCode: string; companyName: string; competence: string; accessToken: string };
type TotvsLot = { lotCode: string; application: string; records: number; debit: number; credit: number; rows: PayrollLotRow[]; alternatives: string[] };
type DriveFile = { id: string; name: string; path: string; mimeType: string; size?: string };
type DriveRead = { companyFolder: string; folderPath: string; competence: string; files: DriveFile[] };
type ExecutiveRow = { item: string; lot: number; document: number | null; tolerance: number; status: PayrollCheck["status"]; impact: string; note: string };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayrollBatchReconciliation({ companyCode, companyName, competence, accessToken }: Props) {
  const [lot, setLot] = useState<TotvsLot | null>(null);
  const [drive, setDrive] = useState<DriveRead | null>(null);
  const [supportFiles, setSupportFiles] = useState<File[]>([]);
  const [lotLoading, setLotLoading] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lotMessage, setLotMessage] = useState("Clique para consultar o lote pendente no TOTVS.");
  const [driveMessage, setDriveMessage] = useState("Clique para localizar os documentos oficiais da competência.");
  const [analysis, setAnalysis] = useState<PayrollAnalysis | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLot(null); setDrive(null); setSupportFiles([]); setAnalysis(null); setMessage("");
    setLotMessage("Clique para consultar o lote pendente no TOTVS.");
    setDriveMessage("Clique para localizar os documentos oficiais da competência.");
  }, [companyCode, competence]);

  const executiveRows = useMemo(() => analysis && lot ? buildExecutiveRows(analysis, lot) : [], [analysis, lot]);

  async function loadLot() {
    setLotLoading(true); setLot(null); setAnalysis(null); setMessage("");
    try {
      const params = new URLSearchParams({ company: companyCode, competence });
      const response = await fetch(`/api/payroll/lot?${params}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json() as TotvsLot & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível localizar o lote no TOTVS.");
      setLot(payload);
      setLotMessage(`Lote ${payload.lotCode} · aplicação ${payload.application} · ${payload.records} lançamentos.`);
    } catch (error) {
      setLotMessage((error as Error).message);
    } finally { setLotLoading(false); }
  }

  async function loadDrive() {
    setDriveLoading(true); setDrive(null); setSupportFiles([]); setAnalysis(null); setMessage("");
    try {
      const params = new URLSearchParams({ company: companyCode, competence });
      const response = await fetch(`/api/payroll/drive?${params}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json() as DriveRead & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível localizar os documentos no Drive.");
      setDriveMessage(`${payload.files.length} documento(s) localizado(s). Baixando as bases para análise...`);
      const downloaded = await Promise.all(payload.files.map(async (item) => {
        const fileResponse = await fetch(`/api/payroll/drive?fileId=${encodeURIComponent(item.id)}&company=${encodeURIComponent(companyCode)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
        if (!fileResponse.ok) throw new Error(`Não foi possível ler ${item.name}.`);
        return new File([await fileResponse.blob()], item.name, { type: item.mimeType || "application/octet-stream" });
      }));
      setDrive(payload); setSupportFiles(downloaded);
      setDriveMessage(`${downloaded.length} documento(s) prontos · ${payload.folderPath}.`);
    } catch (error) {
      setDriveMessage((error as Error).message);
    } finally { setDriveLoading(false); }
  }

  async function runAnalysis() {
    if (!lot || !supportFiles.length) return setMessage("Faça primeiro a leitura do lote no TOTVS e dos documentos no Drive.");
    setBusy(true); setAnalysis(null); setMessage("");
    try {
      const provisions = await parseProvisionFiles(supportFiles);
      const visualFiles = supportFiles.filter((file) => /\.(pdf|png|jpe?g|webp)$/i.test(file.name));
      let documents: ExtractedDocument[] = await parseSpreadsheetDocuments(supportFiles);
      if (visualFiles.length) {
        const form = new FormData(); visualFiles.forEach((file) => form.append("files", file));
        const response = await fetch("/api/payroll/documents", { method: "POST", body: form });
        const payload = await response.json() as { documents?: ExtractedDocument[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Não foi possível interpretar os documentos do DP.");
        documents = [...documents, ...(payload.documents ?? [])];
      }
      const result = reconcilePayroll(lot.rows, lot.lotCode, documents, provisions, 1, competence);
      setAnalysis(result);
      setMessage(result.canIntegrate ? "Conferência da análise de lote da folha x documentos finalizada; pode integrar o lote." : "Conferência finalizada: pendências a verificar — não integrar o lote neste momento.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  function reset() {
    setLot(null); setDrive(null); setSupportFiles([]); setAnalysis(null); setMessage("");
    setLotMessage("Clique para consultar o lote pendente no TOTVS.");
    setDriveMessage("Clique para localizar os documentos oficiais da competência.");
  }

  return <section className="payroll-flow payroll-command-view">
    <div className="panel payroll-command-header">
      <div><span className="eyebrow">ROTINA AUTOMATIZADA</span><h2>Conciliação Folha de Pagamento</h2><p>Comande a leitura das duas fontes e execute a análise da coligada e competência selecionadas.</p></div>
      <div className="payroll-selection"><b>Coligada {companyCode}</b><span>{companyName.replace(/^\s*\d+\s*[—-]\s*/, "")} · {competence.split("-").reverse().join("/")}</span></div>
    </div>

    <div className="payroll-command-grid">
      <CommandCard icon={<Database />} title="1. Ler lote no TOTVS" detail={lotMessage} ready={Boolean(lot)} loading={lotLoading} onClick={loadLot} />
      <CommandCard icon={<CloudDownload />} title="2. Ler documentos no Drive" detail={driveMessage} ready={Boolean(drive)} loading={driveLoading} onClick={loadDrive} />
      <CommandCard icon={<Play />} title="3. Executar análise" detail={busy ? "Conciliando lote e documentos..." : "Gerar a conferência e a conclusão do fechamento."} ready={Boolean(analysis)} loading={busy} disabled={!lot || !drive || lotLoading || driveLoading} onClick={runAnalysis} primary />
    </div>

    <div className="payroll-command-footer">
      <span>{lot && drive ? "As duas fontes estão prontas para conciliação." : "A análise será liberada após as duas leituras."}</span>
      <button type="button" className="chart-toggle" onClick={reset}><RotateCcw /> Reiniciar</button>
    </div>

    {message && !analysis && <div className="payroll-message review"><AlertTriangle /><span>{message}</span></div>}

    {analysis && <section className="panel payroll-executive">
      <header className="payroll-executive-title">
        <h2>CONFERÊNCIA DO LOTE DA FOLHA — COLIGADA {companyCode}</h2>
        <p>Competência {competence.split("-").reverse().join("/")} | {companyName.replace(/^\s*\d+\s*[—-]\s*/, "")} | Fontes: TOTVS Labore e Google Drive</p>
      </header>
      <div className="table-wrap"><table><thead><tr><th>Verificação</th><th>Lote / referência</th><th>Documento / contraparte</th><th>Diferença</th><th>Tolerância</th><th>Status</th><th>Impacto</th><th>Observação</th></tr></thead>
        <tbody>{executiveRows.map((row) => <tr key={row.item}><td><b>{row.item}</b></td><td>{number.format(row.lot)}</td><td>{row.document === null ? "Não identificado" : number.format(row.document)}</td><td className={row.status === "PENDENTE" ? "difference-pending" : ""}>{row.document === null ? "—" : number.format(row.lot - row.document)}</td><td>{number.format(row.tolerance)}</td><td><span className={`payroll-status ${row.status.toLowerCase()}`}>{row.status}</span></td><td>{row.impact}</td><td>{row.note}</td></tr>)}</tbody>
      </table></div>
      <div className={`payroll-conclusion ${analysis.canIntegrate ? "ok" : "pending"}`}>{analysis.canIntegrate ? "CONCLUSÃO: CONFERÊNCIA FINALIZADA — PODE INTEGRAR O LOTE" : "CONCLUSÃO: PENDÊNCIAS A VERIFICAR — NÃO INTEGRAR O LOTE NESTE MOMENTO"}</div>
      <p className="payroll-executive-note">{executiveNarrative(executiveRows, analysis.canIntegrate)}</p>
      <div className="payroll-export-action"><span>{message}</span><button className="primary" onClick={() => exportPayrollAnalysis(analysis, companyCode, companyName, competence)}><Download /> Exportar documentação da análise</button></div>
    </section>}
  </section>;
}

function CommandCard({ icon, title, detail, ready, loading, disabled, onClick, primary }: { icon: React.ReactNode; title: string; detail: string; ready: boolean; loading: boolean; disabled?: boolean; onClick: () => void | Promise<void>; primary?: boolean }) {
  return <article className={`panel payroll-command-card ${ready ? "ready" : ""}`}>
    <span className="payroll-command-icon">{loading ? <LoaderCircle className="spinning" /> : ready ? <FileCheck2 /> : icon}</span>
    <div><b>{title}</b><p>{detail}</p></div>
    <button type="button" className={primary ? "primary" : "chart-toggle"} disabled={disabled || loading} onClick={() => void onClick()}>{loading ? "Processando..." : ready && !primary ? "Ler novamente" : title}</button>
  </article>;
}

function aggregate(checks: PayrollCheck[]) {
  const document = checks.some((row) => row.document === null) ? null : checks.reduce((sum, row) => sum + (row.document ?? 0), 0);
  const status = checks.some((row) => row.status === "PENDENTE") ? "PENDENTE" : checks.some((row) => row.status === "INFORMATIVO") ? "INFORMATIVO" : "OK";
  return { lot: checks.reduce((sum, row) => sum + row.lot, 0), document, status: status as PayrollCheck["status"] };
}

function buildExecutiveRows(analysis: PayrollAnalysis, lot: TotvsLot): ExecutiveRow[] {
  const liquids = aggregate(analysis.checks.filter((row) => row.group === "Líquidos"));
  const provisions = aggregate(analysis.checks.filter((row) => row.group === "Provisões"));
  const checkRows = (group: PayrollCheck["group"]) => analysis.checks.filter((row) => row.group === group).map((row) => ({ item: row.item, lot: row.lot, document: row.document, tolerance: group === "FGTS" ? 40 : 1, status: row.status, impact: row.status === "INFORMATIVO" ? "Acompanhamento" : group === "Provisões" ? "Conforme movimento" : "Bloqueante", note: row.note || row.source }));
  return [
    { item: "Equilíbrio do lote", lot: lot.debit, document: lot.credit, tolerance: .01, status: Math.abs(lot.debit - lot.credit) <= .01 ? "OK" : "PENDENTE", impact: "Bloqueante", note: `Lote ${lot.lotCode}: débitos e créditos.` },
    { item: "Líquidos da folha", lot: liquids.lot, document: liquids.document, tolerance: 1, status: liquids.status, impact: "Bloqueante", note: "Salários, férias, rescisões, RPA e adiantamentos." },
    ...checkRows("INSS"), ...checkRows("FGTS"), ...checkRows("IRRF"),
    { item: "Provisões — movimentação do mês", lot: provisions.lot, document: provisions.document, tolerance: 1, status: provisions.status, impact: "Bloqueia somente divergência do movimento", note: "Férias e 13º: principal, FGTS e INSS." },
  ];
}

function executiveNarrative(rows: ExecutiveRow[], canIntegrate: boolean) {
  if (canIntegrate) return "Todas as verificações bloqueantes ficaram dentro das tolerâncias definidas. A memória pode ser exportada e o lote está liberado para integração.";
  const pending = rows.filter((row) => row.status === "PENDENTE").map((row) => `${row.item}: diferença de ${row.document === null ? "documento não identificado" : brl.format(row.lot - row.document)}`);
  return `Permanecem pendências a verificar: ${pending.join("; ")}. Os itens informativos permanecem registrados na memória e não são ocultados da análise.`;
}
