import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../app/page.tsx", import.meta.url);
let source = readFileSync(path, "utf8");

const fiscalModuleAlreadyConfigured = [
  'type FiscalTab = "paa" | "iss" | "ecf";',
  'useState<FiscalTab>("paa")',
  'className="accounting-nav fiscal-nav"',
  'selectedModule === "fiscal"',
  'className="panel module-workspace accounting-workspace fiscal-workspace"',
  'selectedModule !== "fiscal"',
].every((marker) => source.includes(marker));

if (fiscalModuleAlreadyConfigured) {
  console.log("Módulo Fiscal: PAA, ISS e ECF já estão configurados em app/page.tsx.");
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  const normalizeLineEndings = (value, lineEnding) =>
    value.replaceAll("\r\n", "\n").replaceAll("\n", lineEnding);
  const variants = (value) => [
    normalizeLineEndings(value, "\n"),
    normalizeLineEndings(value, "\r\n"),
  ];
  if (variants(replacement).some((candidate) => source.includes(candidate))) return;
  const matchedSearch = variants(search).find((candidate) => source.includes(candidate));
  if (!matchedSearch) {
    throw new Error(`Não foi possível aplicar o ajuste do módulo fiscal: ${label}.`);
  }
  source = source.replace(
    matchedSearch,
    normalizeLineEndings(replacement, "\n"),
  );
}

replaceOnce(
  'type AccountingTab = "pis-cofins" | "receita-filial" | "analise-balancete" | "irpj-csll" | "rateio-csc" | "intercompany" | "provisoes" | "despesas" | "arrendamentos" | "lotes-integrar";\n',
  'type AccountingTab = "pis-cofins" | "receita-filial" | "analise-balancete" | "irpj-csll" | "rateio-csc" | "intercompany" | "provisoes" | "despesas" | "arrendamentos" | "lotes-integrar";\ntype FiscalTab = "paa" | "iss" | "ecf";\n',
  "tipo FiscalTab",
);

replaceOnce(
  '  const [accountingTab, setAccountingTab] = useState<AccountingTab>("pis-cofins");\n',
  '  const [accountingTab, setAccountingTab] = useState<AccountingTab>("pis-cofins");\n  const [fiscalTab, setFiscalTab] = useState<FiscalTab>("paa");\n',
  "estado fiscalTab",
);

replaceOnce(
  '        {selectedModule === "contabil" && (\n          <nav className="accounting-nav">',
  `        {selectedModule === "fiscal" && (\n          <nav className="accounting-nav fiscal-nav">\n            {([\n              { id: "paa", label: "PAA", icon: ListChecks },\n              { id: "iss", label: "ISS", icon: ReceiptText },\n              { id: "ecf", label: "ECF", icon: BookOpenCheck },\n            ] as const).map(({ id, label, icon: Icon }) => (\n              <button\n                key={id}\n                className={fiscalTab === id ? "active" : ""}\n                onClick={() => setFiscalTab(id)}\n              >\n                <Icon />\n                {label}\n              </button>\n            ))}\n          </nav>\n        )}\n        {selectedModule === "contabil" && (\n          <nav className="accounting-nav">`,
  "menu lateral fiscal",
);

replaceOnce(
  '              {selectedModule === "contabil"\n                ? accountingTab === "pis-cofins"',
  '              {selectedModule === "fiscal"\n                ? fiscalTab === "paa"\n                  ? "PAA"\n                  : fiscalTab === "iss"\n                    ? "ISS"\n                    : "ECF"\n                : selectedModule === "contabil"\n                ? accountingTab === "pis-cofins"',
  "título da rotina fiscal",
);

replaceOnce(
  '        {selectedModule === "cronograma" && scheduleView === "acompanhamento" && (',
  `        {selectedModule === "fiscal" && (\n          <section className="panel module-workspace accounting-workspace fiscal-workspace">\n            {fiscalTab === "paa" ? (\n              <ListChecks />\n            ) : fiscalTab === "iss" ? (\n              <ReceiptText />\n            ) : (\n              <BookOpenCheck />\n            )}\n            <span className="eyebrow">MÓDULO FISCAL</span>\n            <h2>{fiscalTab === "paa" ? "PAA" : fiscalTab === "iss" ? "ISS" : "ECF"}</h2>\n            <p>Área preparada para receber as regras, bases, documentos e conferências desta rotina fiscal.</p>\n          </section>\n        )}\n        {selectedModule === "cronograma" && scheduleView === "acompanhamento" && (`,
  "área de trabalho fiscal",
);

replaceOnce(
  '          selectedModule !== "folha" &&\n          selectedModule !== "contabil" &&',
  '          selectedModule !== "folha" &&\n          selectedModule !== "fiscal" &&\n          selectedModule !== "contabil" &&',
  "exclusão do placeholder genérico fiscal",
);

writeFileSync(path, source);
console.log("Módulo Fiscal: PAA, ISS e ECF garantidos em app/page.tsx.");
