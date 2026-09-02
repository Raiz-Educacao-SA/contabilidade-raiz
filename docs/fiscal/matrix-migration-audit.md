# Matrix Migration Audit - IRPJ/CSLL

Generated at: 2026-08-31

## Scope

This audit is restricted to the IRPJ/CSLL automation project. It does not
implement new fiscal rules, calculation, Parte B, PF/BN, credits, UI, seeds, or
remote schema changes.

Historical files were used only as data/evidence sources. The legacy engine,
repositories, UI, database model, and dependencies were not reused. The current
architecture remains `lib/fiscal/`.

## Checkpoint

- Branch used: `feature/irpj-csll-core`.
- Local checkpoint commit: `6565f121f4260aaac5d9ef510dead1defb681b47`.
- Commit message: `feat(fiscal): establish IRPJ CSLL core foundation`.
- Status before audit: clean working tree after checkpoint.

## Sources Found

- Primary plan file: `C:/Users/felipe.carlos/Desktop/plano de contas.xls`.
- Historical data root:
  `C:/Users/felipe.carlos/.codex/visualizations/2026/08/12/019ff5f0-78c7-7083-95db-5f304fe11e62/irpj-csll-app`.
- Derived plan workbook: `data/source-derived/plano-de-contas-derived.xlsx`.
- Raw extracted rows: `data/source-derived/plano-de-contas-raw-rows.json`.
- Normalized chart: `data/normalized/real-chart-of-accounts-accounts.json`.
- Initial pending mappings: `data/normalized/real-chart-of-accounts-initial-pending-mappings.json`.
- Approval placeholder: `data/assisted-classification/approved-tax-account-mappings.json`.
- Assisted review outputs: `reports/tax-account-review/*`.
- Fiscal rule library/matches: `data/fiscal-rule-library/*` and `reports/fiscal-rule-library/*`.
- Primary 2025 Excel evidence:
  `C:/Users/felipe.carlos/Desktop/12_CLV_Apuração_IRPJ_CSLL_12.2025.xlsx`.
- 2025 golden evidence: `test/fixtures/2025-reference/dataset.json` and
  `reports/reconciliation-2025.*`.

## Sources Not Found

- No local dataset file proving the `3.014`-account baseline was found in the
  searched attachments/visualizations.
- No located artifact contains an approved official matrix with
  `395 NO_ADJUSTMENT`, `27 ADDITION`, `9 EXCLUSION`, `22 conditional`, and
  `1 automatic`.
- No migration-ready Supabase seed or productive data migration was created.

## Probable Canonical Matrix Version

The latest physical dataset located in files is the `3.005`-account import from
2026-08-12, derived from `plano de contas.xls`.

The latest handoff, however, states a newer expected canonical baseline of
`3.014` accounts. Because no file or diff supporting `3.014` was located, this
audit treats `3.014` as the target reference still requiring reconciliation, and
`3.005` as the latest available physical dataset, not as authorization for full
matrix migration.

## Reconciliation 3.005 x 3.014

Located `3.005` source:

- Origin file referenced by import report:
  `C:/Users/felipe.carlos/Desktop/plano de contas.xls`.
- Import report:
  `reports/real-chart-of-accounts/real-chart-of-accounts-import-report.json`.
- Source rows: 4,158.
- Imported accounts: 3,005.
- Rejected rows: 1,153.
- Error rows: 0.
- Unique accounts: 3,005.
- Source analytical accounts: 2,525.
- Source synthetic accounts: 480.
- Derived analytical accounts: 2,529.
- Derived synthetic accounts: 476.

Expected `3.014` reference from latest handoff:

- Total accounts: 3,014.
- Synthetic accounts: 480.
- Analytical accounts: 2,534.
- Analytical result accounts: 454.

Delta still unresolved:

- Total accounts: +9.
- Analytical accounts: +9.
- Synthetic accounts: 0.
- Analytical result accounts: +6 versus the located 448 analyzed result
  accounts.

The origin of the 9-account delta cannot be proven from the located files.
Migration must remain pending until the 3.014 source file, or an auditable diff
from 3.005 to 3.014, is supplied/recovered.

## Reconciliation Of Result Accounts

In the located 3.005 dataset:

- Roots 3 and 4 total: 540 accounts.
- Analytical result accounts analyzed: 448.
- Synthetic result accounts outside the queue: 92.
- Analytical result by group: `3.1 = 68`, `4.1 = 89`, `4.2 = 291`.

The historical conversation summary also says `Raiz 4: 454 contas`; the next
section in that same summary clarifies that the assisted review analyzed 448
analytical result accounts. The latest handoff uses 454 as analytical result
accounts for the expected 3.014 baseline. This remains unreconciled locally.

## Fiscal Distribution Found

Officially approved historical mappings found: 0.

Assisted suggestions over 448 analytical result accounts:

- `NO_ADJUSTMENT_CANDIDATE`: 125.
- `ADDITION_CANDIDATE`: 17.
- `EXCLUSION_CANDIDATE`: 25.
- `CONDITIONAL_CANDIDATE`: 26.
- `MANUAL_REVIEW`: 32.
- `UNKNOWN`: 223.

Fiscal rule library over 68 priority candidates:

- Rules in library: 13.
- Rules used: 12.
- `MATCHED_VERIFIED_RULE`: 2.
- `MATCHED_CONDITIONAL_RULE`: 39.
- `POSSIBLE_RULE_REQUIRES_REVIEW`: 20.
- `NO_RELIABLE_RULE_FOUND`: 7.
- Fiscal confidence: `HIGH = 2`, `CONDITIONAL = 49`, `LOW = 10`,
  `UNKNOWN = 7`.

The expected distribution `395/27/9/22/1` from the latest handoff was not found
as a local dataset. It should not be fabricated.

## Authority Of Data

- Approved classification: the historical approval file contains zero approved
  mappings. Only the current project-approved Brindes golden case may be treated
  as approved in the new foundation.
- Assisted suggestion: review queue and fiscal matches are inputs for human
  review only.
- Rule catalog/evidence: can inform `FISCAL_NATURE` and `FISCAL_RULE` only when
  approval is demonstrated.
- Historical ECF/Excel: usable as golden/regression evidence, not as standalone
  classification source for the whole chart.

## Fiscal Natures Identified

| Nature | Accounts | IRPJ | CSLL | Likely method | Confidence | Migration decision |
| --- | ---: | --- | --- | --- | --- | --- |
| BRINDES | 2 | ADDITION_CANDIDATE | ADDITION_CANDIDATE | FULL_ACCOUNT | HIGH_FOR_RULE_LOW_FOR_OFFICIAL_APPROVAL | PARTIAL_DIRECT_ONLY_FOR_4.2.1.02.03.11 |
| PROVISOES | 10 | CONDITIONAL | CONDITIONAL | TRANSACTION_FILTER | MEDIUM | REQUIRES_REVIEW |
| MULTAS_CONTRATUAIS | 9 | CONDITIONAL | CONDITIONAL | TRANSACTION_FILTER | LOW | REQUIRES_REVIEW |
| MULTAS_FISCAIS | 2 | CONDITIONAL | CONDITIONAL | TRANSACTION_FILTER | MEDIUM | REQUIRES_REVIEW |
| PERDAS_CREDITOS_PCLD | 5 | CONDITIONAL | CONDITIONAL | TRANSACTION_FILTER | MEDIUM | REQUIRES_REVIEW |
| RECUPERACOES_REVERSOES | 2 | CONDITIONAL | CONDITIONAL | TRANSACTION_FILTER | MEDIUM | REQUIRES_REVIEW |
| RECUPERACAO_GENERICA | 15 | CONDITIONAL | CONDITIONAL | MANUAL_OR_REVIEW | LOW | REQUIRES_REVIEW |
| RECEITA_BRUTA_DEDUCOES | 4 | CONDITIONAL | CONDITIONAL | TRANSACTION_FILTER | LOW | REQUIRES_REVIEW |
| EQUIVALENCIA_PATRIMONIAL | 7 | CONDITIONAL | CONDITIONAL | EXTERNAL_SOURCE | MEDIUM | REQUIRES_REVIEW |
| DOACOES_PATROCINIOS | 2 | CONDITIONAL | CONDITIONAL | EXTERNAL_SOURCE | MEDIUM | REQUIRES_REVIEW |
| ARRENDAMENTO_CPC06 | 1 | CONDITIONAL | CONDITIONAL | EXTERNAL_SOURCE | MEDIUM | REQUIRES_REVIEW |
| JUROS_DESPESAS_FINANCEIRAS | 1 | CONDITIONAL | CONDITIONAL | TRANSACTION_FILTER | MEDIUM | REQUIRES_REVIEW |
| RECEITAS_FINANCEIRAS | 1 | NO_ADJUSTMENT_CANDIDATE | NO_ADJUSTMENT_CANDIDATE | MANUAL_OR_REVIEW | LOW | REQUIRES_REVIEW |
| PERDAS_GERAIS | 4 | UNKNOWN | UNKNOWN | UNDETERMINED | UNKNOWN | DO_NOT_MIGRATE_AS_RULE |
| NO_RELIABLE_RULE | 3 | UNKNOWN | UNKNOWN | UNDETERMINED | UNKNOWN | DO_NOT_MIGRATE_AS_RULE |

These are proposed natures extracted from historical evidence. They are not
automatically approved.

## FULL_ACCOUNT Eligibility

Mutually exclusive audit buckets for the 68 priority candidates:

- `FULL_ACCOUNT_CONFIRMED`: 2 accounts.
- `REQUIRES_TRANSACTION_FILTER`: 33 accounts.
- `REQUIRES_EXTERNAL_SOURCE`: 10 accounts.
- `MANUAL_OR_REVIEW`: 16 accounts.
- `UNDETERMINED`: 7 accounts.

Confirmed `FULL_ACCOUNT` candidates in historical rule matches:

- `4.2.1.02.03.11` (`908`) - Brindes e Cortesias: `BRINDES`,
  `BRINDES-001`, historical status `PENDING_REVIEW`, current status
  approved golden case.
- `4.2.1.02.03.14` (`2972`) - Brindes - Escolas: `BRINDES`,
  `BRINDES-001`, historical status `PENDING_REVIEW`, still requires explicit
  approval before official migration.

Themes requiring other executors or review:

- `REQUIRES_TRANSACTION_FILTER`: PROVISOES 10, MULTAS_CONTRATUAIS 9,
  MULTAS_FISCAIS 2, PERDAS_CREDITOS_PCLD 5, RECUPERACOES_REVERSOES 2,
  RECEITA_BRUTA_DEDUCOES 4, JUROS_DESPESAS_FINANCEIRAS 1.
- `REQUIRES_EXTERNAL_SOURCE`: EQUIVALENCIA_PATRIMONIAL 7,
  DOACOES_PATROCINIOS 2, ARRENDAMENTO_CPC06 1.
- `MANUAL_OR_REVIEW`: RECUPERACAO_GENERICA 15, RECEITAS_FINANCEIRAS 1.
- `UNDETERMINED`: PERDAS_GERAIS 4, NO_RELIABLE_RULE 3.

## Brindes Migration Control

Historical evidence maps `4.2.1.02.03.11` / reduced `908` /
`Brindes e Cortesias` to:

- nature/theme: `BRINDES`;
- rule: `BRINDES-001`;
- historical method: `FULL_AMOUNT`;
- historical IRPJ/CSLL suggestion: addition candidate;
- legal status: verified in the historical rule match;
- conditions/exceptions: none in the match;
- fiscal confidence: high.

In the new architecture, the future migration for the approved golden account
should land as:

`ACCOUNTING_CHART -> ACCOUNT_FISCAL_MAPPING(accountCode=4.2.1.02.03.11) -> FISCAL_NATURE(BRINDES) -> FISCAL_RULE(FULL_ACCOUNT, AUTOMATIC, NET_DEBIT_MOVEMENT, IRPJ ADDITION, CSLL ADDITION)`.

This matches the already implemented golden case and validates that the
historical dataset can be translated without copying the old engine.

## Legacy To New Architecture

- Plan records -> `ACCOUNTING_CHART` plus versioned chart-account dataset after
  3.005 x 3.014 reconciliation.
- Company adoption -> `COMPANY_ACCOUNTING_CHART` by company/year/date.
- Legacy `account -> treatment` -> split into
  `ACCOUNT_FISCAL_MAPPING -> FISCAL_NATURE -> FISCAL_RULE`.
- Company-specific account classification -> `COMPANY_ACCOUNT_MAPPING_OVERRIDE`.
- Company-specific fiscal treatment -> `COMPANY_RULE_OVERRIDE`.
- Excel 2025 reconciliation -> golden/regression evidence only.

## Recommended Load Strategy

1. Do not load the full matrix yet.
2. Recover or receive the 3.014 source dataset/diff and reconcile the
   9-account delta.
3. Freeze a versioned ERP-agnostic `ACCOUNTING_CHART` code outside the engine.
4. Create `COMPANY_ACCOUNTING_CHART` links for Raiz companies and fiscal years.
5. Migrate only approved fiscal classifications into `FISCAL_NATURE`,
   `ACCOUNT_FISCAL_MAPPING`, and `FISCAL_RULE`.
6. Keep assisted suggestions in a review queue/staging dataset; do not promote
   them automatically.
7. Use `RULE_EXECUTION_RESULT` and `TAX_ADJUSTMENT` only after
   `SOURCE_SNAPSHOT`-backed execution.
8. Keep the 2025 Excel reconciliation as regression/golden evidence, not as
   matrix classification authority.

## Pending Human Decisions

- Provide or recover the 3.014 dataset or the exact 9-account delta.
- Confirm whether the handoff distribution `395/27/9/22/1` has an approved file
  of record.
- Approve or reject each assisted classification batch.
- Decide policy for each non-`FULL_ACCOUNT` bucket before implementing
  additional executors.
- Confirm whether `Brindes - Escolas` should share `BRINDES` in the official
  matrix.

## Inventory

See `data/fiscal/matrix-migration-inventory.json` for per-file path, format,
size, SHA-256, apparent purpose, record count, main fields, confidence, and
migration decision.
