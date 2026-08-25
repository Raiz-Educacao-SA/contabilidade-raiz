import {
  BANK_RECONCILIATION_TOLERANCE,
  BANK_RECONCILIATION_TOLERANCE_CENTS,
  BANK_STATEMENT_SOURCE_PRIORITY,
} from "./bank-reconciliation-policy.ts";

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
  pendenciasUtilizadas: number;
};

export type DataEngineStatementSnapshot = {
  statements: DataEngineStatement[];
  operations: DataEngineStatementOperations;
  diagnostics: {
    applicationMovementsUsed: number;
    recognizedWithoutMovements: number;
    pendingFieldsObserved: string[];
    positionFieldsObserved: string[];
    pendingObjectsInspected: number;
    pendingMovementsUsed: number;
    pendingSourcesUsed: number;
    pendingSummary: {
      evidenceExtensions: Record<string, number>;
      evidenceForPeriod: number;
      kinds: Record<string, number>;
      reasons: Record<string, number>;
      sourceAccounts: number;
      statuses: Record<string, number>;
    };
    sourceCandidates: {
      saldos: number;
      posicoes: number;
      cobertura: number;
    };
  };
};

type Movement = {
  movimento_id: string;
  canonical_movement_id?: string;
  cod_coligada: number;
  bank_id: string;
  source_account_id: string;
  data_lancamento: string;
  valor_centavos: number;
  natureza: "C" | "D";
  descricao_sanitizada: string;
  documento_hash?: string;
  canal?: string;
  file_name?: string;
  filename?: string;
  nome_arquivo?: string;
  object_name?: string;
  mime_type?: string;
  content_type?: string;
  file_extension?: string;
  source_format?: string;
  formato?: string;
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
  sourceEvidence?: Array<Record<string, unknown>>;
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
const MAX_PENDING_OBJECTS = 10_000;
const MAX_PENDING_DEPTH = 6;
const APPLICATION_ACCOUNT_PATTERN = /APLIC|INVESTIMENTO|CDB|FUNDO/iu;

function isApplicationStatement(statement: DataEngineStatement) {
  return APPLICATION_ACCOUNT_PATTERN.test(
    `${statement.sourceAccountId} ${statement.metadata.name} ${statement.metadata.account}`,
  );
}

function isAnonymousApplicationStatement(statement: DataEngineStatement) {
  return (
    statement.rows.length === 0 &&
    statement.bankId.padStart(3, "0") === "000" &&
    isApplicationStatement(statement) &&
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
  const day = (value: Date | string | undefined) => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  };
  const cents = (value: number) => Math.round(value * 100);
  const bankNames: Record<string, RegExp> = {
    "001": /BANCO DO BRASIL|\bBB\b/i,
    "033": /SANTANDER/i,
    "104": /CAIXA/i,
    "707": /DAYCOVAL/i,
    "237": /BRADESCO/i,
    "341": /ITA[UÚ]/i,
    "422": /SAFRA/i,
    "637": /SOFISA/i,
    "748": /SICREDI/i,
    "756": /SICOOB/i,
  };
  let anonymousApplicationSeen = false;
  let normalizedSources = sources.flatMap((source) => {
    if (!isAnonymousApplicationStatement(source)) return [source];
    if (anonymousApplicationSeen) return [];
    anonymousApplicationSeen = true;
    return [source];
  });

  // Alguns PDFs de aplicação do Santander chegam no endpoint de movimentos
  // com a mesma referência técnica da conta corrente. Nessa situação, o Data
  // Engine não informa a qual extrato pertence cada lançamento. A separação só
  // é feita quando há uma única conta e uma única fonte de aplicação, o banco
  // é inequívoco e os movimentos reais fecham com a conta contábil no mês.
  const applicationAccounts = accounts.filter((account) =>
    APPLICATION_ACCOUNT_PATTERN.test(account.name ?? ""),
  );
  const emptyApplicationSources = normalizedSources.filter(
    (source) => isApplicationStatement(source) && source.rows.length === 0,
  );
  if (applicationAccounts.length === 1 && emptyApplicationSources.length === 1) {
    const applicationAccount = applicationAccounts[0];
    const applicationBank = Object.entries(bankNames).find(([, pattern]) =>
      pattern.test(applicationAccount.name ?? ""),
    )?.[0];
    const transactionSources = applicationBank
      ? normalizedSources.filter(
          (source) =>
            !isApplicationStatement(source) &&
            source.bankId.padStart(3, "0") === applicationBank,
        )
      : [];

    if (applicationBank && transactionSources.length === 1) {
      const transactionSource = transactionSources[0];
      const dailyTargets = new Map<string, number>();
      for (const row of applicationAccount.rows ?? []) {
        const rowDay = day(row.date);
        if (!rowDay) continue;
        dailyTargets.set(
          rowDay,
          (dailyTargets.get(rowDay) ?? 0) + cents(row.value),
        );
      }

      const selectNearTarget = (
        rows: DataEngineBankRow[],
        target: number,
      ) => {
        const absoluteTarget = Math.abs(target);
        if (!absoluteTarget) return [] as DataEngineBankRow[];
        // Um desvio de até R$ 1,00 permite identificar lançamentos líquidos
        // sujeitos a centavos de IOF/IR sem esconder diferenças relevantes.
        const tolerance = BANK_RECONCILIATION_TOLERANCE_CENTS;
        const candidates = rows.filter((row) => cents(row.value) * target > 0);
        if (!candidates.length) {
          return [] as DataEngineBankRow[];
        }
        const allCandidatesTotal = candidates.reduce(
          (total, row) => total + Math.abs(cents(row.value)),
          0,
        );
        if (Math.abs(allCandidatesTotal - absoluteTarget) <= tolerance) {
          return candidates;
        }
        const single = candidates
          .map((row) => ({
            difference: Math.abs(Math.abs(cents(row.value)) - absoluteTarget),
            row,
          }))
          .filter(({ difference }) => difference <= tolerance)
          .sort((left, right) => left.difference - right.difference)[0];
        if (single) return [single.row];

        let bestPair: {
          difference: number;
          rows: [DataEngineBankRow, DataEngineBankRow];
        } | null = null;
        for (let left = 0; left < candidates.length; left += 1) {
          for (let right = left + 1; right < candidates.length; right += 1) {
            const total =
              Math.abs(cents(candidates[left].value)) +
              Math.abs(cents(candidates[right].value));
            const difference = Math.abs(total - absoluteTarget);
            if (
              difference <= tolerance &&
              (!bestPair || difference < bestPair.difference)
            ) {
              bestPair = {
                difference,
                rows: [candidates[left], candidates[right]],
              };
            }
          }
        }
        if (bestPair) return bestPair.rows;
        if (candidates.length > 32) return [] as DataEngineBankRow[];

        const ceiling = absoluteTarget + tolerance;
        const split = Math.ceil(candidates.length / 2);
        const subsetSums = (start: number, end: number) => {
          const subsets: Array<{ indexes: number[]; sum: number }> = [
            { indexes: [], sum: 0 },
          ];
          for (let index = start; index < end; index += 1) {
            const amount = Math.abs(cents(candidates[index].value));
            const currentLength = subsets.length;
            for (let current = 0; current < currentLength; current += 1) {
              const next = subsets[current].sum + amount;
              if (next > ceiling) continue;
              subsets.push({
                indexes: [...subsets[current].indexes, index],
                sum: next,
              });
            }
          }
          return subsets;
        };
        const left = subsetSums(0, split);
        const right = subsetSums(split, candidates.length).sort(
          (a, b) => a.sum - b.sum || a.indexes.length - b.indexes.length,
        );
        let best: { difference: number; indexes: number[] } | null = null;
        for (const leftSubset of left) {
          const wanted = absoluteTarget - leftSubset.sum;
          let low = 0;
          let high = right.length;
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (right[middle].sum < wanted) low = middle + 1;
            else high = middle;
          }
          for (const rightIndex of [low - 1, low]) {
            const rightSubset = right[rightIndex];
            if (!rightSubset) continue;
            const sum = leftSubset.sum + rightSubset.sum;
            const difference = Math.abs(sum - absoluteTarget);
            const indexes = [
              ...leftSubset.indexes,
              ...rightSubset.indexes,
            ];
            if (
              !sum ||
              difference > tolerance ||
              (best &&
                (difference > best.difference ||
                  (difference === best.difference &&
                    indexes.length >= best.indexes.length)))
            ) {
              continue;
            }
            best = { difference, indexes };
          }
        }
        return best ? best.indexes.map((index) => candidates[index]) : [];
      };

      const selectMonthlyComplement = (
        rows: DataEngineBankRow[],
        target: number,
      ) => {
        const quickSelection = selectNearTarget(rows, target);
        if (quickSelection.length) return quickSelection;

        const absoluteTarget = Math.abs(target);
        const tolerance = BANK_RECONCILIATION_TOLERANCE_CENTS;
        const maximumTarget = 25_000_000;
        const candidates = rows.filter((row) => {
          const amount = Math.abs(cents(row.value));
          return (
            cents(row.value) * target > 0 &&
            amount > 0 &&
            amount <= absoluteTarget + tolerance
          );
        });
        if (
          !absoluteTarget ||
          absoluteTarget > maximumTarget ||
          candidates.length < 3 ||
          candidates.length > 600
        ) {
          return [] as DataEngineBankRow[];
        }

        const maximumSum = absoluteTarget + tolerance;
        const mask = (1n << BigInt(maximumSum + 1)) - 1n;
        const blockSize = 12;
        const blocks: DataEngineBankRow[][] = [];
        const snapshots: bigint[] = [1n];
        let reachable = 1n;
        for (let start = 0; start < candidates.length; start += blockSize) {
          const block = candidates.slice(start, start + blockSize);
          blocks.push(block);
          for (const row of block) {
            reachable =
              (reachable |
                (reachable << BigInt(Math.abs(cents(row.value))))) &
              mask;
          }
          snapshots.push(reachable);
        }

        const isReachable = (bits: bigint, sum: number) =>
          sum >= 0 && ((bits >> BigInt(sum)) & 1n) === 1n;
        let selectedSum = -1;
        for (let difference = 0; difference <= tolerance; difference += 1) {
          for (const candidateSum of [
            absoluteTarget - difference,
            absoluteTarget + difference,
          ]) {
            if (
              candidateSum >= 0 &&
              candidateSum <= maximumSum &&
              isReachable(reachable, candidateSum)
            ) {
              selectedSum = candidateSum;
              break;
            }
          }
          if (selectedSum >= 0) break;
        }
        if (selectedSum < 0) return [] as DataEngineBankRow[];

        const selectedRows: DataEngineBankRow[] = [];
        let remaining = selectedSum;
        for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
          const block = blocks[blockIndex];
          const previousReachable = snapshots[blockIndex];
          const subsetCount = 1 << block.length;
          const subsetSums = new Int32Array(subsetCount);
          let selectedMask = -1;
          for (let subset = 0; subset < subsetCount; subset += 1) {
            if (subset > 0) {
              const leastBit = subset & -subset;
              const itemIndex = Math.log2(leastBit);
              subsetSums[subset] =
                subsetSums[subset ^ leastBit] +
                Math.abs(cents(block[itemIndex].value));
            }
            const previousSum = remaining - subsetSums[subset];
            if (isReachable(previousReachable, previousSum)) {
              selectedMask = subset;
              remaining = previousSum;
              break;
            }
          }
          if (selectedMask < 0) return [] as DataEngineBankRow[];
          for (let itemIndex = 0; itemIndex < block.length; itemIndex += 1) {
            if (selectedMask & (1 << itemIndex)) {
              selectedRows.push(block[itemIndex]);
            }
          }
        }
        return remaining === 0 ? selectedRows : [];
      };

      const selectedIds = new Set<string>();
      const exactCandidates: DataEngineBankRow[] = [];
      const accountingRows = [...(applicationAccount.rows ?? [])].sort(
        (left, right) => day(left.date).localeCompare(day(right.date)),
      );

      // A conta corrente e a aplicação podem chegar misturadas na mesma
      // referência técnica. Primeiro localizamos os valores exatos da aplicação
      // no mês inteiro, pois a data bancária pode diferir da contabilização.
      // Em seguida, completamos o saldo residual pela soma líquida do dia.
      for (const accountingRow of accountingRows) {
        const accountingValue = cents(accountingRow.value);
        const accountingDay = day(accountingRow.date);
        const candidates = transactionSource.rows
          .filter(
            (row) =>
              !selectedIds.has(row.id) && cents(row.value) === accountingValue,
          )
          .sort(
            (left, right) =>
              Number(right.date === accountingDay) -
                Number(left.date === accountingDay) ||
              left.date.localeCompare(right.date),
          );
        const candidate = candidates[0];
        if (!candidate) continue;
        selectedIds.add(candidate.id);
        exactCandidates.push(candidate);
      }

      const selectedApplicationRows: DataEngineBankRow[] = [...exactCandidates];

      const monthlyTarget = accountingRows.reduce(
        (total, row) => total + cents(row.value),
        0,
      );
      const selectedApplicationIds = new Set(
        selectedApplicationRows.map((row) => row.id),
      );

      // Um lançamento do extrato pode representar a soma líquida de vários
      // lançamentos contábeis, e o inverso também ocorre. Completamos primeiro
      // cada dia para não confundir movimentos da conta corrente com a
      // aplicação quando há mais de um agrupamento pendente no mês.
      for (const [date, dailyTarget] of Array.from(dailyTargets).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        const alreadySelectedForDay = selectedApplicationRows
          .filter((row) => row.date === date)
          .reduce((total, row) => total + cents(row.value), 0);
        const dailyResidualTarget = dailyTarget - alreadySelectedForDay;
        if (!dailyResidualTarget) continue;
        const rowsForDay = transactionSource.rows.filter(
          (row) => row.date === date && !selectedApplicationIds.has(row.id),
        );
        const residualRows = selectNearTarget(rowsForDay, dailyResidualTarget);
        if (!residualRows.length) continue;
        selectedApplicationRows.push(...residualRows);
        residualRows.forEach((row) => selectedApplicationIds.add(row.id));
      }

      let selectedTotal = selectedApplicationRows.reduce(
        (total, row) => total + cents(row.value),
        0,
      );
      const residualTarget = monthlyTarget - selectedTotal;

      // Se a data bancária diferir da contabilização, a última parcela pode
      // estar em outro dia da competência. O fechamento mensal continua sendo
      // a regra principal.
      if (residualTarget) {
        for (const date of Array.from(dailyTargets.keys()).sort()) {
          const rowsForDay = transactionSource.rows.filter(
            (row) =>
              row.date === date && !selectedApplicationIds.has(row.id),
          );
          const residualRows = selectNearTarget(rowsForDay, residualTarget);
          if (!residualRows.length) continue;
          const residualTotal = residualRows.reduce(
            (total, row) => total + cents(row.value),
            0,
          );
          selectedApplicationRows.push(...residualRows);
          residualRows.forEach((row) => selectedApplicationIds.add(row.id));
          selectedTotal += residualTotal;
          break;
        }
      }

      const monthlyTolerance = BANK_RECONCILIATION_TOLERANCE_CENTS;
      const completeMonthlySplit =
        selectedApplicationRows.length > 0 &&
        Math.abs(selectedTotal - monthlyTarget) <= monthlyTolerance;

      if (completeMonthlySplit) {
        const applicationSource = emptyApplicationSources[0];
        let currentRows = [...transactionSource.rows];
        const currentAccounts = accounts.filter(
          (account) =>
            account.code !== applicationAccount.code &&
            !APPLICATION_ACCOUNT_PATTERN.test(account.name ?? "") &&
            bankNames[applicationBank]?.test(account.name ?? ""),
        );

        if (currentAccounts.length === 1) {
          const currentAccountingRows = [...(currentAccounts[0].rows ?? [])].sort(
            (left, right) => day(left.date).localeCompare(day(right.date)),
          );

          const totalInDirection = (
            rows: Array<{ value: number }>,
            direction: number,
          ) =>
            rows
              .filter((row) => Math.sign(cents(row.value)) === direction)
              .reduce((total, row) => total + Math.abs(cents(row.value)), 0);
          const currentDebitTarget = totalInDirection(currentAccountingRows, 1);
          const currentCreditTarget = totalInDirection(currentAccountingRows, -1);
          const currentMonthlyTarget = currentAccountingRows.reduce(
            (total, row) => total + cents(row.value),
            0,
          );
          const rawDebitTotal = totalInDirection(currentRows, 1);
          const rawCreditTotal = totalInDirection(currentRows, -1);
          const debitExcess = rawDebitTotal - currentDebitTarget;
          const creditExcess = rawCreditTotal - currentCreditTarget;
          let complementComplete = false;
          const sourceSelectionToleranceCents = 1;

          const currentDates = Array.from(
            new Set([
              ...currentRows.map((row) => row.date),
              ...currentAccountingRows.map((row) => day(row.date)),
            ].filter(Boolean)),
          ).sort();
          const dailyExcludedIds = new Set<string>();
          let dailyComplementPossible = true;
          for (const date of currentDates) {
            for (const direction of [1, -1] as const) {
              const rowsForDay = currentRows.filter(
                (row) =>
                  row.date === date &&
                  Math.sign(cents(row.value)) === direction &&
                  !dailyExcludedIds.has(row.id),
              );
              const rawDailyTotal = totalInDirection(rowsForDay, direction);
              const targetDailyTotal = totalInDirection(
                currentAccountingRows.filter((row) => day(row.date) === date),
                direction,
              );
              const dailyExcess = rawDailyTotal - targetDailyTotal;
              if (dailyExcess < -sourceSelectionToleranceCents) {
                dailyComplementPossible = false;
                break;
              }
              if (dailyExcess <= sourceSelectionToleranceCents) continue;
              const auxiliaryRows = selectNearTarget(
                rowsForDay,
                direction * dailyExcess,
              );
              const auxiliaryTotal = totalInDirection(auxiliaryRows, direction);
              if (
                !auxiliaryRows.length ||
                Math.abs(auxiliaryTotal - dailyExcess) >
                  sourceSelectionToleranceCents
              ) {
                dailyComplementPossible = false;
                break;
              }
              auxiliaryRows.forEach((row) => dailyExcludedIds.add(row.id));
            }
            if (!dailyComplementPossible) break;
          }
          if (dailyComplementPossible && dailyExcludedIds.size > 0) {
            const complementRows = currentRows.filter(
              (row) => !dailyExcludedIds.has(row.id),
            );
            complementComplete = currentDates.every((date) =>
              ([1, -1] as const).every((direction) => {
                const selected = totalInDirection(
                  complementRows.filter((row) => row.date === date),
                  direction,
                );
                const target = totalInDirection(
                  currentAccountingRows.filter((row) => day(row.date) === date),
                  direction,
                );
                return (
                  Math.abs(selected - target) <=
                  sourceSelectionToleranceCents
                );
              }),
            );
            if (complementComplete) {
              currentRows = complementRows.sort((left, right) =>
                left.date.localeCompare(right.date),
              );
            }
          }

          // Quando o PDF de aplicação compartilha a referência da conta
          // corrente, a maior parte dos movimentos já é legítima. Nesse caso,
          // é mais seguro localizar e retirar somente o excedente mensal das
          // colunas auxiliares do que tentar reconstruir todo o extrato.
          if (
            !complementComplete &&
            debitExcess >= 0 &&
            creditExcess >= 0 &&
            (!currentDebitTarget || debitExcess / currentDebitTarget <= 0.1) &&
            (!currentCreditTarget || creditExcess / currentCreditTarget <= 0.1)
          ) {
            const excludedIds = new Set<string>();
            const complementDiagnostics: Array<Record<string, number>> = [];
            for (const [direction, excess] of [
              [1, debitExcess],
              [-1, creditExcess],
            ] as const) {
              if (excess <= 100) continue;
              const directionalRows = currentRows.filter(
                (row) => Math.sign(cents(row.value)) === direction,
              );
              const applicationRows = directionalRows.filter((row) =>
                selectedApplicationIds.has(row.id),
              );
              const applicationTotal = totalInDirection(
                applicationRows,
                direction,
              );
              let auxiliaryRows: DataEngineBankRow[] = [];

              if (
                applicationRows.length > 0 &&
                Math.abs(applicationTotal - excess) <=
                  BANK_RECONCILIATION_TOLERANCE_CENTS
              ) {
                auxiliaryRows = applicationRows;
              } else if (applicationRows.length > 0 && applicationTotal < excess) {
                const additionalRows = selectMonthlyComplement(
                  directionalRows.filter(
                    (row) => !selectedApplicationIds.has(row.id),
                  ),
                  direction * (excess - applicationTotal),
                );
                const additionalTotal = totalInDirection(
                  additionalRows,
                  direction,
                );
                if (
                  additionalRows.length > 0 &&
                  Math.abs(applicationTotal + additionalTotal - excess) <=
                    BANK_RECONCILIATION_TOLERANCE_CENTS
                ) {
                  auxiliaryRows = [...applicationRows, ...additionalRows];
                }
              } else if (applicationRows.length > 0) {
                const applicationSubset = selectNearTarget(
                  applicationRows,
                  direction * excess,
                );
                const applicationSubsetTotal = totalInDirection(
                  applicationSubset,
                  direction,
                );
                if (
                  applicationSubset.length > 0 &&
                  Math.abs(applicationSubsetTotal - excess) <=
                    BANK_RECONCILIATION_TOLERANCE_CENTS
                ) {
                  auxiliaryRows = applicationSubset;
                }
              }

              if (!auxiliaryRows.length) {
                auxiliaryRows = selectMonthlyComplement(
                  directionalRows,
                  direction * excess,
                );
              }
              complementDiagnostics.push({
                applicationRows: applicationRows.length,
                applicationTotal,
                auxiliaryRows: auxiliaryRows.length,
                auxiliaryTotal: totalInDirection(auxiliaryRows, direction),
                direction,
                excess,
              });
              auxiliaryRows.forEach((row) => excludedIds.add(row.id));
            }

            const complementRows = currentRows.filter(
              (row) => !excludedIds.has(row.id),
            );
            const selectedDebitTotal = totalInDirection(complementRows, 1);
            const selectedCreditTotal = totalInDirection(complementRows, -1);
            complementComplete =
              excludedIds.size > 0 &&
              Math.abs(selectedDebitTotal - currentDebitTarget) <=
                BANK_RECONCILIATION_TOLERANCE_CENTS &&
              Math.abs(selectedCreditTotal - currentCreditTarget) <=
                BANK_RECONCILIATION_TOLERANCE_CENTS;
            if (complementComplete) {
              currentRows = complementRows.sort((left, right) =>
                left.date.localeCompare(right.date),
              );
            }
            console.info(
              "[reconciliation/source-split]",
              JSON.stringify({
                complementComplete,
                currentCreditTarget,
                currentDebitTarget,
                diagnostics: complementDiagnostics,
                rawCreditTotal,
                rawDebitTotal,
              }),
            );
          }

          if (!complementComplete) {
          const selectedCurrentRows: DataEngineBankRow[] = [];
          const selectedCurrentIds = new Set<string>();
          for (const accountingRow of currentAccountingRows) {
            const accountingValue = cents(accountingRow.value);
            const accountingDay = day(accountingRow.date);
            const candidate = currentRows
              .filter(
                (row) =>
                  !selectedCurrentIds.has(row.id) &&
                  day(row.date) === accountingDay &&
                  cents(row.value) === accountingValue,
              )
              .sort(
                (left, right) =>
                  Number(right.date === accountingDay) -
                    Number(left.date === accountingDay) ||
                  left.date.localeCompare(right.date),
              )[0];
            if (!candidate) continue;
            selectedCurrentRows.push(candidate);
            selectedCurrentIds.add(candidate.id);
          }
          const accountingDates = Array.from(
            new Set(currentAccountingRows.map((row) => day(row.date)).filter(Boolean)),
          ).sort();
          for (const date of accountingDates) {
            for (const direction of [1, -1]) {
              const accountingTarget = currentAccountingRows
                .filter(
                  (row) =>
                    day(row.date) === date &&
                    Math.sign(cents(row.value)) === direction,
                )
                .reduce((total, row) => total + cents(row.value), 0);
              const alreadySelected = selectedCurrentRows
                .filter(
                  (row) =>
                    row.date === date &&
                    Math.sign(cents(row.value)) === direction,
                )
                .reduce((total, row) => total + cents(row.value), 0);
              const residualTarget = accountingTarget - alreadySelected;
              if (!residualTarget) continue;
              const residualRows = selectNearTarget(
                currentRows.filter(
                  (row) =>
                    row.date === date && !selectedCurrentIds.has(row.id),
                ),
                residualTarget,
              );
              selectedCurrentRows.push(...residualRows);
              residualRows.forEach((row) => selectedCurrentIds.add(row.id));
            }
          }
          const currentSelectedTotal = selectedCurrentRows.reduce(
            (total, row) => total + cents(row.value),
            0,
          );
          const currentAbsoluteTarget = currentAccountingRows.reduce(
            (total, row) => total + Math.abs(cents(row.value)),
            0,
          );
          const currentAbsoluteSelected = selectedCurrentRows.reduce(
            (total, row) => total + Math.abs(cents(row.value)),
            0,
          );
          const currentCoverage = currentAbsoluteTarget
            ? currentAbsoluteSelected / currentAbsoluteTarget
            : 0;
          // Alguns PDFs de aplicação expõem principal, bruto, rendimento e
          // líquido como se fossem movimentos distintos. Só removemos essas
          // colunas auxiliares quando os movimentos selecionados cobrem pelo
          // menos 90% do volume contábil e fecham o líquido mensal.
          if (
            selectedCurrentRows.length > 0 &&
            currentCoverage >= 0.9 &&
            Math.abs(currentSelectedTotal - currentMonthlyTarget) <=
              BANK_RECONCILIATION_TOLERANCE_CENTS
          ) {
            currentRows = selectedCurrentRows.sort((left, right) =>
              left.date.localeCompare(right.date),
            );
          }
          }
        }
        normalizedSources = normalizedSources.map((source) => {
          if (source.sourceAccountId === transactionSource.sourceAccountId) {
            return {
              ...source,
              rows: currentRows,
            };
          }
          if (source.sourceAccountId === applicationSource.sourceAccountId) {
            return {
              ...source,
              bankId: applicationBank,
              rows: selectedApplicationRows.sort((left, right) =>
                left.date.localeCompare(right.date),
              ),
            };
          }
          return source;
        });
      }
    }
  }

  const hasApplicationSource = normalizedSources.some(isApplicationStatement);
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

    const netByDay = (
      rows: Array<{ date?: Date | string; value: number }>,
    ) => {
      const totals = new Map<string, number>();
      for (const row of rows) {
        const rowDay = day(row.date);
        if (!rowDay) continue;
        totals.set(rowDay, (totals.get(rowDay) ?? 0) + cents(row.value));
      }
      return totals;
    };
    const sourceDaily = netByDay(source.rows);
    const accountDaily = netByDay(accountRows);
    const sameDailyNet = Array.from(sourceDaily).filter(
      ([date, total]) =>
        accountDaily.has(date) &&
        Math.abs(total - (accountDaily.get(date) ?? 0)) <=
          BANK_RECONCILIATION_TOLERANCE,
    ).length;
    const sourceMonthly = Array.from(sourceDaily.values()).reduce(
      (total, value) => total + value,
      0,
    );
    const accountMonthly = Array.from(accountDaily.values()).reduce(
      (total, value) => total + value,
      0,
    );
    const sameMonthlyNet =
      Math.abs(sourceMonthly - accountMonthly) <=
      BANK_RECONCILIATION_TOLERANCE
        ? 1
        : 0;

    // Evidência individual no mesmo dia continua sendo a mais forte. As
    // somas diária e mensal permitem reconhecer contas cujos lançamentos
    // foram agrupados pelo banco ou pela contabilidade.
    return (
      sameDay * 1_000_000 +
      sameDailyNet * 1_000 +
      sameMonth * 10 +
      sameMonthlyNet
    );
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
  // Prioridade 2: o extrato de movimento da aplicação deve reservar a conta
  // contábil de aplicação antes que a conta corrente do mesmo banco a consuma.
  for (const source of Array.from(remainingSources.values())) {
    if (!isApplicationStatement(source)) continue;
    bindUnique(
      source,
      Array.from(remainingAccounts.values()).filter((account) =>
        APPLICATION_ACCOUNT_PATTERN.test(account.name ?? ""),
      ),
    );
  }
  // Prioridade 3: código do banco quando ele identifica uma única conta contábil.
  for (const source of Array.from(remainingSources.values())) {
    const bankPattern = bankNames[source.bankId.padStart(3, "0")];
    if (!bankPattern) continue;
    let candidates = Array.from(remainingAccounts.values()).filter((account) =>
      bankPattern.test(account.name ?? ""),
    );
    if (hasApplicationSource && source.rows.length > 0) {
      const transactionAccounts = candidates.filter(
        (account) => !APPLICATION_ACCOUNT_PATTERN.test(account.name ?? ""),
      );
      if (transactionAccounts.length > 0) candidates = transactionAccounts;
    }
    if (bindByMovementEvidence(source, candidates)) continue;
    bindUnique(source, candidates);
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
    "account_ref",
    "conta_bancaria_id",
    "conta_id",
    "id_conta",
    "conta_origem_id",
    "id_conta_origem",
  ]);
}

function governedDecimalInCents(
  record: Record<string, unknown>,
  fields: string[],
) {
  const rawValue = governedText(record, fields);
  if (!rawValue) return null;
  const normalized = rawValue
    .replace(/\s/g, "")
    .replace(/^R\$/i, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && Number.isSafeInteger(Math.round(parsed * 100))
    ? Math.round(parsed * 100)
    : null;
}

function governedInteger(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) continue;
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function countGovernedValues(
  records: Array<Record<string, unknown>>,
  fields: string[],
) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = governedText(record, fields) || "não informado";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(
    Array.from(counts.entries()).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function pendingEvidenceSummary(
  records: Array<Record<string, unknown>>,
  options: Pick<LoadOptions, "fromDate">,
) {
  const [year, month] = options.fromDate.slice(0, 7).split("-");
  const monthNames = [
    "JANEIRO",
    "FEVEREIRO",
    "MARCO",
    "ABRIL",
    "MAIO",
    "JUNHO",
    "JULHO",
    "AGOSTO",
    "SETEMBRO",
    "OUTUBRO",
    "NOVEMBRO",
    "DEZEMBRO",
  ];
  const periodTokens = [
    `${year}-${month}`,
    `${month}-${year}`,
    `${month}_${year}`,
    `${month}.${year}`,
    `${month}${year}`,
    `${monthNames[Number(month) - 1]} ${year}`,
  ];
  const extensions = new Map<string, number>();
  let evidenceForPeriod = 0;
  for (const record of records) {
    const reference = governedText(record, [
      "evidence_ref",
      "file_name",
      "filename",
      "nome_arquivo",
      "object_name",
    ]);
    if (!reference) continue;
    const normalized = reference
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    const extension = normalized.match(/\.([A-Z0-9]{2,8})(?:$|[?#])/u)?.[1];
    const key = extension ? `.${extension.toLowerCase()}` : "sem extensão";
    extensions.set(key, (extensions.get(key) ?? 0) + 1);
    if (periodTokens.some((token) => normalized.includes(token))) {
      evidenceForPeriod += 1;
    }
  }
  return {
    evidenceExtensions: Object.fromEntries(
      Array.from(extensions.entries()).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    evidenceForPeriod,
  };
}

function governedNamedMoneyInCents(
  record: Record<string, unknown>,
  centsFields: string[],
  decimalFields: string[],
) {
  const explicitCents = governedInteger(record, centsFields);
  return explicitCents ?? governedDecimalInCents(record, decimalFields);
}

function applicationPositionMovements(
  positions: Array<Record<string, unknown>>,
  options: Pick<LoadOptions, "codColigada" | "fromDate" | "toDate">,
) {
  const movements: Movement[] = [];
  const movementKeys = new Set<string>();

  for (const [index, position] of positions.entries()) {
    const date = governedCalendarDate(position, [
      "data_movimento",
      "data_do_movimento",
      "movement_date",
      "data_lancamento",
      "transaction_date",
      "posting_date",
    ]);
    const sourceAccountId = applicationPositionIdentity(position);
    if (
      !date ||
      date < options.fromDate ||
      date > options.toDate ||
      !sourceAccountId ||
      sourceAccountId.length > MAX_SOURCE_ACCOUNT_ID_LENGTH
    ) {
      continue;
    }

    const rawBankId = governedText(position, [
      "bank_id",
      "codigo_banco",
      "bank_code",
      "cod_banco",
    ]);
    const bankId = /^0*\d{1,3}$/.test(rawBankId)
      ? rawBankId.replace(/^0+/, "").padStart(3, "0")
      : "000";
    const applicationNumber = governedText(position, [
      "numero_aplicacao",
      "numero_da_aplicacao",
      "application_number",
      "nr_aplicacao",
      "n_aplicacao",
    ]);
    const recordId = governedText(position, [
      "movimento_aplicacao_id",
      "application_movement_id",
      "posicao_aplicacao_id",
      "position_id",
      "id",
    ]) || `${sourceAccountId}:${date}:${index}`;
    const appliedInCents = governedNamedMoneyInCents(
      position,
      [
        "aplicacoes_centavos",
        "aplicacao_centavos",
        "valor_aplicacoes_centavos",
        "valor_aplicacao_centavos",
        "valor_aplicado_centavos",
        "application_amount_cents",
        "applied_amount_cents",
      ],
      [
        "aplicacoes",
        "aplicacao",
        "valor_aplicacoes",
        "valor_aplicacao",
        "valor_aplicado",
        "application_amount",
        "applied_amount",
        "investimento",
        "investment_amount",
      ],
    );
    const principalRedeemedInCents = governedNamedMoneyInCents(
      position,
      [
        "valor_principal_resgatado_centavos",
        "principal_resgatado_centavos",
        "valor_resgate_principal_centavos",
        "redemption_principal_cents",
        "principal_redeemed_cents",
      ],
      [
        "valor_principal_resgatado",
        "principal_resgatado",
        "valor_resgate_principal",
        "redemption_principal",
        "principal_redeemed",
      ],
    );
    const netCreditedInCents = governedNamedMoneyInCents(
      position,
      [
        "valor_liquido_creditado_centavos",
        "liquido_creditado_centavos",
        "valor_creditado_liquido_centavos",
        "net_credited_amount_cents",
        "net_amount_credited_cents",
        "net_redemption_cents",
      ],
      [
        "valor_liquido_creditado",
        "liquido_creditado",
        "valor_creditado_liquido",
        "net_credited_amount",
        "net_amount_credited",
        "net_redemption",
      ],
    );
    const grossRedeemedInCents = governedNamedMoneyInCents(
      position,
      [
        "resgates_brutos_centavos",
        "resgate_bruto_centavos",
        "valor_resgate_centavos",
        "gross_redemption_cents",
        "redemption_amount_cents",
      ],
      [
        "resgates_brutos",
        "resgate_bruto",
        "valor_resgate",
        "resgates",
        "gross_redemption",
        "redemption_amount",
      ],
    );
    const redeemedInCents =
      netCreditedInCents ?? principalRedeemedInCents ?? grossRedeemedInCents;
    const suffix = applicationNumber ? ` · aplicação ${applicationNumber}` : "";

    const appendMovement = (
      nature: "C" | "D",
      amountInCents: number | null,
      description: string,
    ) => {
      if (amountInCents === null || Math.abs(amountInCents) < 1) return;
      const absoluteCents = Math.abs(amountInCents);
      const key = `${sourceAccountId}|${date}|${absoluteCents}|${nature}|${description}`;
      if (movementKeys.has(key)) return;
      movementKeys.add(key);
      movements.push({
        movimento_id: `posicao:${recordId}:${nature}`,
        cod_coligada: options.codColigada,
        bank_id: bankId,
        source_account_id: sourceAccountId,
        data_lancamento: date,
        valor_centavos: absoluteCents,
        natureza: nature,
        descricao_sanitizada: `${description}${suffix}`,
      });
    };

    // Posições só podem virar movimentos quando o contrato traz uma data
    // transacional e campos explicitamente identificados como aplicação ou
    // resgate. position_at e os valores bruto/líquido descrevem a posição do
    // investimento; tratá-los como lançamentos elimina ou duplica o extrato.
    appendMovement("C", appliedInCents, "Aplicação financeira");
    appendMovement("D", redeemedInCents, "Resgate líquido da aplicação");
  }

  return movements;
}

function governedMoneyInCents(record: Record<string, unknown>) {
  const explicitCents = governedInteger(record, [
    "valor_centavos",
    "amount_cents",
    "value_cents",
  ]);
  if (explicitCents !== null) return explicitCents;

  return governedDecimalInCents(record, [
    "valor",
    "amount",
    "value",
    "valor_lancamento",
    "valor_movimento",
    "transaction_amount",
  ]);
}

function governedNature(record: Record<string, unknown>): "C" | "D" | null {
  const value = governedText(record, [
    "natureza",
    "nature",
    "debit_credit",
    "tipo_movimento",
    "transaction_type",
    "debito_credito",
    "dc",
    "tipo",
  ])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (["C", "CREDITO", "CREDIT", "ENTRADA"].includes(value)) return "C";
  if (["D", "DEBITO", "DEBIT", "SAIDA"].includes(value)) return "D";
  return null;
}

function pendingRecordObjects(root: Record<string, unknown>) {
  const records: Array<Record<string, unknown>> = [];
  const queue: Array<{ depth: number; value: unknown }> = [
    { depth: 0, value: root },
  ];
  let queueIndex = 0;
  const seen = new Set<object>();
  while (queueIndex < queue.length && records.length < MAX_PENDING_OBJECTS) {
    const current = queue[queueIndex];
    queueIndex += 1;
    if (!current || current.depth > MAX_PENDING_DEPTH) continue;
    const { value } = current;
    if (typeof value === "string") {
      const text = value.trim();
      if (
        text.length <= 1_000_000 &&
        (text.startsWith("{") || text.startsWith("["))
      ) {
        try {
          queue.push({ depth: current.depth + 1, value: JSON.parse(text) });
        } catch {
          // Conteúdo textual comum não é um payload JSON.
        }
      }
      continue;
    }
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        queue.push({ depth: current.depth + 1, value: item });
      }
      continue;
    }
    const record = value as Record<string, unknown>;
    records.push(record);
    for (const nested of Object.values(record)) {
      if (nested && (typeof nested === "object" || typeof nested === "string")) {
        queue.push({ depth: current.depth + 1, value: nested });
      }
    }
  }
  return records;
}

function pendingContext(
  root: Record<string, unknown>,
  records: Array<Record<string, unknown>>,
) {
  const texts = (fields: string[]) =>
    records.map((record) => governedText(record, fields)).filter(Boolean);
  const explicitBankId = texts([
    "bank_id",
    "codigo_banco",
    "bank_code",
    "cod_banco",
    "codigo_compensacao",
    "banco",
  ]).find((value) => /^0*\d{1,3}$/.test(value));
  const bankNames = texts([
    "bank_name",
    "nome_banco",
    "banco",
    "instituicao",
    "instituicao_financeira",
    "file_name",
    "filename",
    "nome_arquivo",
    "object_name",
  ]).join(" ");
  const normalizedBankName = bankNames
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const bankByName: Array<[RegExp, string]> = [
    [/SICOOB/, "756"],
    [/SICREDI/, "748"],
    [/DAYCOVAL/, "707"],
    [/SANTANDER/, "033"],
    [/ITAU/, "341"],
    [/CAIXA/, "104"],
    [/BRADESCO/, "237"],
    [/SOFISA/, "637"],
    [/SAFRA/, "422"],
    [/BANCO DO BRASIL/, "001"],
  ];
  const bankId = explicitBankId
    ? explicitBankId.replace(/^0+/, "").padStart(3, "0")
    : bankByName.find(([pattern]) => pattern.test(normalizedBankName))?.[1] ?? "";
  const explicitSource = records
    .map(governedSourceIdentity)
    .find(Boolean);
  const account = texts([
    "account_number",
    "numero_conta",
    "conta_bancaria",
    "conta",
    "nr_conta",
  ])[0] ?? "";
  const agency = texts([
    "agency",
    "agencia",
    "branch_number",
    "numero_agencia",
    "nr_agencia",
  ])[0] ?? "";
  const sourceAccountId =
    explicitSource ||
    (bankId && account ? `pendencia:${bankId}:${agency}:${account}` : "");
  return {
    ...root,
    ...(bankId ? { bank_id: bankId } : {}),
    ...(sourceAccountId ? { source_account_id: sourceAccountId } : {}),
  };
}

function pendingRecordToMovement(
  record: Record<string, unknown>,
  index: number,
): Movement | null {
  const bankId = governedText(record, [
    "bank_id",
    "codigo_banco",
    "bank_code",
    "cod_banco",
  ]);
  const sourceAccountId = governedSourceIdentity(record);
  const date = governedText(record, [
    "data_lancamento",
    "transaction_date",
    "transactionDate",
    "movement_date",
    "data_movimento",
    "data_transacao",
    "data_operacao",
    "posting_date",
    "posted_at",
    "dt_lancamento",
    "data",
    "date",
  ]).slice(0, 10);
  let valueInCents = governedMoneyInCents(record);
  let nature = governedNature(record);
  const creditInCents = governedDecimalInCents(record, [
    "credito",
    "credit",
    "credit_amount",
    "valor_credito",
  ]);
  const debitInCents = governedDecimalInCents(record, [
    "debito",
    "debit",
    "debit_amount",
    "valor_debito",
  ]);
  if (valueInCents === null && creditInCents !== null && !debitInCents) {
    valueInCents = creditInCents;
    nature ??= "C";
  } else if (valueInCents === null && debitInCents !== null && !creditInCents) {
    valueInCents = debitInCents;
    nature ??= "D";
  }
  const description = governedText(record, [
    "descricao_sanitizada",
    "sanitized_description",
    "descricao",
    "description",
    "historico",
    "documento_historico",
    "detalhe",
    "memo",
  ]) || "Lançamento do extrato";
  if (
    !/^0*\d{1,3}$/.test(bankId) ||
    !sourceAccountId ||
    sourceAccountId.length > MAX_SOURCE_ACCOUNT_ID_LENGTH ||
    !isCalendarDate(date) ||
    valueInCents === null ||
    !nature
  ) {
    return null;
  }
  const recordId = governedText(record, [
    "movimento_id",
    "movement_id",
    "pendencia_id",
    "pending_id",
    "lancamento_id",
    "transaction_id",
    "id",
  ]);
  const fallbackIdentity = `${sourceAccountId}:${date}:${valueInCents}:${nature}`;
  return {
    movimento_id: `pendencia:${recordId || fallbackIdentity}:${index}`,
    cod_coligada: Number(record.cod_coligada),
    bank_id: bankId.replace(/^0+/, "").padStart(3, "0"),
    source_account_id: sourceAccountId,
    data_lancamento: date,
    valor_centavos: Math.abs(valueInCents),
    natureza: nature,
    descricao_sanitizada: description,
  };
}

function pendingRecordMovements(
  root: Record<string, unknown>,
  recordIndex: number,
) {
  const records = pendingRecordObjects(root);
  const context = pendingContext(root, records);
  const movements: Movement[] = [];
  for (const [candidateIndex, record] of records.entries()) {
    const movement = pendingRecordToMovement(
      { ...context, ...record },
      recordIndex * MAX_PENDING_OBJECTS + candidateIndex,
    );
    if (movement) movements.push(movement);
  }
  const fields = Array.from(
    new Set(
      records.flatMap((record) =>
        Object.keys(record).filter((field) =>
          /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field),
        ),
      ),
    ),
  );
  return { fields, inspected: records.length, movements };
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
  const movementDate = governedCalendarDate(position, [
    "data_movimento",
    "data_do_movimento",
    "movement_date",
    "data_lancamento",
    "transaction_date",
    "posting_date",
    "position_at",
  ]);
  if (movementDate) return movementDate >= fromDate && movementDate <= toDate;
  const reference = governedText(position, [
    "data_posicao",
    "dt_posicao",
    "data_base",
    "data",
    "position_date",
    "position_at",
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
    const positionSourceAccountId = applicationPositionIdentity(position);
    const existingSource = recognized.find(
      (statement) => statement.sourceAccountId === positionSourceAccountId,
    );
    const hasTransactionalDate = Boolean(
      governedCalendarDate(position, [
        "data_movimento",
        "data_do_movimento",
        "movement_date",
        "data_lancamento",
        "transaction_date",
        "posting_date",
      ]),
    );
    const hasApplicationPositionEvidence =
      "posicao_aplicacao_id" in position ||
      "application_position_id" in position ||
      Boolean(
        governedText(position, [
          "product_name",
          "nome_produto",
          "application_name",
          "nome_aplicacao",
          "fund_name",
          "nome_fundo",
          "tipo_aplicacao",
        ]),
      ) ||
      APPLICATION_ACCOUNT_PATTERN.test(positionSourceAccountId);
    // A posição pode reutilizar a referência técnica do PDF da conta corrente.
    // Sem uma data transacional, ela apenas prova que existe uma aplicação e
    // precisa ganhar uma identidade própria; não pode renomear nem consumir os
    // movimentos reais da conta corrente.
    const sourceAccountId =
      existingSource &&
      !isApplicationStatement(existingSource) &&
      !hasTransactionalDate &&
      hasApplicationPositionEvidence
        ? `aplicacao:posicao:${positionSourceAccountId}`
        : positionSourceAccountId;
    if (
      !sourceAccountId ||
      sourceAccountId.length > MAX_SOURCE_ACCOUNT_ID_LENGTH ||
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
    const applicationEvidence =
      Boolean(product) ||
      "posicao_aplicacao_id" in position ||
      "application_position_id" in position ||
      APPLICATION_ACCOUNT_PATTERN.test(sourceAccountId);
    const bankName = governedText(position, ["bank_name", "nome_banco"]);
    const name = product
      ? `Aplicação · ${product}`
      : bankName
        ? `${bankName} · Aplicação`
        : bankId !== "000"
          ? `Banco ${bankId} · Aplicação`
          : "Aplicação financeira";

    if (knownSources.has(sourceAccountId)) {
      if (!applicationEvidence) continue;
      const current = recognized.find(
        (statement) => statement.sourceAccountId === sourceAccountId,
      );
      if (current) {
        current.bankId = bankId;
        current.metadata = {
          ...current.metadata,
          agency: agency || current.metadata.agency,
          account: account || current.metadata.account,
          name,
        };
      }
      continue;
    }

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
    // Saldos e cobertura também descrevem contas correntes já tratadas em
    // movimentos. Se uma dessas referências foi descartada por existir um
    // Excel preferencial para a mesma conta, ela não pode reaparecer como um
    // extrato vazio. Somente posições efetivamente identificadas como
    // aplicação podem criar uma nova fonte sem movimentos.
    if (!applicationEvidence || !isApplicationStatement(statement)) {
      continue;
    }
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
  const items: Array<Record<string, unknown>> = [];

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
      items.push(item);
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

  return { items, records, sourceRecords: Array.from(sourceRecords.values()) };
}

function governedCalendarDate(
  record: Record<string, unknown>,
  fields: string[],
) {
  const rawDate = governedText(record, fields);
  const isoDate = rawDate.slice(0, 10);
  if (isCalendarDate(isoDate)) return isoDate;
  const brazilianDate = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!brazilianDate) return "";
  const normalized = `${brazilianDate[3]}-${brazilianDate[2]}-${brazilianDate[1]}`;
  return isCalendarDate(normalized) ? normalized : "";
}

async function loadGovernedOperation(path: string, options: LoadOptions) {
  const fetcher = options.fetcher ?? fetch;
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let records = 0;
  const items: Array<Record<string, unknown>> = [];

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
    items.push(...page.items);
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

  return { items, records };
}

export async function loadDataEngineStatementSnapshot(
  options: LoadOptions,
): Promise<DataEngineStatementSnapshot> {
  validateOptions(options);
  const [saldos, positions, cobertura, pendencias] = await Promise.all([
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
    loadGovernedOperation("/v1/tesouraria/extratos/pendencias", options),
  ]);
  const statements = await loadDataEngineStatements({
    ...options,
    sourceEvidence: [
      ...saldos.items,
      ...positions.items,
      ...cobertura.items,
      ...pendencias.items,
    ],
  });
  const primarySources = new Set(
    statements.map((statement) => statement.sourceAccountId),
  );
  const pendingExtractions = pendencias.items.map(pendingRecordMovements);
  const pendingEvidence = pendingEvidenceSummary(pendencias.items, options);
  const pendingObjectsInspected = pendingExtractions.reduce(
    (total, extraction) => total + extraction.inspected,
    0,
  );
  const pendingFieldsObserved = Array.from(
    new Set(pendingExtractions.flatMap((extraction) => extraction.fields)),
  )
    .sort()
    .slice(0, 100);
  const positionFieldsObserved = Array.from(
    new Set(positions.items.flatMap((position) => Object.keys(position))),
  )
    .sort()
    .slice(0, 100);
  const pendingMovementKeys = new Set<string>();
  const pendingMovements = pendingExtractions
    .flatMap((extraction) => extraction.movements)
    .filter(
      (movement) =>
        movement.data_lancamento >= options.fromDate &&
        movement.data_lancamento <= options.toDate &&
        !primarySources.has(movement.source_account_id),
    )
    .filter((movement) => {
      const key = [
        movement.source_account_id,
        movement.data_lancamento,
        movement.valor_centavos,
        movement.natureza,
        movement.descricao_sanitizada.trim().toUpperCase(),
      ].join("|");
      if (pendingMovementKeys.has(key)) return false;
      pendingMovementKeys.add(key);
      return true;
    });
  const pendingStatements = statementsFromMovements(pendingMovements, options);
  const sourcesWithMovements = new Set([
    ...primarySources,
    ...pendingStatements.map((statement) => statement.sourceAccountId),
  ]);
  const positionMovements = applicationPositionMovements(
    positions.items,
    options,
  ).filter((movement) => !sourcesWithMovements.has(movement.source_account_id));
  const positionStatements = statementsFromMovements(positionMovements, options);
  const statementsWithFallback = [
    ...statements,
    ...pendingStatements,
    ...positionStatements,
  ].sort((left, right) =>
    left.sourceAccountId.localeCompare(right.sourceAccountId),
  );
  const recognizedStatements = mergeApplicationPositionStatements(
    statementsWithFallback,
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
      applicationMovementsUsed: positionMovements.length,
      recognizedWithoutMovements:
        recognizedStatements.length - statementsWithFallback.length,
      pendingFieldsObserved,
      positionFieldsObserved,
      pendingObjectsInspected,
      pendingMovementsUsed: pendingMovements.length,
      pendingSourcesUsed: pendingStatements.length,
      pendingSummary: {
        ...pendingEvidence,
        kinds: countGovernedValues(pendencias.items, ["pendencia_kind"]),
        reasons: countGovernedValues(pendencias.items, ["reason_code"]),
        sourceAccounts: new Set(
          pendencias.items
            .map((record) => governedSourceIdentity(record))
            .filter(Boolean),
        ).size,
        statuses: countGovernedValues(pendencias.items, ["pendencia_status"]),
      },
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
      pendencias: pendencias.records,
      pendenciasUtilizadas: pendingMovements.length,
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

  return statementsFromMovements(movements, options);
}

function statementsFromMovements(
  movements: Movement[],
  options: Pick<
    LoadOptions,
    "codColigada" | "fromDate" | "sourceEvidence" | "toDate"
  >,
) {
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
  }

  type SourceFormat = "excel" | "pdf" | "unknown";
  const sourceFormatFromRecord = (
    record: Record<string, unknown>,
  ): SourceFormat => {
    const sourceMetadata = Object.entries(record)
      .filter(([field, value]) =>
        /(?:arquivo|file|filename|object|path|caminho|mime|content|format|formato|extens|evidence|source|canal)/i.test(
          field,
        ) &&
        (typeof value === "string" || typeof value === "number"),
      )
      .map(([, value]) => String(value))
      .join(" ")
      .toLowerCase();
    if (
      /(?:\.xls(?:x|m|b)?\b|excel|spreadsheet|vnd\.openxmlformats-officedocument\.spreadsheetml|vnd\.ms-excel)/i.test(
        sourceMetadata,
      )
    ) {
      return "excel" as const;
    }
    if (/(?:\.pdf|application\/pdf|\bpdf\b)/i.test(sourceMetadata)) {
      return "pdf" as const;
    }
    return "unknown" as const;
  };

  const sourceLinkValues = (record: Record<string, unknown>) => {
    const fields = [
      "processing_identity_id",
      "processingIdentityId",
      "evidence_ref",
      "evidence_id",
      "source_file_id",
      "source_document_id",
      "file_id",
      "arquivo_id",
      "document_id",
      "documento_id",
      "documento_hash",
      "object_id",
      "object_key",
      "ingestion_id",
      "import_id",
      "upload_id",
    ];
    return Array.from(
      new Set(
        fields
          .map((field) => record[field])
          .filter(
            (value): value is string | number =>
              typeof value === "string" || typeof value === "number",
          )
          .map((value) => String(value).trim())
          .filter(Boolean),
      ),
    );
  };

  const evidenceFormatsByLink = new Map<string, Set<SourceFormat>>();
  const evidenceFormatsByAccount = new Map<string, Set<SourceFormat>>();
  const evidenceBySource = new Map<string, Array<Record<string, unknown>>>();
  for (const evidence of options.sourceEvidence ?? []) {
    const sourceAccountId = governedSourceIdentity(evidence);
    if (sourceAccountId) {
      evidenceBySource.set(sourceAccountId, [
        ...(evidenceBySource.get(sourceAccountId) ?? []),
        evidence,
      ]);
    }
    const format = sourceFormatFromRecord(evidence);
    if (format === "unknown") continue;
    for (const link of sourceLinkValues(evidence)) {
      const formats = evidenceFormatsByLink.get(link) ?? new Set<SourceFormat>();
      formats.add(format);
      evidenceFormatsByLink.set(link, formats);
    }
    if (sourceAccountId) {
      const formats =
        evidenceFormatsByAccount.get(sourceAccountId) ?? new Set<SourceFormat>();
      formats.add(format);
      evidenceFormatsByAccount.set(sourceAccountId, formats);
    }
  }

  const sourceDetails = (sourceAccountId: string, fallbackBankId: string) => {
    const records = evidenceBySource.get(sourceAccountId) ?? [];
    const first = (fields: string[]) =>
      records.map((record) => governedText(record, fields)).find(Boolean) ?? "";
    const rawBankId = first([
      "bank_id",
      "codigo_banco",
      "bank_code",
      "cod_banco",
      "codigo_compensacao",
    ]);
    const bankId = /^0*\d{1,3}$/.test(rawBankId)
      ? rawBankId.replace(/^0+/, "").padStart(3, "0")
      : fallbackBankId.padStart(3, "0");
    const account = first([
      "account_number",
      "numero_conta",
      "conta_bancaria",
      "conta",
      "nr_conta",
    ]);
    const agency = first([
      "agency",
      "agencia",
      "branch_number",
      "numero_agencia",
      "nr_agencia",
    ]);
    const bankName = first([
      "bank_name",
      "nome_banco",
      "instituicao",
      "instituicao_financeira",
    ]);
    const product = first([
      "product_name",
      "nome_produto",
      "application_name",
      "nome_aplicacao",
      "fund_name",
      "nome_fundo",
      "tipo_aplicacao",
    ]);
    const application = APPLICATION_ACCOUNT_PATTERN.test(
      `${sourceAccountId} ${product}`,
    );
    return {
      account,
      agency,
      application,
      bankId,
      name: product
        ? `Aplicação · ${product}`
        : bankName || `Banco ${bankId}`,
    };
  };

  const sourceKey = (movement: Movement) => {
    const details = sourceDetails(
      movement.source_account_id,
      movement.bank_id,
    );
    const account = details.account.replace(/\D/g, "").replace(/^0+/, "");
    const agency = details.agency.replace(/\D/g, "").replace(/^0+/, "");
    return account.length >= 4
      ? [
          "account",
          details.bankId,
          agency,
          account,
          details.application ? "application" : "transaction",
        ].join("|")
      : `source|${movement.source_account_id}`;
  };

  const sourceFormat = (movement: Movement): SourceFormat => {
    const movementRecord = movement as unknown as Record<string, unknown>;
    const directFormat = sourceFormatFromRecord(movementRecord);
    if (directFormat !== "unknown") return directFormat;
    const linkedFormats = new Set<SourceFormat>();
    for (const link of sourceLinkValues(movementRecord)) {
      for (const format of evidenceFormatsByLink.get(link) ?? []) {
        linkedFormats.add(format);
      }
    }
    if (linkedFormats.size === 1) return Array.from(linkedFormats)[0];
    const accountFormats = evidenceFormatsByAccount.get(
      movement.source_account_id,
    );
    return accountFormats?.size === 1
      ? Array.from(accountFormats)[0]
      : "unknown";
  };

  const sourceDocumentIdentity = (movement: Movement) => {
    const record = movement as unknown as Record<string, unknown>;
    const firstValue = (fields: string[]) =>
      fields
        .map((field) => record[field])
        .find(
          (value): value is string | number =>
            typeof value === "string" || typeof value === "number",
        );
    const technicalIdentity = firstValue([
      "processing_identity_id",
      "processingIdentityId",
      "source_file_id",
      "source_document_id",
      "file_id",
      "arquivo_id",
      "document_id",
      "documento_id",
      "object_id",
      "object_key",
      "ingestion_id",
      "import_id",
      "upload_id",
    ]);
    if (technicalIdentity !== undefined) {
      return `technical|${String(technicalIdentity).trim()}`;
    }
    const fileIdentity = firstValue([
      "file_name",
      "filename",
      "nome_arquivo",
      "arquivo_nome",
      "evidence_ref",
      "source_path",
      "file_path",
      "object_name",
    ]);
    if (fileIdentity !== undefined) {
      return `file|${String(fileIdentity).trim().toLowerCase()}`;
    }
    const documentHash = movement.documento_hash?.trim();
    if (documentHash) return `hash|${documentHash}`;
    return `movement|${movement.movimento_id}`;
  };

  const accountsWithExcel = new Set(
    movements
      .filter((movement) => sourceFormat(movement) === "excel")
      .map(sourceKey),
  );
  const preferredMovements = movements.filter(
    (movement) =>
      !accountsWithExcel.has(sourceKey(movement)) ||
      sourceFormat(movement) !== "pdf",
  );

  const sourcePriority = BANK_STATEMENT_SOURCE_PRIORITY;
  const canonicalIndexes = new Map<string, number>();
  const documentIndexes = new Map<string, number>();
  const businessIndexes = new Map<string, number>();
  const contentIndexes = new Map<string, number>();
  const selectedMovements: Movement[] = [];
  const isGeneratedDescription = (description: string) =>
    /^MOVIMENTO-[A-Z0-9_-]{12,}$/i.test(description.trim());
  for (const movement of preferredMovements) {
    const canonicalSource = sourceKey(movement);
    const canonicalId = movement.canonical_movement_id?.trim();
    const documentHash = movement.documento_hash?.trim();
    const canonicalKey = canonicalId
      ? `${canonicalSource}|${canonicalId}`
      : "";
    const documentKey = documentHash
      ? [
          canonicalSource,
          movement.data_lancamento,
          movement.natureza,
          Math.abs(movement.valor_centavos),
          documentHash,
        ].join("|")
      : "";
    const businessKey = [
      canonicalSource,
      movement.data_lancamento,
      movement.natureza,
      Math.abs(movement.valor_centavos),
      movement.descricao_sanitizada
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase(),
    ].join("|");
    const contentKey = [
      canonicalSource,
      movement.data_lancamento,
      movement.natureza,
      Math.abs(movement.valor_centavos),
    ].join("|");
    const contentIndex = contentIndexes.get(contentKey);
    const contentMovement =
      contentIndex === undefined ? undefined : selectedMovements[contentIndex];
    const generatedFallbackIndex =
      contentMovement &&
      isGeneratedDescription(contentMovement.descricao_sanitizada) !==
        isGeneratedDescription(movement.descricao_sanitizada)
        ? contentIndex
        : undefined;
    const fromAnotherDocument = (index: number | undefined) => {
      if (index === undefined) return undefined;
      const existing = selectedMovements[index];
      return existing &&
        sourceDocumentIdentity(existing) !== sourceDocumentIdentity(movement)
        ? index
        : undefined;
    };
    const fromAnotherSource = (index: number | undefined) =>
      index !== undefined &&
      selectedMovements[index]?.source_account_id !== movement.source_account_id
        ? index
        : undefined;
    const existingIndex =
      fromAnotherDocument(
        canonicalKey ? canonicalIndexes.get(canonicalKey) : undefined,
      ) ??
      fromAnotherDocument(
        documentKey ? documentIndexes.get(documentKey) : undefined,
      ) ??
      fromAnotherSource(businessIndexes.get(businessKey)) ??
      generatedFallbackIndex;
    if (existingIndex === undefined) {
      if (canonicalKey && !canonicalIndexes.has(canonicalKey)) {
        canonicalIndexes.set(canonicalKey, selectedMovements.length);
      }
      if (documentKey && !documentIndexes.has(documentKey)) {
        documentIndexes.set(documentKey, selectedMovements.length);
      }
      if (!businessIndexes.has(businessKey)) {
        businessIndexes.set(businessKey, selectedMovements.length);
      }
      if (!contentIndexes.has(contentKey)) {
        contentIndexes.set(contentKey, selectedMovements.length);
      }
      selectedMovements.push(movement);
      continue;
    }
    const existing = selectedMovements[existingIndex];
    if (
      existing.cod_coligada !== movement.cod_coligada ||
      sourceKey(existing) !== canonicalSource ||
      existing.data_lancamento !== movement.data_lancamento ||
      existing.valor_centavos !== movement.valor_centavos ||
      existing.natureza !== movement.natureza
    ) {
      throw new Error("Resposta inválida do Data Engine.");
    }
    const existingIsGenerated = isGeneratedDescription(
      existing.descricao_sanitizada,
    );
    const movementIsGenerated = isGeneratedDescription(
      movement.descricao_sanitizada,
    );
    if (
      sourcePriority[sourceFormat(movement)] >
        sourcePriority[sourceFormat(existing)] ||
      (existingIsGenerated && !movementIsGenerated)
    ) {
      selectedMovements[existingIndex] = movement;
    }
    if (canonicalKey) canonicalIndexes.set(canonicalKey, existingIndex);
    if (documentKey) documentIndexes.set(documentKey, existingIndex);
    businessIndexes.set(businessKey, existingIndex);
    contentIndexes.set(contentKey, existingIndex);
  }

  for (const movement of selectedMovements) {
    const canonicalSource = sourceKey(movement);
    const details = sourceDetails(
      movement.source_account_id,
      movement.bank_id,
    );
    let statement = groups.get(canonicalSource);
    if (!statement) {
      statement = {
        bankId: details.bankId,
        sourceAccountId: movement.source_account_id,
        rows: [],
        metadata: {
          agency: details.agency,
          account: details.account || movement.source_account_id.slice(0, 12),
          period,
          name: details.name,
          openingBalance: null,
          closingBalance: null,
        },
      };
      groups.set(canonicalSource, statement);
    } else if (statement.bankId !== details.bankId) {
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
