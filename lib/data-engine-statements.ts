export type DataEngineBankRow = {
  id: string;
  date: string;
  description: string;
  value: number;
};

export type DataEngineStatement = {
  bankId: string;
  sourceAccountId: string;
  rows: DataEngineBankRow[];
  metadata: {
    agency: string;
    account: string;
    period: string;
    name: string;
    openingBalance: null;
    closingBalance: null;
  };
};

type Movement = {
  movimento_id: string;
  cod_coligada: number;
  bank_id: string;
  source_account_id: string;
  data_lancamento: string;
  valor_centavos: number;
  natureza: "C" | "D";
  descricao_sanitizada: string;
};

type MovementPage = {
  items: Movement[];
  next_cursor: string | null;
};

type LoadOptions = {
  apiKey: string;
  baseUrl: string;
  codColigada: number;
  codColigadaCode?: string;
  fetcher?: typeof fetch;
  fromDate: string;
  toDate: string;
};

type BindableAccount = {
  code: string;
};

const PAGE_SIZE = 200;
const MAX_PAGE_REQUESTS = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_ID = /^[a-f0-9]{64}$/i;

function isCalendarDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isMovement(value: unknown): value is Movement {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Movement>;
  return (
    typeof item.movimento_id === "string" &&
    Number.isSafeInteger(item.cod_coligada) &&
    typeof item.bank_id === "string" &&
    typeof item.source_account_id === "string" &&
    ACCOUNT_ID.test(item.source_account_id) &&
    typeof item.data_lancamento === "string" &&
    isCalendarDate(item.data_lancamento) &&
    Number.isSafeInteger(item.valor_centavos) &&
    (item.natureza === "C" || item.natureza === "D") &&
    typeof item.descricao_sanitizada === "string"
  );
}

function parsePage(value: unknown): MovementPage {
  if (!value || typeof value !== "object") {
    throw new Error("Resposta inválida do Data Engine.");
  }
  const page = value as Partial<MovementPage>;
  if (
    !Array.isArray(page.items) ||
    !page.items.every(isMovement) ||
    (page.next_cursor !== null && typeof page.next_cursor !== "string")
  ) {
    throw new Error("Resposta inválida do Data Engine.");
  }
  return { items: page.items, next_cursor: page.next_cursor };
}

function validateOptions(options: LoadOptions) {
  if (!options.apiKey.trim() || !options.baseUrl.trim()) {
    throw new Error("A integração com o Data Engine não está configurada.");
  }
  if (!Number.isSafeInteger(options.codColigada) || options.codColigada <= 0) {
    throw new Error("A coligada informada é inválida.");
  }
  if (
    !ISO_DATE.test(options.fromDate) ||
    !ISO_DATE.test(options.toDate) ||
    options.fromDate > options.toDate
  ) {
    throw new Error("O período informado é inválido.");
  }
}

export function statementPeriod(competence: string) {
  if (!/^\d{4}-\d{2}$/.test(competence)) {
    throw new Error("A competência informada é inválida.");
  }
  const [year, month] = competence.split("-").map(Number);
  if (month < 1 || month > 12) {
    throw new Error("A competência informada é inválida.");
  }
  const paddedMonth = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    fromDate: `${year}-${paddedMonth}-01`,
    toDate: `${year}-${paddedMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function resolveStatementBindings<TAccount extends BindableAccount>(
  sources: DataEngineStatement[],
  accounts: TAccount[],
  bindings: Record<string, string>,
) {
  const claims = new Map<string, number>();
  for (const source of sources) {
    const accountCode = bindings[source.sourceAccountId];
    if (accountCode) claims.set(accountCode, (claims.get(accountCode) ?? 0) + 1);
  }
  const duplicateAccountCodes = Array.from(claims)
    .filter(([, count]) => count > 1)
    .map(([accountCode]) => accountCode)
    .sort();
  if (duplicateAccountCodes.length) {
    return { duplicateAccountCodes, pairs: [] as Array<{ account: TAccount; source: DataEngineStatement }> };
  }

  const pairs = sources.flatMap((source) => {
    const account = accounts.find(
      (candidate) => candidate.code === bindings[source.sourceAccountId],
    );
    return account ? [{ account, source }] : [];
  });
  return { duplicateAccountCodes, pairs };
}

export async function loadDataEngineStatements(
  options: LoadOptions,
): Promise<DataEngineStatement[]> {
  validateOptions(options);
  const fetcher = options.fetcher ?? fetch;
  const movements: Movement[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let requestCount = 0; requestCount < MAX_PAGE_REQUESTS; requestCount += 1) {
    const url = new URL("/v1/tesouraria/extratos/movimentos", options.baseUrl);
    url.searchParams.set(
      "cod_coligada",
      options.codColigadaCode ?? String(options.codColigada).padStart(2, "0"),
    );
    url.searchParams.set("from_date", options.fromDate);
    url.searchParams.set("to_date", options.toDate);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("next_cursor", cursor);

    const response = await fetcher(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-api-key": options.apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`Data Engine indisponível (HTTP ${response.status}).`);
    }

    const page = parsePage(await response.json());
    movements.push(...page.items);
    if (!page.next_cursor) break;
    if (seenCursors.has(page.next_cursor)) {
      throw new Error("O Data Engine retornou cursor de paginação repetido.");
    }
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;

    if (requestCount === MAX_PAGE_REQUESTS - 1) {
      throw new Error("O Data Engine excedeu o limite de páginas da consulta.");
    }
  }

  const period = `${options.fromDate.slice(5, 7)}/${options.fromDate.slice(0, 4)}`;
  const groups = new Map<string, DataEngineStatement>();
  const movementIds = new Set<string>();
  for (const movement of movements) {
    if (
      movement.cod_coligada !== options.codColigada ||
      movement.data_lancamento < options.fromDate ||
      movement.data_lancamento > options.toDate ||
      movementIds.has(movement.movimento_id)
    ) {
      throw new Error("Resposta inválida do Data Engine.");
    }
    movementIds.add(movement.movimento_id);
    let statement = groups.get(movement.source_account_id);
    if (!statement) {
      statement = {
        bankId: movement.bank_id,
        sourceAccountId: movement.source_account_id,
        rows: [],
        metadata: {
          agency: "",
          account: movement.source_account_id.slice(0, 12),
          period,
          name: `Banco ${movement.bank_id}`,
          openingBalance: null,
          closingBalance: null,
        },
      };
      groups.set(movement.source_account_id, statement);
    } else if (statement.bankId !== movement.bank_id) {
      throw new Error("Resposta inválida do Data Engine.");
    }
    statement.rows.push({
      id: movement.movimento_id,
      date: movement.data_lancamento,
      description: movement.descricao_sanitizada,
      value:
        (movement.natureza === "D" ? -1 : 1) *
        (Math.abs(movement.valor_centavos) / 100),
    });
  }

  return Array.from(groups.values())
    .map((statement) => ({
      ...statement,
      rows: statement.rows.sort((left, right) =>
        left.date.localeCompare(right.date),
      ),
    }))
    .sort((left, right) =>
      left.sourceAccountId.localeCompare(right.sourceAccountId),
    );
}
