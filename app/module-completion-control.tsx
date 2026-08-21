"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ScheduleCompletion } from "@/lib/schedule-completion";

export default function ModuleCompletionControl({ competence, modulo, setor, userId, userEmail }: {
  competence: string;
  modulo: string;
  setor: string;
  userId: string;
  userEmail: string;
}) {
  const [completion, setCompletion] = useState<ScheduleCompletion | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error: loadError } = await supabase
        .from("cronograma_entregas")
        .select("modulo,setor,status,confirmado_email,confirmado_em")
        .eq("competencia", competence)
        .eq("modulo", modulo)
        .maybeSingle();
      if (!active) return;
      setCompletion(loadError ? null : data as ScheduleCompletion | null);
      setError(loadError ? "Não foi possível consultar o status compartilhado." : "");
      setLoading(false);
    };
    setLoading(true);
    void load();
    const channel = supabase.channel(`conclusao-${competence}-${modulo}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cronograma_entregas", filter: `competencia=eq.${competence}` }, () => void load())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [competence, modulo]);

  async function save(done: boolean) {
    setSaving(true);
    setError("");
    const confirmedAt = new Date().toISOString();
    const { error: saveError } = await supabase.from("cronograma_entregas").upsert({
      competencia: competence, modulo, setor,
      status: done ? "concluido" : "pendente",
      confirmado_por: userId, confirmado_email: userEmail, confirmado_em: confirmedAt,
    }, { onConflict: "competencia,modulo" });
    if (saveError) {
      setError("Não foi possível atualizar o Cronograma.");
      setSaving(false);
      return;
    }
    await supabase.from("cronograma_historico").insert({
      competencia: competence, modulo, setor,
      acao: done ? "liberado" : "reaberto", usuario_id: userId, usuario_email: userEmail,
    });
    setCompletion({ modulo, setor, status: done ? "concluido" : "pendente", confirmado_email: userEmail, confirmado_em: confirmedAt });
    setSaving(false);
  }

  const done = completion?.status === "concluido";
  return <div className="module-completion-control">
    {done && <small>Finalizado por {completion?.confirmado_email || "usuário"}</small>}
    <button type="button" className={done ? "is-finalized" : ""} disabled={loading || saving} onClick={() => void save(!done)}>
      {done ? <RotateCcw /> : <CheckCircle2 />}{saving ? "Salvando..." : done ? "Reabrir tarefa" : "Finalizar tarefa"}
    </button>
    {error && <span>{error}</span>}
  </div>;
}
