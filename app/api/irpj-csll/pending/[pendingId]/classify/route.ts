import { NextResponse, type NextRequest } from "next/server";
import { classifyIrpjCsllPending, fiscalWorkflowErrorResponse } from "@/lib/fiscal/monthly-workflow-service";

async function requestBody(request: NextRequest) {
  try { return await request.json(); } catch { return {}; }
}

export async function POST(request: NextRequest, context: { params: Promise<{ pendingId: string }> | { pendingId: string } }) {
  try {
    const params = await context.params;
    return NextResponse.json(await classifyIrpjCsllPending(request, params.pendingId, await requestBody(request)));
  } catch (error) {
    const response = fiscalWorkflowErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
