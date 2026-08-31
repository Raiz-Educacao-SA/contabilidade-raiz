import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import type {
  AccountingSource,
  AccountingSourceRequest,
  AccountingTrialBalanceInputRecord,
} from "../lib/fiscal/accounting-source.ts";
import type { TaxPeriod } from "../lib/fiscal/types.ts";

const accountingSourceUrl = new URL("../lib/fiscal/accounting-source.ts", import.meta.url);
const accountingSnapshotUrl = new URL("../lib/fiscal/accounting-snapshot.ts", import.meta.url);
const periodsUrl = new URL("../lib/fiscal/periods.ts", import.meta.url);
const totvsSourceUrl = new URL("../lib/fiscal/totvs-accounting-source.ts", import.meta.url);

type SnapshotInsertRow = Record<string, any>;

function taxPeriod(overrides: Partial<TaxPeriod> = {}): TaxPeriod {
  return {
    id: "periodo-uuid-1",
    companyId: "empresa-uuid-1",
    fiscalYearProfileId: "profile-uuid-1",
    fiscalYear: 2026,
    periodCode: "2026-M01",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    periodType: "MONTHLY_ESTIMATE",
    status: "DRAFT",
    version: 1,
    ...overrides,
  };
}

function trialBalanceRecord(
  overrides: Partial<AccountingTrialBalanceInputRecord> = {},
): AccountingTrialBalanceInputRecord {
  return {
    accountCode: "3.1.01",
    reducedCode: "30101",
    description: "Receita de mensalidades",
    openingBalance: "0.00",
    debit: "100.00",
    credit: "25.00",
    movement: "75.00",
    closingBalance: "75.00",
    ...overrides,
  };
}

function totvsRecordXml(overrides: Partial<AccountingTrialBalanceInputRecord> = {}) {
  const record = trialBalanceRecord(overrides);
  return [
    `<Reduzido>${record.reducedCode}</Reduzido>`,
    `<Conta>${record.accountCode}</Conta>`,
    `<Descricao>${record.description}</Descricao>`,
    `<VR_SALDOANT>${record.openingBalance}</VR_SALDOANT>`,
    `<VR_DEBITO>${record.debit}</VR_DEBITO>`,
    `<VR_CREDITO>${record.credit}</VR_CREDITO>`,
    `<VR_MOV>${record.movement}</VR_MOV>`,
    `<Saldo>${record.closingBalance}</Saldo>`,
  ].join("");
}

function fakeSnapshotClient(
  events: string[] = [],
  onInsert: (row: SnapshotInsertRow) => void = () => undefined,
): any {
  return {
    from(table: string) {
      assert.equal(table, "source_snapshots");
      return {
        insert(row: SnapshotInsertRow) {
          events.push("insert");
          onInsert(row);
          return {
            select() {
              return {
                async single() {
                  return {
                    data: {
                      id: `snapshot-${events.length}`,
                      criado_em: "2026-08-31T12:00:00.000Z",
                      ...row,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

function fakeAccountingSource(
  recordsFactory: (
    request: AccountingSourceRequest,
  ) => readonly AccountingTrialBalanceInputRecord[] = () => [trialBalanceRecord()],
): AccountingSource {
  return {
    source: "GENERIC_LEDGER_TRIAL_BALANCE",
    sourceType: "TRIAL_BALANCE",
    provider: "GENERIC_LEDGER",
    adapterVersion: 1,
    contentSchemaVersion: 1,
    async fetchTrialBalance(request) {
      return {
        source: "GENERIC_LEDGER_TRIAL_BALANCE",
        sourceType: "TRIAL_BALANCE",
        provider: "GENERIC_LEDGER",
        adapterVersion: 1,
        contentSchemaVersion: 1,
        parameters: {
          canonical: {
            externalCompanyRef: request.externalCompanyRef,
            startDate: request.startDate,
            endDate: request.endDate,
            ...(request.accountFilter === undefined ? {} : { accountFilter: request.accountFilter }),
            includeClosingEntries: request.includeClosingEntries,
          },
          sourceMetadata: {
            ledgerCompanyKey: request.externalCompanyRef,
            closingEntriesIncluded: request.includeClosingEntries,
          },
        },
        records: recordsFactory(request),
      };
    },
  };
}

test("período mensal anual vira intervalo acumulado para a fonte contábil", async () => {
  assert.equal(existsSync(accountingSourceUrl), true, "AccountingSource module is missing");
  const { accountingSourceRequestFromTaxPeriod } = await import(accountingSourceUrl.href);
  const { buildTaxPeriodsForProfile } = await import(periodsUrl.href);

  const monthly = buildTaxPeriodsForProfile({
    companyId: "empresa-uuid-1",
    fiscalYear: 2026,
    taxRegime: "REAL_PROFIT",
    periodicity: "ANNUAL",
    validFrom: "2026-01-01",
  })[1];

  assert.deepEqual(
    accountingSourceRequestFromTaxPeriod(monthly, {
      companyId: "empresa-uuid-1",
      externalCompanyRef: "10",
      accountFilter: "%",
      includeClosingEntries: false,
    }),
    {
      companyId: "empresa-uuid-1",
      externalCompanyRef: "10",
      startDate: "2026-01-01",
      endDate: "2026-02-28",
      accountFilter: "%",
      includeClosingEntries: false,
      parameters: {},
    },
  );
});

test("contrato contábil permite omitir filtro de conta", async () => {
  const { accountingSourceRequestFromTaxPeriod } = await import(accountingSourceUrl.href);

  const request = accountingSourceRequestFromTaxPeriod(taxPeriod(), {
    companyId: "empresa-uuid-1",
    externalCompanyRef: "ledger-company-a",
    includeClosingEntries: false,
  });

  assert.equal("accountFilter" in request, false);
  assert.equal(request.externalCompanyRef, "ledger-company-a");
});

test("MONTHLY_ESTIMATE usa fechamento falso por padrão no request contábil", async () => {
  const { accountingSourceRequestFromTaxPeriod } = await import(accountingSourceUrl.href);
  const { buildTaxPeriodsForProfile } = await import(periodsUrl.href);
  const may = buildTaxPeriodsForProfile({
    companyId: "empresa-uuid-1",
    fiscalYear: 2026,
    taxRegime: "REAL_PROFIT",
    periodicity: "ANNUAL",
    validFrom: "2026-01-01",
  })[4];

  const request = accountingSourceRequestFromTaxPeriod(may, {
    companyId: "empresa-uuid-1",
    externalCompanyRef: "10",
  });

  assert.equal(request.startDate, "2026-01-01");
  assert.equal(request.endDate, "2026-05-31");
  assert.equal(request.includeClosingEntries, false);
});

test("ANNUAL_ADJUSTMENT mantém lançamentos de fechamento explicitamente configuráveis", async () => {
  const { accountingSourceRequestFromTaxPeriod } = await import(accountingSourceUrl.href);
  const { buildTaxPeriodsForProfile } = await import(periodsUrl.href);
  const annualAdjustment = buildTaxPeriodsForProfile({
    companyId: "empresa-uuid-1",
    fiscalYear: 2026,
    taxRegime: "REAL_PROFIT",
    periodicity: "ANNUAL",
    validFrom: "2026-01-01",
  }).at(-1);
  assert.ok(annualAdjustment);

  assert.throws(
    () =>
      accountingSourceRequestFromTaxPeriod(annualAdjustment, {
        companyId: "empresa-uuid-1",
        externalCompanyRef: "10",
      }),
    /Inclusão de lançamentos de fechamento deve ser configurada/,
  );
});

test("captura de snapshot MONTHLY_ESTIMATE usa intervalo acumulado", async () => {
  const { captureAccountingSourceSnapshot } = await import(accountingSnapshotUrl.href);
  const { buildTaxPeriodsForProfile } = await import(periodsUrl.href);
  const mayDraft = buildTaxPeriodsForProfile({
    companyId: "empresa-uuid-1",
    fiscalYear: 2026,
    taxRegime: "REAL_PROFIT",
    periodicity: "ANNUAL",
    validFrom: "2026-01-01",
  })[4];
  const mayPeriod = taxPeriod({
    fiscalYearProfileId: mayDraft.fiscalYearProfileId ?? null,
    fiscalYear: mayDraft.fiscalYear,
    periodCode: mayDraft.periodCode,
    startDate: mayDraft.startDate,
    endDate: mayDraft.endDate,
    periodType: mayDraft.periodType,
    status: mayDraft.status ?? "DRAFT",
    version: mayDraft.version ?? 1,
  });
  const requests: AccountingSourceRequest[] = [];
  const insertedRows: SnapshotInsertRow[] = [];

  const snapshot = await captureAccountingSourceSnapshot({
    client: fakeSnapshotClient([], (row) => insertedRows.push(row)),
    accountingSource: fakeAccountingSource((request) => {
      requests.push(request);
      return [trialBalanceRecord()];
    }),
    companyId: "empresa-uuid-1",
    externalCompanyRef: "10",
    taxPeriod: mayPeriod,
    extractedAt: "2026-08-31T12:00:00.000Z",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].startDate, "2026-01-01");
  assert.equal(requests[0].endDate, "2026-05-31");
  assert.equal(requests[0].includeClosingEntries, false);
  assert.equal(snapshot.taxPeriod.startDate, "2026-01-01");
  assert.equal(snapshot.taxPeriod.endDate, "2026-05-31");
  assert.equal(insertedRows[0].periodo_identidade.startDate, "2026-01-01");
  assert.equal(insertedRows[0].periodo_identidade.endDate, "2026-05-31");
});

test("período trimestral vira start/end explícitos para a fonte contábil", async () => {
  const { accountingSourceRequestFromTaxPeriod } = await import(accountingSourceUrl.href);
  const { buildTaxPeriodsForProfile } = await import(periodsUrl.href);

  const quarter = buildTaxPeriodsForProfile({
    companyId: "empresa-uuid-1",
    fiscalYear: 2026,
    taxRegime: "REAL_PROFIT",
    periodicity: "QUARTERLY",
    validFrom: "2026-01-01",
  })[2];

  const request = accountingSourceRequestFromTaxPeriod(quarter, {
    companyId: "empresa-uuid-1",
    externalCompanyRef: "10",
    accountFilter: "%",
    includeClosingEntries: true,
  });

  assert.equal(request.startDate, "2026-07-01");
  assert.equal(request.endDate, "2026-09-30");
  assert.equal(request.includeClosingEntries, true);
});

test("ajuste anual usa o exercício inteiro como intervalo contábil", async () => {
  const { accountingSourceRequestFromTaxPeriod } = await import(accountingSourceUrl.href);
  const { buildTaxPeriodsForProfile } = await import(periodsUrl.href);

  const annualAdjustment = buildTaxPeriodsForProfile({
    companyId: "empresa-uuid-1",
    fiscalYear: 2026,
    taxRegime: "REAL_PROFIT",
    periodicity: "ANNUAL",
    validFrom: "2026-01-01",
  }).at(-1);
  assert.ok(annualAdjustment);

  const request = accountingSourceRequestFromTaxPeriod(annualAdjustment, {
    companyId: "empresa-uuid-1",
    externalCompanyRef: "10",
    accountFilter: "%",
    includeClosingEntries: true,
  });

  assert.equal(request.startDate, "2026-01-01");
  assert.equal(request.endDate, "2026-12-31");
  assert.equal(request.includeClosingEntries, true);
});

test("adapter TOTVS recebe datas explícitas do contrato fiscal", async () => {
  assert.equal(existsSync(totvsSourceUrl), true, "TOTVS accounting source module is missing");
  const {
    createTotvsRmTrialBalanceAccountingSource,
    TOTVS_TRIAL_BALANCE_QUERY_CODE,
    TOTVS_TRIAL_BALANCE_SYSTEM,
  } = await import(totvsSourceUrl.href);
  const calls: Array<{ readonly code: string; readonly system: string; readonly parameters: string }> = [];
  const source = createTotvsRmTrialBalanceAccountingSource(async (query: any) => {
    calls.push(query);
    return [totvsRecordXml()];
  });

  await source.fetchTrialBalance({
    companyId: "empresa-uuid-1",
    externalCompanyRef: "10",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    includeClosingEntries: true,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, TOTVS_TRIAL_BALANCE_QUERY_CODE);
  assert.equal(calls[0].system, TOTVS_TRIAL_BALANCE_SYSTEM);
  assert.match(calls[0].parameters, /COLIGDADA_I=10/);
  assert.match(calls[0].parameters, /DATA_INICIAL_D=2026-04-01/);
  assert.match(calls[0].parameters, /DATA_FINAL_D=2026-06-30/);
  assert.match(calls[0].parameters, /CONTA_S=%/);
});

test("includeClosingEntries é traduzido para CONSIDERAFECHAMENTO apenas pelo adapter TOTVS", async () => {
  const { createTotvsRmTrialBalanceAccountingSource } = await import(totvsSourceUrl.href);
  const calls: string[] = [];
  const source = createTotvsRmTrialBalanceAccountingSource(async (query: any) => {
    calls.push(query.parameters);
    return [totvsRecordXml()];
  });

  await source.fetchTrialBalance({
    companyId: "empresa-uuid-1",
    externalCompanyRef: "10",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    accountFilter: "%",
    includeClosingEntries: true,
  });
  await source.fetchTrialBalance({
    companyId: "empresa-uuid-1",
    externalCompanyRef: "10",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    accountFilter: "%",
    includeClosingEntries: false,
  });

  assert.match(calls[0], /CONSIDERAFECHAMENTO_S=S/);
  assert.match(calls[1], /CONSIDERAFECHAMENTO_S=N/);
});

test("normalização do balancete é determinística e recalcula totais", async () => {
  const { normalizeAccountingSourceResult } = await import(accountingSourceUrl.href);

  const first = normalizeAccountingSourceResult({
    source: "GENERIC_LEDGER_TRIAL_BALANCE",
    sourceType: "TRIAL_BALANCE",
    provider: "GENERIC_LEDGER",
    adapterVersion: 1,
    contentSchemaVersion: 1,
    parameters: { endDate: "2026-01-31", startDate: "2026-01-01", externalCompanyRef: "company-a" },
    records: [
      trialBalanceRecord({ accountCode: "3.2", debit: "5,50", credit: "1" }),
      trialBalanceRecord({ accountCode: "3.1", debit: "10", credit: "2.25" }),
    ],
  });
  const second = normalizeAccountingSourceResult({
    source: "GENERIC_LEDGER_TRIAL_BALANCE",
    sourceType: "TRIAL_BALANCE",
    provider: "GENERIC_LEDGER",
    adapterVersion: 1,
    contentSchemaVersion: 1,
    parameters: { externalCompanyRef: "company-a", startDate: "2026-01-01", endDate: "2026-01-31" },
    records: [
      trialBalanceRecord({ accountCode: "3.1", debit: "10.00", credit: "2.25" }),
      trialBalanceRecord({ accountCode: "3.2", debit: "5.50", credit: "1.00" }),
    ],
  });

  assert.deepEqual(first, second);
  assert.equal(first.recordCount, 2);
  assert.equal(first.totalDebit, "15.50");
  assert.equal(first.totalCredit, "3.25");
});

test("mesma fonte e mesmo período geram o mesmo snapshot/hash sem depender de UUID físico", async () => {
  const { captureAccountingSourceSnapshot } = await import(accountingSnapshotUrl.href);
  const source = fakeAccountingSource();

  const first = await captureAccountingSourceSnapshot({
    client: fakeSnapshotClient(),
    accountingSource: source,
    companyId: "empresa-uuid-1",
    externalCompanyRef: "ledger-company-a",
    taxPeriod: taxPeriod({ id: "periodo-uuid-1", companyId: "empresa-uuid-1" }),
    accountFilter: "%",
    includeClosingEntries: false,
    extractedAt: "2026-08-31T12:00:00.000Z",
    snapshotVersion: 1,
  });
  const second = await captureAccountingSourceSnapshot({
    client: fakeSnapshotClient(),
    accountingSource: source,
    companyId: "empresa-uuid-2",
    externalCompanyRef: "ledger-company-a",
    taxPeriod: taxPeriod({ id: "periodo-uuid-2", companyId: "empresa-uuid-2" }),
    accountFilter: "%",
    includeClosingEntries: false,
    extractedAt: "2026-09-01T12:00:00.000Z",
    snapshotVersion: 7,
  });

  assert.equal(first.hash, second.hash);
});

test("mudança de saldo ou movimento altera o hash do snapshot", async () => {
  const { captureAccountingSourceSnapshot } = await import(accountingSnapshotUrl.href);

  const first = await captureAccountingSourceSnapshot({
    client: fakeSnapshotClient(),
    accountingSource: fakeAccountingSource(() => [trialBalanceRecord()]),
    companyId: "empresa-uuid-1",
    externalCompanyRef: "ledger-company-a",
    taxPeriod: taxPeriod(),
    accountFilter: "%",
    includeClosingEntries: false,
    extractedAt: "2026-08-31T12:00:00.000Z",
  });
  const second = await captureAccountingSourceSnapshot({
    client: fakeSnapshotClient(),
    accountingSource: fakeAccountingSource(() => [
      trialBalanceRecord({ movement: "76.00", closingBalance: "76.00" }),
    ]),
    companyId: "empresa-uuid-1",
    externalCompanyRef: "ledger-company-a",
    taxPeriod: taxPeriod(),
    accountFilter: "%",
    includeClosingEntries: false,
    extractedAt: "2026-08-31T12:00:00.000Z",
  });

  assert.notEqual(first.hash, second.hash);
});

test("snapshot é persistido antes de ser disponibilizado ao futuro motor", async () => {
  const { captureAccountingSourceSnapshot } = await import(accountingSnapshotUrl.href);
  const events: string[] = [];
  const insertedRows: SnapshotInsertRow[] = [];
  const source: AccountingSource = {
    source: "GENERIC_LEDGER_TRIAL_BALANCE",
    sourceType: "TRIAL_BALANCE",
    provider: "GENERIC_LEDGER",
    adapterVersion: 1,
    contentSchemaVersion: 1,
    async fetchTrialBalance(request) {
      events.push("fetch");
      return fakeAccountingSource().fetchTrialBalance(request);
    },
  };

  const snapshot = await captureAccountingSourceSnapshot({
    client: fakeSnapshotClient(events, (row) => insertedRows.push(row)),
    accountingSource: source,
    companyId: "empresa-uuid-1",
    externalCompanyRef: "ledger-company-a",
    taxPeriod: taxPeriod(),
    accountFilter: "%",
    includeClosingEntries: false,
    extractedAt: "2026-08-31T12:00:00.000Z",
  });
  events.push("return");

  assert.deepEqual(events, ["fetch", "insert", "return"]);
  assert.equal(snapshot.id, "snapshot-2");
  assert.equal(insertedRows.length, 1);
  assert.ok(Array.isArray(insertedRows[0].conteudo));
  assert.equal(insertedRows[0].conteudo.length, 1);
});

test("fake adapter não TOTVS implementa AccountingSource e gera SOURCE_SNAPSHOT válido", async () => {
  const { captureAccountingSourceSnapshot } = await import(accountingSnapshotUrl.href);
  const insertedRows: SnapshotInsertRow[] = [];

  const snapshot = await captureAccountingSourceSnapshot({
    client: fakeSnapshotClient([], (row) => insertedRows.push(row)),
    accountingSource: fakeAccountingSource(),
    companyId: "empresa-uuid-1",
    externalCompanyRef: "ledger-company-a",
    taxPeriod: taxPeriod(),
    accountFilter: "3*",
    includeClosingEntries: true,
    extractedAt: "2026-08-31T12:00:00.000Z",
  });
  const auditText = JSON.stringify(snapshot.parameters);

  assert.equal(snapshot.source, "GENERIC_LEDGER_TRIAL_BALANCE");
  assert.equal(snapshot.sourceType, "TRIAL_BALANCE");
  assert.equal(snapshot.provider, "GENERIC_LEDGER");
  assert.equal(snapshot.externalCompanyRef, "ledger-company-a");
  assert.equal(insertedRows[0].empresa_referencia_externa, "ledger-company-a");
  assert.equal(insertedRows[0].provedor, "GENERIC_LEDGER");
  assert.equal(auditText.includes("CODCOLIGADA"), false);
  assert.equal(auditText.includes("CUBO.CTB.002"), false);
  assert.equal(auditText.includes("CONSIDERAFECHAMENTO"), false);
  assert.equal(typeof snapshot.parameters.canonical, "object");
});

test("erro da fonte não produz snapshot incompleto", async () => {
  const { captureAccountingSourceSnapshot } = await import(accountingSnapshotUrl.href);
  const events: string[] = [];
  const source: AccountingSource = {
    source: "GENERIC_LEDGER_TRIAL_BALANCE",
    sourceType: "TRIAL_BALANCE",
    provider: "GENERIC_LEDGER",
    adapterVersion: 1,
    contentSchemaVersion: 1,
    async fetchTrialBalance() {
      events.push("fetch");
      throw new Error("Fonte contábil indisponível");
    },
  };

  await assert.rejects(
    () =>
      captureAccountingSourceSnapshot({
        client: fakeSnapshotClient(events),
        accountingSource: source,
        companyId: "empresa-uuid-1",
        externalCompanyRef: "ledger-company-a",
        taxPeriod: taxPeriod(),
        accountFilter: "%",
        includeClosingEntries: false,
      }),
    /Fonte contábil indisponível/,
  );
  assert.deepEqual(events, ["fetch"]);
});

test("registro contábil estruturalmente inválido é recusado antes da persistência", async () => {
  const { captureAccountingSourceSnapshot } = await import(accountingSnapshotUrl.href);
  const events: string[] = [];

  await assert.rejects(
    () =>
      captureAccountingSourceSnapshot({
        client: fakeSnapshotClient(events),
        accountingSource: fakeAccountingSource(() => [trialBalanceRecord({ accountCode: "" })]),
        companyId: "empresa-uuid-1",
        externalCompanyRef: "ledger-company-a",
        taxPeriod: taxPeriod(),
        accountFilter: "%",
        includeClosingEntries: false,
      }),
    /Código da conta contábil é obrigatório/,
  );
  assert.deepEqual(events, []);
});