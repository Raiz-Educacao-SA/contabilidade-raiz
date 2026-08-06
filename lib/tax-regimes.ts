export type CorporateTaxRegime =
  | "Lucro Real"
  | "Lucro Presumido"
  | "Imune/Isenta"
  | "Não informado";

// Parametrização tributária por CODCOLIGADA, conciliada com a relação de
// empresas do resumo de débitos de PIS e COFINS fornecido pela Contabilidade.
const taxRegimeByCompany: Record<string, CorporateTaxRegime> = {
  "01": "Lucro Real", "02": "Lucro Real", "03": "Lucro Real",
  "04": "Lucro Real", "05": "Lucro Real", "06": "Lucro Real",
  "08": "Lucro Real", "09": "Lucro Real", "10": "Lucro Real",
  "11": "Lucro Real", "12": "Lucro Real", "13": "Lucro Real",
  "14": "Lucro Real", "16": "Lucro Real", "17": "Lucro Real",
  "18": "Lucro Real", "20": "Lucro Real", "25": "Lucro Real",
  "26": "Lucro Real", "28": "Lucro Real", "29": "Lucro Real",
  "30": "Lucro Real",
};

export function getCompanyTaxRegime(companyCode?: string | null): CorporateTaxRegime {
  const normalized = String(companyCode || "").trim().padStart(2, "0");
  return taxRegimeByCompany[normalized] || "Não informado";
}
