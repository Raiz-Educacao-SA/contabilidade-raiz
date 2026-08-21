import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

const moduleUrl = new URL("../lib/server/data-engine-oauth.ts", import.meta.url);

function decodeJsonSegment(segment: string) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

test("troca assertion ES256 por token curto com audience canônica", async () => {
  const { DataEngineOAuthClient } = await import(moduleUrl.href);
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const requests: Array<{ body: URLSearchParams; url: string }> = [];
  const client = new DataEngineOAuthClient({
    baseUrl: "https://data-engine.example",
    clientId: "contabilidade-raiz",
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      requests.push({ body, url: String(input) });
      return Response.json({
        access_token: "jwt-curto",
        expires_in: 900,
        token_type: "Bearer",
      });
    },
    kid: "contabilidade-raiz-production-es256-v1",
    now: () => 1_787_286_400_000,
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    randomId: () => "assertion-id",
    scope: "read:tesouraria",
  });

  assert.equal(await client.getAccessToken(), "jwt-curto");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://data-engine.example/oauth/token");
  assert.equal(requests[0].body.get("grant_type"), "client_credentials");
  assert.equal(requests[0].body.get("client_id"), "contabilidade-raiz");
  assert.equal(requests[0].body.get("scope"), "read:tesouraria");

  const assertion = requests[0].body.get("client_assertion");
  assert.ok(assertion);
  const [encodedHeader, encodedPayload, encodedSignature] = assertion.split(".");
  assert.deepEqual(decodeJsonSegment(encodedHeader), {
    alg: "ES256",
    kid: "contabilidade-raiz-production-es256-v1",
    typ: "JWT",
  });
  assert.deepEqual(decodeJsonSegment(encodedPayload), {
    aud: "https://data-engine.example/v1/oauth/token",
    exp: 1_787_286_700,
    iat: 1_787_286_400,
    iss: "contabilidade-raiz",
    jti: "assertion-id",
    sub: "contabilidade-raiz",
  });
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { dsaEncoding: "ieee-p1363", key: publicKey },
      Buffer.from(encodedSignature, "base64url"),
    ),
    true,
  );
});

test("cacheia token e usa single-flight nas consultas paralelas", async () => {
  const { DataEngineOAuthClient } = await import(moduleUrl.href);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  let tokenRequests = 0;
  const client = new DataEngineOAuthClient({
    baseUrl: "https://data-engine.example",
    clientId: "contabilidade-raiz",
    fetcher: async () => {
      tokenRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ access_token: "jwt-curto", expires_in: 900 });
    },
    kid: "kid-1",
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    scope: "read:tesouraria",
  });

  assert.deepEqual(
    await Promise.all([
      client.getAccessToken(),
      client.getAccessToken(),
      client.getAccessToken(),
    ]),
    ["jwt-curto", "jwt-curto", "jwt-curto"],
  );
  assert.equal(tokenRequests, 1);
  assert.equal(await client.getAccessToken(), "jwt-curto");
  assert.equal(tokenRequests, 1);
});

test("invalida somente o token rejeitado antes de renovar", async () => {
  const { DataEngineOAuthClient } = await import(moduleUrl.href);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  let tokenRequests = 0;
  const client = new DataEngineOAuthClient({
    baseUrl: "https://data-engine.example",
    clientId: "contabilidade-raiz",
    fetcher: async () => {
      tokenRequests += 1;
      return Response.json({
        access_token: `jwt-${tokenRequests}`,
        expires_in: 900,
      });
    },
    kid: "kid-1",
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    scope: "read:tesouraria",
  });

  assert.equal(await client.getAccessToken(), "jwt-1");
  client.invalidateAccessToken("token-antigo");
  assert.equal(await client.getAccessToken(), "jwt-1");
  client.invalidateAccessToken("jwt-1");
  assert.equal(await client.getAccessToken(), "jwt-2");
  assert.equal(tokenRequests, 2);
});

test("falha fechada e não inclui resposta sensível do token endpoint", async () => {
  const { DataEngineOAuthClient } = await import(moduleUrl.href);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const client = new DataEngineOAuthClient({
    baseUrl: "https://data-engine.example",
    clientId: "contabilidade-raiz",
    fetcher: async () =>
      new Response('{"client_assertion":"material-sensivel"}', { status: 401 }),
    kid: "kid-1",
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    scope: "read:tesouraria",
  });

  await assert.rejects(client.getAccessToken(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /HTTP 401/);
    assert.equal(error.message.includes("material-sensivel"), false);
    return true;
  });
});

test("publica somente a chave pública ES256 usada pelo consumidor", async () => {
  const { createDataEnginePublicJwk } = await import(moduleUrl.href);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = createDataEnginePublicJwk(
    privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    "contabilidade-raiz-production-es256-v1",
  );

  assert.equal(jwk.alg, "ES256");
  assert.equal(jwk.crv, "P-256");
  assert.equal(jwk.kid, "contabilidade-raiz-production-es256-v1");
  assert.equal(jwk.kty, "EC");
  assert.equal(jwk.use, "sig");
  assert.equal(typeof jwk.x, "string");
  assert.equal(typeof jwk.y, "string");
  assert.equal("d" in jwk, false);
});
