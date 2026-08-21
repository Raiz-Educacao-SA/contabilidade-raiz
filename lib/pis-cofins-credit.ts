export type EnergyCreditCalculation = {
  cumulativePercentage: number;
  nonCumulativePercentage: number;
  eligibleBase: number;
  pisCredit: number;
  cofinsCredit: number;
};

const PIS_NON_CUMULATIVE_RATE = 0.0165;
const COFINS_NON_CUMULATIVE_RATE = 0.076;

export function calculateEnergyCredit(
  consumption: number,
  cumulativeRevenue: number,
  nonCumulativeRevenue: number,
): EnergyCreditCalculation {
  const totalRevenue = cumulativeRevenue + nonCumulativeRevenue;
  const cumulativePercentage = totalRevenue > 0 ? cumulativeRevenue / totalRevenue : 0;
  const nonCumulativePercentage = totalRevenue > 0 ? nonCumulativeRevenue / totalRevenue : 0;
  const eligibleBase = Math.max(0, consumption) * nonCumulativePercentage;

  return {
    cumulativePercentage,
    nonCumulativePercentage,
    eligibleBase,
    pisCredit: eligibleBase * PIS_NON_CUMULATIVE_RATE,
    cofinsCredit: eligibleBase * COFINS_NON_CUMULATIVE_RATE,
  };
}
