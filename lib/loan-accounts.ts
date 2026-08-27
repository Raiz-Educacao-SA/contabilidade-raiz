export type LoanTerm = "Curto prazo" | "Longo prazo" | "Juros";

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

const excludedLoanDescriptionPatterns = [
  /\bEMPRESTIMOS BANCARIOS CONSIGNADO A PAGAR\b/,
  /\bEMPRESTIMO YURI BARBEITO\b/,
];

const loanInterestPattern = /(?:\bJUROS\b|\bENCARGOS FINANCEIROS\b).*\b(?:EMPRESTIM|FINANCIAMENT)|\b(?:EMPRESTIM|FINANCIAMENT).*(?:\bJUROS\b|\bENCARGOS FINANCEIROS\b)/;

export function classifyLoanTerm(account: string, rawDescription = ""): LoanTerm | null {
  const normalizedAccount = account.trim();
  const description = normalize(rawDescription);
  if (/^4(?:\.|$)/.test(normalizedAccount) && loanInterestPattern.test(description)) return "Juros";
  if (/^2\.1(?:\.|$)/.test(normalizedAccount)) return "Curto prazo";
  if (/^2\.(?:2|3)(?:\.|$)/.test(normalizedAccount)) return "Longo prazo";
  return null;
}

export function isLoanAccount(row: LoanAccountCandidate): boolean {
  const description = normalize(row.description);
  if (excludedLoanDescriptionPatterns.some((pattern) => pattern.test(description))) return false;

  // Parcelamentos e arrendamentos possuem módulos próprios e não devem
  // contaminar a conciliação de empréstimos.
  if (/\bPARCELAMENT/.test(description) || /\bARRENDAMENT/.test(description)) return false;

  const term = classifyLoanTerm(row.account, description);
  if (term === "Juros") return true;
  if (!term) return false;

  return loanDescriptionPatterns.some((pattern) => pattern.test(description));
}
