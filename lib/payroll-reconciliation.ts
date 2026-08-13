import * as XLSX from "xlsx";

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
  irrf: "2.1.4.01.02.02",
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
  const currentIrrfLot = findIrrfLotDocument(documents, false);
  const previousIrrfLot = findIrrfLotDocument(documents, true);
  const fgtsDocs = documents.filter((document) => /FGTS/.test(normalized(`${document.name} ${document.text.slice(0, 800)}`)));
  const folhaText = folha?.text ?? "";
  const dctfText = dctf?.text ?? "";
  const liquidGeneral = valueAcrossMax(folhaText, [/\bLIQUIDO\b/]);
  const rpaDocument = (() => {
    const honorarium = eventValueMax(folhaText, ["0074"], ["HONORARIOS AUTONOMOS"]);
    const individualInss = eventValueMax(folhaText, ["0085"], ["INSS CONTRIB INDIVIDUAL"]);
    const autonomousIrrf = eventValueMax(folhaText, ["0084"], ["IRRF PRO.LABORE", "IRRF AUTONOMOS"]);
    return honorarium === null ? null : roundMoney(honorarium - (individualInss ?? 0) - (autonomousIrrf ?? 0));
  })();
  const salaryDocument = liquidGeneral === null ? null : roundMoney(liquidGeneral - (rpaDocument ?? 0));
  const terminationDocument = eventValueMax(folhaText, ["0150"], ["LIQUIDO.*RESCISAO"]);
  const vacationDocument = eventValueMax(folhaText, ["0043"], ["LIQUIDO.*FERIAS"]) ?? (folha && /0 EMPREGADOS.*FERIAS/.test(normalized(folhaText)) ? 0 : null);
  const salaryAdvanceLot = lotEventValue(rows, ["EV9130", "EV0034", "EV0020"]) ?? accountValue(rows, ACCOUNTS.salaryAdvance);
  const salaryAdvanceDocument = eventValueMax(folhaText, ["9130", "0034", "0020"], ["ADIANTAMENTO SALARIAL", "ADIANTAMENTO SALDO DEVEDOR"]);
  const thirteenthAdvanceLot = lotEventValue(rows, ["EV0009"]) ?? accountValue(rows, ACCOUNTS.thirteenthAdvance);
  const thirteenthAdvanceDocument = eventValueMax(folhaText, ["0009"]) ?? (thirteenthAdvanceLot === 0 ? 0 : null);
  const checks: PayrollCheck[] = [
    check("Líquidos", "Líquido salarial", ACCOUNTS.salary, "EN0002", accountValue(rows, ACCOUNTS.salary), salaryDocument, tolerance, folha?.name ?? "Folha Analítica não identificada"),
    check("Líquidos", "Líquido de RPA", ACCOUNTS.rpa, "EN0020", accountValue(rows, ACCOUNTS.rpa), rpaDocument, tolerance, folha?.name ?? "Folha Analítica não identificada"),
    check("Líquidos", "Líquido de rescisão", ACCOUNTS.termination, "EV0150", accountValue(rows, ACCOUNTS.termination), terminationDocument, tolerance, folha?.name ?? "Folha Analítica não identificada"),
    check("Líquidos", "Líquido de férias", ACCOUNTS.vacationLiquid, "EV0043", accountValue(rows, ACCOUNTS.vacationLiquid), vacationDocument ?? (accountValue(rows, ACCOUNTS.vacationLiquid) === 0 ? 0 : null), tolerance, folha?.name ?? "Folha Analítica não identificada"),
    check("Líquidos", "Adiantamento salarial", ACCOUNTS.salaryAdvance, "EV9130/EV0034/EV0020", salaryAdvanceLot, salaryAdvanceDocument ?? (salaryAdvanceLot === 0 ? 0 : null), tolerance, folha?.name ?? "Folha Analítica não identificada"),
    check("Líquidos", "Adiantamento de 13º salário", ACCOUNTS.thirteenthAdvance, "EV0009", thirteenthAdvanceLot, thirteenthAdvanceDocument, tolerance, folha?.name ?? "Folha Analítica não identificada"),
  ];

  const insured = valueNear(dctfText, [/TOTAL CONTRIBUICAO PREVIDENCIARIA SEGURADOS/]);
  const employer = valueNear(dctfText, [/TOTAL CONTRIBUICAO PREVIDENCIARIA PATRONAL/]);
  const otherEntities = valueNear(dctfText, [/TOTAL CONTRIBUICAO PARA OUTRAS ENTIDADES E FUNDOS/]);
  const retained1162 = eventValue(dctfText, ["1162"]) ?? 0;
  const payrollGuide = insured === null || employer === null || otherEntities === null ? null : roundMoney(insured + employer + otherEntities - retained1162);
  const event130 = eventValueMax(folhaText, ["0130"], ["INSS FERIAS REF.*PROXIMO MES"]) ?? lotEventValue(rows, ["EV0130", "EN0130"]) ?? 0;
  const event131 = eventValueMax(folhaText, ["0131"], ["INSS FERIAS DESC.*MES ANT"]) ?? lotEventValue(rows, ["EV0131", "EN0131"]) ?? 0;
  const adjustedGuide = payrollGuide === null ? null : roundMoney(payrollGuide - event130 + event131);
  const inssLot = Math.abs(accountMovement(rows, ACCOUNTS.inss));
  checks.push(check("INSS", "INSS ajustado x lote", ACCOUNTS.inss, "DCTFWeb - EV0130 + EV0131", inssLot, adjustedGuide, tolerance, dctf?.name ?? "DCTFWeb não identificada", "Guia previdenciária sem o código 1162, menos o evento 130 e mais o evento 131 da Folha Analítica."));
  const fgtsDocument = fgtsDocs.length ? fgtsDocs.reduce((sum, document) => sum + (fgtsDocumentValue(document, competence) ?? 0), 0) : null;
  checks.push(check("FGTS", "FGTS mensal e rescisório", ACCOUNTS.fgts, "Guias FGTS", Math.abs(accountMovement(rows, ACCOUNTS.fgts)), fgtsDocument, Math.max(tolerance, 40), fgtsDocs.map((doc) => doc.name).join(" + ") || "Guias FGTS não identificadas", "Tolerância específica do FGTS: até R$ 40,00."));
  const irrfLot = Math.abs(accountMovement(rows, ACCOUNTS.irrf));
  const currentIrrf0561 = (() => {
    const salaryIrrf = eventValueMax(folhaText, ["0004"], ["IRRF$"]);
    const vacationIrrf = eventValueMax(folhaText, ["0030"], ["IRRF FERIAS"]);
    return salaryIrrf === null && vacationIrrf === null ? spreadsheetCodeValue(currentIrrfLot?.text ?? "", "0561") : (salaryIrrf ?? 0) + (vacationIrrf ?? 0);
  })();
  checks.push(check("IRRF", "IRRF 0561 — lançamento do lote", ACCOUNTS.irrf, "0004 + 0030", irrfLot, currentIrrf0561, tolerance, folha?.name ?? currentIrrfLot?.name ?? "Composição atual do IRRF não identificada", "Confere o IRRF salarial e o IRRF de férias contabilizados na competência."));

  const dueIrrf0561 = spreadsheetCodeValue(previousIrrfLot?.text ?? "", "0561");
  const guideIrrf0561 = eventValue(dctfText, ["0561"]);
  const guide0561Check = check("IRRF", "IRRF 0561 — recolhimento", "DCTFWeb", "0561", dueIrrf0561 ?? 0, guideIrrf0561, tolerance, `${previousIrrfLot?.name ?? "Composição do mês anterior não identificada"} x ${dctf?.name ?? "DCTFWeb não identificada"}`, "Considera somente valores da competência anterior pagos no mês da guia.");
  guide0561Check.status = dueIrrf0561 === null || guideIrrf0561 === null ? "PENDENTE" : "INFORMATIVO";
  checks.push(guide0561Check);

  const dueIrrf0588 = spreadsheetCodeValue(previousIrrfLot?.text ?? "", "0588");
  const guideIrrf0588 = eventValue(dctfText, ["0588"]) ?? (dctf ? 0 : null);
  const guide0588Check = check("IRRF", "IRRF 0588 — recolhimento", "DCTFWeb", "0588", dueIrrf0588 ?? 0, guideIrrf0588, tolerance, `${previousIrrfLot?.name ?? "Composição do mês anterior não identificada"} x ${dctf?.name ?? "DCTFWeb não identificada"}`, "O 0588 descontado na competência anterior e pago no mês atual deve constar na guia.");
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
  XLSX.writeFile(workbook, `memoria-conferencia-folha-coligada-${companyCode}-${competence}.xlsx`);
}
