import { NextResponse, type NextRequest } from "next/server";
import { fiscalWorkflowErrorResponse, resolveIrpjCsllConditional } from "@/lib/fiscal/monthly-workflow-service";

async function requestBody(request: NextRequest) {
  try { return await request.json(); } catch { return {}; }
}

export async function POST(request: NextRequest, context: { params: Promise<{ pendingId: string }> | { pendingId: string } }) {
  try {
    const params = await context.params;
    return NextResponse.json(await resolveIrpjCsllConditional(request, params.pendingId, await requestBody(request)));
  } catch (error) {
    const response = fiscalWorkflowErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
