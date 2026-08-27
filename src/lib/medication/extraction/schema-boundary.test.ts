import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

describe("medication extraction schema bundle boundary", () => {
  it("keeps JSON Schema conversion server-only while deriving it from the shared Zod schema", () => {
    const sharedSchemaSource = source("./schema.ts");
    const serverJsonSchemaSource = source("./schema-json.server.ts");

    expect(sharedSchemaSource).not.toContain("zod-to-json-schema");
    expect(serverJsonSchemaSource).toContain("@tanstack/react-start/server-only");
    expect(serverJsonSchemaSource).toContain("MedicationExtractionSchema");
    expect(serverJsonSchemaSource).toContain("zodToJsonSchema");
  });
});
