export type NfeItem = {
  code: string;
  description: string;
  ncm: string;
  cst: string;
  cfop: string;
  unit: string;
  quantity: number;
  unitValue: number;
  total: number;
  icmsBase: number;
  icmsValue: number;
  ipiValue: number;
  icmsRate: number;
  ipiRate: number;
};

const decode = (value: string) => value
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
const tag = (xml: string, name: string) => decode(xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, "i"))?.[1] ?? "");
const num = (value: string) => {
  const parsed = Number(String(value || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};
const xmlNum = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function parseNfeXml(xml: string): NfeItem[] {
  const blocks = xml.match(/<(?:\w+:)?det(?:\s[^>]*)?>[\s\S]*?<\/(?:\w+:)?det>/gi) ?? [];
  return blocks.map((block) => ({
    code: tag(block, "cProd"),
    description: tag(block, "xProd"),
    ncm: tag(block, "NCM"),
    cst: tag(block, "CST") || tag(block, "CSOSN"),
    cfop: tag(block, "CFOP"),
    unit: tag(block, "uCom"),
    quantity: xmlNum(tag(block, "qCom")),
    unitValue: xmlNum(tag(block, "vUnCom")),
    total: xmlNum(tag(block, "vProd")),
    icmsBase: xmlNum(tag(block, "vBC")),
    icmsValue: xmlNum(tag(block, "vICMS")),
    ipiValue: xmlNum(tag(block, "vIPI")),
    icmsRate: xmlNum(tag(block, "pICMS")),
    ipiRate: xmlNum(tag(block, "pIPI")),
  })).filter((item) => item.description);
}

export function parseNfeOcr(text: string): NfeItem[] {
  const clean = text.replace(/\r/g, "");
  const section = clean.split(/DADOS DO PRODUTO\/?SERVI[CÇ]O/i)[1] ?? clean;
  const lines = section.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const items: NfeItem[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d{2,20})\s+(.+?)\s+(\d{8})\s+(\d{3,4})\s+(\d{4})\s+([A-Z]{1,6})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i);
    if (!match) continue;
    items.push({ code: match[1], description: match[2], ncm: match[3], cst: match[4], cfop: match[5], unit: match[6], quantity: num(match[7]), unitValue: num(match[8]), total: num(match[9]), icmsBase: 0, icmsValue: 0, ipiValue: 0, icmsRate: 0, ipiRate: 0 });
  }
  return items;
}
