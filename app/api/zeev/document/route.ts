import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

async function authenticatedUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization || !url || !key) return null;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { authorization, apikey: key },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const user = await response.json();
  const email = String(user?.email || "").trim().toLowerCase();
  return email ? { id: String(user?.id || ""), email } : null;
}

function safeFileName(value: string) {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "documento-zeev";
}

export async function GET(request: NextRequest) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });

    const baseUrl = (process.env.ZEEV_BASE_URL || "https://raizeducacao.zeev.it").replace(/\/$/, "");
    const requestedUrl = request.nextUrl.searchParams.get("url")?.trim();
    const requestedName = request.nextUrl.searchParams.get("name")?.trim() || "documento-zeev";
    if (!requestedUrl) return NextResponse.json({ error: "Documento do Zeev não informado." }, { status: 400 });

    const base = new URL(baseUrl);
    const target = new URL(requestedUrl, `${base.origin}/`);
    if (target.hostname !== base.hostname) {
      return NextResponse.json({ error: "O documento informado não pertence ao Zeev configurado." }, { status: 400 });
    }

    const token = process.env.ZEEV_INTEGRATION_TOKEN || process.env.ZEEV_API_TOKEN;
    const response = await fetch(target.toString(), {
      headers: {
        accept: "*/*",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `O Zeev recusou o download do documento (${response.status}).` }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const fileName = safeFileName(requestedName);
    return new NextResponse(response.body, {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message || "Falha ao baixar o documento do Zeev." }, { status: 503 });
  }
}
