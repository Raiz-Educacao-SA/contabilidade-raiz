import assert from "node:assert/strict";
import test from "node:test";
const moduleUrl = new URL("../lib/pis-cofins-credit.ts", import.meta.url);
const { calculateEnergyCredit } = await import(moduleUrl.href);

test("aplica o percentual não cumulativo ao consumo e calcula PIS/COFINS", () => {
  const result = calculateEnergyCredit(100_000, 80_000, 20_000);
  assert.equal(result.cumulativePercentage, 0.8);
  assert.equal(result.nonCumulativePercentage, 0.2);
  assert.equal(result.eligibleBase, 20_000);
  assert.equal(result.pisCredit, 330);
  assert.equal(result.cofinsCredit, 1_520);
});

test("zera o crédito quando não há receita ou o consumo é negativo", () => {
  assert.deepEqual(calculateEnergyCredit(-100, 0, 0), {
    cumulativePercentage: 0,
    nonCumulativePercentage: 0,
    eligibleBase: 0,
    pisCredit: 0,
    cofinsCredit: 0,
  });
});
