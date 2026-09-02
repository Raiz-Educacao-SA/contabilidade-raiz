"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  MODULE_COMPLETION_CHANGED_EVENT,
  type ModuleCompletionChangeDetail,
  type ScheduleCompletion,
  type ScheduleCompletionIdentity,
} from "@/lib/schedule-completion";

export default function ModuleCompletionControl({ competence, modulo, setor, additionalItems = [], userId, userEmail, disabled = false, disabledReason = "", onStatusChange }: {
  competence: string;
  modulo: string;
  setor: string;
  additionalItems?: ScheduleCompletionIdentity[];
  userId: string;
  userEmail: string;
  disabled?: boolean;
  disabledReason?: string;
  onStatusChange?: (done: boolean) => void;
}) {
  const [completions, setCompletions] = useState<ScheduleCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const items = [{ modulo, setor }, ...additionalItems];
  const moduleKeys = items.map((item) => item.modulo);
  const moduleKeysKey = moduleKeys.join("|");

  useEffect(() => {
    let active = true;
    const expectedModuleKeys = moduleKeysKey.split("|").filter(Boolean);
    const load = async () => {
      const { data, error: loadError } = await supabase
        .from("cronograma_entregas")
        .select("modulo,setor,status,confirmado_email,confirmado_em")
        .eq("competencia", competence)
        .in("modulo", expectedModuleKeys);
      if (!active) return;
      const loadedCompletions = loadError ? [] : data as ScheduleCompletion[];
      setCompletions(loadedCompletions);
      if (!loadError) {
        onStatusChange?.(
          expectedModuleKeys.length > 0 && expectedModuleKeys.every((key) =>
            loadedCompletions.some((completion) => completion.modulo === key && completion.status === "concluido"),
          ),
        );
      }
      setError(loadError ? "Não foi possível consultar o status compartilhado." : "");
      setLoading(false);
    };
    void Promise.resolve().then(() => {
      if (active) setLoading(true);
      return load();
    });
    const channel = supabase.channel(`conclusao-${competence}-${modulo}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cronograma_entregas", filter: `competencia=eq.${competence}` }, () => void load())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [competence, modulo, moduleKeysKey, onStatusChange]);

  async function save(done: boolean) {
    setSaving(true);
    setError("");
    const confirmedAt = new Date().toISOString();
    const completionRows = items.map((item) => {
      const previous = completions.find((completion) => completion.modulo === item.modulo);
      return {
        competencia: competence,
        modulo: item.modulo,
        setor: item.setor,
        status: done ? "concluido" : "pendente",
        confirmado_por: userId,
        confirmado_email: done ? userEmail : previous?.confirmado_email || userEmail,
        confirmado_em: done ? confirmedAt : previous?.confirmado_em || confirmedAt,
      };
    });
    const { error: saveError } = await supabase
      .from("cronograma_entregas")
      .upsert(completionRows, { onConflict: "competencia,modulo" });
    if (saveError) {
      setError("Não foi possível atualizar o Cronograma.");
      setSaving(false);
      return;
    }
    const historyRows = items.map((item) => ({
      competencia: competence,
      modulo: item.modulo,
      setor: item.setor,
      acao: done ? "liberado" : "reaberto",
      usuario_id: userId,
      usuario_email: userEmail,
    }));
    const { error: historyError } = await supabase
      .from("cronograma_historico")
      .insert(historyRows);
    if (historyError) setError("A tarefa foi atualizada, mas o histórico não pôde ser registrado.");
    const nextCompletions = completionRows.map((row) => ({
      modulo: row.modulo,
      setor: row.setor,
      status: row.status as ScheduleCompletion["status"],
      confirmado_email: row.confirmado_email,
      confirmado_em: row.confirmado_em,
    }));
    setCompletions(nextCompletions);
    const latestRecordedCompletion = nextCompletions
      .filter((completion) => completion.confirmado_em)
      .sort((left, right) => String(right.confirmado_em || "").localeCompare(String(left.confirmado_em || "")))[0];
    const completionChange: ModuleCompletionChangeDetail = {
      competence,
      moduleKeys,
      status: done ? "concluido" : "pendente",
      confirmedAt: latestRecordedCompletion?.confirmado_em || confirmedAt,
      userEmail: latestRecordedCompletion?.confirmado_email || userEmail,
    };
    window.dispatchEvent(new CustomEvent(MODULE_COMPLETION_CHANGED_EVENT, {
      detail: completionChange,
    }));
    onStatusChange?.(done);
    setSaving(false);
  }

  const done = moduleKeys.length > 0 && moduleKeys.every((key) =>
    completions.some((completion) => completion.modulo === key && completion.status === "concluido"),
  );
  const latestCompletion = completions
    .filter((completion) => completion.confirmado_em)
    .sort((left, right) => String(right.confirmado_em || "").localeCompare(String(left.confirmado_em || "")))[0];
  const completedAt = latestCompletion?.confirmado_em
    ? new Date(latestCompletion.confirmado_em).toLocaleString("pt-BR")
    : "";
  return <div className="module-completion-control">
    {latestCompletion && <small>{done ? "Finalizado" : "Última finalização"} por {latestCompletion.confirmado_email || "usuário"}{completedAt ? ` em ${completedAt}` : ""}</small>}
    <button type="button" className={done ? "is-finalized" : ""} disabled={loading || saving || (!done && disabled)} onClick={() => void save(!done)} title={!done && disabled ? disabledReason : undefined}>
      {done ? <RotateCcw /> : <CheckCircle2 />}{saving ? "Salvando..." : done ? "Reabrir tarefa" : "Finalizar tarefa"}
    </button>
    {!done && disabled && disabledReason && <small>{disabledReason}</small>}
    {error && <span>{error}</span>}
  </div>;
}
