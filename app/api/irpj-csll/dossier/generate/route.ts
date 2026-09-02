import { NextResponse, type NextRequest } from "next/server";
import { dossierServiceErrorResponse, generateMonthlyDossier } from "@/lib/fiscal/monthly-dossier-service";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}));
    return NextResponse.json(await generateMonthlyDossier(request, payload));
  } catch (error) {
    const response = dossierServiceErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}