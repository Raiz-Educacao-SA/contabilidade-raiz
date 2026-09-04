"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BookOpenCheck,
  Boxes,
  Calculator,
  FileBarChart,
  PackageCheck,
  ReceiptText,
  Search,
  ExternalLink,
  CheckCircle2,
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

type View = "resumo" | "nova-aquisicao" | "cadastro" | "nota-explicativa" | "calculo" | "conciliacao";

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
  summaryRows: SummaryRow[];
  noteDisclosure: NoteDisclosureRow[];
  groups: AssetGroup[];
};

type AssetGroup = { id: string; codigo: string; descricao: string; vida_util_contabil_meses: number; vida_util_fiscal_meses: number | null; percentual_residual: number; depreciavel: boolean };
type InvoiceItem = { code?: string; description: string; ncm?: string; cst?: string; cfop?: string; unit?: string; quantity: number; unitValue: number; total: number; icmsBase?: number; icmsValue?: number; ipiValue?: number; icmsRate?: number; ipiRate?: number };
type Acquisition = {
  CODFILIAL: string; IDMOV: string; NUMEROMOV: string; DATAEMISSAO: string; DATASAIDA: string;
  TICKET: string; DEBITO: string; DESCRICAO: string; VALOR: number; CODCCUSTO: string;
  NOMEFANTASIA: string; COMPLEMENTO: string;
  zeev?: { found: boolean; invoiceNumber?: string; invoiceKey?: string; supplier?: string; invoiceDescription?: string; branch?: string; status?: string; cancelled?: boolean; items?: InvoiceItem[] };
};
type MonthlyCalculation = { rows: Array<{ id: string; code: string; branch: string; description: string; account: string; group: string; cost: number; base: number; opening: number; standardQuota: number; monthDepreciation: number; accumulated: number; bookValue: number; status: string }>; totals: { cost: number; base: number; opening: number; monthDepreciation: number; accumulated: number; bookValue: number }; calculated: number; pending: number };

type SummaryRow = {
  accountCode: string; accountDescription: string; fiscalLife: number | null;
  accountingLife: number | null; bpDre: string; bpDreDescription: string;
  noteCode: string | null; nature: string; rate: number; items: number; cost: number;
  residual: number; depreciable: number; quota: number; accumulated: number;
  book: number; trialBalance: number; check: number; status: string;
};

type NoteDisclosureRow = {
  id: string; secao: "IMOBILIZADO" | "INTANGIVEL"; ordem: number; codigo_ne: string;
  descricao: string; taxa_anual: number; saldo_inicial: number; adicoes: number;
  transferencias: number; afac: number; baixas: number; depreciacao: number;
  saldo_final: number; saldo_balancete: number; diferenca: number;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const wholeCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (value: number) => Math.abs(value) < .005 ? "—" : decimal.format(value);
const dateOnly = (value: string) => {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : "";
};

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
  const [lot, setLot] = useState("");
  const [acquisitions, setAcquisitions] = useState<Acquisition[]>([]);
  const [selected, setSelected] = useState<Acquisition | null>(null);
  const [selectedItem, setSelectedItem] = useState(0);
  const [groupId, setGroupId] = useState("");
  const [assetDescription, setAssetDescription] = useState("");
  const [acquisitionBusy, setAcquisitionBusy] = useState(false);
  const [acquisitionMessage, setAcquisitionMessage] = useState("");
  const [invoiceItemsBusy, setInvoiceItemsBusy] = useState(false);
  const [invoiceItemsInfo, setInvoiceItemsInfo] = useState("");
  const [invoiceItemsVerified, setInvoiceItemsVerified] = useState(false);
  const [monthly, setMonthly] = useState<MonthlyCalculation | null>(null);
  const [monthlyBusy, setMonthlyBusy] = useState(false);
  const [monthlyError, setMonthlyError] = useState("");
  const fetchData = useCallback(async (signal?: AbortSignal): Promise<FixedAssetsData> => {
    const response = await fetch(`/api/fixed-assets?company=${encodeURIComponent(companyCode)}&competence=${encodeURIComponent(competence)}`, {
      headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar o Ativo Fixo.");
    return payload;
  }, [accessToken, companyCode, competence]);
  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal).then(setData).catch((reason) => { if (reason.name !== "AbortError") setError(reason.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [fetchData]);

  const summary = data?.summary;
  const reference = data?.importBatch?.competencia ?? competence;
  const filteredAssets = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return data?.assets ?? [];
    return (data?.assets ?? []).filter((asset) => [asset.codigo_patrimonial, asset.descricao, asset.codfilial, asset.numero_nf, asset.unidade, asset.grupo?.codigo]
      .some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(term)));
  }, [data?.assets, search]);
  const navigation = [
    { id: "resumo", label: "Resumo individual", icon: Boxes },
    { id: "nova-aquisicao", label: "Nova aquisição", icon: ReceiptText },
    { id: "cadastro", label: "Cadastro de bens", icon: PackageCheck },
    { id: "nota-explicativa", label: "Nota explicativa", icon: FileBarChart },
    { id: "calculo", label: "Cálculo mensal", icon: Calculator },
    { id: "conciliacao", label: "Conciliação", icon: Scale },
  ] as const;

  async function searchAcquisitions() {
    setAcquisitionBusy(true); setAcquisitionMessage(""); setSelected(null);
    try {
      const [year, month] = competence.split("-").map(Number);
      const end = `${competence}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
      const response = await fetch(`/api/totvs/expenses?company=${encodeURIComponent(companyCode)}&start=${competence}-01&end=${end}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível pesquisar as aquisições.");
      const term = lot.trim().toLowerCase();
      const rows: Acquisition[] = (payload.rows ?? []).filter((row: Acquisition) => Number(row.VALOR) > 0 && String(row.DEBITO).startsWith("1.") && (!term || [row.IDMOV, row.NUMEROMOV, row.TICKET].some((value) => String(value).toLowerCase().includes(term))));
      const tickets = [...new Set(rows.map((row) => String(row.TICKET || "").trim()).filter((ticket) => /^\d+$/.test(ticket)))];
      let validations: Array<{ ticket: string } & NonNullable<Acquisition["zeev"]>> = [];
      if (tickets.length) {
        const zeev = await fetch("/api/zeev/expenses/validate", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ tickets }), cache: "no-store" });
        if (zeev.ok) validations = (await zeev.json()).validations ?? [];
      }
      const byTicket = new Map(validations.map((item) => [String(item.ticket), item]));
      setAcquisitions(rows.map((row) => ({ ...row, zeev: byTicket.get(String(row.TICKET)) })));
      setAcquisitionMessage(rows.length ? `${rows.length} movimento(s) patrimonial(is) localizado(s).` : "Nenhuma aquisição patrimonial foi localizada para o filtro informado.");
    } catch (cause) { setAcquisitionMessage(cause instanceof Error ? cause.message : "Falha na pesquisa."); }
    finally { setAcquisitionBusy(false); }
  }

  async function reviewAcquisition(row: Acquisition) {
    setSelected({ ...row, zeev: { ...row.zeev, found: row.zeev?.found ?? false, items: [] } }); setSelectedItem(0); setGroupId(data?.groups?.find((group) => group.codigo === row.DEBITO)?.id ?? "");
    setAssetDescription("");
    setAcquisitionMessage(""); setInvoiceItemsInfo(""); setInvoiceItemsVerified(false);
    if (!row.TICKET) return setInvoiceItemsInfo("O movimento não possui ticket Zeev para leitura do documento.");
    setInvoiceItemsBusy(true);
    try {
      const invoiceParams = new URLSearchParams({ ticket: row.TICKET });
      invoiceParams.set("company", companyCode);
      invoiceParams.set("movementId", row.IDMOV);
      if (row.zeev?.invoiceKey) invoiceParams.set("invoiceKey", row.zeev.invoiceKey);
      if (row.zeev?.invoiceNumber || row.NUMEROMOV) invoiceParams.set("invoiceNumber", row.zeev?.invoiceNumber || row.NUMEROMOV);
      const response = await fetch(`/api/zeev/invoice-items?${invoiceParams}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível ler os itens da NF.");
      const detailedItems: InvoiceItem[] = payload.items ?? [];
      if (detailedItems.length) {
        setSelected({ ...row, zeev: { ...row.zeev, found: row.zeev?.found ?? true, items: detailedItems } });
        setAssetDescription(detailedItems[0].description);
        setInvoiceItemsVerified(true);
      }
      setInvoiceItemsInfo(`${payload.source || "Zeev"}${payload.documentName ? ` · ${payload.documentName}` : ""}${payload.warning ? ` — ${payload.warning}` : ""}`);
    } catch (cause) { setInvoiceItemsInfo(cause instanceof Error ? cause.message : "Falha ao ler os itens da NF."); }
    finally { setInvoiceItemsBusy(false); }
  }

  async function confirmAcquisition() {
    if (!selected || !groupId) return setAcquisitionMessage("Selecione a classificação patrimonial antes de confirmar.");
    const item = selected.zeev?.items?.[selectedItem];
    setAcquisitionBusy(true); setAcquisitionMessage("");
    try {
      const response = await fetch("/api/fixed-assets", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({
        company: companyCode, competence, movementId: selected.IDMOV, groupId, itemIndex: selectedItem + 1,
        description: assetDescription, cost: item?.total || Number(selected.VALOR), quantity: item?.quantity || 1,
        unitValue: item?.unitValue || Number(selected.VALOR), acquisitionDate: dateOnly(selected.DATASAIDA || selected.DATAEMISSAO),
        branch: selected.CODFILIAL, invoiceNumber: selected.zeev?.invoiceNumber || selected.NUMEROMOV,
        invoiceKey: selected.zeev?.invoiceKey, ticket: selected.TICKET, supplier: selected.zeev?.supplier || selected.NOMEFANTASIA,
        costCenter: selected.CODCCUSTO,
      }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível confirmar a aquisição.");
      setData(await fetchData());
      setAcquisitionMessage(payload.alreadyRegistered ? `O bem ${payload.asset.codigo_patrimonial} já estava cadastrado.` : `Bem ${payload.asset.codigo_patrimonial} confirmado e incluído no cadastro.`);
    } catch (cause) { setAcquisitionMessage(cause instanceof Error ? cause.message : "Falha ao confirmar a aquisição."); }
    finally { setAcquisitionBusy(false); }
  }

  async function calculateMonth() {
    setMonthlyBusy(true); setMonthlyError("");
    try {
      const response = await fetch(`/api/fixed-assets/monthly-calculation?company=${encodeURIComponent(companyCode)}&competence=${encodeURIComponent(competence)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível calcular a competência.");
      setMonthly(payload);
    } catch (cause) { setMonthlyError(cause instanceof Error ? cause.message : "Falha no cálculo mensal."); }
    finally { setMonthlyBusy(false); }
  }

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
          <div className={styles.summaryArea}>
            <div className={styles.summaryHeader}><div><span>RESUMO INDIVIDUAL</span><h2>Posição patrimonial por conta</h2><small>Modelo e amarrações da planilha · competência {reference}</small></div><span className={styles.sourceBadge}>22 contas</span></div>
            <div className={styles.tableWrap}><table className={styles.summaryTable}><thead><tr><th>Cód. conta</th><th>Descrição conta</th><th className={styles.numeric}>Vida útil fiscal</th><th className={styles.numeric}>Vida útil contábil</th><th>BP/DRE</th><th>Descrição BP/DRE</th><th>NE</th><th>Grupo natureza</th><th className={styles.numeric}>Taxa</th><th className={styles.numeric}>Qtde.</th><th className={styles.numeric}>Custo aquisição</th><th className={styles.numeric}>Vlr. residual</th><th className={styles.numeric}>Valor depreciável</th><th className={styles.numeric}>Quota mensal</th><th className={styles.numeric}>Depreciação acumulada</th><th className={styles.numeric}>Valor contábil</th><th>Status</th><th className={styles.numeric}>Saldo balancete</th><th className={styles.numeric}>Check</th></tr></thead>
              <tbody>{(data?.summaryRows ?? []).map((row) => <tr key={row.accountCode}><td>{row.accountCode}</td><td><b>{row.accountDescription}</b></td><td className={styles.numeric}>{row.fiscalLife ?? "—"}</td><td className={styles.numeric}>{row.accountingLife ?? "—"}</td><td>{row.bpDre}</td><td>{row.bpDreDescription}</td><td>{row.noteCode ?? "—"}</td><td>{row.nature}</td><td className={styles.numeric}>{(row.rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</td><td className={styles.numeric}>{row.items || "—"}</td><td className={styles.numeric}>{amount(row.cost)}</td><td className={styles.numeric}>{amount(row.residual)}</td><td className={styles.numeric}>{amount(row.depreciable)}</td><td className={styles.numeric}>{amount(row.quota)}</td><td className={styles.numeric}>{amount(row.accumulated)}</td><td className={styles.numeric}>{amount(row.book)}</td><td><span className={row.status === "Ok" ? styles.checkOk : styles.checkError}>{row.status}</span></td><td className={styles.numeric}>{amount(row.trialBalance)}</td><td className={styles.numeric}>{row.check.toLocaleString("pt-BR")}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={9}>Total</td><td className={styles.numeric}>{summary.assets}</td><td className={styles.numeric}>{amount(summary.cost)}</td><td className={styles.numeric}>{amount((data?.summaryRows ?? []).reduce((sum, row) => sum + row.residual, 0))}</td><td className={styles.numeric}>{amount((data?.summaryRows ?? []).reduce((sum, row) => sum + row.depreciable, 0))}</td><td className={styles.numeric}>{amount((data?.summaryRows ?? []).reduce((sum, row) => sum + row.quota, 0))}</td><td className={styles.numeric}>{amount(summary.accumulatedDepreciation)}</td><td className={styles.numeric}>{amount(summary.bookValue)}</td><td>Ok</td><td className={styles.numeric}>{amount((data?.summaryRows ?? []).reduce((sum, row) => sum + row.trialBalance, 0))}</td><td className={styles.numeric}>{(data?.summaryRows ?? []).reduce((sum, row) => sum + row.check, 0)}</td></tr></tfoot>
            </table></div>
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
      {view === "nova-aquisicao" && (
        <div className={styles.acquisitionArea}>
          <div className={styles.acquisitionHeader}><div><span>COMPRAS · TOTVS RM + ZEEV</span><h2>Nova aquisição</h2><small>Pesquise o período, valide a nota fiscal e confirme cada bem.</small></div><div className={styles.acquisitionSearch}><label>Competência<input value={competence} disabled /></label><label>Lote ou movimento<input value={lot} onChange={(event) => setLot(event.target.value)} placeholder="Opcional: IDMOV, nº movimento ou ticket" /></label><button onClick={() => void searchAcquisitions()} disabled={acquisitionBusy}><Search />{acquisitionBusy ? "Pesquisando…" : "Pesquisar aquisições"}</button></div></div>
          {acquisitionMessage && <div className={styles.notice}>{acquisitionMessage}</div>}
          <div className={styles.acquisitionGrid}>
            <div className={styles.candidateList}><h3>Candidatas do período <span>{acquisitions.length}</span></h3>{acquisitions.map((row) => <button key={`${row.IDMOV}-${row.DEBITO}`} className={selected?.IDMOV === row.IDMOV ? styles.selectedCandidate : ""} onClick={() => void reviewAcquisition(row)}><div><b>{row.NOMEFANTASIA || "Fornecedor não informado"}</b><small>Mov. {row.NUMEROMOV || row.IDMOV} · Filial {row.CODFILIAL} · Conta {row.DEBITO}</small></div><strong>{currency.format(Number(row.VALOR))}</strong><span className={row.zeev?.found && !row.zeev.cancelled ? styles.zeevOk : styles.zeevPending}>{row.zeev?.cancelled ? "Cancelada" : row.zeev?.found ? "NF localizada" : "Validar NF"}</span></button>)}{!acquisitions.length && <p>Faça a pesquisa para listar movimentos em contas patrimoniais.</p>}</div>
              <div className={styles.reviewPanel}>{selected ? <><header><div><span>VALIDAÇÃO DA NOTA</span><h3>NF {selected.zeev?.invoiceNumber || selected.NUMEROMOV || "não identificada"}</h3><small>Zeev {selected.TICKET || "sem ticket"} · IDMOV {selected.IDMOV}</small></div>{selected.TICKET && <a href={`https://raizeducacao.zeev.it/1.0/audit?c=${encodeURIComponent(selected.TICKET)}`} target="_blank" rel="noreferrer"><ExternalLink /> Abrir nota</a>}</header>
              <div className={styles.invoiceMeta}><span><small>Fornecedor</small><b>{selected.zeev?.supplier || selected.NOMEFANTASIA}</b></span><span><small>Chave da NF</small><b>{selected.zeev?.invoiceKey || "Não informada"}</b></span><span><small>Valor do movimento</small><b>{currency.format(Number(selected.VALOR))}</b></span></div>
              <div className={styles.itemsTitle}><h4>Itens da nota fiscal</h4><small>{invoiceItemsBusy ? "Lendo o documento no Zeev…" : invoiceItemsInfo}</small></div><div className={styles.invoiceItems}><table><thead><tr><th>Código</th><th>Descrição do produto/serviço</th><th>NCM</th><th>CST/CSOSN</th><th>CFOP</th><th>Unid.</th><th>Qtd.</th><th>Vlr. unit.</th><th>Vlr. total</th><th>BC ICMS</th><th>Vlr. ICMS</th><th>Vlr. IPI</th><th>Alíq. ICMS</th><th>Alíq. IPI</th></tr></thead><tbody>{(selected.zeev?.items ?? []).map((item, index) => <tr key={`${item.code || item.description}-${index}`} className={selectedItem === index ? styles.selectedItem : ""} onClick={() => { setSelectedItem(index); setAssetDescription(item.description); }}><td>{item.code || "—"}</td><td><b>{item.description}</b></td><td>{item.ncm || "—"}</td><td>{item.cst || "—"}</td><td>{item.cfop || "—"}</td><td>{item.unit || "—"}</td><td className={styles.numeric}>{decimal.format(item.quantity)}</td><td className={styles.numeric}>{currency.format(item.unitValue || 0)}</td><td className={styles.numeric}>{currency.format(item.total)}</td><td className={styles.numeric}>{amount(item.icmsBase || 0)}</td><td className={styles.numeric}>{amount(item.icmsValue || 0)}</td><td className={styles.numeric}>{amount(item.ipiValue || 0)}</td><td className={styles.numeric}>{item.icmsRate ? `${decimal.format(item.icmsRate)}%` : "—"}</td><td className={styles.numeric}>{item.ipiRate ? `${decimal.format(item.ipiRate)}%` : "—"}</td></tr>)}{!invoiceItemsBusy && !(selected.zeev?.items?.length) && <tr><td colSpan={14} className={styles.invoiceItemsEmpty}>Os itens da seção Dados do produto/serviço ainda não foram carregados. Nenhuma descrição provisória será usada.</td></tr>}</tbody></table></div>
              <div className={styles.classification}><label>Descrição do bem<input value={assetDescription} onChange={(event) => setAssetDescription(event.target.value)} /></label><label>Classificação patrimonial<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Selecione ou altere a classificação</option>{(data?.groups ?? []).map((group) => <option key={group.id} value={group.id}>{group.codigo} — {group.descricao}</option>)}</select></label></div>
              <button className={styles.confirmButton} disabled={!canWrite || acquisitionBusy || invoiceItemsBusy || !invoiceItemsVerified || !groupId || !assetDescription.trim() || selected.zeev?.cancelled} onClick={() => void confirmAcquisition()}><CheckCircle2 />Confirmar e incluir no cadastro de bens</button>
            </> : <div className={styles.reviewEmpty}><ReceiptText /><b>Selecione uma aquisição</b><span>A nota, os itens e a classificação aparecerão aqui para validação.</span></div>}</div>
          </div>
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
      {view === "calculo" && <div className={styles.calculationArea}><div className={styles.calculationHeader}><div><span>MEMÓRIA DE CÁLCULO</span><h2>Depreciação mensal · {competence.split("-").reverse().join("/")}</h2><small>Saldo oficial anterior + movimentações e regras de vida útil de cada bem.</small></div><button onClick={() => void calculateMonth()} disabled={monthlyBusy}><Calculator />{monthlyBusy ? "Calculando…" : "Gerar prévia"}</button></div>{monthlyError && <div className={styles.error}>{monthlyError}</div>}{monthly && <><div className={styles.calculationKpis}><article><span>Bens com quota</span><b>{monthly.calculated}</b></article><article><span>Base depreciável</span><b>{currency.format(monthly.totals.base)}</b></article><article><span>Depreciação do mês</span><b>{currency.format(monthly.totals.monthDepreciation)}</b></article><article><span>Saldo contábil final</span><b>{currency.format(monthly.totals.bookValue)}</b></article></div><div className={styles.tableWrap}><table className={styles.calculationTable}><thead><tr><th>Código</th><th>Filial</th><th>Descrição do bem</th><th>Conta</th><th className={styles.numeric}>Custo</th><th className={styles.numeric}>Base depreciável</th><th className={styles.numeric}>Deprec. anterior</th><th className={styles.numeric}>Quota padrão</th><th className={styles.numeric}>Deprec. do mês</th><th className={styles.numeric}>Deprec. acumulada</th><th className={styles.numeric}>Saldo final</th><th>Status</th></tr></thead><tbody>{monthly.rows.map((row) => <tr key={row.id}><td>{row.code}</td><td>{row.branch}</td><td><b>{row.description}</b><small>{row.group}</small></td><td>{row.account || "—"}</td><td className={styles.numeric}>{amount(row.cost)}</td><td className={styles.numeric}>{amount(row.base)}</td><td className={styles.numeric}>{amount(row.opening)}</td><td className={styles.numeric}>{amount(row.standardQuota)}</td><td className={styles.numeric}>{amount(row.monthDepreciation)}</td><td className={styles.numeric}>{amount(row.accumulated)}</td><td className={styles.numeric}>{amount(row.bookValue)}</td><td><span className={row.status === "CALCULADO" ? styles.checkOk : styles.assetStatus}>{row.status.replaceAll("_", " ")}</span></td></tr>)}</tbody><tfoot><tr><td colSpan={4}>Total</td><td className={styles.numeric}>{amount(monthly.totals.cost)}</td><td className={styles.numeric}>{amount(monthly.totals.base)}</td><td className={styles.numeric}>{amount(monthly.totals.opening)}</td><td></td><td className={styles.numeric}>{amount(monthly.totals.monthDepreciation)}</td><td className={styles.numeric}>{amount(monthly.totals.accumulated)}</td><td className={styles.numeric}>{amount(monthly.totals.bookValue)}</td><td>PRÉVIA</td></tr></tfoot></table></div></>}</div>}
      {view === "conciliacao" && <EmptyView icon={BookOpenCheck} title="Controle x razão x balancete" description="O quadro exibirá saldo inicial, adições, baixas, depreciação, ajustes, saldo final e diferenças por conta e filial." action="Consultar relatórios contábeis" canWrite={canWrite} />}

      <footer className={styles.context}>Empresa: <b>{companyCode} — {companyName}</b> · Competência: <b>{competence}</b></footer>
    </section>
  );
}

function EmptyView({ icon: Icon, title, description, action, canWrite }: { icon: typeof Boxes; title: string; description: string; action: string; canWrite: boolean }) {
  return <article className={styles.empty}><Icon /><span>ESTRUTURA INICIAL</span><h2>{title}</h2><p>{description}</p><button disabled={!canWrite}>{action}</button>{!canWrite && <small>Seu perfil possui permissão somente para consulta.</small>}</article>;
}
