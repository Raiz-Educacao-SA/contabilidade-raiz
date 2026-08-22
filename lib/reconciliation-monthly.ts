type MonthlyBankRow = { date: Date; value: number };
type MonthlyAccountingRow = { date: Date; value: number };
type MonthlyMetadata = { openingBalance: number | null; closingBalance: number | null };

export type MonthlyValidation = {
  bankCredits: number;
  bankDebits: number;
  accountingDebits: number;
  accountingCredits: number;
  bankNet: number;
  accountingNet: number;
  movementDifference: number;
  calculatedClosingBalance: number | null;
  closingBalanceDifference: number | null;
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
  const bankNet = round(bankCredits - bankDebits);
  const accountingNet = round(accountingDebits - accountingCredits);
  const movementDifference = round(bankNet - accountingNet);
  const calculatedClosingBalance = metadata.openingBalance == null ? null : round(metadata.openingBalance + bankNet);
  const closingBalanceDifference = calculatedClosingBalance == null || metadata.closingBalance == null ? null : round(calculatedClosingBalance - metadata.closingBalance);
  const dates = Array.from(new Set([...bank.map((row) => dayKey(row.date)), ...accounting.map((row) => dayKey(row.date))])).sort();
  const missingDays = dates.map((date) => {
    const bankValue = round(bank.filter((row) => dayKey(row.date) === date).reduce((sum, row) => sum + row.value, 0));
    const accountingValue = round(accounting.filter((row) => dayKey(row.date) === date).reduce((sum, row) => sum + row.value, 0));
    return { date, bank: bankValue, accounting: accountingValue, difference: round(bankValue - accountingValue) };
  }).filter((row) => Math.abs(row.difference) > tolerance);

  return {
    bankCredits, bankDebits, accountingDebits, accountingCredits,
    bankNet, accountingNet, movementDifference,
    calculatedClosingBalance, closingBalanceDifference, missingDays,
    reconciled: Math.abs(movementDifference) <= tolerance,
  };
}
