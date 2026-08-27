import { NextRequest, NextResponse } from "next/server";
import { GET as getTrialBalance } from "@/app/api/totvs/trial-balance/route";
import { classifyLoanTerm, isLoanAccount } from "@/lib/loan-accounts";

export const runtime = "nodejs";

type TrialBalanceRow = {
  id: string;
  reduced: string;
  account: string;
  description: string;
  openingBalance: number;
  debit: number;
  credit: number;
  movement: number;
  closingBalance: number;
};

export async function GET(request: NextRequest) {
  const response = await getTrialBalance(request);
  const payload = await response.json();

  if (!response.ok) {
    return NextResponse.json(payload, { status: response.status });
  }

  const rows = ((payload.rows || []) as TrialBalanceRow[])
    .filter(isLoanAccount)
    .map((row) => ({ ...row, term: classifyLoanTerm(row.account) }));

  return NextResponse.json(
    {
      ...payload,
      source: "TOTVS RM — balancete de empréstimos",
      records: rows.length,
      rows,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
