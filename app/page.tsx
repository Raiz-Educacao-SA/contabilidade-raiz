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
import IntercompanyAnalysis from "@/app/intercompany-analysis";
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
    title: "ConciliaÃ§Ã£o BancÃ¡ria",
    description: "Extratos, saldos e lanÃ§amentos contÃ¡beis em um Ãºnico fluxo.",
    icon: Landmark,
  },
  emprestimos: {
    title: "ConciliaÃ§Ã£o de EmprÃ©stimos",
    description:
      "Contratos, parcelas, juros e saldos de emprÃ©stimos por empresa.",
    icon: HandCoins,
  },
  parcelamentos: {
    title: "ConciliaÃ§Ã£o de Parcelamentos",
    description: "Parcelamentos fiscais e financeiros, vencimentos e baixas.",
    icon: ReceiptText,
  },
  receita: {
    title: "ConciliaÃ§Ã£o de Receita",
    description:
      "Receitas reconhecidas, recebimentos, baixas e diferenÃ§as por empresa.",
    icon: TrendingUp,
  },
  compras: {
    title: "Compras",
    description:
      "SolicitaÃ§Ãµes, pedidos, fornecedores e acompanhamento das aquisiÃ§Ãµes.",
    icon: ShoppingCart,
  },
  folha: {
    title: "Folha de Pagamento",
    description:
      "ConferÃªncias, encargos, provisÃµes e rotinas da folha de pagamento.",
    icon: UsersRound,
  },
  contabil: {
    title: "ContÃ¡bil",
    description:
      "LanÃ§amentos, anÃ¡lises, integraÃ§Ãµes e conferÃªncias das rotinas contÃ¡beis.",
    icon: BookText,
  },
  book: {
    title: "Book ContÃ¡bil",
    description:
      "ConsolidaÃ§Ã£o dos mÃ³dulos e visÃ£o final para realizaÃ§Ã£o do fechamento contÃ¡bil.",
    icon: BookOpenCheck,
  },
  cronograma: {
    title: "Cronograma Fechamento",
    description:
      "OrganizaÃ§Ã£o das etapas, responsÃ¡veis, prazos e andamento do fechamento contÃ¡bil.",
    icon: CalendarDays,
  },
} as const;

const areas = {
  financeiro: {
    title: "MÃ³dulo Financeiro",
    description:
      "ConciliaÃ§Ãµes bancÃ¡rias, receitas, emprÃ©stimos, parcelamentos e controles financeiros.",
    icon: WalletCards,
  },
  compras: { ...modules.compras, title: "MÃ³dulo Compras" },
  folha: { ...modules.folha, title: "MÃ³dulo Folha de Pagamento" },
  contabil: { ...modules.contabil, title: "MÃ³dulo ContÃ¡bil" },
  book: { ...modules.book, title: "MÃ³dulo Book ContÃ¡bil" },
  cronograma: { ...modules.cronograma, title: "Cronograma Fechamento" },
} as const;

const months = [
  "Janeiro",
  "Fevereiro",
  "MarÃ§o",
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
        ...(userProfiles.some((profile) => profile === "contabil" || profile === "contabilidade" || profile === "contÃ¡bil") ? ["contabil" as Area, "book" as Area] : []),
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
    if (error) setNotice("A data foi alterada nesta tela, mas nÃ£o pÃ´de ser compartilhada com os demais setores.");
  }

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setSession(data.session);
      if (error)
        setNotice(
          "Sua autenticaÃ§Ã£o nÃ£o pÃ´de ser confirmada. Entre novamente para continuar.",
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
        setNotice("NÃ£o foi possÃ­vel carregar as empresas vinculadas. Atualize a pÃ¡gina para tentar novamente.");
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
      setNotice("NÃ£o foi possÃ­vel entrar. Confira o e-mail e a senha.");
  }
  async function readAccounting(file?: File) {
    if (!file) return;
    try {
      setAccounting(await parseAccounting(await file.arrayBuffer()));
      setNotice("Planilha contÃ¡bil carregada.");
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
        "Extrato carregado. A conta serÃ¡ identificada automaticamente.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  function run() {
    if (!bank.length || !accounting.length)
      return setNotice("Envie a planilha contÃ¡bil e o extrato bancÃ¡rio.");
    if (!detectedAccount || !filteredAccounting.length)
      return setNotice(
        `NÃ£o foi possÃ­vel identificar automaticamente a conta do extrato${bankMetadata.account ? ` (${bankMetadata.account})` : ""} na planilha contÃ¡bil.`,
      );
    setResults(
      reconcile(bank, filteredAccounting, toleranceDays, toleranceValue),
    );
    setNotice(
      `ConciliaÃ§Ã£o concluÃ­da na conta ${detectedAccount.code} â€” ${detectedAccount.name}.`,
    );
  }
  function pinResult() {
    if (!results.length || !detectedAccount) return;
    setPinned((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        bankName,
        bankAccount: bankMetadata.account,×MyêÚ$z{-®éÜj×÷7ãàĞ¢Ç7â6Æ74æÖSÒ&ÖöGVÆRÖ6÷’#àĞ¢Æ#ç¶—FVÒçF—FÆWÓÂö#àĞ¢Ç6ÖÆÃç¶—FVÒæFW67&—F–öçÓÂ÷6ÖÆÃàĞ¢Â÷7ãàĞ¢Ç7â6Æ74æÖSÒ&ÖöGVÆRÖVçFW"#àĞ¢6W76"Ä'&÷tÆVgE&–v‡BóàĞ¢Â÷7ãàĞ¢Âö'WGFöãàĞ¢“°Ğ¢Ò—ĞĞ¢Â÷6V7F–öãàĞ¢ÂöÖ–ãàĞ¢“°§Ğ §G—R66†VGVÆT6öæf—&ÖF–öâÒ°¢ÖöGVÆó¢7G&–æs°¢6WF÷#¢7G&–æs°¢7FGW3¢'VæFVçFR"Â&6öæ6ÇV–Fò#°¢6öæf—&ÖFõöVÖ–Ã¢7G&–æs°¢6öæf—&ÖFõöVÓ¢7G&–æs°§Ó° §G—R66†VGVÆT†—7F÷'•&÷rÒ°¢–C¢7G&–æs°¢6ö×WFVæ6–¢7G&–æs°¢ÖöGVÆó¢7G&–æs°¢6WF÷#¢7G&–æs°¢6ó¢&Æ–&W&Fò"Â'&V&W'Fò#°¢W7V&–õöVÖ–Ã¢7G&–æs°¢7&–FõöVÓ¢7G&–æs°§Ó° ¦gVæ7F–öâ6Æ÷6–æu66†VGVÆR‡²–V"ÂÖöçF‚Â6Æ÷6–ætFFRÂW6W$–BÂW6W$VÖ–ÂÂW6W%&öf–ÆW2Ó¢²–V#¢çVÖ&W#²ÖöçFƒ¢çVÖ&W#²6Æ÷6–ætFFS¢7G&–æs²W6W$–C¢7G&–æs²W6W$VÖ–Ã¢7G&–æs²W6W%&öf–ÆW3¢7G&–æuµÒÒ’°¢6öç7B66†VGVÆT6ö×WFVæ6RÒG·–V'ÒÒGµ7G&–ær†ÖöçF‚’çE7F'Bƒ"Â#"—Ö°¢6öç7B¶6öæf—&ÖF–öç2Â6WD6öæf—&ÖF–öç5ÒÒW6U7FFSÅ66†VGVÆT6öæf—&ÖF–öåµÓâ…µÒ“°¢6öç7B·66†VGVÆTÆöF–ærÂ6WE66†VGVÆTÆöF–æuÒÒW6U7FFR‡G'VR“°¢6öç7B¶6öæf—&Ö–ætÖöGVÆRÂ6WD6öæf—&Ö–ætÖöGVÆUÒÒW6U7FFR‚""“°¢6öç7B·66†VGVÆTW'&÷"Â6WE66†VGVÆTW'&÷%ÒÒW6U7FFR‚""“°¢6öç7BÖöçF„VæBÒÆ7D'W6–æW74F’‡–V"ÂÖöçF‚“°¢6öç7B7FvW2Ò°¢²¶W“¢&6ö×&2"ÂæÖS¢$Ü;6GVÆò6ö×&2"Â6V7F÷#¢$6ö×&2"ÂFWF–Ã¢$f–æÆ—¦"ò–çWBFRæ÷F2"ÂFVFÆ–æS¢ÖöçF„VæBÂÖ–ÆW7FöæS¢,9¦ÇF–ÖòF–;§F–Â"Â–6öã¢6†÷–æt6'BÒÀ¢²¶W“¢&f–ææ6V—&ò"ÂæÖS¢$Ü;6GVÆòf–ææ6V—&ò"Â6V7F÷#¢$f–ææ6V—&ò"ÂFWF–Ã¢$6öæ6ÇV—"6öæ6–Æ–:|;VW2RVæL:¦æ6–2f–ææ6V—&2"ÂFVFÆ–æS¢FD'W6–æW74F—2†ÖöçF„VæBÂ2’ÂÖ–ÆW7FöæS¢$B³2"Â–6öã¢vÆÆWD6&G2ÒÀ¢²¶W“¢&föÆ†"ÂæÖS¢$Ü;6GVÆòföÆ†FRvÖVçFò"Â6V7F÷#¢$föÆ†FRvÖVçFò"ÂFWF–Ã¢$6öæfW&—"föÆ†Â&÷f—<;VW2RVæ6&v÷2"ÂFVFÆ–æS¢FD'W6–æW74F—2†ÖöçF„VæBÂR’ÂÖ–ÆW7FöæS¢$B³R"Â–6öã¢W6W'5&÷VæBÒÀ¢²¶W“¢&6öçF&–Â"ÂæÖS¢$Ü;6GVÆò6öçL:&–Â"Â6V7F÷#¢$6öçF&–Æ–FFR"ÂFWF–Ã¢$6öç6öÆ–F"ì:Æ—6W2R6öæ6ÇV—"òfV6†ÖVçFò"ÂFVFÆ–æS¢6Æ÷6–ætFFRòæWrFFR†G¶6Æ÷6–ætFFWÕC#££’¢FD'W6–æW74F—2†ÖöçF„VæBÂ’ÂÖ–ÆW7FöæS¢$FFFVf–æ–F"Â–6öã¢&ööµFW‡BÒÀ¢²¶W“¢&&öö²"ÂæÖS¢$&öö²6öçL:&–Â"Â6V7F÷#¢$6öçF&–Æ–FFR"ÂFWF–Ã¢$F—7öæ–&–Æ—¦"ò&öGWFòf–æÂFòfV6†ÖVçFò"ÂFVFÆ–æS¢6Æ÷6–ætFFRòæWrFFR†G¶6Æ÷6–ætFFWÕC#££’¢FD'W6–æW74F—2†ÖöçF„VæBÂ’ÂÖ–ÆW7FöæS¢$VçG&Vvf–æÂ"Â–6öã¢&öö´÷Vä6†V6²ÒÀ¢Ó°¢6öç7B7F'BÒæWrFFR‡–V"ÂÖöçF‚Â“°¢6öç7Bf–æÄFVFÆ–æRÒ7FvW2æB‚Ó’æFVFÆ–æS°¢6öç7BVÆ6VBÒFöF’ævWEF–ÖR‚’Ò7F'BævWEF–ÖR‚“°¢6öç7BGW&F–öâÒÖF‚æÖ‚ƒÂf–æÄFVFÆ–æRævWEF–ÖR‚’Ò7F'BævWEF–ÖR‚’“°¢6öç7B÷fW&ÆÅ&öw&W72ÒÖF‚æÖ‚ƒÂÖF‚æÖ–âƒÂÖF‚ç&÷VæB‚†VÆ6VBòGW&F–öâ’¢’’“°¢6öç7Bf÷&ÖDFFRÒ†FFS¢FFR’ÓâFFRçFôÆö6ÆTFFU7G&–ær‚'BÔ%""Â²F“¢#"ÖF–v—B"ÂÖöçFƒ¢#"ÖF–v—B"Ò“° ¢W6TVffV7B‚‚’Óâ°¢ÆWB7F—fRÒG'VS°¢6WE66†VGVÆTÆöF–ær‡G'VR“°¢6WE66†VGVÆTW'&÷"‚""“°¢fö–B7W&6P¢æg&öÒ‚&7&öæöw&ÖöVçG&Vv2"¢ç6VÆV7B‚&ÖöGVÆòÂ6WF÷"Â7FGW2Â6öæf—&ÖFõöVÖ–ÂÂ6öæf—&ÖFõöVÒ"¢æW‚&6ö×WFVæ6–"Â66†VGVÆT6ö×WFVæ6R¢çF†Vâ‚‡²FFÂW'&÷"Ò’Óâ°¢–b‚7F—fR’&WGW&ã°¢–b†W'&÷"’6WE66†VGVÆTW'&÷"‚$ì:6òfö’÷7<:×fVÂ6'&Vv"26öæf—&Ö:|;VW26ö×'F–Æ†F2â"“°¢VÇ6R6WD6öæf—&ÖF–öç2‚†FFóòµÒ’266†VGVÆT6öæf—&ÖF–öåµÒ“°¢6WE66†VGVÆTÆöF–ær†fÇ6R“°¢Ò“°¢&WGW&â‚’Óâ²7F—fRÒfÇ6S²Ó°¢ÒÂ·66†VGVÆT6ö×WFVæ6UÒ“° ¢7–æ2gVæ7F–öâFövvÆU7FvR‡7FvS¢‡G—Vöb7FvW2•¶çVÖ&W%ÒÂ6†V6¶VC¢&ööÆVâ’°¢6WD6öæf—&Ö–ætÖöGVÆR‡7FvRæ¶W’“°¢6WE66†VGVÆTW'&÷"‚""“°¢6öç7B6öæf—&ÖVDBÒæWrFFR‚’çFô•4õ7G&–ær‚“°¢6öç7B²W'&÷"ÒÒv—B7W&6Ræg&öÒ‚&7&öæöw&ÖöVçG&Vv2"’çW6W'B‡°¢6ö×WFVæ6–¢66†VGVÆT6ö×WFVæ6RÀ¢ÖöGVÆó¢7FvRæ¶W’À¢6WF÷#¢7FvRç6V7F÷"À¢7FGW3¢6†V6¶VBò&6öæ6ÇV–Fò"¢'VæFVçFR"À¢6öæf—&ÖFõ÷÷#¢W6W$–BÀ¢6öæf—&ÖFõöVÖ–Ã¢W6W$VÖ–ÂÀ¢6öæf—&ÖFõöVÓ¢6öæf—&ÖVDBÀ¢ÒÂ²öä6öæfÆ–7C¢&6ö×WFVæ6–ÆÖöGVÆò"Ò“°¢–b†W'&÷"’°¢6WE66†VGVÆTW'&÷"‚$òô²ì:6ò;FFR6W"&Vv—7G&FòâFVçFRæ÷fÖVçFRâ"“°¢ÒVÇ6R°¢6öç7B²W'&÷#¢†—7F÷'”W'&÷"ÒÒv—B7W&6Ræg&öÒ‚&7&öæöw&Öö†—7F÷&–6ò"’æ–ç6W'B‡°¢6ö×WFVæ6–¢66†VGVÆT6ö×WFVæ6RÀ¢ÖöGVÆó¢7FvRæ¶W’À¢6WF÷#¢7FvRç6V7F÷"À¢6ó¢6†V6¶VBò&Æ–&W&Fò"¢'&V&W'Fò"À¢W7V&–õö–C¢W6W$–BÀ¢W7V&–õöVÖ–Ã¢W6W$VÖ–ÂÀ¢Ò“°¢–b††—7F÷'”W'&÷"’6WE66†VGVÆTW'&÷"‚$òô²fö’GVÆ—¦FòÂÖ2ò†—7L;7&–6òì:6ò;FFR6W"&Vv—7G&Fòâ"“°¢6WD6öæf—&ÖF–öç2‚†7W'&VçB’Óâ°¢ââæ7W'&VçBæf–ÇFW"‚†—FVÒ’Óâ—FVÒæÖöGVÆòÓÒ7FvRæ¶W’’À¢²ÖöGVÆó¢7FvRæ¶W’Â6WF÷#¢7FvRç6V7F÷"Â7FGW3¢6†V6¶VBò&6öæ6ÇV–Fò"¢'VæFVçFR"Â6öæf—&ÖFõöVÖ–Ã¢W6W$VÖ–ÂÂ6öæf—&ÖFõöVÓ¢6öæf—&ÖVDBÒÀ¢Ò“°¢Ğ¢6WD6öæf—&Ö–ætÖöGVÆR‚""“°¢Ğ ¢&WGW&â€¢Ç6V7F–öâ6Æ74æÖSÒ&6Æ÷6–ær×66†VGVÆR#à¢ÆF—b6Æ74æÖSÒ'66†VGVÆRÖ÷fW'f–Wr#à¢ÆF—cà¢Ç7ãå$ô¤\8|84òDòdT4„ÔTåDóÂ÷7ãà¢Æ#ç¶ÖöçF‡5¶ÖöçF‚Ò×ÒFR·–V'ÓÂö#à¢Ç6ÖÆÃåf—<:6òvW&ÂFò&ö6W76òÂ6VÒ6W&:|:6ò÷"V×&W6ãÂ÷6ÖÆÃà¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ'66†VGVÆR×v–æF÷r#à¢Ç7ãä¦æVÆ&ö¦WFFÂ÷7ãà¢Æ#ç¶f÷&ÖDFFR‡7F'B—Ò¶f÷&ÖDFFR†f–æÄFVFÆ–æR—ÓÂö#à¢Ç6ÖÆÃä6ö×&2L:’ò;¦ÇF–ÖòF–;§F–Â+r6öçF&–Æ–FFRL:’B³Â÷6ÖÆÃà¢ÂöF—cà¢ÂöF—cà ¢ÆF—b6Æ74æÖSÒ'66†VGVÆRÖÖ7FW"ÖÆ–æR#à¢Ç7â7G–ÆS×·²v–GFƒ¢G¶÷fW&ÆÅ&öw&W77ÒV×Òóà¢ÂöF—cà ¢·66†VGVÆTW'&÷"bbÆF—b6Æ74æÖSÒ'66†VGVÆRÖW'&÷"#ç·66†VGVÆTW'&÷'ÓÂöF—cçĞ ¢ÆF—b6Æ74æÖSÒ'66†VGVÆR×7FvW2#à¢·7FvW2æÖ‚‡7FvRÂ–æFW‚’Óâ°¢6öç7B–6öâÒ7FvRæ–6öã°¢6öç7B7FvTGW&F–öâÒÖF‚æÖ‚ƒÂ7FvRæFVFÆ–æRævWEF–ÖR‚’Ò7F'BævWEF–ÖR‚’“°¢6öç7B&öw&W72ÒÖF‚æÖ‚ƒÂÖF‚æÖ–âƒÂÖF‚ç&÷VæB‚†VÆ6VBò7FvTGW&F–öâ’¢’’“°¢6öç7B6öæf—&ÖF–öâÒ6öæf—&ÖF–öç2æf–æB‚†—FVÒ’Óâ—FVÒæÖöGVÆòÓÓÒ7FvRæ¶W’bb—FVÒç7FGW2ÓÓÒ&6öæ6ÇV–Fò"“°¢6öç7B6ä6öæf—&ÒÒW6W%&öf–ÆW2æ–æ6ÇVFW2‚&FÖ–æ—7G&F÷""’ÇÂ€¢7FvRç6V7F÷"ÓÓÒ$f–ææ6V—&ò"òW6W%&öf–ÆW2æ–æ6ÇVFW2‚&f–ææ6V—&ò"’ ¢7FvRç6V7F÷"ÓÓÒ$6ö×&2"òW6W%&öf–ÆW2æ–æ6ÇVFW2‚&6ö×&2"’ ¢7FvRç6V7F÷"ÓÓÒ$föÆ†FRvÖVçFò"òW6W%&öf–ÆW2ç6öÖR‚‡&öf–ÆR’Óâ&öf–ÆRÓÓÒ&föÆ†"ÇÂ&öf–ÆRÓÓÒ&föÆ†FRvÖVçFò"’ ¢W6W%&öf–ÆW2ç6öÖR‚‡&öf–ÆR’Óâ&öf–ÆRÓÓÒ&6öçF&–Â"ÇÂ&öf–ÆRÓÓÒ&6öçF&–Æ–FFR"ÇÂ&öf–ÆRÓÓÒ&6öçL:&–Â"¢“°¢&WGW&â€¢Æ'F–6ÆR¶W“×·7FvRææÖWÒ6Æ74æÖS×¶G¶–æFW‚ÓÓÒ7FvW2æÆVæwF‚Òò'66†VGVÆRÖf–æÂ×7FvR"¢"'ÒG¶6öæf—&ÖF–öâò'66†VGVÆR×7FvRÖFöæR"¢"'ÖÓà¢Ç7â6Æ74æÖSÒ'66†VGVÆR×7FvRÖ–6öâ#ãÄ–6öâóãÂ÷7ãà¢ÆF—b6Æ74æÖSÒ'66†VGVÆR×7FvRÖ6÷’#à¢ÆF—cãÆ#ç·7FvRææÖWÓÂö#ãÇ7ãå&W7öç<:fVÃ¢·7FvRç6V7F÷'Ò+r·7FvRæFWF–ÇÓÂ÷7ããÂöF—cà¢ÆF—b6Æ74æÖSÒ'66†VGVÆR×&öw&W72#ãÇ7â7G–ÆS×·²v–GFƒ¢G·&öw&W77ÒV×ÒóãÂöF—cà¢Ç6ÖÆÃç¶6öæf—&ÖF–öà¢òô²÷"G¶6öæf—&ÖF–öâæ6öæf—&ÖFõöVÖ–ÇÒVÒG¶æWrFFR†6öæf—&ÖF–öâæ6öæf—&ÖFõöVÒ’çFôÆö6ÆU7G&–ær‚'BÔ%""—Ö ¢¢&¦òFV6÷'&–Fó¢G·&öw&W77ÒVÓÂ÷6ÖÆÃà¢ÂöF—cà¢ÆF—b6Æ74æÖSÒ'66†VGVÆRÖFVFÆ–æR#ãÇ7ãç·7FvRæÖ–ÆW7FöæWÓÂ÷7ããÆ#ç¶f÷&ÖDFFR‡7FvRæFVFÆ–æR—ÓÂö#ãÂöF—cà¢ÆÆ&VÀ¢6Æ74æÖS×¶66†VGVÆRÖö²G²6ä6öæf—&Òò&—2ÖF—6&ÆVB"¢"'ÖĞ¢F—FÆS×¶6ä6öæf—&Òò$Ö&6"÷RFW6Ö&6"VçG&VvFW7FRÜ;6GVÆò"¢Æ–&W&:|:6òW†6ÇW6—fFò6WF÷"G·7FvRç6V7F÷'ÖĞ¢à¢Æ–çW@¢G—SÒ&6†V6¶&÷‚ ¢6†V6¶VC×´&ööÆVâ†6öæf—&ÖF–öâ—Ğ¢F—6&ÆVC×²6ä6öæf—&ÒÇÂ66†VGVÆTÆöF–ærÇÂ6öæf—&Ö–ætÖöGVÆRÓÓÒ7FvRæ¶W—Ğ¢öä6†ævS×²†WfVçB’Óâfö–BFövvÆU7FvR‡7FvRÂWfVçBçF&vWBæ6†V6¶VB—Ğ¢óà¢Ç7ãç¶6öæf—&Ö–ætÖöGVÆRÓÓÒ7FvRæ¶W’ò%6ÇfæFòâââ"¢$ô²'ÓÂ÷7ãà¢ÂöÆ&VÃà¢Âö'F–6ÆSà¢“°¢Ò—Ğ¢ÂöF—cà¢Â÷6V7F–öãà¢“°§Ğ ¦gVæ7F–öâ6Æ÷6–æt†—7F÷'’‚’°¢6öç7B·&÷w2Â6WE&÷w5ÒÒW6U7FFSÅ66†VGVÆT†—7F÷'•&÷uµÓâ…µÒ“°¢6öç7B¶ÆöF–ærÂ6WDÆöF–æuÒÒW6U7FFR‡G'VR“°¢6öç7B¶W'&÷"Â6WDW'&÷%ÒÒW6U7FFR‚""“° ¢W6TVffV7B‚‚’Óâ°¢ÆWB7F—fRÒG'VS°¢fö–B7W&6P¢æg&öÒ‚&7&öæöw&Öö†—7F÷&–6ò"¢ç6VÆV7B‚&–BÂ6ö×WFVæ6–ÂÖöGVÆòÂ6WF÷"Â6òÂW7V&–õöVÖ–ÂÂ7&–FõöVÒ"¢æ÷&FW"‚&7&–FõöVÒ"Â²66VæF–æs¢fÇ6RÒ¢æÆ–Ö—Bƒ3¢çF†Vâ‚‡²FFÂW'&÷#¢ÆöDW'&÷"Ò’Óâ°¢–b‚7F—fR’&WGW&ã°¢–b†ÆöDW'&÷"’6WDW'&÷"‚$ì:6òfö’÷7<:×fVÂ6'&Vv"ò†—7L;7&–6òFRVçG&Vv2â"“°¢VÇ6R6WE&÷w2‚†FFóòµÒ’266†VGVÆT†—7F÷'•&÷uµÒ“°¢6WDÆöF–ær†fÇ6R“°¢Ò“°¢&WGW&â‚’Óâ²7F—fRÒfÇ6S²Ó°¢ÒÂµÒ“° ¢6öç7BÖöGVÆTæÖW3¢&V6÷&CÇ7G&–ærÂ7G&–æsâÒ°¢6ö×&3¢$Ü;6GVÆò6ö×&2"À¢f–ææ6V—&ó¢$Ü;6GVÆòf–ææ6V—&ò"À¢föÆ†¢$Ü;6GVÆòföÆ†FRvÖVçFò"À¢6öçF&–Ã¢$Ü;6GVÆò6öçL:&–Â"À¢&öö³¢$&öö²6öçL:&–Â"À¢Ó° ¢&WGW&â€¢Ç6V7F–öâ6Æ74æÖSÒ&6Æ÷6–ærÖ†—7F÷'’#à¢Æ†VFW#à¢ÆF—cãÇ7ãä5$ôäôu$ÔDRdT4„ÔTåDóÂ÷7ããÆƒ#ä†—7L;7&–6òFRVçG&Vv3Âöƒ#ãÂöF—cà¢Ç6ÖÆÃç·&÷w2æÆVæwF‡ÒÖ÷f–ÖVçF:|:6òŒ;VW2“Â÷6ÖÆÃà¢Âö†VFW#à¢¶ÆöF–æròÇ6Æ74æÖSÒ&†—7F÷'’ÖÖW76vR#ä6'&VvæFò†—7L;7&–6òââãÂ÷â¢W'&÷"òÇ6Æ74æÖSÒ'66†VGVÆRÖW'&÷"#ç¶W'&÷'ÓÂ÷â¢&÷w2æÆVæwF‚ÓÓÒò€¢Ç6Æ74æÖSÒ&†—7F÷'’ÖÖW76vR#äæVæ‡VÖVçG&Vvfö’&Vv—7G&F–æFãÂ÷à¢’¢€¢ÆF—b6Æ74æÖSÒ&†—7F÷'’×F&ÆR×w&#à¢ÇF&ÆR6Æ74æÖSÒ&†—7F÷'’×F&ÆR#à¢ÇF†VCãÇG#ãÇFƒä6ö×WL:¦æ6–Â÷FƒãÇFƒäÜ;6GVÆóÂ÷FƒãÇFƒå6WF÷#Â÷FƒãÇFƒä:|:6óÂ÷FƒãÇFƒå&W7öç<:fVÃÂ÷FƒãÇFƒäFFR†÷&Â÷FƒãÂ÷G#ãÂ÷F†VCà¢ÇF&öG“ç·&÷w2æÖ‚‡&÷r’Óâ€¢ÇG"¶W“×·&÷ræ–GÓà¢ÇFCç·&÷ræ6ö×WFVæ6–ç6Æ–6RƒRÂr—Ò÷·&÷ræ6ö×WFVæ6–ç6Æ–6RƒÂB—ÓÂ÷FCà¢ÇFCãÆ#ç¶ÖöGVÆTæÖW5·&÷ræÖöGVÆõÒóò&÷ræÖöGVÆ÷ÓÂö#ãÂ÷FCà¢ÇFCç·&÷rç6WF÷'ÓÂ÷FCà¢ÇFCãÇ7â6Æ74æÖS×¶†—7F÷'’Ö7F–öâG·&÷ræ6÷ÖÓç·&÷ræ6òÓÓÒ&Æ–&W&Fò"ò$Æ–&W&÷R"¢%&V'&—R'ÓÂ÷7ããÂ÷FCà¢ÇFCç·&÷rçW7V&–õöVÖ–ÇÓÂ÷FCà¢ÇFCç¶æWrFFR‡&÷ræ7&–FõöVÒ’çFôÆö6ÆU7G&–ær‚'BÔ%""—ÓÂ÷FCà¢Â÷G#à¢’—ÓÂ÷F&öG“à¢Â÷F&ÆSà¢ÂöF—cà¢—Ğ¢Â÷6V7F–öãà¢“°§Ğ ¦gVæ7F–öâÆ7D'W6–æW74F’‡–V#¢çVÖ&W"ÂÖöçFƒ¢çVÖ&W"’°¢6öç7BFFRÒæWrFFR‡–V"ÂÖöçF‚Â“°¢v†–ÆR†FFRævWDF’‚’ÓÓÒÇÂFFRævWDF’‚’ÓÓÒb’FFRç6WDFFR†FFRævWDFFR‚’Ò“°¢&WGW&âFFS°§Ğ ¦gVæ7F–öâFD'W6–æW74F—2†FFS¢FFRÂÖ÷VçC¢çVÖ&W"’°¢6öç7B&W7VÇBÒæWrFFR†FFR“°¢ÆWBFFVBÒ°¢v†–ÆR†FFVBÂÖ÷VçB’°¢&W7VÇBç6WDFFR‡&W7VÇBævWDFFR‚’²“°¢–b‡&W7VÇBævWDF’‚’ÓÒbb&W7VÇBævWDF’‚’ÓÒb’FFVB³Ò°¢Ğ¢&WGW&â&W7VÇC°§Ğ ¦gVæ7F–öâf÷&ÖDFFT–çWB†FFS¢FFR’°¢&WGW&âG¶FFRævWDgVÆÅ–V"‚—ÒÒGµ7G&–ær†FFRævWDÖöçF‚‚’²’çE7F'Bƒ"Â#"—ÒÒGµ7G&–ær†FFRævWDFFR‚’’çE7F'Bƒ"Â#"—Ö°§Ğ ¦gVæ7F–öâ&Wf–÷W46ö×WFVæ6R†6ö×WFVæ6S¢7G&–ær’°¢6öç7B·–V"ÂÖöçF…ÒÒ6ö×WFVæ6Rç7Æ—B‚"Ò"’æÖ„çVÖ&W"“°Ğ¢6öç7B&Wf–÷W2ÒæWrFFR„FFRåUD2‡–V"ÂÖöçF‚Ò"Â’“°Ğ¢&WGW&âG·&Wf–÷W2ævWEUD4gVÆÅ–V"‚—ÒÒGµ7G&–ær‡&Wf–÷W2ævWEUD4ÖöçF‚‚’²’çE7F'Bƒ"Â#"—Ö°Ğ§ĞĞ Ğ¦gVæ7F–öâ&Ææ6UæVÂ‡°Ğ¢6ö×ç”–BÀĞ¢6ö×WFVæ6RÀĞ¢66÷VçG2ÀĞ¢6åw&—FRÀĞ¢W6W$–BÀĞ¢öäæ÷F–6RÀĞ§Ó¢°Ğ¢6ö×ç”–C¢7G&–æs°Ğ¢6ö×WFVæ6S¢7G&–æs°Ğ¢66÷VçG3¢66÷VçEµÓ°Ğ¢6åw&—FS¢&ööÆVã°Ğ¢W6W$–C¢7G&–æs°Ğ¢öäæ÷F–6S¢‡fÇVS¢7G&–ær’Óâfö–C°Ğ§Ò’°Ğ¢6öç7B¶66÷VçD–BÂ6WD66÷VçD–EÒÒW6U7FFR‚""“°Ğ¢6öç7B¶–æ—F–ÂÂ6WD–æ—F–ÅÒÒW6U7FFRƒ“°Ğ¢6öç7B¶f–æÂÂ6WDf–æÅÒÒW6U7FFRƒ“°Ğ¢6öç7B¶6''’Â6WD6''•ÒÒW6U7FFR†fÇ6R“°Ğ¢W6TVffV7B‚‚’Óâ°Ğ¢–b‚66÷VçD–Bbb66÷VçG5³Ò’6WD66÷VçD–B†66÷VçG5³Òæ–B“°Ğ¢ÒÂ¶66÷VçG2Â66÷VçD–EÒ“°Ğ¢W6TVffV7B‚‚’Óâ°Ğ¢–b‚66÷VçD–B’&WGW&ã°Ğ¢†7–æ2‚’Óâ°Ğ¢6öç7B7W'&VçBÒv—B7W&6PĞ¢æg&öÒ‚'6ÆF÷5ö&æ6&–÷2"Ğ¢ç6VÆV7B‚'6ÆFõö–æ–6–ÂÇ6ÆFõöf–æÂÆf—†%öÖW5÷6VwV–çFR"Ğ¢æW‚&6öçFö&æ6&–ö–B"Â66÷VçD–BĞ¢æW‚&6ö×WFVæ6–"Â6ö×WFVæ6RĞ¢æÖ–&U6–ævÆR‚“°Ğ¢–b†7W'&VçBæW'&÷"’&WGW&âöäæ÷F–6R†7W'&VçBæW'&÷"æÖW76vR“°Ğ¢–b†7W'&VçBæFF’°Ğ¢6WD–æ—F–Â„çVÖ&W"†7W'&VçBæFFç6ÆFõö–æ–6–Â’“°Ğ¢6WDf–æÂ„çVÖ&W"†7W'&VçBæFFç6ÆFõöf–æÂ’“°Ğ¢6WD6''’„&ööÆVâ†7W'&VçBæFFæf—†%öÖW5÷6VwV–çFR’“°Ğ¢&WGW&ã°Ğ¢ĞĞ¢6öç7B&Wf–÷W2Òv—B7W&6PĞ¢æg&öÒ‚'6ÆF÷5ö&æ6&–÷2"Ğ¢ç6VÆV7B‚'6ÆFõöf–æÂÆf—†%öÖW5÷6VwV–çFR"Ğ¢æW‚&6öçFö&æ6&–ö–B"Â66÷VçD–BĞ¢æW‚&6ö×WFVæ6–"Â&Wf–÷W46ö×WFVæ6R†6ö×WFVæ6R’Ğ¢æÖ–&U6–ævÆR‚“°Ğ¢6WD–æ—F–Â€Ğ¢&Wf–÷W2æFFòæf—†%öÖW5÷6VwV–çFPĞ¢òçVÖ&W"‡&Wf–÷W2æFFç6ÆFõöf–æÂĞ¢¢ÀĞ¢“°Ğ¢6WDf–æÂƒ“°Ğ¢6WD6''’†fÇ6R“°Ğ¢Ò’‚“°Ğ¢ÒÂ¶66÷VçD–BÂ6ö×WFVæ6RÂöäæ÷F–6UÒ“°Ğ¢7–æ2gVæ7F–öâ6fR‚’°Ğ¢6öç7B²W'&÷"ÒÒv—B7W&6PĞ¢æg&öÒ‚'6ÆF÷5ö&æ6&–÷2"Ğ¢çW6W'B€Ğ¢°Ğ¢6öçFö&æ6&–ö–C¢66÷VçD–BÀĞ¢6ö×WFVæ6–¢6ö×WFVæ6RÀĞ¢6ÆFõö–æ–6–Ã¢–æ—F–ÂÀĞ¢6ÆFõöf–æÃ¢f–æÂÀĞ¢f—†%öÖW5÷6VwV–çFS¢6''’ÀĞ¢W7V&–õö–C¢W6W$–BÀĞ¢ÒÀĞ¢²öä6öæfÆ–7C¢&6öçFö&æ6&–ö–BÆ6ö×WFVæ6–"ÒÀĞ¢“°Ğ¢öäæ÷F–6R†W'&÷#òæÖW76vRóò%6ÆF÷2GVÆ—¦F÷2â"“°Ğ¢ĞĞ¢&WGW&â€Ğ¢Ç6V7F–öâ6Æ74æÖSÒ'æVÂ#àĞ¢Æƒ#å6ÆF÷2&æ<:&–÷3Âöƒ#àĞ¢ÆF—b6Æ74æÖSÒ&f÷&ÒÖw&–B#àĞ¢ÆÆ&VÃàĞ¢6öçFĞ¢Ç6VÆV7@Ğ¢fÇVS×¶66÷VçD–GĞĞ¢öä6†ævS×²†R’Óâ6WD66÷VçD–B†RçF&vWBçfÇVR—ĞĞ¢àĞ¢¶66÷VçG2æÖ‚†—FVÒ’Óâ€Ğ¢Æ÷F–öâ¶W“×¶—FVÒæ–GÒfÇVS×¶—FVÒæ–GÓàĞ¢¶—FVÒæ&æ6÷Ò+r¶—FVÒæ6öçFö&æ6&–ĞĞ¢Âö÷F–öãàĞ¢’—ĞĞ¢Â÷6VÆV7CàĞ¢ÂöÆ&VÃàĞ¢ÆÆ&VÃàĞ¢6ÆFò–æ–6–ÀĞ¢Æ–çW@Ğ¢G—SÒ&çVÖ&W" Ğ¢7FWÒ#ã Ğ¢fÇVS×¶–æ—F–ÇĞĞ¢öä6†ævS×²†R’Óâ6WD–æ—F–Â„çVÖ&W"†RçF&vWBçfÇVR’—ĞĞ¢óàĞ¢ÂöÆ&VÃàĞ¢ÆÆ&VÃàĞ¢6ÆFòf–æÀĞ¢Æ–çW@Ğ¢G—SÒ&çVÖ&W" Ğ¢7FWÒ#ã Ğ¢fÇVS×¶f–æÇĞĞ¢öä6†ævS×²†R’Óâ6WDf–æÂ„çVÖ&W"†RçF&vWBçfÇVR’—ĞĞ¢óàĞ¢ÂöÆ&VÃàĞ¢ÆÆ&VÂ6Æ74æÖSÒ&6†V6¶&÷‚#àĞ¢Æ–çW@Ğ¢G—SÒ&6†V6¶&÷‚ Ğ¢6†V6¶VC×¶6''—ĞĞ¢öä6†ævS×²†R’Óâ6WD6''’†RçF&vWBæ6†V6¶VB—ĞĞ¢óàĞ¢f—†"&òÜ:§26VwV–çFPĞ¢ÂöÆ&VÃàĞ¢ÂöF—càĞ¢Æ'WGFöàĞ¢6Æ74æÖSÒ'&–Ö'’ Ğ¢F—6&ÆVC×²6åw&—FRÇÂ6ö×ç”–BÇÂ66÷VçD–GĞĞ¢öä6Æ–6³×·6fWĞĞ¢àĞ¢Å6fRóàĞ¢6Çf"6ÆF÷0Ğ¢Âö'WGFöãàĞ¢Â÷6V7F–öãàĞ¢“°Ğ§ĞĞ