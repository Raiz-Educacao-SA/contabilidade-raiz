import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { isAllowedCorporateEmail } from "../auth-domain.ts";

function publicConfiguration() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
  };
}

export function createPublicServerSupabase() {
  const { url, anonKey } = publicConfiguration();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createAdminServerSupabase(): SupabaseClient | null {
  const { url } = publicConfiguration();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

export async function authenticatedCorporateUser(request: Request): Promise<User | null> {
  const token = bearerToken(request);
  const client = createPublicServerSupabase();
  if (!token || !client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || !isAllowedCorporateEmail(data.user.email)) return null;
  return data.user;
}

export async function isAdministrator(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("usuarios_empresas")
    .select("id")
    .eq("usuario_id", userId)
    .ilike("perfil", "administrador")
    .limit(1);
  return !error && Boolean(data?.length);
}
