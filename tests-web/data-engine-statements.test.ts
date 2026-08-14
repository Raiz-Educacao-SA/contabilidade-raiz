import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../lib/data-engine-statements.ts", import.meta.url);

test("pagina movimentos do Data Engine e agrupa contas sem expor a chave", async () => {
  assert.equal(existsSync(moduleUrl), true, "Data Engine statements adapter is missing");
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  const requests: Array<{ headers: Headers; url: URL }> = [];
  const pages = [
    {
      items: [
        {
          movimento_id: "mov-1",
          cod_coligada: 10,
          bank_id: "341",
          source_account_id: "a".repeat(64),
          canonical_movement_id: "canonical-1",
          data_lancamento: "2026-08-03",
          valor_centavos: 12345,
          natureza: "D",
          descricao_sanitizada: "MOVIMENTO-ABC",
          documento_hash: "doc-1",
          canal: "legacy_file",
        },
      ],
      next_cursor: "cursor-2",
    },
    {
      items: [
        {
          movimento_id: "mov-2",
          cod_coligada: 10,
          bank_id: "341",
          source_account_id: "a".repeat(64),
          canonical_movement_id: "canonical-2",
          data_lancamento: "2026-08-04",
          valor_centavos: 5000,
          natureza: "C",
          descricao_sanitizada: "MOVIMENTO-DEF",
          documento_hash: "doc-2",
          canal: "legacy_file",
        },
      ],
      next_cursor: null,
    },
  ];

  const result = await loadDataEngineStatements({
    apiKey: "server-secret",
    baseUrl: "https://data-engine.example",
    codColigada: 10,
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ headers: new Headers(init?.headers), url: new URL(String(input)) });
      return Response.json(pages[requests.length - 1]);
    },
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.get("x-api-key"), "server-secret");
  assert.equal(requests[0].url.pathname, "/v1/tesouraria/extratos/movimentos");
  assert.equal(requests[0].url.searchParams.get("cod_coligada"), "10");
  assert.equal(requests[0].url.searchParams.get("from_date"), "2026-08-01");
  assert.equal(requests[0].url.searchParams.get("to_date"), "2026-08-31");
  assert.equal(requests[0].url.searchParams.get("limit"), "200");
  assert.equal(requests[1].url.searchParams.get("cursor"), "cursor-2");
  assert.deepEqual(result, [
    {
      bankId: "341",
      metadata: {
        account: "aaaaaaaaaaaa",
        agency: "",
        closingBalance: null,
        name: "Banco 341",
        openingBalance: null,
        period: "08/2026",
      },
      rows: [
        { date: "2026-08-03", description: "MOVIMENTO-ABC", id: "mov-1", value: -123.45 },
        { date: "2026-08-04", description: "MOVIMENTO-DEF", id: "mov-2", value: 50 },
      ],
      sourceAccountId: "a".repeat(64),
    },
  ]);
  assert.equal(JSON.stringify(result).includes("server-secret"), false);
});

test("interrompe paginação quando o cursor se repete", async () => {
  assert.equal(existsSync(moduleUrl), true, "Data Engine statements adapter is missing");
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  let requests = 0;
  await assert.rejects(
    loadDataEngineStatements({
      apiKey: "server-secret",
      baseUrl: "https://data-engine.example",
      codColigada: 10,
      fetcher: async () => {
        requests += 1;
        return Response.json({ items: [], next_cursor: "repeated" });
      },
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    }),
    /cursor de paginação repetido/i,
  );
  assert.equal(requests, 2);
});

test("rejeita movimento fora da competência solicitada", async () => {
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  await assert.rejects(
    loadDataEngineStatements({
      apiKey: "server-secret",
      baseUrl: "https://data-engine.example",
      codColigada: 10,
      fetcher: async () =>
        Response.json({
          items: [
            {
              movimento_id: "mov-outside-period",
              cod_coligada: 10,
              bank_id: "341",
              source_account_id: "b".repeat(64),
              data_lancamento: "2026-09-01",
              valor_centavos: 100,
              natureza: "C",
              descricao_sanitizada: "MOVIMENTO-FORA",
            },
          ],
          next_cursor: null,
        }),
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    }),
    /resposta inválida/i,
  );
});

test("exige vínculo explícito e rejeita duas fontes na mesma conta", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const source = {
    bankId: "341",
    sourceAccountId: "c".repeat(64),
    rows: [],
    metadata: {
      account: "cccccccccccc",
      agency: "",
      closingBalance: null,
      name: "Banco 341",
      openingBalance: null,
      period: "08/2026",
    },
  };
  const accounts = [{ code: "1.1.1", name: "Banco", rows: [] }];

  assert.deepEqual(resolveStatementBindings([source], accounts, {}), {
    duplicateAccountCodes: [],
    pairs: [],
  });

  const duplicateSource = {
    ...source,
    sourceAccountId: "d".repeat(64),
    metadata: { ...source.metadata, account: "dddddddddddd" },
  };
  assert.deepEqual(
    resolveStatementBindings([source, duplicateSource], accounts, {
      [source.sourceAccountId]: "1.1.1",
      [duplicateSource.sourceAccountId]: "1.1.1",
    }),
    { duplicateAccountCodes: ["1.1.1"], pairs: [] },
  );
});
