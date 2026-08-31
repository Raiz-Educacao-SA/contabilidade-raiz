import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../lib/fiscal/versioning.ts", import.meta.url);

test("calcula próxima versão fiscal de forma monotônica", async () => {
  assert.equal(existsSync(moduleUrl), true, "Fiscal versioning module is missing");
  const { nextVersion } = await import(moduleUrl.href);

  assert.equal(nextVersion([]), 1);
  assert.equal(nextVersion([1, 2, 7]), 8);
  assert.equal(nextVersion([{ version: 3 }, { version: 2 }]), 4);
});

test("ordena e seleciona a versão fiscal mais recente", async () => {
  const { latestVersion, sortByVersion } = await import(moduleUrl.href);
  const versions = [
    { version: 1, label: "original" },
    { version: 3, label: "vigente" },
    { version: 2, label: "retificada" },
  ];

  assert.deepEqual(sortByVersion(versions).map((item: { label: string }) => item.label), [
    "vigente",
    "retificada",
    "original",
  ]);
  assert.deepEqual(latestVersion(versions), { version: 3, label: "vigente" });
});

test("recusa versões fiscais inválidas ou duplicadas", async () => {
  const { assertUniqueVersions, assertValidVersion } = await import(moduleUrl.href);

  assert.throws(() => assertValidVersion(0), /inteiro positivo/);
  assert.throws(() => assertValidVersion(1.5), /inteiro positivo/);
  assert.throws(() => assertUniqueVersions([1, 2, 2]), /Versão duplicada: 2/);
});
