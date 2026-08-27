import { company18LoanControls } from "./loan-controls-company-18.ts";

export type LoanScheduleEntry = {
  competence: string;
  interest: number;
  totalInstallment: number;
  installment?: number;
  amortization?: number;
  outstandingBalance?: number;
  status?: string;
};

export type LoanPostingControl = {
  id: string;
  companyCode: string;
  branchCode: string;
  contract: string;
  document: string;
  sourceSheet: string;
  shortPrincipalAccount: string;
  longPrincipalAccount: string;
  shortInterestAccount: string;
  longInterestAccount: string;
  companyName: string;
  companyCnpj: string;
  bank: string;
  principal: number;
  financedTotal: number;
  openingBalance: number;
  graceInterest: number;
  interestSummaryLabel?: string;
  monthlyRate: number;
  monthlyAmortization: number;
  installments: number;
  releaseDate: string;
  firstCompetence: string;
  finalCompetence: string;
  postingsEnabled?: boolean;
  schedule: LoanScheduleEntry[];
};

export type LoanControlScheduleRow = LoanScheduleEntry & {
  installment: number;
  amortization: number;
  outstandingBalance: number;
  status: string;
};

export type LoanPosting = {
  controlId: string;
  contract: string;
  branchCode: string;
  document: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  history: string;
};

export type LoanControlAccountType = "shortPrincipal" | "longPrincipal" | "shortInterest" | "longInterest";

export type LoanAccountControlContribution = {
  controlId: string;
  contract: string;
  bank: string;
  accountType: LoanControlAccountType;
  label: string;
  expectedBalance: number;
};

export type LoanAccountControlReconciliation = {
  account: string;
  label: string;
  expectedBalance: number;
  contributions: LoanAccountControlContribution[];
};

const aoCuboSicoobSchedule: LoanScheduleEntry[] = [
  { competence: "2026-02", interest: 164350.87, totalInstallment: 253659.14 },
  { competence: "2026-03", interest: 82081.41, totalInstallment: 171389.68 },
  { competence: "2026-04", interest: 93797.06, totalInstallment: 183105.33 },
  { competence: "2026-05", interest: 89357.88, totalInstallment: 178666.15 },
  { competence: "2026-06", interest: 88877.43, totalInstallment: 178185.70 },
  { competence: "2026-07", interest: 91668.47, totalInstallment: 180976.74 },
  { competence: "2026-08", interest: 95822.63, totalInstallment: 185130.90 },
  { competence: "2026-09", interest: 82058.37, totalInstallment: 171366.64 },
  { competence: "2026-10", interest: 84093.92, totalInstallment: 173402.19 },
  { competence: "2026-11", interest: 84457.27, totalInstallment: 173765.54 },
  { competence: "2026-12", interest: 77414.92, totalInstallment: 166723.19 },
  { competence: "2027-01", interest: 80193.68, totalInstallment: 169501.95 },
  { competence: "2027-02", interest: 73805.54, totalInstallment: 163113.81 },
  { competence: "2027-03", interest: 71857.93, totalInstallment: 161166.20 },
  { competence: "2027-04", interest: 77561.27, totalInstallment: 166869.54 },
  { competence: "2027-05", interest: 74521.12, totalInstallment: 163829.39 },
  { competence: "2027-06", interest: 68125.13, totalInstallment: 157433.40 },
  { competence: "2027-07", interest: 71668.07, totalInstallment: 160976.34 },
  { competence: "2027-08", interest: 71632.42, totalInstallment: 160940.69 },
  { competence: "2027-09", interest: 66304.83, totalInstallment: 155613.10 },
  { competence: "2027-10", interest: 64687.62, totalInstallment: 153995.89 },
  { competence: "2027-11", interest: 62654.13, totalInstallment: 151962.40 },
  { competence: "2027-12", interest: 60715.63, totalInstallment: 150023.90 },
  { competence: "2028-01", interest: 65656.25, totalInstallment: 154964.52 },
  { competence: "2028-02", interest: 57520.08, totalInstallment: 146828.35 },
  { competence: "2028-03", interest: 52459.55, totalInstallment: 141767.82 },
  { competence: "2028-04", interest: 58649.47, totalInstallment: 147957.74 },
  { competence: "2028-05", interest: 47187.66, totalInstallment: 136495.93 },
  { competence: "2028-06", interest: 56162.23, totalInstallment: 145470.50 },
  { competence: "2028-07", interest: 50734.78, totalInstallment: 140043.05 },
  { competence: "2028-08", interest: 47933.40, totalInstallment: 137241.67 },
  { competence: "2028-09", interest: 48898.11, totalInstallment: 138206.38 },
  { competence: "2028-10", interest: 44438.71, totalInstallment: 133746.98 },
  { competence: "2028-11", interest: 44188.34, totalInstallment: 133496.61 },
  { competence: "2028-12", interest: 40255.75, totalInstallment: 129564.02 },
  { competence: "2029-01", interest: 38440.37, totalInstallment: 127748.64 },
  { competence: "2029-02", interest: 39279.85, totalInstallment: 128588.12 },
  { competence: "2029-03", interest: 35164.50, totalInstallment: 124472.77 },
  { competence: "2029-04", interest: 36432.53, totalInstallment: 125740.80 },
  { competence: "2029-05", interest: 32513.68, totalInstallment: 121821.95 },
  { competence: "2029-06", interest: 33722.28, totalInstallment: 123030.55 },
  { competence: "2029-07", interest: 31095.50, totalInstallment: 120403.77 },
  { competence: "2029-08", interest: 30000.58, totalInstallment: 119308.85 },
  { competence: "2029-09", interest: 29324.73, totalInstallment: 118633.00 },
  { competence: "2029-10", interest: 23670.12, totalInstallment: 112978.39 },
  { competence: "2029-11", interest: 25583.42, totalInstallment: 114891.69 },
  { competence: "2029-12", interest: 22219.74, totalInstallment: 111528.01 },
  { competence: "2030-01", interest: 19484.26, totalInstallment: 108792.53 },
  { competence: "2030-02", interest: 20827.79, totalInstallment: 110136.06 },
  { competence: "2030-03", interest: 15728.90, totalInstallment: 105037.17 },
  { competence: "2030-04", interest: 16366.05, totalInstallment: 105674.32 },
  { competence: "2030-05", interest: 14109.12, totalInstallment: 103417.39 },
  { competence: "2030-06", interest: 14195.94, totalInstallment: 103504.21 },
  { competence: "2030-07", interest: 10356.05, totalInstallment: 99664.32 },
  { competence: "2030-08", interest: 10413.90, totalInstallment: 99722.17 },
  { competence: "2030-09", interest: 8527.67, totalInstallment: 97835.94 },
  { competence: "2030-10", interest: 6391.11, totalInstallment: 95699.38 },
  { competence: "2030-11", interest: 5381.75, totalInstallment: 94690.02 },
  { competence: "2030-12", interest: 2958.86, totalInstallment: 92267.13 },
  { competence: "2031-01", interest: 1567.68, totalInstallment: 90876.50 },
];

const controlsByCompany: Record<string, LoanPostingControl[]> = {
  "05": [{
    id: "05-sicoob-872959",
    companyCode: "05",
    branchCode: "1",
    contract: "872959",
    document: "EMPRES_CUBO",
    sourceSheet: "Sicoob - 872959",
    shortPrincipalAccount: "2.1.1.01.15.11",
    longPrincipalAccount: "2.3.1.01.11.11",
    shortInterestAccount: "2.1.1.02.11.12",
    longInterestAccount: "2.3.1.02.14.11",
    companyName: "COLÉGIO E CURSO AO CUBO S.A.",
    companyCnpj: "23.075.186/0001-43",
    bank: "Sicoob",
    principal: 5000000,
    financedTotal: 5176295.05,
    openingBalance: 5358496.75,
    graceInterest: 182201.70,
    monthlyRate: 0.0174,
    monthlyAmortization: 89308.27,
    installments: 60,
    releaseDate: "2025-12-02",
    firstCompetence: "2026-02",
    finalCompetence: "2031-01",
    schedule: aoCuboSicoobSchedule,
  }],
  "18": company18LoanControls,
};

const normalizeCompanyCode = (value: string) => String(Number(value || "0")).padStart(2, "0");

const addMonths = (competence: string, months: number) => {
  const [year, month] = competence.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const controlAccountFields: Array<{ field: keyof Pick<LoanPostingControl, "shortPrincipalAccount" | "longPrincipalAccount" | "shortInterestAccount" | "longInterestAccount">; type: LoanControlAccountType; label: string }> = [
  { field: "shortPrincipalAccount", type: "shortPrincipal", label: "Empréstimo — curto prazo" },
  { field: "longPrincipalAccount", type: "longPrincipal", label: "Empréstimo — longo prazo" },
  { field: "shortInterestAccount", type: "shortInterest", label: "Juros a apropriar — curto prazo" },
  { field: "longInterestAccount", type: "longInterest", label: "Juros a apropriar — longo prazo" },
];

function expectedControlBalance(control: LoanPostingControl, competence: string, accountType: LoanControlAccountType) {
  const shortTermLimit = addMonths(competence, 12);
  const remaining = control.schedule.filter((entry) => entry.competence > competence);
  const selected = accountType.startsWith("short")
    ? remaining.filter((entry) => entry.competence <= shortTermLimit)
    : remaining.filter((entry) => entry.competence > shortTermLimit);
  const isInterest = accountType.endsWith("Interest");
  const amount = selected.reduce((sum, entry) => sum + (isInterest ? entry.interest : entry.totalInstallment), 0);
  return roundCurrency(isInterest ? amount : -amount);
}

export function getLoanAccountControlReconciliation(companyCode: string, competence: string, account: string): LoanAccountControlReconciliation | null {
  const normalizedAccount = account.trim();
  const contributions = getLoanPostingControls(companyCode).flatMap<LoanAccountControlContribution>((control) => {
    const mapping = controlAccountFields.find(({ field }) => control[field] === normalizedAccount);
    if (!mapping) return [];
    return [{
      controlId: control.id,
      contract: control.contract,
      bank: control.bank,
      accountType: mapping.type,
      label: mapping.label,
      expectedBalance: expectedControlBalance(control, competence, mapping.type),
    }];
  });
  if (!contributions.length) return null;
  return {
    account: normalizedAccount,
    label: contributions[0].label,
    expectedBalance: roundCurrency(contributions.reduce((sum, contribution) => sum + contribution.expectedBalance, 0)),
    contributions,
  };
}

export function getLoanPostingControls(companyCode: string) {
  return controlsByCompany[normalizeCompanyCode(companyCode)] || [];
}

export function getLoanControlSchedule(control: LoanPostingControl): LoanControlScheduleRow[] {
  return control.schedule.map((entry, index) => ({
    ...entry,
    installment: entry.installment ?? index + 1,
    amortization: entry.amortization ?? control.monthlyAmortization,
    outstandingBalance: entry.outstandingBalance ?? (index === control.installments - 1
      ? 0
      : roundCurrency(Math.max(0, control.openingBalance - control.monthlyAmortization * (index + 1)))),
    status: entry.status || "Ativa",
  }));
}

export function generateLoanPostings(companyCode: string, competence: string): LoanPosting[] {
  const futureCompetence = addMonths(competence, 12);
  return getLoanPostingControls(companyCode).filter((control) => control.postingsEnabled !== false).flatMap((control) => {
    const current = control.schedule.find((entry) => entry.competence === competence);
    if (!current) return [];
    const future = control.schedule.find((entry) => entry.competence === futureCompetence);
    const postings: LoanPosting[] = [];

    if (future && future.totalInstallment >= 0.005) {
      postings.push({
        controlId: control.id,
        contract: control.contract,
        branchCode: control.branchCode,
        document: control.document,
        debitAccount: control.longPrincipalAccount,
        creditAccount: control.shortPrincipalAccount,
        amount: roundCurrency(future.totalInstallment),
        history: "TRANSF CURTO X LONGO PRAZO - N/ MÊS",
      });
    }

    if (current.interest >= 0.005) {
      postings.push({
        controlId: control.id,
        contract: control.contract,
        branchCode: control.branchCode,
        document: control.document,
        debitAccount: control.shortPrincipalAccount,
        creditAccount: control.shortInterestAccount,
        amount: roundCurrency(current.interest),
        history: "APROPRIAÇÃO DE JUROS N/ MÊS",
      });
    }

    if (future && future.interest >= 0.005) {
      postings.push({
        controlId: control.id,
        contract: control.contract,
        branchCode: control.branchCode,
        document: control.document,
        debitAccount: control.shortInterestAccount,
        creditAccount: control.longInterestAccount,
        amount: roundCurrency(future.interest),
        history: "TRANSF JUROS CURTO X LONGO PRAZO - N/ MÊS",
      });
    }

    return postings;
  });
}

const formatAmount = (value: number) => new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
}).format(Math.abs(value));

const postingDate = (competence: string) => {
  const [year, month] = competence.split("-").map(Number);
  const day = Math.min(30, new Date(year, month, 0).getDate());
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
};

export function buildLoanPostingsCsv(companyCode: string, competence: string) {
  const postings = generateLoanPostings(companyCode, competence);
  const rows: string[][] = [["M", "99", "IMPORTAÇÃO DE LANÇAMENTOS", postingDate(competence), "", "", "", "", ""]];
  postings.forEach((posting) => rows.push([
    "*P",
    "EMPRÉSTIMOS",
    posting.debitAccount,
    posting.creditAccount,
    posting.document,
    formatAmount(posting.amount),
    "71",
    posting.history,
    posting.branchCode,
  ]));
  return { postings, csv: `${rows.map((fields) => fields.join(";")).join("\r\n")}\r\n` };
}

export function encodeWindows1252(text: string) {
  return Uint8Array.from(Array.from(text), (character) => {
    const code = character.charCodeAt(0);
    return code <= 255 ? code : 63;
  });
}
