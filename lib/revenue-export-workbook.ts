import XLSX from "xlsx-js-style";

type CellStyle = {
  fill?: { fgColor?: { rgb: string } };
  font?: {
    name?: string;
    sz?: number;
    bold?: boolean;
    color?: { rgb: string };
  };
  alignment?: {
    horizontal?: string;
    vertical?: string;
    wrapText?: boolean;
  };
  border?: Record<string, unknown>;
};

type StyledCell = XLSX.CellObject & { s?: CellStyle };

const colors = {
  navy: "14213D",
  white: "FFFFFF",
  black: "000000",
  border: "D9E2EF",
};

const border = {
  top: { style: "thin", color: { rgb: colors.border } },
  bottom: { style: "thin", color: { rgb: colors.border } },
  left: { style: "thin", color: { rgb: colors.border } },
  right: { style: "thin", color: { rgb: colors.border } },
};

const firstRowStyle: CellStyle = {
  fill: { fgColor: { rgb: colors.navy } },
  font: { name: "Arial", sz: 10, bold: true, color: { rgb: colors.white } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border,
};

const plainStyle: CellStyle = {
  font: { name: "Arial", sz: 10, color: { rgb: colors.black } },
  alignment: { vertical: "center", wrapText: true },
  border,
};

const plainBoldStyle: CellStyle = {
  ...plainStyle,
  font: { name: "Arial", sz: 10, bold: true, color: { rgb: colors.black } },
};

const dashboardBoldRows = new Set([3, 6, 7, 12, 13, 19, 20]);

function shouldUseBoldPlainStyle(sheetName: string, row: number) {
  return (sheetName === "Dashboard" && dashboardBoldRows.has(row))
    || (sheetName === "Auditoria" && row === 1);
}

export function applyRevenueWorkbookStyle(workbook: XLSX.WorkBook) {
  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const reference = worksheet["!ref"];
    if (!reference) return;

    const range = XLSX.utils.decode_range(reference);
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        const current = worksheet[address] as StyledCell | undefined;
        if (!current) continue;

        current.s = row === 0
          ? firstRowStyle
          : shouldUseBoldPlainStyle(sheetName, row)
            ? plainBoldStyle
            : plainStyle;
      }
    }

    worksheet["!rows"] = Array.from(
      { length: range.e.r + 1 },
      (_, row) => ({ hpt: row === 0 ? 24 : 18 }),
    );
    worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    if (sheetName !== "Dashboard" && sheetName !== "Auditoria") {
      worksheet["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: range.s.c },
          e: { r: 0, c: range.e.c },
        }),
      };
    } else {
      delete worksheet["!autofilter"];
    }
  });
}

export function compactRevenueBar(percent: number) {
  const safe = Math.max(0, Math.min(100, percent));
  const filled = Math.round(safe / 5);
  return `${"█".repeat(filled)}${"░".repeat(20 - filled)} ${safe.toFixed(1).replace(".", ",")}%`;
}
