import { createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";

type OAuthClientOptions = {
  audience?: string;
  baseUrl: string;
  clientId: string;
  fetcher?: typeof fetch;
  kid: string;
  now?: () => number;
  privateKeyPem: string;
  randomId?: () => string;
  scope: string;
  tokenUrl?: string;
};

type CachedToken = {
  accessToken: string;
  refreshAt: number;
};

const ASSERTION_TTL_SECONDS = 300;
const TOKEN_REFRESH_SLACK_MS = 60_000;
const CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function normalizedPrivateKey(value: string) {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
}

function requireNonEmpty(name: string, value: string) {
  if (!value.trim()) {
    throw new Error(`Configuração OAuth do Data Engine inválida: ${name}.`);
  }
}

export function createDataEnginePublicJwk(
  privateKeyPem: string,
  kid: string,
) {
  requireNonEmpty("privateKeyPem", privateKeyPem);
  requireNonEmpty("kid", kid);
  const publicJwk = createPublicKey(
    createPrivateKey(normalizedPrivateKey(privateKeyPem)),
  ).export({ format: "jwk" });
  return {
    ...publicJwk,
    alg: "ES256",
    kid,
    use: "sig",
  };
}

export class DataEngineOAuthClient {
  private readonly audience: string;
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly fetcher: typeof fetch;
  private readonly kid: string;
  private readonly now: () => number;
  private readonly privateKeyPem: string;
  private readonly randomId: () => string;
  private readonly scope: string;
  private readonly tokenUrl: string;
  private cachedToken: CachedToken | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(options: OAuthClientOptions) {
    requireNonEmpty("baseUrl", options.baseUrl);
    requireNonEmpty("clientId", options.clientId);
    requireNonEmpty("kid", options.kid);
    requireNonEmpty("privateKeyPem", options.privateKeyPem);
    requireNonEmpty("scope", options.scope);

    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.tokenUrl =
      options.tokenUrl?.trim() || `${this.baseUrl}/oauth/token`;
    this.audience =
      options.audience?.trim() || `${this.baseUrl}/v1/oauth/token`;
    this.clientId = options.clientId;
    this.fetcher = options.fetcher ?? fetch;
    this.kid = options.kid;
    this.now = options.now ?? Date.now;
    this.privateKeyPem = normalizedPrivateKey(options.privateKeyPem);
    this.randomId = options.randomId ?? randomUUID;
    this.scope = options.scope;
  }

  async getAccessToken() {
    if (this.cachedToken && this.now() < this.cachedToken.refreshAt) {
      return this.cachedToken.accessToken;
    }
    if (!this.tokenRequest) {
      this.tokenRequest = this.exchangeToken().finally(() => {
        this.tokenRequest = null;
      });
    }
    return this.tokenRequest;
  }

  invalidateAccessToken(rejectedToken: string) {
    if (this.cachedToken?.accessToken === rejectedToken) {
      this.cachedToken = null;
    }
  }

  private createAssertion() {
    const issuedAt = Math.floor(this.now() / 1000);
    const header = encodeJson({ alg: "ES256", kid: this.kid, typ: "JWT" });
    const payload = encodeJson({
      aud: this.audience,
      exp: issuedAt + ASSERTION_TTL_SECONDS,
      iat: issuedAt,
      iss: this.clientId,
      jti: this.randomId(),
      sub: this.clientId,
    });
    const unsignedAssertion = `${header}.${payload}`;
    const signature = sign("sha256", Buffer.from(unsignedAssertion), {
      dsaEncoding: "ieee-p1363",
      key: createPrivateKey(this.privateKeyPem),
    }).toString("base64url");
    return `${unsignedAssertion}.${signature}`;
  }

  private async exchangeToken() {
    const response = await this.fetcher(this.tokenUrl, {
      body: new URLSearchParams({
        client_assertion: this.createAssertion(),
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_id: this.clientId,
        grant_type: "client_credentials",
        scope: this.scope,
      }),
      cache: "no-store",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(
        `Não foi possível autenticar no Data Engine (HTTP ${response.status}).`,
      );
    }

    const payload = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof payload.access_token !== "string" ||
      !payload.access_token ||
      typeof payload.expires_in !== "number" ||
      !Number.isFinite(payload.expires_in) ||
      payload.expires_in <= 0
    ) {
      throw new Error("Resposta inválida do token endpoint do Data Engine.");
    }
    this.cachedToken = {
      accessToken: payload.access_token,
      refreshAt:
        this.now() +
        Math.max(1_000, payload.expires_in * 1_000 - TOKEN_REFRESH_SLACK_MS),
    };
    return payload.access_token;
  }
}

let runtimeClient: DataEngineOAuthClient | null = null;

export function getDataEngineOAuthClient(options: OAuthClientOptions) {
  runtimeClient ??= new DataEngineOAuthClient(options);
  return runtimeClient;
}
