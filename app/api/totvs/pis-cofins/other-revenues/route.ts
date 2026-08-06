import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type AccountRule = {
  reduced: number;
  account: string;
  description: string;
  group: string;
};

// Matriz transcrita da aba "Base contas" do modelo de Outras Receitas.
const accountRules: AccountRule[] = [
  { reduced: 705, account: "3.1.1.01.01.06", description: "Serviços Prestados", group: "1.4 Outras Receitas" },
  { reduced: 707, account: "3.1.1.01.02.01", description: "Uniformes de Alunos", group: "1.4 Outras Receitas" },
  { reduced: 708, account: "3.1.1.01.02.02", description: "Seguro Escolar", group: "1.4 Outras Receitas" },
  { reduced: 710, account: "3.1.1.01.02.04", description: "Escolinhas / Atividades Extras", group: "1.4 Outras Receitas" },
  { reduced: 711, account: "3.1.1.01.02.05", description: "Eventos com Receita", group: "1.4 Outras Receitas" },
  { reduced: 712, account: "3.1.1.01.02.06", description: "Outras Receitas de Alunos", group: "1.4 Outras Receitas" },
  { reduced: 713, account: "3.1.1.01.02.07", description: "Taxas", group: "1.4 Outras Receitas" },
  { reduced: 714, account: "3.1.1.01.02.08", description: "Encargos por Atraso", group: "" },
  { reduced: 1112, account: "3.1.1.01.02.09", description: "Creche - Diária", group: "" },
  { reduced: 1118, account: "3.1.1.01.02.10", description: "Simulado Enem", group: "1.4 Outras Receitas" },
  { reduced: 2506, account: "3.1.1.01.02.12", description: "Atividades Extras - E-Commerce", group: "1.4 Outras Receitas" },
  { reduced: 723, account: "3.1.1.01.04.01", description: "Sublocação", group: "4.2 - Outras - Aluguel" },
  { reduced: 724, account: "3.1.1.01.04.02", description: "Aluguel de Cantina", group: "4.2 - Outras - Aluguel" },
  { reduced: 725, account: "3.1.1.01.04.03", description: "Outras Receitas Operacionais", group: "1.4 Outras Receitas" },
  { reduced: 1028, account: "4.2.1.11.01.01", description: "Recebimento de Multa/Juros", group: "6.3 - Juros Ativos" },
  { reduced: 1029, account: "4.2.1.11.01.02", description: "Receitas de Aplicações Financeiras", group: "6.1 - Rendimentos s/Aplicações financeiras" },
  { reduced: 1030, account: "4.2.1.11.01.03", description: "Descontos Obtidos", group: "6.2 - Descontos Obtidos" },
  { reduced: 1033, account: "4.2.1.11.01.06", description: "Variação Cambial Ativa", group: "6.5 - Variação Cambial Ativa - Tributada" },
  { reduced: 1036, account: "4.2.1.12.01.01", description: "(-) Recuperação de Despesas", group: "3.2 Recuperação de Despesas" },
  { reduced: 1037, account: "4.2.1.12.01.02", description: "(-) Reversão de Provisão", group: "" },
  { reduced: 1038, account: "4.2.1.12.01.03", description: "(-) Receita de Aluguéis", group: "4.2 - Outras - Aluguel" },
  { reduced: 1039, account: "4.2.1.12.01.04", description: "(-) Bens Móveis", group: "" },
  { reduced: 1040, account: "4.2.1.12.01.05", description: "(-) Bens Imóveis", group: "" },
  { reduced: 1041, account: "4.2.1.12.01.06", description: "(-) Receitas Operacionais", group: "1.4 Outras Receitas" },
  { reduced: 1042, account: "4.2.1.12.01.07", description: "(-) Doações Recebidas", group: "" },
  { reduced: 1043, account: "4.2.1.12.01.08", description: "(-) Patrocínio", group: "" },
  { reduced: 1044, account: "4.2.1.12.01.09", description: "(-) Recuperação de Receitas", group: "" },
  { reduced: 1045, account: "4.2.1.12.01.10", description: "(-) Receita de Sinistro", group: "" },
  { reduced: 1046, account: "4.2.1.12.01.11", description: "(-) Ajuste c/ Inventário de Estoques", group: "" },
  { reduced: 1047, account: "4.2.1.12.01.12", description: "(-) Reversão Acordo/Canc PCLD exerc ante", group: "" },
  { reduced: 1048, account: "4.2.1.12.01.13", description: "(-) Reversão Provisão Risco/Contingência", group: "" },
  { reduced: 1049, account: "4.2.1.12.01.14", description: "(-) Reversão PCLD Mensalidades", group: "" },
  { reduced: 1050, account: "4.2.1.12.01.15", description: "(-) Reversão PCLD Cheques", group: "" },
  { reduced: 1051, account: "4.2.1.12.01.16", description: "(-) Reversão PCLD Aluguel", group: "" },
  { reduced: 1052, account: "4.2.1.12.01.17", description: "(-) Reversão Convênio", group: "" },
  { reduced: 1053, account: "4.2.1.12.01.99", description: "Outras Receitas Operacionais", group: "1.4 Outras Receitas" },
];

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeXml = (value: string) => value.replace(/&#xD;|&#13;/gi, "\r").replace(/&#xA;|&#10;/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() || "");
const number = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

async function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return false;
  return (await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, cache: "no-store" })).ok;
}

async function query(company: string, firstDay: string, lastDay: string, accountPrefix: string) {
  const base = (process.env.TOTVS_WS_PRD_BASE_URL || "https://raizeducacao160286.rm.cloudtotvs.com.br:8051").replace(/\/$/, "");
  const user = process.env.TOTVS_WS_PRD_USER;
  const password = process.env.TOTVS_WS_PRD_PASSWORD;
  if (!user || !password) throw new Error("Credenciais técnicas do TOTVS não configuradas.");
  // A ordem é obrigatória no wsConsultaSQL: primeiro parâmetro encontrado na sentença, depois os demais.
  const parameters = `PLN_B7_S=${accountPrefix};PLN_B5_D=${firstDay};PLN_B6_D=${lastDay};PLN_B3_S=${company};PLN_B4_S=${company}`;
  const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><RealizarConsultaSQL xmlns="http://www.totvs.com/"><codSentenca>METTA0909</codSentenca><codColigada>0</codColigada><codSistema>C</codSistema><parameters>${escapeXml(parameters)}</parameters></RealizarConsultaSQL></soap:Body></soap:Envelope>`;
  const response = await fetch(`${base}/wsConsultaSQL/IwsConsultaSQL`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "content-type": "text/xml; charset=utf-8", soapaction: "http://www.totvs.com/IwsConsultaSQL/RealizarConsultaSQL" },
    body: envelope,
    cache: "no-store",
    signal: AbortSignal.timeout(290_000),
  });
  const soap = await response.text();
  if (!response.ok || soap.includes(":Fault>")) throw new Error(tag(soap, "faultstring") || "Falha ao consultar o Razão Completo no TOTVS.");
  const result = decodeXml(tag(soap, "RealizarConsultaSQLResult"));
  return Array.from(result.matchAll(/<Resultado>([\s\S]*?)<\/Resultado>/gi), (match) => match[1]);
}

export async function GET(request: NextRequest) {
  try {
    if (!await authorized(request)) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });

    const [year, month] = competence!.split("-").map(Number);
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    const records = (await Promise.all([
      query(company, firstDay, lastDay, "3.1.1.01"),
      query(company, firstDay, lastDay, "4.2.1.11"),
      query(company, firstDay, lastDay, "4.2.1.12"),
    ])).flat();
    const ruleByAccount = new Map(accountRules.map((rule) => [rule.account, rule]));
    const seen = new Set<string>();
    const rows = records.flatMap((record) => {
      const account = tag(record, "CODCONTA");
      const rule = ruleByAccount.get(account);
      if (!rule) return [];
      const key = [tag(record, "CODCOLIGADA"), tag(record, "CODFILIAL"), tag(record, "IDLANCAMENTO"), account, tag(record, "VALOR")].join("|");
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        company: tag(record, "CODCOLIGADA"),
        branch: tag(record, "CODFILIAL"),
        entryId: tag(record, "IDLANCAMENTO"),
        document: tag(record, "DOCUMENTO"),
        integrationKey: tag(record, "INTEGRACHAVE"),
        sourceSystem: tag(record, "NOMESISTEMA"),
        date: tag(record, "DATA"),
        reduced: number(tag(record, "REDUZIDO")) || rule.reduced,
        account,
        description: tag(record, "DESCRICAO") || rule.description,
        group: rule.group,
        value: number(tag(record, "VALOR")),
        user: tag(record, "USUARIO"),
        complement: tag(record, "COMPLEMENTO"),
        costCenter: tag(record, "CCUSTO"),
      }];
    }).sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account) || a.entryId.localeCompare(b.entryId));

    const accountsWithMovement = new Set(rows.map((row) => row.account)).size;
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return NextResponse.json({
      source: "TOTVS RM — METTA0909 / Razão Completo",
      company,
      competence,
      configuredAccounts: accountRules.length,
      accountsWithMovement,
      recordsChecked: records.length,
      total,
      rows,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins/other-revenues] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
