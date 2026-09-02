import { NextResponse, type NextRequest } from "next/server";
import { confirmIrpjCsllAutomaticClassification, fiscalWorkflowErrorResponse } from "@/lib/fiscal/monthly-workflow-service";

export async function POST(request: NextRequest, context: { params: Promise<{ pendingId: string }> | { pendingId: string } }) {
  try {
    const params = await context.params;
    return NextResponse.json(await confirmIrpjCsllAutomaticClassification(request, params.pendingId));
  } catch (error) {
    const response = fiscalWorkflowErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}