export type DepreciationInput = {
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  acquisitionDate: string;
  referenceDate: string;
  disposalDate?: string | null;
  startsNextMonth?: boolean;
};

export type DepreciationResult = {
  depreciableBase: number;
  monthlyQuota: number;
  depreciatedMonths: number;
  accumulatedDepreciation: number;
  bookValue: number;
  fullyDepreciated: boolean;
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function parseDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Data inválida: ${value}`);
  return date;
}

function monthIndex(date: Date) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function calculateStraightLineDepreciation(input: DepreciationInput): DepreciationResult {
  if (input.cost < 0) throw new Error("O custo não pode ser negativo.");
  if (input.residualValue < 0 || input.residualValue > input.cost) {
    throw new Error("O valor residual deve estar entre zero e o custo do bem.");
  }
  if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths <= 0) {
    throw new Error("A vida útil deve ser informada em meses inteiros positivos.");
  }

  const acquisition = parseDate(input.acquisitionDate);
  const reference = parseDate(input.referenceDate);
  const disposal = input.disposalDate ? parseDate(input.disposalDate) : null;
  const effectiveEnd = disposal && disposal < reference ? disposal : reference;
  const startOffset = input.startsNextMonth === false ? 0 : 1;
  const elapsed = monthIndex(effectiveEnd) - monthIndex(acquisition) - startOffset + 1;
  const depreciatedMonths = Math.max(0, Math.min(input.usefulLifeMonths, elapsed));
  const depreciableBase = cents(input.cost - input.residualValue);
  const monthlyQuota = cents(depreciableBase / input.usefulLifeMonths);
  const accumulatedDepreciation = cents(
    Math.min(depreciableBase, (depreciableBase / input.usefulLifeMonths) * depreciatedMonths),
  );
  const bookValue = cents(input.cost - accumulatedDepreciation);

  return {
    depreciableBase,
    monthlyQuota,
    depreciatedMonths,
    accumulatedDepreciation,
    bookValue,
    fullyDepreciated: depreciatedMonths >= input.usefulLifeMonths,
  };
}

export type ReconciliationValues = {
  control: number;
  ledger: number;
  trialBalance: number;
};

export function reconcileFixedAssetBalances(values: ReconciliationValues, tolerance = 0.01) {
  const controlVsLedger = cents(values.control - values.ledger);
  const ledgerVsTrialBalance = cents(values.ledger - values.trialBalance);
  return {
    controlVsLedger,
    ledgerVsTrialBalance,
    reconciled:
      Math.abs(controlVsLedger) <= tolerance && Math.abs(ledgerVsTrialBalance) <= tolerance,
  };
}
