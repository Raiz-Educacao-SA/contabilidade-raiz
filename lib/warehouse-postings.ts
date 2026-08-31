export type WarehouseSheet = {
  name: string;
  rows: unknown[][];
};

export type WarehousePosting = {
  companyCode: string;
  companyName: string;
  branchCode: string;
  destinationCode: string;
  destinationName: string;
  debitAccount: string;
  debitReduced: string;
  creditAccount: string;
  creditReduced: string;
  document: string;
  amount: number;
  history: string;
};

export type WarehouseImportResult = {
  postings: WarehousePosting[];
  sourceRows: number;
  errors: string[];
};

type RootDestination = {
  code: string;
  name: string;
  historyName: string;
  debitAccount: string;
  debitReduced: string;
  aliases: string[];
};

type WarehouseImportOptions = {
  selectedCompanyCode: string;
  selectedCompanyName: string;
  competence?: string;
};

type WarehouseCompany = {
  code: string;
  name: string;
};

type WarehouseAllImportOptions = {
  companies: WarehouseCompany[];
  competence?: string;
};

const ROOT_COMPANY_CODE = "1";
const GENERAL_DEBIT_ACCOUNT = "4.2.1.03.01.20";
const GENERAL_DEBIT_REDUCED = "2404";
const GENERAL_CREDIT_ACCOUNT = "2.1.7.01.02.15";
const GENERAL_CREDIT_REDUCED = "2403";
const ROOT_CREDIT_ACCOUNT = "1.1.5.01.01.05";
const ROOT_CREDIT_REDUCED = "2401";
const DOCUMENT = "AJ ALMOXARIFADO";
const GENERAL_HISTORY = "CONSUMO MATERIAL DE ALMOXARIFADO - N/MÊS";

export const rootWarehouseDestinations: RootDestination[] = [
  { code: "2", name: "QI Qualidade Integral de Ensino Ltda", historyName: "QI", debitAccount: "1.1.2.03.06.01", debitReduced: "2826", aliases: ["qi", "colegio qi", "qualidade integral de ensino"] },
  { code: "5", name: "Colégio e Curso Ao Cubo Ltda", historyName: "AO CUBO", debitAccount: "1.1.2.03.06.02", debitReduced: "2827", aliases: ["ao cubo", "colegio e curso ao cubo"] },
  { code: "6", name: "Colégio QI Metropolitano S.A", historyName: "QI METROPOLITANO", debitAccount: "1.1.2.03.06.03", debitReduced: "2828", aliases: ["qi metropolitano", "colegio qi metropolitano"] },
  { code: "8", name: "Colégio e Curso Matriz Educação Ltda", historyName: "MATRIZ EDUCAÇÃO", debitAccount: "1.1.2.03.06.04", debitReduced: "2829", aliases: ["matriz educacao", "colegio e curso matriz educacao"] },
  { code: "9", name: "Creche Escola Global Tree Ltda", historyName: "GLOBAL TREE", debitAccount: "1.1.2.03.06.05", debitReduced: "2830", aliases: ["global tree", "creche escola global tree", "creche ipe"] },
  { code: "10", name: "Escolas Integradas Raiz Ltda", historyName: "ESCOLAS INTEGRADAS RAIZ", debitAccount: "1.1.2.03.06.06", debitReduced: "2831", aliases: ["escolas integradas raiz", "escolas integradas"] },
  { code: "17", name: "Bom Tempo Creche e Educação Infantil Ltda", historyName: "BOM TEMPO", debitAccount: "1.1.2.03.06.07", debitReduced: "2832", aliases: ["bom tempo", "bom tempo creche"] },
  { code: "11", name: "Grupo Educacional Unificado", historyName: "GRUPO EDUCACIONAL UNIFICADO", debitAccount: "1.1.2.03.06.11", debitReduced: "2969", aliases: ["grupo educacional unificado", "geu"] },
  { code: "12", name: "Colégio Leonardo da Vinci Ltda", historyName: "LEONARDO DA VINCI", debitAccount: "1.1.2.03.06.12", debitReduced: "2945", aliases: ["colegio leonardo da vinci", "leonardo da vinci"] },
  { code: "16", name: "Colégios Integrados Leonardo da Vinci Ltda", historyName: "COLÉGIOS INTEGRADOS LEONARDO DA VINCI", debitAccount: "1.1.2.03.06.16", debitReduced: "2961", aliases: ["colegios integrados leonardo da vinci", "clv gama"] },
  { code: "25", name: "Colégio Sarah Dawsey", historyName: "SARAH DAWSEY", debitAccount: "1.1.2.03.04.31", debitReduced: "2947", aliases: ["sarah dawsey", "colegio sarah dawsey"] },
  { code: "29", name: "Colégio Americano Ltda", historyName: "COLÉGIO AMERICANO", debitAccount: "1.1.2.03.06.29", debitReduced: "2959", aliases: ["colegio americano", "americano"] },
];

const sourceDestinationRules: Array<{ code: string; aliases: string[] }> = [
  { code: "6", aliases: ["qi metropolitano", "qi met jacinto", "qi jacinto", "colegio qi metropolitano jacinto", "sunny days", "creche e escola sunny days"] },
  { code: "10", aliases: ["qi recreio", "sa pereira", "sap barrinha"] },
  { code: "16", aliases: ["gama"] },
  { code: "12", aliases: ["alfa", "beta"] },
  { code: "25", aliases: ["sarah dawsey"] },
  { code: "29", aliases: ["freeway"] },
  { code: "11", aliases: ["zona sul", "unificado"] },
  { code: "17", aliases: ["bom tempo"] },
  { code: "5", aliases: ["cubo"] },
  { code: "9", aliases: ["global tree", "creche ipe"] },
  { code: "8", aliases: ["matriz educacao", "matriz "] },
  { code: "10", aliases: ["sap", "sa pereira"] },
  { code: "2", aliases: ["qi"] },
];

const sourceBranchRules: Record<string, Array<{ branch: string; aliases: string[] }>> = {
  "2": [
    { branch: "9", aliases: ["qi rio 2 expansao"] },
    { branch: "1", aliases: ["qi matriz"] },
    { branch: "2", aliases: ["qi tijuca"] },
    { branch: "3", aliases: ["qi botafogo"] },
    { branch: "6", aliases: ["qi freguesia"] },
    { branch: "7", aliases: ["qi rio 2"] },
    { branch: "8", aliases: ["qi met jacinto", "qi jacinto"] },
    { branch: "10", aliases: ["qi valqueire"] },
  ],
  "5": [
    { branch: "6", aliases: ["cubo barra golf"] },
    { branch: "2", aliases: ["cubo barra"] },
    { branch: "5", aliases: ["cubo botafogo"] },
  ],
  "6": [
    { branch: "2", aliases: ["qi met jacinto", "qi jacinto", "qi metropolitano jacinto", "colegio qi metropolitano jacinto"] },
    { branch: "3", aliases: ["sunny days", "creche e escola sunny days"] },
    { branch: "1", aliases: ["qi metropolitano"] },
  ],
  "8": [
    { branch: "1", aliases: ["matriz rocha miranda"] },
    { branch: "2", aliases: ["matriz campo grande"] },
    { branch: "3", aliases: ["matriz taquara"] },
    { branch: "4", aliases: ["matriz bangu"] },
    { branch: "5", aliases: ["matriz nova iguacu"] },
    { branch: "6", aliases: ["matriz caxias"] },
    { branch: "9", aliases: ["matriz madureira"] },
    { branch: "10", aliases: ["matriz retiro dos artistas"] },
    { branch: "11", aliases: ["matriz tijuca"] },
  ],
  "9": [
    { branch: "1", aliases: ["global tree rio 2", "global tree botafogo"] },
    { branch: "2", aliases: ["global tree recreio"] },
    { branch: "3", aliases: ["global tree barra golf"] },
    { branch: "4", aliases: ["global tree peninsula"] },
    { branch: "5", aliases: ["global tree marapendi"] },
    { branch: "6", aliases: ["global tree abm"] },
  ],
  "10": [
    { branch: "1", aliases: ["qi recreio"] },
    { branch: "3", aliases: ["sa pereira matriz"] },
    { branch: "6", aliases: ["sa pereira capistrano"] },
    { branch: "7", aliases: ["sap barrinha"] },
  ],
  "11": [{ branch: "6", aliases: ["zona sul"] }],
  "12": [{ branch: "1", aliases: ["alfa", "beta"] }],
  "16": [{ branch: "1", aliases: ["gama"] }],
  "17": [{ branch: "1", aliases: ["bom tempo"] }],
  "25": [{ branch: "1", aliases: ["sarah dawsey"] }],
  "29": [{ branch: "1", aliases: ["freeway"] }],
};

const monthNumbers: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " e ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCode(value: unknown) {
  const text = String(value ?? "").trim();
  const leading = text.match(/^(?:coligada\s*)?0*(\d{1,2})(?:\D|$)/i);
  return leading ? String(Number(leading[1])) : "";
}

function normalizeBranch(value: unknown) {
  const code = normalizeCode(value);
  return code || String(value ?? "").trim().replace(/^0+/, "") || "";
}

function parseAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  let text = String(value ?? "").trim();
  if (!text) return Number.NaN;
  const negative = /^\s*-/.test(text) || /^\s*\(.*\)\s*$/.test(text);
  text = text.replace(/[^0-9,.-]/g, "").replace(/-/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  const parsed = Number(text);
  return negative ? -parsed : parsed;
}

function headerIndex(row: unknown[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeText);
  return row.findIndex((cell) => {
    const header = normalizeText(cell);
    return normalizedAliases.some((alias) => header === alias || header.startsWith(`${alias} `));
  });
}

function destinationFor(value: unknown) {
  const code = normalizeCode(value);
  const normalized = normalizeText(value);
  return rootWarehouseDestinations.find((destination) => {
    if (code && destination.code === code) return true;
    return destination.aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalized === normalizedAlias || normalized.includes(normalizedAlias);
    });
  });
}

function destinationFromSource(unitValue: unknown, brandValue: unknown) {
  for (const value of [unitValue, brandValue]) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const rule = sourceDestinationRules.find((candidate) =>
      candidate.aliases.some((alias) => {
        const normalizedAlias = normalizeText(alias);
        return normalized === normalizedAlias || normalized.includes(normalizedAlias);
      }),
    );
    if (rule) return rootWarehouseDestinations.find((destination) => destination.code === rule.code);
  }
  return undefined;
}

function branchFromSource(companyCode: string, unitValue: unknown) {
  const normalized = normalizeText(unitValue);
  const rule = sourceBranchRules[companyCode]?.find((candidate) =>
    candidate.aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalized === normalizedAlias || normalized.includes(normalizedAlias);
    }),
  );
  return rule?.branch || "";
}

function rowMatchesCompetence(row: unknown[], yearIndex: number, monthIndex: number, competence?: string) {
  if (!competence || !/^\d{4}-\d{2}$/.test(competence)) return true;
  const [expectedYear, expectedMonth] = competence.split("-").map(Number);
  if (yearIndex >= 0) {
    const year = Number(String(row[yearIndex] ?? "").replace(/[^0-9]/g, ""));
    if (year && year !== expectedYear) return false;
  }
  if (monthIndex >= 0) {
    const rawMonth = String(row[monthIndex] ?? "").trim();
    const month = monthNumbers[normalizeText(rawMonth)] || Number(rawMonth.replace(/[^0-9]/g, ""));
    if (month && month !== expectedMonth) return false;
  }
  return true;
}

function companyValueMatches(value: unknown, selectedCode: string, selectedName: string) {
  const code = normalizeCode(value);
  if (code) return code === selectedCode;
  const normalized = normalizeText(value);
  const normalizedName = normalizeText(selectedName).replace(/^\d+\s+/, "");
  return !normalized || normalized.includes(normalizedName) || normalizedName.includes(normalized);
}

function pushOrSum(postings: Map<string, WarehousePosting>, key: string, posting: WarehousePosting) {
  const previous = postings.get(key);
  if (previous) previous.amount = Math.round((previous.amount + posting.amount + Number.EPSILON) * 100) / 100;
  else postings.set(key, posting);
}

export function parseWarehouseSheets(sheets: WarehouseSheet[], options: WarehouseImportOptions): WarehouseImportResult {
  const selectedCode = normalizeCode(options.selectedCompanyCode);
  const isRoot = selectedCode === ROOT_COMPANY_CODE;
  const postings = new Map<string, WarehousePosting>();
  const errors: string[] = [];
  let sourceRows = 0;
  let sheetsWithHeaders = 0;

  sheets.forEach((sheet) => {
    const headerPosition = sheet.rows.slice(0, 40).findIndex((row) => {
      const hasValue = headerIndex(row, ["valor", "valor total", "preço total", "preco total", "total", "valor consumo", "consumo", "montante"]) >= 0;
      const hasScope = headerIndex(row, ["codcoligada", "coligada", "empresa", "razao social", "codfilial", "filial", "empresa destino", "destino", "unidade", "escola"]) >= 0;
      return hasValue && hasScope;
    });
    if (headerPosition < 0) return;
    sheetsWithHeaders += 1;
    const headers = sheet.rows[headerPosition];
    const valueIndex = headerIndex(headers, ["valor", "valor total", "preço total", "preco total", "total", "valor consumo", "consumo", "montante"]);
    const companyCodeIndex = headerIndex(headers, ["codcoligada", "codigo coligada", "código coligada", "coligada"]);
    const companyNameIndex = headerIndex(headers, ["empresa", "razao social", "razão social", "coligada empresa"]);
    const branchIndex = headerIndex(headers, ["codfilial", "codigo filial", "código filial", "filial"]);
    const destinationIndex = headerIndex(headers, ["empresa destino", "empresa de destino", "coligada destino", "destino", "unidade destino", "unidade", "escola"]);
    const unitIndex = headerIndex(headers, ["unidade", "unidade destino", "escola"]);
    const brandIndex = headerIndex(headers, ["marca", "grupo", "bandeira"]);
    const yearIndex = headerIndex(headers, ["ano"]);
    const monthIndex = headerIndex(headers, ["mês", "mes", "competência", "competencia"]);
    const isMaterialsModel = unitIndex >= 0 && brandIndex >= 0;

    if (!isRoot && branchIndex < 0 && !isMaterialsModel) {
      errors.push(`A aba ${sheet.name} precisa informar a coluna Filial para segregar os lançamentos.`);
      return;
    }
    if (isRoot && destinationIndex < 0 && companyNameIndex < 0 && companyCodeIndex < 0) {
      errors.push(`A aba ${sheet.name} precisa informar a empresa de destino dos consumos da Raiz.`);
      return;
    }

    sheet.rows.slice(headerPosition + 1).forEach((row, index) => {
      if (!row.some((cell) => String(cell ?? "").trim())) return;
      if (!rowMatchesCompetence(row, yearIndex, monthIndex, options.competence)) return;
      const amount = parseAmount(row[valueIndex]);
      if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return;

      const sourceLine = headerPosition + index + 2;
      const explicitCompany = companyCodeIndex >= 0 ? row[companyCodeIndex] : "";
      const namedCompany = companyNameIndex >= 0 ? row[companyNameIndex] : "";
      const sourceUnit = unitIndex >= 0 ? row[unitIndex] : "";
      const sourceBrand = brandIndex >= 0 ? row[brandIndex] : "";
      const sourceDestination = isMaterialsModel ? destinationFromSource(sourceUnit, sourceBrand) : undefined;

      if (!isRoot) {
        if (isMaterialsModel && sourceDestination?.code !== selectedCode) return;
        const companyReference = explicitCompany || namedCompany;
        if (!isMaterialsModel && companyReference && !companyValueMatches(companyReference, selectedCode, options.selectedCompanyName)) return;
        const branchCode = branchIndex >= 0 ? normalizeBranch(row[branchIndex]) : branchFromSource(selectedCode, sourceUnit);
        if (!branchCode) {
          errors.push(`${sheet.name}, linha ${sourceLine}: a unidade ${String(sourceUnit || "não informada")} ainda não possui CODFILIAL cadastrado para a coligada ${selectedCode.padStart(2, "0")}.`);
          return;
        }
        sourceRows += 1;
        pushOrSum(postings, `${selectedCode}:${branchCode}`, {
          companyCode: selectedCode,
          companyName: options.selectedCompanyName,
          branchCode,
          destinationCode: "",
          destinationName: "",
          debitAccount: GENERAL_DEBIT_ACCOUNT,
          debitReduced: GENERAL_DEBIT_REDUCED,
          creditAccount: GENERAL_CREDIT_ACCOUNT,
          creditReduced: GENERAL_CREDIT_REDUCED,
          document: DOCUMENT,
          amount: Math.abs(amount),
          history: GENERAL_HISTORY,
        });
        return;
      }

      const explicitDestination = destinationIndex >= 0 ? row[destinationIndex] : "";
      const companyCode = normalizeCode(explicitCompany);
      const destinationReference = explicitDestination || namedCompany || (companyCode !== ROOT_COMPANY_CODE ? explicitCompany : "");
      const destination = sourceDestination || destinationFor(destinationReference);
      if (!destination) {
        errors.push(`${sheet.name}, linha ${sourceLine}: empresa de destino sem conta de Almoxarifado cadastrada (${String(destinationReference || "não informada")}).`);
        return;
      }
      sourceRows += 1;
      pushOrSum(postings, `${ROOT_COMPANY_CODE}:${destination.code}`, {
        companyCode: ROOT_COMPANY_CODE,
        companyName: options.selectedCompanyName,
        branchCode: "1",
        destinationCode: destination.code,
        destinationName: destination.name,
        debitAccount: destination.debitAccount,
        debitReduced: destination.debitReduced,
        creditAccount: ROOT_CREDIT_ACCOUNT,
        creditReduced: ROOT_CREDIT_REDUCED,
        document: DOCUMENT,
        amount: Math.abs(amount),
        history: `CONSUMO ALMOXARIFADO RAIZ X ${destination.historyName} N/MÊS`,
      });
    });
  });

  if (!sheetsWithHeaders) errors.push("Nenhuma aba com estrutura válida foi encontrada no arquivo.");

  return {
    postings: [...postings.values()].sort((left, right) =>
      Number(left.branchCode) - Number(right.branchCode) || Number(left.destinationCode) - Number(right.destinationCode),
    ),
    sourceRows,
    errors: [...new Set(errors)],
  };
}

export function parseWarehouseSheetsForAllCompanies(
  sheets: WarehouseSheet[],
  options: WarehouseAllImportOptions,
): WarehouseImportResult {
  const companyMap = new Map<string, WarehouseCompany>();
  options.companies.forEach((company) => {
    const code = normalizeCode(company.code);
    if (code) companyMap.set(code, { code, name: company.name });
  });
  rootWarehouseDestinations.forEach((destination) => {
    if (!companyMap.has(destination.code)) {
      companyMap.set(destination.code, { code: destination.code, name: destination.name });
    }
  });
  if (!companyMap.has(ROOT_COMPANY_CODE)) {
    companyMap.set(ROOT_COMPANY_CODE, { code: ROOT_COMPANY_CODE, name: "Raiz Educação S.A." });
  }

  const results = [...companyMap.values()].map((company) =>
    parseWarehouseSheets(sheets, {
      selectedCompanyCode: company.code,
      selectedCompanyName: company.name,
      competence: options.competence,
    }),
  );

  return {
    postings: results
      .flatMap((result) => result.postings)
      .sort((left, right) =>
        Number(left.companyCode) - Number(right.companyCode) ||
        Number(left.branchCode) - Number(right.branchCode) ||
        Number(left.destinationCode) - Number(right.destinationCode),
      ),
    sourceRows: Math.max(0, ...results.map((result) => result.sourceRows)),
    errors: [...new Set(results.flatMap((result) => result.errors))],
  };
}

function postingDate(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  const day = new Date(year, month, 0).getDate();
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(Math.abs(value));
}

export function buildWarehousePostingsCsv(postings: WarehousePosting[], competence: string) {
  const rows: string[][] = [["M", "99", "IMPORTAÇÃO DE LANÇAMENTOS", postingDate(competence)]];
  postings.forEach((posting) => rows.push([
    "*P",
    posting.document,
    posting.debitAccount,
    posting.creditAccount,
    "",
    formatAmount(posting.amount),
    "71",
    posting.history,
    posting.branchCode,
  ]));
  return `${rows.map((fields) => fields.join(";")).join("\r\n")}\r\n`;
}

export function encodeWarehouseCsv(text: string) {
  return Uint8Array.from(Array.from(text), (character) => {
    const code = character.charCodeAt(0);
    return code <= 255 ? code : 63;
  });
}
