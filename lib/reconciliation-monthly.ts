type MonthlyBankRow = { date: Date; value: number };
type MonthlyAccountingRow = { date: Date; value: number };
type MonthlyMetadata = { openingBalance: number | null; closingBalance: number | null };

export type MonthlyValidation = {
  bankCredits: number;
  bankDebits: number;
  accountingDebits: number;
  accountingCredits: number;
  entryDifference: number;
  exitDifference: number;
  bankNet: number;
  accountingNet: number;
  movementDifference: number;
  calculatedClosingBalance: number | null;
  closingBalanceDifference: number | null;
  dailyDifferences: {
    date: string;
    bankCredits: number;
    accountingDebits: number;
    entryDifference: number;
    bankDebits: number;
    accountingCredits: number;
    exitDifference: number;
    netDifference: number;
  }[];
  missingDays: { date: string; bank: number; accounting: number; difference: number }[];
  reconciled: boolean;
};

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export function validateMonthly(
  bank: MonthlyBankRow[],
  accounting: MonthlyAccountingRow[],
  metadata: MonthlyMetadata,
  tolerance = 0.01,
): MonthlyValidation {
  const round = (value: number) => Math.round(value * 100) / 100;
  const bankCredits = round(bank.filter((row) => row.value > 0).reduce((sum, row) => sum + row.value, 0));
  const bankDebits = round(-bank.filter((row) => row.value < 0).reduce((sum, row) => sum + row.value, 0));
  const accountingDebits = round(accounting.filter((row) => row.value > 0).reduce((sum, row) => sum + row.value, 0));
  const accountingCredits = round(-accounting.filter((row) => row.value < 0).reduce((sum, row) => sum + row.value, 0));
  const entryDifference = round(bankCredits - accountingDebits);
  const exitDifference = round(bankDebits - accountingCredits);
  const bankNet = round(bankCredits - bankDebits);
  const accountingNet = round(accountingDebits - accountingCredits);
  const movementDifference = round(entryDifference - exitDifference);
  const calculatedClosingBalance = metadata.openingBalance == null ? null : round(metadata.openingBalance + bankNet);
  const closingBalanceDifference = calculatedClosingBalance == null || metadata.closingBalance == null ? null : round(calculatedClosingBalance - metadata.closingBalance);
  const dates = Array.from(new Set([...bank.map((row) => dayKey(row.date)), ...accounting.map((row) => dayKey(row.date))])).sort();
  const dailyDifferences = dates.map((date) => {
    const bankRows = bank.filter((row) => dayKey(row.date) === date);
    const accountingRows = accounting.filter((row) => dayKey(row.date) === date);
    const dayBankCredits = round(bankRows.filter((row) => row.value > 0).reduce((sum, row) => sum + row.value, 0));
    const dayBankDebits = round(-bankRows.filter((row) => row.value < 0).reduce((sum, row) => sum + row.value, 0));
    const dayAccountingDebits = round(accountingRows.filter((row) => row.value > 0).reduce((sum, row) => sum + row.value, 0));
    const dayAccountingCredits = round(-accountingRows.filter((row) => row.value < 0).reduce((sum, row) => sum + row.value, 0));
    const dayEntryDifference = round(dayBankCredits - dayAccountingDebits);
    const dayExitDifference = round(dayBankDebits - dayAccountingCredits);
    return {
      date,
      bankCredits: dayBankCredits,
      accountingDebits: dayAccountingDebits,
      entryDifference: dayEntryDifference,
      bankDebits: dayBankDebits,
      accountingCredits: dayAccountingCredits,
      exitDifference: dayExitDifference,
      netDifference: round(dayEntryDifference - dayExitDifference),
    };
  }).filter((row) => Math.abs(row.netDifference) > tolerance);
  const missingDays = dailyDifferences.map((row) => ({
    date: row.date,
    bank: round(row.bankCredits - row.bankDebits),
    accounting: round(row.accountingDebits - row.accountingCredits),
    difference: row.netDifference,
  }));

  return {
    bankCredits, bankDebits, accountingDebits, accountingCredits,
    entryDifference, exitDifference,
    bankNet, accountingNet, movementDifference,
    calculatedClosingBalance, closingBalanceDifference, missingDays,
    dailyDifferences,
    reconciled: Math.abs(movementDifference) <= tolerance,
  };
}
