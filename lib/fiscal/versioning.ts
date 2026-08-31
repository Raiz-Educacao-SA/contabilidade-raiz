export type Versioned = {
  readonly version: number;
};

export function assertValidVersion(version: number, label = "versão") {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`${label} deve ser um inteiro positivo.`);
  }
}

export function nextVersion(values: Iterable<number | Versioned>) {
  let maximum = 0;
  for (const value of values) {
    const version = typeof value === "number" ? value : value.version;
    assertValidVersion(version);
    maximum = Math.max(maximum, version);
  }
  return maximum + 1;
}

export function latestVersion<T extends Versioned>(items: readonly T[]) {
  return [...items].sort((left, right) => right.version - left.version)[0] ?? null;
}

export function sortByVersion<T extends Versioned>(
  items: readonly T[],
  direction: "asc" | "desc" = "desc",
) {
  return [...items].sort((left, right) =>
    direction === "asc"
      ? left.version - right.version
      : right.version - left.version,
  );
}

export function assertUniqueVersions(values: Iterable<number | Versioned>) {
  const seen = new Set<number>();
  for (const value of values) {
    const version = typeof value === "number" ? value : value.version;
    assertValidVersion(version);
    if (seen.has(version)) {
      throw new Error(`Versão duplicada: ${version}.`);
    }
    seen.add(version);
  }
}
