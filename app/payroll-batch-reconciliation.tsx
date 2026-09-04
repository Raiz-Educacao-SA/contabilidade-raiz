"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Database, Download, FileCheck2, FolderOpen, LoaderCircle, Play, RotateCcw } from "lucide-react";
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
import { extractVisualDocumentsInBrowser } from "@/lib/browser-document-extraction";

type Props = { companyCode: string; companyName: string; competence: string; accessToken: string };
type TotvsLot = { lotCode: string; application: string; records: number; debit: number; credit: number; rows: PayrollLotRow[]; alternatives: string[] };
type DriveFile = { id: string; name: string; path: string; mimeType: string; size?: string };
type DriveRead = { companyFolder: string; folderPath: string; competence: string; files: DriveFile[] };
type ExecutiveRow = { item: string; lot: number; document: number | null; tolerance: number; status: PayrollCheck["status"]; impact: string; note: string };
type LocalFileHandle = { kind: "file"; name: string; getFile: () => Promise<File> };
type LocalDirectoryHandle = { kind: "directory"; name: string; values: () => AsyncIterableIterator<LocalFileHandle | LocalDirectoryHandle> };

const acceptedSupportFile = /\.(pdf|png|jpe?g|webp|xlsx|xls|xlsm)$/i;
const previousAnalysisFile = /CONFERENCIA.*LOTE|ANALISE DE FOLHA/i;

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
  const [driveMessage, setDriveMessage] = useState("Selecione a pasta da coligada e competência no Drive sincronizado.");
  const [analysis, setAnalysis] = useState<PayrollAnalysis | null>(null);
  const [message, setMessage] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState("");
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);

  const executiveRows = useMemo(() => analysis && lot ? buildExecutiveRows(analysis, lot) : [], [analysis, lot]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setActionsHost(document.getElementById("payroll-filter-actions"));
    });
    return () => {
      active = false;
    };
  }, []);

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

  async function selectLocalFolder() {
    setDriveLoading(true); setDrive(null); setSupportFiles([]); setAnalysis(null); setMessage("");
    try {
      const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: "read" }) => Promise<LocalDirectoryHandle> }).showDirectoryPicker;
      if (!picker) throw new Error("Este navegador não permite selecionar pastas. Utilize o Google Chrome ou Microsoft Edge atualizado.");
      const folder = await picker({ mode: "read" });
      setDriveMessage(`Lendo os documentos de ${folder.name}...`);
      const located = await collectLocalFiles(folder);
      if (!located.length) throw new Error("Nenhum PDF, imagem ou Excel válido foi encontrado na pasta selecionada.");
      if (located.length > 80) throw new Error("Foram encontrados mais de 80 documentos. Selecione somente a pasta da coligada e competência escolhidas.");
      const files = located.map((item) => item.file);
      const payload: DriveRead = {
        companyFolder: folder.name,
        folderPath: `Pasta local sincronizada/${folder.name}`,
        competence,
        files: located.map((item, index) => ({ id: `local-${index}`, name: item.file.name, path: item.path, mimeType: item.file.type || "application/octet-stream", size: String(item.file.size) })),
      };
      setDrive(payload); setSupportFiles(files);
      setDriveMessage(`${files.length} documento(s) prontos · ${folder.name}.`);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setDriveMessage("Seleção cancelada. Escolha a pasta da coligada quando desejar continuar.");
        return;
      }
      setDriveMessage((error as Error).message);
    } finally { setDriveLoading(false); }
  }

  async function runAnalysis() {
    if (!lot || !supportFiles.length) return setMessage("Faça primeiro a leitura do lote no TOTVS e selecione a pasta dos documentos.");
    setBusy(true); setAnalysis(null); setMessage(""); setAnalysisProgress("Preparando as planilhas da pasta...");
    try {
      const provisions = await parseProvisionFiles(supportFiles);
      const visualFiles = supportFiles.filter((file) => /\.(pdf|png|jpe?g|webp)$/i.test(file.name));
      let documents: ExtractedDocument[] = await parseSpreadsheetDocuments(supportFiles);
      documents = [...documents, ...await extractVisualDocumentsInBrowser(visualFiles, setAnalysisProgress)];
      setAnalysisProgress("Conferindo lote, encargos, líquidos e provisões...");
      const result = reconcilePayroll(lot.rows, lot.lotCode, documents, provisions, 1, competence);
      setAnalysis(result);
      setMessage(result.canIntegrate ? "Conferência da análise de lote da folha x documentos finalizada; pode integrar o lote." : "Conferência finalizada: pendências a verificar — não integrar o lote neste momento.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); setAnalysisProgress(""); }
  }

  function reset() {
    setLot(null); setDrive(null); setSupportFiles([]); setAnalysis(null); setMessage("");
    setLotMessage("Clique para consultar o lote pendente no TOTVS.");
    setDriveMessage("Selecione a pasta da coligada e competência no Drive sincronizado.");
  }

  const actionButtons = <div className="payroll-command-actions">
    <button type="button" className={`payroll-action-button ${lot ? "is-ready" : ""}`} disabled={lotLoading || busy} onClick={() => void loadLot()}>
      {lotLoading ? <LoaderCircle className="spinning" /> : <Database />}
      Atualizar TOTVS
    </button>
    <button type="button" className={`payroll-action-button ${drive ? "is-ready" : ""}`} disabled={driveLoading || busy} onClick={() => void selectLocalFolder()}>
      {driveLoading ? <LoaderCircle className="spinning" /> : <FolderOpen />}
      Selecionar pasta
    </button>
    <button type="button" className={`payroll-action-button is-primary ${analysis ? "is-ready" : ""}`} disabled={!lot || !drive || lotLoading || driveLoading || busy} onClick={() => void runAnalysis()}>
      {busy ? <LoaderCircle className="spinning" /> : <Play />}
      Analisar
    </button>
    <button type="button" className="payroll-action-button is-ghost" disabled={lotLoading || driveLoading || busy} onClick={reset}>
      <RotateCcw />
      Limpar
    </button>
  </div>;

  return <section className="payroll-flow payroll-command-view">
    {actionsHost ? createPortal(actionButtons, actionsHost) : (
      <div className="payroll-command-header-actions">{actionButtons}</div>
    )}

    <div className="payroll-command-grid">
      <CommandCard icon={<Database />} title="Lote TOTVS" detail={lotMessage} ready={Boolean(lot)} loading={lotLoading} />
      <CommandCard icon={<FolderOpen />} title="Pasta da Folha" detail={driveMessage} ready={Boolean(drive)} loading={driveLoading} />
      <CommandCard icon={<Play />} title="Análise da folha" detail={busy ? analysisProgress || "Conciliando lote e documentos..." : analysis ? "Análise finalizada para a competência." : "Liberada após as duas leituras."} ready={Boolean(analysis)} loading={busy} />
    </div>

    <div className="payroll-command-footer">
      <span>{lot && drive ? "As duas fontes estão prontas para conciliação." : "A análise será liberada após as duas leituras."}</span>
    </div>

    {message && !analysis && <div className="payroll-message review"><AlertTriangle /><span>{message}</span></div>}

    {analysis && <section className="panel payroll-executive">
      <header className="payroll-executive-title">
        <h2>CONFERÊNCIA DO LOTE DA FOLHA — COLIGADA {companyCode}</h2>
        <p>Competência {competence.split("-").reverse().join("/")} | {companyName.replace(/^\s*\d+\s*[—-]\s*/, "")} | Fontes: TOTVS Labore e pasta local sincronizada</p>
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

async function collectLocalFiles(folder: LocalDirectoryHandle, prefix = folder.name, depth = 0): Promise<Array<{ file: File; path: string }>> {
  if (depth > 5) return [];
  const located: Array<{ file: File; path: string }> = [];
  for await (const entry of folder.values()) {
    const path = `${prefix}/${entry.name}`;
    if (entry.kind === "directory") {
      if (!/^00\s*[-_. ]*ANTERIORES$/i.test(entry.name)) located.push(...await collectLocalFiles(entry, path, depth + 1));
      continue;
    }
    if (entry.name.startsWith("~$") || !acceptedSupportFile.test(entry.name) || previousAnalysisFile.test(path)) continue;
    located.push({ file: await entry.getFile(), path });
    if (located.length > 80) return located;
  }
  return located;
}

function CommandCard({ icon, title, detail, ready, loading }: { icon: React.ReactNode; title: string; detail: string; ready: boolean; loading: boolean }) {
  return <article className={`panel payroll-command-card ${ready ? "ready" : ""}`}>
    <span className="payroll-command-icon">{loading ? <LoaderCircle className="spinning" /> : ready ? <FileCheck2 /> : icon}</span>
    <div><b>{title}</b><p>{detail}</p></div>
    <small>{loading ? "Atualizando" : ready ? "Concluído" : "Pendente"}</small>
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
