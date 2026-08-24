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

test("prioriza Excel e não duplica o mesmo movimento presente também no PDF", async () => {
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  const sourceAccountId = "itau-coligada-03";

  const result = await loadDataEngineStatements({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    fetcher: async () =>
      Response.json({
        items: [
          {
            movimento_id: "mov-pdf-351",
            canonical_movement_id: "itau-tarifa-pdf-2026-06-02-351",
            cod_coligada: 3,
            bank_id: "341",
            source_account_id: sourceAccountId,
            data_lancamento: "2026-06-02",
            valor_centavos: 35100,
            natureza: "D",
            descricao_sanitizada: "TARIFA DE CONTA CORRENTE MENSAL",
            documento_hash: "documento-bancario-351",
            file_name: "extrato-itau-junho.pdf",
          },
          {
            movimento_id: "mov-excel-351",
            canonical_movement_id: "itau-tarifa-excel-2026-06-02-351",
            cod_coligada: 3,
            bank_id: "341",
            source_account_id: sourceAccountId,
            data_lancamento: "2026-06-02",
            valor_centavos: 35100,
            natureza: "D",
            descricao_sanitizada: "TARIFA DE CONTA CORRENTE MENSAL",
            documento_hash: "documento-bancario-351",
            file_name: "extrato-itau-junho.xlsx",
          },
        ],
        next_cursor: null,
      }),
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].rows, [
    {
      date: "2026-06-02",
      description: "TARIFA DE CONTA CORRENTE MENSAL",
      id: "mov-excel-351",
      value: -351,
    },
  ]);
});

test("não duplica o mesmo movimento quando os identificadores técnicos são diferentes", async () => {
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  const sourceAccountId = "itau-coligada-03";
  const movement = {
    cod_coligada: 3,
    bank_id: "341",
    source_account_id: sourceAccountId,
    data_lancamento: "2026-06-02",
    valor_centavos: 35100,
    natureza: "D",
    descricao_sanitizada: "TARIFA DE CONTA CORRENTE MENSAL",
  } as const;

  const result = await loadDataEngineStatements({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    fetcher: async () =>
      Response.json({
        items: [
          {
            ...movement,
            movimento_id: "mov-origem-1",
            canonical_movement_id: "canonical-origem-1",
            documento_hash: "documento-origem-1",
          },
          {
            ...movement,
            movimento_id: "mov-origem-2",
            canonical_movement_id: "canonical-origem-2",
            documento_hash: "documento-origem-2",
          },
        ],
        next_cursor: null,
      }),
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].rows, [
    {
      date: "2026-06-02",
      description: "TARIFA DE CONTA CORRENTE MENSAL",
      id: "mov-origem-1",
      value: -351,
    },
  ]);
});

test("não duplica Excel e PDF quando ambos chegam com históricos técnicos distintos", async () => {
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  const sourceAccountId = "itau-coligada-03";
  const movement = {
    cod_coligada: 3,
    bank_id: "341",
    source_account_id: sourceAccountId,
    data_lancamento: "2026-06-02",
    valor_centavos: 35100,
    natureza: "D",
  } as const;

  const result = await loadDataEngineStatements({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    fetcher: async () =>
      Response.json({
        items: [
          {
            ...movement,
            movimento_id: "mov-pdf-351",
            descricao_sanitizada: "MOVIMENTO-34283A563A842164ACFF67BE",
          },
          {
            ...movement,
            movimento_id: "mov-excel-351",
            descricao_sanitizada: "MOVIMENTO-5D36A68F91C0B5421E7A390F",
          },
        ],
        next_cursor: null,
      }),
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].rows, [
    {
      date: "2026-06-02",
      description: "MOVIMENTO-34283A563A842164ACFF67BE",
      id: "mov-pdf-351",
      value: -351,
    },
  ]);
});

test("mantém dois lançamentos reais de mesmo valor e data quando os históricos diferem", async () => {
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  const sourceAccountId = "itau-coligada-03";

  const result = await loadDataEngineStatements({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    fetcher: async () =>
      Response.json({
        items: [
          {
            movimento_id: "mov-tarifa-1",
            cod_coligada: 3,
            bank_id: "341",
            source_account_id: sourceAccountId,
            data_lancamento: "2026-06-02",
            valor_centavos: 35100,
            natureza: "D",
            descricao_sanitizada: "TARIFA DE CONTA CORRENTE MENSAL",
          },
          {
            movimento_id: "mov-pagamento-2",
            cod_coligada: 3,
            bank_id: "341",
            source_account_id: sourceAccountId,
            data_lancamento: "2026-06-02",
            valor_centavos: 35100,
            natureza: "D",
            descricao_sanitizada: "PAGAMENTO FORNECEDOR",
          },
        ],
        next_cursor: null,
      }),
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].rows.length, 2);
});

test("descarta movimentos do PDF quando a cobertura identifica Excel para a mesma conta", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);
  const sourceAccountId = "itau-coligada-03";

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
              movimento_id: "movimento-excel",
              canonical_movement_id: "canonical-excel",
              cod_coligada: 3,
              bank_id: "341",
              source_account_id: sourceAccountId,
              processing_identity_id: "processamento-excel",
              data_lancamento: "2026-06-02",
              valor_centavos: 35100,
              natureza: "D",
              descricao_sanitizada: "TARIFA DE CONTA CORRENTE MENSAL",
            },
            {
              movimento_id: "movimento-pdf",
              canonical_movement_id: "canonical-pdf",
              cod_coligada: 3,
              bank_id: "341",
              source_account_id: sourceAccountId,
              processing_identity_id: "processamento-pdf",
              data_lancamento: "2026-06-02",
              valor_centavos: 35100,
              natureza: "D",
              descricao_sanitizada: "MOVIMENTO-34283A563A842164ACFF67BE",
            },
          ],
          next_cursor: null,
        });
      }
      if (url.pathname === "/v1/tesouraria/extratos/cobertura") {
        return Response.json({
          items: [
            {
              cod_coligada: 3,
              source_account_id: sourceAccountId,
              processing_identity_id: "processamento-excel",
              evidence_ref: "arquivos/extrato-itau-junho.xlsx",
            },
            {
              cod_coligada: 3,
              source_account_id: sourceAccountId,
              processing_identity_id: "processamento-pdf",
              evidence_ref: "arquivos/extrato-itau-junho.pdf",
            },
          ],
          next_cursor: null,
        });
      }
      return Response.json({ items: [], next_cursor: null });
    },
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.statements.length, 1);
  assert.deepEqual(result.statements[0].rows, [
    {
      date: "2026-06-02",
      description: "TARIFA DE CONTA CORRENTE MENSAL",
      id: "movimento-excel",
      value: -351,
    },
  ]);
  assert.equal(result.operations.movimentos, 1);
});

test("prefere o histórico real ao movimento genérico do PDF quando a origem não é informada", async () => {
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  const sourceAccountId = "itau-coligada-03";

  const result = await loadDataEngineStatements({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    fetcher: async () =>
      Response.json({
        items: [
          {
            movimento_id: "movimento-pdf-generico",
            canonical_movement_id: "canonical-pdf-generico",
            documento_hash: "documento-pdf-generico",
            cod_coligada: 3,
            bank_id: "341",
            source_account_id: sourceAccountId,
            data_lancamento: "2026-06-02",
            valor_centavos: 35100,
            natureza: "D",
            descricao_sanitizada: "MOVIMENTO-34283A563A842164ACFF67BE",
          },
          {
            movimento_id: "movimento-excel-descritivo",
            canonical_movement_id: "canonical-excel-descritivo",
            documento_hash: "documento-excel-descritivo",
            cod_coligada: 3,
            bank_id: "341",
            source_account_id: sourceAccountId,
            data_lancamento: "2026-06-02",
            valor_centavos: 35100,
            natureza: "D",
            descricao_sanitizada: "TARIFA DE CONTA CORRENTE MENSAL",
          },
        ],
        next_cursor: null,
      }),
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.deepEqual(result[0].rows, [
    {
      date: "2026-06-02",
      description: "TARIFA DE CONTA CORRENTE MENSAL",
      id: "movimento-excel-descritivo",
      value: -351,
    },
  ]);
});

test("mantém movimentos legítimos de mesmo valor quando a descrição é diferente", async () => {
  const { loadDataEngineStatements } = await import(moduleUrl.href);
  const sourceAccountId = "itau-coligada-03";
  const movement = {
    cod_coligada: 3,
    bank_id: "341",
    source_account_id: sourceAccountId,
    data_lancamento: "2026-06-02",
    valor_centavos: 35100,
    natureza: "D",
    file_name: "extrato-itau-junho.xlsx",
  } as const;

  const result = await loadDataEngineStatements({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 3,
    fetcher: async () =>
      Response.json({
        items: [
          {
            ...movement,
            movimento_id: "mov-legitimo-1",
            canonical_movement_id: "canonical-legitimo-1",
            documento_hash: "documento-legitimo-1",
            descricao_sanitizada: "TARIFA BANCÁRIA MENSAL",
          },
          {
            ...movement,
            movimento_id: "mov-legitimo-2",
            canonical_movement_id: "canonical-legitimo-2",
            documento_hash: "documento-legitimo-2",
            descricao_sanitizada: "TARIFA DE COBRANÇA",
          },
        ],
        next_cursor: null,
      }),
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].rows.length, 2);
  assert.equal(
    result[0].rows.reduce(
      (total: number, row: { value: number }) => total + row.value,
      0,
    ),
    -702,
  );
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
    pendenciasUtilizadas: 0,
    posicoes: 1,
    saldos: 1,
  });
  assert.equal(JSON.stringify(result).includes("short-lived-token"), false);
});

test("usa lançamentos completos das pendências quando a conta não veio em movimentos", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 2,
    codColigadaCode: "02",
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/pendencias"
            ? [
                {
                  pendencia_id: "sicoob-credito",
                  cod_coligada: 2,
                  bank_id: "756",
                  source_account_id: "sicoob-2035519",
                  data_lancamento: "2026-05-04",
                  valor_centavos: 150000,
                  natureza: "C",
                  descricao_sanitizada: "RECEBIMENTO",
                },
                {
                  pending_id: "sicoob-debito",
                  cod_coligada: 2,
                  codigo_banco: "0756",
                  bank_account_id: "sicoob-2035519",
                  transaction_date: "2026-05-05T10:30:00Z",
                  valor: "320,50",
                  tipo_movimento: "Débito",
                  historico: "PAGAMENTO",
                },
                {
                  pendencia_id: "sem-natureza",
                  cod_coligada: 2,
                  bank_id: "756",
                  source_account_id: "sicoob-2035519",
                  data_lancamento: "2026-05-06",
                  valor_centavos: 100,
                  descricao_sanitizada: "REGISTRO INCOMPLETO",
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
  assert.equal(result.statements[0].bankId, "756");
  assert.equal(result.statements[0].sourceAccountId, "sicoob-2035519");
  assert.deepEqual(
    result.statements[0].rows.map((row: { value: number }) => row.value),
    [1500, -320.5],
  );
  assert.equal(result.diagnostics.pendingMovementsUsed, 2);
  assert.equal(result.diagnostics.pendingSourcesUsed, 1);
  assert.equal(result.operations.movimentos, 0);
  assert.equal(result.operations.pendencias, 3);
  assert.equal(result.operations.pendenciasUtilizadas, 2);
});

test("prioriza movimentos e não duplica a conta com lançamentos das pendências", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 2,
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/tesouraria/extratos/movimentos") {
        return Response.json({
          items: [
            {
              movimento_id: "estruturado-1",
              cod_coligada: 2,
              bank_id: "756",
              source_account_id: "sicoob-2035519",
              data_lancamento: "2026-05-04",
              valor_centavos: 150000,
              natureza: "C",
              descricao_sanitizada: "RECEBIMENTO ESTRUTURADO",
            },
          ],
          next_cursor: null,
        });
      }
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/pendencias"
            ? [
                {
                  pendencia_id: "pdf-1",
                  cod_coligada: 2,
                  bank_id: "756",
                  source_account_id: "sicoob-2035519",
                  data_lancamento: "2026-05-05",
                  valor_centavos: 32050,
                  natureza: "D",
                  descricao_sanitizada: "PAGAMENTO PDF",
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
  assert.equal(result.statements[0].rows[0].id, "estruturado-1");
  assert.equal(result.diagnostics.pendingMovementsUsed, 0);
  assert.equal(result.operations.pendenciasUtilizadas, 0);
});

test("localiza lançamentos aninhados no documento PDF pendente", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 2,
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/pendencias"
            ? [
                {
                  pendencia_id: "pdf-sicoob",
                  cod_coligada: 2,
                  arquivo: {
                    nome_arquivo: "EXTRATO SICOOB MAIO 2026.pdf",
                    numero_conta: "2035519-0",
                  },
                  conteudo: {
                    lancamentos: [
                      {
                        data_transacao: "2026-05-08",
                        valor_credito: "1.250,00",
                        historico: "RECEBIMENTO",
                      },
                      {
                        posting_date: "2026-05-09",
                        debit_amount: 75.5,
                        documento_historico: "TARIFA",
                      },
                    ],
                  },
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
  assert.equal(result.statements[0].bankId, "756");
  assert.deepEqual(
    result.statements[0].rows.map((row: { value: number }) => row.value),
    [1250, -75.5],
  );
  assert.ok(result.diagnostics.pendingObjectsInspected >= 5);
  assert.ok(result.diagnostics.pendingFieldsObserved.includes("lancamentos"));
  assert.equal(result.diagnostics.pendingMovementsUsed, 2);
  assert.equal(result.diagnostics.pendingSourcesUsed, 1);
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

test("usa os movimentos do extrato de aplicação e prioriza o valor líquido creditado", async () => {
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
                  posicao_aplicacao_id: "movimento-1",
                  cod_coligada: 3,
                  bank_id: "033",
                  source_account_id: "aplicacao-santander",
                  data_movimento: "01/06/2026",
                  numero_aplicacao: "00333003",
                  valor_principal_resgatado: "520,02",
                  resgates_brutos: "520,04",
                  valor_liquido_creditado: "520,03",
                  nome_produto: "ContaMax",
                  numero_conta: "13081471-7",
                },
                {
                  posicao_aplicacao_id: "movimento-2",
                  cod_coligada: 3,
                  bank_id: "033",
                  source_account_id: "aplicacao-santander",
                  data_movimento: "08/06/2026",
                  numero_aplicacao: "00333003",
                  aplicacoes: "4.378,00",
                  nome_produto: "ContaMax",
                  numero_conta: "13081471-7",
                },
                {
                  posicao_aplicacao_id: "movimento-3",
                  cod_coligada: 3,
                  bank_id: "033",
                  source_account_id: "aplicacao-santander",
                  data_movimento: "10/06/2026",
                  numero_aplicacao: "00333003",
                  valor_principal_resgatado: "788,05",
                  nome_produto: "ContaMax",
                  numero_conta: "13081471-7",
                },
              ]
            : [],
        next_cursor: null,
      });
    },
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.statements.length, 1);
  assert.equal(result.statements[0].bankId, "033");
  assert.equal(result.statements[0].metadata.name, "Aplicação · ContaMax");
  assert.deepEqual(
    result.statements[0].rows.map((row: { date: string; value: number }) => ({
      date: row.date,
      value: row.value,
    })),
    [
      { date: "2026-06-01", value: -520.03 },
      { date: "2026-06-08", value: 4378 },
      { date: "2026-06-10", value: -788.05 },
    ],
  );
  assert.equal(result.diagnostics.recognizedWithoutMovements, 0);
  assert.equal(result.diagnostics.applicationMovementsUsed, 3);
  assert.ok(result.diagnostics.positionFieldsObserved.includes("data_movimento"));
});

test("soma no dia 01/06 os valores líquidos do extrato de movimento Santander", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);
  const values = [
    ["movimento-1", "1.494,51", "1.494,52"],
    ["movimento-2", "1.890,97", "1.890,98"],
    ["movimento-3", "38.316,60", "38.316,63"],
  ];

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 9,
    codColigadaCode: "09",
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/posicoes"
            ? values.map(([id, principal, liquid]) => ({
                posicao_aplicacao_id: id,
                cod_coligada: 9,
                bank_id: "033",
                source_account_id: "aplicacao-santander-global-tree",
                data_movimento: "01/06/2026",
                numero_aplicacao: "00333003",
                valor_principal_resgatado: principal,
                valor_liquido_creditado: liquid,
                nome_produto: "ContaMax",
                numero_conta: "13082100-5",
              }))
            : [],
        next_cursor: null,
      });
    },
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.statements.length, 1);
  assert.equal(
    Math.round(
      result.statements[0].rows.reduce(
        (total: number, row: { value: number }) => total + row.value,
        0,
      ) * 100,
    ) / 100,
    -41702.13,
  );
});

test("preserva os lançamentos do extrato quando o contrato de posições traz apenas saldos", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);
  const processingIdentity = "processamento-aplicacao-global-tree";
  const positionRows: Array<[string, string, number]> = [
    ["pos-1", "2026-06-01T00:00:00Z", 149452],
    ["pos-2", "2026-06-01T00:00:00Z", 189098],
    ["pos-3", "2026-06-01T00:00:00Z", 3831663],
    ["pos-4", "2026-06-08T00:00:00Z", -10000000],
  ];

  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 9,
    codColigadaCode: "09",
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/tesouraria/extratos/movimentos") {
        return Response.json({
          items: [
            {
              movimento_id: "pdf-incompleto-1",
              cod_coligada: 9,
              bank_id: "033",
              source_account_id: "pdf-santander-misturado",
              processing_identity_id: processingIdentity,
              data_lancamento: "2026-06-01",
              valor_centavos: 4149133,
              natureza: "D",
              descricao_sanitizada: "MOVIMENTO-PDF-INCOMPLETO",
              source_format: "pdf",
            },
          ],
          next_cursor: null,
        });
      }
      return Response.json({
        items:
          url.pathname === "/v1/tesouraria/extratos/posicoes"
            ? positionRows.map(([id, positionAt, netAmount]) => ({
                posicao_aplicacao_id: id,
                cod_coligada: 9,
                source_account_id: "pdf-santander-misturado",
                processing_identity_id: processingIdentity,
                product_ref_hash: "contamax-00333003",
                position_at: positionAt,
                gross_amount_centavos: netAmount,
                net_amount_centavos: netAmount,
              }))
            : [],
        next_cursor: null,
      });
    },
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.diagnostics.applicationMovementsUsed, 0);
  assert.equal(result.statements.length, 2);
  const currentStatement = result.statements.find(
    (statement: { sourceAccountId: string }) =>
      statement.sourceAccountId === "pdf-santander-misturado",
  );
  const applicationStatement = result.statements.find(
    (statement: { sourceAccountId: string }) =>
      statement.sourceAccountId ===
      "aplicacao:posicao:pdf-santander-misturado",
  );
  assert.equal(
    applicationStatement?.rows.length,
    0,
  );
  assert.equal(applicationStatement?.metadata.account, "Aplicação");
  assert.deepEqual(
    currentStatement?.rows.map((row: { date: string; value: number }) => ({
      date: row.date,
      value: row.value,
    })),
    [
      { date: "2026-06-01", value: -41491.33 },
    ],
  );
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

test("consolida referências técnicas diferentes da mesma aplicação anônima", async () => {
  const { mergeApplicationPositionStatements } = await import(moduleUrl.href);

  const result = mergeApplicationPositionStatements(
    [],
    [
      {
        cod_coligada: 3,
        source_account_id: "saldo-aplicacao",
        competencia: "2026-05",
      },
      {
        cod_coligada: 3,
        source_account_id: "cobertura-aplicacao",
        competencia: "2026-05",
      },
    ],
    { fromDate: "2026-05-01", toDate: "2026-05-31" },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].bankId, "000");
  assert.equal(result[0].metadata.account, "Aplicação");
});

test("vincula duas referências anônimas consolidadas à única conta de aplicação", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const anonymousSource = (sourceAccountId: string) => ({
    bankId: "000",
    sourceAccountId,
    rows: [],
    metadata: {
      account: "Aplicação",
      agency: "",
      closingBalance: null,
      name: "Aplicação financeira",
      openingBalance: null,
      period: "05/2026",
    },
  });

  const result = resolveStatementBindings(
    [
      anonymousSource("saldo-aplicacao"),
      anonymousSource("cobertura-aplicacao"),
      {
        ...anonymousSource("outra-fonte"),
        bankId: "999",
        metadata: {
          ...anonymousSource("outra-fonte").metadata,
          account: "Sem referência",
          name: "Outra fonte",
        },
      },
    ],
    [
      {
        code: "1.1.1.03.03.10",
        name: "Banco Santander - conta Aplic. 13081471-7 (Ox)",
        rows: [],
      },
      {
        code: "1.1.1.99.99.99",
        name: "Outra conta sem identificação",
        rows: [],
      },
    ],
  );

  assert.equal(result.pairs.length, 2);
  assert.equal(
    result.pairs.find((pair: { source: { sourceAccountId: string } }) =>
      pair.source.sourceAccountId === "saldo-aplicacao",
    )?.account.code,
    "1.1.1.03.03.10",
  );
  assert.equal(result.unmatchedAccounts.length, 0);
  assert.equal(result.unmatchedSources.length, 0);
});

test("pareia aplicação, conta corrente Santander e Sofisa sem misturar as fontes", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const statement = (
    bankId: string,
    sourceAccountId: string,
    value: number,
  ) => ({
    bankId,
    sourceAccountId,
    rows: [
      {
        date: "2026-05-15",
        description: `MOVIMENTO ${bankId}`,
        id: `mov-${sourceAccountId}`,
        value,
      },
    ],
    metadata: {
      account: "Sem número identificado",
      agency: "",
      closingBalance: null,
      name: `Banco ${bankId}`,
      openingBalance: null,
      period: "05/2026",
    },
  });
  const applicationSource = {
    ...statement("000", "aplicacao", 0),
    rows: [],
    metadata: {
      ...statement("000", "aplicacao", 0).metadata,
      account: "Aplicação",
      name: "Aplicação financeira",
    },
  };
  const accounts = [
    {
      code: "1.1.1.03.03.09",
      name: "Banco Santander - conta Aplic.13081360-6 (Raiz)",
      rows: [{ date: new Date("2026-05-15T00:00:00.000Z"), value: -100 }],
    },
    {
      code: "1.1.1.02.03.02",
      name: "Banco Santander - conta 13081360-6 (Raiz)",
      rows: [{ date: new Date("2026-05-20T00:00:00.000Z"), value: -100 }],
    },
    {
      code: "1.1.1.02.15.03",
      name: "Banco Sofisa - conta c/c 1013253 (Raiz Educação)",
      rows: [{ date: new Date("2026-05-15T00:00:00.000Z"), value: -200 }],
    },
  ];

  const result = resolveStatementBindings(
    [statement("033", "santander-corrente", -100), statement("637", "sofisa", -200), applicationSource],
    accounts,
  );

  assert.deepEqual(
    Object.fromEntries(
      result.pairs.map((pair: { account: { code: string }; source: { sourceAccountId: string } }) => [
        pair.source.sourceAccountId,
        pair.account.code,
      ]),
    ),
    {
      aplicacao: "1.1.1.03.03.09",
      "santander-corrente": "1.1.1.02.03.02",
      sofisa: "1.1.1.02.15.03",
    },
  );
  assert.deepEqual(result.unmatchedAccounts, []);
  assert.deepEqual(result.unmatchedSources, []);
});

test("separa o extrato de movimento da aplicação misturado à conta corrente Santander", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const row = (id: string, date: string, value: number) => ({
    id,
    date,
    description: `MOVIMENTO ${id}`,
    value,
  });
  const currentSource = {
    bankId: "033",
    sourceAccountId: "santander-compartilhado",
    rows: [
      row("corrente-01", "2026-06-01", 1000),
      row("aplicacao-01-a", "2026-06-01", -520.03),
      row("aplicacao-01-b", "2026-06-01", -479.97),
      row("corrente-05", "2026-06-05", 8.1),
      row("aplicacao-05", "2026-06-05", -8.1),
      row("aplicacao-08", "2026-06-08", 4378),
      row("corrente-08", "2026-06-08", -4378),
      row("aplicacao-30", "2026-06-30", 4000),
      row("corrente-30", "2026-06-30", -4000),
    ],
    metadata: {
      account: "referencia-tecnica",
      agency: "",
      closingBalance: null,
      name: "Banco 033",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const applicationSource = {
    bankId: "000",
    sourceAccountId: "aplicacao-posicao",
    rows: [],
    metadata: {
      account: "Aplicação",
      agency: "",
      closingBalance: null,
      name: "Aplicação financeira",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const accounts = [
    {
      code: "1.1.1.03.03.10",
      name: "Banco Santander - conta Aplic. 13081471-7 (Ox)",
      rows: [
        { date: new Date("2026-06-01T00:00:00.000Z"), value: -520.03 },
        { date: new Date("2026-06-01T00:00:00.000Z"), value: -479.97 },
        { date: new Date("2026-06-05T00:00:00.000Z"), value: -8.1 },
        { date: new Date("2026-06-08T00:00:00.000Z"), value: 4378 },
        { date: new Date("2026-06-30T00:00:00.000Z"), value: 4638.11 },
        { date: new Date("2026-06-30T00:00:00.000Z"), value: -637.82 },
      ],
    },
    {
      code: "1.1.1.02.03.03",
      name: "Banco Santander - conta 13081471-7 (Ox)",
      rows: [
        { date: new Date("2026-06-01T00:00:00.000Z"), value: 1000 },
        { date: new Date("2026-06-05T00:00:00.000Z"), value: 8.1 },
        { date: new Date("2026-06-08T00:00:00.000Z"), value: -4378 },
        { date: new Date("2026-06-30T00:00:00.000Z"), value: -4000 },
      ],
    },
  ];

  const result = resolveStatementBindings(
    [currentSource, applicationSource],
    accounts,
  );
  const application = result.pairs.find(
    (pair: { account: { code: string } }) =>
      pair.account.code === "1.1.1.03.03.10",
  );
  const current = result.pairs.find(
    (pair: { account: { code: string } }) =>
      pair.account.code === "1.1.1.02.03.03",
  );

  assert.equal(application?.source.bankId, "033");
  assert.deepEqual(
    application?.source.rows.map((item: { id: string }) => item.id),
    [
      "aplicacao-01-a",
      "aplicacao-01-b",
      "aplicacao-05",
      "aplicacao-08",
      "aplicacao-30",
    ],
  );
  assert.deepEqual(
    current?.source.rows.map((item: { id: string }) => item.id),
    ["corrente-01", "corrente-05", "corrente-08", "corrente-30"],
  );
  assert.deepEqual(result.unmatchedAccounts, []);
  assert.deepEqual(result.unmatchedSources, []);
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

test("não aceita separação parcial entre aplicação e conta corrente", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const source = {
    bankId: "033",
    sourceAccountId: "santander-compartilhado",
    rows: [
      { id: "aplicacao-1", date: "2026-06-01", description: "APLICAÇÃO", value: 100 },
      { id: "corrente-1", date: "2026-06-01", description: "CONTRAPARTIDA", value: -100 },
    ],
    metadata: {
      account: "referencia-tecnica",
      agency: "",
      closingBalance: null,
      name: "Banco 033",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const application = {
    bankId: "000",
    sourceAccountId: "aplicacao-posicao",
    rows: [],
    metadata: {
      account: "Aplicação",
      agency: "",
      closingBalance: null,
      name: "Aplicação financeira",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const result = resolveStatementBindings(
    [source, application],
    [
      {
        code: "1.1.1.03.03.20",
        name: "Banco Santander - conta Aplic. 12345-6",
        rows: [
          { date: "2026-06-01", value: 100 },
          { date: "2026-06-02", value: -90 },
        ],
      },
      {
        code: "1.1.1.02.03.20",
        name: "Banco Santander - conta 12345-6",
        rows: [],
      },
    ],
  );

  const applicationPair = result.pairs.find(
    (pair: { account: { code: string } }) => pair.account.code === "1.1.1.03.03.20",
  );
  const currentPair = result.pairs.find(
    (pair: { account: { code: string } }) => pair.account.code === "1.1.1.02.03.20",
  );
  assert.equal(applicationPair?.source.rows.length, 0);
  assert.equal(currentPair?.source.rows.length, 2);
});

test("separa somente os movimentos reais da aplicação e mantém o restante na conta corrente", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const applicationRows = [
    { id: "aplicacao-01-a", date: "2026-06-01", value: -1494.52 },
    { id: "aplicacao-01-b", date: "2026-06-01", value: -1890.98 },
    { id: "aplicacao-01-c", date: "2026-06-01", value: -38316.63 },
    { id: "aplicacao-24", date: "2026-06-24", value: -3933.11 },
    { id: "aplicacao-30-liquido", date: "2026-06-30", value: 4000 },
  ];
  const currentRows = [
    { id: "corrente-01", date: "2026-06-01", value: 210.8 },
    { id: "corrente-03", date: "2026-06-03", value: 876 },
    { id: "corrente-24", date: "2026-06-24", value: 11156 },
    { id: "corrente-29", date: "2026-06-29", value: 1040 },
  ];
  const currentSource = {
    bankId: "033",
    sourceAccountId: "santander-compartilhado",
    rows: [...applicationRows, ...currentRows].map((row) => ({
      ...row,
      description: "MOVIMENTO SANTANDER",
    })),
    metadata: {
      account: "12345-6",
      agency: "",
      closingBalance: null,
      name: "Banco 033",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const applicationSource = {
    bankId: "000",
    sourceAccountId: "aplicacao-posicao",
    rows: [],
    metadata: {
      account: "Aplicação",
      agency: "",
      closingBalance: null,
      name: "Aplicação financeira",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const result = resolveStatementBindings(
    [currentSource, applicationSource],
    [
      {
        code: "1.1.1.03.03.20",
        name: "Banco Santander - conta Aplic. 12345-6",
        rows: [
          { date: "2026-06-01", value: -1494.52 },
          { date: "2026-06-01", value: -1890.98 },
          { date: "2026-06-01", value: -38316.63 },
          { date: "2026-06-24", value: -3933.11 },
          { date: "2026-06-30", value: 4638.11 },
          { date: "2026-06-30", value: -637.82 },
        ],
      },
      {
        code: "1.1.1.02.03.20",
        name: "Banco Santander - conta 12345-6",
        rows: currentRows.map(({ date, value }) => ({ date, value })),
      },
    ],
  );

  const applicationPair = result.pairs.find(
    (pair: { account: { code: string } }) => pair.account.code === "1.1.1.03.03.20",
  );
  const currentPair = result.pairs.find(
    (pair: { account: { code: string } }) => pair.account.code === "1.1.1.02.03.20",
  );
  assert.deepEqual(
    applicationPair?.source.rows.map((row: { id: string }) => row.id),
    applicationRows.map((row) => row.id),
  );
  assert.deepEqual(
    currentPair?.source.rows.map((row: { id: string }) => row.id),
    currentRows.map((row) => row.id),
  );
  assert.deepEqual(result.unmatchedAccounts, []);
  assert.deepEqual(result.unmatchedSources, []);
});

test("separa vários agrupamentos líquidos diários da aplicação no mesmo mês", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const source = {
    bankId: "033",
    sourceAccountId: "santander-misto-global-tree",
    rows: [
      { id: "app-01-a", date: "2026-06-01", description: "RESGATE A", value: -1494.52 },
      { id: "app-01-b", date: "2026-06-01", description: "RESGATE B", value: -1890.98 },
      { id: "app-01-c", date: "2026-06-01", description: "RESGATE C", value: -38316.63 },
      { id: "corrente-01", date: "2026-06-01", description: "CORRENTE", value: 210.8 },
      { id: "app-03-a", date: "2026-06-03", description: "APLICAÇÃO A", value: 300 },
      { id: "app-03-b", date: "2026-06-03", description: "APLICAÇÃO B", value: 200 },
      { id: "corrente-03", date: "2026-06-03", description: "CORRENTE", value: 8.76 },
    ],
    metadata: {
      account: "referencia-compartilhada",
      agency: "",
      closingBalance: null,
      name: "Banco 033",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const applicationSource = {
    bankId: "000",
    sourceAccountId: "aplicacao-posicao-global-tree",
    rows: [],
    metadata: {
      account: "Aplicação",
      agency: "",
      closingBalance: null,
      name: "Aplicação financeira",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const result = resolveStatementBindings(
    [source, applicationSource],
    [
      {
        code: "1.1.1.03.03.20",
        name: "Banco Santander - conta Aplic. 13082100-5",
        rows: [
          { date: "2026-06-01", value: -41702.13 },
          { date: "2026-06-03", value: 500 },
        ],
      },
      {
        code: "1.1.1.02.03.11",
        name: "Banco Santander - conta 13082100-5",
        rows: [
          { date: "2026-06-01", value: 210.8 },
          { date: "2026-06-03", value: 8.76 },
        ],
      },
    ],
  );

  const application = result.pairs.find(
    (pair: { account: { code: string } }) =>
      pair.account.code === "1.1.1.03.03.20",
  );
  const current = result.pairs.find(
    (pair: { account: { code: string } }) =>
      pair.account.code === "1.1.1.02.03.11",
  );
  assert.deepEqual(
    application?.source.rows.map((row: { id: string }) => row.id),
    ["app-01-a", "app-01-b", "app-01-c", "app-03-a", "app-03-b"],
  );
  assert.deepEqual(
    current?.source.rows.map((row: { id: string }) => row.id),
    ["corrente-01", "corrente-03"],
  );
});

test("descarta colunas auxiliares do PDF somente quando a conta corrente fica coberta", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const source = {
    bankId: "033",
    sourceAccountId: "santander-pdf-multicolunas",
    rows: [
      { id: "app", date: "2026-06-10", description: "LÍQUIDO APLICAÇÃO", value: -100 },
      { id: "corrente-debito-a", date: "2026-06-10", description: "DÉBITO A", value: 400 },
      { id: "corrente-debito-b", date: "2026-06-10", description: "DÉBITO B", value: 250 },
      { id: "corrente-debito-c", date: "2026-06-10", description: "DÉBITO C", value: 200 },
      { id: "corrente-debito-d", date: "2026-06-10", description: "DÉBITO D", value: 150 },
      { id: "corrente-credito-a", date: "2026-06-10", description: "CRÉDITO A", value: -400 },
      { id: "corrente-credito-b", date: "2026-06-10", description: "CRÉDITO B", value: -250 },
      { id: "corrente-credito-c", date: "2026-06-10", description: "CRÉDITO C", value: -200 },
      { id: "corrente-credito-d", date: "2026-06-10", description: "CRÉDITO D", value: -150 },
      { id: "coluna-auxiliar-a", date: "2026-06-10", description: "RENDIMENTO AUXILIAR A", value: 1 },
      { id: "coluna-auxiliar-b", date: "2026-06-11", description: "RENDIMENTO AUXILIAR B", value: 2 },
      { id: "coluna-auxiliar-c", date: "2026-06-12", description: "RENDIMENTO AUXILIAR C", value: 3 },
      { id: "coluna-auxiliar-d", date: "2026-06-13", description: "RENDIMENTO AUXILIAR D", value: 4 },
      { id: "coluna-auxiliar-e", date: "2026-06-14", description: "RENDIMENTO AUXILIAR E", value: 3.45 },
    ],
    metadata: {
      account: "referencia-compartilhada",
      agency: "",
      closingBalance: null,
      name: "Banco 033",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const applicationSource = {
    bankId: "000",
    sourceAccountId: "aplicacao-posicao",
    rows: [],
    metadata: {
      account: "Aplicação",
      agency: "",
      closingBalance: null,
      name: "Aplicação financeira",
      openingBalance: null,
      period: "06/2026",
    },
  };
  const result = resolveStatementBindings(
    [source, applicationSource],
    [
      {
        code: "1.1.1.03.03.20",
        name: "Banco Santander - conta Aplic. 13082100-5",
        rows: [{ date: "2026-06-10", value: -100 }],
      },
      {
        code: "1.1.1.02.03.11",
        name: "Banco Santander - conta 13082100-5",
        rows: [
          { date: "2026-06-10", value: 1000 },
          { date: "2026-06-10", value: -1000 },
        ],
      },
    ],
  );
  const application = result.pairs.find(
    (pair: { account: { code: string } }) =>
      pair.account.code === "1.1.1.03.03.20",
  );
  const current = result.pairs.find(
    (pair: { account: { code: string } }) =>
      pair.account.code === "1.1.1.02.03.11",
  );

  assert.deepEqual(
    application?.source.rows.map((row: { id: string }) => row.id),
    ["app"],
  );
  assert.deepEqual(
    current?.source.rows.map((row: { id: string }) => row.id),
    [
      "corrente-debito-a",
      "corrente-debito-b",
      "corrente-debito-c",
      "corrente-debito-d",
      "corrente-credito-a",
      "corrente-credito-b",
      "corrente-credito-c",
      "corrente-credito-d",
    ],
  );
});

test("vincula contas Daycoval pelo total diário quando o banco agrupa lançamentos", async () => {
  const { resolveStatementBindings } = await import(moduleUrl.href);
  const statement = (id: string, values: number[]) => ({
    bankId: "707",
    sourceAccountId: id,
    rows: values.map((value, index) => ({
      id: `${id}-${index}`,
      date: "2026-06-10",
      description: "MOVIMENTO AGRUPADO",
      value,
    })),
    metadata: {
      account: id,
      agency: "",
      closingBalance: null,
      name: "Banco 707",
      openingBalance: null,
      period: "06/2026",
    },
  });
  const result = resolveStatementBindings(
    [statement("daycoval-a", [60, 40]), statement("daycoval-b", [30, 20])],
    [
      {
        code: "1.1.1.02.05.07",
        name: "Banco Daycoval - Conta 745596-0",
        rows: [{ date: "2026-06-10", value: 100 }],
      },
      {
        code: "1.1.1.02.05.09",
        name: "Banco Daycoval - Conta CASH 610638-4",
        rows: [{ date: "2026-06-10", value: 50 }],
      },
    ],
  );

  assert.deepEqual(
    Object.fromEntries(
      result.pairs.map((pair: { account: { code: string }; source: { sourceAccountId: string } }) => [
        pair.source.sourceAccountId,
        pair.account.code,
      ]),
    ),
    {
      "daycoval-a": "1.1.1.02.05.07",
      "daycoval-b": "1.1.1.02.05.09",
    },
  );
});

test("prioriza Excel entre referências técnicas da mesma conta bancária", async () => {
  const { loadDataEngineStatementSnapshot } = await import(moduleUrl.href);
  const result = await loadDataEngineStatementSnapshot({
    accessToken: "short-lived-token",
    baseUrl: "https://data-engine.example",
    codColigada: 9,
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/tesouraria/extratos/movimentos") {
        return Response.json({
          items: [
            {
              movimento_id: "movimento-pdf",
              cod_coligada: 9,
              bank_id: "707",
              source_account_id: "referencia-pdf",
              processing_identity_id: "processamento-pdf",
              data_lancamento: "2026-06-10",
              valor_centavos: 35100,
              natureza: "D",
              descricao_sanitizada: "MOVIMENTO-PDF-GENERICO",
            },
            {
              movimento_id: "movimento-excel",
              cod_coligada: 9,
              bank_id: "707",
              source_account_id: "referencia-excel",
              processing_identity_id: "processamento-excel",
              data_lancamento: "2026-06-10",
              valor_centavos: 35100,
              natureza: "D",
              descricao_sanitizada: "TARIFA BANCÁRIA",
            },
          ],
          next_cursor: null,
        });
      }
      if (url.pathname === "/v1/tesouraria/extratos/cobertura") {
        return Response.json({
          items: [
            {
              cod_coligada: 9,
              source_account_id: "referencia-pdf",
              processing_identity_id: "processamento-pdf",
              numero_conta: "745596-0",
              evidence_ref: "extrato-daycoval.pdf",
            },
            {
              cod_coligada: 9,
              source_account_id: "referencia-excel",
              processing_identity_id: "processamento-excel",
              numero_conta: "745596-0",
              evidence_ref: "extrato-daycoval.xlsx",
            },
          ],
          next_cursor: null,
        });
      }
      return Response.json({ items: [], next_cursor: null });
    },
    fromDate: "2026-06-01",
    toDate: "2026-06-30",
  });

  assert.equal(result.statements.length, 1);
  assert.equal(result.statements[0].metadata.account, "745596-0");
  assert.deepEqual(
    result.statements[0].rows.map((row: { id: string }) => row.id),
    ["movimento-excel"],
  );
});
