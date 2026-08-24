"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Database,
  Download,
  Landmark,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  AccountingAccount,
  AccountingRow,
  BankMetadata,
  BankRow,
  MatchRow,
  accountingBankAccounts,
  brl,
  exportReport,
  reconcile,
  selectMonthlyDifferenceDays,
  validateMonthly,
} from "@/lib/reconciliation";
import {
  resolveStatementBindings,
  type DataEngineStatement,
  type DataEngineStatementOperations,
} from "@/lib/data-engine-statements";
import ModuleCompletionControl from "@/app/module-completion-control";
import { financialCompletionIdentity } from "@/lib/schedule-completion";
import type { TotvsAccountingDiagnostic } from "@/lib/totvs-accounting";
import {
  completedReconciliationRevision,
  sourceReadyForReconciliation,
} from "@/lib/reconciliation-cycle";

type Statement = {
  fileName: string;
  account: AccountingAccount;
  bank: BankRow[];
  metadata: BankMetadata;
};
type AccountResult = Statement & {
  rows: MatchRow[];
  validation: ReturnType<typeof validateMonthly>;
  competence: string;
  diagnostics?: TotvsAccountingDiagnostic[];
};
type ReconciliationExceptionSection = {
  key: string;
  title: string;
  rows: MatchRow[];
};
type StoredAccountResult = Pick<
  AccountResult,
  "fileName" | "account" | "bank" | "metadata" | "competence" | "diagnostics"
>;
type WorkflowState = {
  accounting: AccountingRow[];
  accountingDiagnostics: TotvsAccountingDiagnostic[];
  bankAccounts: AccountingAccount[];
  statements: Statement[];
  results: AccountResult[];
  notice: string;
  dataEngineSources: DataEngineStatement[];
  dataEngineOperations: DataEngineStatementOperations | null;
  unmatchedSources: DataEngineStatement[];
  unmatchedAccounts: AccountingAccount[];
  accountingMessage: string;
  accountingUpdated: boolean;
  statementsUpdated: boolean;
  accountingRevision: number;
  statementsRevision: number;
  reconciliationRevision: number;
};

const workflowCache = new Map<string, WorkflowState>();
const EXCEPTION_PAGE_SIZE = 25;
const reconciliationCacheDbName = "contabilidade-raiz-reconciliation-cache";
const reconciliationCacheStoreName = "monthly-results";

function openReconciliationCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB indisponível."));
      return;
    }
    const request = window.indexedDB.open(reconciliationCacheDbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(reconciliationCacheStoreName)) {
        request.result.createObjectStore(reconciliationCacheStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readReconciliationCache(
  historyKey: string,
): Promise<StoredAccountResult[] | null> {
  try {
    const db = await openReconciliationCache();
    return await new Promise<StoredAccountResult[] | null>((resolve, reject) => {
      const transaction = db.transaction(reconciliationCacheStoreName, "readonly");
      const request = transaction
        .objectStore(reconciliationCacheStoreName)
        .get(historyKey);
      request.onsuccess = () =>
        resolve((request.result as StoredAccountResult[] | undefined) ?? null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
  } catch {
    return null;
  }
}

async function writeReconciliationCache(
  historyKey: string,
  results: AccountResult[],
) {
  try {
    const stored: StoredAccountResult[] = results.map((result) => ({
      fileName: result.fileName,
      account: result.account,
      bank: result.bank,
      metadata: result.metadata,
      competence: result.competence,
      diagnostics: result.diagnostics,
    }));
    const db = await openReconciliationCache();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(reconciliationCacheStoreName, "readwrite");
      transaction.objectStore(reconciliationCacheStoreName).put(stored, historyKey);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
    return true;
  } catch {
    return false;
  }
}

async function deleteReconciliationCache(historyKey: string) {
  try {
    const db = await openReconciliationCache();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(reconciliationCacheStoreName, "readwrite");
      transaction.objectStore(reconciliationCacheStoreName).delete(historyKey);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch {
    // A limpeza visual não deve depender do cache local.
  }
}

function hydrateStoredResults(parsed: StoredAccountResult[]): AccountResult[] {
  const reviveRow = <
    T extends { date?: Date; bankDate?: Date; accountingDate?: Date },
  >(
    row: T,
  ) => ({
    ...row,
    ...(row.date ? { date: new Date(row.date) } : {}),
    ...(row.bankDate ? { bankDate: new Date(row.bankDate) } : {}),
    ...(row.accountingDate
      ? { accountingDate: new Date(row.accountingDate) }
      : {}),
  });
  return parsed.map((result) => {
      const bank = result.bank.map(reviveRow);
      const account = {
        ...result.account,
        rows: result.account.rows.map(reviveRow),
      };
      return {
        ...result,
        bank,
        account,
        rows: reconcile(bank, account.rows).map((row) => ({
          ...row,
          sourceAccount: result.account.code,
          sourceBank: result.metadata.account || result.fileName,
        })),
        validation: validateMonthly(bank, account.rows, result.metadata),
      };
    });
}

async function loadStoredResults(historyKey: string): Promise<AccountResult[]> {
  if (typeof window === "undefined") return [];
  const cached = await readReconciliationCache(historyKey);
  if (cached) return hydrateStoredResults(cached);
  const legacyStored = window.localStorage.getItem(historyKey);
  if (!legacyStored) return [];
  try {
    return hydrateStoredResults(
      JSON.parse(legacyStored) as StoredAccountResult[],
    );
  } catch {
    return [];
  }
}

export default function MonthlyReconciliationPanel({
  competence,
  companyId,
  companyCode,
  companyName,
  reconciledBy,
  accessToken,
  userId,
}: {
  competence: string;
  companyId: string;
  companyCode: string;
  companyName: string;
  reconciledBy: string;
  accessToken: string;
  userId: string;
}) {
  const historyKey = `conciliacao-financeira:${companyId}:${competence}`;
  const [initialWorkflow] = useState(() => workflowCache.get(historyKey));
  const [accounting, setAccounting] = useState<AccountingRow[]>(
    () => initialWorkflow?.accounting ?? [],
  );
  const [accountingDiagnostics, setAccountingDiagnostics] = useState<
    TotvsAccountingDiagnostic[]
  >(() => initialWorkflow?.accountingDiagnostics ?? []);
  const [bankAccounts, setBankAccounts] = useState<AccountingAccount[]>(
    () => initialWorkflow?.bankAccounts ?? [],
  );
  const [statements, setStatements] = useState<Statement[]>(
    () => initialWorkflow?.statements ?? [],
  );
  const [results, setResults] = useState<AccountResult[]>(
    () => initialWorkflow?.results ?? [],
  );
  const [notice, setNotice] = useState(() => initialWorkflow?.notice ?? "");
  const [dataEngineSources, setDataEngineSources] = useState<
    DataEngineStatement[]
  >(() => initialWorkflow?.dataEngineSources ?? []);
  const [dataEngineOperations, setDataEngineOperations] =
    useState<DataEngineStatementOperations | null>(
      () => initialWorkflow?.dataEngineOperations ?? null,
    );
  const [unmatchedSources, setUnmatchedSources] = useState<DataEngineStatement[]>(
    () => initialWorkflow?.unmatchedSources ?? [],
  );
  const [unmatchedAccounts, setUnmatchedAccounts] = useState<AccountingAccount[]>(
    () => initialWorkflow?.unmatchedAccounts ?? [],
  );
  const [dataEngineBusy, setDataEngineBusy] = useState(false);
  const [accountingBusy, setAccountingBusy] = useState(false);
  const [accountingUpdated, setAccountingUpdated] = useState(
    () => initialWorkflow?.accountingUpdated ?? false,
  );
  const [statementsUpdated, setStatementsUpdated] = useState(
    () => initialWorkflow?.statementsUpdated ?? false,
  );
  const [accountingRevision, setAccountingRevision] = useState(
    () => initialWorkflow?.accountingRevision ?? 0,
  );
  const [statementsRevision, setStatementsRevision] = useState(
    () => initialWorkflow?.statementsRevision ?? 0,
  );
  const [reconciliationRevision, setReconciliationRevision] = useState(
    () => initialWorkflow?.reconciliationRevision ?? 0,
  );
  const [accountingMessage, setAccountingMessage] = useState(
    () => initialWorkflow?.accountingMessage ?? "Aguardando atualização no TOTVS",
  );
  const [expandedResultCode, setExpandedResultCode] = useState<string | null>(
    null,
  );
  const accountingRequestRef = useRef(0);
  const dataEngineRequestRef = useRef(0);
  const accountingAbortRef = useRef<AbortController | null>(null);
  const dataEngineAbortRef = useRef<AbortController | null>(null);
  const sourceRevisionSequenceRef = useRef(
    Math.max(accountingRevision, statementsRevision, reconciliationRevision),
  );
  const nextSourceRevision = () => {
    sourceRevisionSequenceRef.current += 1;
    return sourceRevisionSequenceRef.current;
  };
  const pending = unmatchedAccounts;
  const statementsReady = statementsUpdated && statements.length > 0;
  const accountingReady = accountingUpdated && accounting.length > 0;
  const accountingFresh = sourceReadyForReconciliation(
    accountingUpdated,
    accountingReady,
    accountingRevision,
    reconciliationRevision,
  );
  const statementsFresh = sourceReadyForReconciliation(
    statementsUpdated,
    statementsReady,
    statementsRevision,
    reconciliationRevision,
  );
  const reconciliationReady =
    accountingFresh &&
    statementsFresh &&
    !accountingBusy &&
    !dataEngineBusy;
  const reportRows = useMemo(
    () => [
      ...results.flatMap((result) => result.rows),
      ...results.flatMap((result): MatchRow[] => {
        if (!result.validation.reconciled) return [];
        return result.validation.dailyDifferences.map((row): MatchRow => ({
          status: "Diferença diária informativa",
          bankDate: new Date(`${row.date}T00:00:00.000Z`),
          description: "Diferença diária compensada no movimento líquido mensal",
          bankValue: row.bankCredits - row.bankDebits,
          accountingDate: new Date(`${row.date}T00:00:00.000Z`),
          nature: "Informativa — não gera pendência na ficha de conciliação",
          accountingValue: row.accountingDebits - row.accountingCredits,
          difference: row.netDifference,
          sourceAccount: result.account.code,
          sourceBank: result.metadata.account || result.fileName,
        }));
      }),
    ],
    [results],
  );
  const divergentResults = useMemo(
    () => results.filter((result) => !result.validation.reconciled),
    [results],
  );
  const reconciledResults = useMemo(
    () => results.filter((result) => result.validation.reconciled),
    [results],
  );
  const resultsByAccount = useMemo(
    () => new Map(results.map((result) => [result.account.code, result])),
    [results],
  );
  const reconciledCount = reconciledResults.length;
  const resultsCurrent =
    results.length > 0 &&
    reconciliationRevision > 0 &&
    accountingRevision <= reconciliationRevision &&
    statementsRevision <= reconciliationRevision;
  const accountingStepComplete = accountingFresh || resultsCurrent;
  const statementsStepComplete = statementsFresh || resultsCurrent;
  const coverageReady = accountingUpdated && statementsUpdated;
  const unmatchedTotal = unmatchedAccounts.length + unmatchedSources.length;
  const reconciliationStatus = accountingUpdated && !accounting.length
    ? "Base atualizada, mas nenhuma conta bancária foi encontrada"
    : statementsUpdated && !statements.length
      ? "Extratos atualizados, mas nenhuma correspondência foi encontrada"
      : resultsCurrent
        ? `${statements.length} encontrada(s) · ${reconciledCount} conciliada(s) · ${divergentResults.length} divergente(s) · atualize as duas bases para executar novamente`
        : !accountingFresh
      ? "Atualize primeiro a base contábil"
        : !statementsFresh
          ? "Atualize agora os extratos bancários"
          : "Bases prontas; clique para executar a conciliação";
  const completionIdentity = financialCompletionIdentity("bancaria", companyCode, companyName);

  useEffect(
    () => () => {
      accountingAbortRef.current?.abort();
      dataEngineAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (initialWorkflow) return;
    let active = true;
    void loadStoredResults(historyKey).then((storedResults) => {
      if (active) setResults(storedResults);
    });
    return () => { active = false; };
  }, [historyKey, initialWorkflow]);

  useEffect(() => {
    for (const cachedKey of workflowCache.keys()) {
      if (cachedKey !== historyKey) workflowCache.delete(cachedKey);
    }
    workflowCache.set(historyKey, {
      accounting,
      accountingDiagnostics,
      bankAccounts,
      statements,
      results,
      notice,
      dataEngineSources,
      dataEngineOperations,
      unmatchedSources,
      unmatchedAccounts,
      accountingMessage,
      accountingUpdated,
      statementsUpdated,
      accountingRevision,
      statementsRevision,
      reconciliationRevision,
    });
  }, [
    accounting,
    accountingDiagnostics,
    accountingMessage,
    accountingRevision,
    accountingUpdated,
    bankAccounts,
    dataEngineOperations,
    dataEngineSources,
    historyKey,
    notice,
    results,
    reconciliationRevision,
    statements,
    statementsRevision,
    statementsUpdated,
    unmatchedAccounts,
    unmatchedSources,
  ]);

  function keepResults(completed: AccountResult[]) {
    const keys = new Set(completed.map((item) => item.account.code));
    const updated = [
      ...results.filter((item) => !keys.has(item.account.code)),
      ...completed,
    ];
    setResults(updated);
    void writeReconciliationCache(historyKey, updated).then((saved) => {
      if (!saved) {
        setNotice(
          "A conciliação foi concluída, mas o navegador não conseguiu manter o histórico local.",
        );
      }
    });
  }

  function clearHistory() {
    if (
      !window.confirm(
        "Deseja limpar o histórico da última conciliação desta empresa e competência?",
      )
    )
      return;
    localStorage.removeItem(historyKey);
    void deleteReconciliationCache(historyKey);
    setResults([]);
    setExpandedResultCode(null);
    setNotice("Histórico da última conciliação removido.");
  }

  async function refreshAccounting() {
    accountingAbortRef.current?.abort();
    const controller = new AbortController();
    accountingAbortRef.current = controller;
    const requestId = accountingRequestRef.current + 1;
    accountingRequestRef.current = requestId;
    const requestIsCurrent = () => accountingRequestRef.current === requestId;
    setAccountingBusy(true);
    setAccountingUpdated(false);
    try {
      const response = await fetch(
        `/api/totvs/accounting?company=${encodeURIComponent(companyCode)}&competence=${encodeURIComponent(competence)}`,
        {
          cache: "no-store",
          headers: { authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        },
      );
      const data = (await response.json()) as {
        rows?: AccountingRow[];
        diagnostics?: TotvsAccountingDiagnostic[];
        error?: string;
        warning?: string;
      };
      if (!requestIsCurrent()) return;
      if (!response.ok || data.error)
        throw new Error(
          data.error || "Não foi possível consultar a Planilha 18 no TOTVS.",
        );
      const rows = (data.rows || []).map((row) => ({
        ...row,
        date: new Date(row.date),
      }));
      const diagnostics = data.diagnostics ?? [];
      const discovered = accountingBankAccounts(rows);
      setAccounting(rows);
      setAccountingDiagnostics(diagnostics);
      setBankAccounts(discovered);
      applySourceBindings(dataEngineSources, discovered);
      setAccountingUpdated(true);
      setAccountingRevision(nextSourceRevision());
      setAccountingMessage(
        `${discovered.length} conta(s) carregada(s) da Planilha 18${diagnostics.length ? ` · ${diagnostics.length} alerta(s) interno(s)` : ""}`,
      );
      if (!dataEngineSources.length)
        setNotice(
          data.warning ||
            `Base contábil atualizada: ${discovered.length} conta(s) bancária(s) encontrada(s) no TOTVS.`,
        );
    } catch (error) {
      if (!requestIsCurrent()) return;
      const message = (error as Error).message;
      setAccountingMessage("Aguardando permissão de leitura no TOTVS");
      setNotice(message);
    } finally {
      if (requestIsCurrent()) {
        accountingAbortRef.current = null;
        setAccountingBusy(false);
      }
    }
  }

  async function scanDataEngine() {
    dataEngineAbortRef.current?.abort();
    const controller = new AbortController();
    dataEngineAbortRef.current = controller;
    const requestId = dataEngineRequestRef.current + 1;
    dataEngineRequestRef.current = requestId;
    const requestIsCurrent = () => dataEngineRequestRef.current === requestId;
    setDataEngineBusy(true);
    setStatementsUpdated(false);
    try {
      const response = await fetch(
        `/api/data-engine/statements?company=${encodeURIComponent(companyCode)}&competence=${encodeURIComponent(competence)}`,
        {
          cache: "no-store",
          headers: { authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        },
      );
      const data = (await response.json()) as {
        statements?: DataEngineStatement[];
        error?: string;
        records?: number;
        operations?: DataEngineStatementOperations;
      };
      if (!requestIsCurrent()) return;
      if (!response.ok || data.error)
        throw new Error(
          data.error || "Não foi possível consultar o Data Engine.",
        );
      const sources = data.statements ?? [];
      setDataEngineSources(sources);
      setDataEngineOperations(data.operations ?? null);
      if (applySourceBindings(sources, bankAccounts)) {
        setStatementsUpdated(true);
        setStatementsRevision(nextSourceRevision());
        setNotice(
          `${data.records ?? 0} movimento(s) carregado(s) do Data Engine em ${sources.length} conta(s) reconhecida(s).`,
        );
      }
    } catch (error) {
      if (!requestIsCurrent()) return;
      setNotice((error as Error).message);
    } finally {
      if (requestIsCurrent()) {
        dataEngineAbortRef.current = null;
        setDataEngineBusy(false);
      }
    }
  }

  function applySourceBindings(
    sources: DataEngineStatement[],
    discoveredAccounts: AccountingAccount[],
  ) {
    const resolved = resolveStatementBindings(sources, discoveredAccounts);
    setUnmatchedSources(resolved.unmatchedSources);
    setUnmatchedAccounts(resolved.unmatchedAccounts);
    const identified = resolved.pairs.map(({ account, source }) => {
      const bank = source.rows.map((row) => ({
        ...row,
        date: new Date(`${row.date}T00:00:00.000Z`),
      }));
      const sourceName = `Data Engine · ${source.metadata.name || `Banco ${source.bankId}`} · ${source.sourceAccountId.slice(0, 12)}`;
      return {
        account,
        bank,
        fileName: sourceName,
        metadata: source.metadata,
      };
    });
    setStatements(identified);
    return true;
  }

  function reconcileStatements(selected: Statement[]) {
    const completed = selected.map((statement) => {
      const rows = reconcile(statement.bank, statement.account.rows).map(
        (row) => ({
          ...row,
          sourceAccount: statement.account.code,
          sourceBank: statement.metadata.account || statement.fileName,
        }),
      );
      return {
        ...statement,
        rows,
        validation: validateMonthly(
          statement.bank,
          statement.account.rows,
          statement.metadata,
        ),
        competence,
        diagnostics: accountingDiagnostics.filter(
          (diagnostic) => diagnostic.account === statement.account.code,
        ),
      };
    });
    keepResults(completed);
    return completed;
  }

  function runOne(statement: Statement) {
    const [completed] = reconcileStatements([statement]);
    setNotice(
      `Conta ${statement.account.code} conciliada individualmente: ${completed.validation.reconciled ? "sem pendência mensal" : "com valores para revisar"}.`,
    );
  }

  function runAll() {
    if (!reconciliationReady)
      return setNotice(
        "Atualize os extratos e a base contábil antes de executar a conciliação.",
      );
    if (!statements.length)
      return setNotice(
        "Erro: nenhum extrato foi reconhecido. Revise os dados de agência e conta e confirme se o formato dos arquivos é compatível.",
      );
    const completed = reconcileStatements(statements);
    setReconciliationRevision(
      completedReconciliationRevision(accountingRevision, statementsRevision),
    );
    const reconciled = completed.filter(
      (item) => item.validation.reconciled,
    ).length;
    const missing = pending.length
      ? ` ${pending.length} conta(s) permaneceram aguardando extrato.`
      : "";
    setNotice(
      `Conciliação mensal concluída: ${reconciled} de ${completed.length} conta(s) sem pendência de movimento mensal.${missing}`,
    );
  }

  function downloadConsolidatedReport() {
    if (!results.length) {
      setNotice("Execute a conciliação antes de gerar o relatório consolidado.");
      return;
    }
    try {
      exportReport(reportRows, `conciliacao_mensal_${competence}`);
      setNotice(
        `Relatório consolidado gerado com ${results.length} conta(s) e ${reportRows.length} lançamento(s).`,
      );
    } catch (error) {
      console.error("[conciliacao-bancaria] Falha ao gerar relatório", error);
      setNotice(
        `Erro: não foi possível gerar o relatório consolidado. ${error instanceof Error ? error.message : "Erro desconhecido."}`,
      );
    }
  }

  return (
    <section className="panel monthly-flow">
      <div className="panel-title">
        <div className="source-control-title">
          <span>ATUALIZAÇÃO DAS FONTES</span>
          <h2>Preparar conciliação por movimento</h2>
          <p>
            Atualize a base contábil e os extratos antes de executar a
            conferência do mês.
          </p>
        </div>
        <div className="history-actions">
          <ModuleCompletionControl
            competence={competence}
            modulo={completionIdentity.modulo}
            setor={completionIdentity.setor}
            userId={userId}
            userEmail={reconciledBy}
            disabled={!results.length}
            disabledReason="Execute a conciliação antes de finalizar a tarefa."
          />
          <button
            className="secondary"
            disabled={!results.length}
            onClick={downloadConsolidatedReport}
          >
            <Download />
            Relatório consolidado
          </button>
          <button
            className="clear-history"
            disabled={!results.length}
            onClick={clearHistory}
          >
            <Trash2 />
            Limpar histórico
          </button>
        </div>
      </div>
      {notice && (
        <div
          className={`notice ${notice.startsWith("Erro:") ? "error" : ""}`}
          role={notice.startsWith("Erro:") ? "alert" : "status"}
        >
          {notice}
        </div>
      )}
      <div className="source-control">
        <div className="source-steps">
          <article className={`${accountingStepComplete ? "ready" : "waiting"} accounting-step`}>
            <div className="source-step-number">1</div>
            <Database />
            <div>
              <b>Base contábil</b>
              <span>
                {accountingBusy
                  ? "Consultando a Planilha 18..."
                  : accountingFresh
                    ? accountingMessage
                    : accountingUpdated
                      ? `${accountingMessage} · atualize para uma nova conciliação`
                      : accountingMessage}
              </span>
            </div>
            <button
              className={`secondary workflow-action accounting-action ${accountingStepComplete ? "is-complete" : "is-available"}`}
              disabled={accountingBusy || dataEngineBusy}
              onClick={refreshAccounting}
            >
              <RefreshCw className={accountingBusy ? "spinning" : ""} />
              {accountingBusy ? "Atualizando..." : "Atualizar base contábil"}
            </button>
          </article>
          <article className={`${statementsStepComplete ? "ready" : "waiting"} statements-step`}>
            <div className="source-step-number">2</div>
            <Landmark />
            <div>
              <b>Extratos bancários</b>
              <span>
                {dataEngineBusy
                  ? "Consultando o Data Engine..."
                  : statementsFresh
                    ? `${dataEngineSources.length} conta(s) encontrada(s) no Data Engine`
                    : statementsUpdated
                      ? `${dataEngineSources.length} conta(s) carregada(s) · atualize para uma nova conciliação`
                    : "Aguardando atualização do Data Engine"}
              </span>
            </div>
            <button
              className={`secondary workflow-action statements-action ${statementsStepComplete ? "is-complete" : accountingFresh ? "is-available" : "is-locked"}`}
              disabled={!accountingFresh || dataEngineBusy}
              onClick={scanDataEngine}
            >
              <RefreshCw className={dataEngineBusy ? "spinning" : ""} />
              {dataEngineBusy ? "Atualizando..." : "Atualizar extratos"}
            </button>
          </article>
          <article
            className={
              resultsCurrent
                ? "completed reconcile-step"
                : reconciliationReady
                  ? "available reconcile-step"
                  : "waiting reconcile-step"
            }
          >
            <div className="source-step-number">3</div>
            <ArrowLeftRight />
            <div>
              <b>Conciliação automática</b>
              <span>{reconciliationStatus}</span>
            </div>
            <button
              className={`primary workflow-action reconciliation-action ${resultsCurrent ? "is-complete" : reconciliationReady ? "is-available" : "is-locked"}`}
              disabled={!reconciliationReady}
              onClick={runAll}
            >
              <ArrowLeftRight />
              {resultsCurrent ? "Conciliação concluída" : "Conciliação automática"}
            </button>
          </article>
        </div>
      </div>
      {coverageReady && (
        <section className="account-coverage" aria-labelledby="account-coverage-title">
          <header className="coverage-heading">
            <div>
              <span>COBERTURA DAS CONTAS</span>
              <h3 id="account-coverage-title">
                Contas encontradas e não encontradas
              </h3>
              <p>
                Compare claramente o que foi localizado nas duas bases e o que
                ainda está sem correspondência.
              </p>
            </div>
            <b className={`coverage-overall ${unmatchedTotal ? "warning" : "ok"}`}>
              {unmatchedTotal
                ? `${unmatchedTotal} item(ns) sem correspondência`
                : "Cobertura completa"}
            </b>
          </header>

          <div className="coverage-summary" aria-label="Resumo da cobertura das contas">
            <article className="matched">
              <CheckCircle2 />
              <div>
                <span>Encontradas nas duas bases</span>
                <strong>{statements.length}</strong>
                <small>Conta contábil + extrato</small>
              </div>
            </article>
            <article className="missing-accounting">
              <Database />
              <div>
                <span>Somente na contabilidade</span>
                <strong>{unmatchedAccounts.length}</strong>
                <small>Sem extrato correspondente</small>
              </div>
            </article>
            <article className="missing-statement">
              <Landmark />
              <div>
                <span>Somente nos extratos</span>
                <strong>{unmatchedSources.length}</strong>
                <small>Sem conta contábil correspondente</small>
              </div>
            </article>
          </div>

          <section className="coverage-group matched">
            <header>
              <div>
                <CheckCircle2 />
                <div>
                  <h4>Encontradas nas duas bases</h4>
                  <p>Estas contas têm conta contábil e extrato identificados.</p>
                </div>
              </div>
              <b>{statements.length}</b>
            </header>
            <ul className="coverage-list">
              {statements.length ? (
                statements.map((statement) => {
                  const savedResult = resultsByAccount.get(statement.account.code);
                  const status = savedResult
                    ? savedResult.validation.reconciled
                      ? "Conciliada"
                      : "Com divergência"
                    : "Pronta para conciliar";
                  return (
                    <li key={statement.account.code}>
                      <span className="coverage-item-icon"><CheckCircle2 /></span>
                      <div>
                        <b>{statement.account.code} — {statement.account.name}</b>
                        <small>
                          Banco {statement.metadata.name || statement.metadata.account || "identificado"}
                          {` · ${statement.bank.length} movimento(s) no extrato`}
                        </small>
                      </div>
                      <span className={`coverage-status ${savedResult?.validation.reconciled ? "ok" : savedResult ? "warning" : "ready"}`}>
                        {status}
                      </span>
                      <button
                        className="reconcile-one"
                        onClick={() => runOne(statement)}
                      >
                        <ArrowLeftRight />
                        {savedResult ? "Conciliar novamente" : "Conciliar esta conta"}
                      </button>
                    </li>
                  );
                })
              ) : (
                <li className="coverage-empty">
                  Nenhuma correspondência automática foi encontrada.
                </li>
              )}
            </ul>
          </section>

          <section className="coverage-group missing">
            <header>
              <div>
                <XCircle />
                <div>
                  <h4>Não encontradas</h4>
                  <p>Estas contas precisam de correção ou complementação da fonte ausente.</p>
                </div>
              </div>
              <b>{unmatchedTotal}</b>
            </header>
            <div className="coverage-missing-grid">
              <section>
                <header>
                  <Database />
                  <div>
                    <h5>Conta contábil sem extrato</h5>
                    <span>{unmatchedAccounts.length} conta(s)</span>
                  </div>
                </header>
                <ul className="coverage-list">
                  {unmatchedAccounts.length ? (
                    unmatchedAccounts.map((account) => (
                      <li key={account.code}>
                        <span className="coverage-item-icon"><Database /></span>
                        <div>
                          <b>{account.code} — {account.name}</b>
                          <small>Não foi encontrado extrato bancário correspondente.</small>
                        </div>
                        <span className="coverage-status missing">Falta extrato</span>
                      </li>
                    ))
                  ) : (
                    <li className="coverage-empty ok">
                      <CheckCircle2 /> Nenhuma conta nesta situação.
                    </li>
                  )}
                </ul>
              </section>
              <section>
                <header>
                  <Landmark />
                  <div>
                    <h5>Extrato sem conta contábil</h5>
                    <span>{unmatchedSources.length} extrato(s)</span>
                  </div>
                </header>
                <ul className="coverage-list">
                  {unmatchedSources.length ? (
                    unmatchedSources.map((source) => (
                      <li key={source.sourceAccountId}>
                        <span className="coverage-item-icon"><Landmark /></span>
                        <div>
                          <b>Banco {source.bankId} — referência {source.metadata.account || source.sourceAccountId.slice(0, 12)}</b>
                          <small>{source.rows.length} movimento(s); nenhuma conta contábil correspondente.</small>
                        </div>
                        <span className="coverage-status missing">Falta conta</span>
                      </li>
                    ))
                  ) : (
                    <li className="coverage-empty ok">
                      <CheckCircle2 /> Nenhum extrato nesta situação.
                    </li>
                  )}
                </ul>
              </section>
            </div>
          </section>
        </section>
      )}
      {dataEngineOperations && (
        <details className="integration-health">
          <summary>Detalhes técnicos da atualização dos extratos</summary>
          <div className="drive-files" aria-label="Saúde das APIs de extratos">
            {Object.entries(dataEngineOperations).map(([operation, records]) => (
              <article key={operation}>
                <CheckCircle2 />
                <div>
                  <b>{operation}</b>
                  <span>{records} registro(s) autorizado(s)</span>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
      {results.length > 0 && (
        <div className="saved-history">
          <div>
            <span>HISTÓRICO MANTIDO</span>
            <h3>
              Última conciliação — {competence.split("-").reverse().join("/")}
            </h3>
            <p>
              {results.length} conta(s) encontradas nas duas bases: {reconciledCount}{" "}
              conciliada(s) e {divergentResults.length} com divergência. Há{" "}
              {unmatchedTotal} item(ns) sem correspondência entre as fontes.
            </p>
          </div>
        </div>
      )}
      {reconciledResults.length > 0 && (
        <>
          <div className="exceptions-title reconciled-title">
            <span>CONCILIAÇÃO CONCLUÍDA</span>
            <h3>Contas conciliadas</h3>
            <p>
              As fichas permanecem recolhidas. Abra uma conta para consultar os
              movimentos mensais conferidos.
            </p>
          </div>
          <div className="monthly-results">
            {reconciledResults.map((result) => (
              <MonthlyAccountResult
                key={result.account.code}
                result={result}
                companyName={companyName}
                reconciledBy={reconciledBy}
                expanded={expandedResultCode === result.account.code}
                onToggle={() =>
                  setExpandedResultCode((current) =>
                    current === result.account.code ? null : result.account.code,
                  )
                }
              />
            ))}
          </div>
        </>
      )}
      {divergentResults.length > 0 && (
        <>
          <div className="exceptions-title">
            <span>TRATAMENTO DE DIVERGÊNCIAS</span>
            <h3>Contas que precisam de análise</h3>
          </div>
          <div className="monthly-results">
            {divergentResults.map((result) => (
              <MonthlyAccountResult
                key={result.account.code}
                result={result}
                companyName={companyName}
                reconciledBy={reconciledBy}
                expanded={expandedResultCode === result.account.code}
                onToggle={() =>
                  setExpandedResultCode((current) =>
                    current === result.account.code ? null : result.account.code,
                  )
                }
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function MonthlyAccountResult({
  result,
  companyName,
  reconciledBy,
  expanded,
  onToggle,
}: {
  result: AccountResult;
  companyName: string;
  reconciledBy: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const value = result.validation;
  return (
    <article
      className={`monthly-account ${value.reconciled ? "ok" : "review"}`}
    >
      <header>
        <div>
          {value.reconciled ? <CheckCircle2 /> : <XCircle />}
          <div>
            <span>
              {value.reconciled
                ? "MOVIMENTO MENSAL CONCILIADO"
                : "REVISAR MOVIMENTO MENSAL"}
            </span>
            <h3>
              {result.account.code} — {result.account.name}
            </h3>
            <p>Extrato {result.metadata.account || result.fileName}</p>
          </div>
        </div>
      </header>
      <div className={`monthly-metrics ${value.reconciled ? "reconciled-metrics" : ""}`}>
        {value.reconciled ? (
          <>
            <div>
              <span>Movimento líquido no extrato</span>
              <b>{brl(value.bankNet)}</b>
              <small>Valor movimentado no extrato bancário</small>
            </div>
            <div>
              <span>Movimento líquido contábil</span>
              <b>{brl(value.accountingNet)}</b>
              <small>Valor movimentado na contabilidade</small>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>Entradas no extrato</span>
              <b>{brl(value.bankCredits)}</b>
              <small>Débitos contábeis: {brl(value.accountingDebits)}</small>
            </div>
            <div>
              <span>Saídas no extrato</span>
              <b>{brl(value.bankDebits)}</b>
              <small>Créditos contábeis: {brl(value.accountingCredits)}</small>
            </div>
            <div>
              <span>Movimento líquido no extrato</span>
              <b>{brl(value.bankNet)}</b>
              <small>Entradas menos saídas</small>
            </div>
            <div>
              <span>Movimento líquido contábil</span>
              <b>{brl(value.accountingNet)}</b>
              <small>Débitos menos créditos</small>
            </div>
            <div className="metric-review">
              <span>Diferença líquida mensal</span>
              <b>{brl(value.movementDifference)}</b>
              <small>{`Extrato ${brl(value.bankNet)} · Contábil ${brl(value.accountingNet)}`}</small>
            </div>
          </>
        )}
        {!value.reconciled && result.metadata.closingBalance != null && (
          <div>
            <span>Saldo final do extrato</span>
            <b>{brl(result.metadata.closingBalance)}</b>
            <small>Calculado: {brl(value.calculatedClosingBalance ?? 0)}</small>
          </div>
        )}
      </div>
      <button
        type="button"
        className="reconciliation-detail-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {expanded ? "Ocultar ficha de conciliação" : "Ver ficha de conciliação"}
      </button>
      {expanded && (
        <ReconciliationFormView
          result={result}
          companyName={companyName}
          reconciledBy={reconciledBy}
        />
      )}
    </article>
  );
}

function ReconciliationFormView({
  result,
  companyName,
  reconciledBy,
}: {
  result: AccountResult;
  companyName: string;
  reconciledBy: string;
}) {
  const bankOnly = result.rows.filter((row) => row.status === "Somente no banco");
  const accountingOnly = result.rows.filter(
    (row) => row.status === "Somente na contabilidade",
  );
  const sections: ReconciliationExceptionSection[] = [
    {
      key: "A",
      title: "Entradas no extrato sem lançamento correspondente na contabilidade",
      rows: bankOnly.filter((row) => (row.bankValue ?? 0) > 0),
    },
    {
      key: "B",
      title: "Saídas no extrato sem lançamento correspondente na contabilidade",
      rows: bankOnly.filter((row) => (row.bankValue ?? 0) < 0),
    },
    {
      key: "C",
      title: "Débitos lançados na contabilidade não identificados no extrato",
      rows: accountingOnly.filter((row) => (row.accountingValue ?? 0) > 0),
    },
    {
      key: "D",
      title: "Créditos lançados na contabilidade não identificados no extrato",
      rows: accountingOnly.filter((row) => (row.accountingValue ?? 0) < 0),
    },
  ];
  const visibleSections = result.validation.reconciled
    ? []
    : sections.filter((section) => section.rows.length > 0);
  const dailyDifferences = result.validation.reconciled
    ? []
    : selectMonthlyDifferenceDays(
        result.validation.dailyDifferences ?? [],
        result.validation.movementDifference,
      );
  const diagnostics = result.diagnostics ?? [];
  return (
    <section className="reconciliation-form">
      <header>
        <span>VISÃO DAS EXCEÇÕES</span>
        <h2>Ficha de Conciliação Bancária</h2>
        <b className={result.validation.reconciled ? "form-ok" : "form-review"}>
          {result.validation.reconciled ? "SEM PENDÊNCIAS" : "VERIFICAR"}
        </b>
      </header>
      <div className="form-identification">
        <div>
          <span>Empresa</span>
          <b>{companyName}</b>
        </div>
        <div>
          <span>Competência</span>
          <b>{result.competence.split("-").reverse().join("/")}</b>
        </div>
        <div>
          <span>Conciliado por</span>
          <b>{reconciledBy}</b>
        </div>
        <div>
          <span>Nº da conta contábil</span>
          <b>{result.account.code}</b>
        </div>
        <div className="wide">
          <span>Nome da conta contábil</span>
          <b>{result.account.name}</b>
        </div>
      </div>
      {result.validation.reconciled ? (
        <div className="form-summary reconciled-form-summary">
          <article>
            <span>Movimento líquido no extrato</span>
            <b>{brl(result.validation.bankNet)}</b>
          </article>
          <article>
            <span>Movimento líquido contábil</span>
            <b>{brl(result.validation.accountingNet)}</b>
          </article>
        </div>
      ) : (
        <>
          <div className="form-summary">
            <article>
              <span>Dias que explicam a diferença</span>
              <b>{dailyDifferences.length}</b>
            </article>
            <article>
              <span>Movimento líquido no extrato</span>
              <b>{brl(result.validation.bankNet)}</b>
            </article>
            <article>
              <span>Movimento líquido contábil</span>
              <b>{brl(result.validation.accountingNet)}</b>
            </article>
            <article>
              <span>Diferença líquida</span>
              <b>{brl(result.validation.movementDifference)}</b>
            </article>
            <article>
              <span>Alertas da Planilha 18</span>
              <b>{diagnostics.length}</b>
            </article>
          </div>
          <p className="form-explanation">
            A conferência soma primeiro todos os movimentos de cada dia e
            compara o resultado líquido do extrato com o contábil. Os dias que
            ainda não fecham são conferidos pelo total líquido do mês.
            Diferenças diárias que se compensam dentro da competência são
            desconsideradas. Quando o mês não fecha, a análise abaixo localiza
            somente os dias que permanecem com diferença líquida.
          </p>
          <div className="form-sections">
            {dailyDifferences.length > 0 && (
              <article className="daily-comparison">
                <div className="form-section-title">
                  <b>Localização diária da diferença mensal</b>
                  <strong>{dailyDifferences.length} dia(s) para revisar</strong>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Movimento líquido no extrato</th>
                        <th>Movimento líquido contábil</th>
                        <th>Diferença líquida</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyDifferences.map((row) => (
                        <tr key={row.date}>
                          <td>{new Date(`${row.date}T00:00:00.000Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td>
                          <td>{brl(row.bankCredits - row.bankDebits)}</td>
                          <td>{brl(row.accountingDebits - row.accountingCredits)}</td>
                          <td><b>{brl(row.netDifference)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            )}
            {diagnostics.length > 0 && (
              <article className="totvs-diagnostics">
                <div className="form-section-title">
                  <b>Alertas internos informados pela Planilha 18</b>
                  <strong>{diagnostics.length} alerta(s)</strong>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Caixa</th>
                        <th>Diferença de débito</th>
                        <th>Diferença de crédito</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnostics.map((diagnostic, index) => (
                        <tr key={`${diagnostic.date}-${diagnostic.cashCode}-${index}`}>
                          <td>{new Date(diagnostic.date).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td>
                          <td>{diagnostic.cashCode || "—"}</td>
                          <td><b>{brl(diagnostic.debitDifference)}</b></td>
                          <td><b>{brl(diagnostic.creditDifference)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            )}
            {visibleSections.length === 0 && dailyDifferences.length === 0 && (
              <article>
                <div className="form-section-title">
                  <b>Nenhum movimento divergente foi encontrado nas duas bases</b>
                  <strong>{brl(result.validation.movementDifference)}</strong>
                </div>
                <p>Revise os totais mensais e a identificação da conta bancária.</p>
              </article>
            )}
            {visibleSections.map((section) => (
              <ReconciliationExceptionTable key={section.key} section={section} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ReconciliationExceptionTable({
  section,
}: {
  section: ReconciliationExceptionSection;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(
    1,
    Math.ceil(section.rows.length / EXCEPTION_PAGE_SIZE),
  );
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * EXCEPTION_PAGE_SIZE;
  const visibleRows = section.rows.slice(start, start + EXCEPTION_PAGE_SIZE);
  const volume = section.rows.reduce(
    (sum, row) => sum + Math.abs(row.bankValue ?? row.accountingValue ?? 0),
    0,
  );

  return (
    <article>
      <div className="form-section-title">
        <b>
          {section.key}) {section.title}
        </b>
        <strong>
          {section.rows.length} item(ns) · volume bruto {brl(volume)}
        </strong>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Data na outra base</th>
              <th>Documento/Histórico</th>
              <th>Valor</th>
              <th>Referência</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={`${row.bankId ?? row.accountingId ?? "linha"}-${start + index}`}>
                <td>
                  {(row.bankDate ?? row.accountingDate)?.toLocaleDateString(
                    "pt-BR",
                    { timeZone: "UTC" },
                  )}
                </td>
                <td>
                  {row.bankDate && row.accountingDate
                    ? row.accountingDate.toLocaleDateString("pt-BR", {
                        timeZone: "UTC",
                      })
                    : "—"}
                </td>
                <td>{row.description || row.nature || "Lançamento contábil"}</td>
                <td>
                  {brl(Math.abs(row.bankValue ?? row.accountingValue ?? 0))}
                </td>
                <td>
                  {row.status === "Somente no banco"
                    ? "Sem lançamento na contabilidade"
                    : row.status === "Somente na contabilidade"
                      ? "Sem movimento no extrato"
                      : row.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="exception-pagination">
          <span>
            Exibindo {start + 1}–{Math.min(start + EXCEPTION_PAGE_SIZE, section.rows.length)} de {section.rows.length}. O relatório consolidado mantém todos os itens.
          </span>
          <div>
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Anterior
            </button>
            <b>
              {safePage + 1}/{pageCount}
            </b>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() =>
                setPage((current) => Math.min(pageCount - 1, current + 1))
              }
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
