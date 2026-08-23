"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, KeyRound } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { isAllowedCorporateEmail } from "@/lib/auth-domain";
import { supabase } from "@/lib/supabase";

export default function DefinePasswordPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    const acceptSession = (current: Session | null) => {
      if (!active) return;
      if (current && isAllowedCorporateEmail(current.user.email)) setSession(current);
      else setSession(null);
      setLoading(false);
    };

    void supabase.auth.getSession().then(({ data }) => acceptSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, current) => acceptSession(current));
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 10) {
      setError("A senha deve ter pelo menos 10 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas informadas não são iguais.");
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError("Não foi possível criar a senha. Solicite um novo link ao administrador.");
      return;
    }
    setCompleted(true);
  }

  if (loading) {
    return <main className="center"><section className="login-card auth-check"><div className="spinner" /><h1>Validando seu convite...</h1><p>Aguarde enquanto confirmamos o link de acesso.</p></section></main>;
  }

  if (!session) {
    return (
      <main className="center">
        <section className="login-card password-link-card">
          <KeyRound />
          <h1>Link inválido ou expirado</h1>
          <p>Peça ao administrador para aprovar novamente seu acesso e enviar um novo link.</p>
          <Link className="primary" href="/">Voltar para o login</Link>
        </section>
      </main>
    );
  }

  if (completed) {
    return (
      <main className="center">
        <section className="login-card password-link-card password-created">
          <CheckCircle2 />
          <h1>Senha criada com sucesso</h1>
          <p>Seu acesso está pronto. Você verá somente os módulos liberados pelo administrador.</p>
          <Link className="primary" href="/">Acessar Contabilidade Raiz</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="center">
      <form className="login-card" onSubmit={savePassword}>
        <Image className="brand-logo" src="/logo-raiz.png" alt="Raiz Educação" width={108} height={108} priority />
        <span className="eyebrow">PRIMEIRO ACESSO</span>
        <h1>Crie sua senha</h1>
        <p>Convite confirmado para <b>{session.user.email}</b>.</p>
        <label>Nova senha<input type="password" value={password} minLength={10} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} required /></label>
        <label>Confirme a senha<input type="password" value={confirmation} minLength={10} autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} required /></label>
        <small className="password-hint">Use pelo menos 10 caracteres.</small>
        {error && <div className="notice error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>{busy ? "Criando senha..." : "Criar senha"}</button>
      </form>
    </main>
  );
}
