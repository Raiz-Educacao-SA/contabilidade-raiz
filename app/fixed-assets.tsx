"use client";

import { useEffect, useMemo, useState } from "react";
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
  accessToken: string;
};

type View = "resumo" | "cadastro" | "nota-explicativa" | "calculo" | "conciliacao";

type Asset = {
  id: string; codigo_patrimonial: string; codfilial: string; descricao: string;
  numero_nf: string | null; unidade: string | null; valor_custo: number; status: string;
  accumulatedDepreciation: number; bookValue: number;
  grupo: { codigo: string; descricao: string; depreciavel: boolean } | null;
};

type FixedAssetsData = {
  importBatch: { competencia: string; status: string; nome_arquivo: string; quantidade_registros: number } | null;
  assets: Asset[];
  summary: { assets: number; fullyDepreciated: number; cost: number; accumulatedDepreciation: number; bookValue: number } | null;
  noteDisclosure: NoteDisclosureRow[];
};

type NoteDisclosureRow = {
  id: string; secao: "IMOBILIZADO" | "INTANGIVEL"; ordem: number; codigo_ne: string;
  descricao: string; taxa_anual: number; saldo_inicial: number; adicoes: number;
  transferencias: number; afac: number; baixas: number; depreciacao: number;
  saldo_final: number; saldo_balancete: number; diferenca: number;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const wholeCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function FixedAssetsPanel({
  companyCode,
  companyName,
  competence,
  canWrite,
  accessToken,
}: FixedAssetsProps) {
  const [view, setView] = useState<View>("resumo");
  const [data, setData] = useState<FixedAssetsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/fixed-assets?company=${encodeURIComponent(companyCode)}&competence=${encodeURIComponent(competence)}`, {
      headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar o Ativo Fixo.");
      setData(payload);
    }).catch((reason) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [accessToken, companyCode, competence]);

  const summary = data?.summary;
  const reference = data?.importBatch?.competencia ?? competence;
  const filteredAssets = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return data?.assets ?? [];
    return (data?.assets ?? []).filter((asset) => [asset.codigo_patrimonial, asset.descricao, asset.codfilial, asset.numero_nf, asset.unidade, asset.grupo?.codigo]
      .some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(term)));
  }, [data?.assets, search]);
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
          {loading && <div className={styles.notice}>Carregando a posição patrimonial…</div>}
          {error && <div className={styles.error}>{error}</div>}
          {!loading && !error && !summary && <div className={styles.notice}>Ainda não existe carga de Ativo Fixo para esta empresa.</div>}
          {summary && <>
          <div className={styles.statusBar}>
            <div><BadgeCheck /><span><b>Base de origem carregada</b><small>Posição patrimonial em {reference.split("-").reverse().join("/")}</small></span></div>
            <span className={styles.pending}>{data?.importBatch?.status === "RASCUNHO" ? "Carga pendente de homologação" : data?.importBatch?.status}</span>
          </div>
          <div className={styles.kpis}>
            <article><span>Bens cadastrados</span><b>{summary.assets.toLocaleString("pt-BR")}</b><small>{summary.fullyDepreciated} totalmente depreciados</small></article>
            <article><span>Valor de custo</span><b>{currency.format(summary.cost)}</b><small>Base carregada do Supabase</small></article>
            <article><span>Depreciação acumulada</span><b>{currency.format(summary.accumulatedDepreciation)}</b><small>Valor armazenado por bem</small></article>
            <article><span>Saldo contábil</span><b>{currency.format(summary.bookValue)}</b><small>Posição contábil carregada</small></article>
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
          </>}
        </>
      )}

      {view === "cadastro" && (
        <div className={styles.assetsArea}>
          <div className={styles.assetsHeader}><div><span>BASE HISTÓRICA</span><h2>Cadastro de bens</h2><small>{data?.assets.length ?? 0} bens carregados · competência {reference}</small></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar bem, conta, filial ou NF" /></div>
          <div className={styles.tableWrap}><table><thead><tr><th>Código</th><th>Filial</th><th>Descrição</th><th>Conta</th><th className={styles.numeric}>Custo</th><th className={styles.numeric}>Depreciação acumulada</th><th className={styles.numeric}>Saldo contábil</th><th>Status</th></tr></thead>
            <tbody>{filteredAssets.map((asset) => <tr key={asset.id}><td>{asset.codigo_patrimonial}</td><td>{asset.codfilial}</td><td><b>{asset.descricao}</b><small>{asset.unidade || asset.numero_nf ? `${asset.unidade ?? ""}${asset.numero_nf ? ` · NF ${asset.numero_nf}` : ""}` : ""}</small></td><td>{asset.grupo?.codigo ?? "—"}</td><td className={styles.numeric}>{currency.format(Number(asset.valor_custo))}</td><td className={styles.numeric}>{currency.format(asset.accumulatedDepreciation)}</td><td className={styles.numeric}>{currency.format(asset.bookValue)}</td><td><span className={styles.assetStatus}>{asset.status}</span></td></tr>)}</tbody></table></div>
          {!loading && !filteredAssets.length && <p className={styles.noResults}>Nenhum bem encontrado.</p>}
        </div>
      )}
      {view === "nota-explicativa" && (
        <div className={styles.noteArea}>
          <div className={styles.noteHeader}><div><span>QUADRO DE MOVIMENTAÇÕES</span><h2>Nota explicativa · {reference}</h2><small>Valores em reais, seguindo as amarrações da planilha de origem.</small></div><span className={styles.sourceBadge}>Carga inicial</span></div>
          {(["IMOBILIZADO", "INTANGIVEL"] as const).map((section) => {
            const rows = (data?.noteDisclosure ?? []).filter((row) => row.secao === section);
            const totals = rows.reduce((sum, row) => ({ saldo_inicial: sum.saldo_inicial + Number(row.saldo_inicial), adicoes: sum.adicoes + Number(row.adicoes), transferencias: sum.transferencias + Number(row.transferencias), afac: sum.afac + Number(row.afac), baixas: sum.baixas + Number(row.baixas), depreciacao: sum.depreciacao + Number(row.depreciacao), saldo_final: sum.saldo_final + Number(row.saldo_final), saldo_balancete: sum.saldo_balancete + Number(row.saldo_balancete), diferenca: sum.diferenca + Number(row.diferenca) }), { saldo_inicial: 0, adicoes: 0, transferencias: 0, afac: 0, baixas: 0, depreciacao: 0, saldo_final: 0, saldo_balancete: 0, diferenca: 0 });
            return <section className={styles.noteSection} key={section}><h3>{section === "INTANGIVEL" ? "Intangível" : "Imobilizado"}</h3><div className={styles.tableWrap}><table className={styles.noteTable}><thead><tr><th>Grupo patrimonial</th><th>NE</th><th className={styles.numeric}>Taxa</th><th className={styles.numeric}>Saldo inicial</th><th className={styles.numeric}>Adições</th><th className={styles.numeric}>Transferências</th><th className={styles.numeric}>AFAC</th><th className={styles.numeric}>Baixas</th><th className={styles.numeric}>Depreciação</th><th className={styles.numeric}>Saldo final</th><th className={styles.numeric}>Balancete</th><th className={styles.numeric}>Check</th></tr></thead><tbody>
              {rows.map((row) => <tr key={row.id}><td><b>{row.descricao}</b></td><td>{row.codigo_ne}</td><td className={styles.numeric}>{(Number(row.taxa_anual) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</td><td className={styles.numeric}>{wholeCurrency.format(Number(row.saldo_inicial))}</td><td className={styles.numeric}>{wholeCurrency.format(Number(row.adicoes))}</td><td className={styles.numeric}>{wholeCurrency.format(Number(row.transferencias))}</td><td className={styles.numeric}>{wholeCurrency.format(Number(row.afac))}</td><td className={styles.numeric}>{wholeCurrency.format(Number(row.baixas))}</td><td className={styles.numeric}>{wholeCurrency.format(Number(row.depreciacao))}</td><td className={styles.numeric}>{wholeCurrency.format(Number(row.saldo_final))}</td><td className={styles.numeric}>{wholeCurrency.format(Number(row.saldo_balancete))}</td><td className={styles.numeric}><span className={Math.abs(Math.round(Number(row.diferenca))) <= 1 ? styles.checkOk : styles.checkError}>{Math.round(Number(row.diferenca)).toLocaleString("pt-BR")}</span></td></tr>)}
            </tbody><tfoot><tr><td colSpan={3}>Total {section === "INTANGIVEL" ? "do intangível" : "do imobilizado"}</td><td className={styles.numeric}>{wholeCurrency.format(totals.saldo_inicial)}</td><td className={styles.numeric}>{wholeCurrency.format(totals.adicoes)}</td><td className={styles.numeric}>{wholeCurrency.format(totals.transferencias)}</td><td className={styles.numeric}>{wholeCurrency.format(totals.afac)}</td><td className={styles.numeric}>{wholeCurrency.format(totals.baixas)}</td><td className={styles.numeric}>{wholeCurrency.format(totals.depreciacao)}</td><td className={styles.numeric}>{wholeCurrency.format(totals.saldo_final)}</td><td className={styles.numeric}>{wholeCurrency.format(totals.saldo_balancete)}</td><td className={styles.numeric}>{Math.round(totals.diferenca).toLocaleString("pt-BR")}</td></tr></tfoot></table></div></section>;
          })}
          {!loading && !(data?.noteDisclosure?.length) && <p className={styles.noResults}>O quadro ainda não foi carregado para esta competência.</p>}
          <div className={styles.noteLegend}><span><i className={styles.legendOk} /> Diferença de arredondamento dentro da tolerância da planilha</span><span>Saldo final = saldo inicial + adições + transferências + AFAC + baixas + depreciação</span></div>
        </div>
      )}
      {view === "calculo" && <EmptyView icon={Calculator} title="Cálculo mensal" description="O fechamento calculará depreciação linear por bem, baixas, transferências e ajustes com memória de cálculo versionada." action="Abrir prévia do cálculo" canWrite={canWrite} />}
      {view === "conciliacao" && <EmptyView icon={BookOpenCheck} title="Controle x razão x balancete" description="O quadro exibirá saldo inicial, adições, baixas, depreciação, ajustes, saldo final e diferenças por conta e filial." action="Consultar relatórios contábeis" canWrite={canWrite} />}

      <footer className={styles.context}>Empresa: <b>{companyCode} — {companyName}</b> · Competência: <b>{competence}</b></footer>
    </section>
  );
}

function EmptyView({ icon: Icon, title, description, action, canWrite }: { icon: typeof Boxes; title: string; description: string; action: string; canWrite: boolean }) {
  return <article className={styles.empty}><Icon /><span>ESTRUTURA INICIAL</span><h2>{title}</h2><p>{description}</p><button disabled={!canWrite}>{action}</button>{!canWrite && <small>Seu perfil possui permissão somente para consulta.</small>}</article>;
}
