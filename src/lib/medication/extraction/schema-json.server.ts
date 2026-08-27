import "@tanstack/react-start/server-only";

import { zodToJsonSchema } from "zod-to-json-schema";

import { MedicationExtractionSchema } from "./schema";

const UNSUPPORTED_GEMINI_SCHEMA_KEYS = new Set(["minLength", "maxLength", "maxItems"]);

function omitUnsupportedGeminiConstraints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitUnsupportedGeminiConstraints);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UNSUPPORTED_GEMINI_SCHEMA_KEYS.has(key))
      .map(([key, nestedValue]) => [key, omitUnsupportedGeminiConstraints(nestedValue)]),
  );
}

/**
 * Gemini and the server parser share MedicationExtractionSchema as their one
 * source of truth. Gemini 3.5 structured output does not accept JSON Schema
 * string-length keywords. The currently configured model also rejects
 * `maxItems` on the nested medication array, so the request omits those hints
 * while the final Zod parse continues to enforce them. Only this server
 * boundary imports the JSON Schema converter.
 */
export const MEDICATION_EXTRACTION_JSON_SCHEMA = Object.freeze(
  omitUnsupportedGeminiConstraints(
    zodToJsonSchema(MedicationExtractionSchema, {
      $refStrategy: "none",
      target: "openApi3",
    }),
  ),
);
