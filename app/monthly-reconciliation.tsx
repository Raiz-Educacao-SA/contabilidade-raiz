"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, CheckCircle2, Download, FileSpreadsheet, Landmark, Trash2, Upload, XCircle } from "lucide-react";
import { AccountingAccount, AccountingRow, BankMetadata, BankRow, MatchRow, accountingBankAccounts, brl, detectAccountingAccount, exportReport, parseAccounting, parseBank, reconcile, validateMonthly } from "@/lib/reconciliation";

type RegisteredAccount = { agencia: string; conta_bancaria: string; conta_contabil: string };
type Statement = { fileName: string; account: AccountingAccount; bank: BankRow[]; metadata: BankMetadata };
type AccountResult = Statement & { rows: MatchRow[]; validation: ReturnType<typeof validateMonthly>; competence: string };

export default function MonthlyReconciliationPanel({ accounts, competence, companyId }: { accounts: RegisteredAccount[]; competence: string; companyId: string }) {
  const [accounting, setAccounting] = useState<AccountingRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<AccountingAccount[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [results, setResults] = useState<AccountResult[]>([]);
  const [notice, setNotice] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const historyKey = `conciliacao-financeira:${companyId}:${competence}`;
  const pending = bankAccounts.filter((account) => !statements.some((statement) => statement.account.code === account.code));
  const next = pending[0];
  const allRows = useMemo(() => results.flatMap((result) => result.rows), [results]);

  useEffect(() => {
    const stored = localStorage.getItem(historyKey);
    if (!stored) return setResults([]);
    try {
      const reviveRow = <T extends { date?: Date; bankDate?: Date; accountingDate?: Date }>(row: T) => ({ ...row, ...(row.date ? { date: new Date(row.date) } : {}), ...(row.bankDate ? { bankDate: new Date(row.bankDate) } : {}), ...(row.accountingDate ? { accountingDate: new Date(row.accountingDate) } : {}) });
      const parsed = JSON.parse(stored) as AccountResult[];
      setResults(parsed.map((result) => ({ ...result, bank: result.bank.map(reviveRow), account: { ...result.account, rows: result.account.rows.map(reviveRow) }, rows: result.rows.map(reviveRow) })));
    } catch { localStorage.removeItem(historyKey); setResults([]); }
  }, [historyKey]);

  function keepResults(completed: AccountResult[]) {
    setResults((current) => {
      const keys = new Set(completed.map((item) => item.account.code));
      const updated = [...current.filter((item) => !keys.has(item.account.code)), ...completed];
      localStorage.setItem(historyKey, JSON.stringify(updated));
      return updated;
    });
  }

  function clearHistory() {
    if (!window.confirm("Deseja limpar o histórico da última conciliação desta empresa e competência?")) return;
    localStorage.removeItem(historyKey); setResults([]); setNotice("Histórico da última conciliação removido.");
  }

  async function loadAccounting(file?: File) {
    if (!file) return;
    try {
      const rows = parseAccounting(await file.arrayBuffer());
      const discovered = accountingBankAccounts(rows);
      setAccounting(rows); setBankAccounts(discovered); setStatements([]); setFileKey((value) => value + 1);
      setNotice(`${discovered.length} conta(s) bancária(s) encontrada(s). Anexe agora os extratos solicitados, um por vez.`);
    } catch (error) { setNotice((error as Error).message); }
  }

  async function loadStatement(file?: File) {
    if (!file || !accounting.length) return;
    try {
      const parsed = parseBank(await file.arrayBuffer());
      const detected = detectAccountingAccount(accounting, parsed.metadata, file.name, accounts);
      if (!detected) throw new Error(`O extrato ${parsed.metadata.account || file.name} não corresponde de forma única a uma conta da planilha contábil.`);
      const account = bankAccounts.find((item) => item.code === detected.code);
      if (!account) throw new Error(`A conta ${detected.code} não está na fila de contas bancárias da planilha.`);
      if (statements.some((item) => item.account.code === account.code)) throw new Error(`O extrato da conta ${account.code} já foi anexado.`);
      const updated = [...statements, { fileName: file.name, account, bank: parsed.rows, metadata: parsed.metadata }];
      setStatements(updated); setFileKey((value) => value + 1);
      const remaining = bankAccounts.length - updated.length;
      setNotice(remaining ? `Extrato da conta ${account.code} carregado. Faltam ${remaining} extrato(s).` : "Todos os extratos foram carregados. Execute a conciliação mensal completa.");
    } catch (error) { setNotice((error as Error).message); setFileKey((value) => value + 1); }
  }

  function reconcileStatements(selected: Statement[]) {
    const completed = selected.map((statement) => {
      const rows = reconcile(statement.bank, statement.account.rows).map((row) => ({ ...row, sourceAccount: statement.account.code, sourceBank: statement.metadata.account || statement.fileName }));
      return { ...statement, rows, validation: validateMonthly(statement.bank, statement.account.rows, statement.metadata), competence };
    });
    keepResults(completed);
    return completed;
  }

  function runOne(statement: Statement) {
    const [completed] = reconcileStatements([statement]);
    setNotice(`Conta ${statement.account.code} conciliada individualmente: ${completed.validation.reconciled ? "sem pendência mensal" : "com valores para revisar"}.`);
  }

  function runAll() {
    if (!bankAccounts.length || pending.length) return setNotice(`Ainda faltam ${pending.length} extrato(s) para executar a conciliação completa.`);
    const completed = reconcileStatements(statements);
    const reconciled = completed.filter((item) => item.validation.reconciled).length;
    setNotice(`Conciliação mensal concluída: ${reconciled} de ${completed.length} conta(s) sem pendência de movimento mensal.`);
  }

  return <section className="panel monthly-flow">
    <div className="panel-title"><div><h2>Conciliação mensal por movimento</h2><p>Concilie cada conta assim que o extrato chegar ou execute todas juntas ao final.</p></div><div className="history-actions"><button className="secondary" disabled={!allRows.length} onClick={() => exportReport(allRows, `conciliacao_mensal_${competence}`)}><Download />Relatório consolidado</button><button className="clear-history" disabled={!results.length} onClick={clearHistory}><Trash2 />Limpar histórico</button></div></div>
    {notice && <div className="notice">{notice}</div>}
    <div className="accounting-upload"><FileSpreadsheet /><label>1. Carregar planilha contábil<input type="file" accept=".xlsx,.xlsm" onChange={(event) => loadAccounting(event.target.files?.[0])} /></label></div>
    {bankAccounts.length > 0 && <><div className="queue-head"><div><h3>2. Extratos solicitados</h3><p>Anexe um extrato por vez. Cada conta recebida pode ser conciliada imediatamente.</p></div><b>{statements.length}/{bankAccounts.length} recebidos</b></div><div className="account-queue">{bankAccounts.map((account, index) => { const statement = statements.find((item) => item.account.code === account.code); const isNext = next?.code === account.code; const reconciled = results.some((item) => item.account.code === account.code); return <article key={account.code} className={statement ? "received" : isNext ? "requested" : "waiting"}><span>{statement ? <CheckCircle2 /> : <Landmark />}</span><div><b>{account.code} — {account.name}</b><small>{statement ? `${reconciled ? "Conciliação salva" : "Extrato recebido"}: ${statement.fileName}` : isNext ? "Aguardando este extrato" : `Aguardando a conta anterior (${index + 1}ª da fila)`}</small></div>{statement && <button className="reconcile-one" onClick={() => runOne(statement)}><ArrowLeftRight />{reconciled ? "Conciliar novamente" : "Conciliar esta conta"}</button>}</article>; })}</div></>}
    {next && <div className="statement-request"><Upload /><div><span>PRÓXIMO EXTRATO</span><h3>{next.code} — {next.name}</h3><p>Selecione o arquivo desta conta. Se o arquivo pertencer a outra conta da lista, ele também será reconhecido.</p><input key={fileKey} type="file" accept=".xlsx,.xlsm" onChange={(event) => loadStatement(event.target.files?.[0])} /></div></div>}
    {bankAccounts.length > 0 && <button className="primary run-all" disabled={pending.length > 0} onClick={runAll}><ArrowLeftRight />Conciliar todas as contas do mês</button>}
    {results.length > 0 && <div className="saved-history"><div><span>HISTÓRICO MANTIDO</span><h3>Última conciliação — {competence.split("-").reverse().join("/")}</h3><p>Este resultado permanecerá salvo até você clicar em “Limpar histórico”.</p></div></div>}{results.length > 0 && <div className="monthly-results">{results.map((result) => <MonthlyAccountResult key={result.account.code} result={result} />)}</div>}
  </section>;
}

function MonthlyAccountResult({ result }: { result: AccountResult }) {
  const value = result.validation;
  return <article className={`monthly-account ${value.reconciled ? "ok" : "review"}`}><header><div>{value.reconciled ? <CheckCircle2 /> : <XCircle />}<div><span>{value.reconciled ? "MOVIMENTO MENSAL CONCILIADO" : "REVISAR MOVIMENTO MENSAL"}</span><h3>{result.account.code} — {result.account.name}</h3><p>Extrato {result.metadata.account || result.fileName}</p></div></div></header><div className="monthly-metrics"><div><span>Entradas no extrato</span><b>{brl(value.bankCredits)}</b><small>Débitos contábeis: {brl(value.accountingDebits)}</small></div><div><span>Saídas no extrato</span><b>{brl(value.bankDebits)}</b><small>Créditos contábeis: {brl(value.accountingCredits)}</small></div><div><span>Movimento líquido</span><b>{brl(value.bankNet)}</b><small>Contábil: {brl(value.accountingNet)}</small></div><div><span>Diferença mensal</span><b>{brl(value.movementDifference)}</b><small>{value.reconciled ? "Sem pendência financeira" : "Existe valor pendente"}</small></div>{result.metadata.closingBalance != null && <div><span>Saldo final do extrato</span><b>{brl(result.metadata.closingBalance)}</b><small>Calculado: {brl(value.calculatedClosingBalance ?? 0)}</small></div>}</div><div className="daily-check"><h4>Validação dos movimentos por dia</h4>{value.missingDays.length === 0 ? <p className="daily-ok"><CheckCircle2 />Nenhum dia com lançamento faltante na contabilidade.</p> : <div className="table-wrap"><table><thead><tr><th>Dia</th><th>Movimento no extrato</th><th>Movimento contábil</th><th>Diferença</th></tr></thead><tbody>{value.missingDays.map((day) => <tr key={day.date}><td>{new Date(`${day.date}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td><td>{brl(day.bank)}</td><td>{brl(day.accounting)}</td><td>{brl(day.difference)}</td></tr>)}</tbody></table></div>}</div></article>;
}
