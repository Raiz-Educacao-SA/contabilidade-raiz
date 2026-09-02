import { NextResponse, type NextRequest } from "next/server";
import { compareMonthlyDossierVersions, dossierServiceErrorResponse } from "@/lib/fiscal/monthly-dossier-service";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await compareMonthlyDossierVersions(request));
  } catch (error) {
    const response = dossierServiceErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}