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
  /\bEMPREST/,
  /\bFINANC/,
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

const loanInterestPattern = /(?:\bJUROS\b|\bENCARGOS FINANCEIROS\b).*\b(?:EMPREST|FINANC)|\b(?:EMPREST|FINANC).*(?:\bJUROS\b|\bENCARGOS FINANCEIROS\b)/;

// Contas redutoras analíticas de juros a apropriar permanecem no mesmo prazo
// do empréstimo (2.1 = curto; 2.2/2.3 = longo). O vínculo explícito com
// empréstimo/financiamento evita incluir totalizadores genéricos de juros.
const loanLiabilityInterestPattern = /\bJUROS\b.*\b(?:EMPREST|FINANC)|\b(?:EMPREST|FINANC).*\bJUROS\b/;

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

  if (loanLiabilityInterestPattern.test(description)) return true;

  return loanDescriptionPatterns.some((pattern) => pattern.test(description));
}
