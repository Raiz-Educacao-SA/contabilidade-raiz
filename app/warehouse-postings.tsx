"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, PackageOpen, ReceiptText, Trash2, Upload } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import {
  buildWarehousePostingsCsv,
  encodeWarehouseCsv,
  parseWarehouseSheets,
  type WarehouseImportResult,
} from "@/lib/warehouse-postings";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const emptyResult: WarehouseImportResult = { postings: [], sourceRows: 0, errors: [] };

function normalizeStoredResult(result?: WarehouseImportResult): WarehouseImportResult {
  if (!result) return emptyResult;
  return {
    ...result,
    errors: result.errors.filter((error) => !/^O arquivo não possui valores para a coligada/i.test(error)),
  };
}

export default function WarehousePostings({ companyCode, companyName, competence }: {
  companyCode: string;
  companyName: string;
  competence: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<WarehouseImportResult>(emptyResult);
  const [loading, setLoading] = useState(false);
  const normalizedCompanyCode = String(Number(companyCode || 0));
  const isRoot = normalizedCompanyCode === "1";
  const cacheKey = `contabilidade-raiz:almoxarifado:${normalizedCompanyCode}:${competence}`;

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const cached = window.localStorage.getItem(cacheKey);
        if (!cached) {
          setFileName("");
          setResult(emptyResult);
          return;
        }
        const parsed = JSON.parse(cached) as { fileName?: string; result?: WarehouseImportResult };
        setFileName(parsed.fileName || "");
        setResult(normalizeStoredResult(parsed.result));
      } catch {
        setFileName("");
        setResult(emptyResult);
      }
    });
    return () => { active = false; };
  }, [cacheKey]);

  const total = useMemo(
    () => result.postings.reduce((sum, posting) => sum + posting.amount, 0),
    [result.postings],
  );
  const canExport = result.postings.length > 0 && result.errors.length === 0;

  async function importFile(file?: File) {
    if (!file) return;
    setLoading(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const parsed = parseWarehouseSheets(
        workbook.SheetNames.map((name) => ({
          name,
          rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
            header: 1,
            raw: true,
            defval: "",
          }),
        })),
        { selectedCompanyCode: normalizedCompanyCode, selectedCompanyName: companyName, competence },
      );
      setFileName(file.name);
      setResult(parsed);
      window.localStorage.setItem(cacheKey, JSON.stringify({ fileName: file.name, result: parsed }));
    } catch {
      const failed = { ...emptyResult, errors: ["Não foi possível ler o arquivo. Confirme se ele está em formato Excel válido."] };
      setFileName(file.name);
      setResult(failed);
      window.localStorage.setItem(cacheKey, JSON.stringify({ fileName: file.name, result: failed }));
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clearImport() {
    setFileName("");
    setResult(emptyResult);
    window.localStorage.removeItem(cacheKey);
    if (inputRef.current) inputRef.current.value = "";
  }

  function exportPostings() {
    if (!canExport) return;
    const csv = buildWarehousePostingsCsv(result.postings, competence);
    const url = URL.createObjectURL(new Blob([encodeWarehouseCsv(csv)], { type: "text/csv;charset=windows-1252" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `coligada${normalizedCompanyCode.padStart(2, "0")}-almoxarifado.csv`;
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
          <h2>Gerar lançamentos pelo Excel</h2>
          <p>
            Importe o controle recebido da área responsável. O sistema consolida os valores e prepara o CSV contábil da competência.
          </p>
        </div>
        <div className="warehouse-actions">
          <label className={`secondary warehouse-upload ${loading ? "is-disabled" : ""}`}>
            <Upload /> {loading ? "Lendo arquivo..." : "Selecionar Excel"}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              disabled={loading}
              onChange={(event) => void importFile(event.target.files?.[0])}
            />
          </label>
          <button type="button" className="primary" disabled={!canExport} onClick={exportPostings} title={result.errors.length ? "Corrija os itens indicados antes de gerar o CSV" : "Gerar CSV de lançamentos"}>
            <ReceiptText /> Lançamentos
          </button>
          <button type="button" className="secondary warehouse-clear" disabled={!fileName || loading} onClick={clearImport}>
            <Trash2 /> Limpar
          </button>
        </div>
      </div>

      <div className="warehouse-summary">
        <article><span>Arquivo recebido</span><b title={fileName}>{fileName || "Aguardando"}</b><small>Excel da área responsável</small></article>
        <article><span>Linhas consideradas</span><b>{result.sourceRows}</b><small>Registros da empresa filtrada</small></article>
        <article><span>Lançamentos</span><b>{result.postings.length}</b><small>{isRoot ? "Segregados por empresa de destino" : "Segregados por filial"}</small></article>
        <article><span>Valor total</span><b>{money.format(total)}</b><small>Competência {competence.slice(5)}/{competence.slice(0, 4)}</small></article>
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

      {!fileName ? (
        <div className="warehouse-empty">
          <PackageOpen />
          <b>Selecione o controle do Almoxarifado</b>
          <span>
            {isRoot
              ? "Na Raiz, a filial será sempre 01 e a conta de débito será escolhida pela empresa de destino."
              : "Nas demais coligadas, o arquivo deve informar a filial e o valor do consumo."}
          </span>
        </div>
      ) : result.postings.length ? (
        <div className="table-wrap warehouse-table">
          <table>
            <thead>
              <tr>
                <th>Coligada</th>
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
              {result.postings.map((posting) => (
                <tr key={`${posting.companyCode}-${posting.branchCode}-${posting.destinationCode || "geral"}`}>
                  <td><b>{posting.companyCode.padStart(2, "0")}</b></td>
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
            <tfoot>
              <tr>
                <td colSpan={isRoot ? 7 : 6}>Total dos lançamentos</td>
                <td>{money.format(total)}</td>
                <td>{result.postings.length} lançamento(s)</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="warehouse-empty compact">
          <FileSpreadsheet />
          <b>Sem movimento nesta competência</b>
          <span>Esta empresa não possui valores no controle importado. Nenhum lançamento será gerado, e a tarefa pode ser finalizada normalmente.</span>
        </div>
      )}
    </section>
  );
}
