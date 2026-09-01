"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  ArrowLeftRight,
  BarChart3,
  BookOpenCheck,
  BookText,
  Building2,
  CalendarDays,
  ChevronLeft,
  ExternalLink,
  FileSpreadsheet,
  HandCoins,
  Landmark,
  ListChecks,
  ListTree,
  LogOut,
  PackageOpen,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  TrendingUp,
  Upload,
  UsersRound,
  WalletCards,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "@/lib/supabase";
import { isAllowedCorporateEmail } from "@/lib/auth-domain";
import MonthlyReconciliationPanel from "@/app/monthly-reconciliation";
import BookAccountingPanel from "@/app/book-accounting";
import RevenueReconciliation from "@/app/revenue-reconciliation";
import RevenueByBranch from "@/app/revenue-by-branch";
import PisCofinsAssessment from "@/app/pis-cofins-assessment";
import TrialBalanceAnalysis from "@/app/trial-balance-analysis";
import LoanReconciliation from "@/app/loan-reconciliation";
import CscAllocation from "@/app/csc-allocation";
import IntercompanyAnalysis from "@/app/intercompany-analysis";
import PayrollBatchReconciliation from "@/app/payroll-batch-reconciliation";
import PendingAccountingLots from "@/app/pending-accounting-lots";
import ExpenseAnalysis from "@/app/expense-analysis";
import WarehousePostings from "@/app/warehouse-postings";
import { getCompanyTaxRegime } from "@/lib/tax-regimes";
import ModuleCompletionControl from "@/app/module-completion-control";
import AccessManagement from "@/app/access-management";
import { resolveAllowedModules, type AccessModule } from "@/lib/access-control";
import {
  accountingCompletionIdentity,
  bookCompletionIdentity,
  financialCompletionIdentity,
  fiscalCompletionIdentity,
  payrollCompletionIdentity,
  purchasesCompletionIdentity,
  type ScheduleCompletionIdentity,
} from "@/lib/schedule-completion";
import { resolveUserDisplayName } from "@/lib/user-display-name";
import {
  CLOSING_SCHEDULE_MODULES,
  BOOK_SCHEDULE_TASK_IDS,
  FISCAL_SCHEDULE_TASK_IDS,
  FINANCIAL_SCHEDULE_TASK_IDS,
  PAYROLL_SCHEDULE_TASK_IDS,
  calculateClosingScheduleProgress,
  summarizeScheduleCompanyProgress,
  type ClosingScheduleRecord,
} from "@/lib/closing-schedule-progress";

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
type AccountingTab = "pis-cofins" | "receita-filial" | "analise-balancete" | "irpj-csll" | "rateio-csc" | "almoxarifado" | "intercompany" | "provisoes" | "despesas" | "arrendamentos" | "lotes-integrar";
type FiscalTab = "paa" | "iss" | "ecd";
type BookReport = "balancete" | "razao" | "plano-contas";
type ScheduleView = "acompanhamento" | "historico";
type Area = AccessModule;
type Module =
  | "bancaria"
  | "emprestimos"
  | "parcelamentos"
  | "receita"
  | "fiscal"
  | "compras"
  | "folha"
  | "contabil"
  | "book"
  | "cronograma";

type ScheduleCompany = {
  code: string;
  name: string;
};

type ScheduleModuleKey = (typeof CLOSING_SCHEDULE_MODULES)[number];

const companyDisplayNames: Record<string, string> = {
  "09": "Global Tree",
};

function applyCompanyDisplayName(company: Company): Company {
  if (!company.empresas) return company;
  const displayName = companyDisplayNames[company.empresas.codcoligada];
  return displayName
    ? {
        ...company,
        empresas: { ...company.empresas, razao_social: displayName },
      }
    : company;
}

const scheduleSidebarModules = [
  { id: "financeiro", label: "Módulo Financeiro", icon: WalletCards },
  { id: "folha", label: "Módulo Folha de Pagamento", icon: UsersRound },
  { id: "fiscal", label: "Módulo Fiscal", icon: FileSpreadsheet },
  { id: "contabil", label: "Módulo Contábil", icon: BookText },
  { id: "book", label: "Book Contábil", icon: BookOpenCheck },
] as const;

const accountingScheduleTasks: { id: AccountingTab; label: string; description: string }[] = [
  { id: "receita-filial", label: "Receita por Filial", description: "Receita detalhada por unidade" },
  { id: "arrendamentos", label: "Arrendamentos", description: "Rotina integrada" },
  { id: "despesas", label: "Despesas", description: "Conferência das despesas" },
  { id: "provisoes", label: "Provisões", description: "Provisões contábeis" },
  { id: "pis-cofins", label: "PIS e COFINS", description: "Apuração por empresa" },
  { id: "rateio-csc", label: "Rateio CSC", description: "Memória e rateio de custos" },
  { id: "almoxarifado", label: "Almoxarifado", description: "Importação do controle e geração dos lançamentos" },
  { id: "intercompany", label: "Intercompany", description: "Cruzamentos entre empresas" },
  { id: "irpj-csll", label: "IRPJ/CSLL", description: "Apuração do imposto" },
  { id: "lotes-integrar", label: "Lotes a integrar", description: "Pendências de integração contábil" },
  { id: "analise-balancete", label: "Análise Balancete", description: "Crítica do balancete" },
];

type FinancialScheduleTaskId = (typeof FINANCIAL_SCHEDULE_TASK_IDS)[number];
const financialScheduleTasks: { id: FinancialScheduleTaskId; label: string; description: string }[] = [
  { id: "bancaria", label: "Conciliação Bancária", description: "Extratos, saldos e lançamentos" },
  { id: "receita", label: "Conciliação de Receita", description: "Receita fiscal x contábil" },
  { id: "emprestimos", label: "Conciliação de Empréstimos", description: "Contratos, parcelas e saldos" },
  { id: "parcelamentos", label: "Conciliação de Parcelamentos", description: "Parcelamentos e baixas" },
];

type PayrollScheduleTaskId = (typeof PAYROLL_SCHEDULE_TASK_IDS)[number];
const payrollScheduleTasks: { id: PayrollScheduleTaskId; label: string; description: string }[] = [
  { id: "lote", label: "Conferência do Lote", description: "Equilíbrio entre débitos e créditos do lote" },
  { id: "liquidos", label: "Líquidos da Folha", description: "Salários, férias, rescisões, RPA e adiantamentos" },
  { id: "inss", label: "INSS", description: "Conferência da contribuição previdenciária" },
  { id: "fgts", label: "FGTS", description: "Conferência do fundo de garantia" },
  { id: "irrf", label: "IRRF", description: "Conferência do imposto de renda retido" },
  { id: "provisoes", label: "Provisões", description: "Férias, 13º salário e encargos" },
];

type FiscalScheduleTaskId = (typeof FISCAL_SCHEDULE_TASK_IDS)[number];
const fiscalScheduleTasks: { id: FiscalScheduleTaskId; label: string; description: string }[] = [
  { id: "paa", label: "PAA", description: "Conferência da apuração PAA" },
  { id: "iss", label: "ISS", description: "Conferência da apuração de ISS" },
  { id: "ecd", label: "ECD", description: "Conferência da escrituração contábil digital" },
];

type BookScheduleTaskId = (typeof BOOK_SCHEDULE_TASK_IDS)[number];
const bookScheduleTasks: { id: BookScheduleTaskId; label: string; description: string }[] = [
  { id: "balancete", label: "Balancete", description: "Relatório base do balancete" },
  { id: "razao", label: "Razão", description: "Relatório base do razão" },
  { id: "plano-contas", label: "Plano de Contas", description: "Relatório base do plano de contas" },
];

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
  fiscal: {
    title: "Módulo Fiscal",
    description:
      "Apurações fiscais, obrigações e conferências tributárias.",
    icon: FileSpreadsheet,
  },
  compras: {
    title: "Compras",
    description:
      "Solicitações, pedidos, fornecedores e acompanhamento das aquisições.",
    icon: ShoppingCart,
  },
  folha: {
    title: "Conciliação Folha de Pagamento",
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
  fiscal: { ...modules.fiscal },
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
const LEASE_APP_URL = "https://arrendamentov2.vercel.app";

function buildLeaseAppUrl(currentSession: Session | null) {
  const url = new URL(LEASE_APP_URL);
  if (currentSession?.access_token && currentSession.refresh_token) {
    url.hash = new URLSearchParams({
      source: "contabilidade-raiz",
      access_token: currentSession.access_token,
      refresh_token: currentSession.refresh_token,
    }).toString();
  }
  return url.toString();
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const sessionUserId = session?.user.id ?? "";
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [moduleGrants, setModuleGrants] = useState<AccessModule[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companyId, setCompanyId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab] = useState<Tab>("conciliacao");
  const [accountingTab, setAccountingTab] = useState<AccountingTab>("pis-cofins");
  const [fiscalTab, setFiscalTab] = useState<FiscalTab>("paa");
  const [pendingLotsAllCompanies, setPendingLotsAllCompanies] = useState(false);
  const [pendingLotsUpdating, setPendingLotsUpdating] = useState(false);
  const [warehouseFinalized, setWarehouseFinalized] = useState(false);
  const [warehouseReady, setWarehouseReady] = useState(false);
  const [bookReport, setBookReport] = useState<BookReport>("balancete");
  const [scheduleView, setScheduleView] = useState<ScheduleView>("acompanhamento");
  const [selectedScheduleModule, setSelectedScheduleModule] = useState<ScheduleModuleKey>("contabil");
  const [selectedArea, setSelectedArea] = useState<Area | null>(null);
  const [managingAccess, setManagingAccess] = useState(false);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [closingDate, setClosingDate] = useState(defaultClosingDateValue);
  const [filterStorageReady, setFilterStorageReady] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [busy, setBusy] = useState(false);
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
  const allowedAreas: Area[] = resolveAllowedModules(userProfiles, moduleGrants);
  const selectedCompanyCode = company?.empresas?.codcoligada ?? "";
  const selectedCompanyName = company?.empresas?.razao_social ?? "";
  const moduleCompletionIdentity: (ScheduleCompletionIdentity & { additionalItems?: ScheduleCompletionIdentity[] }) | null = (() => {
    if (!selectedModule || selectedModule === "cronograma") return null;
    if (selectedModule === "contabil") {
      if (accountingTab === "pis-cofins") return null;
      if (accountingTab === "almoxarifado") {
        const uniqueCompanies = [...new Map(companies.flatMap((item) => item.empresas ? [[
          String(Number(item.empresas.codcoligada)),
          { code: item.empresas.codcoligada, name: item.empresas.razao_social },
        ] as const] : [])).values()];
        const warehouseItems = uniqueCompanies.map((item) =>
          accountingCompletionIdentity("almoxarifado", item.code, item.name),
        );
        return warehouseItems.length
          ? { ...warehouseItems[0], additionalItems: warehouseItems.slice(1) }
          : null;
      }
      return accountingCompletionIdentity(accountingTab, selectedCompanyCode, selectedCompanyName);
    }
    if (selectedModule === "bancaria") return null;
    if (["receita", "emprestimos", "parcelamentos"].includes(selectedModule)) {
      return financialCompletionIdentity(selectedModule, selectedCompanyCode, selectedCompanyName);
    }
    if (selectedModule === "fiscal") {
      return fiscalCompletionIdentity(fiscalTab, selectedCompanyCode, selectedCompanyName);
    }
    if (selectedModule === "folha") {
      const payrollItems = PAYROLL_SCHEDULE_TASK_IDS.map((taskId) =>
        payrollCompletionIdentity(taskId, selectedCompanyCode, selectedCompanyName),
      );
      return { ...payrollItems[0], additionalItems: payrollItems.slice(1) };
    }
    if (selectedModule === "book") {
      return bookCompletionIdentity(bookReport, selectedCompanyCode, selectedCompanyName);
    }
    if (selectedModule === "compras") {
      return purchasesCompletionIdentity(selectedCompanyCode, selectedCompanyName);
    }
    return null;
  })();

  useEffect(() => {
    void Promise.resolve().then(() => {
      const savedYear = Number(window.localStorage.getItem("contabilidade-raiz:year"));
      const savedMonth = Number(window.localStorage.getItem("contabilidade-raiz:month"));
      const savedClosingDate = window.localStorage.getItem("contabilidade-raiz:closing-date");
      const savedPosition = window.localStorage.getItem("contabilidade-raiz:last-position");
      if (savedYear >= 2000 && savedYear <= 2100) setYear(savedYear);
      if (savedMonth >= 1 && savedMonth <= 12) setMonth(savedMonth);
      if (savedClosingDate && /^\d{4}-\d{2}-\d{2}$/.test(savedClosingDate)) setClosingDate(savedClosingDate);
      if (savedPosition) {
        try {
          const position = JSON.parse(savedPosition) as Record<string, string>;
          const validModules = new Set(Object.keys(modules));
          const validAreas = new Set(Object.keys(areas));
          const validTabs = new Set(["conciliacao", "contas", "extratos", "saldos"]);
          const validAccountingTabs = new Set(accountingScheduleTasks.map((item) => item.id));
          const validFiscalTabs = new Set(fiscalScheduleTasks.map((item) => item.id));
          const validBookReports = new Set(bookScheduleTasks.map((item) => item.id));
          const validScheduleViews = new Set(["acompanhamento", "historico"]);
          const validScheduleModules = new Set<string>(CLOSING_SCHEDULE_MODULES);
          if (validModules.has(position.selectedModule)) setSelectedModule(position.selectedModule as Module);
          if (validAreas.has(position.selectedArea)) setSelectedArea(position.selectedArea as Area);
          if (validTabs.has(position.tab)) setTab(position.tab as Tab);
          if (validAccountingTabs.has(position.accountingTab as AccountingTab)) setAccountingTab(position.accountingTab as AccountingTab);
          if (validFiscalTabs.has(position.fiscalTab as FiscalTab)) setFiscalTab(position.fiscalTab as FiscalTab);
          if (validBookReports.has(position.bookReport as BookReport)) setBookReport(position.bookReport as BookReport);
          if (validScheduleViews.has(position.scheduleView)) setScheduleView(position.scheduleView as ScheduleView);
          if (validScheduleModules.has(position.selectedScheduleModule)) setSelectedScheduleModule(position.selectedScheduleModule as ScheduleModuleKey);
        } catch {
          // Um marcador inválido não impede o carregamento normal da aplicação.
        }
      }
      setFilterStorageReady(true);
    });
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
    if (!filterStorageReady) return;
    const previous = (() => {
      try {
        return JSON.parse(window.localStorage.getItem("contabilidade-raiz:last-position") || "{}") as Record<string, string>;
      } catch {
        return {};
      }
    })();
    window.localStorage.setItem("contabilidade-raiz:last-position", JSON.stringify({
      ...previous,
      ...(selectedModule ? { selectedModule } : {}),
      ...(selectedArea ? { selectedArea } : {}),
      tab,
      accountingTab,
      fiscalTab,
      bookReport,
      scheduleView,
      selectedScheduleModule,
    }));
  }, [accountingTab, bookReport, filterStorageReady, fiscalTab, scheduleView, selectedArea, selectedModule, selectedScheduleModule, tab]);

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
    const applyAuthorizedSession = (current: Session | null) => {
      if (!active) return;
      if (current && !isAllowedCorporateEmail(current.user.email)) {
        setSession(null);
        setNotice("Acesso permitido somente para e-mails @raizeducacao.com.br.");
        window.setTimeout(() => { void supabase.auth.signOut(); }, 0);
        return;
      }
      setSession(current);
    };
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const source = hashParams.get("source");
    if (source === "contabilidade-raiz" && accessToken && refreshToken) {
      void supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ data, error }) => {
          if (!active) return;
          if (data.session) applyAuthorizedSession(data.session);
          if (error) setNotice("Não foi possível aproveitar sua sessão do Contabilidade Raiz. Entre novamente para continuar.");
          window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
        });
    }
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      applyAuthorizedSession(data.session);
      if (error)
        setNotice(
          "Sua autenticação não pôde ser confirmada. Entre novamente para continuar.",
        );
      setLoading(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, current) => {
        if (!active) return;
        void applyAuthorizedSession(current);
        setLoading(false);
      },
    );
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setCompaniesLoading(true);
      setCompanies([]);
      setModuleGrants([]);
      setCompanyId("");
      if (!sessionUserId) return;
      const [companiesResult, grantsResult] = await Promise.all([
        supabase
          .from("usuarios_empresas")
          .select("empresa_id, perfil, empresas(id, codcoligada, razao_social, cnpj)")
          .eq("usuario_id", sessionUserId),
        supabase
          .from("usuarios_modulos")
          .select("modulo")
          .eq("usuario_id", sessionUserId),
      ]);
      if (!active) return;
      if (companiesResult.error) {
        setNotice("Não foi possível carregar as empresas vinculadas. Atualize a página para tentar novamente.");
        setCompaniesLoading(false);
        return;
      }
      const rows = ((companiesResult.data ?? []) as unknown as Company[]).map(
        applyCompanyDisplayName,
      );
      setCompanies(rows);
      if (!grantsResult.error) {
        setModuleGrants((grantsResult.data ?? []).flatMap((row) => {
          const value = String(row.modulo ?? "") as AccessModule;
          return ["financeiro", "fiscal", "compras", "folha", "contabil", "book", "cronograma"].includes(value) ? [value] : [];
        }));
      }
      setCompanyId((current) => {
        if (rows.some((row) => row.empresa_id === current)) return current;
        const saved = window.localStorage.getItem("contabilidade-raiz:company-id");
        if (saved && rows.some((row) => row.empresa_id === saved)) return saved;
        return rows[0]?.empresa_id ?? "";
      });
      setCompaniesLoading(false);
    });
    return () => { active = false; };
  }, [sessionUserId]);
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

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setNotice("");
    if (!isAllowedCorporateEmail(email)) {
      setNotice("Acesso permitido somente para e-mails @raizeducacao.com.br.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error)
      setNotice("Não foi possível entrar. Confira o e-mail e a senha.");
  }
  async function requestAccess(event: React.FormEvent) {
    event.preventDefault();
    setNotice("");
    setRequestSent(false);
    if (!isAllowedCorporateEmail(email)) {
      setNotice("Somente e-mails @raizeducacao.com.br podem solicitar acesso.");
      return;
    }
    setRequestBusy(true);
    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível enviar a solicitação.");
      setRequestSent(true);
      setNotice(body.message || "Solicitação enviada para aprovação.");
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : "Não foi possível enviar a solicitação.");
    } finally {
      setRequestBusy(false);
    }
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
        <form className="login-card" onSubmit={requestingAccess ? requestAccess : login}>
          <Image
            className="brand-logo"
            src="/logo-raiz.png"
            alt="Raiz Educação"
            width={118}
            height={118}
            priority
          />
          <span className="eyebrow">{requestingAccess ? "SOLICITAÇÃO DE ACESSO" : "CONTABILIDADE CORPORATIVA"}</span>
          <h1>{requestingAccess ? "Solicite seu acesso" : "Contabilidade Raiz"}</h1>
          <p>
            {requestingAccess
              ? "Use seu e-mail corporativo. Após a aprovação, você receberá um link para criar sua senha."
              : "Financeiro, compras, folha de pagamento e fechamento contábil em um único ambiente."}
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
          {!requestingAccess && <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>}
          {notice && <div className={`notice ${requestSent ? "" : "error"}`}>{notice}</div>}
          <button className="primary" type="submit" disabled={requestBusy || requestSent}>
            {requestingAccess ? requestBusy ? "Enviando..." : requestSent ? "Solicitação enviada" : "Solicitar acesso" : "Entrar"}
          </button>
          <button
            className="login-switch"
            type="button"
            onClick={() => {
              setRequestingAccess((current) => !current);
              setRequestSent(false);
              setNotice("");
            }}
          >
            {requestingAccess ? "Já tenho acesso" : "Ainda não tenho acesso"}
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
          <p>Peça ao administrador para revisar sua liberação de acesso.</p>
          <button onClick={() => supabase.auth.signOut()}>Sair</button>
        </section>
      </main>
    );
  if (isAdministrator && managingAccess)
    return (
      <AccessManagement
        accessToken={session.access_token}
        email={session.user.email ?? ""}
        onBack={() => setManagingAccess(false)}
        onLogout={() => supabase.auth.signOut()}
      />
    );
  if (!selectedArea)
    return (
      <AreaHub
        email={session.user.email ?? ""}
        closingDate={closingDate}
        onClosingDateChange={(date) => void updateClosingDate(date)}
        allowedAreas={allowedAreas}
        companyCodes={companies.flatMap((item) => item.empresas ? [item.empresas.codcoligada] : [])}
        isAdministrator={isAdministrator}
        onManageAccess={() => setManagingAccess(true)}
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
        {selectedModule !== "contabil" && (
          <div className={`current-module ${selectedModule === "emprestimos" ? "loan-current-module" : ""}`}>
            <ActiveModuleIcon />
            <span>{activeModule.title}</span>
          </div>
        )}
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
        {selectedModule === "fiscal" && (
          <nav className="accounting-nav fiscal-nav">
            {([
              { id: "paa", label: "PAA", icon: ListChecks },
              { id: "iss", label: "ISS", icon: ReceiptText },
              { id: "ecd", label: "ECD", icon: BookOpenCheck },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={fiscalTab === id ? "active" : ""}
                onClick={() => setFiscalTab(id)}
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
                { id: "receita-filial", label: "Receita por Filial", icon: TrendingUp },
                { id: "arrendamentos", label: "Arrendamentos", icon: HandCoins },
                { id: "despesas", label: "Despesas", icon: ReceiptText },
                { id: "provisoes", label: "Provisões", icon: Save },
                { id: "pis-cofins", label: "PIS e COFINS", icon: FileSpreadsheet },
                { id: "rateio-csc", label: "Rateio CSC", icon: ArrowLeftRight },
                { id: "almoxarifado", label: "Almoxarifado", icon: PackageOpen },
                { id: "intercompany", label: "Intercompany", icon: Building2 },
                { id: "irpj-csll", label: "IRPJ/CSLL", icon: ReceiptText },
                { id: "lotes-integrar", label: "Lotes a integrar", icon: ListChecks },
                { id: "analise-balancete", label: "Análise Balancete", icon: BarChart3 },
              ] as const
            ).map(({ id, label, icon: Icon }) =>
                <button
                  key={id}
                  className={accountingTab === id ? "active" : ""}
                  onClick={() => setAccountingTab(id)}
                >
                  <Icon />
                  {label}
                </button>
            )}
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
          <nav className="schedule-sidebar-nav">
            <div className="schedule-sidebar-modules" aria-label="Módulos do cronograma">
              {scheduleSidebarModules.map(({ id, label, icon: Icon }) => (
                <button
                  key={`schedule-sidebar-${id}`}
                  className={scheduleView === "acompanhamento" && selectedScheduleModule === id ? "active schedule-sidebar-module-active" : ""}
                  onClick={() => {
                    setScheduleView("acompanhamento");
                    setSelectedScheduleModule(id);
                  }}
                >
                  <Icon />
                  {label}
                </button>
              ))}
            </div>
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
        className={`content ${selectedModule === "book" ? "book-content" : selectedModule === "receita" ? "revenue-content" : selectedModule === "emprestimos" ? "trial-content loan-content" : selectedModule === "contabil" ? `tax-content ${accountingTab === "analise-balancete" ? "trial-content" : accountingTab === "lotes-integrar" ? "pending-lots-content" : accountingTab === "intercompany" ? "intercompany-content" : ""}` : selectedModule === "cronograma" ? "schedule-content" : selectedModule === "bancaria" ? "bank-content" : selectedModule === "folha" ? "payroll-content" : ""}`}
      >
        <header>
          <div>
            <span className="eyebrow">CONTABILIDADE RAIZ</span>
            <h1>
              {selectedModule === "fiscal"
                ? fiscalTab === "paa"
                  ? "PAA"
                  : fiscalTab === "iss"
                    ? "ISS"
                    : "ECD"
                : selectedModule === "contabil"
                ? accountingTab === "pis-cofins"
                  ? "PIS e COFINS"
                  : accountingTab === "receita-filial"
                    ? "Receita por Filial"
                  : accountingTab === "analise-balancete"
                    ? "Análise de Balancete"
                  : accountingTab === "irpj-csll"
                    ? "IRPJ/CSLL"
                    : accountingTab === "rateio-csc"
                      ? "Rateio CSC"
                    : accountingTab === "almoxarifado"
                      ? "Almoxarifado"
                      : accountingTab === "provisoes"
                          ? "Provisões"
                        : accountingTab === "despesas"
                          ? "Despesas"
                        : accountingTab === "arrendamentos"
                          ? "Arrendamentos"
                        : accountingTab === "lotes-integrar"
                          ? "Lotes a integrar"
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
        <section className={`top-context ${selectedModule === "cronograma" ? "schedule-filters" : ""} ${selectedModule === "folha" ? "payroll-top-context" : ""}`}>
          <div className="filter-heading">
            <span className="filter-icon">
              <SlidersHorizontal />
            </span>
            <div>
              <b>
                {selectedModule === "cronograma" || (selectedModule === "contabil" && (accountingTab === "rateio-csc" || accountingTab === "almoxarifado"))
                  ? selectedModule === "cronograma"
                    ? "Cronograma Fechamento"
                    : "Período"
                  : selectedModule === "contabil" && (accountingTab === "pis-cofins" || accountingTab === "intercompany")
                  ? "Filtros"
                  : "Filtros da análise"}
              </b>
              <small>{selectedModule === "cronograma" || (selectedModule === "contabil" && (accountingTab === "rateio-csc" || accountingTab === "almoxarifado")) ? "Selecione o ano e o mês" : selectedModule === "folha" ? "Selecione a coligada e a competência da folha" : "Selecione a empresa e a competência"}</small>
            </div>
          </div>
          <div className="filter-fields">
            {selectedModule !== "cronograma" && !(selectedModule === "contabil" && (accountingTab === "rateio-csc" || accountingTab === "almoxarifado")) && <label className="company-control">
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
            {!(selectedModule === "contabil" && accountingTab === "despesas") && (
              <div className="competence-control">
                <label>
                  <span>Mês</span>
                  <select
                    value={month}
                    aria-label="Mês selecionado"
                    title={`Mês selecionado: ${months[month - 1]}`}
                    onChange={(e) => setMonth(Number(e.target.value))}
                  >
                    {months.map((name, index) => (
                      <option key={name} value={index + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Ano</span>
                  <input
                    type="number"
                    value={year}
                    aria-label="Ano selecionado"
                    title={`Ano selecionado: ${year}`}
                    onChange={(e) => setYear(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
            {selectedModule === "cronograma" && (
              <div className="schedule-window-inline">
                <span>Janela projetada</span>
                <b>
                  {formatShortDate(new Date(year, month, 1))} a {formatShortDate(addBusinessDays(new Date(year, month, 1), 10))}
                </b>
                <small>Financeiro D+3 · Folha D+5 · Fiscal sem tarefas · Contabilidade na data definida</small>
              </div>
            )}
          </div>
          {selectedModule === "contabil" && accountingTab === "pis-cofins" && (
            <div
              id="pis-cofins-filter-actions"
              className="filter-actions-slot"
            />
          )}
          {selectedModule === "folha" && (
            <div
              id="payroll-filter-actions"
              className="filter-actions-slot payroll-filter-actions"
            />
          )}
          {selectedModule === "bancaria" && tab === "conciliacao" && (
            <div
              id="bank-reconciliation-filter-actions"
              className="filter-actions-slot bank-filter-actions"
            />
          )}
          {selectedModule === "contabil" && accountingTab === "lotes-integrar" && (
            <div className="filter-actions-slot pending-lots-filter-actions">
              <label className="pending-lots-all">
                <input type="checkbox" checked={pendingLotsAllCompanies} onChange={(event) => setPendingLotsAllCompanies(event.target.checked)} />
                <span>Todas</span>
              </label>
              <button className="primary" disabled={pendingLotsUpdating} onClick={() => window.dispatchEvent(new Event("pending-lots:update"))}>
                <RefreshCw className={pendingLotsUpdating ? "spin" : ""} /> {pendingLotsUpdating ? "Atualizando..." : "Atualizar"}
              </button>
            </div>
          )}
          {moduleCompletionIdentity && (
            <ModuleCompletionControl
              competence={competence}
              modulo={moduleCompletionIdentity.modulo}
              setor={moduleCompletionIdentity.setor}
              additionalItems={moduleCompletionIdentity.additionalItems}
              userId={session.user.id}
              userEmail={session.user.email ?? ""}
              disabled={selectedModule === "contabil" && accountingTab === "almoxarifado" && !warehouseReady}
              disabledReason="Importe e valide o controle do Almoxarifado antes de finalizar."
              onStatusChange={selectedModule === "contabil" && accountingTab === "almoxarifado" ? setWarehouseFinalized : undefined}
            />
          )}
        </section>
        {notice && <div className="notice">{notice}</div>}
        {selectedModule === "bancaria" && tab === "conciliacao" && (
          <MonthlyReconciliationPanel
            key={`${companyId}-${competence}`}
            competence={competence}
            companyId={companyId}
            companyCode={company?.empresas?.codcoligada ?? ""}
            companyName={`${company?.empresas?.codcoligada ?? ""} — ${company?.empresas?.razao_social ?? ""}`}
            reconciledBy={session.user.email ?? ""}
            accessToken={session.access_token}
            userId={session.user.id}
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
            key={`${companyId}-${competence}`}
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
            key={`${companyId}-${competence}`}
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
            userId={session.user.id}
            userEmail={session.user.email ?? ""}
            userName={resolveUserDisplayName(session.user.user_metadata, session.user.email ?? "")}
          />
        )}
        {selectedModule === "emprestimos" && (
          <LoanReconciliation
            key={`${company?.empresas?.codcoligada ?? ""}-${competence}`}
            companyCode={company?.empresas?.codcoligada ?? ""}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "folha" && (
          <PayrollBatchReconciliation
            key={`${company?.empresas?.codcoligada ?? ""}-${competence}`}
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
        {selectedModule === "contabil" && accountingTab === "lotes-integrar" && (
          <PendingAccountingLots
            key={`${company?.empresas?.codcoligada ?? ""}-${competence}-${pendingLotsAllCompanies}`}
            companyCode={company?.empresas?.codcoligada ?? ""}
            allCompanies={pendingLotsAllCompanies}
            competence={competence}
            accessToken={session.access_token}
            onLoadingChange={setPendingLotsUpdating}
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
        {selectedModule === "contabil" && accountingTab === "almoxarifado" && (
          <WarehousePostings
            key={competence}
            companies={companies.flatMap((item) => item.empresas ? [{ code: item.empresas.codcoligada, name: item.empresas.razao_social }] : [])}
            competence={competence}
            isFinalized={warehouseFinalized}
            onReadyChange={setWarehouseReady}
          />
        )}
        {selectedModule === "contabil" && accountingTab === "arrendamentos" && (
          <section className="panel module-workspace accounting-workspace lease-bridge">
            <HandCoins />
            <span className="eyebrow">ROTINA INTEGRADA</span>
            <h2>Arrendamentos</h2>
            <p>
              A rotina de arrendamentos está conectada ao projeto oficial
              arrendamentov2 da Vercel da Raiz.
            </p>
            <a
              className="primary lease-bridge-link"
              href={buildLeaseAppUrl(session)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink />
              Abrir arrendamentov2
            </a>
          </section>
        )}
        {selectedModule === "contabil" && accountingTab === "despesas" && (
          <ExpenseAnalysis
            key={`${company?.empresas?.codcoligada ?? ""}-${competence}`}
            companyCode={company?.empresas?.codcoligada ?? ""}
            companyName={company?.empresas?.razao_social ?? ""}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "contabil" && accountingTab === "receita-filial" && (
          <RevenueByBranch
            key={`${company?.empresas?.codcoligada ?? ""}-${competence}`}
            companyCode={company?.empresas?.codcoligada ?? ""}
            competence={competence}
            accessToken={session.access_token}
          />
        )}
        {selectedModule === "contabil" && accountingTab !== "pis-cofins" && accountingTab !== "receita-filial" && accountingTab !== "analise-balancete" && accountingTab !== "intercompany" && accountingTab !== "rateio-csc" && accountingTab !== "almoxarifado" && accountingTab !== "arrendamentos" && accountingTab !== "despesas" && accountingTab !== "lotes-integrar" && (
          <section className="panel module-workspace accounting-workspace">
            {accountingTab === "irpj-csll" ? (
              <ReceiptText />
            ) : accountingTab === "provisoes" ? (
              <Save />
            ) : accountingTab === "despesas" ? (
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
                : accountingTab === "provisoes"
                  ? "Provisões"
                : accountingTab === "despesas"
                  ? "Despesas"
                : accountingTab === "arrendamentos"
                  ? "Arrendamentos"
                : accountingTab === "rateio-csc"
                  ? "Rateio CSC"
                  : "Intercompany"}
            </h2>
            <p>
              Área preparada para receber as regras, bases e conferências desta rotina.
            </p>
          </section>
        )}
        {selectedModule === "fiscal" && (
          <section className="panel module-workspace accounting-workspace fiscal-workspace">
            {fiscalTab === "paa" ? (
              <ListChecks />
            ) : fiscalTab === "iss" ? (
              <ReceiptText />
            ) : (
              <BookOpenCheck />
            )}
            <span className="eyebrow">MÓDULO FISCAL</span>
            <h2>{fiscalTab === "paa" ? "PAA" : fiscalTab === "iss" ? "ISS" : "ECD"}</h2>
            <p>Área preparada para receber as regras, bases, documentos e conferências desta rotina fiscal.</p>
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
            selectedScheduleModule={selectedScheduleModule}
            companies={companies.flatMap((item) =>
              item.empresas
                ? [{ code: item.empresas.codcoligada, name: item.empresas.razao_social }]
                : [],
            )}
          />
        )}
        {selectedModule === "cronograma" && scheduleView === "historico" && (
          <ClosingHistory />
        )}
        {selectedModule !== "bancaria" &&
          selectedModule !== "book" &&
          selectedModule !== "receita" &&
          selectedModule !== "emprestimos" &&
          selectedModule !== "folha" &&
          selectedModule !== "fiscal" &&
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

function AreaHub({
  email,
  closingDate,
  onClosingDateChange,
  allowedAreas,
  companyCodes,
  isAdministrator,
  onManageAccess,
  onSelect,
  onLogout,
}: {
  email: string;
  closingDate: string;
  onClosingDateChange: (date: string) => void;
  allowedAreas: Area[];
  companyCodes: string[];
  isAdministrator: boolean;
  onManageAccess: () => void;
  onSelect: (area: Area) => void;
  onLogout: () => void;
}) {
  const executionAreas: Area[] = ["financeiro", "fiscal", "folha", "contabil"].filter((area) => allowedAreas.includes(area as Area)) as Area[];
  const [completionRecords, setCompletionRecords] = useState<ClosingScheduleRecord[]>([]);
  const ScheduleIcon = areas.cronograma.icon;
  const BookIcon = areas.book.icon;
  const closingMonth = closingDate.slice(5, 7);
  const closingYear = closingDate.slice(0, 4);
  const scheduleCompetence = `${closingYear}-${closingMonth}`;
  const closingYears = Array.from({ length: 5 }, (_, index) => today.getFullYear() - 1 + index);
  const scheduleProgress = calculateClosingScheduleProgress(completionRecords, companyCodes);

  useEffect(() => {
    let active = true;
    const loadCompletedAreas = async () => {
      const { data } = await supabase
        .from("cronograma_entregas")
        .select("modulo,status")
        .eq("competencia", scheduleCompetence);
      if (active) setCompletionRecords((data ?? []) as ClosingScheduleRecord[]);
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

  const openSchedule = () => onSelect("cronograma");
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
          {isAdministrator && <button onClick={onManageAccess}><ShieldCheck /> Administrar acessos</button>}
          <button onClick={onLogout}>
            <LogOut />
            Sair
          </button>
        </div>
      </header>
      <section className="closing-workflow" aria-label="Módulos do fechamento contábil">
        <div className="workflow-overview">
          <div className="workflow-overview-copy">
            <span>FECHAMENTO EM ANDAMENTO</span>
            <b>{months[Number(closingMonth) - 1]} de {closingYear}</b>
            <small>{scheduleProgress.completedModulesCount}/{scheduleProgress.totalModules} módulos concluídos</small>
          </div>
          <div className="workflow-overview-progress">
            <span>
              <i style={{ width: `${scheduleProgress.overallPercent}%` }} />
            </span>
            <b>{scheduleProgress.overallPercent}%</b>
          </div>
          <div className="workflow-date">
            <span>Mês/Ano do fechamento</span>
            <div className="workflow-date-fields">
              <select
                aria-label="Mês do fechamento"
                value={closingMonth}
                onChange={(event) => onClosingDateChange(`${closingYear}-${event.target.value}-10`)}
              >
                {months.map((name, index) => (
                  <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>
                ))}
              </select>
              <select
                aria-label="Ano do fechamento"
                value={closingYear}
                onChange={(event) => onClosingDateChange(`${event.target.value}-${closingMonth}-10`)}
              >
                {closingYears.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="workflow-divider"><span>MÓDULOS DO FECHAMENTO</span></div>
        <div className="workflow-modules workflow-modules-unified">
          {allowedAreas.includes("cronograma") && <button className="module-card area-cronograma" onClick={openSchedule}>
            <span className="module-card-top">
              <span className="module-icon"><ScheduleIcon /></span>
              <span className="module-status module-status-progress">{scheduleProgress.completedModulesCount}/{scheduleProgress.totalModules}</span>
            </span>
            <span className="module-copy">
              <b>Cronograma de Fechamento</b>
              <small>Acompanhe prazos, responsáveis e o andamento de todas as etapas.</small>
            </span>
            <span className="module-progress" aria-label="Progresso do cronograma">
              <i style={{ width: `${scheduleProgress.overallPercent}%` }} />
            </span>
            <span className="module-enter">Abrir cronograma <ArrowLeftRight /></span>
          </button>}

          {executionAreas.map((id) => {
            const item = areas[id];
            const Icon = item.icon;
            const modulePercent = scheduleProgress.modulePercent[id as ScheduleModuleKey];
            const hasScheduleTasks = scheduleProgress.includedModules.includes(id as ScheduleModuleKey);
            return (
              <button
                key={id}
                className={`module-card area-${id}`}
                onClick={() => onSelect(id)}
              >
                <span className="module-card-top">
                  <span className="module-icon"><Icon /></span>
                  <span className={`module-status ${hasScheduleTasks ? "" : "module-status-soon"}`}>{hasScheduleTasks ? `${modulePercent}%` : "Sem tarefas"}</span>
                </span>
                <span className="module-copy">
                  <b>{item.title}</b>
                  <small>{item.description}</small>
                </span>
                {hasScheduleTasks && <span className="module-progress" aria-label={`Status de ${item.title}`}>
                  <i style={{ width: `${modulePercent}%` }} />
                </span>}
                <span className="module-enter">Acessar módulo <ArrowLeftRight /></span>
              </button>
            );
          })}

          <article className="module-card area-ativo-fixo module-card-coming-soon" aria-label="Ativo Fixo, em breve">
            <span className="module-card-top">
              <span className="module-icon"><Building2 /></span>
              <span className="module-status module-status-soon">Em breve</span>
            </span>
            <span className="module-copy">
              <b>Ativo Fixo</b>
              <small>Aquisições, baixas, transferências, depreciação e confronto contábil.</small>
            </span>
            <span className="module-enter">Módulo preparado para criação</span>
          </article>

          <article className="module-card area-demonstracoes-financeiras module-card-coming-soon" aria-label="Demonstrações Financeiras, em breve">
            <span className="module-card-top">
              <span className="module-icon"><BarChart3 /></span>
              <span className="module-status module-status-soon">Em breve</span>
            </span>
            <span className="module-copy">
              <b>Demonstrações Financeiras</b>
              <small>Balanço patrimonial, DRE, DFC, DMPL e notas explicativas.</small>
            </span>
            <span className="module-enter">Módulo preparado para criação</span>
          </article>

          {allowedAreas.includes("book") && (
            <button
              className="module-card area-book"
              onClick={() => onSelect("book")}
            >
              <span className="module-card-top">
                <span className="module-icon"><BookIcon /></span>
                <span className="module-status module-status-soon">Sem tarefas</span>
              </span>
              <span className="module-copy">
                <b>Book Contábil</b>
                <small>Consolida os resultados dos módulos e entrega a visão final do fechamento.</small>
              </span>
              <span className="module-enter">Acessar Book <ArrowLeftRight /></span>
            </button>
          )}
        </div>
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

type ScheduleMatrixTask = {
  id: string;
  label: string;
  description: string;
};

function ScheduleCompanyMatrix<T extends ScheduleMatrixTask>({
  prefix,
  tasks,
  companies,
  confirmations,
  loading,
  confirmingModule,
  canEdit,
  companyCode,
  companyLabel,
  isDone,
  confirmationDetail,
  onToggle,
  onToggleAll,
  onToggleCompanyAll,
}: {
  prefix: ScheduleModuleKey;
  tasks: readonly T[];
  companies: ScheduleCompany[];
  confirmations: ScheduleConfirmation[];
  loading: boolean;
  confirmingModule: string;
  canEdit: boolean;
  companyCode: (company: ScheduleCompany) => string;
  companyLabel: (company: ScheduleCompany) => string;
  isDone: (module: string) => boolean;
  confirmationDetail: (module: string) => string;
  onToggle: (task: T, company: ScheduleCompany, checked: boolean) => Promise<void>;
  onToggleAll: (task: T, checked: boolean) => Promise<void>;
  onToggleCompanyAll: (company: ScheduleCompany, checked: boolean) => Promise<void>;
}) {
  const taskIds = tasks.map((task) => task.id);

  return (
    <div className="schedule-matrix-wrap">
      <table className="schedule-matrix">
        <thead>
          <tr>
            <th className="schedule-matrix-company-column">Coligada / empresa</th>
            {tasks.map((task) => {
              const allChecked = companies.length > 0 && companies.every((company) =>
                isDone(`${prefix}:${task.id}:${companyCode(company)}`),
              );
              const allKey = `${prefix}:${task.id}:todas`;
              const disabled = !canEdit || loading || confirmingModule === allKey;
              return (
                <th key={task.id} title={task.description}>
                  <span>{task.label}</span>
                  <label className="schedule-matrix-all">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      disabled={disabled}
                      onChange={(event) => void onToggleAll(task, event.target.checked)}
                    />
                    Todas
                  </label>
                </th>
              );
            })}
            <th className="schedule-matrix-company-all-column">Todas</th>
            <th>Status</th>
            <th className="schedule-matrix-observation-column">Observações</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => {
            const progress = summarizeScheduleCompanyProgress(
              confirmations,
              prefix,
              taskIds,
              companyCode(company),
            );
            return (
              <tr key={`${prefix}:${companyCode(company)}`}>
                <th scope="row" className="schedule-matrix-company-column">
                  {companyLabel(company)}
                </th>
                {tasks.map((task) => {
                  const moduleKey = `${prefix}:${task.id}:${companyCode(company)}`;
                  const checked = isDone(moduleKey);
                  const disabled = !canEdit || loading || confirmingModule === moduleKey;
                  return (
                    <td key={moduleKey} className={`schedule-matrix-check ${checked ? "is-done" : ""}`}>
                      <label title={confirmationDetail(moduleKey)}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          aria-label={`${task.label} — ${companyLabel(company)}`}
                          onChange={(event) => void onToggle(task, company, event.target.checked)}
                        />
                        <span aria-hidden="true">{checked ? "✓" : ""}</span>
                      </label>
                    </td>
                  );
                })}
                <td className={`schedule-matrix-check schedule-matrix-company-all-column ${progress.status === "concluido" ? "is-done" : ""}`}>
                  <label title={`Marcar todas as tarefas de ${companyLabel(company)}`}>
                    <input
                      type="checkbox"
                      checked={progress.status === "concluido"}
                      disabled={!canEdit || loading || confirmingModule === `${prefix}:todas:${companyCode(company)}`}
                      aria-label={`Todas as tarefas — ${companyLabel(company)}`}
                      onChange={(event) => void onToggleCompanyAll(company, event.target.checked)}
                    />
                    <span aria-hidden="true">{progress.status === "concluido" ? "✓" : ""}</span>
                  </label>
                </td>
                <td>
                  <span className={`schedule-matrix-status is-${progress.status}`}>
                    {progress.status === "concluido" ? "✓ Fechada" : progress.status === "andamento" ? "◐ Em andamento" : "○ Pendente"}
                  </span>
                </td>
                <td className="schedule-matrix-observation-column">{progress.observation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClosingSchedule({ year, month, closingDate, userId, userEmail, userProfiles, selectedScheduleModule, companies }: { year: number; month: number; closingDate: string; userId: string; userEmail: string; userProfiles: string[]; selectedScheduleModule: ScheduleModuleKey; companies: ScheduleCompany[] }) {
  const scheduleCompetence = `${year}-${String(month).padStart(2, "0")}`;
  const [confirmations, setConfirmations] = useState<ScheduleConfirmation[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [confirmingModule, setConfirmingModule] = useState("");
  const [confirmingGroup, setConfirmingGroup] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const monthEnd = lastBusinessDay(year, month);
  const stages = [
    { key: "financeiro", name: "Módulo Financeiro", sector: "Financeiro", detail: "Concluir conciliações e pendências financeiras", deadline: addBusinessDays(monthEnd, 3), milestone: "D+3", icon: WalletCards },
    { key: "folha", name: "Módulo Folha de Pagamento", sector: "Folha de Pagamento", detail: "Conferir folha, provisões e encargos", deadline: addBusinessDays(monthEnd, 5), milestone: "D+5", icon: UsersRound },
    { key: "fiscal", name: "Módulo Fiscal", sector: "Fiscal", detail: "Aguardando inclusão das tarefas fiscais", deadline: addBusinessDays(monthEnd, 6), milestone: "Sem tarefas", icon: FileSpreadsheet },
    { key: "contabil", name: "Módulo Contábil", sector: "Contabilidade", detail: "Consolidar análises e concluir o fechamento", deadline: closingDate ? new Date(`${closingDate}T12:00:00`) : addBusinessDays(monthEnd, 10), milestone: "Data definida", icon: BookText },
    { key: "book", name: "Book Contábil", sector: "Contabilidade", detail: "Conferir os relatórios base do fechamento", deadline: closingDate ? new Date(`${closingDate}T12:00:00`) : addBusinessDays(monthEnd, 10), milestone: "Data definida", icon: BookOpenCheck },
  ];
  const selectedStage = stages.find((stage) => stage.key === selectedScheduleModule) ?? stages[0];
  const canConfirmSector = (sector: string) =>
    userProfiles.includes("administrador") || (
      sector === "Financeiro" ? userProfiles.includes("financeiro") :
      sector === "Compras" ? userProfiles.includes("compras") :
      sector === "Fiscal" ? userProfiles.includes("fiscal") :
      sector === "Folha de Pagamento" ? userProfiles.some((profile) => profile === "folha" || profile === "folha de pagamento") :
      userProfiles.some((profile) => profile === "contabil" || profile === "contabilidade" || profile === "contábil")
    );
  const isDone = (modulo: string) => confirmations.some((item) => item.modulo === modulo && item.status === "concluido");
  const getConfirmationDetail = (modulo: string) => {
    const item = confirmations.find((entry) => entry.modulo === modulo && entry.status === "concluido");
    if (!item) return "Ainda não finalizado.";
    const confirmedAt = item.confirmado_em ? new Date(item.confirmado_em).toLocaleString("pt-BR") : "data não registrada";
    return `Finalizado por ${item.confirmado_email || "usuário não identificado"} em ${confirmedAt}.`;
  };
  const scheduleCompanyCode = (company: ScheduleCompany) => String(company.code || "").trim().padStart(2, "0");
  const companyLabel = (company: ScheduleCompany) => `${scheduleCompanyCode(company)} — ${company.name}`;
  const accountingDoneCount = accountingScheduleTasks.reduce(
    (total, task) => total + companies.filter((company) => isDone(`contabil:${task.id}:${scheduleCompanyCode(company)}`)).length,
    0,
  );
  const accountingTotalCount = accountingScheduleTasks.length * companies.length;
  const financialDoneCount = financialScheduleTasks.reduce(
    (total, task) => total + companies.filter((company) => isDone(`financeiro:${task.id}:${scheduleCompanyCode(company)}`)).length,
    0,
  );
  const financialTotalCount = financialScheduleTasks.length * companies.length;
  const payrollDoneCount = payrollScheduleTasks.reduce(
    (total, task) => total + companies.filter((company) => isDone(`folha:${task.id}:${scheduleCompanyCode(company)}`)).length,
    0,
  );
  const payrollTotalCount = payrollScheduleTasks.length * companies.length;
  const accountingPercent = accountingTotalCount ? Math.round((accountingDoneCount / accountingTotalCount) * 100) : 0;
  const financialPercent = financialTotalCount ? Math.round((financialDoneCount / financialTotalCount) * 100) : 0;
  const payrollPercent = payrollTotalCount ? Math.round((payrollDoneCount / payrollTotalCount) * 100) : 0;
  const overallProgress = calculateClosingScheduleProgress(
    confirmations,
    companies.map((company) => company.code),
  ).overallPercent;

  useEffect(() => {
    let active = true;
    const loadConfirmations = () => Promise.resolve().then(() => {
      if (!active) return;
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
    });
    void loadConfirmations();
    const channel = supabase
      .channel(`cronograma-detalhado-${scheduleCompetence}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cronograma_entregas", filter: `competencia=eq.${scheduleCompetence}` }, () => void loadConfirmations())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [scheduleCompetence]);

  async function saveScheduleItem(item: { key: string; sector: string; label: string }, checked: boolean) {
    setConfirmingModule(item.key);
    setScheduleError("");
    const confirmedAt = new Date().toISOString();
    const previous = confirmations.find((confirmation) => confirmation.modulo === item.key);
    const recordedEmail = checked ? userEmail : previous?.confirmado_email || userEmail;
    const recordedAt = checked ? confirmedAt : previous?.confirmado_em || confirmedAt;
    const { error } = await supabase.from("cronograma_entregas").upsert({
      competencia: scheduleCompetence,
      modulo: item.key,
      setor: item.sector,
      status: checked ? "concluido" : "pendente",
      confirmado_por: userId,
      confirmado_email: recordedEmail,
      confirmado_em: recordedAt,
    }, { onConflict: "competencia,modulo" });
    if (error) {
      setScheduleError("O OK não pôde ser registrado. Tente novamente.");
    } else {
      const { error: historyError } = await supabase.from("cronograma_historico").insert({
        competencia: scheduleCompetence,
        modulo: item.key,
        setor: item.sector,
        acao: checked ? "liberado" : "reaberto",
        usuario_id: userId,
        usuario_email: userEmail,
      });
      if (historyError) setScheduleError("O OK foi atualizado, mas o histórico não pôde ser registrado.");
      setConfirmations((current) => [
        ...current.filter((currentItem) => currentItem.modulo !== item.key),
        { modulo: item.key, setor: item.sector, status: checked ? "concluido" : "pendente", confirmado_email: recordedEmail, confirmado_em: recordedAt },
      ]);
    }
    setConfirmingModule("");
  }

  async function toggleScheduleTask(prefix: ScheduleModuleKey, sector: string, task: ScheduleMatrixTask, company: ScheduleCompany, checked: boolean) {
    await saveScheduleItem({
      key: `${prefix}:${task.id}:${scheduleCompanyCode(company)}`,
      sector: `${sector} · ${task.label} · ${companyLabel(company)}`,
      label: `${task.label} · ${companyLabel(company)}`,
    }, checked);
  }

  async function toggleScheduleTaskAll(prefix: ScheduleModuleKey, sector: string, task: ScheduleMatrixTask, checked: boolean) {
    const batchKey = `${prefix}:${task.id}:todas`;
    setConfirmingGroup(batchKey);
    for (const company of companies) {
      await toggleScheduleTask(prefix, sector, task, company, checked);
    }
    setConfirmingGroup("");
  }

  async function toggleScheduleCompanyAll(prefix: ScheduleModuleKey, sector: string, tasks: readonly ScheduleMatrixTask[], company: ScheduleCompany, checked: boolean) {
    setConfirmingGroup(`${prefix}:todas:${scheduleCompanyCode(company)}`);
    for (const task of tasks) {
      await toggleScheduleTask(prefix, sector, task, company, checked);
    }
    setConfirmingGroup("");
  }

  return (
    <section className="closing-schedule">
      <div className="schedule-master-line">
        <span style={{ width: `${overallProgress}%` }} />
      </div>

      {scheduleError && <div className="schedule-error">{scheduleError}</div>}

      <div className="schedule-dashboard-layout">
        <div className="schedule-module-workspace">
          {(() => {
            return (
              <>
                {selectedStage.key === "financeiro" ? (
                  <div className="schedule-accounting-checklist">
                    <header>
                      <div>
                        <span>MÓDULO FINANCEIRO</span>
                        <b>Módulo Financeiro - {months[month - 1]} de {year}</b>
                      </div>
                      <small>{financialPercent}% · {financialDoneCount}/{financialTotalCount || 0} finalizada(s)</small>
                    </header>
                    <ScheduleCompanyMatrix
                      prefix="financeiro"
                      tasks={financialScheduleTasks}
                      companies={companies}
                      confirmations={confirmations}
                      loading={scheduleLoading}
                      confirmingModule={confirmingGroup || confirmingModule}
                      canEdit={canConfirmSector("Financeiro")}
                      companyCode={scheduleCompanyCode}
                      companyLabel={companyLabel}
                      isDone={isDone}
                      confirmationDetail={getConfirmationDetail}
                      onToggle={(task, company, checked) => toggleScheduleTask("financeiro", "Financeiro", task, company, checked)}
                      onToggleAll={(task, checked) => toggleScheduleTaskAll("financeiro", "Financeiro", task, checked)}
                      onToggleCompanyAll={(company, checked) => toggleScheduleCompanyAll("financeiro", "Financeiro", financialScheduleTasks, company, checked)}
                    />
                  </div>
                ) : selectedStage.key === "folha" ? (
                  <div className="schedule-accounting-checklist">
                    <header>
                      <div>
                        <span>MÓDULO FOLHA DE PAGAMENTO</span>
                        <b>Módulo Folha de Pagamento - {months[month - 1]} de {year}</b>
                      </div>
                      <small>{payrollPercent}% · {payrollDoneCount}/{payrollTotalCount || 0} finalizada(s)</small>
                    </header>
                    <ScheduleCompanyMatrix
                      prefix="folha"
                      tasks={payrollScheduleTasks}
                      companies={companies}
                      confirmations={confirmations}
                      loading={scheduleLoading}
                      confirmingModule={confirmingGroup || confirmingModule}
                      canEdit={canConfirmSector("Folha de Pagamento")}
                      companyCode={scheduleCompanyCode}
                      companyLabel={companyLabel}
                      isDone={isDone}
                      confirmationDetail={getConfirmationDetail}
                      onToggle={(task, company, checked) => toggleScheduleTask("folha", "Folha de Pagamento", task, company, checked)}
                      onToggleAll={(task, checked) => toggleScheduleTaskAll("folha", "Folha de Pagamento", task, checked)}
                      onToggleCompanyAll={(company, checked) => toggleScheduleCompanyAll("folha", "Folha de Pagamento", payrollScheduleTasks, company, checked)}
                    />
                  </div>
                ) : selectedStage.key === "fiscal" ? (
                  <div className="schedule-selected-module-card">
                    <b>Sem tarefas cadastradas</b>
                    <p>O Módulo Fiscal ainda não participa do cálculo do cronograma. O progresso será habilitado quando as tarefas fiscais forem incluídas.</p>
                  </div>
                ) : selectedStage.key === "contabil" ? (
                  <div className="schedule-accounting-checklist">
                    <header>
                      <div>
                        <span>MÓDULO CONTÁBIL</span>
                        <b>Módulo Contábil - {months[month - 1]} de {year}</b>
                      </div>
                      <small>{accountingPercent}% · {accountingDoneCount}/{accountingTotalCount || 0} finalizada(s)</small>
                    </header>
                    <ScheduleCompanyMatrix
                      prefix="contabil"
                      tasks={accountingScheduleTasks}
                      companies={companies}
                      confirmations={confirmations}
                      loading={scheduleLoading}
                      confirmingModule={confirmingGroup || confirmingModule}
                      canEdit={canConfirmSector("Contabilidade")}
                      companyCode={scheduleCompanyCode}
                      companyLabel={companyLabel}
                      isDone={isDone}
                      confirmationDetail={getConfirmationDetail}
                      onToggle={(task, company, checked) => toggleScheduleTask("contabil", "Contabilidade", task, company, checked)}
                      onToggleAll={(task, checked) => toggleScheduleTaskAll("contabil", "Contabilidade", task, checked)}
                      onToggleCompanyAll={(company, checked) => toggleScheduleCompanyAll("contabil", "Contabilidade", accountingScheduleTasks, company, checked)}
                    />
                  </div>
                ) : selectedStage.key === "book" ? (
                  <div className="schedule-selected-module-card">
                    <b>Sem tarefas cadastradas</b>
                    <p>O Book Contábil ainda não participa do cálculo do cronograma. O progresso será habilitado quando as tarefas do módulo forem incluídas.</p>
                  </div>
                ) : (
                  <div className="schedule-selected-module-card">
                    <b>Sem tarefas cadastradas</b>
                    <p>O {selectedStage.name} ainda não participa do cálculo do cronograma. O progresso será habilitado quando as tarefas do módulo forem incluídas.</p>
                  </div>
                )}
              </>
            );
          })()}
        </div>
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
    fiscal: "Módulo Fiscal",
    folha: "Módulo Folha de Pagamento",
    contabil: "Módulo Contábil",
    book: "Book Contábil",
  };
  const moduleLabel = (modulo: string) => {
    if (modulo.startsWith("financeiro:")) {
      const [, taskId, companyCode] = modulo.split(":");
      const task = financialScheduleTasks.find((item) => item.id === taskId);
      return `${task?.label ?? "Item do Módulo Financeiro"}${companyCode ? ` · Coligada ${companyCode}` : ""}`;
    }
    if (modulo.startsWith("contabil:")) {
      const [, taskId, companyCode] = modulo.split(":");
      const task = accountingScheduleTasks.find((item) => item.id === taskId);
      return `${task?.label ?? "Item do Módulo Contábil"}${companyCode ? ` · Coligada ${companyCode}` : ""}`;
    }
    if (modulo.startsWith("folha:")) {
      const [, taskId, companyCode] = modulo.split(":");
      const task = payrollScheduleTasks.find((item) => item.id === taskId);
      return `${task?.label ?? "Item do Módulo Folha de Pagamento"}${companyCode ? ` · Coligada ${companyCode}` : ""}`;
    }
    if (modulo.startsWith("fiscal:")) {
      const [, taskId, companyCode] = modulo.split(":");
      const task = fiscalScheduleTasks.find((item) => item.id === taskId);
      return `${task?.label ?? "Item do Módulo Fiscal"}${companyCode ? ` · Coligada ${companyCode}` : ""}`;
    }
    if (modulo.startsWith("book:")) {
      const [, taskId, companyCode] = modulo.split(":");
      const task = bookScheduleTasks.find((item) => item.id === taskId);
      return `${task?.label ?? "Item do Book Contábil"}${companyCode ? ` · Coligada ${companyCode}` : ""}`;
    }
    return moduleNames[modulo] ?? modulo;
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
                <td><b>{moduleLabel(row.modulo)}</b></td>
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

function formatShortDate(date: Date) {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
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
  const selectedAccountId = accountId || accounts[0]?.id || "";
  const [initial, setInitial] = useState(0);
  const [final, setFinal] = useState(0);
  const [carry, setCarry] = useState(false);
  useEffect(() => {
    if (!selectedAccountId) return;
    (async () => {
      const current = await supabase
        .from("saldos_bancarios")
        .select("saldo_inicial,saldo_final,fixar_mes_seguinte")
        .eq("conta_bancaria_id", selectedAccountId)
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
        .eq("conta_bancaria_id", selectedAccountId)
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
  }, [selectedAccountId, competence, onNotice]);
  async function save() {
    const { error } = await supabase
      .from("saldos_bancarios")
      .upsert(
        {
          conta_bancaria_id: selectedAccountId,
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
            value={selectedAccountId}
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
        disabled={!canWrite || !companyId || !selectedAccountId}
        onClick={save}
      >
        <Save />
        Salvar saldos
      </button>
    </section>
  );
}
