import * as XLSX from "xlsx-js-style";
import { applyRaizWorkbookStyle } from "./export-workbook-style.ts";

export type PayrollLotRow = {
  account: string;
  description: string;
  event: string;
  complement: string;
  debit: number;
  credit: number;
};

export type PayrollCheck = {
  group: "Líquidos" | "INSS" | "FGTS" | "IRRF" | "Provisões";
  item: string;
  account: string;
  event: string;
  lot: number;
  document: number | null;
  difference: number | null;
  status: "OK" | "PENDENTE" | "INFORMATIVO";
  source: string;
  note: string;
};

export type InssMemory = {
  insured: number | null;
  employer: number | null;
  otherEntities: number | null;
  retained1162: number;
  payrollGuide: number | null;
  event130: number;
  event131: number;
  adjustedGuide: number | null;
  lot: number;
  difference: number | null;
};

export type PayrollAnalysis = {
  lotCode: string;
  rows: PayrollLotRow[];
  debit: number;
  credit: number;
  difference: number;
  checks: PayrollCheck[];
  inssMemory: InssMemory;
  missingDocuments: string[];
  canIntegrate: boolean;
};

export type ExtractedDocument = { name: string; text: string };

const ACCOUNTS = {
  salary: "2.1.2.01.01.01",
  rpa: "2.1.2.01.01.02",
  termination: "2.1.2.01.01.03",
  vacationLiquid: "1.1.3.01.02.02",
  salaryAdvance: "1.1.3.01.02.01",
  thirteenthAdvance: "1.1.3.01.02.04",
  inss: "2.1.2.01.03.01",
  fgts: "2.1.2.01.03.02",
  irrf0561: "2.1.4.01.02.02",
  irrf0588: "2.1.4.01.02.03",
  vacation: "2.1.2.01.04.01",
  vacationInss: "2.1.2.01.04.08",
  vacationFgts: "2.1.2.01.04.02",
  thirteenth: "2.1.2.01.04.03",
  thirteenthInss: "2.1.2.01.04.09",
  thirteenthFgts: "2.1.2.01.04.04",
} as const;

const normalized = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
const accountCode = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, "");
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function parseMoney(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const source = String(value ?? "").trim().replace(/R\$/gi, "").replace(/\s/g, "");
  if (!source || source === "-") return 0;
  const negative = /^\(.*\)$/.test(source) || source.startsWith("-");
  let clean = source.replace(/[()\-]/g, "").replace(/[^\d.,]/g, "");
  if (clean.includes(",") && clean.includes(".")) {
    clean = clean.lastIndexOf(",") > clean.lastIndexOf(".") ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(/,/g, "");
  } else if (clean.includes(",")) clean = /,\d{2}$/.test(clean) ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(/,/g, "");
  else if ((clean.match(/\./g) ?? []).length > 1) clean = clean.replace(/\./g, "");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0;
}

function headerIndex(row: unknown[], terms: string[]) {
  return row.findIndex((cell) => terms.some((term) => normalized(cell).includes(term)));
}

function eventFrom(...values: unknown[]) {
  return values.map(String).join(" ").toUpperCase().match(/\b(?:EV|EN)\d{4}\b/)?.[0] ?? "";
}

export function parsePayrollLot(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  let best: { rows: PayrollLotRow[]; lotCode: string; companyCode: string } = { rows: [], lotCode: "", companyCode: "" };
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
    for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 80); rowIndex += 1) {
      const header = matrix[rowIndex];
      const account = headerIndex(header, ["CODCONTA", "CONTA CONTABIL", "CONTA"]);
      const debit = headerIndex(header, ["DEBITO"]);
      const credit = headerIndex(header, ["CREDITO"]);
      if (account < 0 || debit < 0 || credit < 0) continue;
      const description = headerIndex(header, ["DESCRICAO", "NOME CONTA"]);
      const complement = headerIndex(header, ["COMPLEMENTO", "HISTORICO"]);
      const event = headerIndex(header, ["EVENTO"]);
      const lot = headerIndex(header, ["CODLOTE", "LOTE"]);
      const company = headerIndex(header, ["CODCOLIGADA", "COLIGADA"]);
      const parsed = matrix.slice(rowIndex + 1).flatMap((row) => {
        const code = accountCode(row[account]);
        const rowDebit = Math.abs(parseMoney(row[debit]));
        const rowCredit = Math.abs(parseMoney(row[credit]));
        if (!/^\d+(?:\.\d+)+$/.test(code) || (!rowDebit && !rowCredit)) return [];
        const rowDescription = description >= 0 ? String(row[description] ?? "") : "";
        const rowComplement = complement >= 0 ? String(row[complement] ?? "") : "";
        const rowEvent = event >= 0 ? String(row[event] ?? "") : eventFrom(rowDescription, rowComplement);
        return [{ account: code, description: rowDescription, event: rowEvent, complement: rowComplement, debit: rowDebit, credit: rowCredit }];
      });
      if (parsed.length > best.rows.length) {
        const lotValue = lot >= 0 ? matrix.slice(rowIndex + 1).map((row) => String(row[lot] ?? "").trim()).find(Boolean) ?? "" : "";
        const companyValue = company >= 0 ? matrix.slice(rowIndex + 1).map((row) => String(row[company] ?? "").trim()).find(Boolean) ?? "" : "";
        best = { rows: parsed, lotCode: lotValue, companyCode: companyValue };
      }
    }
  }
  if (!best.rows.length) throw new Error("Não foi possível localizar a base do lote com conta, débito e crédito.");
  return best;
}

function accountMovement(rows: PayrollLotRow[], account: string) {
  return rows.filter((row) => row.account === account).reduce((total, row) => total + row.debit - row.credit, 0);
}

function accountValue(rows: PayrollLotRow[], account: string) {
  const selected = rows.filter((row) => row.account === account);
  const debit = selected.reduce((sum, row) => sum + row.debit, 0);
  const credit = selected.reduce((sum, row) => sum + row.credit, 0);
  return Math.max(debit, credit);
}

function moneyValues(text: string) {
  return [...text.matchAll(/(?:R\$\s*)?\(?-?\d{1,3}(?:\.\d{3})*,\d{2}\)?/g)].map((match) => parseMoney(match[0]));
}

function valueNear(text: string, patterns: RegExp[]) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (!patterns.some((pattern) => pattern.test(normalized(lines[index])))) continue;
    const sameLine = moneyValues(lines[index]);
    if (sameLine.length) return sameLine.at(-1)!;
    const nextLine = moneyValues(lines[index + 1] ?? "");
    if (nextLine.length) return nextLine.at(-1)!;
  }
  return null;
}

function eventValue(text: string, codes: string[], labels: string[] = []) {
  const lines = text.split(/\r?\n/);
  for (const code of codes) {
    const codePattern = new RegExp(`(^|[^0-9])${code}([^0-9]|$)`);
    for (const line of lines) {
      const match = normalized(line).match(codePattern);
      if (!match || match.index === undefined) continue;
      const start = match.index + match[1].length;
      const tail = line.slice(start);
      const nextEvent = tail.slice(code.length).search(/\b(?:EV|EN)?\d{4}\b/);
      const segment = nextEvent >= 0 ? tail.slice(0, code.length + nextEvent) : tail;
      const values = moneyValues(segment);
      if (values.length) return values.at(-1)!;
    }
  }
  const patterns = [
    ...codes.map((code) => new RegExp(`(^|[^0-9])${code}([^0-9]|$)`)),
    ...labels.map((label) => new RegExp(label)),
  ];
  return valueNear(text, patterns);
}

function eventValueMax(text: string, codes: string[], labels: string[] = []) {
  const values: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const code of codes) {
    const codePattern = new RegExp(`(^|[^0-9])${code}([^0-9]|$)`);
    for (const line of lines) {
      const match = normalized(line).match(codePattern);
      if (!match || match.index === undefined) continue;
      const start = match.index + match[1].length;
      const tail = line.slice(start);
      const nextEvent = tail.slice(code.length).search(/\b(?:EV|EN)?\d{4}\b/);
      const segment = nextEvent >= 0 ? tail.slice(0, code.length + nextEvent) : tail;
      const amounts = moneyValues(segment);
      if (amounts.length) values.push(Math.abs(amounts.at(-1)!));
    }
  }
  if (values.length) return Math.max(...values);
  for (const label of labels) {
    const value = valueNearMax(text, [new RegExp(label)]);
    if (value !== null) values.push(Math.abs(value));
  }
  return values.length ? Math.max(...values) : null;
}

function valueNearMax(text: string, patterns: RegExp[]) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (!patterns.some((pattern) => pattern.test(normalized(lines[index])))) continue;
    const values = moneyValues(lines.slice(index, index + 3).join(" "));
    if (values.length) return Math.max(...values.map(Math.abs));
  }
  return null;
}

function valueAcrossMax(text: string, patterns: RegExp[]) {
  const values = text.split(/\r?\n/)
    .filter((line) => patterns.some((pattern) => pattern.test(normalized(line))))
    .flatMap((line) => moneyValues(line).map(Math.abs));
  return values.length ? Math.max(...values) : null;
}

function valueAfterLabelMax(text: string, label: string) {
  const values = text.split(/\r?\n/).flatMap((line) => {
    const lineNormalized = normalized(line);
    const labelIndex = lineNormalized.indexOf(label);
    if (labelIndex < 0) return [];
    const amounts = moneyValues(line.slice(labelIndex + label.length));
    return amounts.length ? [Math.abs(amounts[0])] : [];
  });
  return values.length ? Math.max(...values) : null;
}

function folhaSummaryText(text: string) {
  const pages = text.split(/\f/).map((page) => page.trim()).filter(Boolean);
  const totalGeneral = pages.findLast((page) => /TOTAL GERAL/.test(normalized(page)) && /\bLIQUIDO\b/.test(normalized(page)));
  if (totalGeneral) return totalGeneral;
  const payrollTotals = pages.findLast((page) => /PROVENTOS/.test(normalized(page)) && /DESCONTOS/.test(normalized(page)) && /\bLIQUIDO\b/.test(normalized(page)));
  return payrollTotals ?? text;
}

function lastMoneyOnLinesContaining(text: string, requiredTokens: string[]) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const lineNormalized = normalized(line);
    if (!requiredTokens.every((token) => lineNormalized.includes(token))) continue;
    const values = moneyValues(line);
    if (values.length) return values.at(-1)!;
  }
  return null;
}

function previdenciariaTotals(text: string) {
  const values = text.split(/\r?\n/).flatMap((line) => {
    if (!normalized(line).includes("PREVIDENCIARIA")) return [];
    const amounts = moneyValues(line);
    return amounts.length ? [amounts.at(-1)!] : [];
  });
  return {
    insured: values[0] ?? null,
    employer: values[1] ?? null,
  };
}

function findDocument(documents: ExtractedDocument[], patterns: RegExp[]) {
  return documents.find((document) => patterns.some((pattern) => pattern.test(normalized(`${document.name} ${document.text.slice(0, 1200)}`))));
}

function spreadsheetCodeValue(text: string, code: string) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const columns = lines[index].split(",").map((cell) => normalized(cell));
    const codeIndex = columns.findIndex((cell) => cell === code || cell === code.replace(/^0+/, ""));
    if (codeIndex < 0) continue;
    const valueLine = lines.slice(index + 1, index + 4).find((line) => normalized(line).includes("FILIAL INICIAL"));
    if (valueLine) return parseMoney(valueLine.split(",")[codeIndex]);
  }
  return null;
}

function findIrrfLotDocument(documents: ExtractedDocument[], previousCompetence: boolean) {
  const candidates = documents.filter((document) => /IRRF.*LOTE/.test(normalized(document.name)));
  const scored = candidates.map((document) => {
    const name = normalized(document.name);
    const isReport = /RELATORIO/.test(name);
    const hasNamedCompetence = /(?:0[1-9]|1[0-2])20\d{2}/.test(name.replace(/\D/g, ""));
    const score = previousCompetence ? (hasNamedCompetence ? 10 : 0) - (isReport ? 4 : 0) : (isReport ? 10 : 0) - (hasNamedCompetence ? 4 : 0);
    return { document, score };
  });
  return scored.sort((a, b) => b.score - a.score)[0]?.document;
}

function lotEventValue(rows: PayrollLotRow[], codes: string[]) {
  const selected = rows.filter((row) => codes.some((code) => normalized(`${row.event} ${row.complement}`).includes(code)));
  if (!selected.length) return null;
  const debit = selected.reduce((sum, row) => sum + row.debit, 0);
  const credit = selected.reduce((sum, row) => sum + row.credit, 0);
  return Math.max(debit, credit);
}

function previousCompetenceOf(competence: string) {
  const match = competence.match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function competenceDigits(competence: string) {
  const match = competence.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}${match[1]}` : "";
}

function findIrrfMonthlyDocument(documents: ExtractedDocument[], competence: string, previous: boolean) {
  const target = competenceDigits(previous ? previousCompetenceOf(competence) : competence);
  const candidates = documents.filter((document) => /IRRF.*MENSAL/.test(normalized(document.name)) && !/DCTF/.test(normalized(document.name)));
  const matching = candidates.find((document) => normalized(document.name).replace(/\D/g, "").includes(target));
  if (matching) return matching;
  if (previous) return undefined;
  return candidates.find((document) => !/(?:0[1-9]|1[0-2])20\d{2}/.test(normalized(document.name).replace(/\D/g, "")));
}

type IrrfMonthlyTotals = { recognized: boolean; code0561: number; code0588: number };

function csvCells(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}

function spreadsheetDateMonthYear(value: unknown) {
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (iso) return { month: Number(iso[2]), year: Number(iso[1]) };
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!slash) return null;
  const year = Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3]);
  return { month: Number(slash[1]), year };
}

function irrfMonthlyTotals(text: string, competence: string, paymentCompetence = ""): IrrfMonthlyTotals {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^CHAPA,NOME,MESCOMP,ANOCOMP,DTPAGTO,CODEVENTO,VALOR,CODFILIAL/i.test(normalized(line)));
  if (headerIndex < 0) return { recognized: false, code0561: 0, code0588: 0 };
  const matrix = lines.slice(headerIndex).map(csvCells);
  const target = competence.match(/^(\d{4})-(\d{2})$/);
  if (!target) return { recognized: true, code0561: 0, code0588: 0 };
  const targetYear = Number(target[1]);
  const targetMonth = Number(target[2]);
  let code0561 = 0;
  let code0588 = 0;
  for (const row of matrix.slice(1)) {
    for (const offset of [0, 8]) {
      const month = Number(row[offset + 2]);
      const year = Number(row[offset + 3]);
      if (month !== targetMonth || year !== targetYear) continue;
      if (paymentCompetence) {
        const payment = spreadsheetDateMonthYear(row[offset + 4]);
        const expected = paymentCompetence.match(/^(\d{4})-(\d{2})$/);
        if (!payment || !expected || payment.month !== Number(expected[2]) || payment.year !== Number(expected[1])) continue;
      }
      const value = Math.abs(parseMoney(row[offset + 6]));
      if (offset === 0) code0561 += value;
      else code0588 += value;
    }
  }
  return { recognized: true, code0561: roundMoney(code0561), code0588: roundMoney(code0588) };
}

function irrfPaymentTotals(text: string, paymentCompetence: string): IrrfMonthlyTotals {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^CHAPA,NOME,MESCOMP,ANOCOMP,DTPAGTO,CODEVENTO,VALOR,CODFILIAL/i.test(normalized(line)));
  if (headerIndex < 0) return { recognized: false, code0561: 0, code0588: 0 };
  const expected = paymentCompetence.match(/^(\d{4})-(\d{2})$/);
  if (!expected) return { recognized: true, code0561: 0, code0588: 0 };
  let code0561 = 0;
  let code0588 = 0;
  for (const row of lines.slice(headerIndex + 1).map(csvCells)) {
    for (const offset of [0, 8]) {
      const payment = spreadsheetDateMonthYear(row[offset + 4]);
      if (!payment || payment.month !== Number(expected[2]) || payment.year !== Number(expected[1])) continue;
      const value = Math.abs(parseMoney(row[offset + 6]));
      if (offset === 0) code0561 += value;
      else code0588 += value;
    }
  }
  return { recognized: true, code0561: roundMoney(code0561), code0588: roundMoney(code0588) };
}

function accountEventValue(rows: PayrollLotRow[], account: string, codes: string[]) {
  return lotEventValue(rows.filter((row) => row.account === account), codes);
}

function looseOcrNumber(value: string) {
  if (/[,\.]/.test(value)) return Math.abs(parseMoney(value));
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? Number(digits) / 100 : Number(digits);
}

function competenceLabel(competence: string) {
  const match = competence.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}/${match[1]}` : competence;
}

function fgtsDocumentValue(document: ExtractedDocument, competence: string) {
  const text = normalized(document.text);
  const label = competenceLabel(competence);
  if (label) {
    const competenceLines = document.text.split(/\r?\n/).filter((line) => normalized(line).startsWith(label));
    const values = competenceLines.map((line) => {
      const amounts = moneyValues(line);
      if (!amounts.length) return null;
      const total = Math.abs(amounts.at(-1)!);
      const charges = amounts.length >= 2 ? Math.abs(amounts.at(-2)!) : 0;
      return roundMoney(total - charges);
    }).filter((value): value is number => value !== null);
    if (values.length) return roundMoney(values.reduce((sum, value) => sum + value, 0));
  }
  if (text.includes("COMPENSATORIA") && text.includes("FGTS RESCISORIO")) {
    const line = document.text.split(/\r?\n/).find((item) => /^\s*\d{2}\/\d{4}\s+\d+/.test(item));
    if (line) {
      const tokens = line.match(/\d+(?:[.,]\d+)?/g) ?? [];
      if (tokens.length >= 7) {
        const total = looseOcrNumber(tokens.at(-1)!);
        const charges = looseOcrNumber(tokens.at(-2)!);
        if (total > charges) return total - charges;
      }
    }
  }
  return valueNear(document.text, [/VALOR A RECOLHER/, /TOTAL A RECOLHER/, /TOTAL DA GUIA/, /VALOR TOTAL/]);
}

function provisionRows(buffer: ArrayBuffer, fileName: string) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const result = new Map<string, number>();
  const isThirteenth = /13|DECIMO/i.test(normalized(fileName));
  for (const sheet of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, raw: false, defval: "" });
    const structuredHeader = matrix.findIndex((row) => row.some((cell) => /FGTS_(MES|BX)|FERIAS_FGTS/.test(normalized(cell))) && row.some((cell) => /INSS_(MES|BX)|FERIAS_INSS/.test(normalized(cell))));
    if (structuredHeader >= 0) {
      const header = matrix[structuredHeader].map(normalized);
      const totalRow = [...matrix.slice(0, structuredHeader)].reverse().find((row) => row.some((cell) => normalized(cell).includes("TOTAIS")));
      if (totalRow) {
        const at = (names: string[]) => {
          const index = header.findIndex((cell) => names.some((name) => cell === name));
          return index >= 0 ? parseMoney(totalRow[index]) : 0;
        };
        if (isThirteenth) {
          result.set(ACCOUNTS.thirteenth, at(["BAIXA_PROV"]) - at(["PROV_MES"]));
          result.set(ACCOUNTS.thirteenthFgts, at(["DT_FGTS_BX"]) - at(["FGTS_MES"]));
          result.set(ACCOUNTS.thirteenthInss, at(["DT_INSS_BX"]) - at(["INSS_MES"]));
        } else {
          result.set(ACCOUNTS.vacation, at(["FERIAS_PROV_BX"]) - at(["FERIAS_PROV"]));
          result.set(ACCOUNTS.vacationFgts, at(["FERIAS_FGTS_BX"]) + at(["FERIAS_FGTS_EST"]) - at(["FERIAS_FGTS"]));
          result.set(ACCOUNTS.vacationInss, at(["FERIAS_INSS_BX"]) + at(["FERIAS_INSS_EST"]) - at(["FERIAS_INSS"]));
        }
        continue;
      }
    }
    const headerRow = matrix.findIndex((row) => headerIndex(row, ["BAIXA", "REVERSAO"]) >= 0 && headerIndex(row, ["PROVISAO MENSAL", "PROVISAO DO MES", "MENSAL"]) >= 0);
    if (headerRow < 0) continue;
    const header = matrix[headerRow];
    const monthly = headerIndex(header, ["PROVISAO MENSAL", "PROVISAO DO MES", "MENSAL"]);
    const reversal = headerIndex(header, ["BAIXA", "REVERSAO"]);
    const description = headerIndex(header, ["DESCRICAO", "CONTA", "PROVISAO"]);
    for (const row of matrix.slice(headerRow + 1)) {
      const label = normalized(description >= 0 ? row[description] : row.join(" "));
      const expected = parseMoney(row[reversal]) - parseMoney(row[monthly]);
      if (!expected && !label) continue;
      const key = label.includes("FGTS") ? (isThirteenth ? ACCOUNTS.thirteenthFgts : ACCOUNTS.vacationFgts)
        : label.includes("INSS") ? (isThirteenth ? ACCOUNTS.thirteenthInss : ACCOUNTS.vacationInss)
          : isThirteenth ? ACCOUNTS.thirteenth : ACCOUNTS.vacation;
      result.set(key, (result.get(key) ?? 0) + expected);
    }
  }
  return result;
}

export async function parseProvisionFiles(files: File[]) {
  const values = new Map<string, number>();
  for (const file of files.filter((item) => /\.(xlsx|xls|xlsm)$/i.test(item.name) && /(FERIAS|FÉRIAS|13|DECIMO)/i.test(normalized(item.name)))) {
    for (const [account, value] of provisionRows(await file.arrayBuffer(), file.name)) values.set(account, value);
  }
  return values;
}

export async function parseSpreadsheetDocuments(files: File[]) {
  const documents: ExtractedDocument[] = [];
  for (const file of files.filter((item) => /\.(xlsx|xls|xlsm)$/i.test(item.name))) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const text = workbook.SheetNames.map((sheet) => `${sheet}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheet], { blankrows: false })}`).join("\n");
    documents.push({ name: file.name, text });
  }
  return documents;
}

function check(group: PayrollCheck["group"], item: string, account: string, event: string, lot: number, document: number | null, tolerance: number, source: string, note = ""): PayrollCheck {
  const difference = document === null ? null : roundMoney(lot - document);
  const status: PayrollCheck["status"] = difference !== null && Math.abs(difference) <= tolerance ? "OK" : "PENDENTE";
  return { group, item, account, event, lot, document, difference, status, source, note };
}

export function reconcilePayroll(rows: PayrollLotRow[], lotCode: string, documents: ExtractedDocument[], provisions: Map<string, number>, tolerance = 1, competence = ""): PayrollAnalysis {
  const folha = findDocument(documents, [/FOLHA.*ANALITICA/, /RESUMO.*FOLHA/]);
  const dctf = findDocument(documents, [/GUIA.*DCTF/, /DCTFWEB.*COL/]) ?? findDocument(documents, [/DCTF/]);
  const currentIrrfMonthly = findIrrfMonthlyDocument(documents, competence, false);
  const previousIrrfMonthly = findIrrfMonthlyDocument(documents, competence, true);
  const previousIrrfLot = previousIrrfMonthly ?? findIrrfLotDocument(documents, true);
  const dctfIrrfComposition = documents.find((document) => /IRRF.*DCTFWEB/.test(normalized(document.name)) && !/\.PDF$/i.test(document.name));
  const fgtsDocs = documents.filter((document) => {
    const name = normalized(document.name);
    const heading = normalized(document.text.slice(0, 1200));
    return /GUIA.*FGTS|FGTS.*GUIA/.test(name) || /GFD.*GUIA DO FGTS|GUIA DO FGTS DIGITAL/.test(heading);
  });
  const folhaText = folha?.text ?? "";
  const folhaTotalsText = folhaSummaryText(folhaText);
  const dctfText = dctf?.text ?? "";
  const liquidGeneral = valueAfterLabelMax(folhaTotalsText, "LIQUIDO");
  const liquidLot = lotEventValue(rows, ["EN0002", "EN0020"]);
  const liquidCheck = check(
    "Líquidos",
    "Líquido da folha",
    ACCOUNTS.salary,
    "EN0002 + EN0020",
    liquidLot ?? 0,
    liquidGeneral,
    tolerance,
    folha?.name ?? "Folha Analítica não identificada",
    "A soma dos eventos EN0002 e EN0020 do lote deve conferir com o total Líquido apresentado na página de TOTAL GERAL da Folha Analítica.",
  );
  if (liquidLot === null) {
    liquidCheck.status = "PENDENTE";
    liquidCheck.note = "Eventos EN0002 e EN0020 não identificados no lote. " + liquidCheck.note;
  }
  const checks: PayrollCheck[] = [liquidCheck];

  const previdenciariaFallback = previdenciariaTotals(dctfText);
  const insured = valueNear(dctfText, [/TOTAL CONTRIBUICAO PREVIDENCIARIA SEGURADOS/]) ?? previdenciariaFallback.insured;
  const employer = valueNear(dctfText, [/TOTAL CONTRIBUICAO PREVIDENCIARIA PATRONAL/]) ?? previdenciariaFallback.employer;
  const otherEntities = valueNear(dctfText, [/TOTAL CONTRIBUICAO PARA OUTRAS ENTIDADES E FUNDOS/]) ?? lastMoneyOnLinesContaining(dctfText, ["ENTIDADES", "FUNDOS"]);
  const retained1162 = eventValue(dctfText, ["1162"]) ?? 0;
  const payrollGuide = insured === null || employer === null || otherEntities === null ? null : roundMoney(insured + employer + otherEntities - retained1162);
  const event130 = eventValueMax(folhaText, ["0130"], ["INSS FERIAS REF.*PROXIMO MES"]) ?? lotEventValue(rows, ["EV0130", "EN0130"]) ?? 0;
  const event131 = eventValueMax(folhaText, ["0131"], ["INSS FERIAS DESC.*MES ANT"]) ?? lotEventValue(rows, ["EV0131", "EN0131"]) ?? 0;
  const adjustedGuide = payrollGuide === null ? null : roundMoney(payrollGuide - event130 + event131);
  const inssLot = Math.abs(accountMovement(rows, ACCOUNTS.inss));
  checks.push(check("INSS", "INSS ajustado x lote", ACCOUNTS.inss, "DCTFWeb - EV0130 + EV0131", inssLot, adjustedGuide, tolerance, dctf?.name ?? "DCTFWeb não identificada", "Guia previdenciária sem o código 1162, menos o evento 130 e mais o evento 131 da Folha Analítica."));
  const fgtsDocument = fgtsDocs.length ? fgtsDocs.reduce((sum, document) => sum + (fgtsDocumentValue(document, competence) ?? 0), 0) : null;
  checks.push(check("FGTS", "FGTS a recolher — lote x guias", ACCOUNTS.fgts, "Guias FGTS", Math.abs(accountMovement(rows, ACCOUNTS.fgts)), fgtsDocument, Math.max(tolerance, 40), fgtsDocs.map((doc) => doc.name).join(" + ") || "Guias FGTS não identificadas", "Conta passiva de FGTS a recolher: 2.1.2.01.03.02. Tolerância específica: até R$ 40,00."));

  const irrf0561EventCodes = ["EV0004", "EV0049", "EV0030"];
  const irrf0588EventCodes = ["EV0084"];
  const irrf0561Lot = Math.abs(accountMovement(rows, ACCOUNTS.irrf0561));
  const irrf0588Lot = Math.abs(accountMovement(rows, ACCOUNTS.irrf0588));
  const irrf0561Events = accountEventValue(rows, ACCOUNTS.irrf0561, irrf0561EventCodes) ?? lotEventValue(rows, irrf0561EventCodes) ?? 0;
  const irrf0588Events = accountEventValue(rows, ACCOUNTS.irrf0588, irrf0588EventCodes) ?? lotEventValue(rows, irrf0588EventCodes) ?? 0;
  checks.push(check(
    "IRRF",
    "IRRF 0561 contabilizado x eventos do lote",
    ACCOUNTS.irrf0561,
    irrf0561EventCodes.join(" + "),
    irrf0561Lot,
    irrf0561Events,
    tolerance,
    "Lote contábil TOTVS",
    "Composição 0561: EV0004 — IRRF; EV0049 — IRRF 13º salário; EV0030 — IRRF férias.",
  ));
  checks.push(check(
    "IRRF",
    "IRRF 0588 contabilizado x evento do lote",
    ACCOUNTS.irrf0588,
    irrf0588EventCodes.join(" + "),
    irrf0588Lot,
    irrf0588Events,
    tolerance,
    "Lote contábil TOTVS",
    "Composição 0588: EV0084 — IRRF pró-labore/autônomos.",
  ));

  const currentMonthlyTotals = currentIrrfMonthly ? irrfMonthlyTotals(currentIrrfMonthly.text, competence) : null;
  checks.push(check("IRRF", "IRRF 0561 — provisão x planilha mensal", ACCOUNTS.irrf0561, irrf0561EventCodes.join(" + "), irrf0561Events, currentMonthlyTotals?.recognized ? currentMonthlyTotals.code0561 : null, tolerance, currentIrrfMonthly?.name ?? "Planilha mensal de IRRF da competência não identificada", "Considera somente registros cuja competência corresponda ao mês analisado; históricos de outras competências são desconsiderados."));
  checks.push(check("IRRF", "IRRF 0588 — provisão x planilha mensal", ACCOUNTS.irrf0588, "EV0084", irrf0588Events, currentMonthlyTotals?.recognized ? currentMonthlyTotals.code0588 : null, tolerance, currentIrrfMonthly?.name ?? "Planilha mensal de IRRF da competência não identificada", "Considera somente registros cuja competência corresponda ao mês analisado; históricos de outras competências são desconsiderados."));

  const previousMonthlyTotals = previousIrrfMonthly ? irrfMonthlyTotals(previousIrrfMonthly.text, previousCompetenceOf(competence), competence) : null;
  const currentPaidTotals = currentIrrfMonthly ? irrfPaymentTotals(currentIrrfMonthly.text, competence) : null;
  const dctfCompositionTotals = dctfIrrfComposition ? irrfPaymentTotals(dctfIrrfComposition.text, competence) : null;
  const previous0561 = previousMonthlyTotals?.recognized ? previousMonthlyTotals.code0561 : spreadsheetCodeValue(previousIrrfLot?.text ?? "", "0561");
  const previous0588 = previousMonthlyTotals?.recognized ? previousMonthlyTotals.code0588 : spreadsheetCodeValue(previousIrrfLot?.text ?? "", "0588");
  const dueIrrf0561 = previous0561 === null && !currentPaidTotals?.recognized ? null : roundMoney((previous0561 ?? 0) + (currentPaidTotals?.recognized ? currentPaidTotals.code0561 : 0));
  const guideIrrf0561 = eventValue(dctfText, ["0561"]) ?? (dctfCompositionTotals?.recognized ? dctfCompositionTotals.code0561 : (dctf ? 0 : null));
  const guide0561Check = check("IRRF", "IRRF 0561 — recolhimento", "DCTFWeb", "0561", dueIrrf0561 ?? 0, guideIrrf0561, tolerance, `${previousIrrfLot?.name ?? "Composição do mês anterior não identificada"} + ${currentIrrfMonthly?.name ?? "Planilha mensal não identificada"} x ${dctf?.name ?? "DCTFWeb não identificada"}`, "Soma a planilha do mês anterior aos registros da planilha mensal cuja data de pagamento esteja no mês analisado e compara o resultado com a DCTF Web.");
  if (dueIrrf0561 === null || guideIrrf0561 === null) guide0561Check.status = "PENDENTE";
  checks.push(guide0561Check);

  const dueIrrf0588 = previous0588 === null && !currentPaidTotals?.recognized ? null : roundMoney((previous0588 ?? 0) + (currentPaidTotals?.recognized ? currentPaidTotals.code0588 : 0));
  const guideIrrf0588 = eventValue(dctfText, ["0588"]) ?? (dctfCompositionTotals?.recognized ? dctfCompositionTotals.code0588 : (dctf ? 0 : null));
  const guide0588Check = check("IRRF", "IRRF 0588 — recolhimento", "DCTFWeb", "0588", dueIrrf0588 ?? 0, guideIrrf0588, tolerance, `${previousIrrfLot?.name ?? "Composição do mês anterior não identificada"} + ${currentIrrfMonthly?.name ?? "Planilha mensal não identificada"} x ${dctf?.name ?? "DCTFWeb não identificada"}`, "Soma o 0588 do mês anterior aos registros da planilha mensal pagos no mês analisado e compara o resultado com a DCTF Web.");
  if (dueIrrf0588 === null) guide0588Check.status = "PENDENTE";
  checks.push(guide0588Check);

  const provisionDefinitions: Array<[string, string]> = [
    [ACCOUNTS.vacation, "Provisão de férias"], [ACCOUNTS.vacationInss, "INSS sobre férias"], [ACCOUNTS.vacationFgts, "FGTS sobre férias"],
    [ACCOUNTS.thirteenth, "Provisão de 13º salário"], [ACCOUNTS.thirteenthInss, "INSS sobre 13º salário"], [ACCOUNTS.thirteenthFgts, "FGTS sobre 13º salário"],
  ];
  for (const [account, item] of provisionDefinitions) checks.push(check("Provisões", item, account, "Movimento mensal", accountMovement(rows, account), provisions.get(account) ?? null, tolerance, provisions.has(account) ? "Planilha de provisão do DP" : "Planilha de provisão não reconhecida"));

  const debit = rows.reduce((sum, row) => sum + row.debit, 0);
  const credit = rows.reduce((sum, row) => sum + row.credit, 0);
  const blocking = checks.filter((item) => item.status === "PENDENTE");
  const missingDocuments = [...new Set(blocking.map((item) => item.source))];
  const inssMemory: InssMemory = { insured, employer, otherEntities, retained1162, payrollGuide, event130, event131, adjustedGuide, lot: inssLot, difference: adjustedGuide === null ? null : roundMoney(inssLot - adjustedGuide) };
  return { lotCode, rows, debit: roundMoney(debit), credit: roundMoney(credit), difference: roundMoney(debit - credit), checks, inssMemory, missingDocuments, canIntegrate: Math.abs(debit - credit) <= 0.01 && blocking.length === 0 };
}

export function buildPayrollAnalysisWorkbook(analysis: PayrollAnalysis, companyCode: string, companyName: string, competence: string) {
  const workbook = XLSX.utils.book_new();
  const summary = [
    ["MEMÓRIA DA CONFERÊNCIA DO LOTE DA FOLHA"], [], ["Coligada", companyCode], ["Empresa", companyName], ["Competência", competence], ["Lote", analysis.lotCode],
    ["Débitos", analysis.debit], ["Créditos", analysis.credit], ["Diferença", analysis.difference], ["Situação", analysis.canIntegrate ? "Pode integrar o lote" : "Pendências a verificar"], [],
    [analysis.canIntegrate ? "Conferência da análise de lote da folha x documentos finalizada; pode integrar o lote." : "Conferência finalizada com pendências a verificar."],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), "Resumo");
  const inssRows = [
    { Etapa: "Total contribuição previdenciária — segurados", Operação: "+", Valor: analysis.inssMemory.insured },
    { Etapa: "Total contribuição previdenciária — patronal", Operação: "+", Valor: analysis.inssMemory.employer },
    { Etapa: "Total para outras entidades e fundos", Operação: "+", Valor: analysis.inssMemory.otherEntities },
    { Etapa: "Código 1162 — INSS retido", Operação: "-", Valor: analysis.inssMemory.retained1162 },
    { Etapa: "INSS da folha na guia", Operação: "=", Valor: analysis.inssMemory.payrollGuide },
    { Etapa: "Evento 130 — férias ref. próximo mês", Operação: "-", Valor: analysis.inssMemory.event130 },
    { Etapa: "Evento 131 — férias desc. mês anterior", Operação: "+", Valor: analysis.inssMemory.event131 },
    { Etapa: "INSS da guia após ajustes", Operação: "=", Valor: analysis.inssMemory.adjustedGuide },
    { Etapa: "INSS contabilizado no lote", Operação: "comparar", Valor: analysis.inssMemory.lot },
    { Etapa: "Diferença lote menos guia ajustada", Operação: "=", Valor: analysis.inssMemory.difference },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(inssRows), "INSS");
  for (const group of ["Líquidos", "FGTS", "IRRF", "Provisões"] as const) {
    const rows = analysis.checks.filter((item) => item.group === group).map((item) => ({ Item: item.item, Conta: item.account, Evento: item.event, Lote: item.lot, Documento: item.document, Diferença: item.difference, Status: item.status, Fonte: item.source, Observação: item.note }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), group);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analysis.rows.map((row) => ({ Conta: row.account, Descrição: row.description, Evento: row.event, Complemento: row.complement, Débito: row.debit, Crédito: row.credit }))), "Lote");
  return workbook;
}

export function exportPayrollAnalysis(analysis: PayrollAnalysis, companyCode: string, companyName: string, competence: string) {
  const workbook = buildPayrollAnalysisWorkbook(analysis, companyCode, companyName, competence);
  applyRaizWorkbookStyle(workbook);
  XLSX.writeFile(workbook, `memoria-conferencia-folha-coligada-${companyCode}-${competence}.xlsx`);
}
