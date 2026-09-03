import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateStraightLineDepreciation, reconcileFixedAssetBalances } from "../lib/fixed-assets.ts";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/fixed-assets.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../Supabase/20260903_ativo_fixo.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/fixed-assets/route.ts", import.meta.url), "utf8");

test("Ativo Fixo fica isolado em componente próprio e acessível pela navegação", () => {
  assert.match(page, /FixedAssetsPanel/);
  assert.match(page, /allowedAreas\.includes\("ativo-fixo"\)/);
  assert.doesNotMatch(page, /Ativo Fixo, em breve/);
  assert.match(panel, /data-testid="fixed-assets-module"/);
  assert.match(panel, /Resumo individual/);
  assert.match(panel, /Cadastro de bens/);
  assert.match(panel, /Nota explicativa/);
  assert.match(panel, /Buscar bem, conta, filial ou NF/);
  assert.match(panel, /Depreciação acumulada/);
  assert.match(panel, /QUADRO DE MOVIMENTAÇÕES/);
  assert.match(panel, /Saldo final = saldo inicial/);
  assert.match(panel, /Controle x razão x balancete/);
  assert.match(panel, /Compras/);
  assert.match(panel, /Zeev/);
});

test("Ativo Fixo consulta a carga real com autenticação e segregação por empresa", () => {
  assert.match(page, /accessToken={session\.access_token}/);
  assert.match(panel, /\/api\/fixed-assets/);
  assert.match(panel, /Cadastro de bens/);
  assert.match(route, /authenticatedCorporateUser/);
  assert.match(route, /usuarios_empresas/);
  assert.match(route, /ativo_fixo_importacoes/);
  assert.match(route, /ativo_fixo_bens/);
  assert.match(route, /ativo_fixo_calculos/);
  assert.match(route, /ativo_fixo_nota_explicativa/);
});

test("migração do Ativo Fixo usa tabelas próprias, segregação por empresa e RLS", () => {
  assert.match(migration, /ativo_fixo_bens/);
  assert.match(migration, /empresa_id uuid not null/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /usuarios_empresas/);
});

test("depreciação linear inicia no mês seguinte e respeita o valor residual", () => {
  const result = calculateStraightLineDepreciation({
    cost: 12_000,
    residualValue: 0,
    usefulLifeMonths: 60,
    acquisitionDate: "2026-08-15",
    referenceDate: "2026-09-30",
  });
  assert.equal(result.monthlyQuota, 200);
  assert.equal(result.depreciatedMonths, 1);
  assert.equal(result.accumulatedDepreciation, 200);
  assert.equal(result.bookValue, 11_800);
});

test("conciliação exige igualdade entre controle, razão e balancete", () => {
  assert.equal(reconcileFixedAssetBalances({ control: 100, ledger: 100, trialBalance: 100 }).reconciled, true);
  assert.equal(reconcileFixedAssetBalances({ control: 100, ledger: 99, trialBalance: 99 }).reconciled, false);
});
