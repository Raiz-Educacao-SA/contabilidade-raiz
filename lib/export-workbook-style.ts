import * as XLSX from "xlsx";

type StyledCell = XLSX.CellObject & { s?: unknown };

const colors = {
  navy: "14213D",
  blue: "2F80C0",
  orange: "F28C00",
  paleBlue: "EAF3FC",
  paleOrange: "FFF4E5",
  white: "FFFFFF",
  border: "D9E2EF",
  darkText: "0B1B35",
};

const border = {
  top: { style: "thin", color: { rgb: colors.border } },
  bottom: { style: "thin", color: { rgb: colors.border } },
  left: { style: "thin", color: { rgb: colors.border } },
  right: { style: "thin", color: { rgb: colors.border } },
};

const titleStyle = {
  fill: { fgColor: { rgb: colors.navy } },
  font: { color: { rgb: colors.white }, bold: true, sz: 14 },
  alignment: { horizontal: "center", vertical: "center" },
  border,
};

const sectionStyle = {
  fill: { fgColor: { rgb: colors.blue } },
  font: { color: { rgb: colors.white }, bold: true },
  alignment: { horizontal: "center", vertical: "center" },
  border,
};

const headerStyle = {
  fill: { fgColor: { rgb: colors.navy } },
  font: { color: { rgb: colors.white }, bold: true },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border,
};

const labelStyle = {
  fill: { fgColor: { rgb: colors.paleBlue } },
  font: { color: { rgb: colors.darkText }, bold: true },
  border,
};

const dataStyle = {
  font: { color: { rgb: colors.darkText } },
  alignment: { vertical: "center", wrapText: true },
  border,
};

const moneyFormat = 'R$ #,##0.00;[Red]-R$ #,##0.00';
const percentFormat = "0.00%";

function cell(worksheet: XLSX.WorkSheet, row: number, column: number) {
  return worksheet[XLSX.utils.encode_cell({ r: row, c: column })] as StyledCell | undefined;
}

function cellText(worksheet: XLSX.WorkSheet, row: number, column: number) {
  const value = cell(worksheet, row, column)?.v;
  return value == null ? "" : String(value);
}

function setStyle(worksheet: XLSX.WorkSheet, row: number, column: number, style: unknown) {
  const current = cell(worksheet, row, column);
  if (current) current.s = style;
}

function filledColumns(worksheet: XLSX.WorkSheet, row: number, start: number, end: number) {
  const columns: number[] = [];
  for (let column = start; column <= end; column += 1) {
    if (cellText(worksheet, row, column).trim()) columns.push(column);
  }
  return columns;
}

function isHeaderRow(worksheet: XLSX.WorkSheet, row: number, start: number, end: number) {
  const filled = filledColumns(worksheet, row, start, end);
  if (row === 0 && filled.length >= 1) return true;
  if (filled.length < 2) return false;
  const joined = filled.map((column) => cellText(worksheet, row, column).toLowerCase()).join(" ");
  return /(compet[eê]ncia|coligada|empresa|conta|descri[cç][aã]o|indicador|valor|saldo|base|pis|cofins|receita|desconto|diferen[cç]a|status|filial|data|documento)/i.test(joined);
}

function isSectionRow(worksheet: XLSX.WorkSheet, row: number, start: number, end: number) {
  const filled = filledColumns(worksheet, row, start, end);
  if (filled.length !== 1) return false;
  const text = cellText(worksheet, row, filled[0]);
  return text.length > 5 && text === text.toUpperCase();
}

function shouldUseMoneyFormat(header: string) {
  return /(valor|saldo|base|pis|cofins|receita|desconto|d[eé]bito|cr[eé]dito|movimento|ajuste|rateio|faturamento|custo|total|diferen[cç]a)/i.test(header);
}

function shouldUsePercentFormat(header: string) {
  return /(percentual|participa[cç][aã]o|taxa|%)/i.test(header);
}

function formatColumns(worksheet: XLSX.WorkSheet, range: XLSX.Range) {
  const headers = new Map<number, string>();
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 8); row += 1) {
      const value = cellText(worksheet, row, column);
      if (value && isHeaderRow(worksheet, row, range.s.c, range.e.c)) {
        headers.set(column, value);
      }
    }
  }

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const current = cell(worksheet, row, column);
      if (!current) continue;
      if (!current.s) current.s = dataStyle;
      const header = headers.get(column) || "";
      if (current.t === "n" && shouldUseMoneyFormat(header)) current.z = moneyFormat;
      if (current.t === "n" && shouldUsePercentFormat(header)) current.z = percentFormat;
    }
  }
}

function fitColumns(worksheet: XLSX.WorkSheet, range: XLSX.Range) {
  const widths = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    let width = 10;
    for (let row = range.s.r; row <= Math.min(range.e.r, 250); row += 1) {
      const text = cellText(worksheet, row, column);
      if (text) width = Math.max(width, Math.min(42, text.length + 2));
    }
    widths.push({ wch: width });
  }
  worksheet["!cols"] = widths;
}

export function applyRaizWorkbookStyle(workbook: XLSX.WorkBook) {
  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const ref = worksheet["!ref"];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);

    for (let row = range.s.r; row <= range.e.r; row += 1) {
      if (isHeaderRow(worksheet, row, range.s.c, range.e.c)) {
        for (let column = range.s.c; column <= range.e.c; column += 1) {
          setStyle(worksheet, row, column, row === 0 ? titleStyle : headerStyle);
        }
      } else if (isSectionRow(worksheet, row, range.s.c, range.e.c)) {
        for (let column = range.s.c; column <= range.e.c; column += 1) {
          setStyle(worksheet, row, column, sectionStyle);
        }
      } else {
        setStyle(worksheet, row, range.s.c, labelStyle);
      }
    }

    formatColumns(worksheet, range);
    fitColumns(worksheet, range);
    worksheet["!rows"] = Array.from({ length: range.e.r + 1 }, (_, index) => ({ hpt: index === 0 ? 24 : 18 }));
    worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: range.s.r, c: range.s.c }, e: { r: range.s.r, c: range.e.c } }) };
  });
}
