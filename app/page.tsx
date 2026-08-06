"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowLeftRight,
  BookOpenCheck,
  BookText,
  Building2,
  ChevronLeft,
  Download,
  FileSpreadsheet,
  HandCoins,
  Landmark,
  ListTree,
  LogOut,
  Pin,
  Plus,
  ReceiptText,
  Save,
  ShoppingCart,
  SlidersHorizontal,
  TrendingUp,
  Upload,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "@/lib/supabase";
import {
  AccountingRow,
  BankMetadata,
  BankRow,
  MatchRow,
  brl,
  detectAccountingAccount,
  exportReport,
  parseAccounting,
  parseBank,
  reconcile,
} from "@/lib/reconciliation";
import MonthlyReconciliationPanel from "@/app/monthly-reconciliation";
import BookAccountingPanel from "@/app/book-accounting";
import RevenueReconciliation from "@/app/revenue-reconciliation";
import PisCofinsAssessment from "@/app/pis-cofins-assessment";
import { getCompanyTaxRegime } from "@/lib/tax-regimes";

type Company = {
  empresa_id: string;
  perfil: string;
  empresas: {
    id: string;
    codcoligada: string;
    razao_social: string;
    cnpj: string;
  } | null;
};
type Account = {
  id: string;
  banco: string;
  agencia: string;
  conta_bancaria: string;
  conta_contabil: string;
  descricao: string;
};
type Tab = "conciliacao" | "contas" | "extratos" | "saldos";
type AccountingTab = "pis-cofins" | "irpj-csll" | "rateio-csc" | "intercompany";
type BookReport = "balancete" | "razao" | "plano-contas";
type Area = "financeiro" | "compras" | "folha" | "contabil" | "book";
type Module =
  | "bancaria"
  | "emprestimos"
  | "parcelamentos"
  | "receita"
  | "compras"
  | "folha"
  | "contabil"
  | "book";
type PinnedReconciliation = {
  id: string;
  bankName: string;
  bankAccount: string;
  accountCode: string;
  accountName: string;
  rows: MatchRow[];
};

const modules = {
  bancaria: {
    title: "Conciliação Bancária",
    description: "Extratos, saldos e lançamentos contábeis em um único fluxo.",
    icon: Landmark,
  },
  emprestimos: {
    title: "Conciliação de Empréstimos",
    description:
      "Contratos, parcelas, juros e saldos de empréstimos por empresa.",
    icon: HandCoins,
  },
  parcelamentos: {
    title: "Conciliação de Parcelamentos",
    description: "Parcelamentos fiscais e financeiros, vencimentos e baixas.",
    icon: ReceiptText,
  },
  receita: {
    title: "Conciliação de Receita",
    description:
      "Receitas reconhecidas, recebimentos, baixas e diferenças por empresa.",
    icon: TrendingUp,
  },
  compras: {
    title: "Compras",
    description:
      "Solicitações, pedidos, fornecedores e acompanhamento das aquisições.",
    icon: ShoppingCart,
  },
  folha: {
    title: "Folha de Pagamento",
    description:
      "Conferências, encargos, provisões e rotinas da folha de pagamento.",
    icon: UsersRound,
  },
  contabil: {
    title: "Contábil",
    description:
      "Lançamentos, análises, integrações e conferências das rotinas contábeis.",
    icon: BookText,
  },
  book: {
    title: "Book Contábil",
    description:
      "Consolidação dos módulos e visão final para realização do fechamento contábil.",
    icon: BookOpenCheck,
  },
} as const;

const areas = {
  financeiro: {
    title: "Módulo Financeiro",
    description:
      "Conciliações bancárias, receitas, empréstimos, parcelamentos e controles financeiros.",
    icon: WalletCards,
  },
  compras: { ...modules.compras, title: "Módulo Compras" },
  folha: { ...modules.folha, title: "Módulo Folha de Pagamento" },
  contabil: { ...modules.contabil, title: "Módulo Contábil" },
  book: { ...modules.book, title: "Módulo Book Contábil" },
} as const;

const months = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const today = new Date();

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab] = useState<Tab>("conciliacao");
  const [accountingTab, setAccountingTab] = useState<AccountingTab>("pis-cofins");
  const [bookReport, setBookReport] = useState<BookReport>("balancete");
  const [selectedArea, setSelectedArea] = useState<Area | null>(null);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [filterStorageReady, setFilterStorageReady] = useState(false);
  const [accounting, setAccounting] = useState<AccountingRow[]>([]);
  const [bank, setBank] = useState<BankRow[]>([]);
  const [bankName, setBankName] = useState("");
  const [bankMetadata, setBankMetadata] = useState<BankMetadata>({
    agency: "",
    account: "",
    period: "",
    name: "",
    openingBalance: null,
    closingBalance: null,
  });
  const [selectedAccount, setSelectedAccount] = useState("");
  const [toleranceDays, setToleranceDays] = useState(3);
  const [toleranceValue, setToleranceValue] = useState(0.01);
  const [results, setResults] = useState<MatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState<PinnedReconciliation[]>([]);
  const [newAccount, setNewAccount] = useState({
    banco: "",
    agencia: "",
    conta_bancaria: "",
    conta_contabil: "",
    descricao: "",
  });
  const competence = `${year}-${String(month).padStart(2, "0")}`;
  const company = companies.find((item) => item.empresa_id === companyId);
  const companyTaxRegime = getCompanyTaxRegime(company?.empresas?.codcoligada);
  const canWrite = (company?.perfil ?? "consulta").toLowerCase() !== "consulta";

  useEffect(() => {
    const savedYear = Number(window.localStorage.getItem("contabilidade-raiz:year"));
    const savedMonth = Number(window.localStorage.getItem("contabilidade-raiz:month"));
    if (savedYear >= 2000 && savedYear <= 2100) setYear(savedYear);
    if (savedMonth >= 1 && savedMonth <= 12) setMonth(savedMonth);
    setFilterStorageReady(true);
  }, []);
  useEffect(() => {
    if (!filterStorageReady) return;
    window.localStorage.setItem("contabilidade-raiz:year", String(year));
    window.localStorage.setItem("contabilidade-raiz:month", String(month));
  }, [filterStorageReady, year, month]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setSession(data.session);
      if (error)
        setNotice(
          "Sua autenticação não pôde ser confirmada. Entre novamente para continuar.",
        );
      setLoading(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, current) => {
        if (!active) return;
        setSession(current);
        setLoading(false);
      },
    );
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data, error } = await supabase
        .from("usuarios_empresas")
        .select(
          "empresa_id, perfil, empresas(id, codcoligada, razao_social, cnpj)",
        )
        .eq("usuario_id", session.user.id);
      if (error) return setNotice(error.message);
      const rows = (data ?? []) as unknown as Company[];
      setCompanies(rows);
      setCompanyId((current) => {
        if (rows.some((row) => row.empresa_id === current)) return current;
        const saved = window.localStorage.getItem("contabilidade-raiz:company-id");
        if (saved && rows.some((row) => row.empresa_id === saved)) return saved;
        return rows[0]?.empresa_id ?? "";
      });
    })();
  }, [session]);
  useEffect(() => {
    if (!companyId) return;
    window.localStorage.setItem("contabilidade-raiz:company-id", companyId);
  }, [companyId]);
  useEffect(() => {
    if (!companyId) return;
    supabase
      .from("contas_bancarias")
      .select("id,banco,agencia,conta_bancaria,conta_contabil,descricao")
      .eq("empresa_id", companyId)
      .eq("ativa", true)
      .then(({ data, error }) => {
        if (error) setNotice(error.message);
        else {
          setAccounts((data ?? []) as Account[]);
          if (data?.[0]) setSelectedAccount(data[0].id);
        }
      });
  }, [companyId]);

  const detectedAccount = useMemo(
    () => detectAccountingAccount(accounting, bankMetadata, bankName, accounts),
    [accounting, bankMetadata, bankName, accounts],
  );
  const filteredAccounting = useMemo(
    () =>
      detectedAccount
        ? accounting.filter((row) => row.account === detectedAccount.code)
        : [],
    [accounting, detectedAccount],
  );
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setNotice("");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error)
      setNotice("Não foi possível entrar. Confira o e-mail e a senha.");
  }
  async function readAccounting(file?: File) {
    if (!file) return;
    try {
      setAccounting(await parseAccounting(await file.arrayBuffer()));
      setNotice("Planilha contábil carregada.");
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  async function readBank(file?: File) {
    if (!file) return;
    try {
      const parsed = parseBank(await file.arrayBuffer());
      setBank(parsed.rows);
      setBankMetadata(parsed.metadata);
      setBankName(file.name);
      setResults([]);
      setNotice(
        "Extrato carregado. A conta será identificada automaticamente.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  function run() {
    if (!bank.length || !accounting.length)
      return setNotice("Envie a planilha contábil e o extrato bancário.");
    if (!detectedAccount || !filteredAccounting.length)
      return setNotice(
        `Não foi possível identificar automaticamente a conta do extrato${bankMetadata.account ? ` (${bankMetadata.account})` : ""} na planilha contábil.`,
      );
    setResults(
      reconcile(bank, filteredAccounting, toleranceDays, toleranceValue),
    );
    setNotice(
      `Conciliação concluída na conta ${detectedAccount.code} — ${detectedAccount.name}.`,
    );
  }
  function pinResult() {
    if (!results.length || !detectedAccount) return;
    setPinned((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        bankName,
        bankAccount: bankMetadata.account,
        accountCode: detectedAccount.code,
        accountName: detectedAccount.name,
        rows: results,
      },
    ]);
    setBank([]);
    setBankName("");
    setBankMetadata({
      agency: "",
      account: "",
      period: "",
      name: "",
      openingBalance: null,
      closingBalance: null,
    });
    setResults([]);
    setNotice("Conciliação fixada. Agora carregue o extrato do próximo banco.");
  }
  async function saveAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    const { error } = await supabase
      .from("contas_bancarias")
      .insert({ ...newAccount, empresa_id: companyId, ativa: true });
    setBusy(false);
    if (error) return setNotice(error.message);
    setNotice("Conta cadastrada.");
    location.reload();
  }
  async function storeStatement(file?: File) {
    if (!file || !selectedAccount || !session) return;
    setBusy(true);
    const path = `${companyId}/${competence}/${selectedAccount}/${crypto.randomUUID()}_${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const uploaded = await supabase.storage
      .from("extratos-bancarios")
      .upload(path, file);
    if (!uploaded.error)
      await supabase
        .from("arquivos_importados")
        .insert({
          empresa_id: companyId,
          competencia: competence,
          conta_bancaria_id: selectedAccount,
          tipo_arquivo: "extrato",
          caminho_storage: path,
          nome_original: file.name,
          usuario_id: session.user.id,
        });
    setBusy(false);
    setNotice(uploaded.error?.message ?? "Extrato armazenado com segurança.");
  }

  if (loading)
    return (
      <main className="center">
        <section className="login-card auth-check">
          <div className="spinner" />
          <h1>Verificando autenticação...</h1>
          <p>Aguarde enquanto confirmamos seu acesso ao Contabilidade Raiz.</p>
        </section>
      </main>
    );
  if (!configured)
    return (
      <main className="center">
        <section className="login-card">
          <h1>Configuração incompleta</h1>
          <p>
            Cadastre NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY na
            Vercel.
          </p>
        </section>
      </main>
    );
  if (!session)
    return (
      <main className="center">
        <form className="login-card" onSubmit={login}>
          <Image
            className="brand-logo"
            src="/logo-raiz.png"
            alt="Raiz Educação"
            width={118}
            height={118}
            priority
          />
          <span className="eyebrow">CONTABILIDADE CORPORATIVA</span>
          <h1>Contabilidade Raiz</h1>
          <p>
            Financeiro, compras, folha de pagamento e fechamento contábil em um
            único ambiente.
          </p>
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {notice && <div className="notice error">{notice}</div>}
          <button className="primary" type="submit">
            Entrar
          </button>
        </form>
      </main>
    );
  if (!companies.length)
    return (
      <main className="center">
        <section className="login-card">
          <h1>Usuário sem empresa vinculada</h1>
          <p>Vincule o usuário a uma empresa no Supabase para continuar.</p>
          <button onClick={() => supabase.auth.signOut()}>Sair</button>
        </section>
      </main>
    );
  if (!selectedArea)
    return (
      <AreaHub
        email={session.user.email ?? ""}
        onSelect={(area) => {
          setSelectedArea(area);
          setSelectedModule(area === "financeiro" ? null : area);
        }}
        onLogout={() => supabase.auth.signOut()}
      />
    );
  if (selectedArea === "financeiro" && !selectedModule)
    return (
      <FinancialHub
        email={session.user.email ?? ""}
        onSelect={setSelectedModule}
        onBack={() => setSelectedArea(null)}
        onLogout={() => supabase.auth.signOut()}
      />
    );
  if (!selectedModule) return null;

  const activeModule = modules[selectedModule];
  const ActiveModuleIcon = activeModule.icon;

  return (
    <div className={`shell ${selectedModule === "book" ? "book-shell" : ""}`}>
      <aside>
        <div className="logo">
          <Image
            className="logo-image"
            src="/logo-raiz.png"
            alt="Raiz Educação"
            width={54}
            height={54}
            priority
          />
          <div>
            <b>CONTABILIDADE</b>
            <span>Raiz Educação</span>
          </div>
        </div>
        <button
          className="module-back"
          onClick={() => {
            if (selectedArea === "financeiro") setSelectedModule(null);
            else {
              setSelectedArea(null);
              setSelectedModule(null);
            }
          }}
        >
          <ChevronLeft />
          {selectedArea === "financeiro"
            ? "Voltar ao Financeiro"
            : "Voltar aos módulos"}
        </button>
        <div className="current-module">
          <ActiveModuleIcon />
          <span>{activeModule.title}</span>
        </div>
        {selectedModule === "bancaria" && (
          <nav>
            {(
              [
                {
                  id: "conciliacao",
                  label: "Conciliação",
                  icon: ArrowLeftRight,
                },
                { id: "contas", label: "Contas", icon: WalletCards },
                { id: "extratos", label: "Extratos", icon: Upload },
                { id: "saldos", label: "Saldos", icon: FileSpreadsheet },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                <Icon />
                {label}
              </button>
            ))}
          </nav>
        )}
        {selectedModule === "contabil" && (
          <nav className="accounting-nav">
            {(
              [
                { id: "pis-cofins", label: "PIS e COFINS", icon: FileSpreadsheet },
                { id: "irpj-csll", label: "IRPJ/CSLL", icon: ReceiptText },
                { id: "rateio-csc", label: "Rateio CSC", icon: ArrowLeftRight },
                { id: "intercompany", label: "Intercompany", icon: Building2 },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={accountingTab === id ? "active" : ""}
                onClick={() => setAccountingTab(id)}
              >
                <Icon />
                {label}
              </button>
            ))}
          </nav>
        )}
        {selectedModule === "book" && (
          <nav className="book-base-nav">
            <span>Relatórios Base</span>
            {(
              [
                { id: "balancete", label: "Balancete", icon: FileSpreadsheet },
                { id: "razao", label: "Razão", icon: BookText },
                { id: "plano-contas", label: "Plano de Contas", icon: ListTree },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={bookReport === id ? "active" : ""}
                onClick={() => setBookReport(id)}
              >
                <Icon />
                {label}
              </button>
            ))}
          </nav>
        )}
        <button className="logout" onClick={() => supabase.auth.signOut()}>
          <LogOut />
          Sair
        </button>
      </aside>
      <main
        className={`content ${selectedModule === "book" ? "book-content" : selectedModule === "receita" ? "revenue-content" : selectedModule === "contabil" ? "tax-content" : ""}`}
      >
        <header>
          <div>
            <span className="eyebrow">CONTABILIDADE RAIZ</span>
            <h1>
              {selectedModule === "contabil"
                ? accountingTab === "pis-cofins"
                  ? "PIS e COFINS"
                  : accountingTab === "irpj-csll"
                    ? "IRPJ/CSLL"
                    : accountingTab === "rateio-csc"
                      ? "Rateio CSC"
                      : "Intercompany"
                : activeModule.title}
            </h1>
            <p>
              {selectedModule === "contabil"
                ? "Apurações, rateios e conferências das rotinas contábeis."
                : activeModule.description}
            </p>
          </div>
          <div className="user-chip">{session.user.email}</div>
        </header>
        <section className="top-context">
          <div className="filter-heading">
            <span className="filter-icon">
              <SlidersHorizontal />
            </span>
            <div>
              <b>
                {selectedModule === "contabil" && accountingTab === "pis-cofins"
                  ? "Filtros"
                  : "Filtros da análise"}
              </b>
              <small>Selecione a empresa e a competência</small>
            </div>
          </div>
          <div className="filter-fields">
            <label className="company-control">
              <span>Empresa</span>
              <div className="company-select-stack">
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                >
                  {companies.map((item) => (
                    <option key={item.empresa_id} value={item.empresa_id}>
                      {item.empresas?.codcoligada} — {item.empresas?.razao_social}
                    </option>
                  ))}
                </select>
                <small>Regime tributário: {companyTaxRegime}</small>
              </div>
            </label>
            <div className="competence-control">
              <label>
                <span>Ano</span>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </label>
              <label>
                <span>Mês</span>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  {months.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {selectedModule === "contabil" && accountingTab === "pis-cofins" && (
            <div
              id="pis-cofins-filter-actions"
              className="filter-actions-slot"
            />
          )}
        </section>
        {notice && <div className="notice">{notice}</div>}
        {selectedModule === "bancaria" && tab === "conciliacao" && (
          <MonthlyReconciliationPanel
            accounts={accounts}
            competence={competence}
            companyId={companyId}
            companyCode={company?.empresas?.codcoligada ?? ""}
            companyName={`${company?.empresas?.codcoligada ?? ""} — ${company?.empresas?.razao_social ?? ""}`}
            reconciledBy={session.user.email ?? ""}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "bancaria" && tab === "contas" && (
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>Contas bancárias</h2>
                <p>Cadastre o vínculo entre banco e conta contábil.</p>
              </div>
            </div>
            <div className="cards-list">
              {accounts.map((item) => (
                <article key={item.id}>
                  <Landmark />
                  <div>
                    <b>
                      {item.banco} · {item.conta_bancaria}
                    </b>
                    <span>
                      Ag. {item.agencia} · Contábil {item.conta_contabil}
                    </span>
                  </div>
                </article>
              ))}
            </div>
            <form className="form-grid account-form" onSubmit={saveAccount}>
              {Object.keys(newAccount).map((key) => (
                <label key={key}>
                  {key.replaceAll("_", " ")}
                  <input
                    value={newAccount[key as keyof typeof newAccount]}
                    onChange={(e) =>
                      setNewAccount({ ...newAccount, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <button className="primary" disabled={!canWrite || busy}>
                <Plus />
                Cadastrar conta
              </button>
            </form>
          </section>
        )}
        {selectedModule === "bancaria" && tab === "extratos" && (
          <section className="panel">
            <h2>Armazenar extratos</h2>
            <p>
              Os arquivos ficam no bucket privado do Supabase, organizados por
              empresa e competência.
            </p>
            <div className="upload-box">
              <Upload />
              <label>
                Selecionar extrato
                <input
                  type="file"
                  accept=".xlsx,.xlsm"
                  disabled={!canWrite || !selectedAccount || busy}
                  onChange={(e) => storeStatement(e.target.files?.[0])}
                />
              </label>
            </div>
          </section>
        )}
        {selectedModule === "bancaria" && tab === "saldos" && (
          <BalancePanel
            companyId={companyId}
            competence={competence}
            accounts={accounts}
            canWrite={canWrite}
            userId={session.user.id}
            onNotice={setNotice}
          />
        )}
        {selectedModule === "book" && (
          <BookAccountingPanel
            report={bookReport}
            companyCode={company?.empresas?.codcoligada ?? ""}
            companyName={`${company?.empresas?.codcoligada ?? ""} — ${company?.empresas?.razao_social ?? ""}`}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "receita" && (
          <RevenueReconciliation
            companyCode={company?.empresas?.codcoligada ?? ""}
            companyName={`${company?.empresas?.codcoligada ?? ""} — ${company?.empresas?.razao_social ?? ""}`}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "contabil" && accountingTab === "pis-cofins" && (
          <PisCofinsAssessment
            companyCode={company?.empresas?.codcoligada ?? ""}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "contabil" && accountingTab !== "pis-cofins" && (
          <section className="panel module-workspace accounting-workspace">
            {accountingTab === "irpj-csll" ? (
              <ReceiptText />
            ) : accountingTab === "rateio-csc" ? (
              <ArrowLeftRight />
            ) : (
              <Building2 />
            )}
            <span className="eyebrow">MÓDULO CONTÁBIL</span>
            <h2>
              {accountingTab === "irpj-csll"
                ? "IRPJ/CSLL"
                : accountingTab === "rateio-csc"
                  ? "Rateio CSC"
                  : "Intercompany"}
            </h2>
            <p>
              Área preparada para receber as regras, bases e conferências desta rotina.
            </p>
          </section>
        )}
        {selectedModule !== "bancaria" &&
          selectedModule !== "book" &&
          selectedModule !== "receita" &&
          selectedModule !== "contabil" && (
            <section className="panel module-workspace">
              <ActiveModuleIcon />
              <span className="eyebrow">MÓDULO SELECIONADO</span>
              <h2>{activeModule.title}</h2>
              <p>
                A empresa{" "}
                <b>
                  {company?.empresas?.codcoligada} —{" "}
                  {company?.empresas?.razao_social}
                </b>{" "}
                já está selecionada. Este espaço está preparado para receber as
                regras, contratos e relatórios deste módulo.
              </p>
              <div className="coming-next">
                <Building2 />
                <div>
                  <b>Estrutura pronta para evolução</b>
                  <span>
                    Empresa, competência e permissões já compartilham a mesma
                    base da conciliação bancária.
                  </span>
                </div>
              </div>
            </section>
          )}
      </main>
    </div>
  );
}

function ResultBlock({ rows }: { rows: MatchRow[] }) {
  const totals = rows.reduce<Record<string, number>>(
    (acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }),
    {},
  );
  const totalDifference = rows.reduce(
    (sum, row) =>
      sum +
      (row.status === "Somente no banco"
        ? Math.abs(row.bankValue ?? 0)
        : row.status === "Somente na contabilidade"
          ? Math.abs(row.accountingValue ?? 0)
          : 0),
    0,
  );
  return (
    <>
      <div className="result-metrics">
        <article>
          <b>{totals["Conciliado"] ?? 0}</b>
          <span>Conciliados</span>
        </article>
        <article>
          <b>{totals["Possível conciliação"] ?? 0}</b>
          <span>Possíveis</span>
        </article>
        <article>
          <b>{totals["Somente no banco"] ?? 0}</b>
          <span>Somente no banco</span>
        </article>
        <article>
          <b>{totals["Somente na contabilidade"] ?? 0}</b>
          <span>Somente na contabilidade</span>
        </article>
        <article>
          <b>{brl(totalDifference)}</b>
          <span>Diferença de conciliação</span>
        </article>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Data banco</th>
              <th>Histórico</th>
              <th>Valor banco</th>
              <th>Data contábil</th>
              <th>Valor contábil</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>
                  <span className={`status s${row.status.charAt(0)}`}>
                    {row.status}
                  </span>
                </td>
                <td>
                  {row.bankDate?.toLocaleDateString("pt-BR", {
                    timeZone: "UTC",
                  })}
                </td>
                <td>{row.description}</td>
                <td>{row.bankValue == null ? "" : brl(row.bankValue)}</td>
                <td>
                  {row.accountingDate?.toLocaleDateString("pt-BR", {
                    timeZone: "UTC",
                  })}
                </td>
                <td>
                  {row.accountingValue == null ? "" : brl(row.accountingValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AreaHub({
  email,
  onSelect,
  onLogout,
}: {
  email: string;
  onSelect: (area: Area) => void;
  onLogout: () => void;
}) {
  return (
    <main className="module-hub">
      <header>
        <div className="hub-brand">
          <Image
            src="/logo-raiz.png"
            alt="Raiz Educação"
            width={78}
            height={78}
            priority
          />
          <div>
            <span className="eyebrow">CONTABILIDADE CORPORATIVA</span>
            <h1>Contabilidade Raiz</h1>
            <p>Escolha o módulo em que deseja trabalhar.</p>
          </div>
        </div>
        <div className="hub-user">
          <span>{email}</span>
          <button onClick={onLogout}>
            <LogOut />
            Sair
          </button>
        </div>
      </header>
      <section className="module-grid">
        {(Object.entries(areas) as [Area, (typeof areas)[Area]][]).map(
          ([id, item]) => {
            const Icon = item.icon;
            return (
              <button
                key={id}
                className={`module-card area-${id}`}
                onClick={() => onSelect(id)}
              >
                <span className="module-icon">
                  <Icon />
                </span>
                <span className="module-copy">
                  <b>{item.title}</b>
                  <small>{item.description}</small>
                </span>
                <span className="module-enter">
                  Acessar módulo <ArrowLeftRight />
                </span>
              </button>
            );
          },
        )}
      </section>
    </main>
  );
}

function FinancialHub({
  email,
  onSelect,
  onBack,
  onLogout,
}: {
  email: string;
  onSelect: (module: Module) => void;
  onBack: () => void;
  onLogout: () => void;
}) {
  const financialIds: Module[] = [
    "bancaria",
    "receita",
    "emprestimos",
    "parcelamentos",
  ];
  return (
    <main className="module-hub">
      <header>
        <div className="hub-brand">
          <Image
            src="/logo-raiz.png"
            alt="Raiz Educação"
            width={78}
            height={78}
            priority
          />
          <div>
            <button className="hub-back" onClick={onBack}>
              <ChevronLeft />
              Contabilidade Raiz
            </button>
            <span className="eyebrow">MÓDULO FINANCEIRO</span>
            <h1>Como deseja trabalhar?</h1>
            <p>As soluções financeiras atuais estão reunidas neste módulo.</p>
          </div>
        </div>
        <div className="hub-user">
          <span>{email}</span>
          <button onClick={onLogout}>
            <LogOut />
            Sair
          </button>
        </div>
      </header>
      <section className="module-grid">
        {financialIds.map((id) => {
          const item = modules[id];
          const Icon = item.icon;
          return (
            <button
              key={id}
              className={`module-card module-${id}`}
              onClick={() => onSelect(id)}
            >
              <span className="module-icon">
                <Icon />
              </span>
              <span className="module-copy">
                <b>{item.title}</b>
                <small>{item.description}</small>
              </span>
              <span className="module-enter">
                Acessar <ArrowLeftRight />
              </span>
            </button>
          );
        })}
      </section>
    </main>
  );
}

function previousCompetence(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function BalancePanel({
  companyId,
  competence,
  accounts,
  canWrite,
  userId,
  onNotice,
}: {
  companyId: string;
  competence: string;
  accounts: Account[];
  canWrite: boolean;
  userId: string;
  onNotice: (value: string) => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [initial, setInitial] = useState(0);
  const [final, setFinal] = useState(0);
  const [carry, setCarry] = useState(false);
  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accounts, accountId]);
  useEffect(() => {
    if (!accountId) return;
    (async () => {
      const current = await supabase
        .from("saldos_bancarios")
        .select("saldo_inicial,saldo_final,fixar_mes_seguinte")
        .eq("conta_bancaria_id", accountId)
        .eq("competencia", competence)
        .maybeSingle();
      if (current.error) return onNotice(current.error.message);
      if (current.data) {
        setInitial(Number(current.data.saldo_inicial));
        setFinal(Number(current.data.saldo_final));
        setCarry(Boolean(current.data.fixar_mes_seguinte));
        return;
      }
      const previous = await supabase
        .from("saldos_bancarios")
        .select("saldo_final,fixar_mes_seguinte")
        .eq("conta_bancaria_id", accountId)
        .eq("competencia", previousCompetence(competence))
        .maybeSingle();
      setInitial(
        previous.data?.fixar_mes_seguinte
          ? Number(previous.data.saldo_final)
          : 0,
      );
      setFinal(0);
      setCarry(false);
    })();
  }, [accountId, competence, onNotice]);
  async function save() {
    const { error } = await supabase
      .from("saldos_bancarios")
      .upsert(
        {
          conta_bancaria_id: accountId,
          competencia: competence,
          saldo_inicial: initial,
          saldo_final: final,
          fixar_mes_seguinte: carry,
          usuario_id: userId,
        },
        { onConflict: "conta_bancaria_id,competencia" },
      );
    onNotice(error?.message ?? "Saldos atualizados.");
  }
  return (
    <section className="panel">
      <h2>Saldos bancários</h2>
      <div className="form-grid">
        <label>
          Conta
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.banco} · {item.conta_bancaria}
              </option>
            ))}
          </select>
        </label>
        <label>
          Saldo inicial
          <input
            type="number"
            step="0.01"
            value={initial}
            onChange={(e) => setInitial(Number(e.target.value))}
          />
        </label>
        <label>
          Saldo final
          <input
            type="number"
            step="0.01"
            value={final}
            onChange={(e) => setFinal(Number(e.target.value))}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={carry}
            onChange={(e) => setCarry(e.target.checked)}
          />
          Fixar para o mês seguinte
        </label>
      </div>
      <button
        className="primary"
        disabled={!canWrite || !companyId || !accountId}
        onClick={save}
      >
        <Save />
        Salvar saldos
      </button>
    </section>
  );
}
