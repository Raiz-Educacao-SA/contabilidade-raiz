import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../lib/data-engine-statements.ts", import.meta.url);

test("pagina movimentos do Data Engine e agrupa contas sem expor o token", async () => {
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
    accessToken: "short-lived-token",
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
  assert.equal(requests[0].headers.get("authorization"), "Bearer short-lived-token");
  assert.equal(requests[0].headers.has("x-api-key"), false);
  assert.equal(requests[0].url.pathname, "/v1/tesouraria/extratos/movimentos");
  assert.equal(requests[0].url.searchParams.get("cod_coligada"), "10");
  assert.equal(requests[0].url.searchParams.get("from_date"), "2026-08-01");
  assert.equal(requests[0].url.searchParams.get("to_date"), "2026-08-31");
  assert.equal(requests[0].url.searchParams.get("limit"), "200");
  assert.equal(requests[0].url.searchParams.has("cursor"), false);
  assert.equal(requests[0].url.searchParams.has("next_cursor"), false);
  assert.equal(requests[1].url.searchParams.get("cursor"), "cursor-2");
  assert.equal(requests[1].url.searchParams.has("next_cursor"), false);
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
  assert.equal(JSON.stringify(result).includes("short-lived-token"), false);
});

test("preserva o zero à esquerda da coligada na consulta", async () => {
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  let requestedUrl: URL | undefined;

  await loadDataEngineStatements({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    codColigadaCode: "03",
    fetcher: async (input: RequestInfo | URL) => {
      requestedUrl = new URL(String(input));
      return Response.json({ items: [], next_cursor: null });
    },
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
  });

  assert.equal(requestedUrl?.searchParams.get("cod_coligada"), "03");
});

test("consulta as cinco operações governadas sem devolver a credencial", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);
  const requestedPaths: string[] = [];

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 10,
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer short-lived-token",
      );
      assert.equal(new Headers(init?.headers).has("x-api-key"), false);
      const itemByPath: Record<string, object> = {
        "/v1/tesouraria/extratos/saldos": {
          saldo_id: "saldo-1",
          cod_coligada: 10,
        },
        "/v1/tesouraria/extratos/posicoes": {
          posicao_aplicacao_id: "posicao-1",
          cod_coligada: 10,
        },
        "/v1/tesouraria/extratos/cobertura": {
          cobertura_ref: "cobertura-1",
          cod_coligada: 10,
        },
        "/v1/tesouraria/extratos/pendencias": {
          pendencia_id: "pendencia-1",
          cod_coligada: 10,
        },
      };
      return Response.json({
        items: itemByPath[url.pathname] ? [itemByPath[url.pathname]] : [],
        next_cursor: null,
      });
    },
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
  });

  assert.deepEqual(requestedPaths.sort(), [
    "/v1/tesouraria/extratos/cobertura",
    "/v1/tesouraria/extratos/movimentos",
    "/v1/tesouraria/extratos/pendencias",
    "/v1/tesouraria/extratos/posicoes",
    "/v1/tesouraria/extratos/saldos",
  ]);
  assert.deepEqual(result.operations, {
    cobertura: 1,
    movimentos: 0,
    pendencias: 1,
    posicoes: 1,
    saldos: 1,
  });
  assert.equal(JSON.stringify(result).includes("short-lived-token"), false);
});

test("rejeita qualquer operação que devolva outra coligada", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);

  await assert.rejects(
    loadDataEngineStatementSnapshot({
      accessToken: "short-lived-token",
      baseUrl: "https://data-engine.example",
      codColigada: 10,
      fetcher: async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        return Response.json({
          items:
            url.pathname === "/v1/tesouraria/extratos/cobertura"
              ? [{ cobertura_ref: "fora-do-tenant", cod_coligada: 11 }]
              : [],
          next_cursor: null,
        });
      },
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    }),
    /resposta inválida/i,
  );
});

test("interrompe paginação quando o cursor se repete", async () => {
  assert.equal(existsSync(moduleUrl), true, "Data Engine statements adapter is missing");
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  let requests = 0;
  await assert.rejects(
    loadDataEngineStatements({
      accessToken: "short-lived-token",
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
      accessToken: "short-lived-token",
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
