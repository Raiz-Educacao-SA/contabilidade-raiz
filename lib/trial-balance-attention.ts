export type TrialBalanceNature = "positivo" | "negativo" | "indefinido";
export type TrialBalanceSign = "positivo" | "negativo" | "zero";

type AttentionInput = {
  category: string;
  previousBalance: number;
  currentBalance: number;
  relevantVariation: boolean;
  expectedNature: TrialBalanceNature;
  currentSign: TrialBalanceSign;
  reducerAccount: boolean;
};

export function trialBalanceAttentionFlags({
  category,
  previousBalance,
  currentBalance,
  relevantVariation,
  expectedNature,
  currentSign,
  reducerAccount,
}: AttentionInput) {
  const isEquity = category === "Patrimônio Líquido";
  const possibleError = !isEquity && previousBalance === 0 && currentBalance !== 0;
  const reversedAccount =
    !isEquity &&
    expectedNature !== "indefinido" &&
    currentSign !== "zero" &&
    expectedNature !== currentSign &&
    !reducerAccount;

  return {
    relevantVariation,
    possibleError,
    reversedAccount,
    requiresAttention: relevantVariation || possibleError || reversedAccount,
  };
}
