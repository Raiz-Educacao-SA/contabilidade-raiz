import { NextResponse } from "next/server";
import { authenticatedCorporateUser, createAdminServerSupabase } from "@/lib/server/supabase-access";

const normalizeCompany = (value: string) => value.replace(/\D/g, "").padStart(2, "0");
const text = (value: unknown, limit = 250) => String(value ?? "").trim().slice(0, limit);
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

const summaryTemplate = [
  ["1.2.3.01.01", "Imobilizado em Andamento", 0, 0, "2018", "Imobilizado", "7006", "Imobilizado em Andamento", 0],
  ["1.2.3.02.01", "Benfeitorias em Imóveis de Terceiros", 5, 5, "2018", "Imobilizado", "7008", "Benfeitorias em Imóveis de Terceiros", .20],
  ["1.2.3.02.02", "Imóveis/Instalações", 10, 10, "2018", "Imobilizado", "7011", "Imóveis/Instalações", .10],
  ["1.2.3.02.03", "Máquinas e Equipamentos", 10, 10, "2018", "Imobilizado", "7003", "Máquinas e Equipamentos", .10],
  ["1.2.3.02.04", "Veículos", 5, 5, "2018", "Imobilizado", "7013", "Veículos", .20],
  ["1.2.3.02.05", "Móveis e Utensílios", 10, 10, "2018", "Imobilizado", "7004", "Móveis e Utensílios", .10],
  ["1.2.3.02.06", "Ferramentas", null, null, "2018", "Imobilizado", null, "Ferramentas", 0],
  ["1.2.3.02.07", "Equipamentos de Comunicação", 5, 5, "2018", "Imobilizado", "7099", "Equipamentos de Comunicação", .20],
  ["1.2.3.02.08", "Computadores e Periféricos", 5, 5, "2018", "Imobilizado", "7005", "Computadores e Periféricos", .20],
  ["1.2.3.02.09", "Acervo Educacional", null, null, "2018", "Imobilizado", "7012", "Acervo Educacional", 0],
  ["1.2.3.02.10", "Outras Imobilizações", null, null, "2018", "Imobilizado", "7099", "Outras Imobilizações", 0],
  ["1.2.3.02.12", "Biblioteca", null, null, "2018", "Imobilizado", "7099", "Biblioteca", 0],
  ["1.2.3.02.14", "Software", 5, 5, "2019", "Intangível", "7100", "Software", .20],
  ["1.2.3.02.15", "Despesas Pré-Operacionais", null, null, "2019", "Intangível", null, "Despesas Pré-Operacionais", 0],
  ["1.2.3.02.16", "Software e Licenças de Uso", 1, 1, "2019", "Intangível", "7101", "Software e Licenças de Uso", 1],
  ["1.2.3.02.17", "Marcas e Patentes", null, null, "2019", "Intangível", "7099", "Marcas e Patentes", 0],
  ["1.2.3.02.18", "Benfeitorias em Bens de Terceiros", null, null, "2018", "Imobilizado", "7008", "Benfeitorias em Bens de Terceiros", 0],
  ["1.2.3.02.19", "(-) Amortizações Acumuladas", 0, 0, "2018", "Imobilizado", "7008", "Benfeitorias em Bens de Terceiros", 0],
  ["1.2.3.02.20", "Fundo de Comércio", 10, 10, "2019", "Intangível", "7104", "Fundo de Comércio", .10],
  ["1.2.3.02.21", "Imóveis", null, null, "2018", "Imobilizado", "7014", "Imóveis", 0],
  ["1.2.3.02.22", "Autoria de Livros", null, null, "2019", "Imobilizado", "7199", "Autoria de Livros", 0],
  ["1.2.3.02.23", "Terrenos", 0, 0, "2018", "Imobilizado", "7010", "Terrenos", 0],
] as const;

export async function GET(request: Request) {
  const user = await authenticatedCorporateUser(request);
  const admin = createAdminServerSupabase();
  if (!user || !admin) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const url = new URL(request.url);
  const companyCode = normalizeCompany(url.searchParams.get("company") ?? "");
  const competence = url.searchParams.get("competence")?.trim() ?? "";
  if (!/^\d{2}$/.test(companyCode) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) {
    return NextResponse.json({ error: "Empresa ou competência inválida." }, { status: 400 });
  }
  const [year, month] = competence.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const companyResult = await admin
    .from("empresas")
    .select("id,codcoligada,razao_social")
    .eq("codcoligada", companyCode)
    .maybeSingle();
  if (companyResult.error || !companyResult.data) {
    return NextResponse.json({ error: "Empresa não localizada." }, { status: 404 });
  }

  const accessResult = await admin
    .from("usuarios_empresas")
    .select("id")
    .eq("usuario_id", user.id)
    .eq("empresa_id", companyResult.data.id)
    .limit(1);
  if (accessResult.error || !accessResult.data?.length) {
    return NextResponse.json({ error: "Você não possui acesso a esta empresa." }, { status: 403 });
  }

  const importResult = await admin
    .from("ativo_fixo_importacoes")
    .select("id,competencia,nome_arquivo,quantidade_registros,status,importado_em")
    .eq("empresa_id", companyResult.data.id)
    .lte("competencia", competence)
    .order("competencia", { ascending: false })
    .order("importado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (importResult.error) return NextResponse.json({ error: "Não foi possível consultar a carga inicial." }, { status: 500 });
  if (!importResult.data) return NextResponse.json({ company: companyResult.data, importBatch: null, assets: [], summary: null });

  const assetsResult = await admin
    .from("ativo_fixo_bens")
    .select("id,codigo_patrimonial,codfilial,descricao,numero_nf,unidade,centro_custo,fornecedor,data_aquisicao,data_baixa,quantidade,valor_custo,valor_residual,status,linha_origem,grupo:ativo_fixo_grupos(codigo,descricao,depreciavel,nota_explicativa_codigo)")
    .eq("empresa_id", companyResult.data.id)
    .lte("data_aquisicao", `${competence}-${String(lastDay).padStart(2, "0")}`)
    .order("linha_origem", { ascending: true });
  if (assetsResult.error) return NextResponse.json({ error: "Não foi possível consultar os bens." }, { status: 500 });

  const calculationsResult = await admin
    .from("ativo_fixo_calculos")
    .select("bem_id,base_depreciavel,quota_mensal_contabil,depreciacao_acumulada_contabil,saldo_contabil")
    .eq("empresa_id", companyResult.data.id)
    .eq("competencia", importResult.data.competencia)
    .eq("versao", 1);
  if (calculationsResult.error) return NextResponse.json({ error: "Não foi possível consultar os saldos dos bens." }, { status: 500 });

  const calculations = new Map((calculationsResult.data ?? []).map((item) => [item.bem_id, item]));
  const assets = (assetsResult.data ?? []).map((asset) => {
    const calculation = calculations.get(asset.id);
    const group = Array.isArray(asset.grupo) ? asset.grupo[0] ?? null : asset.grupo;
    return {
      ...asset,
      grupo: group,
      depreciableBase: Number(calculation?.base_depreciavel ?? 0),
      monthlyQuota: Number(calculation?.quota_mensal_contabil ?? 0),
      accumulatedDepreciation: Number(calculation?.depreciacao_acumulada_contabil ?? 0),
      bookValue: Number(calculation?.saldo_contabil ?? asset.valor_custo ?? 0),
    };
  });
  const summary = assets.reduce(
    (total, asset) => ({
      assets: total.assets + 1,
      fullyDepreciated: total.fullyDepreciated + (asset.bookValue <= 0.01 ? 1 : 0),
      cost: total.cost + Number(asset.valor_custo ?? 0),
      accumulatedDepreciation: total.accumulatedDepreciation + asset.accumulatedDepreciation,
      bookValue: total.bookValue + asset.bookValue,
    }),
    { assets: 0, fullyDepreciated: 0, cost: 0, accumulatedDepreciation: 0, bookValue: 0 },
  );

  const noteResult = await admin
    .from("ativo_fixo_nota_explicativa")
    .select("id,secao,ordem,codigo_ne,descricao,taxa_anual,saldo_inicial,adicoes,transferencias,afac,baixas,depreciacao,saldo_final,saldo_balancete,diferenca,origem")
    .eq("empresa_id", companyResult.data.id)
    .eq("competencia", importResult.data.competencia)
    .order("secao", { ascending: true })
    .order("ordem", { ascending: true });
  if (noteResult.error) return NextResponse.json({ error: "Não foi possível consultar o quadro da nota explicativa." }, { status: 500 });

  const accountTotals = new Map<string, { items: number; cost: number; residual: number; depreciable: number; quota: number; accumulated: number; book: number }>();
  for (const asset of assets) {
    const code = asset.grupo?.codigo;
    if (!code) continue;
    const total = accountTotals.get(code) ?? { items: 0, cost: 0, residual: 0, depreciable: 0, quota: 0, accumulated: 0, book: 0 };
    total.items += 1;
    total.cost += Number(asset.valor_custo ?? 0);
    total.residual += Number(asset.valor_residual ?? 0);
    total.depreciable += asset.depreciableBase;
    total.quota += asset.monthlyQuota;
    total.accumulated += asset.accumulatedDepreciation;
    total.book += asset.bookValue;
    accountTotals.set(code, total);
  }
  const noteBalances = new Map((noteResult.data ?? []).map((row) => [String(row.codigo_ne), Number(row.saldo_balancete ?? 0)]));
  const summaryRows = summaryTemplate.map(([accountCode, accountDescription, fiscalLife, accountingLife, bpDre, bpDreDescription, noteCode, nature, rate]) => {
    const total = accountTotals.get(accountCode) ?? { items: 0, cost: 0, residual: 0, depreciable: 0, quota: 0, accumulated: 0, book: 0 };
    const trialBalance = total.items > 0 && noteCode ? noteBalances.get(noteCode) ?? total.book : 0;
    const check = Math.round(trialBalance - total.book);
    return { accountCode, accountDescription, fiscalLife, accountingLife, bpDre, bpDreDescription, noteCode, nature, rate, ...total, trialBalance, check, status: Math.abs(check) <= 1 ? "Ok" : "Divergente" };
  });

  const groupsResult = await admin
    .from("ativo_fixo_grupos")
    .select("id,codigo,descricao,vida_util_contabil_meses,vida_util_fiscal_meses,percentual_residual,depreciavel")
    .eq("empresa_id", companyResult.data.id)
    .eq("ativo", true)
    .order("codigo");

  return NextResponse.json({ company: companyResult.data, importBatch: importResult.data, assets, summary, summaryRows, noteDisclosure: noteResult.data ?? [], groups: groupsResult.data ?? [] });
}

export async function POST(request: Request) {
  const user = await authenticatedCorporateUser(request);
  const admin = createAdminServerSupabase();
  if (!user || !admin) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const companyCode = normalizeCompany(text(body?.company));
  const competence = text(body?.competence, 7);
  const movementId = text(body?.movementId, 60);
  const groupId = text(body?.groupId, 60);
  const description = text(body?.description);
  const cost = number(body?.cost);
  const acquisitionDate = text(body?.acquisitionDate, 10);
  if (!/^\d{2}$/.test(companyCode) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competence) || !movementId || !groupId || !description || cost <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate)) {
    return NextResponse.json({ error: "Preencha movimento, classificação, descrição, data e valor válidos." }, { status: 400 });
  }

  const company = await admin.from("empresas").select("id,codcoligada").eq("codcoligada", companyCode).maybeSingle();
  if (!company.data) return NextResponse.json({ error: "Empresa não localizada." }, { status: 404 });
  const access = await admin.from("usuarios_empresas").select("perfil").eq("usuario_id", user.id).eq("empresa_id", company.data.id).maybeSingle();
  if (!access.data || text(access.data.perfil).toLowerCase() === "consulta") return NextResponse.json({ error: "Seu perfil não permite confirmar aquisições." }, { status: 403 });
  const group = await admin.from("ativo_fixo_grupos").select("id,codigo,vida_util_contabil_meses,vida_util_fiscal_meses,percentual_residual").eq("id", groupId).eq("empresa_id", company.data.id).eq("ativo", true).maybeSingle();
  if (!group.data) return NextResponse.json({ error: "Classificação patrimonial inválida." }, { status: 400 });

  const itemIndex = Math.max(1, Math.trunc(number(body?.itemIndex) || 1));
  const patrimonialCode = `AQ-${companyCode}-${competence.replace("-", "")}-${movementId}-${String(itemIndex).padStart(2, "0")}`;
  const existing = await admin.from("ativo_fixo_bens").select("id,codigo_patrimonial").eq("empresa_id", company.data.id).eq("codigo_patrimonial", patrimonialCode).maybeSingle();
  if (existing.data) return NextResponse.json({ asset: existing.data, alreadyRegistered: true });
  const residual = Math.round(cost * number(group.data.percentual_residual) * 100) / 100;
  const asset = await admin.from("ativo_fixo_bens").insert({
    empresa_id: company.data.id, grupo_id: group.data.id, codigo_patrimonial: patrimonialCode,
    codcoligada: companyCode, codfilial: text(body?.branch, 10) || "1", descricao: description,
    numero_nf: text(body?.invoiceNumber, 80) || null, chave_nf: text(body?.invoiceKey, 100) || null,
    zeev_referencia: text(body?.ticket, 80) || null, unidade: text(body?.unit, 120) || null,
    centro_custo: text(body?.costCenter, 80) || null, fornecedor: text(body?.supplier) || null,
    data_aquisicao: acquisitionDate, quantidade: number(body?.quantity) || 1,
    valor_unitario: number(body?.unitValue) || cost, valor_custo: cost, valor_residual: residual,
    vida_util_contabil_meses: group.data.vida_util_contabil_meses,
    vida_util_fiscal_meses: group.data.vida_util_fiscal_meses, status: "ATIVO", criado_por: user.id,
  }).select("id,codigo_patrimonial").single();
  if (asset.error || !asset.data) return NextResponse.json({ error: asset.error?.message || "Não foi possível cadastrar o bem." }, { status: 500 });

  const movement = await admin.from("ativo_fixo_movimentacoes").insert({
    empresa_id: company.data.id, bem_id: asset.data.id, competencia: competence, tipo: "ADICAO", valor: cost,
    justificativa: "Aquisição confirmada pelo fluxo TOTVS/Zeev.", documento_referencia: `IDMOV ${movementId}${body?.ticket ? ` · Zeev ${text(body.ticket, 80)}` : ""}`,
    criado_por: user.id,
  });
  if (movement.error && movement.error.code !== "23505") {
    await admin.from("ativo_fixo_bens").delete().eq("id", asset.data.id);
    return NextResponse.json({ error: "O bem não foi gravado porque a movimentação não pôde ser registrada." }, { status: 500 });
  }
  return NextResponse.json({ asset: asset.data }, { status: 201 });
}
