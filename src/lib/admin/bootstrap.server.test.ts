import { describe, expect, it, vi } from "vitest";

import { bootstrapFirstAdmin, type AdminBootstrapRepository } from "./bootstrap.server";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";

function repository(overrides: Partial<AdminBootstrapRepository> = {}): AdminBootstrapRepository {
  return {
    findAuthUserByEmail: vi.fn(async () => null),
    createAuthUser: vi.fn(async () => ({ id: USER_ID, appMetadata: {} })),
    findProfileByUserId: vi.fn(async () => null),
    ensureOrganization: vi.fn(async () => undefined),
    rememberBootstrapOrganization: vi.fn(async () => undefined),
    createAdminProfile: vi.fn(async () => undefined),
    ...overrides,
  };
}

const input = {
  email: "Admin@Example.com ",
  password: "one-time-strong-password",
  organizationName: "대구 온중 운영기관",
  displayName: "운영 관리자",
} as const;

describe("first ADMIN bootstrap", () => {
  it("creates a confirmed auth user, organization, and ADMIN profile without demo rows", async () => {
    const repo = repository();

    await expect(bootstrapFirstAdmin(input, repo)).resolves.toEqual({
      status: "CREATED",
      userId: USER_ID,
      organizationId: USER_ID,
    });
    expect(repo.findAuthUserByEmail).toHaveBeenCalledWith("admin@example.com");
    expect(repo.createAuthUser).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: input.password,
    });
    expect(repo.ensureOrganization).toHaveBeenCalledWith({
      organizationId: USER_ID,
      name: "대구 온중 운영기관",
    });
    expect(repo.rememberBootstrapOrganization).toHaveBeenCalledWith({
      userId: USER_ID,
      organizationId: USER_ID,
      existingAppMetadata: {},
    });
    expect(repo.createAdminProfile).toHaveBeenCalledWith({
      userId: USER_ID,
      organizationId: USER_ID,
      displayName: "운영 관리자",
    });
    expect(vi.mocked(repo.rememberBootstrapOrganization).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repo.ensureOrganization).mock.invocationCallOrder[0]!,
    );
  });

  it("reuses a remembered organization after an interrupted first run", async () => {
    const repo = repository({
      findAuthUserByEmail: vi.fn(async () => ({
        id: USER_ID,
        appMetadata: {
          onjung_bootstrap: true,
          onjung_bootstrap_organization_id: ORGANIZATION_ID,
        },
      })),
    });

    const result = await bootstrapFirstAdmin(input, repo);

    expect(result.status).toBe("RESUMED");
    expect(repo.createAuthUser).not.toHaveBeenCalled();
    expect(repo.ensureOrganization).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      name: "대구 온중 운영기관",
    });
    expect(repo.createAdminProfile).toHaveBeenCalledOnce();
  });

  it("never promotes an unrelated existing Auth user without a bootstrap marker", async () => {
    const repo = repository({
      findAuthUserByEmail: vi.fn(async () => ({ id: USER_ID, appMetadata: {} })),
    });

    await expect(bootstrapFirstAdmin(input, repo)).rejects.toThrow(
      "BOOTSTRAP_EXISTING_AUTH_USER_UNTRUSTED",
    );
    expect(repo.ensureOrganization).not.toHaveBeenCalled();
    expect(repo.rememberBootstrapOrganization).not.toHaveBeenCalled();
    expect(repo.createAdminProfile).not.toHaveBeenCalled();
  });

  it("is idempotent when the ADMIN profile already exists", async () => {
    const repo = repository({
      findAuthUserByEmail: vi.fn(async () => ({ id: USER_ID, appMetadata: {} })),
      findProfileByUserId: vi.fn(async () => ({
        organizationId: ORGANIZATION_ID,
        role: "ADMIN" as const,
      })),
    });

    await expect(bootstrapFirstAdmin(input, repo)).resolves.toEqual({
      status: "EXISTING",
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    });
    expect(repo.ensureOrganization).not.toHaveBeenCalled();
    expect(repo.createAdminProfile).not.toHaveBeenCalled();
  });

  it("fails closed when the email belongs to a non-ADMIN profile", async () => {
    const repo = repository({
      findAuthUserByEmail: vi.fn(async () => ({ id: USER_ID, appMetadata: {} })),
      findProfileByUserId: vi.fn(async () => ({
        organizationId: ORGANIZATION_ID,
        role: "CARE_WORKER" as const,
      })),
    });

    await expect(bootstrapFirstAdmin(input, repo)).rejects.toThrow(
      "BOOTSTRAP_EXISTING_USER_NOT_ADMIN",
    );
    expect(repo.ensureOrganization).not.toHaveBeenCalled();
  });

  it("rejects weak or malformed input before touching Supabase", async () => {
    const repo = repository();

    await expect(bootstrapFirstAdmin({ ...input, password: "too-short" }, repo)).rejects.toThrow();
    expect(repo.findAuthUserByEmail).not.toHaveBeenCalled();
  });
});
