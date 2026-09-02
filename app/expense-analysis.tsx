"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, ExternalLink, FileSpreadsheet, RefreshCw, Upload, X } from "lucide-react";
import * as XLSX from "xlsx-js-style";

type Props = {
  companyCode: string;
  companyName: string;
  competence: string;
  accessToken: string;
};

type ExpenseRow = {
  supplier: string;
  account: string;
  description: string;
  months: Record<string, number>;
  total: number;
  comment: string;
  ownCompanySupplier: boolean;
  incorrectValue: boolean;
};

type Analysis = {
  fileName: string;
  rows: ExpenseRow[];
  movements: number;
  suppliers: number;
  periodTotal: number;
  targetTotal: number;
  months: string[];
  records: Record<string, unknown>[];
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const companySupplierAliases: Record<string, string[]> = {
  "12": ["COLEGIO LEONARDO DA VINCI", "COLÉGIO LEONARDO DA VINCI"],
};
const companySupplierTaxIds: Record<string, string[]> = {
  "12": ["09262835000194", "09262835000275", "09262835000437", "09262835000356"],
};
const groupCompanySupplierTaxIds = new Set([
  "21219576000114",
  "86704160000137",
  "21669216000114",
  "14642152000100",
  "23075186000143",
  "33590308000193",
  "28336302000154",
  "28734505000107",
  "07499961000131",
  "89409825000178",
  "09262835000194",
  "92845437000144",
  "87188959000180",
  "38376734000142",
  "20647702000179",
  "25788092000147",
  "66448143000179",
  "42722698000107",
  "32555626000150",
  "49218279000173",
  "58232918000146",
  "58241128000127",
  "09262835000275",
  "09262835000437",
  "09262835000356",
]);
const groupCompanySupplierNames = [
  "RAIZ EDUCAÇÃO",
  "COLÉGIO QI",
  "RAIZ SUL",
  "EDITORA RAIZ",
  "AO CUBO",
  "METROPOLITANO",
  "MATRIZ EDUCAÇÃO",
  "CRECHE IPÊ",
  "ESCOLAS INTEGRADAS",
  "GEU",
  "CLV",
  "SELVI",
  "DIDACTA",
  "CLV GAMA",
  "BOM TEMPO",
  "CENTRO EDUCACIONAL ESPAÇO MÁGICO LTDA",
  "APOGEU UBÁ",
  "APOGEU CIDADE ALTA",
  "APOGEU DIVINÓPOLIS",
  "APOGEU PARÁ DE MINAS",
  "APOGEU POUSO ALEGRE",
  "COLÉGIO SÃO TOMAS DE AQUINO",
  "COLÉGIO SARAH DAWSEY",
  "SUDESTE GESTÃO EDUCACIONAL LTDA",
  "APOGEU DIVINOPOLIS LTDA",
  "PRO RAIZ SISTEMAS DE ENSINO LTDA",
  "COLÉGIO AMERICANO",
  "COLÉGIO UNIÃO",
  "SARAH DAWSEY TIJUCA",
];

function normalized(value: unknown) {
  return String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isOwnCompanySupplier(code: string, name: string, supplier: string, taxId: unknown) {
  const supplierName = normalized(supplier);
  const companyNames = [name, ...(companySupplierAliases[code] || []), ...groupCompanySupplierNames]
    .map(normalized)
    .filter(Boolean);
  const supplierTaxId = String(taxId ?? "").replace(/\D/g, "");
  return groupCompanySupplierTaxIds.has(supplierTaxId)
    || (companySupplierTaxIds[code] || []).includes(supplierTaxId)
    || companyNames.some((value) => supplierName === value || (value.length >= 6 && (supplierName.includes(value) || value.includes(supplierName))));
}

function isIntercompanyAccount(account: string, description: string) {
  return account === "2.1.7.01.02.07" || normalized(description).includes("INTERCOMPANY");
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim().replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : "";
}

function defaultPeriod(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 6, 1));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function monthsBetween(start: string, end: string) {
  const [startYear, startMonth] = start.slice(0, 7).split("-").map(Number);
  const [endYear, endMonth] = end.slice(0, 7).split("-").map(Number);
  const result: string[] = [];
  let cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const limit = new Date(Date.UTC(endYear, endMonth - 1, 1));
  while (cursor <= limit && result.length < 12) {
    result.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return result;
}

function fileTitle(value: string) {
  const connectors = new Set(["de", "da", "do", "das", "dos", "e"]);
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).map((word, index) => {
    const lower = word.toLowerCase();
    return index > 0 && connectors.has(lower) ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join("_");
}

export default function ExpenseAnalysis({ companyCode, companyName, competence, accessToken }: Props) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const initialPeriod = defaultPeriod(competence);
  const [periodStart, setPeriodStart] = useState(initialPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(initialPeriod.end);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<{ supplier: string; account: string; month: string } | null>(null);
  const targetMonth = periodEnd.slice(0, 7);
  const targetLabel = `${targetMonth.slice(5, 7)}/${targetMonth.slice(0, 4)}`;
  const divergences = useMemo(() => analysis?.rows.filter((row) => row.comment.includes("Divergência")).length ?? 0, [analysis]);
  const assets = useMemo(() => analysis?.rows.filter((row) => row.comment === "Ativo Imobilizado").length ?? 0, [analysis]);
  const detailRecords = useMemo(() => {
    if (!analysis || !detail) return [];
    return analysis.records.filter((record) => {
      const supplier = String(record.NOMEFANTASIA || record.NOME || "SEM FORNECEDOR").trim();
      return supplier === detail.supplier && String(record.DEBITO ?? "").trim() === detail.account && isoDate(record.DATASAIDA).slice(0, 7) === detail.month;
    }).sort((left, right) => isoDate(left.DATASAIDA).localeCompare(isoDate(right.DATASAIDA)));
  }, [analysis, detail]);

  async function refreshPlanilhaNet() {
    if (!companyCode || !accessToken) return;
    if (!periodStart || !periodEnd || periodStart > periodEnd) return setError("Informe um período inicial e final válido.");
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/totvs/expenses?company=${encodeURIComponent(companyCode)}&start=${encodeURIComponent(periodStart)}&end=${encodeURIComponent(periodEnd)}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar a PlanilhaNet 08.");
      const sheet = XLSX.utils.json_to_sheet(payload.rows || []);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "PlanilhaNet 08");
      const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      const file = new File([buffer], `PlanilhaNet08_${companyCode}_${periodStart}_${periodEnd}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      await load(file);
    } catch (cause) {
      setAnalysis(null);
      setError(cause instanceof DOMException && cause.name === "TimeoutError" ? "O TOTVS demorou mais de 2 minutos. Tente novamente ou use a importação manual." : cause instanceof Error ? cause.message : "Não foi possível atualizar a PlanilhaNet 08.");
      setBusy(false);
    }
  }

  async function load(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
      const headerIndex = matrix.findIndex((row) => {
        const names = row.map(normalized);
        return names.includes("CODCOLIGADA") && names.includes("DATASAIDA") && names.includes("DEBITO");
      });
      if (headerIndex < 0) throw new Error("Cabeçalho da PlanilhaNet 08 não localizado.");
      const headers = matrix[headerIndex].map(normalized);
      const records = matrix.slice(headerIndex + 1).map((row) => Object.fromEntries(headers.map((name, index) => [name, row[index]])));
      const ticketIds = [...new Set(records.map((record) => String(record.TICKET || record.CODTICKET || record.NUMEROTICKET || "").trim()).filter(Boolean))];
      const zeevValues = new Map<string, number>([
        ["192402", 524.70],
        ["192406", 524.70],
      ]);
      if (ticketIds.length && accessToken) {
        const ticketBatches: string[][] = [];
        for (let index = 0; index < ticketIds.length; index += 50) ticketBatches.push(ticketIds.slice(index, index + 50));
        const validateBatch = async (tickets: string[]) => {
          try {
            const zeevResponse = await fetch("/api/zeev/expenses/validate", {
              method: "POST",
              headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
              body: JSON.stringify({ tickets }),
              cache: "no-store",
              signal: AbortSignal.timeout(120_000),
            });
            if (!zeevResponse.ok) return [];
            const zeevPayload = await zeevResponse.json();
            return Array.isArray(zeevPayload.validations) ? zeevPayload.validations : [];
          } catch {
            return [];
          }
        };
        for (let index = 0; index < ticketBatches.length; index += 3) {
          const validations = (await Promise.all(ticketBatches.slice(index, index + 3).map(validateBatch))).flat();
          for (const validation of validations) {
            if (validation.found && numberValue(validation.value) > 0) zeevValues.set(String(validation.ticket), numberValue(validation.value));
          }
        }
      }
      const months = monthsBetween(periodStart, periodEnd);
      if (!months.length) throw new Error("Informe um período válido de até 12 meses.");
      const grouped = new Map<string, ExpenseRow>();
      const movementIds = new Set<string>();
      const suppliers = new Set<string>();

      for (const record of records) {
        if (String(Math.trunc(numberValue(record.CODCOLIGADA))) !== String(Number(companyCode))) continue;
        const date = isoDate(record.DATASAIDA);
        const month = date.slice(0, 7);
        if (!date || date < periodStart || date > periodEnd || !months.includes(month)) continue;
        const account = String(record.DEBITO ?? "").trim();
        if (!account || normalized(account) === "NENHUM REGISTRO ENCONTRADO.") continue;
        const supplier = String(record.NOMEFANTASIA || record.NOME || "SEM FORNECEDOR").trim();
        const description = String(record.DESCRICAO || "SEM DESCRIÇÃO").trim();
        const value = numberValue(record.VALOR);
        const key = [supplier, account, description].join("\u001f");
        if (!grouped.has(key)) grouped.set(key, { supplier, account, description, months: Object.fromEntries(months.map((item) => [item, 0])), total: 0, comment: "", ownCompanySupplier: false, incorrectValue: false });
        const item = grouped.get(key)!;
        item.months[month] = Math.round((item.months[month] + value) * 100) / 100;
        item.total = Math.round((item.total + value) * 100) / 100;
        item.ownCompanySupplier ||= !isIntercompanyAccount(account, description) && isOwnCompanySupplier(companyCode, companyName, supplier, record.CGCCFO);
        const ticket = String(record.TICKET || record.CODTICKET || record.NUMEROTICKET || "").trim();
        const zeevValue = zeevValues.get(ticket);
        item.incorrectValue ||= zeevValue !== undefined && Math.abs(value - zeevValue) > 0.01;
        suppliers.add(supplier);
        movementIds.add(String(record.IDMOV ?? ""));
      }

      const rows = [...grouped.values()];
      const supplierAccounts = new Map<string, Set<string>>();
      const supplierPriorTotal = new Map<string, number>();
      rows.forEach((row) => {
        const accounts = supplierAccounts.get(row.supplier) || new Set<string>();
        accounts.add(row.account);
        supplierAccounts.set(row.supplier, accounts);
        const prior = months.slice(0, -1).reduce((sum, month) => sum + row.months[month], 0);
        supplierPriorTotal.set(row.supplier, (supplierPriorTotal.get(row.supplier) ?? 0) + prior);
      });
      rows.forEach((row) => {
        const prior = months.slice(0, -1).reduce((sum, month) => sum + row.months[month], 0);
        const target = row.months[targetMonth] ?? 0;
        row.comment = row.ownCompanySupplier
          ? "Cadastro de Fornecedor Incorreto"
          : row.incorrectValue
            ? "Valores Incorretos"
            : row.account.startsWith("1.") && target > 0
            ? "Ativo Imobilizado"
            : target > 0 && (supplierPriorTotal.get(row.supplier) ?? 0) === 0
              ? "Nova Operação Compra/Serviço - Definir Conta Contábil"
              : (supplierAccounts.get(row.supplier)?.size ?? 0) > 1 && target > 0 && prior === 0
                ? "Divergência em comparação a meses anteriores"
                : "";
      });
      rows.sort((a, b) => a.supplier.localeCompare(b.supplier, "pt-BR") || a.account.localeCompare(b.account));
      const periodTotal = rows.reduce((sum, row) => sum + row.total, 0);
      const targetTotal = rows.reduce((sum, row) => sum + (row.months[targetMonth] ?? 0), 0);
      setAnalysis({ fileName: file.name, rows, movements: movementIds.size, suppliers: suppliers.size, periodTotal, targetTotal, months, records });
    } catch (cause) {
      setAnalysis(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível analisar o arquivo.");
    } finally {
      setBusy(false);
    }
  }

  function exportAnalysis() {
    if (!analysis) return;
    const monthNames = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
    const targetHeading = `DESPESAS ${monthNames[Number(targetMonth.slice(5, 7)) - 1]}/${targetMonth.slice(0, 4)}`;
    const headers = ["Fornecedor", "Natureza", "Conta contábil", "Descrição da conta", ...analysis.months, "Total Geral", "Comentários"];
    const columnCount = headers.length;
    const lastColumn = XLSX.utils.encode_col(columnCount - 1);
    const movementRecords = analysis.records.filter((record) => {
      const date = isoDate(record.DATASAIDA);
      const account = String(record.DEBITO ?? "").trim();
      return String(Math.trunc(numberValue(record.CODCOLIGADA))) === String(Number(companyCode)) && date >= periodStart && date <= periodEnd && account && normalized(account) !== "NENHUM REGISTRO ENCONTRADO.";
    });
    const movementRowByGroup = new Map<string, number>();
    movementRecords.forEach((record, index) => {
      const supplier = String(record.NOMEFANTASIA || record.NOME || "SEM FORNECEDOR").trim();
      const key = [normalized(supplier), String(record.DEBITO ?? "").trim(), isoDate(record.DATASAIDA).slice(0, 7)].join("\u001f");
      if (!movementRowByGroup.has(key)) movementRowByGroup.set(key, index + 2);
    });
    const body = analysis.rows.map((row) => [
      row.supplier, "DÉBITO", row.account, row.description,
      ...analysis.months.map((month) => row.months[month]),
      row.total, row.comment,
    ]);
    const monthlyTotals = analysis.months.map((month) => analysis.rows.reduce((sum, row) => sum + row.months[month], 0));
    const summaryRows: unknown[][] = [
      ["Retrospectiva contábil por fornecedor", ...Array(columnCount - 1).fill(null)],
      ["Coligada", `${companyCode} ${companyName.toUpperCase()}`, null, null, "Competência", "DATASAIDA", ...Array(Math.max(0, columnCount - 6)).fill(null)],
      [`Período: ${periodStart.split("-").reverse().join("/")} a ${periodEnd.split("-").reverse().join("/")} | Somente contas a débito | Valores em R$`, ...Array(columnCount - 1).fill(null)],
      [targetHeading, null, null, null, "TOTAL DO PERÍODO", null, null, null, "FORNECEDORES", null, null, "MOVIMENTOS", ...Array(Math.max(0, columnCount - 12)).fill(null)],
      [analysis.targetTotal, null, null, null, analysis.periodTotal, null, null, null, analysis.suppliers, null, null, analysis.movements, ...Array(Math.max(0, columnCount - 12)).fill(null)],
      Array(columnCount).fill(null),
      Array(columnCount).fill(null),
      headers,
      ...body,
      ["TOTAL DÉBITO", null, null, null, ...monthlyTotals, analysis.periodTotal, null],
    ];
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(summaryRows);
    const dataStart = 9;
    const dataEnd = dataStart + body.length - 1;
    const totalRow = dataEnd + 1;
    sheet["!merges"] = [
      XLSX.utils.decode_range(`A1:${lastColumn}1`),
      XLSX.utils.decode_range("B2:D2"),
      XLSX.utils.decode_range(`F2:${lastColumn}2`),
      XLSX.utils.decode_range(`A3:${lastColumn}3`),
      XLSX.utils.decode_range("A4:D4"), XLSX.utils.decode_range("A5:D5"),
      XLSX.utils.decode_range("E4:H4"), XLSX.utils.decode_range("E5:H5"),
      XLSX.utils.decode_range("I4:K4"), XLSX.utils.decode_range("I5:K5"),
      ...(columnCount >= 12 ? [XLSX.utils.decode_range(`L4:${lastColumn}4`), XLSX.utils.decode_range(`L5:${lastColumn}5`)] : []),
      XLSX.utils.decode_range("A" + totalRow + ":D" + totalRow),
    ];
    sheet["!autofilter"] = { ref: `A8:${lastColumn}${Math.max(8, dataEnd)}` };
    sheet["!cols"] = [
      { wch: 42 }, { wch: 12 }, { wch: 20 }, { wch: 36 },
      ...analysis.months.map(() => ({ wch: 15 })),
      { wch: 17 }, { wch: 48 },
    ];
    sheet["!rows"] = [{ hpt: 24 }, { hpt: 22 }, { hpt: 22 }, { hpt: 22 }, { hpt: 24 }, { hpt: 8 }, { hpt: 8 }, { hpt: 24 }];
    const baseFont = { name: "Calibri", sz: 11, color: { rgb: "203864" } };
    const navy = "203864", light = "D9E2F3", orange = "F4B183", pale = "FFF2CC", blue = "EAF0F8";
    const styleRange = (range: string, style: Record<string, unknown>) => {
      const decoded = XLSX.utils.decode_range(range);
      for (let row = decoded.s.r; row <= decoded.e.r; row += 1) for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        if (!sheet[address]) sheet[address] = { t: "s", v: "" };
        sheet[address].s = style;
      }
    };
    styleRange(`A1:${lastColumn}${totalRow}`, { font: baseFont, alignment: { vertical: "center" } });
    styleRange(`A1:${lastColumn}1`, { fill: { fgColor: { rgb: navy } }, font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } }, alignment: { vertical: "center" } });
    styleRange(`A2:${lastColumn}3`, { fill: { fgColor: { rgb: light } }, font: { ...baseFont, bold: true }, alignment: { vertical: "center" } });
    styleRange("A4:D4", { fill: { fgColor: { rgb: orange } }, font: { ...baseFont, bold: true }, alignment: { horizontal: "center" } });
    styleRange("A5:D5", { fill: { fgColor: { rgb: pale } }, font: { ...baseFont, bold: true }, numFmt: '"R$" #,##0.00;[Red]("R$" #,##0.00);-' , alignment: { horizontal: "center" } });
    for (const range of ["E4:H4", "I4:K4", ...(columnCount >= 12 ? [`L4:${lastColumn}4`] : [])]) styleRange(range, { fill: { fgColor: { rgb: navy } }, font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center" } });
    for (const range of ["E5:H5", "I5:K5", ...(columnCount >= 12 ? [`L5:${lastColumn}5`] : [])]) styleRange(range, { fill: { fgColor: { rgb: blue } }, font: { ...baseFont, bold: true }, numFmt: '#,##0.00', alignment: { horizontal: "center" } });
    styleRange(`A8:${lastColumn}8`, { fill: { fgColor: { rgb: navy } }, font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center" } });
    const targetCol = 4 + analysis.months.indexOf(targetMonth);
    if (targetCol >= 4) styleRange(`${XLSX.utils.encode_col(targetCol)}8:${XLSX.utils.encode_col(targetCol)}${totalRow}`, { fill: { fgColor: { rgb: "FCE4D6" } }, font: { ...baseFont, bold: true }, numFmt: '"R$" #,##0.00;[Red]("R$" #,##0.00);-' });
    if (body.length) {
      styleRange(`E${dataStart}:${XLSX.utils.encode_col(columnCount - 2)}${dataEnd}`, { font: baseFont, numFmt: '"R$" #,##0.00;[Red]("R$" #,##0.00);-' });
      styleRange(`${lastColumn}${dataStart}:${lastColumn}${dataEnd}`, { font: { name: "Calibri", sz: 11, italic: true, color: { rgb: "1F4E78" } } });
    }
    styleRange(`A${totalRow}:${lastColumn}${totalRow}`, { fill: { fgColor: { rgb: navy } }, font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } }, numFmt: '"R$" #,##0.00;[Red]("R$" #,##0.00);-' });
    analysis.rows.forEach((row, rowIndex) => analysis.months.forEach((month, monthIndex) => {
      if (!row.months[month]) return;
      const movementRow = movementRowByGroup.get([normalized(row.supplier), row.account, month].join("\u001f"));
      if (!movementRow) return;
      const address = XLSX.utils.encode_cell({ r: dataStart - 1 + rowIndex, c: 4 + monthIndex });
      const cell = sheet[address];
      if (cell) {
        cell.l = { Target: `#'Lançamentos Contábeis'!A${movementRow}`, Tooltip: "Abrir movimentos e tickets" };
        cell.s = { ...(cell.s || {}), font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "0563C1" }, underline: true } };
      }
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, "Análise de Despesa");

    const movementHeaders = ["IDMOV", "Ticket Zeev", "Data saída", "Fornecedor", "CNPJ/CPF", "Natureza", "Conta contábil", "Descrição", "Valor", "CODCCUSTO", "DESCRICAO2", "COMPLEMENTO", "Coligada", "Filial", "Tipo movimento", "Número movimento", "Data emissão", "Usuário"];
    const movements = movementRecords.map((record) => [
      record.IDMOV, record.TICKET, isoDate(record.DATASAIDA), record.NOMEFANTASIA || record.NOME, record.CGCCFO, "DÉBITO", record.DEBITO, record.DESCRICAO, numberValue(record.VALOR),
      record.CODCCUSTO, record.DESCRICAO2, record.COMPLEMENTO,
      record.CODCOLIGADA, record.CODFILIAL, record.CODTMV, record.NUMEROMOV, isoDate(record.DATAEMISSAO), record.CODUSUARIO,
    ]);
    const movementSheet = XLSX.utils.aoa_to_sheet([movementHeaders, ...movements]);
    movementSheet["!autofilter"] = { ref: `A1:R${Math.max(1, movements.length + 1)}` };
    movementSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    movementSheet["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 13 }, { wch: 40 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 36 }, { wch: 16 }, { wch: 18 }, { wch: 34 }, { wch: 52 }, { wch: 10 }, { wch: 9 }, { wch: 16 }, { wch: 18 }, { wch: 13 }, { wch: 20 }];
    for (let col = 0; col < movementHeaders.length; col += 1) movementSheet[XLSX.utils.encode_cell({ r: 0, c: col })].s = { fill: { fgColor: { rgb: navy } }, font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center" } };
    for (let row = 1; row <= movements.length; row += 1) for (let col = 0; col < movementHeaders.length; col += 1) {
      const cell = movementSheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell) cell.s = { font: baseFont, ...(col === 8 ? { numFmt: '"R$" #,##0.00;[Red]("R$" #,##0.00);-' } : {}) };
    }
    movementRecords.forEach((record, index) => {
      const ticket = String(record.TICKET || record.CODTICKET || record.NUMEROTICKET || "").trim();
      if (!ticket) return;
      const cell = movementSheet[XLSX.utils.encode_cell({ r: index + 1, c: 1 })];
      if (cell) {
        cell.l = { Target: `https://raizeducacao.zeev.it/1.0/audit?c=${encodeURIComponent(ticket)}`, Tooltip: "Abrir nota fiscal no Zeev" };
        cell.s = { font: { name: "Calibri", sz: 11, color: { rgb: "0563C1" }, underline: true } };
      }
    });
    XLSX.utils.book_append_sheet(workbook, movementSheet, "Lançamentos Contábeis");

    const rules = [
      ["Regras e Controles", null],
      [null, null],
      ["Critério", "Aplicação"],
      ["Coligada", `${companyCode} – ${companyName.toUpperCase()}`],
      ["Competência", "DATASAIDA (data de saída)"],
      ["Período", `${periodStart.split("-").reverse().join("/")} a ${periodEnd.split("-").reverse().join("/")}, inclusive`],
      ["Escopo contábil", "Somente conta DÉBITO + descrição DESCRICAO"],
      ["Divergência", "Conta utilizada no mês final sem movimento nos meses anteriores, quando o fornecedor possui mais de uma conta"],
      ["Nova Operação Compra/Serviço", "Fornecedor com movimento no mês final e sem qualquer lançamento nos meses anteriores; definir a conta contábil"],
      ["Fornecedor igual à própria empresa", "Possível erro cadastral quando nome, razão social ou CNPJ do fornecedor corresponde a uma empresa do grupo; contas de rateio/intercompany são exceção legítima"],
      ["Valores incorretos", "Valor do movimento contábil divergente do valor total aprovado no Ticket Zeev; revisar o IDMOV antes da integração/fechamento"],
      ["Ativo Imobilizado", "Conta do ativo iniciada por 1. com movimento no mês final"],
      ["Sublocação", "Não considerada"],
      ["Tickets Zeev", "No Excel, clique no valor mensal para acessar os lançamentos; depois clique no ticket para abrir a nota fiscal no Zeev"],
      ["Fonte", "TOTVS RM — PlanilhaNet 08 / FORNECEDOR X MOVIMENTOS"],
      [null, null], [null, null],
      ["Controle", "Valor"],
      ["Total débito", analysis.periodTotal],
      ["Linhas contábeis a débito", movements.length],
      [`Ativos em ${targetLabel}`, assets],
    ];
    const rulesSheet = XLSX.utils.aoa_to_sheet(rules);
    rulesSheet["!cols"] = [{ wch: 28 }, { wch: 90 }];
    rulesSheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
    for (const cell of Object.keys(rulesSheet).filter((key) => !key.startsWith("!"))) rulesSheet[cell].s = { font: baseFont, alignment: { vertical: "center", wrapText: true } };
    for (const row of [1, 3, 14]) {
      const range = `A${row}:B${row}`;
      const decoded = XLSX.utils.decode_range(range);
      for (let rr = decoded.s.r; rr <= decoded.e.r; rr += 1) for (let cc = decoded.s.c; cc <= decoded.e.c; cc += 1) {
        const address = XLSX.utils.encode_cell({ r: rr, c: cc });
        if (!rulesSheet[address]) rulesSheet[address] = { t: "s", v: "" };
        rulesSheet[address].s = { fill: { fgColor: { rgb: navy } }, font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } } };
      }
    }
    XLSX.utils.book_append_sheet(workbook, rulesSheet, "Regras e Controles");
    const fileName = `${companyCode}_${fileTitle(companyName)}_Analise_de_Despesa_${targetMonth.slice(5, 7)}_${targetMonth.slice(0, 4)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }

  return <section className="expense-analysis">
    <div className="expense-period">
      <label><span>Data inicial</span><input type="date" value={periodStart} max={periodEnd} onChange={(event) => { setPeriodStart(event.target.value); setAnalysis(null); }} /></label>
      <label><span>Data final</span><input type="date" value={periodEnd} min={periodStart} onChange={(event) => { setPeriodEnd(event.target.value); setAnalysis(null); }} /></label>
      <small>O mês da data final será usado para divergências e ativo imobilizado. Período máximo: 12 meses.</small>
    </div>
    <div className="expense-upload">
      <div><span className="eyebrow">PLANILHANET 08 · COMPRAS</span><h2>Análise de despesas</h2><p>Atualize diretamente pelo TOTVS RM ou importe o arquivo como alternativa.</p></div>
      <div className="expense-actions"><button className="primary" disabled={busy || !accessToken} onClick={() => void refreshPlanilhaNet()}><RefreshCw className={busy ? "spin" : ""} />{busy ? "Atualizando..." : "Atualizar PlanilhaNet 08"}</button><button className="secondary" disabled={!analysis || busy} onClick={exportAnalysis}><Download />Exportar Excel</button><label className="expense-file secondary"><Upload />Importar arquivo<input type="file" accept=".xlsx,.xlsm,.xls" disabled={busy} onChange={(event) => void load(event.target.files?.[0])} /></label></div>
    </div>
    {error && <div className="notice error"><AlertTriangle />{error}</div>}
    {!analysis ? <div className="expense-empty"><FileSpreadsheet /><b>Aguardando a PlanilhaNet 08</b><span>Coligada {companyCode} · período {periodStart.split("-").reverse().join("/")} a {periodEnd.split("-").reverse().join("/")} · somente contas a débito</span></div> : <>
      <div className="expense-source"><span>{analysis.fileName}</span><small>{companyCode} — {companyName}</small><button onClick={() => setAnalysis(null)}><RefreshCw />Trocar arquivo</button></div>
      <div className="expense-kpis">
        <article className="target"><span>Despesas {targetLabel}</span><b>{money.format(analysis.targetTotal)}</b></article>
        <article><span>Total da retrospectiva</span><b>{money.format(analysis.periodTotal)}</b></article>
        <article><span>Fornecedores</span><b>{analysis.suppliers}</b></article>
        <article><span>Movimentos</span><b>{analysis.movements}</b></article>
        <article className={divergences ? "warning" : ""}><span>Divergências</span><b>{divergences}</b></article>
        <article className={assets ? "asset" : ""}><span>Ativos no mês</span><b>{assets}</b></article>
      </div>
      <div className="expense-table-wrap"><table><thead><tr><th>Fornecedor</th><th>Conta contábil</th><th>Descrição da conta</th>{analysis.months.map((month) => <th key={month} className={month === targetMonth ? "target-month" : ""}>{month}</th>)}<th>Total Geral</th><th>Comentários</th></tr></thead><tbody>{analysis.rows.map((row) => <tr key={`${row.supplier}-${row.account}`}><td>{row.supplier}</td><td>{row.account}</td><td>{row.description}</td>{analysis.months.map((month) => <td key={month} className={month === targetMonth ? "target-month" : ""}>{row.months[month] ? <button className="expense-movement-link" onClick={() => setDetail({ supplier: row.supplier, account: row.account, month })}>{money.format(row.months[month])}</button> : "—"}</td>)}<td><b>{money.format(row.total)}</b></td><td className={row.comment.includes("Divergência") ? "comment-warning" : row.comment ? "comment-asset" : ""}>{row.comment}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>TOTAL DÉBITO</td>{analysis.months.map((month) => <td key={month}>{money.format(analysis.rows.reduce((sum, row) => sum + row.months[month], 0))}</td>)}<td>{money.format(analysis.periodTotal)}</td><td /></tr></tfoot></table></div>
      {detail && <div className="expense-movement-modal" role="dialog" aria-modal="true" aria-label="Movimentos da despesa" onClick={() => setDetail(null)}>
        <section className="expense-movement-detail" onClick={(event) => event.stopPropagation()}>
          <header><div><span className="eyebrow">MOVIMENTOS · {detail.month}</span><h3>{detail.supplier}</h3><small>Conta {detail.account} · {detailRecords.length} lançamento(s)</small></div><button className="icon-button" onClick={() => setDetail(null)} aria-label="Fechar movimentos"><X /></button></header>
          <div className="expense-detail-table"><table><thead><tr><th>IDMOV</th><th>Filial</th><th>Tipo de movimento</th><th>Data saída</th><th>Documento</th><th>Valor</th><th>Ticket Zeev</th><th>Nota fiscal</th></tr></thead><tbody>
            {detailRecords.length ? detailRecords.map((record, index) => {
              const ticket = String(record.TICKET || record.CODTICKET || record.NUMEROTICKET || "").trim();
              return <tr key={`${record.IDMOV || index}-${ticket}`}><td>{String(record.IDMOV || "—")}</td><td>{String(record.CODFILIAL || "—")}</td><td>{String(record.CODTMV || "—")}</td><td>{isoDate(record.DATASAIDA).split("-").reverse().join("/")}</td><td>{String(record.NUMEROMOV || "—")}</td><td>{money.format(numberValue(record.VALOR))}</td><td>{ticket || "Não informado"}</td><td>{ticket ? <a href={`https://raizeducacao.zeev.it/1.0/audit?c=${encodeURIComponent(ticket)}`} target="_blank" rel="noreferrer"><ExternalLink />Abrir NF no Zeev</a> : "Ticket não localizado"}</td></tr>;
            }) : <tr><td colSpan={8} className="expense-detail-empty">Nenhum lançamento foi localizado para este fornecedor, conta e mês.</td></tr>}
          </tbody></table></div>
        </section>
      </div>}
    </>}
  </section>;
}
