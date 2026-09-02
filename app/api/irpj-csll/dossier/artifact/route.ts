import { type NextRequest } from "next/server";
import { dossierServiceErrorResponse, getMonthlyDossierArtifact } from "@/lib/fiscal/monthly-dossier-service";

function attachmentName(fileName: string) {
  return fileName.replace(/[^A-Za-z0-9_.=-]/g, "_");
}

export async function GET(request: NextRequest) {
  try {
    const response = await getMonthlyDossierArtifact(request);
    const body = new Uint8Array(response.bytes);
    return new Response(body, {
      headers: {
        "Content-Type": response.artifact.contentType,
        "Content-Length": String(response.bytes.length),
        "Content-Disposition": `attachment; filename="${attachmentName(response.artifact.fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const response = dossierServiceErrorResponse(error);
    return Response.json(response.body, { status: response.status });
  }
}