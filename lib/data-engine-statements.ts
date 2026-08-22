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

export type DataEngineStatementOperations = {
  movimentos: number;
  saldos: number;
  posicoes: number;
  cobertura: number;
  pendencias: number;
};

export type DataEngineStatementSnapshot = {
  statements: DataEngineStatement[];
  operations: DataEngineStatementOperations;
  diagnostics: {
    recognizedWithoutMovements: number;
    sourceCandidates: {
      saldos: number;
      posicoes: number;
      cobertura: number;
    };
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

type GovernedPage = {
  items: Array<Record<string, unknown>>;
  next_cursor: string | null;
};

type LoadOptions = {
  accessToken: string;
  baseUrl: string;
  codColigada: number;
  codColigadaCode?: string;
  fetcher?: typeof fetch;
  fromDate: string;
  toDate: string;
};

type BindableAccount = {
  code: string;
  name?: string;
  rows?: Array<{
    date?: Date | string;
    value: number;
  }>;
};

const PAGE_SIZE = 200;
const MAX_PAGE_REQUESTS = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SOURCE_ACCOUNT_ID_LENGTH = 256;
const APPLICATION_ACCOUNT_PATTERN = /APLIC|INVESTIMENTO|CDB|FUNDO/iu;

function isAnonymousApplicationStatement(statement: DataEngineStatement) {
  return (
    statement.rows.length === 0 &&
    statement.bankId.padStart(3, "0") === "000" &&
    APPLICATION_ACCOUNT_PATTERN.test(
      `${statement.metadata.name} ${statement.metadata.account}`,
    ) &&
    !/\d/.test(statement.metadata.account)
  );
}

export class DataEngineHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Data Engine indisponível (HTTP ${status}).`);
    this.status = status;
  }
}

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
    item.source_account_id.trim().length > 0 &&
    item.source_account_id.length <= MAX_SOURCE_ACCOUNT_ID_LENGTH &&
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

function parseGovernedPage(value: unknown, codColigada: number): GovernedPage {
  if (!value || typeof value !== "object") {
    throw new Error("Resposta inválida do Data Engine.");
  }
  const page = value as Partial<GovernedPage>;
  if (
    !Array.isArray(page.items) ||
    !page.items.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).cod_coligada === codColigada,
    ) ||
    (page.next_cursor !== null && typeof page.next_cursor !== "string")
  ) {
    throw new Error("Resposta inválida do Data Engine.");
  }
  return {
    items: page.items as Array<Record<string, unknown>>,
    next_cursor: page.next_cursor,
  };
}

function validateOptions(options: LoadOptions) {
  if (!options.accessToken.trim() || !options.baseUrl.trim()) {
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
) {
  const normalizeDigits = (value: unknown) =>
    String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const compatible = (left: unknown, right: unknown) => {
    const a = normalizeDigits(left);
    const b = normalizeDigits(right);
    return a.length >= 4 && b.length >= 4 && (a === b || a.endsWith(b) || b.endsWith(a));
  };
  const bankNames: Record<string, RegExp> = {
    "001": /BANCO DO BRASIL|\bBB\b/i,
    "033": /SANTANDER/i,
    "104": /CAIXA/i,
    "237": /BRADESCO/i,
    "341": /ITA[UÚ]/i,
    "422": /SAFRA/i,
    "748": /SICREDI/i,
    "756": /SICOOB/i,
  };
  let anonymousApplicationSeen = false;
  const normalizedSources = sources.flatMap((source) => {
    if (!isAnonymousApplicationStatement(source)) return [source];
    if (anonymousApplicationSeen) return [];
    anonymousApplicationSeen = true;
    return [source];
  });
  const remainingAccounts = new Map(accounts.map((account) => [account.code, account]));
  const remainingSources = new Map(
    normalizedSources.map((source) => [source.sourceAccountId, source]),
  );
  const pairs: Array<{ account: TAccount; source: DataEngineStatement }> = [];
  const bindUnique = (source: DataEngineStatement, candidates: TAccount[]) => {
    if (candidates.length !== 1) return false;
    const account = candidates[0];
    pairs.push({ account, source });
    remainingAccounts.delete(account.code);
    remainingSources.delete(source.sourceAccountId);
    return true;
  };
  const day = (value: Date | string | undefined) => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  };
  const cents = (value: number) => Math.round(value * 100);
  const movementEvidence = (source: DataEngineStatement, account: TAccount) => {
    const accountRows = account.rows ?? [];
    const used = new Set<number>();
    let sameDay = 0;
    let sameMonth = 0;

    for (const sourceRow of source.rows) {
      const exactIndex = accountRows.findIndex(
        (row, index) =>
          !used.has(index) &&
          cents(row.value) === cents(sourceRow.value) &&
          day(row.date) === sourceRow.date,
      );
      if (exactIndex >= 0) {
        used.add(exactIndex);
        sameDay += 1;
        continue;
      }
      const monthIndex = accountRows.findIndex(
        (row, index) =>
          !used.has(index) && cents(row.value) === cents(sourceRow.value),
      );
      if (monthIndex >= 0) {
        used.add(monthIndex);
        sameMonth += 1;
      }
    }
    return sameDay * 1000 + sameMonth;
  };
  const bindByMovementEvidence = (
    source: DataEngineStatement,
    candidates: TAccount[],
  ) => {
    const ranked = candidates
      .map((account) => ({ account, score: movementEvidence(source, account) }))
      .sort((left, right) => right.score - left.score);
    if (!ranked[0]?.score || ranked[0].score === ranked[1]?.score) return false;
    return bindUnique(source, [ranked[0].account]);
  };

  // Prioridade 1: número da conta presente nos metadados do extrato.
  for (const source of normalizedSources) {
    bindUnique(
      source,
      Array.from(remainingAccounts.values()).filter((account) =>
        [account.code, account.name].some((value) => compatible(value, source.metadata.account)),
      ),
    );
  }
  // Prioridade 2: código do banco quando ele identifica uma única conta contábil.
  for (const source of Array.from(remainingSources.values())) {
    const bankPattern = bankNames[source.bankId.padStart(3, "0")];
    if (!bankPattern) continue;
    const candidates = Array.from(remainingAccounts.values()).filter((account) =>
      bankPattern.test(account.name ?? ""),
    );
    if (bindByMovementEvidence(source, candidates)) continue;
    bindUnique(source, candidates);
  }
  // Prioridade 3: uma referência anônima de aplicação pertence à única conta
  // contábil identificada nominalmente como aplicação ou investimento.
  for (const source of Array.from(remainingSources.values())) {
    if (!isAnonymousApplicationStatement(source)) continue;
    bindUnique(
      source,
      Array.from(remainingAccounts.values()).filter((account) =>
        APPLICATION_ACCOUNT_PATTERN.test(account.name ?? ""),
      ),
    );
  }
  // Último caso seguro: resta exatamente um extrato e uma conta.
  if (remainingSources.size === 1 && remainingAccounts.size === 1) {
    bindUnique(
      Array.from(remainingSources.values())[0],
      Array.from(remainingAccounts.values()),
    );
  }

  return {
    pairs,
    unmatchedSources: Array.from(remainingSources.values()),
    unmatchedAccounts: Array.from(remainingAccounts.values()),
  };
}

function governedText(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function governedSourceIdentity(record: Record<string, unknown>) {
  return governedText(record, [
    "source_account_id",
    "sourceAccountId",
    "bank_account_id",
    "account_id",
    "conta_bancaria_id",
    "conta_origem_id",
    "id_conta_origem",
  ]);
}

function applicationPositionIdentity(position: Record<string, unknown>) {
  const explicitSource = governedSourceIdentity(position);
  if (explicitSource) return explicitSource;

  const bankId = governedText(position, [
    "bank_id",
    "codigo_banco",
    "bank_code",
    "cod_banco",
  ]);
  const agency = governedText(position, [
    "agency",
    "agencia",
    "branch_number",
    "numero_agencia",
  ]);
  const account = governedText(position, [
    "account_number",
    "numero_conta",
    "conta_bancaria",
    "conta",
  ]);
  if (account) {
    return `aplicacao:${bankId || "000"}:${agency}:${account}`;
  }

  const product = governedText(position, [
    "product_name",
    "nome_produto",
    "application_name",
    "nome_aplicacao",
    "fund_name",
    "nome_fundo",
    "tipo_aplicacao",
  ]);
  if (product) return `aplicacao:${bankId || "000"}:${product}`;

  // A operação governada pode devolver apenas posicao_aplicacao_id e a
  // coligada. Nesse contrato, todas as posições sem identificador bancário
  // explícito representam a mesma fonte de aplicação da competência.
  return "aplicacao:posicao";
}

function positionBelongsToPeriod(
  position: Record<string, unknown>,
  fromDate: string,
  toDate: string,
) {
  const reference = governedText(position, [
    "data_posicao",
    "dt_posicao",
    "data_base",
    "data",
    "position_date",
    "data_referencia",
    "reference_date",
    "competencia",
    "periodo",
    "period",
  ]);
  if (!reference) return true;
  const calendarDate = reference.slice(0, 10);
  if (ISO_DATE.test(calendarDate)) {
    return calendarDate >= fromDate && calendarDate <= toDate;
  }
  const competence = fromDate.slice(0, 7);
  if (/^\d{4}-\d{2}/.test(reference)) {
    return reference.slice(0, 7) === competence;
  }
  const monthYear = reference.match(/^(\d{2})\/(\d{4})$/);
  return monthYear
    ? `${monthYear[2]}-${monthYear[1]}` === competence
    : true;
}

export function mergeApplicationPositionStatements(
  statements: DataEngineStatement[],
  positions: Array<Record<string, unknown>>,
  period: { fromDate: string; toDate: string },
) {
  const recognized = [...statements];
  const knownSources = new Set(
    statements.map((statement) => statement.sourceAccountId),
  );
  let anonymousApplicationSeen = statements.some(
    isAnonymousApplicationStatement,
  );
  const displayPeriod = `${period.fromDate.slice(5, 7)}/${period.fromDate.slice(0, 4)}`;

  for (const position of positions) {
    const sourceAccountId = applicationPositionIdentity(position);
    if (
      !sourceAccountId ||
      sourceAccountId.length > MAX_SOURCE_ACCOUNT_ID_LENGTH ||
      knownSources.has(sourceAccountId) ||
      !positionBelongsToPeriod(position, period.fromDate, period.toDate)
    ) {
      continue;
    }
    const bankId = governedText(position, [
      "bank_id",
      "codigo_banco",
      "bank_code",
      "cod_banco",
    ]) || "000";
    const account = governedText(position, [
      "account_number",
      "numero_conta",
      "conta_bancaria",
      "conta",
    ]);
    const agency = governedText(position, [
      "agency",
      "agencia",
      "branch_number",
      "numero_agencia",
    ]);
    const product = governedText(position, [
      "product_name",
      "nome_produto",
      "application_name",
      "nome_aplicacao",
      "fund_name",
      "nome_fundo",
      "tipo_aplicacao",
    ]);
    const bankName = governedText(position, ["bank_name", "nome_banco"]);
    const name = product
      ? `Aplicação · ${product}`
      : bankName
        ? `${bankName} · Aplicação`
        : bankId !== "000"
          ? `Banco ${bankId} · Aplicação`
          : "Aplicação financeira";

    const statement: DataEngineStatement = {
      bankId,
      sourceAccountId,
      rows: [],
      metadata: {
        agency,
        account: account || "Aplicação",
        period: displayPeriod,
        name,
        openingBalance: null,
        closingBalance: null,
      },
    };
    if (
      isAnonymousApplicationStatement(statement) &&
      anonymousApplicationSeen
    ) {
      continue;
    }
    recognized.push(statement);
    knownSources.add(sourceAccountId);
    anonymousApplicationSeen ||= isAnonymousApplicationStatement(statement);
  }

  return recognized.sort((left, right) =>
    left.sourceAccountId.localeCompare(right.sourceAccountId),
  );
}

async function loadGovernedSourceSummary(
  path: string,
  options: LoadOptions,
  allowApplicationFallback: boolean,
) {
  const fetcher = options.fetcher ?? fetch;
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let records = 0;
  const sourceRecords = new Map<string, Record<string, unknown>>();

  for (let requestCount = 0; requestCount < MAX_PAGE_REQUESTS; requestCount += 1) {
    const url = new URL(path, options.baseUrl);
    url.searchParams.set(
      "cod_coligada",
      options.codColigadaCode ?? String(options.codColigada).padStart(2, "0"),
    );
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetcher(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.accessToken}`,
      },
    });
    if (!response.ok) {
      throw new DataEngineHttpError(response.status);
    }

    const page = parseGovernedPage(await response.json(), options.codColigada);
    records += page.items.length;
    for (const item of page.items) {
      if (!positionBelongsToPeriod(item, options.fromDate, options.toDate)) {
        continue;
      }
      const sourceAccountId = allowApplicationFallback
        ? applicationPositionIdentity(item)
        : governedSourceIdentity(item);
      if (
        !sourceAccountId ||
        sourceAccountId.length > MAX_SOURCE_ACCOUNT_ID_LENGTH ||
        sourceRecords.has(sourceAccountId)
      ) {
        continue;
      }
      sourceRecords.set(sourceAccountId, item);
    }
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

  return { records, sourceRecords: Array.from(sourceRecords.values()) };
}

async function countGovernedOperation(path: string, options: LoadOptions) {
  const fetcher = options.fetcher ?? fetch;
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let records = 0;

  for (let requestCount = 0; requestCount < MAX_PAGE_REQUESTS; requestCount += 1) {
    const url = new URL(path, options.baseUrl);
    url.searchParams.set(
      "cod_coligada",
      options.codColigadaCode ?? String(options.codColigada).padStart(2, "0"),
    );
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetcher(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.accessToken}`,
      },
    });
    if (!response.ok) {
      throw new DataEngineHttpError(response.status);
    }

    const page = parseGovernedPage(await response.json(), options.codColigada);
    records += page.items.length;
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

  return records;
}

export async function loadDataEngineStatementSnapshot(
  options: LoadOptions,
): Promise<DataEngineStatementSnapshot> {
  validateOptions(options);
  const [statements, saldos, positions, cobertura, pendencias] =
    await Promise.all([
      loadDataEngineStatements(options),
      loadGovernedSourceSummary(
        "/v1/tesouraria/extratos/saldos",
        options,
        false,
      ),
      loadGovernedSourceSummary(
        "/v1/tesouraria/extratos/posicoes",
        options,
        true,
      ),
      loadGovernedSourceSummary(
        "/v1/tesouraria/extratos/cobertura",
        options,
        false,
      ),
      countGovernedOperation("/v1/tesouraria/extratos/pendencias", options),
    ]);
  const recognizedStatements = mergeApplicationPositionStatements(
    statements,
    [
      ...saldos.sourceRecords,
      ...positions.sourceRecords,
      ...cobertura.sourceRecords,
    ],
    options,
  );
  return {
    statements: recognizedStatements,
    diagnostics: {
      recognizedWithoutMovements:
        recognizedStatements.length - statements.length,
      sourceCandidates: {
        saldos: saldos.sourceRecords.length,
        posicoes: positions.sourceRecords.length,
        cobertura: cobertura.sourceRecords.length,
      },
    },
    operations: {
      movimentos: statements.reduce(
        (total, statement) => total + statement.rows.length,
        0,
      ),
      saldos: saldos.records,
      posicoes: positions.records,
      cobertura: cobertura.records,
      pendencias,
    },
  };
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
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetcher(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.accessToken}`,
      },
    });
    if (!response.ok) {
      throw new DataEngineHttpError(response.status);
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
