import "@tanstack/react-start/server-only";

import { SchemaRegistry as EasSchemaRegistry } from "@ethereum-attestation-service/eas-sdk";

import { CARE_EVENT_SCHEMA, SHELTER_STATUS_SCHEMA, type Bytes32Hex } from "./schemas";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export interface RequiredSchemaUids {
  readonly careEvent: Bytes32Hex;
  readonly shelterStatus: Bytes32Hex;
}

function normalizeSchemaUid(value: string): Bytes32Hex {
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("INVALID_FIXED_SCHEMA_UID");
  }
  return normalized as Bytes32Hex;
}

/**
 * Canonical Base Sepolia schema identities for the immutable Onjung v1 schemas.
 *
 * EAS schema UIDs are deterministic over schema text, resolver, and revocability,
 * so runtime configuration must equal these values rather than merely looking like
 * a bytes32 value.
 */
export const REQUIRED_EAS_SCHEMA_UIDS: RequiredSchemaUids = Object.freeze({
  careEvent: normalizeSchemaUid(
    EasSchemaRegistry.getSchemaUID(CARE_EVENT_SCHEMA, ZERO_ADDRESS, true),
  ),
  shelterStatus: normalizeSchemaUid(
    EasSchemaRegistry.getSchemaUID(SHELTER_STATUS_SCHEMA, ZERO_ADDRESS, true),
  ),
});

export function computeRequiredSchemaUids(): RequiredSchemaUids {
  return REQUIRED_EAS_SCHEMA_UIDS;
}
