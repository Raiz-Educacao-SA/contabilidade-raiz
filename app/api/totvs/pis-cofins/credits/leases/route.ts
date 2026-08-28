import { NextRequest, NextResponse } from "next/server";
import { decodedTag, isAuthorized, readDataServerView } from "@/lib/totvs-dataengine";

export const runtime = "nodejs";
export const maxDuration = 300;

const LEASE_ACCOUNT = "2.1.7.01.01.53";
const LEASE_REDUCED_CODE = 2026;
const FINANCIAL_KEY = /^B(\d+)$/i;

const numeric = (value: string) => {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const digitsOnly = (value: string) => value.replace(/\D/g, "");

const isValidCnpj = (value: string) => {
  const digits = digitsOnly(value);
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;

  const checkDigit = (length: number) => {
    let factor = length - 7;
    let total = 0;
    for (let index = 0; index < length; index += 1) {
      total += Number(digits[index]) * factor--;
      if (factor < 2) factor = 9;
    }
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return checkDigit(12) === Number(digits[12]) && checkDigit(13) === Number(digits[13]);
};

const financialEntryId = (integrationKey: string) => integrationKey.match(FINANCIAL_KEY)?.[1] || "";

const chunks = <T,>(items: T[], size: number) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, (index + 1) * size),
);

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthorized(request))) {
      return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
    }

    const company = request.nextUrl.searchParams.get("company")?.trim();
    const competence = request.nextUrl.searchParams.get("competence")?.trim();
    const branches = new Set(
      (request.nextUrl.searchParams.get("branches") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );

    if (!company || !/^\d+$/.test(company) || !/^\d{4}-\d{2}$/.test(competence || "")) {
      return NextResponse.json({ error: "Coligada e competência válidas são obrigatórias." }, { status: 400 });
    }

    const [year, month] = competence!.split("-").map(Number);
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;

    const dataSet = await readDataServerView({
      dataServerName: "CtbLanData",
      filter: [
        `CLANCAMENTO.CODCOLIGADA=${Number(company)}`,
        `CPARTIDA.DATA >= '${firstDay}'`,
        `CPARTIDA.DATA <= '${lastDay}'`,
        `DEBITO='${LEASE_ACCOUNT}'`,
        "INTEGRAAPLICACAO='F'",
      ].join(" AND "),
      context: `CODSISTEMA=C,CODCOLIGADA=${Number(company)}`,
      errorMessage: "Falha ao consultar os créditos de Arrendamentos no TOTVS/DataEngine.",
    });
    const records = Array.from(
      dataSet.matchAll(/<CLANCAMENTO_CPARTIDA>([\s\S]*?)<\/CLANCAMENTO_CPARTIDA>/gi),
      (match) => match[1],
    );

    const candidateRecords = records.filter((record) => {
      const value = numeric(decodedTag(record, "VALOR"));
      const account = decodedTag(record, "DEBITO");
      const financialOrigin = decodedTag(record, "INTEGRAAPLICACAO") === "F";
      const branch = decodedTag(record, "CODFILIAL");
      return account === LEASE_ACCOUNT
        && value > 0
        && financialOrigin
        && (!branches.size || branches.has(branch));
    });

    const financialIds = [...new Set(
      candidateRecords
        .map((record) => financialEntryId(decodedTag(record, "INTEGRACHAVE")))
        .filter(Boolean),
    )];
    const financialRecords: string[] = [];
    for (const group of chunks(financialIds, 150)) {
      const financialDataSet = await readDataServerView({
        dataServerName: "FinLanDataBR",
        filter: `FLAN.CODCOLIGADA=${Number(company)} AND FLAN.IDLAN IN (${group.join(",")})`,
        context: `CODSISTEMA=F,CODCOLIGADA=${Number(company)}`,
        errorMessage: "Falha ao validar o CNPJ dos fornecedores de Arrendamentos no TOTVS Financeiro.",
      });
      financialRecords.push(...Array.from(
        financialDataSet.matchAll(/<FLAN>([\s\S]*?)<\/FLAN>/gi),
        (match) => match[1],
      ));
    }

    const suppliersByFinancialEntry = new Map(financialRecords.map((record) => {
      const supplierDocument = digitsOnly(decodedTag(record, "CGCCFO"));
      return [decodedTag(record, "IDLAN"), {
        supplierCode: decodedTag(record, "CODCFO"),
        supplierName: decodedTag(record, "NOMEFANTASIA", "NOME"),
        supplierDocument,
        hasValidCnpj: isValidCnpj(supplierDocument),
      }] as const;
    }));

    const seen = new Set<string>();
    let excludedCpf = 0;
    let excludedWithoutValidCnpj = 0;
    const rows = candidateRecords.flatMap((record) => {
      const integrationKey = decodedTag(record, "INTEGRACHAVE");
      const supplier = suppliersByFinancialEntry.get(financialEntryId(integrationKey));
      if (!supplier?.hasValidCnpj) {
        if (supplier?.supplierDocument.length === 11) excludedCpf += 1;
        else excludedWithoutValidCnpj += 1;
        return [];
      }

      const reduced = numeric(decodedTag(record, "REDUZIDODEBITO"));
      const value = numeric(decodedTag(record, "VALOR"));
      const account = decodedTag(record, "DEBITO");
      const branch = decodedTag(record, "CODFILIAL");

      const key = [
        decodedTag(record, "CODCOLIGADA"),
        branch,
        decodedTag(record, "IDLANCAMENTO"),
        decodedTag(record, "IDPARTIDA"),
      ].join("|");
      if (seen.has(key)) return [];
      seen.add(key);

      return [{
        company: decodedTag(record, "CODCOLIGADA"),
        branch,
        entryId: decodedTag(record, "IDLANCAMENTO"),
        document: decodedTag(record, "DOCUMENTO"),
        integrationKey,
        sourceSystem: "Financeiro",
        date: decodedTag(record, "DATA"),
        reduced: reduced || LEASE_REDUCED_CODE,
        account,
        description: decodedTag(record, "DESCRICAODEBITO", "DESCRICAO") || "Arrendamentos",
        value,
        user: decodedTag(record, "USUARIO"),
        complement: decodedTag(record, "COMPLEMENTO"),
        costCenter: decodedTag(record, "CODCCUSTO", "CODCCUSTODEBITO", "CCUSTO"),
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        supplierDocument: supplier.supplierDocument,
        supplierDocumentType: "CNPJ",
      }];
    }).sort((left, right) => left.date.localeCompare(right.date) || left.branch.localeCompare(right.branch, "pt-BR", { numeric: true }));

    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return NextResponse.json({
      source: "TOTVS RM — CtbLanData / Lançamentos contábeis",
      supplierSource: "TOTVS RM Financeiro — FinLanDataBR / CGCCFO",
      company,
      competence,
      account: LEASE_ACCOUNT,
      reduced: LEASE_REDUCED_CODE,
      identification: "Conta a débito 2.1.7.01.01.53; todos os valores a débito; INTEGRAAPLICACAO=F (Financeiro); somente fornecedor com CNPJ válido; CPF excluído",
      rows,
      totals: {
        records: rows.length,
        accountingValue: total,
        excludedCpf,
        excludedWithoutValidCnpj,
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    console.error("[api/totvs/pis-cofins/credits/leases] consultation failed", { message: (cause as Error).message });
    return NextResponse.json({ error: (cause as Error).message }, { status: 503 });
  }
}
