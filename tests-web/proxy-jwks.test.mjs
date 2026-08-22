import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const port = 3199;
const origin = `http://127.0.0.1:${port}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next.js não iniciou dentro do prazo do teste.");
}

test("mantém o JWKS público fora da autenticação de usuário", { timeout: 30_000 }, async () => {
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: {
        ...process.env,
        DATA_ENGINE_KID: "",
        DATA_ENGINE_PRIVATE_KEY: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
        NEXT_PUBLIC_SUPABASE_URL: "",
      },
      stdio: "ignore",
    },
  );

  try {
    await waitForServer();
    const response = await fetch(`${origin}/api/data-engine/jwks`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error, "JWKS do Data Engine não configurado.");
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
});
