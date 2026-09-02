import { NextResponse, type NextRequest } from "next/server";
import { closeIrpjCsllMonthly, fiscalWorkflowErrorResponse } from "@/lib/fiscal/monthly-workflow-service";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await closeIrpjCsllMonthly(request));
  } catch (error) {
    const response = fiscalWorkflowErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
