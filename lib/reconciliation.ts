import * as XLSX from "xlsx";

export type BankRow = { id: string; date: Date; description: string; value: number };
export type AccountingRow = { id: string; date: Date; value: number; nature: string; account: string; accountName: string };
export type MatchRow = {
  status: "Conciliado" | "Possível conciliação" | "Somente no banco" | "Somente na contabilidade";
  bankId?: string; bankDate?: Date; description?: string; bankValue?: number;
  accountingId?: string; accountingDate?: Date; nature?: string; accountingValue?: number;
  days?: number; difference?: number;
};

const normalize = (value: unknown) => String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const primitive = (value: unknown): unknown => {
  if (value && typeof value === "object" && "result" in value) return (value as { result: unknown }).result;
  if (value && typeof value === "object" && "text" in value) return (value as { text: unknown }).text;
  return value;
};
const asNumber = (raw: unknown) => {
  const value = primitive(raw);
  if (typeof value === "number") return value;
  const text = String(value ?? "").replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
};
const asDate = (raw: unknown) => {
  const value = primitive(raw);
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : new Date(NaN);
  }
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

export function parseBank(buffer: ArrayBuffer) {
  for (const { rows } of rowsFromWorkbook(buffer)) {
    const header = headerIndex(rows, ["DATA", "LANCAMENTO", "VALOR"]);
    if (header < 0) continue;
    const names = rows[header].map(normalize);
    const date = names.findIndex((n) => n === "DATA");
    const description = names.findIndex((n) => ["LANCAMENTO", "HISTORICO", "DESCRICAO"].some((term) => n.includes(term)));
    const value = names.findIndex((n) => n.includes("VALOR") && !n.includes("SALDO"));
    if ([date, description, value].some((index) => index < 0)) continue;
    const output = rows.slice(header + 1).flatMap((row, index) => {
      const parsedDate = asDate(row[date]);
      const amount = asNumber(row[value]);
      const text = String(row[description] ?? "").trim();
      const ignored = ["SALDO ANTERIOR", "SALDO TOTAL", "SALDO DISPONIVEL", "SALDO DO DIA"].some((term) => normalize(text).includes(term));
      return Number.isNaN(parsedDate.getTime()) || Math.abs(amount) <= 0.004 || ignored ? [] : [{ id: `B${index + 1}`, date: parsedDate, description: text, value: Math.round(amount * 100) / 100 }];
    });
    if (output.length) return output;
  }
  throw new Error("Não consegui identificar Data, Lançamento/Histórico e Valor no extrato.");
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
  const data = rows.map((row) => ({ Status: row.status, "Data banco": row.bankDate ? dayKey(row.bankDate) : "", Histórico: row.description ?? "", "Valor banco": row.bankValue ?? "", "Data contábil": row.accountingDate ? dayKey(row.accountingDate) : "", Natureza: row.nature ?? "", "Valor contábil": row.accountingValue ?? "", "Diferença de dias": row.days ?? "", "Diferença de valor": row.difference ?? "" }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), "Conciliacao");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.filter((row) => row.Status !== "Conciliado")), "Todas_as_diferencas");
  XLSX.writeFile(workbook, `${name}.xlsx`);
}
