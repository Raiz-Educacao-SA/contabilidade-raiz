import { NextResponse } from "next/server";
import { authenticatedCorporateUser, createAdminServerSupabase } from "@/lib/server/supabase-access";

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const depreciationExpenseAccount = "4.2.1.09.01.01";
const accumulatedDepreciationAccounts: Record<string, string> = {
  "1.2.3.02.01": "1.2.3.02.01.99",
  "1.2.3.02.02": "1.2.3.02.02.99",
  "1.2.3.02.03": "1.2.3.02.03.02",
  "1.2.3.02.04": "1.2.3.02.04.02",
  "1.2.3.02.05": "1.2.3.02.05.02",
  "1.2.3.02.06": "1.2.3.02.06.02",
  "1.2.3.02.07": "1.2.3.02.07.02",
  "1.2.3.02.08": "1.2.3.02.08.02",
  "1.2.3.02.09": "1.2.3.02.09.02",
  "1.2.3.02.10": "1.2.3.02.11.01",
  "1.2.3.02.12": "1.2.3.02.12.02",
  "1.2.3.02.14": "1.2.3.02.14.02",
  "1.2.3.02.16": "1.2.3.02.16.02",
  "1.2.3.02.18": "1.2.3.02.19.01",
  "1.2.3.02.20": "1.2.3.02.19.01",
  "1.2.3.02.21": "1.2.3.02.21.02",
};

export async function GET(request: Request) {
  const user = await authenticatedCorporateUser(request);
  const admin = createAdminServerSupabase();
  if (!user || !admin) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const url = new URL(request.url);
  const companyCode = (url.searchParams.get("company") || "").replace(/\D/g, "").padStart(2, "0");
  const competence = url.searchParams.get("competence") || "";
  if (!/^\d{2}$/.test(companyCode) || !/^\d{4}-\d{2}$/.test(competence)) return NextResponse.json({ error: "Empresa ou competência inválida." }, { status: 400 });
  const company = await admin.from("empresas").select("id").eq("codcoligada", companyCode).maybeSingle();
  if (!company.data) return NextResponse.json({ error: "Empresa não localizada." }, { status: 404 });
  const access = await admin.from("usuarios_empresas").select("id").eq("usuario_id", user.id).eq("empresa_id", company.data.id).limit(1);
  if (!access.data?.length) return NextResponse.json({ error: "Acesso não autorizado para esta empresa." }, { status: 403 });
  const [year, month] = competence.split("-").map(Number);
  const monthEnd = `${competence}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  const assetsResult = await admin.from("ativo_fixo_bens").select("id,codigo_patrimonial,codfilial,descricao,data_aquisicao,data_baixa,valor_custo,valor_residual,vida_util_contabil_meses,status,grupo:ativo_fixo_grupos(codigo,descricao,depreciavel,inicio_depreciacao,conta_depreciacao_acumulada,conta_despesa_depreciacao)").eq("empresa_id", company.data.id).lte("data_aquisicao", monthEnd).order("codigo_patrimonial");
  if (assetsResult.error) return NextResponse.json({ error: "Não foi possível consultar os bens para cálculo." }, { status: 500 });
  const previousResult = await admin.from("ativo_fixo_calculos").select("bem_id,competencia,depreciacao_acumulada_contabil").eq("empresa_id", company.data.id).lt("competencia", competence).neq("status", "CANCELADO").order("competencia", { ascending: false });
  const previous = new Map<string, number>();
  for (const item of previousResult.data ?? []) if (!previous.has(item.bem_id)) previous.set(item.bem_id, Number(item.depreciacao_acumulada_contabil));
  const rows = (assetsResult.data ?? []).map((asset) => {
    const group = Array.isArray(asset.grupo) ? asset.grupo[0] : asset.grupo;
    const cost = Number(asset.valor_custo || 0); const residual = Number(asset.valor_residual || 0);
    const base = Math.max(0, cents(cost - residual)); const opening = Math.max(0, Number(previous.get(asset.id) || 0));
    const acquiredMonth = String(asset.data_aquisicao).slice(0, 7);
    const eligible = group?.depreciavel && Number(asset.vida_util_contabil_meses) > 0 && (!asset.data_baixa || String(asset.data_baixa) >= `${competence}-01`) && (group.inicio_depreciacao === "MES_AQUISICAO" ? acquiredMonth <= competence : acquiredMonth < competence);
    const standardQuota = eligible ? cents(base / Number(asset.vida_util_contabil_meses)) : 0;
    const monthDepreciation = cents(Math.max(0, Math.min(standardQuota, base - opening)));
    const accumulated = cents(opening + monthDepreciation); const bookValue = cents(cost - accumulated);
    const groupCode = group?.codigo || "";
    return { id: asset.id, code: asset.codigo_patrimonial, branch: asset.codfilial, description: asset.descricao, account: groupCode, group: group?.descricao || "Sem classificação", debitAccount: group?.conta_despesa_depreciacao || depreciationExpenseAccount, creditAccount: group?.conta_depreciacao_acumulada || accumulatedDepreciationAccounts[groupCode] || "", cost, residual, base, opening, standardQuota, monthDepreciation, accumulated, bookValue, status: !group ? "SEM_CLASSIFICACAO" : !group.depreciavel ? "NAO_DEPRECIAVEL" : monthDepreciation ? "CALCULADO" : "SEM_QUOTA" };
  });
  const totals = rows.reduce((sum, row) => ({ cost: sum.cost + row.cost, base: sum.base + row.base, opening: sum.opening + row.opening, monthDepreciation: sum.monthDepreciation + row.monthDepreciation, accumulated: sum.accumulated + row.accumulated, bookValue: sum.bookValue + row.bookValue }), { cost: 0, base: 0, opening: 0, monthDepreciation: 0, accumulated: 0, bookValue: 0 });
  const postingErrors = [...new Set(rows.filter((row) => row.monthDepreciation > 0 && (!row.debitAccount || !row.creditAccount)).map((row) => `${row.account || "Sem código"} — ${row.group}`))];
  const groupedPostings = new Map<string, { branchCode: string; groupCode: string; groupName: string; debitAccount: string; creditAccount: string; amount: number }>();
  for (const row of rows) {
    if (row.monthDepreciation <= 0 || !row.debitAccount || !row.creditAccount) continue;
    const key = [row.branch, row.account, row.debitAccount, row.creditAccount].join("|");
    const current = groupedPostings.get(key) ?? { branchCode: row.branch, groupCode: row.account, groupName: row.group, debitAccount: row.debitAccount, creditAccount: row.creditAccount, amount: 0 };
    current.amount = cents(current.amount + row.monthDepreciation);
    groupedPostings.set(key, current);
  }
  const postings = [...groupedPostings.values()].sort((left, right) => Number(left.branchCode) - Number(right.branchCode) || left.groupCode.localeCompare(right.groupCode));
  return NextResponse.json({ competence, rows, totals, postings, postingErrors, calculated: rows.filter((row) => row.status === "CALCULADO").length, pending: rows.filter((row) => row.status === "SEM_CLASSIFICACAO").length }, { headers: { "cache-control": "private, no-store" } });
}
