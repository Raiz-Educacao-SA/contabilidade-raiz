import { NextResponse } from "next/server";
import { authenticatedCorporateUser, createAdminServerSupabase } from "@/lib/server/supabase-access";

const normalizeCompany = (value: string) => value.replace(/\D/g, "").padStart(2, "0");

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
    .select("id,codigo_patrimonial,codfilial,descricao,numero_nf,unidade,centro_custo,fornecedor,data_aquisicao,data_baixa,quantidade,valor_custo,status,linha_origem,grupo:ativo_fixo_grupos(codigo,descricao,depreciavel)")
    .eq("empresa_id", companyResult.data.id)
    .eq("importacao_id", importResult.data.id)
    .order("linha_origem", { ascending: true });
  if (assetsResult.error) return NextResponse.json({ error: "Não foi possível consultar os bens." }, { status: 500 });

  const calculationsResult = await admin
    .from("ativo_fixo_calculos")
    .select("bem_id,depreciacao_acumulada_contabil,saldo_contabil")
    .eq("empresa_id", companyResult.data.id)
    .eq("competencia", importResult.data.competencia)
    .eq("versao", 1);
  if (calculationsResult.error) return NextResponse.json({ error: "Não foi possível consultar os saldos dos bens." }, { status: 500 });

  const calculations = new Map((calculationsResult.data ?? []).map((item) => [item.bem_id, item]));
  const assets = (assetsResult.data ?? []).map((asset) => {
    const calculation = calculations.get(asset.id);
    return {
      ...asset,
      accumulatedDepreciation: Number(calculation?.depreciacao_acumulada_contabil ?? 0),
      bookValue: Number(calculation?.saldo_contabil ?? 0),
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

  return NextResponse.json({ company: companyResult.data, importBatch: importResult.data, assets, summary, noteDisclosure: noteResult.data ?? [] });
}
