"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, CheckCircle2, LogOut, ShieldCheck, UserPlus, XCircle } from "lucide-react";
import { ACCESS_MODULE_LABELS, ACCESS_MODULES, type AccessModule } from "@/lib/access-control";

type AccessRequest = {
  id: string;
  email: string;
  status: string;
  solicitado_em: string;
};

type Selection = {
  modules: AccessModule[];
};

export default function AccessManagement({
  accessToken,
  email,
  onBack,
  onLogout,
}: {
  accessToken: string;
  email: string;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/access-requests", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar as solicitações.");
        if (!active) return;
        const loadedRequests = (body.requests ?? []) as AccessRequest[];
        setRequests(loadedRequests);
        setSelections(Object.fromEntries(loadedRequests.map((item) => [item.id, { modules: [] }])));
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as solicitações.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [accessToken]);

  function toggleModule(requestId: string, module: AccessModule) {
    setSelections((current) => {
      const selection = current[requestId] ?? { modules: [] };
      return {
        ...current,
        [requestId]: {
          ...selection,
          modules: selection.modules.includes(module)
            ? selection.modules.filter((item) => item !== module)
            : [...selection.modules, module],
        },
      };
    });
  }

  async function decide(requestId: string, action: "approve" | "reject") {
    setBusyId(requestId);
    setError("");
    setNotice("");
    const selection = selections[requestId] ?? { modules: [] };
    try {
      const response = await fetch("/api/admin/access-requests", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action, requestId, modules: selection.modules }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível concluir esta ação.");
      setRequests((current) => current.filter((item) => item.id !== requestId));
      setNotice(body.message || "Solicitação atualizada.");
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Não foi possível concluir esta ação.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="access-admin-page">
      <header className="access-admin-header">
        <div className="hub-brand">
          <Image src="/logo-raiz.png" alt="Raiz Educação" width={68} height={68} priority />
          <div>
            <button className="hub-back" onClick={onBack}><ArrowLeft /> Voltar aos módulos</button>
            <span className="eyebrow">ADMINISTRAÇÃO DE ACESSOS</span>
            <h1>Solicitações de usuários</h1>
            <p>Aprove somente colaboradores da Raiz e escolha exatamente os módulos liberados.</p>
          </div>
        </div>
        <div className="hub-user">
          <span>{email}</span>
          <button onClick={onLogout}><LogOut /> Sair</button>
        </div>
      </header>

      {notice && <div className="notice access-notice"><CheckCircle2 /> {notice}</div>}
      {error && <div className="notice error access-notice"><XCircle /> {error}</div>}

      <section className="access-admin-summary">
        <ShieldCheck />
        <div><b>Permissões protegidas no servidor</b><span>Todo usuário aprovado será criado como Membro, nunca como administrador.</span></div>
        <strong>{requests.length} pendente{requests.length === 1 ? "" : "s"}</strong>
      </section>

      {loading ? (
        <section className="access-empty"><div className="spinner" /><b>Carregando solicitações...</b></section>
      ) : requests.length === 0 ? (
        <section className="access-empty"><UserPlus /><b>Nenhuma solicitação pendente</b><span>Novos pedidos de e-mails @raizeducacao.com.br aparecerão aqui.</span></section>
      ) : (
        <section className="access-request-list">
          {requests.map((request) => {
            const selection = selections[request.id] ?? { modules: [] };
            const disabled = busyId === request.id;
            return (
              <article className="access-request-card" key={request.id}>
                <div className="access-request-title">
                  <div><span>SOLICITAÇÃO DE ACESSO</span><h2>{request.email}</h2><small>Solicitado em {new Date(request.solicitado_em).toLocaleString("pt-BR")}</small></div>
                  <span className="access-member-badge">Perfil: Membro</span>
                </div>

                <fieldset>
                  <legend>Módulos que o usuário poderá acessar</legend>
                  <div className="access-options access-module-options">
                    {ACCESS_MODULES.map((module) => (
                      <label key={module} className={selection.modules.includes(module) ? "selected" : ""}>
                        <input type="checkbox" checked={selection.modules.includes(module)} onChange={() => toggleModule(request.id, module)} />
                        <span>{ACCESS_MODULE_LABELS[module]}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="access-all-companies-note">
                  Todas as empresas ativas serão liberadas automaticamente para este usuário.
                </div>

                <div className="access-request-actions">
                  <button type="button" className="access-reject" disabled={disabled} onClick={() => void decide(request.id, "reject")}><XCircle /> Recusar</button>
                  <button
                    type="button"
                    className="primary"
                    disabled={disabled || !selection.modules.length}
                    onClick={() => void decide(request.id, "approve")}
                  >
                    <CheckCircle2 /> {disabled ? "Processando..." : "Aprovar e enviar link"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
