export type TotvsAccountingDiagnostic = {
  account: string;
  accountName: string;
  cashCode: string;
  date: string;
  debitDifference: number;
  creditDifference: number;
};

type DiagnosticRecord = {
  CODCONTA?: string;
  DESCRICAO?: string;
  CODCXA?: string;
  DATACOMPENSACAO?: string;
  DIF_DEB?: string;
  DIF_CRED?: string;
};

export const totvsNumber = (value?: string) => {
  const normalized = String(value || "0").trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function collectTotvsAccountingDiagnostics(
  records: DiagnosticRecord[],
  tolerance = 0.004,
): TotvsAccountingDiagnostic[] {
  return records.flatMap((record) => {
    const debitDifference = totvsNumber(record.DIF_DEB);
    const creditDifference = totvsNumber(record.DIF_CRED);
    if (
      Math.abs(debitDifference) <= tolerance &&
      Math.abs(creditDifference) <= tolerance
    ) return [];
    return [{
      account: record.CODCONTA || "",
      accountName: record.DESCRICAO || record.CODCONTA || "Conta bancária",
      cashCode: record.CODCXA || "",
      date: record.DATACOMPENSACAO || "",
      debitDifference,
      creditDifference,
    }];
  });
}
