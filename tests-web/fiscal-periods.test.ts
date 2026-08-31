import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../lib/fiscal/periods.ts", import.meta.url);

test("gera estimativas mensais acumuladas e ajuste anual para perfil Real Profit anual", async () => {
  assert.equal(existsSync(moduleUrl), true, "Fiscal periods module is missing");
  const { buildTaxPeriodsForProfile } = await import(moduleUrl.href);

  const periods = buildTaxPeriodsForProfile({
    companyId: "empresa-1",
    fiscalYear: 2026,
    taxRegime: "REAL_PROFIT",
    periodicity: "ANNUAL",
    validFrom: "2026-01-01",
    version: 2,
  });

  assert.equal(periods.length, 13);
  assert.deepEqual(periods[0], {
    companyId: "empresa-1",
    fiscalYearProfileId: null,
    fiscalYear: 2026,
    periodCode: "2026-M01",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    periodType: "MONTHLY_ESTIMATE",
    status: "DRAFT",
    version: 2,
  });
  assert.deepEqual(
    [periods[1], periods[4], periods[11]].map((period) => ({
      code: period.periodCode,
      start: period.startDate,
      end: period.endDate,
      type: period.periodType,
    })),
    [
      { code: "2026-M02", start: "2026-01-01", end: "2026-02-28", type: "MONTHLY_ESTIMATE" },
      { code: "2026-M05", start: "2026-01-01", end: "2026-05-31", type: "MONTHLY_ESTIMATE" },
      { code: "2026-M12", start: "2026-01-01", end: "2026-12-31", type: "MONTHLY_ESTIMATE" },
    ],
  );
  assert.deepEqual(periods[12], {
    companyId: "empresa-1",
    fiscalYearProfileId: null,
    fiscalYear: 2026,
    periodCode: "2026-ANNUAL",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    periodType: "ANNUAL_ADJUSTMENT",
    status: "DRAFT",
    version: 2,
  });
});

test("estimativa mensal acumulada preserva ano bissexto", async () => {
  const { buildTaxPeriodsForProfile } = await import(moduleUrl.href);

  const periods = buildTaxPeriodsForProfile({
    companyId: "empresa-1",
    fiscalYear: 2028,
    taxRegime: "REAL_PROFIT",
    periodicity: "ANNUAL",
    validFrom: "2028-01-01",
  });

  assert.equal(periods[1].periodCode, "2028-M02");
  assert.equal(periods[1].startDate, "2028-01-01");
  assert.equal(periods[1].endDate, "2028-02-29");
});

test("gera trimestres reais T01 a T04 sem acumular desde janeiro", async () => {
  const { buildTaxPeriodsForProfile } = await import(moduleUrl.href);

  const periods = buildTaxPeriodsForProfile({
    id: "profile-1",
    companyId: "empresa-1",
    fiscalYear: 2028,
    taxRegime: "REAL_PROFIT",
    periodicity: "QUARTERLY",
    validFrom: "2028-01-01",
    validTo: "2028-12-31",
    version: 1,
  });

  assert.deepEqual(
    periods.map((period: { periodCode: string; startDate: string; endDate: string; periodType: string }) => ({
      code: period.periodCode,
      start: period.startDate,
      end: period.endDate,
      type: period.periodType,
    })),
    [
      { code: "2028-T01", start: "2028-01-01", end: "2028-03-31", type: "QUARTERLY_REAL" },
      { code: "2028-T02", start: "2028-04-01", end: "2028-06-30", type: "QUARTERLY_REAL" },
      { code: "2028-T03", start: "2028-07-01", end: "2028-09-30", type: "QUARTERLY_REAL" },
      { code: "2028-T04", start: "2028-10-01", end: "2028-12-31", type: "QUARTERLY_REAL" },
    ],
  );
  assert.equal(
    periods.every((period: { fiscalYearProfileId: string | null }) => period.fiscalYearProfileId === "profile-1"),
    true,
  );
});

test("valida datas, status e intervalos do período fiscal sem regra de cálculo", async () => {
  const { coversDate, normalizeTaxPeriodDraft } = await import(moduleUrl.href);

  const period = normalizeTaxPeriodDraft({
    companyId: " empresa-1 ",
    fiscalYear: 2026,
    periodCode: " 2026-M02 ",
    startDate: "2026-01-01",
    endDate: "2026-02-28",
    periodType: "MONTHLY_ESTIMATE",
  });

  assert.equal(period.companyId, "empresa-1");
  assert.equal(period.periodCode, "2026-M02");
  assert.equal(period.status, "DRAFT");
  assert.equal(coversDate(period, "2026-02-14"), true);
  assert.equal(coversDate(period, "2026-03-01"), false);
  assert.throws(
    () =>
      normalizeTaxPeriodDraft({
        companyId: "empresa-1",
        fiscalYear: 2026,
        periodCode: "2026-M02",
        startDate: "2026-02-01",
        endDate: "2026-02-28",
        periodType: "MONTHLY_ESTIMATE",
      }),
    /Intervalo do período fiscal incompatível/,
  );
  assert.throws(
    () =>
      normalizeTaxPeriodDraft({
        companyId: "empresa-1",
        fiscalYear: 2026,
        periodCode: "invalido",
        startDate: "2026-03-01",
        endDate: "2026-02-28",
        periodType: "MONTHLY_ESTIMATE",
      }),
    /Intervalo do período fiscal inválido/,
  );
  assert.throws(
    () =>
      normalizeTaxPeriodDraft({
        companyId: "empresa-1",
        fiscalYear: 2026,
        periodCode: "2026-M02",
        startDate: "2026-01-01",
        endDate: "2026-02-28",
        periodType: "MONTHLY_ESTIMATE",
        status: "SNAPSHOT_READY" as never,
      }),
    /Status do período fiscal inválido/,
  );
});