import { NextResponse, type NextRequest } from "next/server";
import { isAllowedCorporateEmail } from "@/lib/auth-domain";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/data-engine/jwks") {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!authorization || !supabaseUrl || !anonKey) {
    return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { authorization, apikey: anonKey },
    cache: "no-store",
  });
  if (!response.ok) {
    return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 });
  }

  const user = await response.json();
  if (!isAllowedCorporateEmail(user?.email)) {
    return NextResponse.json({ error: "Acesso permitido somente para e-mails @raizeducacao.com.br." }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
