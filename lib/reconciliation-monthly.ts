type MonthlyBankRow = { date: Date; value: number };
type MonthlyAccountingRow = { date: Date; value: number };
type MonthlyMetadata = { openingBalance: number | null; closingBalance: number | null };

export type MonthlyDailyDifference = {
  date: string;
  bankCredits: number;
  accountingDebits: number;
  entryDifference: number;
  bankDebits: number;
  accountingCredits: number;
  exitDifference: number;
  netDifference: number;
};

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
  dailyDifferences: MonthlyDailyDifference[];
  missingDays: { date: string; bank: number; accounting: number; difference: number }[];
  reconciled: boolean;
};

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export function selectMonthlyDifferenceDays(
  rows: MonthlyDailyDifference[],
  monthlyDifference: number,
  tolerance = 0.01,
) {
  if (rows.length <= 1 || rows.length > 31) return rows;
  const values = rows.map((row) => Math.round(row.netDifference * 100));
  const target = Math.round(monthlyDifference * 100);
  const toleranceInCents = Math.max(0, Math.round(tolerance * 100));
  const split = Math.floor(rows.length / 2);
  const leftValues = values.slice(0, split);
  const rightValues = values.slice(split);

  const enumerate = (items: number[]) => {
    const size = 1 << items.length;
    const sums = new Float64Array(size);
    const counts = new Uint8Array(size);
    for (let mask = 1; mask < size; mask += 1) {
      const bit = mask & -mask;
      const index = 31 - Math.clz32(bit);
      const previous = mask ^ bit;
      sums[mask] = sums[previous] + items[index];
      counts[mask] = counts[previous] + 1;
    }
    return { counts, sums };
  };

  const left = enumerate(leftValues);
  const right = enumerate(rightValues);
  const bestRightBySum = new Map<number, { count: number; mask: number }>();
  for (let mask = 0; mask < right.sums.length; mask += 1) {
    const sum = right.sums[mask];
    const current = bestRightBySum.get(sum);
    if (!current || right.counts[mask] < current.count) {
      bestRightBySum.set(sum, { count: right.counts[mask], mask });
    }
  }

  let bestCount = rows.length;
  let bestLeftMask = (1 << leftValues.length) - 1;
  let bestRightMask = (1 << rightValues.length) - 1;
  for (let leftMask = 0; leftMask < left.sums.length; leftMask += 1) {
    if (left.counts[leftMask] >= bestCount) continue;
    const needed = target - left.sums[leftMask];
    for (let offset = -toleranceInCents; offset <= toleranceInCents; offset += 1) {
      const rightMatch = bestRightBySum.get(needed + offset);
      if (!rightMatch) continue;
      const count = left.counts[leftMask] + rightMatch.count;
      if (count < bestCount) {
        bestCount = count;
        bestLeftMask = leftMask;
        bestRightMask = rightMatch.mask;
      }
    }
  }

  return rows.filter((_, index) =>
    index < split
      ? Boolean(bestLeftMask & (1 << index))
      : Boolean(bestRightMask & (1 << (index - split))),
  );
}

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
