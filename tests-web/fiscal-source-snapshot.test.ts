import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../lib/fiscal/source-snapshot.ts", import.meta.url);

const baseSnapshot = {
  companyId: "empresa-uuid-1",
  externalCompanyRef: "10",
  taxPeriodId: "periodo-uuid-1",
  taxPeriod: {
    fiscalYear: 2026,
    periodCode: "2026-M01",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
  },
  source: "TOTVS_RM_TRIAL_BALANCE",
  sourceType: "TRIAL_BALANCE",
  provider: "TOTVS_RM",
  adapterVersion: 1,
  contentSchemaVersion: 1,
  parameters: {
    canonical: {
      externalCompanyRef: "10",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      accountFilter: "%",
      includeClosingEntries: false,
    },
  },
  recordCount: 2,
  records: [
    { account: "3.1", date: "2026-01-01", debit: "1000.00", credit: "0.00" },
    { account: "3.2", date: "2026-01-02", debit: "0.00", credit: "700.25" },
  ],
  totalDebit: "1000.00",
  totalCredit: "700.25",
  balances: {
    opening: "0.00",
    closing: "299.75",
  },
  snapshotVersion: 1,
};

test("gera hash estável para mesmo conteúdo extraído em horários diferentes", async () => {
  assert.equal(existsSync(moduleUrl), true, "Fiscal source snapshot module is missing");
  const { calculateSourceSnapshotHash, createSourceSnapshotDraft } = await import(moduleUrl.href);

  const first = createSourceSnapshotDraft({
    ...baseSnapshot,
    extractedAt: "2026-08-31T13:00:00.000Z",
  });
  const secondHash = calculateSourceSnapshotHash({
    ...baseSnapshot,
    extractedAt: "2026-08-31T17:45:00.000Z",
  });

  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(first.hash, secondHash);
  assert.equal(first.extractedAt, "2026-08-31T13:00:00.000Z");
  assert.equal(first.records.length, 2);
});

test("não inclui UUIDs físicos nem versão do banco no hash", async () => {
  const { calculateSourceSnapshotHash, sourceSnapshotHashPayload } = await import(moduleUrl.href);

  const firstHash = calculateSourceSnapshotHash({
    ...baseSnapshot,
    extractedAt: "2026-08-31T13:00:00.000Z",
  });
  const secondHash = calculateSourceSnapshotHash({
    ...baseSnapshot,
    companyId: "empresa-uuid-aleatorio-2",
    taxPeriodId: "periodo-uuid-aleatorio-2",
    extractedAt: "2026-09-01T01:00:00.000Z",
    snapshotVersion: 99,
  });
  const payloadText = JSON.stringify(
    sourceSnapshotHashPayload({
      ...baseSnapshot,
      extractedAt: "2026-08-31T13:00:00.000Z",
    }),
  );

  assert.equal(firstHash, secondHash);
  assert.equal(payloadText.includes("companyId"), false);
  assert.equal(payloadText.includes("taxPeriodId"), false);
  assert.equal(payloadText.includes("snapshotVersion"), false);
  assert.equal(payloadText.includes("extractedAt"), false);
  assert.equal(payloadText.includes("empresa-uuid-1"), false);
  assert.equal(payloadText.includes("periodo-uuid-1"), false);
  assert.equal(payloadText.includes("externalRef"), true);
  assert.equal(payloadText.includes("2026-M01"), true);
  assert.equal(payloadText.includes("TOTVS_RM"), true);
});

test("mantém hash para mesma informação com propriedades e registros em ordem diferente", async () => {
  const { calculateSourceSnapshotHash } = await import(moduleUrl.href);

  const firstHash = calculateSourceSnapshotHash({
    ...baseSnapshot,
    extractedAt: "2026-08-31T13:00:00.000Z",
  });
  const secondHash = calculateSourceSnapshotHash({
    companyId: "empresa-uuid-1",
    externalCompanyRef: "10",
    taxPeriodId: "periodo-uuid-1",
    taxPeriod: {
      endDate: "2026-01-31",
      periodCode: "2026-M01",
      startDate: "2026-01-01",
      fiscalYear: 2026,
    },
    source: "TOTVS_RM_TRIAL_BALANCE",
    sourceType: "TRIAL_BALANCE",
    provider: "TOTVS_RM",
    adapterVersion: 1,
    contentSchemaVersion: 1,
    extractedAt: "2026-08-31T20:00:00.000Z",
    parameters: {
      canonical: {
        includeClosingEntries: false,
        accountFilter: "%",
        endDate: "2026-01-31",
        startDate: "2026-01-01",
        externalCompanyRef: "10",
      },
    },
    recordCount: 2,
    records: [
      { credit: "700.25", account: "3.2", debit: "0.00", date: "2026-01-02" },
      { debit: "1000.00", date: "2026-01-01", credit: "0.00", account: "3.1" },
    ],
    totalDebit: "1000.00",
    totalCredit: "700.25",
    balances: { closing: "299.75", opening: "0.00" },
    snapshotVersion: 9,
  });

  assert.equal(firstHash, secondHash);
});

test("detecta alteração em valor fiscalmente relevante", async () => {
  const { calculateSourceSnapshotHash } = await import(moduleUrl.href);

  assert.notEqual(
    calculateSourceSnapshotHash({
      ...baseSnapshot,
      extractedAt: "2026-08-31T13:00:00.000Z",
    }),
    calculateSourceSnapshotHash({
      ...baseSnapshot,
      extractedAt: "2026-08-31T13:00:00.000Z",
      totalDebit: "1000.01",
    }),
  );
});

test("detecta alteração de registro/conteúdo do snapshot", async () => {
  const { createSourceSnapshotDraft, verifySourceSnapshotIntegrity } = await import(moduleUrl.href);

  const snapshot = createSourceSnapshotDraft({
    ...baseSnapshot,
    extractedAt: new Date("2026-08-31T13:00:00.000Z"),
  });

  assert.equal(verifySourceSnapshotIntegrity(snapshot), true);
  assert.equal(
    verifySourceSnapshotIntegrity({
      ...snapshot,
      records: [
        { account: "3.1", date: "2026-01-01", debit: "1000.01", credit: "0.00" },
        { account: "3.2", date: "2026-01-02", debit: "0.00", credit: "700.25" },
      ],
    }),
    false,
  );
});

test("normaliza valores monetários sem arredondar frações extras", async () => {
  const { normalizeMoney } = await import(moduleUrl.href);

  assert.equal(normalizeMoney("001000,5"), "1000.50");
  assert.equal(normalizeMoney(200), "200.00");
  assert.throws(() => normalizeMoney("10.999"), /máximo duas casas decimais/);
  assert.throws(() => normalizeMoney(0.1 + 0.2), /máximo duas casas decimais/);
});

test("recusa snapshot sem conteúdo coerente, totais válidos ou versão válida", async () => {
  const { createSourceSnapshotDraft } = await import(moduleUrl.href);

  assert.throws(
    () =>
      createSourceSnapshotDraft({
        ...baseSnapshot,
        extractedAt: "2026-08-31T13:00:00.000Z",
        recordCount: 3,
      }),
    /Quantidade de registros do snapshot não confere/,
  );
  assert.throws(
    () =>
      createSourceSnapshotDraft({
        ...baseSnapshot,
        extractedAt: "2026-08-31T13:00:00.000Z",
        totalDebit: -1,
      }),
    /Total débito não pode ser negativo/,
  );
  assert.throws(
    () =>
      createSourceSnapshotDraft({
        ...baseSnapshot,
        extractedAt: "2026-08-31T13:00:00.000Z",
        snapshotVersion: 0,
      }),
    /versão do snapshot deve ser um inteiro positivo/,
  );
  assert.throws(
    () =>
      createSourceSnapshotDraft({
        ...baseSnapshot,
        contentSchemaVersion: 0,
        extractedAt: "2026-08-31T13:00:00.000Z",
      }),
    /versão do schema do conteúdo deve ser um inteiro positivo/,
  );
  assert.throws(
    () =>
      createSourceSnapshotDraft({
        ...baseSnapshot,
        sourceType: "TOTVS_ONLY" as never,
        extractedAt: "2026-08-31T13:00:00.000Z",
      }),
    /Tipo de fonte do snapshot inválido/,
  );
});