import { NextResponse, type NextRequest } from "next/server";
import { fiscalWorkflowErrorResponse, previewIrpjCsllMonthly } from "@/lib/fiscal/monthly-workflow-service";

async function requestBody(request: NextRequest) {
  try { return await request.json(); } catch { return {}; }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await previewIrpjCsllMonthly(request, await requestBody(request)));
  } catch (error) {
    const response = fiscalWorkflowErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
