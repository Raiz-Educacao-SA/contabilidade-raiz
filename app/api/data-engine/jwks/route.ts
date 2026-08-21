import { NextResponse } from "next/server";
import { createDataEnginePublicJwk } from "@/lib/server/data-engine-oauth";

export const runtime = "nodejs";

export async function GET() {
  const kid = process.env.DATA_ENGINE_KID;
  const privateKeyPem = process.env.DATA_ENGINE_PRIVATE_KEY;
  if (!kid || !privateKeyPem) {
    return NextResponse.json(
      { error: "JWKS do Data Engine não configurado." },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(
      { keys: [createDataEnginePublicJwk(privateKeyPem, kid)] },
      {
        headers: {
          "cache-control": "public, max-age=300, stale-while-revalidate=300",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "JWKS do Data Engine inválido." },
      { status: 503 },
    );
  }
}
