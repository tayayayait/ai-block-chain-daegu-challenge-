import { describe, expect, it } from "vitest";

import {
  AttestationHashError,
  canonicalizeJson,
  createPayloadHash,
  createSubjectHash,
} from "./hashing.server";

const SUBJECT_ID = "10000000-0000-4000-8000-000000000001";
const SECRET = "0123456789abcdef0123456789abcdef";
const accessorObject = Object.defineProperty({}, "value", {
  get: () => "not-plain-json-data",
});
const accessorArray = Object.defineProperty([0], "0", {
  get: () => "not-plain-json-data",
});

describe("server-only attestation hashing", () => {
  it("creates the documented HMAC-SHA-256 subject pseudonym", () => {
    expect(createSubjectHash(SUBJECT_ID, SECRET)).toBe(
      "0x99f6932ea1b44561fc109a5528e57e700d70d04c7b386d2fe7beb5cab6948480",
    );
  });

  it("requires a UUID subject identifier and at least 32 bytes of server secret", () => {
    expect(() => createSubjectHash("not-a-uuid", SECRET)).toThrowError(AttestationHashError);
    expect(() => createSubjectHash(SUBJECT_ID, "가".repeat(10))).toThrowError(AttestationHashError);
    expect(() => createSubjectHash(SUBJECT_ID, "가".repeat(11))).not.toThrow();
  });

  it("does not disclose the identifier or secret in validation errors", () => {
    const sensitiveSecret = "too-short-secret";

    for (const operation of [
      () => createSubjectHash("private-subject-id", SECRET),
      () => createSubjectHash(SUBJECT_ID, sensitiveSecret),
    ]) {
      try {
        operation();
        throw new Error("expected operation to fail");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain("private-subject-id");
        expect(message).not.toContain(SUBJECT_ID);
        expect(message).not.toContain(sensitiveSecret);
      }
    }
  });

  it("canonicalizes JSON recursively using RFC 8785/ECMAScript ordering and number syntax", () => {
    const left = {
      z: 1,
      nested: { b: true, a: 1 },
      a: 2,
      numbers: [Number("333333333.33333329"), 1e30, 4.5, 0.002, 1e-27, -0],
    };
    const right = {
      numbers: [333333333.3333333, 1e30, 4.5, 2e-3, 0.000000000000000000000000001, 0],
      a: 2,
      nested: { a: 1, b: true },
      z: 1,
    };

    expect(canonicalizeJson(left)).toBe(canonicalizeJson(right));
    expect(canonicalizeJson(left)).toBe(
      '{"a":2,"nested":{"a":1,"b":true},"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0],"z":1}',
    );
  });

  it("sorts object property names by UTF-16 code units and preserves array order", () => {
    expect(
      canonicalizeJson({
        "\ud83d\ude00": 6,
        "\ufb33": 5,
        "\u20ac": 4,
        "\u00f6": 3,
        "\u0080": 2,
        "1": 1,
      }),
    ).toBe('{"1":1,"\u0080":2,"\u00f6":3,"\u20ac":4,"\ud83d\ude00":6,"\ufb33":5}');
    expect(canonicalizeJson([3, 2, 1])).toBe("[3,2,1]");
  });

  it("hashes the canonical form rather than insertion order", () => {
    const first = createPayloadHash({ z: 1, nested: { b: true, a: 1 }, a: 2 });
    const second = createPayloadHash({ a: 2, nested: { a: 1, b: true }, z: 1 });

    expect(first).toBe(second);
    expect(first).toBe("0xdf31d3f8dee8891bfc76b6255f94844ca186084da1284a63f042874d6ab42d1b");
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    undefined,
    1n,
    new Date("2026-08-23T00:00:00.000Z"),
    Array(1),
    accessorObject,
    accessorArray,
    { value: undefined },
    { "\ud800": "unpaired-key" },
    "\udfff",
  ])("rejects values outside the RFC 8785/I-JSON data model: %s", (value) => {
    expect(() => canonicalizeJson(value)).toThrowError(AttestationHashError);
  });

  it("rejects cyclic payloads", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    expect(() => canonicalizeJson(cyclic)).toThrowError(AttestationHashError);
  });
});
