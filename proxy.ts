import { NextResponse, type NextRequest } from "next/server";
import { isAllowedCorporateEmail } from "@/lib/auth-domain";
import { requiredModulesForApiPath, resolveAllowedModules } from "@/lib/access-control";
import { isIrpjCsllHomologationToken } from "@/lib/fiscal/homologation-mode";

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/api/data-engine/jwks"
    || request.nextUrl.pathname === "/api/access-requests"
  ) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/irpj-csll")) {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (isIrpjCsllHomologationToken(token)) return NextResponse.next();
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

  const requiredModules = requiredModulesForApiPath(request.nextUrl.pathname);
  if (requiredModules.length) {
    const accessHeaders = { authorization, apikey: anonKey };
    const [profilesResponse, grantsResponse] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/usuarios_empresas?select=perfil&usuario_id=eq.${encodeURIComponent(user.id)}`,
        { headers: accessHeaders, cache: "no-store" },
      ),
      fetch(
        `${supabaseUrl}/rest/v1/usuarios_modulos?select=modulo&usuario_id=eq.${encodeURIComponent(user.id)}`,
        { headers: accessHeaders, cache: "no-store" },
      ),
    ]);
    if (!profilesResponse.ok) {
      return NextResponse.json({ error: "Não foi possível confirmar as permissões do usuário." }, { status: 403 });
    }
    const profiles = (await profilesResponse.json()) as { perfil?: string }[];
    const grants = grantsResponse.ok ? await grantsResponse.json() as { modulo?: string }[] : [];
    const allowed = resolveAllowedModules(
      profiles.map((row) => row.perfil ?? ""),
      grants.map((row) => row.modulo ?? ""),
    );
    if (!requiredModules.some((module) => allowed.includes(module))) {
      return NextResponse.json({ error: "Seu usuário não possui acesso a este módulo." }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
