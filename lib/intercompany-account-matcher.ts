export type NamedAccount = {
  account: string;
  description: string;
};

export type NamedCompany = {
  code: string;
  name: string;
};

const companyAccountAliases: Record<string, string[]> = {
  "2": ["QI Qualidade Integral de Ensino", "Qualidade Integral de Ensino"],
  "3": ["Raiz Sul Empreendimentos", "Raiz Sul"],
  "4": ["Editora Raiz"],
  "5": ["Ao Cubo"],
  "6": ["Colégio QI Metropolitano", "QI Metropolitano"],
  "8": ["Matriz Educação"],
  "9": ["Global Tree"],
  "10": ["Escolas Integradas Raiz", "Escolas Integradas"],
  "11": ["Grupo Educacional Unificado"],
  "12": ["Colégio Leonardo da Vinci"],
  "13": ["Sociedade Educacional Leonardo da Vinci", "SELVI"],
  "14": ["Didacta"],
  "16": ["Colégios Integrados Leonardo da Vinci", "CLV Gama"],
  "17": ["Bom Tempo"],
  "18": ["Apogeu Espaço Mágico", "Espaço Mágico"],
  "20": ["Apogeu Cidade Alta", "Cidade Alta", "Integra"],
  "25": ["Sarah Dawsey"],
  "26": ["Apogeu Sudeste", "Sudeste Gestão Educacional"],
  "28": ["Pro Raiz"],
  "29": ["Colégio Americano"],
  "30": ["Colégio União"],
};

export function normalizeAccountCompanyName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " e ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function aliasesForCompany(company: NamedCompany) {
  const configured = companyAccountAliases[String(Number(company.code))];
  return (configured?.length ? configured : [company.name])
    .map(normalizeAccountCompanyName)
    .filter((alias) => alias.length >= 3);
}

function accountNameMatchScore(description: string, company: NamedCompany) {
  const normalizedDescription = normalizeAccountCompanyName(description);
  return aliasesForCompany(company).reduce((best, alias) => {
    if (normalizedDescription === alias) return Math.max(best, 10_000 + alias.length);
    if (normalizedDescription.includes(alias)) return Math.max(best, alias.length);
    return best;
  }, 0);
}

export function findHoldingAccountByCompanyName<T extends NamedAccount>(
  rows: T[],
  prefix: string,
  company: NamedCompany,
) {
  const matches = rows
    .filter((row) => row.account.startsWith(`${prefix}.`))
    .map((row) => ({ row, score: accountNameMatchScore(row.description, company) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.row.account.localeCompare(right.row.account));

  if (!matches.length) return undefined;
  if (matches.length > 1 && matches[0].score === matches[1].score) return undefined;
  return matches[0].row;
}
