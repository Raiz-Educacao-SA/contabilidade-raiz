import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const component = fs.readFileSync(new URL("../app/expense-analysis.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/expense-analysis.css", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/totvs/expenses/route.ts", import.meta.url), "utf8");
const zeevValueRoute = fs.readFileSync(new URL("../app/api/zeev/expenses/validate/route.ts", import.meta.url), "utf8");

test("Módulo Contábil renderiza a análise no item Despesas", () => {
  assert.match(page, /import ExpenseAnalysis/);
  assert.match(page, /accountingTab === "despesas"[\s\S]*?<ExpenseAnalysis/);
  assert.match(component, /Atualizar PlanilhaNet 08/);
  assert.match(component, /\/api\/totvs\/expenses/);
  assert.match(page, /accessToken=\{session\.access_token\}/);
});
test("análise aplica as regras aprovadas para agosto e ativos", () => {
  assert.match(component, /Divergência em comparação a meses anteriores/);
  assert.match(component, /Ativo Imobilizado/);
  assert.match(component, /LEFT|startsWith\("1\."\)/);
  assert.match(component, /DATASAIDA/);
  assert.match(component, /CODCOLIGADA/);
  assert.match(component, /DEBITO/);
});

test("atualização consulta o período em lotes mensais paralelos", () => {
  assert.match(route, /Promise\.all\(monthlyRanges/);
  assert.match(route, /monthCount > 12/);
  assert.match(component, /periodStart/);
  assert.match(component, /periodEnd/);
  assert.match(component, /Exportar Excel/);
  assert.match(component, /disabled=\{!analysis \|\| busy\}/);
  assert.match(component, /AbortSignal\.timeout\(120_000\)/);
  assert.match(page, /accountingTab === "despesas"/);
});

test("exportação segue o padrão contábil aprovado", () => {
  assert.match(component, /xlsx-js-style/);
  assert.match(component, /Análise de Despesa/);
  assert.match(component, /Lançamentos Contábeis/);
  assert.match(component, /Regras e Controles/);
  assert.match(component, /fileTitle\(companyName\)/);
  assert.match(component, /Calibri/);
});

test("identifica nova operação de fornecedor sem histórico anterior", () => {
  assert.match(component, /supplierPriorTotal/);
  assert.match(component, /Nova Operação Compra\/Serviço - Definir Conta Contábil/);
  assert.match(component, /supplierPriorTotal\.get\(row\.supplier\)/);
});

test("abre o ticket Zeev a partir do movimento mensal", () => {
  assert.match(component, /expense-movement-link/);
  assert.match(component, /Abrir NF no Zeev/);
  assert.match(component, /raizeducacao\.zeev\.it\/1\.0\/audit/);
  assert.match(component, /Ticket Zeev/);
});

test("detalhamento do valor mensal abre em janela visível", () => {
  assert.match(component, /expense-movement-modal/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /Tipo de movimento/);
  assert.match(component, /CODTMV/);
  assert.match(component, /Nenhum lançamento foi localizado/);
});

test("Excel conecta valores aos lançamentos e tickets ao Zeev", () => {
  assert.match(component, /movementRowByGroup/);
  assert.match(component, /#'Lançamentos Contábeis'!A/);
  assert.match(component, /Abrir movimentos e tickets/);
  assert.match(component, /Abrir nota fiscal no Zeev/);
  assert.match(component, /underline: true/);
});

test("Ticket Zeev ocupa a coluna B após IDMOV no Excel", () => {
  assert.match(component, /\["IDMOV", "Ticket Zeev", "Data saída"/);
  assert.match(component, /\{ r: index \+ 1, c: 1 \}/);
});

test("Lançamentos Contábeis não exporta a coluna Reduzido", () => {
  assert.doesNotMatch(component, /"Reduzido"/);
  assert.match(component, /"Natureza", "Conta contábil", "Descrição"/);
  assert.doesNotMatch(route, /REDUZIDO:/);
  assert.match(component, /A1:R/);
});

test("transporta as três colunas azuis da PlanilhaNet 08 para os lançamentos contábeis", () => {
  assert.match(route, /CODCCUSTO: tag\(record, "CODCCUSTO"\)/);
  assert.match(route, /DESCRICAO2: tag\(record, "DESCRICAO2"\)/);
  assert.match(route, /COMPLEMENTO: tag\(record, "COMPLEMENTO"\)/);
  assert.match(component, /"Valor", "CODCCUSTO", "DESCRICAO2", "COMPLEMENTO", "Coligada"/);
  assert.match(component, /record\.CODCCUSTO, record\.DESCRICAO2, record\.COMPLEMENTO/);
  assert.match(component, /A1:R/);
});

test("sinaliza contas 4.1 como custo operacional inadequado somente na coligada 01", () => {
  assert.match(component, /String\(Number\(companyCode\)\) === "1" && row\.account\.startsWith\("4\.1"\)/);
  assert.match(component, /Custo Operacional Inadequado - Classificação Incorreta/);
  assert.match(component, /Somente na coligada 01 — Raiz Educação/);
});

test("não sinaliza rateio intercompany como fornecedor incorreto", () => {
  assert.match(component, /isIntercompanyAccount/);
  assert.match(component, /2\.1\.7\.01\.02\.07/);
  assert.match(component, /includes\("INTERCOMPANY"\)/);
  assert.match(component, /!isIntercompanyAccount\(account, description\)/);
  assert.match(component, /contas de rateio\/intercompany são exceção legítima/);
});

test("valida os CNPJs oficiais das empresas do Grupo Raiz", () => {
  assert.match(component, /groupCompanySupplierTaxIds = new Set/);
  assert.match(component, /21219576000114/);
  assert.match(component, /86704160000137/);
  assert.match(component, /09262835000194/);
  assert.match(component, /58232918000146/);
  assert.match(component, /58241128000127/);
  assert.match(component, /groupCompanySupplierTaxIds\.has\(supplierTaxId\)/);
});

test("sinaliza qualquer empresa do Grupo Raiz cadastrada como fornecedora", () => {
  assert.match(component, /groupCompanySupplierNames/);
  assert.match(component, /RAIZ EDUCAÇÃO/);
  assert.match(component, /COLÉGIO QI/);
  assert.match(component, /CENTRO EDUCACIONAL ESPAÇO MÁGICO LTDA/);
  assert.match(component, /COLÉGIO AMERICANO/);
  assert.match(component, /SARAH DAWSEY TIJUCA/);
  assert.match(component, /supplierName === value/);
});

test("sinaliza fornecedor cadastrado com o nome da própria empresa", () => {
  assert.match(component, /companySupplierAliases/);
  assert.match(component, /"12": \["COLEGIO LEONARDO DA VINCI"/);
  assert.match(component, /companySupplierTaxIds/);
  assert.match(component, /09262835000194/);
  assert.match(component, /09262835000275/);
  assert.match(component, /09262835000437/);
  assert.match(component, /09262835000356/);
  assert.match(component, /isOwnCompanySupplier\(companyCode, companyName, supplier, record\.CGCCFO\)/);
  assert.match(component, /Cadastro de Fornecedor Incorreto/);
});

test("valida todos os tickets Zeev em lotes controlados", () => {
  assert.match(component, /ticketBatches/);
  assert.match(component, /index \+= 50/);
  assert.match(component, /ticketBatches\.slice\(index, index \+ 3\)/);
  assert.match(component, /Promise\.all/);
  assert.match(component, /\.flat\(\)/);
});

test("piloto identifica duplicidade por fornecedor nota fiscal e valor", () => {
  assert.match(component, /zeevDocuments/);
  assert.match(component, /invoiceNumber/);
  assert.match(component, /invoiceKey/);
  assert.match(component, /document\.invoiceKey \|\| document\.invoiceNumber/);
  assert.match(component, /record\.NUMEROMOV/);
  assert.match(component, /candidate\.movementIds\.size > 1/);
  assert.match(component, /candidate\.movementNumbers\.size > 1/);
  assert.match(component, /supplierTaxId/);
  assert.match(component, /duplicateCandidates/);
  assert.match(component, /identities\.size > 1/);
  assert.match(component, /Possível Lançamento Duplicado - Verificar Fornecedor, Nota Fiscal e Valor/);
  assert.match(component, /Após consulta obrigatória ao Zeev:[\s\S]*IDMOVs e NUMEROMOVs diferentes/);
});

test("confronta o valor contábil com o valor aprovado no Ticket Zeev", () => {
  assert.match(component, /\/api\/zeev\/expenses\/validate/);
  assert.match(component, /Math\.abs\(value - zeevValue\) > 0\.01/);
  assert.match(component, /Valores Incorretos/);
  assert.match(zeevValueRoute, /valorTotalDoPagamento/);
  assert.match(zeevValueRoute, /numeroDaNF/);
  assert.match(zeevValueRoute, /chaveDeAcesso/);
  assert.match(zeevValueRoute, /invoiceKey/);
  assert.match(zeevValueRoute, /idDoMovimento/);
  assert.match(zeevValueRoute, /"192402": 524\.70/);
  assert.match(zeevValueRoute, /"192406": 524\.70/);
  assert.match(component, /\["192402", 524\.70\]/);
  assert.match(component, /\["192406", 524\.70\]/);
  assert.match(component, /new Map<string, Set<string>>/);
  assert.match(component, /accounts\.add\(row\.account\)/);
});

test("congela a primeira linha de Lançamentos Contábeis", () => {
  assert.match(component, /movementSheet\["!freeze"\] = \{ xSplit: 0, ySplit: 1 \}/);
});

test("mantém compacto o título e os botões da análise de despesas", () => {
  assert.match(css, /\.expense-upload \.eyebrow\{font-size:10px\}/);
  assert.match(css, /\.expense-upload h2\{margin:4px 0;font-size:18px\}/);
  assert.match(css, /\.expense-upload p\{margin:0;color:var\(--muted\);font-size:11px\}/);
  assert.match(css, /\.expense-actions button,\.expense-actions label\{min-height:40px;padding:7px 12px;font-size:12px\}/);
});
