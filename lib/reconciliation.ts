import * as XLSX from "xlsx";

export type BankRow = { id: string; date: Date; description: string; value: number };
export type BankMetadata = { agency: string; account: string; period: string; name: string; openingBalance: number | null; closingBalance: number | null };
export type ParsedBank = { rows: BankRow[]; metadata: BankMetadata };
export type AccountingRow = { id: string; date: Date; value: number; nature: string; account: string; accountName: string };
export type MatchRow = {
  status: "Conciliado" | "Possível conciliação" | "Somente no banco" | "Somente na contabilidade";
  bankId?: string; bankDate?: Date; description?: string; bankValue?: number;
  accountingId?: string; accountingDate?: Date; nature?: string; accountingValue?: number;
  days?: number; difference?: number;
  sourceAccount?: string; sourceBank?: string;
};
export type AccountingAccount = { code: string; name: string; rows: AccountingRow[] };
export type MonthlyValidation = { bankCredits: number; bankDebits: number; accountingDebits: number; accountingCredits: number; bankNet: number; accountingNet: number; movementDifference: number; calculatedClosingBalance: number | null; closingBalanceDifference: number | null; missingDays: { date: string; bank: number; accounting: number; difference: number }[]; reconciled: boolean };

const normalize = (value: unknown) => String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const primitive = (value: unknown): unknown => {
  if (value && typeof value === "object" && "result" in value) return (value as { result: unknown }).result;
  if (value && typeof value === "object" && "text" in value) return (value as { text: unknown }).text;
  return value;
};
const asNumber = (raw: unknown) => {
  const value = primitive(raw);
  if (typeof value === "number") return value;
  const original = String(value ?? "").trim();
  const debitSuffix = /D\*?$/i.test(original); const creditSuffix = /C\*?$/i.test(original);
  const parentheses = /^\(.*\)$/.test(original);
  const text = original.replace(/[CD*()]/gi, "").replace(/[^\d,.-]/g, "").replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const number = Number(text);
  if (!Number.isFinite(number)) return 0;
  return debitSuffix || parentheses ? -Math.abs(number) : creditSuffix ? Math.abs(number) : number;
};
const asDate = (raw: unknown) => {
  const value = primitive(raw);
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : new Date(NaN);
  }
  const compact = String(value ?? "").replace(/\D/g, "");
  if (/^\d{8}$/.test(compact) && Number(compact.slice(0, 4)) >= 1900) return new Date(Date.UTC(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8))));
  const parts = String(value ?? "").split(/[\/\-]/).map(Number);
  if (parts.length === 3 && parts[0] <= 31) return new Date(Date.UTC(parts[2], parts[1] - 1, parts[0]));
  return new Date(String(value ?? ""));
};
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.round(Math.abs(a.getTime() - b.getTime()) / 86400000);

function rowsFromWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  return workbook.SheetNames.map((sheet) => ({ sheet, rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, raw: true }) }));
}
function headerIndex(rows: unknown[][], terms: string[]) {
  let best = -1, score = 0;
  rows.slice(0, 40).forEach((row, index) => {
    const text = row.map(normalize).join(" | ");
    const current = terms.filter((term) => text.includes(term)).length;
    if (current > score) { best = index; score = current; }
  });
  return score >= 2 ? best : -1;
}

function bankMetadata(rows: unknown[][]): BankMetadata {
  const metadata: BankMetadata = { agency: "", account: "", period: "", name: "", openingBalance: null, closingBalance: null };
  const labels: Record<string, "agency" | "account" | "period" | "name"> = { AGENCIA: "agency", CONTA: "account", PERIODO: "period", NOME: "name" };
  rows.slice(0, 15).forEach((row) => row.forEach((cell, column) => {
    const key = labels[normalize(cell).replace(/:$/, "")];
    if (!key || metadata[key]) return;
    const next = row.slice(column + 1).find((value) => String(primitive(value) ?? "").trim());
    if (next != null) metadata[key] = String(primitive(next)).trim();
  }));
  const balanceColumn = rows.slice(0, 40).map((row) => row.map(normalize)).find((row) => row.some((cell) => cell.includes("SALDO")))?.findIndex((cell) => cell.includes("SALDO")) ?? -1;
  if (balanceColumn >= 0) rows.forEach((row) => {
    const description = normalize(row.slice(0, balanceColumn).join(" "));
    const rawBalance = primitive(row[balanceColumn]);
    if (rawBalance == null || String(rawBalance).trim() === "") return;
    const balance = asNumber(rawBalance);
    if (description.includes("SALDO ANTERIOR") && metadata.openingBalance == null) metadata.openingBalance = balance;
    if (description.includes("SALDO")) metadata.closingBalance = balance;
  });
  return metadata;
}

export function parseAccounting(buffer: ArrayBuffer) {
  const output: AccountingRow[] = [];
  for (const { rows } of rowsFromWorkbook(buffer)) {
    const header = headerIndex(rows, ["DESCRICAO", "CODCONTA", "DATA", "DEBITO", "CREDITO"]);
    if (header < 0) continue;
    const names = rows[header].map(normalize);
    const find = (test: (name: string) => boolean) => names.findIndex(test);
    const account = find((n) => n.includes("CODCONTA") || n.includes("CONTA CONTABIL"));
    const description = find((n) => n.includes("DESCRICAO"));
    const date = find((n) => n === "DATA" || n.includes("DATACOMPENSACAO") || n.includes("DATA COMPENSACAO"));
    const debit = find((n) => n === "DEBITO");
    const credit = find((n) => n === "CREDITO");
    if ([account, description, date, debit, credit].some((index) => index < 0)) continue;
    rows.slice(header + 1).forEach((row, index) => {
      const parsedDate = asDate(row[date]);
      if (Number.isNaN(parsedDate.getTime())) return;
      const debitValue = asNumber(row[debit]);
      const creditValue = asNumber(row[credit]);
      if (Math.abs(debitValue) > 0.004) output.push({ id: `C${index}-D`, date: parsedDate, value: Math.round(debitValue * 100) / 100, nature: "Débito", account: String(row[account] ?? "").trim(), accountName: String(row[description] ?? "").trim() });
      if (Math.abs(creditValue) > 0.004) output.push({ id: `C${index}-C`, date: parsedDate, value: Math.round(-creditValue * 100) / 100, nature: "Crédito", account: String(row[account] ?? "").trim(), accountName: String(row[description] ?? "").trim() });
    });
  }
  if (!output.length) throw new Error("Não encontrei conta, descrição, data, débito e crédito na planilha contábil.");
  return output;
}

export function parseBank(buffer: ArrayBuffer): ParsedBank {
  for (const { rows } of rowsFromWorkbook(buffer)) {
    const header = headerIndex(rows, ["DATA", "LANCAMENTO", "HISTORICO", "VALOR", "CREDITO", "DEBITO"]);
    if (header < 0) continue;
    const names = rows[header].map(normalize);
    const date = names.findIndex((n) => n === "DATA" || n.startsWith("DATA ") || n.includes("DATA_MOV"));
    const description = names.findIndex((n) => ["LANCAMENTO", "HISTORICO", "DESCRICAO"].some((term) => n.includes(term)));
    const value = names.findIndex((n) => n.includes("VALOR") && !n.includes("SALDO"));
    const credit = names.findIndex((n) => n.includes("CREDITO"));
    const debit = names.findIndex((n) => n.includes("DEBITO"));
    const nature = names.findIndex((n) => n.includes("DEB_CRED") || n === "NATUREZA");
    if (date < 0 || description < 0 || (value < 0 && credit < 0 && debit < 0)) continue;
    const output = rows.slice(header + 1).flatMap((row, index) => {
      const parsedDate = asDate(row[date]);
      let amount = value >= 0 ? asNumber(row[value]) : Math.abs(asNumber(row[credit])) - Math.abs(asNumber(row[debit]));
      if (nature >= 0 && normalize(row[nature]).startsWith("D")) amount = -Math.abs(amount);
      if (nature >= 0 && normalize(row[nature]).startsWith("C")) amount = Math.abs(amount);
      const text = String(row[description] ?? "").trim();
      const ignored = ["SALDO ANTERIOR", "SALDO TOTAL", "SALDO DISPONIVEL", "SALDO DO DIA", "SALDO INVEST FACIL", "ULTIMOS LANCAMENTOS", "TOTAL"].some((term) => normalize(text).includes(term));
      return Number.isNaN(parsedDate.getTime()) || Math.abs(amount) <= 0.004 || ignored ? [] : [{ id: `B${index + 1}`, date: parsedDate, description: text, value: Math.round(amount * 100) / 100 }];
    });
    if (output.length) return { rows: output, metadata: bankMetadata(rows) };
  }
  throw new Error("Não consegui identificar Data, Lançamento/Histórico e Valor no extrato.");
}

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
const compatibleDigits = (left: unknown, right: unknown) => {
  const a = digits(left), b = digits(right);
  return a.length >= 4 && b.length >= 4 && (a === b || a.endsWith(b) || b.endsWith(a));
};

export function detectAccountingAccount(
  accounting: AccountingRow[], metadata: BankMetadata, fileName: string,
  registered: { agencia?: string; conta_bancaria?: string; conta_contabil?: string }[] = [],
) {
  const groups = Array.from(new Map(accounting.map((row) => [row.account, { code: row.account, name: row.accountName }])).values());
  const registeredMatch = registered.find((item) => compatibleDigits(item.conta_bancaria, metadata.account) && (!metadata.agency || !item.agencia || compatibleDigits(item.agencia, metadata.agency)));
  if (registeredMatch?.conta_contabil) {
    const exact = groups.find((item) => digits(item.code) === digits(registeredMatch.conta_contabil));
    if (exact) return exact;
  }
  const hints = [metadata.account, ...Array.from(fileName.matchAll(/\d{4,}/g), (match) => match[0])];
  const matches = groups.filter((item) => hints.some((hint) => compatibleDigits(item.name, hint)));
  return matches.length === 1 ? matches[0] : null;
}

export function accountingBankAccounts(accounting: AccountingRow[]) {
  const groups = Array.from(new Map(accounting.map((row) => [row.account, { code: row.account, name: row.accountName, rows: [] as AccountingRow[] }])).values());
  accounting.forEach((row) => groups.find((item) => item.code === row.account)?.rows.push(row));
  const bankTerms = /BANCO|ITA[UÚ]|BRADESCO|SANTANDER|CAIXA|SICOOB|SICREDI|NUBANK|CONTA CORRENTE|CONTA BANC[AÁ]RIA|APLICA[CÇ][AÃ]O/iu;
  const bankGroups = groups.filter((item) => bankTerms.test(item.name));
  return (bankGroups.length ? bankGroups : groups).sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
}

export function validateMonthly(bank: BankRow[], accounting: AccountingRow[], metadata: BankMetadata, tolerance = 0.01): MonthlyValidation {
  const round = (value: number) => Math.round(value * 100) / 100;
  const bankCredits = round(bank.filter((row) => row.value > 0).reduce((sum, row) => sum + row.value, 0));
  const bankDebits = round(-bank.filter((row) => row.value < 0).reduce((sum, row) => sum + row.value, 0));
  const accountingDebits = round(accounting.filter((row) => row.value > 0).reduce((sum, row) => sum + row.value, 0));
  const accountingCredits = round(-accounting.filter((row) => row.value < 0).reduce((sum, row) => sum + row.value, 0));
  const bankNet = round(bankCredits - bankDebits), accountingNet = round(accountingDebits - accountingCredits);
  const movementDifference = round(bankNet - accountingNet);
  const calculatedClosingBalance = metadata.openingBalance == null ? null : round(metadata.openingBalance + bankNet);
  const closingBalanceDifference = calculatedClosingBalance == null || metadata.closingBalance == null ? null : round(calculatedClosingBalance - metadata.closingBalance);
  const dates = Array.from(new Set([...bank.map((row) => dayKey(row.date)), ...accounting.map((row) => dayKey(row.date))])).sort();
  const missingDays = dates.map((date) => {
    const bankValue = round(bank.filter((row) => dayKey(row.date) === date).reduce((sum, row) => sum + row.value, 0));
    const accountingValue = round(accounting.filter((row) => dayKey(row.date) === date).reduce((sum, row) => sum + row.value, 0));
    return { date, bank: bankValue, accounting: accountingValue, difference: round(bankValue - accountingValue) };
  }).filter((row) => Math.abs(row.difference) > tolerance);
  return { bankCredits, bankDebits, accountingDebits, accountingCredits, bankNet, accountingNet, movementDifference, calculatedClosingBalance, closingBalanceDifference, missingDays, reconciled: Math.abs(movementDifference) <= tolerance && (closingBalanceDifference == null || Math.abs(closingBalanceDifference) <= tolerance) };
}

export function reconcile(bank: BankRow[], accounting: AccountingRow[], toleranceDays = 3, toleranceValue = 0.01) {
  const usedBank = new Set<number>(), usedAccounting = new Set<number>();
  const matches: MatchRow[] = [];
  const match = (exactDate: boolean) => bank.forEach((b, bi) => {
    if (usedBank.has(bi)) return;
    const candidates = accounting.map((a, ai) => ({ a, ai, days: daysBetween(a.date, b.date) })).filter(({ a, ai, days }) => !usedAccounting.has(ai) && Math.abs(a.value - b.value) <= toleranceValue && (exactDate ? dayKey(a.date) === dayKey(b.date) : days <= toleranceDays)).sort((x, y) => x.days - y.days);
    if (!candidates.length) return;
    const { a, ai, days } = candidates[0]; usedBank.add(bi); usedAccounting.add(ai);
    matches.push({ status: exactDate ? "Conciliado" : "Possível conciliação", bankId: b.id, bankDate: b.date, description: b.description, bankValue: b.value, accountingId: a.id, accountingDate: a.date, nature: a.nature, accountingValue: a.value, days, difference: Math.round((b.value - a.value) * 100) / 100 });
  });
  match(true); match(false);
  bank.forEach((b, index) => { if (!usedBank.has(index)) matches.push({ status: "Somente no banco", bankId: b.id, bankDate: b.date, description: b.description, bankValue: b.value }); });
  accounting.forEach((a, index) => { if (!usedAccounting.has(index)) matches.push({ status: "Somente na contabilidade", accountingId: a.id, accountingDate: a.date, nature: a.nature, accountingValue: a.value }); });
  return matches;
}

export const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
export function exportReport(rows: MatchRow[], name = "conciliacao") {
  const data = rows.map((row) => ({ Banco: row.sourceBank ?? "", "Conta contábil": row.sourceAccount ?? "", Status: row.status, "Data banco": row.bankDate ? dayKey(row.bankDate) : "", Histórico: row.description ?? "", "Valor banco": row.bankValue ?? "", "Data contábil": row.accountingDate ? dayKey(row.accountingDate) : "", Natureza: row.nature ?? "", "Valor contábil": row.accountingValue ?? "", "Diferença de dias": row.days ?? "", "Diferença de valor": row.difference ?? "" }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), "Conciliacao");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.filter((row) => row.Status !== "Conciliado")), "Todas_as_diferencas");
  XLSX.writeFile(workbook, `${name}.xlsx`);
}
