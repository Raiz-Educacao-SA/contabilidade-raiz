export type LoanTerm = "Curto prazo" | "Longo prazo";

export type LoanAccountCandidate = {
  account: string;
  description: string;
};

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toUpperCase()
  .replace(/\s+/g, " ")
  .trim();

const loanDescriptionPatterns = [
  /\bEMPRESTIM/,
  /\bFINANCIAMENT/,
  /\bMUTUO/,
  /\bCAPITAL DE GIRO\b/,
  /\bCEDULA DE CREDITO(?: BANCARIO)?\b/,
  /\bCCB\b/,
  /\bDEBENTUR/,
  /\bDIVIDA BANCARIA\b/,
  /\bCONTRATO BANCARIO\b/,
  /\bBNDES\b/,
  /\bFINAME\b/,
];

export function classifyLoanTerm(account: string): LoanTerm | null {
  const normalizedAccount = account.trim();
  if (/^2\.1(?:\.|$)/.test(normalizedAccount)) return "Curto prazo";
  if (/^2\.(?:2|3)(?:\.|$)/.test(normalizedAccount)) return "Longo prazo";
  return null;
}

export function isLoanAccount(row: LoanAccountCandidate): boolean {
  if (!classifyLoanTerm(row.account)) return false;
  const description = normalize(row.description);

  // Parcelamentos e arrendamentos possuem módulos próprios e não devem
  // contaminar a conciliação de empréstimos.
  if (/\bPARCELAMENT/.test(description) || /\bARRENDAMENT/.test(description)) return false;

  return loanDescriptionPatterns.some((pattern) => pattern.test(description));
}
