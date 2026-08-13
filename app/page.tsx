"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowLeftRight,
  BarChart3,
  BookOpenCheck,
  BookText,
  Building2,
  CalendarDays,
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
import TrialBalanceAnalysis from "@/app/trial-balance-analysis";
import CscAllocation from "@/app/csc-allocation";
import IntercompanyAnalysis from "@/app/intercompany-analysis";
import PayrollBatchReconciliation from "@/app/payroll-batch-reconciliation";
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
type AccountingTab = "pis-cofins" | "analise-balancete" | "irpj-csll" | "rateio-csc" | "intercompany";
type BookReport = "balancete" | "razao" | "plano-contas";
type ScheduleView = "acompanhamento" | "historico";
type Area = "financeiro" | "compras" | "folha" | "contabil" | "book" | "cronograma";
type Module =
  | "bancaria"
  | "emprestimos"
  | "parcelamentos"
  | "receita"
  | "compras"
  | "folha"
  | "contabil"
  | "book"
  | "cronograma";
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
  cronograma: {
    title: "Cronograma Fechamento",
    description:
      "Organização das etapas, responsáveis, prazos e andamento do fechamento contábil.",
    icon: CalendarDays,
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
  cronograma: { ...modules.cronograma, title: "Cronograma Fechamento" },
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
const defaultClosingDate = new Date(today.getFullYear(), today.getMonth() + 1, 10);
const defaultClosingDateValue = `${defaultClosingDate.getFullYear()}-${String(defaultClosingDate.getMonth() + 1).padStart(2, "0")}-${String(defaultClosingDate.getDate()).padStart(2, "0")}`;

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companyId, setCompanyId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab] = useState<Tab>("conciliacao");
  const [accountingTab, setAccountingTab] = useState<AccountingTab>("pis-cofins");
  const [bookReport, setBookReport] = useState<BookReport>("balancete");
  const [scheduleView, setScheduleView] = useState<ScheduleView>("acompanhamento");
  const [selectedArea, setSelectedArea] = useState<Area | null>(null);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [closingDate, setClosingDate] = useState(defaultClosingDateValue);
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
  const userProfiles = [...new Set(companies.map((item) => item.perfil.trim().toLowerCase()))];
  const isAdministrator = userProfiles.includes("administrador");
  const allowedAreas: Area[] = isAdministrator
    ? ["financeiro", "compras", "folha", "contabil", "book", "cronograma"]
    : [
        "cronograma",
        ...(userProfiles.includes("financeiro") ? ["financeiro" as Area] : []),
        ...(userProfiles.includes("compras") ? ["compras" as Area] : []),
        ...(userProfiles.some((profile) => profile === "folha" || profile === "folha de pagamento") ? ["folha" as Area] : []),
        ...(userProfiles.some((profile) => profile === "contabil" || profile === "contabilidade" || profile === "contábil") ? ["contabil" as Area, "book" as Area] : []),
      ];

  useEffect(() => {
    const savedYear = Number(window.localStorage.getItem("contabilidade-raiz:year"));
    const savedMonth = Number(window.localStorage.getItem("contabilidade-raiz:month"));
    const savedClosingDate = window.localStorage.getItem("contabilidade-raiz:closing-date");
    if (savedYear >= 2000 && savedYear <= 2100) setYear(savedYear);
    if (savedMonth >= 1 && savedMonth <= 12) setMonth(savedMonth);
    if (savedClosingDate && /^\d{4}-\d{2}-\d{2}$/.test(savedClosingDate)) setClosingDate(savedClosingDate);
    setFilterStorageReady(true);
  }, []);
  useEffect(() => {
    if (!filterStorageReady) return;
    window.localStorage.setItem("contabilidade-raiz:year", String(year));
    window.localStorage.setItem("contabilidade-raiz:month", String(month));
  }, [filterStorageReady, year, month]);
  useEffect(() => {
    if (!filterStorageReady) return;
    window.localStorage.setItem("contabilidade-raiz:closing-date", closingDate);
  }, [filterStorageReady, closingDate]);

  useEffect(() => {
    if (!session || !filterStorageReady) return;
    let active = true;
    void supabase
      .from("cronograma_configuracoes")
      .select("data_fechamento")
      .eq("competencia", competence)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setClosingDate(data?.data_fechamento || formatDateInput(addBusinessDays(lastBusinessDay(year, month), 10)));
      });
    return () => { active = false; };
  }, [session, filterStorageReady, competence, year, month]);

  async function updateClosingDate(value: string) {
    setClosingDate(value);
    if (!session || !value) return;
    const { error } = await supabase.from("cronograma_configuracoes").upsert({
      competencia: competence,
      data_fechamento: value,
      atualizado_por: session.user.id,
      atualizado_email: session.user.email ?? "",
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "competencia" });
    if (error) setNotice("A data foi alterada nesta tela, mas não pôde ser compartilhada com os demais setores.");
  }

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
    if (!session) {
      setCompanies([]);
      setCompanyId("");
      setCompaniesLoading(true);
      return;
    }
    let active = true;
    setCompaniesLoading(true);
    setCompanies([]);
    setCompanyId("");
    (async () => {
      const { data, error } = await supabase
        .from("usuarios_empresas")
        .select(
          "empresa_id, perfil, empresas(id, codcoligada, razao_social, cnpj)",
        )
        .eq("usuario_id", session.user.id);
      if (!active) return;
      if (error) {
        setNotice("Não foi possível carregar as empresas vinculadas. Atualize a página para tentar novamente.");
        setCompaniesLoading(false);
        return;
      }
      const rows = (data ?? []) as unknown as Company[];
      setCompanies(rows);
      setCompanyId((current) => {
        if (rows.some((row) => row.empresa_id === current)) return current;
        const saved = window.localStorage.getItem("contabilidade-raiz:company-id");
        if (saved && rows.some((row) => row.empresa_id === saved)) return saved;
        return rows[0]?.empresa_id ?? "";
      });
      setCompaniesLoading(false);
    })();
    return () => { active = false; };
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
  if (companiesLoading)
    return (
      <main className="center">
        <section className="login-card auth-check">
          <div className="spinner" />
          <h1>Carregando empresas...</h1>
          <p>Aguarde enquanto confirmamos os vínculos do seu usuário.</p>
        </section>
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
        closingDate={closingDate}
        onClosingDateChange={(date) => void updateClosingDate(date)}
        allowedAreas={allowedAreas}
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
    <div className={`shell ${selectedModule === "book" ? "book-shell" : ""} ${selectedModule === "bancaria" ? "bank-shell" : ""}`}>
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
                { id: "analise-balancete", label: "Análise Balancete", icon: BarChart3 },
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
        {selectedModule === "cronograma" && (
          <nav>
            <button className={scheduleView === "acompanhamento" ? "active" : ""} onClick={() => setScheduleView("acompanhamento")}>
              <CalendarDays /> Acompanhamento
            </button>
            <button className={scheduleView === "historico" ? "active" : ""} onClick={() => setScheduleView("historico")}>
              <ListTree /> Histórico de entregas
            </button>
          </nav>
        )}
        <button className="logout" onClick={() => supabase.auth.signOut()}>
          <LogOut />
          Sair
        </button>
      </aside>
      <main
        className={`content ${selectedModule === "book" ? "book-content" : selectedModule === "receita" ? "revenue-content" : selectedModule === "contabil" ? `tax-content ${accountingTab === "analise-balancete" ? "trial-content" : ""}` : selectedModule === "cronograma" ? "schedule-content" : selectedModule === "bancaria" ? "bank-content" : ""}`}
      >
        <header>
          <div>
            <span className="eyebrow">CONTABILIDADE RAIZ</span>
            <h1>
              {selectedModule === "contabil"
                ? accountingTab === "pis-cofins"
                  ? "PIS e COFINS"
                  : accountingTab === "analise-balancete"
                    ? "Análise de Balancete"
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
        <section className={`top-context ${selectedModule === "cronograma" ? "schedule-filters" : ""}`}>
          <div className="filter-heading">
            <span className="filter-icon">
              <SlidersHorizontal />
            </span>
            <div>
              <b>
                {selectedModule === "cronograma" || (selectedModule === "contabil" && accountingTab === "rateio-csc")
                  ? "Período"
                  : selectedModule === "contabil" && (accountingTab === "pis-cofins" || accountingTab === "intercompany")
                  ? "Filtros"
                  : "Filtros da análise"}
              </b>
              <small>{selectedModule === "cronograma" || (selectedModule === "contabil" && accountingTab === "rateio-csc") ? "Selecione o ano e o mês" : selectedModule === "folha" ? "Selecione a coligada e a competência da folha" : "Selecione a empresa e a competência"}</small>
            </div>
          </div>
          <div className="filter-fields">
            {selectedModule !== "cronograma" && !(selectedModule === "contabil" && accountingTab === "rateio-csc") && <label className="company-control">
              <span>{selectedModule === "folha" ? "Qual a coligada analisar?" : "Empresa"}</span>
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
            </label>}
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
            companyName={`${company?.empresas?.codcoligada ?? ""} — ${company?.empresas?.razao_social ?? ""}`}
            taxRegime={getCompanyTaxRegime(company?.empresas?.codcoligada ?? "")}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "folha" && (
          <PayrollBatchReconciliation
            companyCode={company?.empresas?.codcoligada ?? ""}
            companyName={`${company?.empresas?.codcoligada ?? ""} — ${company?.empresas?.razao_social ?? ""}`}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "contabil" && accountingTab === "analise-balancete" && (
          <TrialBalanceAnalysis
            companyCode={company?.empresas?.codcoligada ?? ""}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "contabil" && accountingTab === "intercompany" && (
          <IntercompanyAnalysis
            key={`${company?.empresas?.codcoligada ?? ""}-${competence}`}
            companies={companies.flatMap((item) => item.empresas ? [{ code: item.empresas.codcoligada, name: item.empresas.razao_social }] : [])}
            selectedCompanyCode={company?.empresas?.codcoligada ?? ""}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "contabil" && accountingTab === "rateio-csc" && (
          <CscAllocation key={competence} companies={companies.flatMap((item) => item.empresas ? [{ code: item.empresas.codcoligada, name: item.empresas.razao_social }] : [])} competence={competence} accessToken={session.access_token} />
        )}
        {selectedModule === "contabil" && accountingTab !== "pis-cofins" && accountingTab !== "analise-balancete" && accountingTab !== "intercompany" && accountingTab !== "rateio-csc" && (
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
        {selectedModule === "cronograma" && scheduleView === "acompanhamento" && (
          <ClosingSchedule
            year={year}
            month={month}
            closingDate={closingDate}
            userId={session.user.id}
            userEmail={session.user.email ?? ""}
            userProfiles={userProfiles}
          />
        )}
        {selectedModule === "cronograma" && scheduleView === "historico" && (
          <ClosingHistory />
        )}
        {selectedModule !== "bancaria" &&
          selectedModule !== "book" &&
          selectedModule !== "receita" &&
          selectedModule !== "folha" &&
          selectedModule !== "contabil" &&
          selectedModule !== "cronograma" && (
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
  closingDate,
  onClosingDateChange,
  allowedAreas,
  onSelect,
  onLogout,
}: {
  email: string;
  closingDate: string;
  onClosingDateChange: (date: string) => void;
  allowedAreas: Area[];
  onSelect: (area: Area) => void;
  onLogout: () => void;
}) {
  const executionAreas: Area[] = ["compras", "financeiro", "folha", "contabil"].filter((area) => allowedAreas.includes(area as Area)) as Area[];
  const [completedAreas, setCompletedAreas] = useState<string[]>([]);
  const ScheduleIcon = areas.cronograma.icon;
  const BookIcon = areas.book.icon;
  const closingMonth = closingDate.slice(5, 7);
  const closingYear = closingDate.slice(0, 4);
  const scheduleCompetence = `${closingYear}-${closingMonth}`;
  const closingYears = Array.from({ length: 5 }, (_, index) => today.getFullYear() - 1 + index);

  useEffect(() => {
    let active = true;
    const loadCompletedAreas = async () => {
      const { data } = await supabase
        .from("cronograma_entregas")
        .select("modulo")
        .eq("competencia", scheduleCompetence)
        .eq("status", "concluido");
      if (active) setCompletedAreas((data ?? []).map((row) => row.modulo));
    };
    void loadCompletedAreas();
    const channel = supabase
      .channel(`cronograma-principal-${scheduleCompetence}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cronograma_entregas", filter: `competencia=eq.${scheduleCompetence}` }, () => void loadCompletedAreas())
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [scheduleCompetence]);
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
            <p>Acompanhe o cronograma, execute as etapas e conclua o fechamento no Book Contábil.</p>
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
      <section className="closing-workflow" aria-label="Fluxo do fechamento contábil">
        <div className="workflow-start">
          <span className="workflow-icon"><ScheduleIcon /></span>
          <span className="workflow-copy">
            <small>INÍCIO DO PROCESSO</small>
            <b>Cronograma de Fechamento</b>
            <span>Comece por aqui: acompanhe prazos, responsáveis e o andamento de todas as etapas.</span>
          </span>
          <div className="workflow-date">
            <span>Mês/Ano do fechamento</span>
            <div className="workflow-date-fields">
              <select
                aria-label="Ano do fechamento"
                value={closingYear}
                onChange={(event) => onClosingDateChange(`${event.target.value}-${closingMonth}-10`)}
              >
                {closingYears.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select
                aria-label="Mês do fechamento"
                value={closingMonth}
                onChange={(event) => onClosingDateChange(`${closingYear}-${event.target.value}-10`)}
              >
                {months.map((name, index) => (
                  <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>
                ))}
              </select>
            </div>
          </div>
          <button className="workflow-action" onClick={() => onSelect("cronograma")}>Abrir cronograma <ArrowLeftRight /></button>
        </div>

        <div className="workflow-divider"><span>ETAPAS DE EXECUÇÃO</span></div>
        <div className="workflow-modules">
          {executionAreas.map((id) => {
            const item = areas[id];
            const Icon = item.icon;
            return (
              <button
                key={id}
                className={`module-card area-${id} ${completedAreas.includes(id) ? "workflow-module-done" : ""}`}
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
          })}
        </div>

        {allowedAreas.includes("book") && <><div className="workflow-path" aria-hidden="true"><span>Conclusão do fechamento</span><ArrowLeftRight /></div>
        <button className="workflow-final" onClick={() => onSelect("book")}>
          <span className="workflow-icon"><BookIcon /></span>
          <span className="workflow-copy">
            <small>PRODUTO FINAL</small>
            <b>Book Contábil</b>
            <span>Consolida os resultados dos módulos e entrega a visão final do fechamento contábil.</span>
          </span>
          <span className="workflow-action">Acessar Book <ArrowLeftRight /></span>
        </button></>}
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

type ScheduleConfirmation = {
  modulo: string;
  setor: string;
  status: "pendente" | "concluido";
  confirmado_email: string;
  confirmado_em: string;
};

type ScheduleHistoryRow = {
  id: string;
  competencia: string;
  modulo: string;
  setor: string;
  acao: "liberado" | "reaberto";
  usuario_email: string;
  criado_em: string;
};

function ClosingSchedule({ year, month, closingDate, userId, userEmail, userProfiles }: { year: number; month: number; closingDate: string; userId: string; userEmail: string; userProfiles: string[] }) {
  const scheduleCompetence = `${year}-${String(month).padStart(2, "0")}`;
  const [confirmations, setConfirmations] = useState<ScheduleConfirmation[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [confirmingModule, setConfirmingModule] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const monthEnd = lastBusinessDay(year, month);
  const stages = [
    { key: "compras", name: "Módulo Compras", sector: "Compras", detail: "Finalizar o input de notas", deadline: monthEnd, milestone: "Último dia útil", icon: ShoppingCart },
    { key: "financeiro", name: "Módulo Financeiro", sector: "Financeiro", detail: "Concluir conciliações e pendências financeiras", deadline: addBusinessDays(monthEnd, 3), milestone: "D+3", icon: WalletCards },
    { key: "folha", name: "Módulo Folha de Pagamento", sector: "Folha de Pagamento", detail: "Conferir folha, provisões e encargos", deadline: addBusinessDays(monthEnd, 5), milestone: "D+5", icon: UsersRound },
    { key: "contabil", name: "Módulo Contábil", sector: "Contabilidade", detail: "Consolidar análises e concluir o fechamento", deadline: closingDate ? new Date(`${closingDate}T12:00:00`) : addBusinessDays(monthEnd, 10), milestone: "Data definida", icon: BookText },
    { key: "book", name: "Book Contábil", sector: "Contabilidade", detail: "Disponibilizar o produto final do fechamento", deadline: closingDate ? new Date(`${closingDate}T12:00:00`) : addBusinessDays(monthEnd, 10), milestone: "Entrega final", icon: BookOpenCheck },
  ];
  const start = new Date(year, month, 1);
  const finalDeadline = stages.at(-1)!.deadline;
  const elapsed = today.getTime() - start.getTime();
  const duration = Math.max(1, finalDeadline.getTime() - start.getTime());
  const overallProgress = Math.max(0, Math.min(100, Math.round((elapsed / duration) * 100)));
  const formatDate = (date: Date) => date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  useEffect(() => {
    let active = true;
    setScheduleLoading(true);
    setScheduleError("");
    void supabase
      .from("cronograma_entregas")
      .select("modulo, setor, status, confirmado_email, confirmado_em")
      .eq("competencia", scheduleCompetence)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setScheduleError("Não foi possível carregar as confirmações compartilhadas.");
        else setConfirmations((data ?? []) as ScheduleConfirmation[]);
        setScheduleLoading(false);
      });
    return () => { active = false; };
  }, [scheduleCompetence]);

  async function toggleStage(stage: (typeof stages)[number], checked: boolean) {
    setConfirmingModule(stage.key);
    setScheduleError("");
    const confirmedAt = new Date().toISOString();
    const { error } = await supabase.from("cronograma_entregas").upsert({
      competencia: scheduleCompetence,
      modulo: stage.key,
      setor: stage.sector,
      status: checked ? "concluido" : "pendente",
      confirmado_por: userId,
      confirmado_email: userEmail,
      confirmado_em: confirmedAt,
    }, { onConflict: "competencia,modulo" });
    if (error) {
      setScheduleError("O OK não pôde ser registrado. Tente novamente.");
    } else {
      const { error: historyError } = await supabase.from("cronograma_historico").insert({
        competencia: scheduleCompetence,
        modulo: stage.key,
        setor: stage.sector,
        acao: checked ? "liberado" : "reaberto",
        usuario_id: userId,
        usuario_email: userEmail,
      });
      if (historyError) setScheduleError("O OK foi atualizado, mas o histórico não pôde ser registrado.");
      setConfirmations((current) => [
        ...current.filter((item) => item.modulo !== stage.key),
        { modulo: stage.key, setor: stage.sector, status: checked ? "concluido" : "pendente", confirmado_email: userEmail, confirmado_em: confirmedAt },
      ]);
    }
    setConfirmingModule("");
  }

  return (
    <section className="closing-schedule">
      <div className="schedule-overview">
        <div>
          <span>PROJEÇÃO DO FECHAMENTO</span>
          <b>{months[month - 1]} de {year}</b>
          <small>Visão geral do processo, sem separação por empresa.</small>
        </div>
        <div className="schedule-window">
          <span>Janela projetada</span>
          <b>{formatDate(start)} a {formatDate(finalDeadline)}</b>
          <small>Compras até o último dia útil · Contabilidade até D+10</small>
        </div>
      </div>

      <div className="schedule-master-line">
        <span style={{ width: `${overallProgress}%` }} />
      </div>

      {scheduleError && <div className="schedule-error">{scheduleError}</div>}

      <div className="schedule-stages">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const stageDuration = Math.max(1, stage.deadline.getTime() - start.getTime());
          const progress = Math.max(0, Math.min(100, Math.round((elapsed / stageDuration) * 100)));
          const confirmation = confirmations.find((item) => item.modulo === stage.key && item.status === "concluido");
          const canConfirm = userProfiles.includes("administrador") || (
            stage.sector === "Financeiro" ? userProfiles.includes("financeiro") :
            stage.sector === "Compras" ? userProfiles.includes("compras") :
            stage.sector === "Folha de Pagamento" ? userProfiles.some((profile) => profile === "folha" || profile === "folha de pagamento") :
            userProfiles.some((profile) => profile === "contabil" || profile === "contabilidade" || profile === "contábil")
          );
          return (
            <article key={stage.name} className={`${index === stages.length - 1 ? "schedule-final-stage" : ""} ${confirmation ? "schedule-stage-done" : ""}`}>
              <span className="schedule-stage-icon"><Icon /></span>
              <div className="schedule-stage-copy">
                <div><b>{stage.name}</b><span>Responsável: {stage.sector} · {stage.detail}</span></div>
                <div className="schedule-progress"><span style={{ width: `${progress}%` }} /></div>
                <small>{confirmation
                  ? `OK por ${confirmation.confirmado_email} em ${new Date(confirmation.confirmado_em).toLocaleString("pt-BR")}`
                  : `Prazo decorrido: ${progress}%`}</small>
              </div>
              <div className="schedule-deadline"><span>{stage.milestone}</span><b>{formatDate(stage.deadline)}</b></div>
              <label
                className={`schedule-ok ${!canConfirm ? "is-disabled" : ""}`}
                title={canConfirm ? "Marcar ou desmarcar a entrega deste módulo" : `Liberação exclusiva do setor ${stage.sector}`}
              >
                <input
                  type="checkbox"
                  checked={Boolean(confirmation)}
                  disabled={!canConfirm || scheduleLoading || confirmingModule === stage.key}
                  onChange={(event) => void toggleStage(stage, event.target.checked)}
                />
                <span>{confirmingModule === stage.key ? "Salvando..." : "OK"}</span>
              </label>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ClosingHistory() {
  const [rows, setRows] = useState<ScheduleHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void supabase
      .from("cronograma_historico")
      .select("id, competencia, modulo, setor, acao, usuario_email, criado_em")
      .order("criado_em", { ascending: false })
      .limit(300)
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) setError("Não foi possível carregar o histórico de entregas.");
        else setRows((data ?? []) as ScheduleHistoryRow[]);
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const moduleNames: Record<string, string> = {
    compras: "Módulo Compras",
    financeiro: "Módulo Financeiro",
    folha: "Módulo Folha de Pagamento",
    contabil: "Módulo Contábil",
    book: "Book Contábil",
  };

  return (
    <section className="closing-history">
      <header>
        <div><span>CRONOGRAMA DE FECHAMENTO</span><h2>Histórico de entregas</h2></div>
        <small>{rows.length} movimentação(ões)</small>
      </header>
      {loading ? <p className="history-message">Carregando histórico...</p> : error ? <p className="schedule-error">{error}</p> : rows.length === 0 ? (
        <p className="history-message">Nenhuma entrega foi registrada ainda.</p>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead><tr><th>Competência</th><th>Módulo</th><th>Setor</th><th>Ação</th><th>Responsável</th><th>Data e hora</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <td>{row.competencia.slice(5, 7)}/{row.competencia.slice(0, 4)}</td>
                <td><b>{moduleNames[row.modulo] ?? row.modulo}</b></td>
                <td>{row.setor}</td>
                <td><span className={`history-action ${row.acao}`}>{row.acao === "liberado" ? "Liberou" : "Reabriu"}</span></td>
                <td>{row.usuario_email}</td>
                <td>{new Date(row.criado_em).toLocaleString("pt-BR")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function lastBusinessDay(year: number, month: number) {
  const date = new Date(year, month, 0);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() - 1);
  return date;
}

function addBusinessDays(date: Date, amount: number) {
  const result = new Date(date);
  let added = 0;
  while (added < amount) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) added += 1;
  }
  return result;
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
