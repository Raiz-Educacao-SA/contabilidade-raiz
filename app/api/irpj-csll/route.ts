import { NextResponse, type NextRequest } from "next/server";
import { fiscalWorkflowErrorResponse, loadIrpjCsllDashboard } from "@/lib/fiscal/monthly-workflow-service";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await loadIrpjCsllDashboard(request));
  } catch (error) {
    const response = fiscalWorkflowErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
