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

test("reconhece extrato de aplicação pelas posições mesmo sem movimentos", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    codColigadaCode: "03",
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/posicoes"
            ? [
                {
                  posicao_aplicacao_id: "posicao-1",
                  cod_coligada: 3,
                  bank_id: "341",
                  source_account_id: "aplicacao-itau",
                  data_posicao: "2026-05-31",
                  nome_produto: "CDB",
                  numero_conta: "29165-8",
                },
              ]
            : [],
        next_cursor: null,
      });
    },
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });

  assert.equal(result.statements.length, 1);
  assert.deepEqual(result.statements[0], {
    bankId: "341",
    sourceAccountId: "aplicacao-itau",
    rows: [],
    metadata: {
      account: "29165-8",
      agency: "",
      closingBalance: null,
      name: "Aplicação · CDB",
      openingBalance: null,
      period: "05/2026",
    },
  });
  assert.equal(result.operations.posicoes, 1);
  assert.equal(result.operations.movimentos, 0);
});

test("reconhece a aplicação quando a posição não traz source_account_id", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    codColigadaCode: "03",
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/posicoes"
            ? [
                {
                  posicao_aplicacao_id: "posicao-1",
                  cod_coligada: 3,
                  data_base: "2026-05-31",
                },
              ]
            : [],
        next_cursor: null,
      });
    },
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });

  assert.equal(result.statements.length, 1);
  assert.equal(result.statements[0].sourceAccountId, "aplicacao:posicao");
  assert.equal(result.statements[0].metadata.account, "Aplicação");
  assert.equal(result.statements[0].metadata.name, "Aplicação financeira");
});

test("agrupa posições da mesma aplicação sem criar extratos duplicados", async () => {
  const { mergeApplicationPositionStatements } = await import(moduleUrl.href);

  const result = mergeApplicationPositionStatements(
    [],
    [
      {
        posicao_aplicacao_id: "posicao-1",
        cod_coligada: 3,
        data_posicao: "2026-05-15",
      },
      {
        posicao_aplicacao_id: "posicao-2",
        cod_coligada: 3,
        data_posicao: "2026-05-31",
      },
    ],
    { fromDate: "2026-05-01", toDate: "2026-05-31" },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].sourceAccountId, "aplicacao:posicao");
});

test("reconhece aplicação presente em saldos mesmo sem posição ou movimento", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    codColigadaCode: "03",
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/saldos"
            ? [
                {
                  saldo_id: "saldo-aplicacao",
                  cod_coligada: 3,
                  source_account_id: "aplicacao-saldo",
                  bank_id: "341",
                  data_referencia: "2026-05-31",
                  nome_produto: "Aplicação automática",
                  numero_conta: "29165-8",
                },
              ]
            : [],
        next_cursor: null,
      });
    },
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });

  assert.equal(result.statements.length, 1);
  assert.equal(result.statements[0].sourceAccountId, "aplicacao-saldo");
  assert.deepEqual(result.diagnostics.sourceCandidates, {
    saldos: 1,
    posicoes: 0,
    cobertura: 0,
  });
  assert.equal(result.diagnostics.recognizedWithoutMovements, 1);
});

test("reconhece fonte de aplicação registrada somente na cobertura", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/cobertura"
            ? [
                {
                  cobertura_ref: "cobertura-aplicacao",
                  cod_coligada: 3,
                  source_account_id: "aplicacao-cobertura",
                  competencia: "2026-05",
                  nome_aplicacao: "Fundo DI",
                },
              ]
            : [],
        next_cursor: null,
      });
    },
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });

  assert.equal(result.statements.length, 1);
  assert.equal(result.statements[0].sourceAccountId, "aplicacao-cobertura");
  assert.equal(result.diagnostics.sourceCandidates.cobertura, 1);
});

test("não duplica a aplicação quando a mesma fonte já possui movimentos", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/tesouraria/extratos/movimentos") {
        return Response.json({
          items: [
            {
              movimento_id: "mov-aplicacao",
              cod_coligada: 3,
              bank_id: "341",
              source_account_id: "aplicacao-itau",
              data_lancamento: "2026-05-31",
              valor_centavos: 1250,
              natureza: "C",
              descricao_sanitizada: "RENDIMENTO",
            },
          ],
          next_cursor: null,
        });
      }
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/posicoes"
            ? [
                {
                  posicao_aplicacao_id: "posicao-1",
                  cod_coligada: 3,
                  bank_id: "341",
                  source_account_id: "aplicacao-itau",
                },
              ]
            : [],
        next_cursor: null,
      });
    },
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });

  assert.equal(result.statements.length, 1);
  assert.equal(result.statements[0].rows.length, 1);
  assert.equal(result.operations.posicoes, 1);
  assert.equal(result.operations.movimentos, 1);
});

test("vincula a posição de aplicação restante depois das contas bancárias", async () => {
  const { mergeApplicationPositionStatements, resolveStatementBindings } =
    await import(moduleUrl.href);
  const source = (bankId: string, sourceAccountId: string, value: number) => ({
    bankId,
    sourceAccountId,
    rows: [
      {
        id: `mov-${sourceAccountId}`,
        date: "2026-05-15",
        description: "MOVIMENTO",
        value,
      },
    ],
    metadata: {
      account: sourceAccountId,
      agency: "",
      closingBalance: null,
      name: `Banco ${bankId}`,
      openingBalance: null,
      period: "05/2026",
    },
  });
  const sources = mergeApplicationPositionStatements(
    [source("341", "itau-corrente", -350), source("033", "santander", -900)],
    [
      {
        posicao_aplicacao_id: "posicao-1",
        cod_coligada: 3,
        source_account_id: "investimento",
        data_posicao: "2026-05-31",
        nome_produto: "Aplicação automática",
      },
    ],
    { fromDate: "2026-05-01", toDate: "2026-05-31" },
  );
  const accounts = [
    {
      code: "1.1.1.02.01.23",
      name: "Banco Itaú S/A - conta corrente",
      rows: [{ date: new Date("2026-05-15T00:00:00.000Z"), value: -350 }],
    },
    {
      code: "1.1.1.02.03.03",
      name: "Banco Santander - conta corrente",
      rows: [{ date: new Date("2026-05-15T00:00:00.000Z"), value: -900 }],
    },
    {
      code: "1.1.1.03.01.01",
      name: "Aplicações financeiras",
      rows: [],
    },
  ];

  const resolved = resolveStatementBindings(sources, accounts);

  assert.equal(resolved.pairs.length, 3);
  assert.deepEqual(resolved.unmatchedAccounts, []);
  assert.deepEqual(resolved.unmatchedSources, []);
  assert.equal(
    resolved.pairs.find(
      (pair: { source: { sourceAccountId: string } }) =>
        pair.source.sourceAccountId === "investimento",
    )?.account.code,
    "1.1.1.03.01.01",
  );
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

test("identifica automaticamente uma correspondência única e aponta coberturas ausentes", async () => {
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
  const accounts = [{ code: "1.1.1", name: "Banco Itaú conta cccccccccccc", rows: [] }];

  const identified = resolveStatementBindings([source], accounts);
  assert.equal(identified.pairs.length, 1);
  assert.deepEqual(identified.unmatchedSources, []);
  assert.deepEqual(identified.unmatchedAccounts, []);

  const duplicateSource = {
    ...source,
    sourceAccountId: "d".repeat(64),
    metadata: { ...source.metadata, account: "dddddddddddd" },
  };
  const uncovered = resolveStatementBindings([source, duplicateSource], accounts);
  assert.equal(uncovered.pairs.length, 1);
  assert.equal(uncovered.unmatchedSources.length, 1);
  assert.deepEqual(uncovered.unmatchedAccounts, []);
});

test("distingue contas Santander pelo conjunto de datas e valores dos movimentos", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const source = (reference: string, value: number) => ({
    bankId: "033",
    sourceAccountId: reference.repeat(64),
    rows: [
      {
        date: "2026-06-12",
        description: "MOVIMENTO SANTANDER",
        id: `mov-${reference}`,
        value,
      },
    ],
    metadata: {
      account: reference.repeat(12),
      agency: "",
      closingBalance: null,
      name: "Banco 033",
      openingBalance: null,
      period: "06/2026",
    },
  });
  const accounts = [
    {
      code: "1.1.1.02.01.10",
      name: "Banco Santander S/A - conta 1001-0",
      rows: [{ date: new Date("2026-06-12T00:00:00.000Z"), value: -350 }],
    },
    {
      code: "1.1.1.02.01.11",
      name: "Banco Santander S/A - conta 2002-0",
      rows: [{ date: new Date("2026-06-12T00:00:00.000Z"), value: -900 }],
    },
  ];

  const identified = resolveStatementBindings(
    [source("a", -350), source("b", -900)],
    accounts,
  );

  assert.deepEqual(
    identified.pairs.map(
      ({ account, source: statement }: {
        account: { code: string };
        source: { sourceAccountId: string };
      }) => [account.code, statement.sourceAccountId.slice(0, 1)],
    ),
    [
      ["1.1.1.02.01.10", "a"],
      ["1.1.1.02.01.11", "b"],
    ],
  );
  assert.deepEqual(identified.unmatchedSources, []);
  assert.deepEqual(identified.unmatchedAccounts, []);
});

test("mantém Santander sem vínculo quando os movimentos continuam ambíguos", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const source = {
    bankId: "33",
    sourceAccountId: "s".repeat(64),
    rows: [
      {
        date: "2026-06-12",
        description: "TARIFA",
        id: "mov-s",
        value: -35,
      },
    ],
    metadata: {
      account: "s".repeat(12),
      agency: "",
      closingBalance: null,
      name: "Banco 33",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const accounts = [
    {
      code: "1.1.1.02.01.10",
      name: "Santander conta A",
      rows: [{ date: new Date("2026-06-12T00:00:00.000Z"), value: -35 }],
    },
    {
      code: "1.1.1.02.01.11",
      name: "Santander conta B",
      rows: [{ date: new Date("2026-06-12T00:00:00.000Z"), value: -35 }],
    },
  ];

  const identified = resolveStatementBindings([source], accounts);

  assert.equal(identified.pairs.length, 0);
  assert.equal(identified.unmatchedSources.length, 1);
  assert.equal(identified.unmatchedAccounts.length, 2);
});
