import { NextResponse } from "next/server";
import { isAllowedCorporateEmail } from "@/lib/auth-domain";
import { ACCESS_MODULES, isAccessModule, type AccessModule } from "@/lib/access-control";
import {
  authenticatedCorporateUser,
  createAdminServerSupabase,
  createPublicServerSupabase,
  isAdministrator,
} from "@/lib/server/supabase-access";

type ApprovalBody = {
  action?: unknown;
  requestId?: unknown;
  modules?: unknown;
};

async function authorizedContext(request: Request) {
  const user = await authenticatedCorporateUser(request);
  const admin = createAdminServerSupabase();
  if (!user || !admin || !(await isAdministrator(admin, user.id))) return null;
  return { user, admin };
}

async function findUserByEmail(admin: NonNullable<ReturnType<typeof createAdminServerSupabase>>, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((candidate) => candidate.email?.trim().toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

export async function GET(request: Request) {
  const context = await authorizedContext(request);
  if (!context) return NextResponse.json({ error: "Acesso restrito aos administradores." }, { status: 403 });

  const requestsResult = await context.admin
    .from("solicitacoes_acesso")
    .select("id,email,status,solicitado_em")
    .eq("status", "pendente")
    .order("solicitado_em", { ascending: true });

  if (requestsResult.error) {
    return NextResponse.json({ error: "Não foi possível carregar as solicitações." }, { status: 500 });
  }

  return NextResponse.json({
    requests: requestsResult.data ?? [],
    modules: ACCESS_MODULES,
  });
}

export async function POST(request: Request) {
  const context = await authorizedContext(request);
  if (!context) return NextResponse.json({ error: "Acesso restrito aos administradores." }, { status: 403 });

  let body: ApprovalBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dados da solicitação inválidos." }, { status: 400 });
  }

  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const action = body.action === "approve" || body.action === "reject" ? body.action : "";
  if (!requestId || !action) {
    return NextResponse.json({ error: "Dados da solicitação inválidos." }, { status: 400 });
  }

  const { data: accessRequest, error: requestError } = await context.admin
    .from("solicitacoes_acesso")
    .select("id,email,status")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError || !accessRequest || accessRequest.status !== "pendente") {
    return NextResponse.json({ error: "A solicitação não está mais pendente." }, { status: 409 });
  }

  const email = String(accessRequest.email).trim().toLowerCase();
  if (!isAllowedCorporateEmail(email)) {
    return NextResponse.json({ error: "O e-mail da solicitação não pertence ao domínio da Raiz." }, { status: 400 });
  }

  if (action === "reject") {
    const { error } = await context.admin
      .from("solicitacoes_acesso")
      .update({
        status: "rejeitado",
        analisado_por: context.user.id,
        analisado_em: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pendente");
    if (error) return NextResponse.json({ error: "Não foi possível recusar a solicitação." }, { status: 500 });
    return NextResponse.json({ message: "Solicitação recusada." });
  }

  const modules = Array.isArray(body.modules)
    ? [...new Set(body.modules.filter(isAccessModule))] as AccessModule[]
    : [];
  if (!modules.length) {
    return NextResponse.json({ error: "Selecione ao menos um módulo." }, { status: 400 });
  }

  const { data: activeCompanies, error: companiesError } = await context.admin
    .from("empresas")
    .select("id")
    .eq("ativa", true);
  if (companiesError || !activeCompanies?.length) {
    return NextResponse.json({ error: "Nenhuma empresa ativa foi encontrada para liberar." }, { status: 500 });
  }
  const companyIds = activeCompanies.map((company) => company.id);

  try {
    let invitedUser = await findUserByEmail(context.admin, email);
    let invitationSent = false;
    const redirectTo = `${new URL(request.url).origin}/definir-senha`;

    if (invitedUser) {
      const { data: existingLinks } = await context.admin
        .from("usuarios_empresas")
        .select("perfil")
        .eq("usuario_id", invitedUser.id);
      if (existingLinks?.some((link) => String(link.perfil).trim().toLowerCase() === "administrador")) {
        return NextResponse.json({ error: "Este e-mail já pertence a um administrador." }, { status: 409 });
      }
      const publicClient = createPublicServerSupabase();
      if (!publicClient) throw new Error("Cliente público do Supabase não configurado.");
      const reset = await publicClient.auth.resetPasswordForEmail(email, { redirectTo });
      if (reset.error) throw reset.error;
      invitationSent = true;
    } else {
      const invitation = await context.admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { origem: "contabilidade-raiz", solicitacao_acesso_id: requestId },
      });
      if (invitation.error || !invitation.data.user) throw invitation.error ?? new Error("Convite não criado.");
      invitedUser = invitation.data.user;
      invitationSent = true;
    }

    const clearCompanies = await context.admin.from("usuarios_empresas").delete().eq("usuario_id", invitedUser.id);
    if (clearCompanies.error) throw clearCompanies.error;
    const companyLinks = await context.admin.from("usuarios_empresas").insert(
      companyIds.map((empresaId) => ({ usuario_id: invitedUser!.id, empresa_id: empresaId, perfil: "Membro" })),
    );
    if (companyLinks.error) throw companyLinks.error;

    const clearModules = await context.admin.from("usuarios_modulos").delete().eq("usuario_id", invitedUser.id);
    if (clearModules.error) throw clearModules.error;
    const moduleLinks = await context.admin.from("usuarios_modulos").insert(
      modules.map((modulo) => ({ usuario_id: invitedUser!.id, modulo, concedido_por: context.user.id })),
    );
    if (moduleLinks.error) throw moduleLinks.error;

    const approval = await context.admin
      .from("solicitacoes_acesso")
      .update({
        status: "aprovado",
        usuario_id: invitedUser.id,
        modulos: modules,
        empresa_ids: companyIds,
        analisado_por: context.user.id,
        analisado_em: new Date().toISOString(),
        convite_enviado_em: invitationSent ? new Date().toISOString() : null,
      })
      .eq("id", requestId)
      .eq("status", "pendente");
    if (approval.error) throw approval.error;

    return NextResponse.json({ message: "Acesso aprovado e link para criação da senha enviado." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    return NextResponse.json({ error: `Não foi possível concluir a aprovação: ${message}` }, { status: 500 });
  }
}
