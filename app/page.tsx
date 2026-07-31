"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ArrowLeftRight, Building2, ChevronLeft, Download, FileSpreadsheet, HandCoins, Landmark, LogOut, Plus, ReceiptText, Save, Upload, WalletCards } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "@/lib/supabase";
import { AccountingRow, BankMetadata, BankRow, MatchRow, brl, detectAccountingAccount, exportReport, parseAccounting, parseBank, reconcile } from "@/lib/reconciliation";

type Company = { empresa_id: string; perfil: string; empresas: { id: string; codcoligada: string; razao_social: string; cnpj: string } | null };
type Account = { id: string; banco: string; agencia: string; conta_bancaria: string; conta_contabil: string; descricao: string };
type Tab = "conciliacao" | "contas" | "extratos" | "saldos";
type Module = "bancaria" | "emprestimos" | "parcelamentos";

const modules = {
  bancaria: { title: "Conciliação Bancária", description: "Extratos, saldos e lançamentos contábeis em um único fluxo.", icon: Landmark },
  emprestimos: { title: "Conciliação de Empréstimos", description: "Contratos, parcelas, juros e saldos de empréstimos por empresa.", icon: HandCoins },
  parcelamentos: { title: "Conciliação de Parcelamentos", description: "Parcelamentos fiscais e financeiros, vencimentos e baixas.", icon: ReceiptText },
} as const;

const months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const today = new Date();

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [notice, setNotice] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]); const [companyId, setCompanyId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]); const [tab, setTab] = useState<Tab>("conciliacao");
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [year, setYear] = useState(today.getFullYear()); const [month, setMonth] = useState(today.getMonth() + 1);
  const [accounting, setAccounting] = useState<AccountingRow[]>([]); const [bank, setBank] = useState<BankRow[]>([]); const [bankName, setBankName] = useState("");
  const [bankMetadata, setBankMetadata] = useState<BankMetadata>({ agency: "", account: "", period: "", name: "" });
  const [selectedAccount, setSelectedAccount] = useState(""); const [toleranceDays, setToleranceDays] = useState(3); const [toleranceValue, setToleranceValue] = useState(0.01);
  const [results, setResults] = useState<MatchRow[]>([]); const [busy, setBusy] = useState(false);
  const [newAccount, setNewAccount] = useState({ banco: "", agencia: "", conta_bancaria: "", conta_contabil: "", descricao: "" });
  const competence = `${year}-${String(month).padStart(2, "0")}`;
  const company = companies.find((item) => item.empresa_id === companyId);
  const canWrite = (company?.perfil ?? "consulta").toLowerCase() !== "consulta";

  useEffect(() => { supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); }); return supabase.auth.onAuthStateChange((_event, current) => setSession(current)).data.subscription.unsubscribe; }, []);
  useEffect(() => { if (!session) return; (async () => {
    const { data, error } = await supabase.from("usuarios_empresas").select("empresa_id, perfil, empresas(id, codcoligada, razao_social, cnpj)").eq("usuario_id", session.user.id);
    if (error) return setNotice(error.message); const rows = (data ?? []) as unknown as Company[]; setCompanies(rows); if (rows[0]) setCompanyId(rows[0].empresa_id);
  })(); }, [session]);
  useEffect(() => { if (!companyId) return; supabase.from("contas_bancarias").select("id,banco,agencia,conta_bancaria,conta_contabil,descricao").eq("empresa_id", companyId).eq("ativa", true).then(({ data, error }) => { if (error) setNotice(error.message); else { setAccounts((data ?? []) as Account[]); if (data?.[0]) setSelectedAccount(data[0].id); } }); }, [companyId]);

  const detectedAccount = useMemo(() => detectAccountingAccount(accounting, bankMetadata, bankName, accounts), [accounting, bankMetadata, bankName, accounts]);
  const filteredAccounting = useMemo(() => detectedAccount ? accounting.filter((row) => row.account === detectedAccount.code) : [], [accounting, detectedAccount]);
  const counts = useMemo(() => results.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {}), [results]);
  const difference = results.reduce((sum, row) => sum + (row.status === "Somente no banco" ? Math.abs(row.bankValue ?? 0) : row.status === "Somente na contabilidade" ? Math.abs(row.accountingValue ?? 0) : 0), 0);

  async function login(event: React.FormEvent) { event.preventDefault(); setNotice(""); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setNotice("Não foi possível entrar. Confira o e-mail e a senha."); }
  async function readAccounting(file?: File) { if (!file) return; try { setAccounting(await parseAccounting(await file.arrayBuffer())); setNotice("Planilha contábil carregada."); } catch (error) { setNotice((error as Error).message); } }
  async function readBank(file?: File) { if (!file) return; try { const parsed = parseBank(await file.arrayBuffer()); setBank(parsed.rows); setBankMetadata(parsed.metadata); setBankName(file.name); setNotice("Extrato carregado. A conta será identificada automaticamente."); } catch (error) { setNotice((error as Error).message); } }
  function run() { if (!bank.length || !accounting.length) return setNotice("Envie a planilha contábil e o extrato bancário."); if (!detectedAccount || !filteredAccounting.length) return setNotice(`Não foi possível identificar automaticamente a conta do extrato${bankMetadata.account ? ` (${bankMetadata.account})` : ""} na planilha contábil.`); setResults(reconcile(bank, filteredAccounting, toleranceDays, toleranceValue)); setNotice(`Conciliação concluída na conta ${detectedAccount.code} — ${detectedAccount.name}.`); }
  async function saveAccount(event: React.FormEvent) { event.preventDefault(); if (!canWrite) return; setBusy(true); const { error } = await supabase.from("contas_bancarias").insert({ ...newAccount, empresa_id: companyId, ativa: true }); setBusy(false); if (error) return setNotice(error.message); setNotice("Conta cadastrada."); location.reload(); }
  async function storeStatement(file?: File) { if (!file || !selectedAccount || !session) return; setBusy(true); const path = `${companyId}/${competence}/${selectedAccount}/${crypto.randomUUID()}_${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`; const uploaded = await supabase.storage.from("extratos-bancarios").upload(path, file); if (!uploaded.error) await supabase.from("arquivos_importados").insert({ empresa_id: companyId, competencia: competence, conta_bancaria_id: selectedAccount, tipo_arquivo: "extrato", caminho_storage: path, nome_original: file.name, usuario_id: session.user.id }); setBusy(false); setNotice(uploaded.error?.message ?? "Extrato armazenado com segurança."); }

  if (loading) return <main className="center"><div className="spinner" /></main>;
  if (!configured) return <main className="center"><section className="login-card"><h1>Configuração incompleta</h1><p>Cadastre NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel.</p></section></main>;
  if (!session) return <main className="center"><form className="login-card" onSubmit={login}><Image className="brand-logo" src="/logo-raiz.png" alt="Raiz Educação" width={118} height={118} priority /><span className="eyebrow">CENTRAL FINANCEIRA</span><h1>Conciliação Financeira</h1><p>Gestão financeira simples, segura e orientada por dados.</p><label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{notice && <div className="notice error">{notice}</div>}<button className="primary" type="submit">Entrar</button></form></main>;
  if (!companies.length) return <main className="center"><section className="login-card"><h1>Usuário sem empresa vinculada</h1><p>Vincule o usuário a uma empresa no Supabase para continuar.</p><button onClick={() => supabase.auth.signOut()}>Sair</button></section></main>;
  if (!selectedModule) return <ModuleHub email={session.user.email ?? ""} onSelect={setSelectedModule} onLogout={() => supabase.auth.signOut()} />;

  const activeModule = modules[selectedModule];
  const ActiveModuleIcon = activeModule.icon;

  return <div className="shell">
    <aside><div className="logo"><Image className="logo-image" src="/logo-raiz.png" alt="Raiz Educação" width={54} height={54} priority /><div><b>RAIZ</b><span>Educação</span></div></div><button className="module-back" onClick={() => setSelectedModule(null)}><ChevronLeft />Trocar módulo</button><div className="current-module"><ActiveModuleIcon /><span>{activeModule.title}</span></div>{selectedModule === "bancaria" && <nav>{([{ id: "conciliacao", label: "Conciliação", icon: ArrowLeftRight }, { id: "contas", label: "Contas", icon: WalletCards }, { id: "extratos", label: "Extratos", icon: Upload }, { id: "saldos", label: "Saldos", icon: FileSpreadsheet }] as const).map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon />{label}</button>)}</nav>}<div className="company-sidebar"><span>Empresas</span><div className="company-list">{companies.map((item) => <button key={item.empresa_id} className={companyId === item.empresa_id ? "selected" : ""} onClick={() => setCompanyId(item.empresa_id)}><b>{item.empresas?.codcoligada}</b><span>{item.empresas?.razao_social}</span></button>)}</div><div className="period"><label>Ano<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label><label>Mês<select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{months.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label></div></div><button className="logout" onClick={() => supabase.auth.signOut()}><LogOut />Sair</button></aside>
    <main className="content"><header><div><span className="eyebrow">CENTRAL FINANCEIRA</span><h1>{activeModule.title}</h1><p>{activeModule.description}</p></div><div className="user-chip">{session.user.email}</div></header>
      <section className="metrics"><article><span>Empresa ativa</span><b>{company?.empresas?.codcoligada} — {company?.empresas?.razao_social}</b></article><article><span>Competência</span><b>{String(month).padStart(2, "0")}/{year}</b></article><article><span>Contas ativas</span><b>{accounts.length}</b></article><article><span>Perfil</span><b>{company?.perfil}</b></article></section>
      {notice && <div className="notice">{notice}</div>}
      {selectedModule === "bancaria" && tab === "conciliacao" && <section className="panel"><div className="panel-title"><div><h2>Nova conciliação</h2><p>Envie os arquivos; o sistema identifica a conta automaticamente pelo extrato e pela planilha.</p></div><button className="secondary" disabled={!results.length} onClick={() => exportReport(results, `conciliacao_${competence}`)}><Download />Baixar relatório</button></div><div className="form-grid"><label>Planilha contábil<input type="file" accept=".xlsx,.xlsm" onChange={(e) => readAccounting(e.target.files?.[0])} /></label><label>Extrato bancário<input type="file" accept=".xlsx,.xlsm" onChange={(e) => readBank(e.target.files?.[0])} /></label><label>Conta identificada<input readOnly value={detectedAccount ? `${detectedAccount.code} — ${detectedAccount.name}` : bank.length ? "Aguardando correspondência na planilha contábil" : "Envie o extrato bancário"} /></label><label>Tolerância de dias<input type="number" min="0" max="15" value={toleranceDays} onChange={(e) => setToleranceDays(Number(e.target.value))} /></label><label>Tolerância de valor<input type="number" min="0" step="0.01" value={toleranceValue} onChange={(e) => setToleranceValue(Number(e.target.value))} /></label></div><button className="primary run" onClick={run}><ArrowLeftRight />Executar conciliação</button>{results.length > 0 && <><div className="result-metrics"><article><b>{counts["Conciliado"] ?? 0}</b><span>Conciliados</span></article><article><b>{counts["Possível conciliação"] ?? 0}</b><span>Possíveis</span></article><article><b>{counts["Somente no banco"] ?? 0}</b><span>Somente no banco</span></article><article><b>{counts["Somente na contabilidade"] ?? 0}</b><span>Somente na contabilidade</span></article><article><b>{brl(difference)}</b><span>Diferença de conciliação</span></article></div><div className="table-wrap"><table><thead><tr><th>Status</th><th>Data banco</th><th>Histórico</th><th>Valor banco</th><th>Data contábil</th><th>Valor contábil</th></tr></thead><tbody>{results.map((row, index) => <tr key={index}><td><span className={`status s${row.status.charAt(0)}`}>{row.status}</span></td><td>{row.bankDate?.toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td><td>{row.description}</td><td>{row.bankValue == null ? "" : brl(row.bankValue)}</td><td>{row.accountingDate?.toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td><td>{row.accountingValue == null ? "" : brl(row.accountingValue)}</td></tr>)}</tbody></table></div></>}</section>}
      {selectedModule === "bancaria" && tab === "contas" && <section className="panel"><div className="panel-title"><div><h2>Contas bancárias</h2><p>Cadastre o vínculo entre banco e conta contábil.</p></div></div><div className="cards-list">{accounts.map((item) => <article key={item.id}><Landmark /><div><b>{item.banco} · {item.conta_bancaria}</b><span>Ag. {item.agencia} · Contábil {item.conta_contabil}</span></div></article>)}</div><form className="form-grid account-form" onSubmit={saveAccount}>{Object.keys(newAccount).map((key) => <label key={key}>{key.replaceAll("_", " ")}<input value={newAccount[key as keyof typeof newAccount]} onChange={(e) => setNewAccount({ ...newAccount, [key]: e.target.value })} /></label>)}<button className="primary" disabled={!canWrite || busy}><Plus />Cadastrar conta</button></form></section>}
      {selectedModule === "bancaria" && tab === "extratos" && <section className="panel"><h2>Armazenar extratos</h2><p>Os arquivos ficam no bucket privado do Supabase, organizados por empresa e competência.</p><div className="upload-box"><Upload /><label>Selecionar extrato<input type="file" accept=".xlsx,.xlsm" disabled={!canWrite || !selectedAccount || busy} onChange={(e) => storeStatement(e.target.files?.[0])} /></label></div></section>}
      {selectedModule === "bancaria" && tab === "saldos" && <BalancePanel companyId={companyId} competence={competence} accounts={accounts} canWrite={canWrite} userId={session.user.id} onNotice={setNotice} />}
      {selectedModule !== "bancaria" && <section className="panel module-workspace"><ActiveModuleIcon /><span className="eyebrow">MÓDULO SELECIONADO</span><h2>{activeModule.title}</h2><p>A empresa <b>{company?.empresas?.codcoligada} — {company?.empresas?.razao_social}</b> já está selecionada. Este espaço está preparado para receber as regras, contratos e relatórios deste módulo.</p><div className="coming-next"><Building2 /><div><b>Estrutura pronta para evolução</b><span>Empresa, competência e permissões já compartilham a mesma base da conciliação bancária.</span></div></div></section>}
    </main>
  </div>;
}

function ModuleHub({ email, onSelect, onLogout }: { email: string; onSelect: (module: Module) => void; onLogout: () => void }) {
  return <main className="module-hub"><header><div className="hub-brand"><Image src="/logo-raiz.png" alt="Raiz Educação" width={78} height={78} priority /><div><span className="eyebrow">CENTRAL FINANCEIRA</span><h1>Como deseja trabalhar hoje?</h1><p>Escolha uma área para acessar as empresas e iniciar a conferência.</p></div></div><div className="hub-user"><span>{email}</span><button onClick={onLogout}><LogOut />Sair</button></div></header><section className="module-grid">{(Object.entries(modules) as [Module, typeof modules[Module]][]).map(([id, item]) => { const Icon = item.icon; return <button key={id} className={`module-card module-${id}`} onClick={() => onSelect(id)}><span className="module-icon"><Icon /></span><span className="module-copy"><b>{item.title}</b><small>{item.description}</small></span><span className="module-enter">Acessar <ArrowLeftRight /></span></button>; })}</section></main>;
}

function previousCompetence(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function BalancePanel({ companyId, competence, accounts, canWrite, userId, onNotice }: { companyId: string; competence: string; accounts: Account[]; canWrite: boolean; userId: string; onNotice: (value: string) => void }) {
  const [accountId, setAccountId] = useState(""); const [initial, setInitial] = useState(0); const [final, setFinal] = useState(0); const [carry, setCarry] = useState(false);
  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);
  useEffect(() => { if (!accountId) return; (async () => {
    const current = await supabase.from("saldos_bancarios").select("saldo_inicial,saldo_final,fixar_mes_seguinte").eq("conta_bancaria_id", accountId).eq("competencia", competence).maybeSingle();
    if (current.error) return onNotice(current.error.message);
    if (current.data) { setInitial(Number(current.data.saldo_inicial)); setFinal(Number(current.data.saldo_final)); setCarry(Boolean(current.data.fixar_mes_seguinte)); return; }
    const previous = await supabase.from("saldos_bancarios").select("saldo_final,fixar_mes_seguinte").eq("conta_bancaria_id", accountId).eq("competencia", previousCompetence(competence)).maybeSingle();
    setInitial(previous.data?.fixar_mes_seguinte ? Number(previous.data.saldo_final) : 0); setFinal(0); setCarry(false);
  })(); }, [accountId, competence, onNotice]);
  async function save() { const { error } = await supabase.from("saldos_bancarios").upsert({ conta_bancaria_id: accountId, competencia: competence, saldo_inicial: initial, saldo_final: final, fixar_mes_seguinte: carry, usuario_id: userId }, { onConflict: "conta_bancaria_id,competencia" }); onNotice(error?.message ?? "Saldos atualizados."); }
  return <section className="panel"><h2>Saldos bancários</h2><div className="form-grid"><label>Conta<select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.banco} · {item.conta_bancaria}</option>)}</select></label><label>Saldo inicial<input type="number" step="0.01" value={initial} onChange={(e) => setInitial(Number(e.target.value))} /></label><label>Saldo final<input type="number" step="0.01" value={final} onChange={(e) => setFinal(Number(e.target.value))} /></label><label className="checkbox"><input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />Fixar para o mês seguinte</label></div><button className="primary" disabled={!canWrite || !companyId || !accountId} onClick={save}><Save />Salvar saldos</button></section>;
}
