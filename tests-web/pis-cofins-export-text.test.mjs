import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("../app/pis-cofins-assessment.tsx", import.meta.url), "utf8");

test("exporta os rótulos da PACONT com acentuação UTF-8 correta", () => {
  assert.match(panel, /PLANILHA DE APURAÇÃO DAS CONTRIBUIÇÕES/);
  assert.match(panel, /Origem: Contábil Raiz Educação/);
  assert.match(panel, /COMPETÊNCIA:/);
  assert.match(panel, /Método de Determinação dos Créditos:/);
  assert.match(panel, /DESCRIÇÃO DAS RECEITAS/);
  assert.match(panel, /Deduções \(especificar\)/);
  assert.doesNotMatch(panel, /Ãƒ|Ã§|Ãª|Ã£|Ã©|Ã¡|Ã³|Ãµ|Ã­|Ã /);
});

test("preenche Elaborado por com o nome do responsável pela finalização", () => {
  assert.match(panel, /finalizedByName: userName \|\| displayNameFromIdentity\(userEmail\)/);
  assert.match(panel, /\["Origem: Contábil Raiz Educação", "", "Elaborado por:", elaboratedBy/);
});
