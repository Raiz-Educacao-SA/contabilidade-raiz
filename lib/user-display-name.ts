export function displayNameFromIdentity(value: string) {
  const identity = String(value || "").trim();
  if (!identity) return "Usuário";
  if (!identity.includes("@")) return identity;

  const localPart = identity.split("@", 1)[0];
  const words = localPart.split(/[._-]+/).filter(Boolean);
  if (!words.length) return "Usuário";

  return words
    .map((word) => `${word.charAt(0).toLocaleUpperCase("pt-BR")}${word.slice(1).toLocaleLowerCase("pt-BR")}`)
    .join(" ");
}

export function resolveUserDisplayName(metadata: unknown, email: string) {
  const values = metadata && typeof metadata === "object"
    ? metadata as Record<string, unknown>
    : {};
  const profileName = [values.full_name, values.name, values.display_name]
    .find((value) => typeof value === "string" && value.trim());

  return typeof profileName === "string"
    ? profileName.trim()
    : displayNameFromIdentity(email);
}
