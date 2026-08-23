import { NextResponse } from "next/server";
import { isAllowedCorporateEmail } from "@/lib/auth-domain";
import { createPublicServerSupabase } from "@/lib/server/supabase-access";

export async function POST(request: Request) {
  const client = createPublicServerSupabase();
  if (!client) {
    return NextResponse.json({ error: "A solicitação de acesso ainda não está configurada." }, { status: 503 });
  }

  let email = "";
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }

  if (!isAllowedCorporateEmail(email)) {
    return NextResponse.json(
      { error: "Somente e-mails @raizeducacao.com.br podem solicitar acesso." },
      { status: 400 },
    );
  }

  const { error } = await client.rpc("solicitar_acesso_contabilidade", { p_email: email });
  if (error) {
    return NextResponse.json({ error: "Não foi possível registrar a solicitação agora." }, { status: 500 });
  }

  return NextResponse.json({ message: "Solicitação enviada para aprovação." }, { status: 201 });
}
