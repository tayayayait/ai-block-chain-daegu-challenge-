import "@tanstack/react-start/server-only";

import { createHash, createHmac } from "node:crypto";

export type Bytes32Hex = `0x${string}`;

export type AttestationHashErrorCode =
  "INVALID_JSON" | "INVALID_SUBJECT_ID" | "SUBJECT_HASH_SECRET_TOO_SHORT";

/** Error messages deliberately never interpolate identifiers, payloads, or secrets. */
export class AttestationHashError extends Error {
  readonly code: AttestationHashErrorCode;

  constructor(code: AttestationHashErrorCode) {
    const message = {
      INVALID_JSON: "Attestation payload must be valid I-JSON",
      INVALID_SUBJECT_ID: "Attestation subject identifier is invalid",
      SUBJECT_HASH_SECRET_TOO_SHORT: "Attestation subject hash secret is invalid",
    }[code];
    super(message);
    this.name = "AttestationHashError";
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MINIMUM_SECRET_BYTES = 32;

function failInvalidJson(): never {
  throw new AttestationHashError("INVALID_JSON");
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) failInvalidJson();
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      failInvalidJson();
    }
  }
}

function isCanonicalJsonObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      assertWellFormedUnicode(value);
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) failInvalidJson();
      return JSON.stringify(value);
    }
    case "object":
      break;
    default:
      return failInvalidJson();
  }

  if (ancestors.has(value)) failInvalidJson();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) failInvalidJson();
      const propertyNames = Object.getOwnPropertyNames(value);
      if (propertyNames.length !== value.length + 1 || !propertyNames.includes("length")) {
        failInvalidJson();
      }

      const elements: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) failInvalidJson();
        elements.push(canonicalize(descriptor.value, ancestors));
      }
      return `[${elements.join(",")}]`;
    }

    if (!isCanonicalJsonObject(value)) failInvalidJson();
    if (Object.getOwnPropertySymbols(value).length > 0) failInvalidJson();

    const ownPropertyNames = Object.getOwnPropertyNames(value);
    const keys = Object.keys(value);
    if (ownPropertyNames.length !== keys.length) failInvalidJson();
    keys.sort();
    const members: string[] = [];
    for (const key of keys) {
      assertWellFormedUnicode(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) failInvalidJson();
      members.push(`${JSON.stringify(key)}:${canonicalize(descriptor.value, ancestors)}`);
    }
    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * RFC 8785 JSON Canonicalization Scheme for the I-JSON values representable by
 * JavaScript. Objects with accessors, custom prototypes, invalid Unicode, or
 * non-finite numbers are rejected rather than silently changed.
 */
export function canonicalizeJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

export function createSubjectHash(subjectId: string, secret: string | Uint8Array): Bytes32Hex {
  if (!UUID_PATTERN.test(subjectId)) {
    throw new AttestationHashError("INVALID_SUBJECT_ID");
  }

  const secretBytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
  if (secretBytes.byteLength < MINIMUM_SECRET_BYTES) {
    throw new AttestationHashError("SUBJECT_HASH_SECRET_TOO_SHORT");
  }

  const digest = createHmac("sha256", secretBytes)
    .update(subjectId.toLowerCase(), "utf8")
    .digest("hex");
  return `0x${digest}`;
}

export function createPayloadHash(payload: unknown): Bytes32Hex {
  const canonicalPayload = canonicalizeJson(payload);
  const digest = createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
  return `0x${digest}`;
}
