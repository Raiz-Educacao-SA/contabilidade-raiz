"use client";

import { useMemo, useState } from "react";
import {
  BadgeCheck,
  BookOpenCheck,
  Boxes,
  Calculator,
  ClipboardCheck,
  FileBarChart,
  FileSearch,
  Landmark,
  PackageCheck,
  ReceiptText,
  Scale,
} from "lucide-react";
import styles from "./fixed-assets.module.css";

type FixedAssetsProps = {
  companyCode: string;
  companyName: string;
  competence: string;
  canWrite: boolean;
};

type View = "resumo" | "cadastro" | "nota-explicativa" | "calculo" | "conciliacao";

const julyBase = {
  reference: "31/07/2026",
  assets: 584,
  fullyDepreciated: 163,
  cost: 10_309_045.9,
  accumulatedDepreciation: 4_129_935.2,
  bookValue: 6_175_129.57,
  estimatedAnnualDepreciation: 415_000,
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function FixedAssetsPanel({
  companyCode,
  companyName,
  competence,
  canWrite,
}: FixedAssetsProps) {
  const [view, setView] = useState<View>("resumo");
  const competenceLabel = useMemo(() => {
    const [year, month] = competence.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, 1)));
  }, [competence]);

  const navigation = [
    { id: "resumo", label: "Resumo individual", icon: Boxes },
    { id: "cadastro", label: "Cadastro de bens", icon: PackageCheck },
    { id: "nota-explicativa", label: "Nota explicativa", icon: FileBarChart },
    { id: "calculo", label: "Cálculo mensal", icon: Calculator },
    { id: "conciliacao", label: "Conciliação", icon: Scale },
  ] as const;

  return (
    <section className={styles.workspace} data-testid="fixed-assets-module">
      <nav className={styles.tabs} aria-label="Áreas do Ativo Fixo">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? styles.active : ""} onClick={() => setView(id)}>
            <Icon /> {label}
          </button>
        ))}
      </nav>

      {view === "resumo" && (
        <>
          <div className={styles.statusBar}>
            <div><BadgeCheck /><span><b>Base de origem analisada</b><small>Posição patrimonial em {julyBase.reference}</small></span></div>
            <span className={styles.pending}>Carga pendente de homologação</span>
          </div>
          <div className={styles.kpis}>
            <article><span>Bens cadastrados</span><b>{julyBase.assets.toLocaleString("pt-BR")}</b><small>{julyBase.fullyDepreciated} totalmente depreciados</small></article>
            <article><span>Valor de custo</span><b>{currency.format(julyBase.cost)}</b><small>Base da planilha de julho</small></article>
            <article><span>Depreciação acumulada</span><b>{currency.format(julyBase.accumulatedDepreciation)}</b><small>Valor armazenado por bem</small></article>
            <article><span>Saldo contábil</span><b>{currency.format(julyBase.bookValue)}</b><small>Dashboard da planilha</small></article>
          </div>
          <div className={styles.grid}>
            <article className={styles.card}>
              <header><div><span>RESUMO INDIVIDUAL</span><h2>Posição até julho/2026</h2></div><FileSearch /></header>
              <ol className={styles.steps}>
                <li className={styles.done}><b>Planilha de origem analisada</b><small>Cadastro, fórmulas e tabelas auxiliares mapeados.</small></li>
                <li><b>Validar dados e exceções</b><small>Duplicidades, baixas, vida útil e saldos inconsistentes.</small></li>
                <li><b>Conciliar com razão e balancete</b><small>Por conta, filial e posição em 31/07/2026.</small></li>
                <li><b>Homologar saldo inicial</b><small>Bloqueio da posição inicial antes da abertura de agosto.</small></li>
              </ol>
            </article>
            <article className={styles.card}>
              <header><div><span>OPERAÇÃO MENSAL</span><h2>{competenceLabel}</h2></div><ClipboardCheck /></header>
              <div className={styles.flow}>
                <div><ReceiptText /><span><b>Compras</b><small>Aquisições candidatas</small></span></div>
                <div><FileSearch /><span><b>Zeev</b><small>Abertura e validação da NF</small></span></div>
                <div><Calculator /><span><b>Ativo Fixo</b><small>Classificação e cálculo</small></span></div>
                <div><Landmark /><span><b>Contabilidade</b><small>Lançamentos e conciliação</small></span></div>
              </div>
            </article>
          </div>
        </>
      )}

      {view === "cadastro" && (
        <div className={styles.grid}>
          <article className={styles.card}>
            <header><div><span>BASE HISTÓRICA</span><h2>Carga inicial de bens</h2></div><PackageCheck /></header>
            <p className={styles.description}>Importação e validação dos {julyBase.assets} bens existentes até 31/07/2026, com rastreabilidade da linha de origem.</p>
            <button className={styles.action} disabled={!canWrite}>Preparar carga inicial</button>
          </article>
          <article className={styles.card}>
            <header><div><span>NOVAS AQUISIÇÕES</span><h2>Validar novos bens</h2></div><ReceiptText /></header>
            <p className={styles.description}>Fila de compras candidatas ao imobilizado, com abertura da nota fiscal no Zeev, classificação e aprovação.</p>
            <button className={styles.action} disabled={!canWrite}>Abrir fila de validação</button>
          </article>
        </div>
      )}
      {view === "nota-explicativa" && <EmptyView icon={FileBarChart} title="Quadro para nota explicativa" description="Movimentação por grupo patrimonial: saldo inicial, adições, baixas, transferências, depreciação, ajustes e saldo final." action="Gerar quadro da competência" canWrite={canWrite} />}
      {view === "calculo" && <EmptyView icon={Calculator} title="Cálculo mensal" description="O fechamento calculará depreciação linear por bem, baixas, transferências e ajustes com memória de cálculo versionada." action="Abrir prévia do cálculo" canWrite={canWrite} />}
      {view === "conciliacao" && <EmptyView icon={BookOpenCheck} title="Controle x razão x balancete" description="O quadro exibirá saldo inicial, adições, baixas, depreciação, ajustes, saldo final e diferenças por conta e filial." action="Consultar relatórios contábeis" canWrite={canWrite} />}

      <footer className={styles.context}>Empresa: <b>{companyCode} — {companyName}</b> · Competência: <b>{competence}</b></footer>
    </section>
  );
}

function EmptyView({ icon: Icon, title, description, action, canWrite }: { icon: typeof Boxes; title: string; description: string; action: string; canWrite: boolean }) {
  return <article className={styles.empty}><Icon /><span>ESTRUTURA INICIAL</span><h2>{title}</h2><p>{description}</p><button disabled={!canWrite}>{action}</button>{!canWrite && <small>Seu perfil possui permissão somente para consulta.</small>}</article>;
}
