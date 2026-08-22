export type MatcherBankRow = {
  id: string;
  date: Date;
  description: string;
  value: number;
};

export type MatcherAccountingRow = {
  id: string;
  date: Date;
  value: number;
  nature: string;
};

export type MatcherRow = {
  status: "Conciliado" | "Possível conciliação" | "Somente no banco" | "Somente na contabilidade";
  bankId?: string;
  bankDate?: Date;
  description?: string;
  bankValue?: number;
  accountingId?: string;
  accountingDate?: Date;
  nature?: string;
  accountingValue?: number;
  days?: number;
  difference?: number;
};

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const daysBetween = (a: Date, b: Date) => Math.round(Math.abs(a.getTime() - b.getTime()) / 86400000);

export function reconcileMovements(
  bank: MatcherBankRow[],
  accounting: MatcherAccountingRow[],
  toleranceValue = 0.01,
) {
  const usedBank = new Set<number>(), usedAccounting = new Set<number>();
  const matches: MatcherRow[] = [];
  const match = (exactDate: boolean) => bank.forEach((b, bi) => {
    if (usedBank.has(bi)) return;
    const candidates = accounting.map((a, ai) => ({ a, ai, days: daysBetween(a.date, b.date) })).filter(({ a, ai }) => !usedAccounting.has(ai) && Math.abs(a.value - b.value) <= toleranceValue && (exactDate ? dayKey(a.date) === dayKey(b.date) : monthKey(a.date) === monthKey(b.date))).sort((x, y) => x.days - y.days);
    if (!candidates.length) return;
    const { a, ai, days } = candidates[0]; usedBank.add(bi); usedAccounting.add(ai);
    matches.push({ status: exactDate ? "Conciliado" : "Possível conciliação", bankId: b.id, bankDate: b.date, description: b.description, bankValue: b.value, accountingId: a.id, accountingDate: a.date, nature: a.nature, accountingValue: a.value, days, difference: Math.round((b.value - a.value) * 100) / 100 });
  });
  const matchDailyGroups = () => {
    const dates = Array.from(new Set([
      ...bank.filter((_, index) => !usedBank.has(index)).map((row) => dayKey(row.date)),
      ...accounting.filter((_, index) => !usedAccounting.has(index)).map((row) => dayKey(row.date)),
    ])).sort();
    for (const date of dates) {
      for (const sign of [1, -1]) {
        const bankIndexes = bank.flatMap((row, index) =>
          !usedBank.has(index) && dayKey(row.date) === date && Math.sign(row.value) === sign ? [index] : [],
        );
        const accountingIndexes = accounting.flatMap((row, index) =>
          !usedAccounting.has(index) && dayKey(row.date) === date && Math.sign(row.value) === sign ? [index] : [],
        );
        if (!bankIndexes.length || !accountingIndexes.length) continue;
        const bankValue = bankIndexes.reduce((sum, index) => sum + bank[index].value, 0);
        const accountingValue = accountingIndexes.reduce((sum, index) => sum + accounting[index].value, 0);
        if (Math.abs(bankValue - accountingValue) > toleranceValue) continue;
        bankIndexes.forEach((index) => usedBank.add(index));
        accountingIndexes.forEach((index) => usedAccounting.add(index));
        matches.push({
          status: "Conciliado",
          bankId: `BANCO-AGRUPADO-${date}-${sign}`,
          bankDate: bank[bankIndexes[0]].date,
          description: `Total diário agrupado — ${bankIndexes.length} movimento(s) no extrato`,
          bankValue: Math.round(bankValue * 100) / 100,
          accountingId: `CONTABIL-AGRUPADO-${date}-${sign}`,
          accountingDate: accounting[accountingIndexes[0]].date,
          nature: `Total diário de ${accountingIndexes.length} lançamento(s) contábil(eis)`,
          accountingValue: Math.round(accountingValue * 100) / 100,
          days: 0,
          difference: Math.round((bankValue - accountingValue) * 100) / 100,
        });
      }
    }
  };
  const matchMonthlyGroups = () => {
    const months = Array.from(new Set([
      ...bank.filter((_, index) => !usedBank.has(index)).map((row) => monthKey(row.date)),
      ...accounting.filter((_, index) => !usedAccounting.has(index)).map((row) => monthKey(row.date)),
    ])).sort();
    for (const month of months) {
      for (const sign of [1, -1]) {
        const bankIndexes = bank.flatMap((row, index) =>
          !usedBank.has(index) && monthKey(row.date) === month && Math.sign(row.value) === sign ? [index] : [],
        );
        const accountingIndexes = accounting.flatMap((row, index) =>
          !usedAccounting.has(index) && monthKey(row.date) === month && Math.sign(row.value) === sign ? [index] : [],
        );
        if (!bankIndexes.length || !accountingIndexes.length) continue;
        const bankValue = bankIndexes.reduce((sum, index) => sum + bank[index].value, 0);
        const accountingValue = accountingIndexes.reduce((sum, index) => sum + accounting[index].value, 0);
        if (Math.abs(bankValue - accountingValue) > toleranceValue) continue;
        bankIndexes.forEach((index) => usedBank.add(index));
        accountingIndexes.forEach((index) => usedAccounting.add(index));
        matches.push({
          status: "Conciliado",
          bankId: `BANCO-AGRUPADO-MENSAL-${month}-${sign}`,
          bankDate: bank[bankIndexes[0]].date,
          description: `Total mensal agrupado — ${bankIndexes.length} movimento(s) no extrato`,
          bankValue: Math.round(bankValue * 100) / 100,
          accountingId: `CONTABIL-AGRUPADO-MENSAL-${month}-${sign}`,
          accountingDate: accounting[accountingIndexes[0]].date,
          nature: `Total mensal de ${accountingIndexes.length} lançamento(s) contábil(eis)`,
          accountingValue: Math.round(accountingValue * 100) / 100,
          days: 0,
          difference: Math.round((bankValue - accountingValue) * 100) / 100,
        });
      }
    }
  };
  match(true);
  matchDailyGroups();
  match(false);
  matchMonthlyGroups();
  bank.forEach((b, index) => { if (!usedBank.has(index)) matches.push({ status: "Somente no banco", bankId: b.id, bankDate: b.date, description: b.description, bankValue: b.value }); });
  accounting.forEach((a, index) => { if (!usedAccounting.has(index)) matches.push({ status: "Somente na contabilidade", accountingId: a.id, accountingDate: a.date, nature: a.nature, accountingValue: a.value }); });
  return matches;
}
