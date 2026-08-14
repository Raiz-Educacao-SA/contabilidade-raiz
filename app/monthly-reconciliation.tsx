"use client";

import { useEffect, useMemo, useState } from "react";
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
  validateMonthly,
} from "@/lib/reconciliation";
import type { DataEngineStatement } from "@/lib/data-engine-statements";

type RegisteredAccount = {
  agencia: string;
  conta_bancaria: string;
  conta_contabil: string;
};
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
};
export default function MonthlyReconciliationPanel({
  accounts,
  competence,
  companyId,
  companyCode,
  companyName,
  reconciledBy,
  accessToken,
}: {
  accounts: RegisteredAccount[];
  competence: string;
  companyId: string;
  companyCode: string;
  companyName: string;
  reconciledBy: string;
  accessToken: string;
}) {
  const [accounting, setAccounting] = useState<AccountingRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<AccountingAccount[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [results, setResults] = useState<AccountResult[]>([]);
  const [notice, setNotice] = useState("");
  const [dataEngineSources, setDataEngineSources] = useState<
    DataEngineStatement[]
  >([]);
  const [sourceBindings, setSourceBindings] = useState<Record<string, string>>(
    {},
  );
  const [dataEngineBusy, setDataEngineBusy] = useState(false);
  const [accountingBusy, setAccountingBusy] = useState(false);
  const [accountingMessage, setAccountingMessage] = useState(
    "Aguardando atualização no TOTVS",
  );
  const historyKey = `conciliacao-financeira:${companyId}:${competence}`;
  const pending = bankAccounts.filter(
    (account) =>
      !statements.some((statement) => statement.account.code === account.code),
  );
  const statementsReady = statements.length > 0;
  const accountingReady = accounting.length > 0;
  const reconciliationReady = statementsReady && accountingReady;
  const allRows = useMemo(
    () => results.flatMap((result) => result.rows),
    [results],
  );
  const divergentResults = useMemo(
    () => results.filter((result) => !result.validation.reconciled),
    [results],
  );
  const reconciledCount = results.length - divergentResults.length;

  useEffect(() => {
    const stored = localStorage.getItem(historyKey);
    if (!stored) return setResults([]);
    try {
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
      const parsed = JSON.parse(stored) as AccountResult[];
      setResults(
        parsed.map((result) => ({
          ...result,
          bank: result.bank.map(reviveRow),
          account: {
            ...result.account,
            rows: result.account.rows.map(reviveRow),
          },
          rows: result.rows.map(reviveRow),
        })),
      );
    } catch {
      localStorage.removeItem(historyKey);
      setResults([]);
    }
  }, [historyKey]);

  function keepResults(completed: AccountResult[]) {
    setResults((current) => {
      const keys = new Set(completed.map((item) => item.account.code));
      const updated = [
        ...current.filter((item) => !keys.has(item.account.code)),
        ...completed,
      ];
      localStorage.setItem(historyKey, JSON.stringify(updated));
      return updated;
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
    setResults([]);
    setNotice("Histórico da última conciliação removido.");
  }

  async function refreshAccounting() {
    setAccountingBusy(true);
    try {
      const response = await fetch(
        `/api/totvs/accounting?company=${encodeURIComponent(companyCode)}&competence=${encodeURIComponent(competence)}`,
        {
          cache: "no-store",
          headers: { authorization: `Bearer ${accessToken}` },
        },
      );
      const data = (await response.json()) as {
        rows?: AccountingRow[];
        error?: string;
        warning?: string;
      };
      if (!response.ok || data.error)
        throw new Error(
          data.error || "Não foi possível consultar a Planilha 18 no TOTVS.",
        );
      const rows = (data.rows || []).map((row) => ({
        ...row,
        date: new Date(row.date),
      }));
      const discovered = accountingBankAccounts(rows);
      setAccounting(rows);
      setBankAccounts(discovered);
      applySourceBindings(dataEngineSources, discovered, sourceBindings);
      setAccountingMessage(
        `${discovered.length} conta(s) carregada(s) da Planilha 18`,
      );
      if (!dataEngineSources.length)
        setNotice(
          data.warning ||
            `Base contábil atualizada: ${discovered.length} conta(s) bancária(s) encontrada(s) no TOTVS.`,
        );
    } catch (error) {
      const message = (error as Error).message;
      setAccountingMessage("Aguardando permissão de leitura no TOTVS");
      setNotice(message);
    } finally {
      setAccountingBusy(false);
    }
  }

  async function scanDataEngine() {
    setDataEngineBusy(true);
    try {
      const response = await fetch(
        `/api/data-engine/statements?company=${encodeURIComponent(companyCode)}&competence=${encodeURIComponent(competence)}`,
        {
          cache: "no-store",
          headers: { authorization: `Bearer ${accessToken}` },
        },
      );
      const data = (await response.json()) as {
        statements?: DataEngineStatement[];
        error?: string;
        records?: number;
      };
      if (!response.ok || data.error)
        throw new Error(
          data.error || "Não foi possível consultar o Data Engine.",
        );
      const sources = data.statements ?? [];
      setDataEngineSources(sources);
      applySourceBindings(sources, bankAccounts, sourceBindings);
      setNotice(
        `${data.records ?? 0} movimento(s) carregado(s) do Data Engine em ${sources.length} conta(s) bancária(s).`,
      );
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setDataEngineBusy(false);
    }
  }

  function applySourceBindings(
    sources: DataEngineStatement[],
    discoveredAccounts: AccountingAccount[],
    bindings: Record<string, string>,
  ) {
    const effectiveBindings = { ...bindings };
    if (sources.length === 1 && discoveredAccounts.length === 1) {
      effectiveBindings[sources[0].sourceAccountId] = discoveredAccounts[0].code;
      setSourceBindings(effectiveBindings);
    }
    const identified = new Map<string, Statement>();
    for (const source of sources) {
      const account = discoveredAccounts.find(
        (candidate) =>
          candidate.code === effectiveBindings[source.sourceAccountId],
      );
      if (!account) continue;
      const current = identified.get(account.code);
      const bank = source.rows.map((row) => ({
        ...row,
        date: new Date(`${row.date}T00:00:00.000Z`),
      }));
      const sourceName = `Data Engine · Banco ${source.bankId} · ${source.sourceAccountId.slice(0, 12)}`;
      if (!current) {
        identified.set(account.code, {
          account,
          bank,
          fileName: sourceName,
          metadata: source.metadata,
        });
      } else {
        current.bank.push(...bank);
        current.bank.sort((left, right) => left.date.getTime() - right.date.getTime());
        current.fileName = `${current.fileName} + ${sourceName}`;
      }
    }
    setStatements(Array.from(identified.values()));
  }

  function bindSource(sourceAccountId: string, accountCode: string) {
    const next = { ...sourceBindings };
    if (accountCode) next[sourceAccountId] = accountCode;
    else delete next[sourceAccountId];
    setSourceBindings(next);
    applySourceBindings(dataEngineSources, bankAccounts, next);
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

  return (
    <section className="panel monthly-flow">
      <div className="panel-title">
        <div>
          <h2>Conciliação mensal por movimento</h2>
          <p>
            Concilie cada conta assim que o extrato chegar ou execute todas
            juntas ao final.
          </p>
        </div>
        <div className="history-actions">
          <button
            className="secondary"
            disabled={!allRows.length}
            onClick={() =>
              exportReport(allRows, `conciliacao_mensal_${competence}`)
            }
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
        <div className="source-control-title">
          <span>ATUALIZAÇÃO DAS FONTES</span>
          <h3>Preparar a conciliação</h3>
          <p>
            Atualize os extratos e a base contábil antes de executar a
            conferência do mês.
          </p>
        </div>
        <div className="source-steps">
          <article className={statementsReady ? "ready" : "waiting"}>
            <div className="source-step-number">1</div>
            <Landmark />
            <div>
              <b>Extratos bancários</b>
              <span>
                {dataEngineBusy
                  ? "Consultando o Data Engine..."
                  : dataEngineSources.length
                    ? `${dataEngineSources.length} conta(s) encontrada(s) no Data Engine`
                    : "Aguardando atualização do Data Engine"}
              </span>
            </div>
            <button
              className={`secondary ${statementsReady ? "source-loaded-extracts" : ""}`}
              disabled={dataEngineBusy}
              onClick={scanDataEngine}
            >
              <RefreshCw className={dataEngineBusy ? "spinning" : ""} />
              {dataEngineBusy ? "Atualizando..." : "Atualizar extratos"}
            </button>
          </article>
          <article className={accountingReady ? "ready" : "waiting"}>
            <div className="source-step-number">2</div>
            <Database />
            <div>
              <b>Base contábil</b>
              <span>
                {accountingBusy
                  ? "Consultando a Planilha 18..."
                  : accountingMessage}
              </span>
            </div>
            <button
              className={`secondary ${accountingReady ? "source-loaded" : ""}`}
              disabled={accountingBusy}
              onClick={refreshAccounting}
            >
              <RefreshCw className={accountingBusy ? "spinning" : ""} />
              {accountingBusy ? "Atualizando Base TOTVS..." : "Atualizar Base TOTVS"}
            </button>
          </article>
          <article
            className={
              results.length ? "ready reconcile-step" : "waiting reconcile-step"
            }
          >
            <div className="source-step-number">3</div>
            <ArrowLeftRight />
            <div>
              <b>Conciliação automática</b>
              <span>
                {results.length
                  ? `${reconciledCount} conciliada(s) e ${divergentResults.length} com divergência`
                  : "Compara extrato × contábil por conta e por dia"}
              </span>
            </div>
            <button
              className="primary"
              disabled={!reconciliationReady}
              onClick={runAll}
            >
              <ArrowLeftRight />
              Conciliar agora
            </button>
          </article>
        </div>
      </div>
      {dataEngineSources.length > 0 && (
        <div className="drive-files">
          {dataEngineSources.map((source) => (
            <article key={source.sourceAccountId}>
              <Landmark />
              <div>
                <b>
                  Banco {source.bankId} — conta protegida {source.metadata.account}
                </b>
                <span>{source.rows.length} movimento(s) nesta competência</span>
              </div>
              <label>
                Conta contábil
                <select
                  aria-label={`Conta contábil para ${source.metadata.account}`}
                  value={sourceBindings[source.sourceAccountId] ?? ""}
                  onChange={(event) =>
                    bindSource(source.sourceAccountId, event.target.value)
                  }
                >
                  <option value="">Selecione</option>
                  {bankAccounts.map((account) => (
                    <option key={account.code} value={account.code}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </select>
              </label>
            </article>
          ))}
        </div>
      )}
      {bankAccounts.length > 0 && (
        <>
          <div className="queue-head">
            <div>
              <h3>2. Extratos por conta</h3>
              <p>
                Vincule cada conta protegida do Data Engine à conta contábil
                correspondente desta competência.
              </p>
            </div>
            <b>
              {statements.length}/{bankAccounts.length} identificados
            </b>
          </div>
          <div className="account-queue">
            {bankAccounts.map((account) => {
              const statement = statements.find(
                (item) => item.account.code === account.code,
              );
              const reconciled = results.some(
                (item) => item.account.code === account.code,
              );
              return (
                <article
                  key={account.code}
                  className={statement ? "received" : "requested"}
                >
                  <span className="account-state">
                    {statement ? <CheckCircle2 /> : <Landmark />}
                  </span>
                  <div>
                    <b>
                      {account.code} — {account.name}
                    </b>
                    <small>
                      {statement
                        ? `${reconciled ? "Conciliação salva" : "Extrato identificado"}: ${statement.fileName}`
                        : "Aguardando vínculo com uma conta do Data Engine"}
                    </small>
                  </div>
                  {statement && (
                    <button
                      className="reconcile-one"
                      onClick={() => runOne(statement)}
                    >
                      <ArrowLeftRight />
                      {reconciled
                        ? "Conciliar novamente"
                        : "Conciliar esta conta"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
      {results.length > 0 && (
        <div className="saved-history">
          <div>
            <span>HISTÓRICO MANTIDO</span>
            <h3>
              Última conciliação — {competence.split("-").reverse().join("/")}
            </h3>
            <p>
              {reconciledCount} conta(s) conciliada(s). Somente as{" "}
              {divergentResults.length} conta(s) com divergência aparecem abaixo
              para tratamento.
            </p>
          </div>
        </div>
      )}
      {results.length > 0 && divergentResults.length === 0 && (
        <div className="all-reconciled">
          <CheckCircle2 />
          <div>
            <b>Todas as contas estão conciliadas</b>
            <span>
              Nenhuma ficha de tratamento foi aberta para esta competência.
            </span>
          </div>
        </div>
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
}: {
  result: AccountResult;
  companyName: string;
  reconciledBy: string;
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
      <div className="monthly-metrics">
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
          <span>Movimento líquido</span>
          <b>{brl(value.bankNet)}</b>
          <small>Contábil: {brl(value.accountingNet)}</small>
        </div>
        <div>
          <span>Diferença mensal</span>
          <b>{brl(value.movementDifference)}</b>
          <small>
            {value.reconciled
              ? "Sem pendência financeira"
              : "Existe valor pendente"}
          </small>
        </div>
        {result.metadata.closingBalance != null && (
          <div>
            <span>Saldo final do extrato</span>
            <b>{brl(result.metadata.closingBalance)}</b>
            <small>Calculado: {brl(value.calculatedClosingBalance ?? 0)}</small>
          </div>
        )}
      </div>
      <div className="daily-check">
        <h4>Validação dos movimentos por dia</h4>
        {value.missingDays.length === 0 ? (
          <p className="daily-ok">
            <CheckCircle2 />
            Nenhum dia com lançamento faltante na contabilidade.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Movimento no extrato</th>
                  <th>Movimento contábil</th>
                  <th>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {value.missingDays.map((day) => (
                  <tr key={day.date}>
                    <td>
                      {new Date(`${day.date}T00:00:00Z`).toLocaleDateString(
                        "pt-BR",
                        { timeZone: "UTC" },
                      )}
                    </td>
                    <td>{brl(day.bank)}</td>
                    <td>{brl(day.accounting)}</td>
                    <td>{brl(day.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ReconciliationFormView
        result={result}
        companyName={companyName}
        reconciledBy={reconciledBy}
      />
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
  const accountingOnly = result.rows.filter(
    (row) => row.status === "Somente na contabilidade",
  );
  const bankOnly = result.rows.filter(
    (row) => row.status === "Somente no banco",
  );
  const dateDifferences = result.rows.filter(
    (row) => row.status === "Possível conciliação",
  );
  const sections = [
    { key: "A", title: "Cheques pendentes", rows: [] as MatchRow[] },
    {
      key: "B",
      title: "Débitos lançados na contabilidade não identificados no banco",
      rows: accountingOnly.filter((row) => (row.accountingValue ?? 0) > 0),
    },
    {
      key: "C",
      title: "Créditos lançados na contabilidade não identificados no banco",
      rows: accountingOnly.filter((row) => (row.accountingValue ?? 0) < 0),
    },
    {
      key: "D",
      title: "Débitos identificados no banco não lançados na contabilidade",
      rows: bankOnly.filter((row) => (row.bankValue ?? 0) < 0),
    },
    {
      key: "E",
      title: "Créditos identificados no banco não lançados na contabilidade",
      rows: bankOnly.filter((row) => (row.bankValue ?? 0) > 0),
    },
    {
      key: "F",
      title: "Lançamentos conciliados com diferença de data",
      rows: dateDifferences,
    },
  ];
  const visibleSections = result.validation.reconciled
    ? []
    : sections.filter((section) => section.rows.length > 0);
  const total = (rows: MatchRow[]) =>
    rows.reduce(
      (sum, row) => sum + Math.abs(row.bankValue ?? row.accountingValue ?? 0),
      0,
    );
  const pendingTotal = sections.reduce(
    (sum, section) => sum + total(section.rows),
    0,
  );
  const statementBalance = result.metadata.closingBalance;
  const accountingBalance =
    statementBalance == null
      ? null
      : statementBalance - result.validation.movementDifference;
  return (
    <section className="reconciliation-form">
      <header>
        <span>VISÃO DAS EXCEÇÕES</span>
        <h2>Ficha de Conciliação Bancária</h2>
        <b className={visibleSections.length === 0 ? "form-ok" : "form-review"}>
          {visibleSections.length === 0 ? "SEM PENDÊNCIAS" : "VERIFICAR"}
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
      {visibleSections.length === 0 ? (
        <div className="clean-balance">
          <span>Saldo conforme extrato bancário</span>
          <b>
            {statementBalance == null ? "Não informado" : brl(statementBalance)}
          </b>
        </div>
      ) : (
        <>
          <div className="form-summary">
            <article>
              <span>Saldo conforme extrato bancário</span>
              <b>
                {statementBalance == null
                  ? "Não informado"
                  : brl(statementBalance)}
              </b>
            </article>
            <article>
              <span>Total das pendências detalhadas</span>
              <b>{brl(pendingTotal)}</b>
            </article>
            <article>
              <span>Saldo contábil apurado</span>
              <b>
                {accountingBalance == null
                  ? "Movimento mensal"
                  : brl(accountingBalance)}
              </b>
            </article>
            <article>
              <span>Diferença da conciliação</span>
              <b>{brl(result.validation.movementDifference)}</b>
            </article>
          </div>
          <div className="form-sections">
            {visibleSections.map((section) => (
              <article key={section.key}>
                <div className="form-section-title">
                  <b>
                    {section.key}) {section.title}
                  </b>
                  <strong>
                    {section.key === "F"
                      ? `${section.rows.length} lançamento(s)`
                      : brl(total(section.rows))}
                  </strong>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Data correspondente</th>
                        <th>Documento/Histórico</th>
                        <th>Valor</th>
                        <th>Referência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, index) => (
                        <tr key={index}>
                          <td>
                            {(
                              row.bankDate ?? row.accountingDate
                            )?.toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                          </td>
                          <td>
                            {row.bankDate && row.accountingDate
                              ? row.accountingDate.toLocaleDateString("pt-BR", {
                                  timeZone: "UTC",
                                })
                              : "—"}
                          </td>
                          <td>
                            {row.description ||
                              row.nature ||
                              "Lançamento contábil"}
                          </td>
                          <td>
                            {brl(
                              Math.abs(
                                row.bankValue ?? row.accountingValue ?? 0,
                              ),
                            )}
                          </td>
                          <td>{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
