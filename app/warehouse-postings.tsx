"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, PackageOpen, ReceiptText, Trash2, Upload } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import {
  buildWarehousePostingsCsv,
  encodeWarehouseCsv,
  parseWarehouseSheetsForAllCompanies,
  warehouseControlTotal,
  type WarehouseImportResult,
  type WarehousePosting,
} from "@/lib/warehouse-postings";
import { supabase } from "@/lib/supabase";

type WarehouseCompany = { code: string; name: string };
type WarehouseCompanyGroup = WarehouseCompany & { postings: WarehousePosting[]; total: number };
type WarehouseStoredSnapshot = { fileName?: string; result?: WarehouseImportResult };

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const emptyResult: WarehouseImportResult = { postings: [], sourceRows: 0, errors: [] };

function normalizeStoredResult(result?: WarehouseImportResult): WarehouseImportResult {
  if (!result) return emptyResult;
  return {
    ...result,
    postings: Array.isArray(result.postings) ? result.postings : [],
    sourceRows: Number(result.sourceRows || 0),
    errors: (result.errors || []).filter((error) => !/^O arquivo não possui valores para a coligada/i.test(error)),
  };
}

function cleanCompanyName(value: string, code: string) {
  const numericCode = String(Number(code || 0));
  const cleaned = String(value || "")
    .replace(new RegExp(`^0*${numericCode}\\s*[—–-]?\\s*`, "i"), "")
    .trim();
  return cleaned || `Coligada ${numericCode.padStart(2, "0")}`;
}

export default function WarehousePostings({ companies, competence, isFinalized, onReadyChange }: {
  companies: WarehouseCompany[];
  competence: string;
  isFinalized: boolean;
  onReadyChange: (ready: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<WarehouseImportResult>(emptyResult);
  const [loading, setLoading] = useState(false);
  const [sharingError, setSharingError] = useState("");
  const cacheKey = `contabilidade-raiz:almoxarifado:todas:${competence}`;

  useEffect(() => {
    let active = true;

    function readLocalSnapshot() {
      try {
        const cached = window.localStorage.getItem(cacheKey);
        return cached ? JSON.parse(cached) as WarehouseStoredSnapshot : null;
      } catch {
        return null;
      }
    }

    async function loadSharedSnapshot(useLocalFallback: boolean) {
      const { data, error } = await supabase
        .from("almoxarifado_lotes")
        .select("arquivo_nome, resultado")
        .eq("competencia", competence)
        .maybeSingle();
      if (!active) return;

      if (error) {
        setSharingError("Não foi possível acessar o lote compartilhado. Tente novamente.");
        if (!useLocalFallback) return;
      } else if (data) {
        setFileName(String(data.arquivo_nome || ""));
        setResult(normalizeStoredResult(data.resultado as WarehouseImportResult));
        setSharingError("");
        return;
      }

      if (!useLocalFallback) {
        setFileName("");
        setResult(emptyResult);
        setSharingError("");
        return;
      }

      const cached = readLocalSnapshot();
      const cachedFileName = cached?.fileName || "";
      const cachedResult = normalizeStoredResult(cached?.result);
      setFileName(cachedFileName);
      setResult(cachedResult);

      if (!error && cachedFileName && cachedResult.errors.length === 0) {
        const { error: migrationError } = await supabase.from("almoxarifado_lotes").upsert({
          competencia: competence,
          arquivo_nome: cachedFileName,
          resultado: cachedResult,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: "competencia" });
        if (active) {
          setSharingError(migrationError ? "Não foi possível compartilhar o lote com os demais usuários." : "");
        }
      }
    }

    void loadSharedSnapshot(true);
    const channel = supabase
      .channel(`almoxarifado-lote-${competence}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "almoxarifado_lotes", filter: `competencia=eq.${competence}` }, () => void loadSharedSnapshot(false))
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [cacheKey, competence, isFinalized]);

  useEffect(() => {
    onReadyChange(Boolean(fileName && result.errors.length === 0 && !sharingError));
  }, [fileName, onReadyChange, result.errors.length, sharingError]);

  const companyGroups = useMemo<WarehouseCompanyGroup[]>(() => {
    const grouped = new Map<string, WarehouseCompanyGroup>();
    const companyNames = new Map(companies.map((item) => [String(Number(item.code || 0)), item.name]));
    result.postings.forEach((posting) => {
      const code = String(Number(posting.companyCode || 0));
      const current = grouped.get(code) || {
        code,
        name: cleanCompanyName(companyNames.get(code) || posting.companyName, code),
        postings: [],
        total: 0,
      };
      current.postings.push(posting);
      current.total = Math.round((current.total + posting.amount + Number.EPSILON) * 100) / 100;
      grouped.set(code, current);
    });
    return [...grouped.values()].sort((left, right) => Number(left.code) - Number(right.code));
  }, [companies, result.postings]);

  const controlTotal = useMemo(() => warehouseControlTotal(result.postings), [result.postings]);

  async function importFile(file?: File) {
    if (!file) return;
    setLoading(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const parsed = parseWarehouseSheetsForAllCompanies(
        workbook.SheetNames.map((name) => ({
          name,
          rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
            header: 1,
            raw: true,
            defval: "",
          }),
        })),
        { companies, competence },
      );
      setFileName(file.name);
      setResult(parsed);
      setSharingError("");
      window.localStorage.setItem(cacheKey, JSON.stringify({ fileName: file.name, result: parsed }));
      if (parsed.errors.length === 0) {
        const { error } = await supabase.from("almoxarifado_lotes").upsert({
          competencia: competence,
          arquivo_nome: file.name,
          resultado: parsed,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: "competencia" });
        if (error) setSharingError("Não foi possível compartilhar o lote com os demais usuários.");
      }
    } catch {
      const failed = { ...emptyResult, errors: ["Não foi possível ler o arquivo. Confirme se ele está em formato Excel válido."] };
      setFileName(file.name);
      setResult(failed);
      setSharingError("");
      window.localStorage.setItem(cacheKey, JSON.stringify({ fileName: file.name, result: failed }));
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function clearImport() {
    const { error } = await supabase.from("almoxarifado_lotes").delete().eq("competencia", competence);
    if (error) {
      setSharingError("Não foi possível limpar o lote compartilhado. Tente novamente.");
      return;
    }
    setFileName("");
    setResult(emptyResult);
    setSharingError("");
    window.localStorage.removeItem(cacheKey);
    if (inputRef.current) inputRef.current.value = "";
  }

  function exportCompanyPostings(group: WarehouseCompanyGroup) {
    if (!group.postings.length || result.errors.length) return;
    const csv = buildWarehousePostingsCsv(group.postings, competence);
    const url = URL.createObjectURL(new Blob([encodeWarehouseCsv(csv)], { type: "text/csv;charset=windows-1252" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `coligada${group.code.padStart(2, "0")}-almoxarifado.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel warehouse-panel">
      <div className="warehouse-heading">
        <div>
          <span className="eyebrow">CONTROLE DO ALMOXARIFADO</span>
          <h2>Gerar lançamentos de todas as empresas</h2>
          <p>Importe o controle uma única vez. Os valores serão separados por empresa e por filial para gerar os CSVs contábeis.</p>
        </div>
        <div className="warehouse-actions">
          {isFinalized && <span className="warehouse-locked"><CheckCircle2 /> Tarefa fechada</span>}
          <label className={`secondary warehouse-upload ${loading || isFinalized ? "is-disabled" : ""}`} title={isFinalized ? "Reabra a tarefa para substituir o arquivo" : undefined}>
            <Upload /> {loading ? "Lendo arquivo..." : isFinalized ? "Arquivo fixado" : "Selecionar Excel"}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              disabled={loading || isFinalized}
              onChange={(event) => void importFile(event.target.files?.[0])}
            />
          </label>
          {fileName && result.errors.length === 0 && result.postings.length === 0 && (
            <span className="warehouse-no-postings" title="Arquivo aceito sem movimento na competência">
              <CheckCircle2 /> Sem lançamentos
            </span>
          )}
          <button type="button" className="secondary warehouse-clear" disabled={!fileName || loading || isFinalized} onClick={() => void clearImport()} title={isFinalized ? "Reabra a tarefa para limpar o arquivo" : undefined}>
            <Trash2 /> Limpar
          </button>
        </div>
      </div>

      <div className="warehouse-summary warehouse-summary-all">
        <article><span>Arquivo recebido</span><b title={fileName}>{fileName || "Aguardando"}</b><small>Excel da área responsável</small></article>
        <article><span>Linhas consideradas</span><b>{result.sourceRows}</b><small>Registros da competência</small></article>
        <article><span>Empresas com movimento</span><b>{companyGroups.length}</b><small>Apenas empresas com valores</small></article>
        <article><span>Lançamentos</span><b>{result.postings.length}</b><small>Separados por empresa e filial</small></article>
        <article><span>Valor do controle</span><b>{money.format(controlTotal)}</b><small>Competência {competence.slice(5)}/{competence.slice(0, 4)}</small></article>
      </div>

      {result.errors.length > 0 && (
        <div className="warehouse-errors" role="alert">
          <AlertTriangle />
          <div>
            <b>O arquivo precisa de ajustes antes de gerar os lançamentos</b>
            {result.errors.map((error) => <span key={error}>{error}</span>)}
          </div>
        </div>
      )}

      {sharingError && (
        <div className="warehouse-errors" role="alert">
          <AlertTriangle />
          <div>
            <b>O lote ainda não está disponível para todos os usuários</b>
            <span>{sharingError}</span>
          </div>
        </div>
      )}

      {fileName && result.errors.length === 0 && result.postings.length === 0 && (
        <div className="warehouse-success" role="status">
          <CheckCircle2 />
          <div>
            <b>Arquivo aceito</b>
            <span>O controle não possui valores para nenhuma empresa nesta competência. Nenhum lançamento é necessário e a tarefa pode ser finalizada normalmente.</span>
          </div>
        </div>
      )}

      {!fileName ? (
        <div className="warehouse-empty">
          <PackageOpen />
          <b>Selecione o controle do Almoxarifado</b>
          <span>O arquivo será lido integralmente. Somente as empresas com movimento serão apresentadas abaixo.</span>
        </div>
      ) : companyGroups.length ? (
        <div className="warehouse-company-list">
          {companyGroups.map((group) => {
            const isRoot = group.code === "1";
            return (
              <section className="warehouse-company-card" key={group.code}>
                <header>
                  <div>
                    <small>COLIGADA {group.code.padStart(2, "0")}</small>
                    <h3>{group.name}</h3>
                    <span>{group.postings.length} lançamento(s) · {money.format(group.total)}</span>
                  </div>
                  <button
                    type="button"
                    className="primary warehouse-company-export"
                    disabled={result.errors.length > 0}
                    onClick={() => exportCompanyPostings(group)}
                    title={result.errors.length ? "Corrija os itens indicados antes de gerar o CSV" : `${isFinalized ? "Extrair lote" : "Gerar lançamentos"} da coligada ${group.code.padStart(2, "0")}`}
                  >
                    <ReceiptText /> {isFinalized ? "Extrair lote" : "Lançamentos"}
                  </button>
                </header>
                <div className="table-wrap warehouse-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Filial</th>
                        {isRoot && <th>Empresa de destino</th>}
                        <th>Conta débito</th>
                        <th>Reduzido</th>
                        <th>Conta crédito</th>
                        <th>Reduzido</th>
                        <th>Valor</th>
                        <th>Histórico</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.postings.map((posting) => (
                        <tr key={`${posting.companyCode}-${posting.branchCode}-${posting.destinationCode || "geral"}`}>
                          <td><b>{posting.branchCode.padStart(2, "0")}</b></td>
                          {isRoot && <td>{posting.destinationCode.padStart(2, "0")} — {posting.destinationName}</td>}
                          <td>{posting.debitAccount}</td>
                          <td>{posting.debitReduced}</td>
                          <td>{posting.creditAccount}</td>
                          <td>{posting.creditReduced}</td>
                          <td><b>{money.format(posting.amount)}</b></td>
                          <td>{posting.history}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="warehouse-empty compact">
          <FileSpreadsheet />
          <b>Sem movimento nesta competência</b>
          <span>O controle importado não possui valores para nenhuma empresa. Nenhum lançamento será gerado, e a tarefa pode ser finalizada normalmente.</span>
        </div>
      )}
    </section>
  );
}
