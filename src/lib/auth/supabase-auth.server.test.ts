import { describe, expect, it, vi } from "vitest";

import { createSupabaseAuthorizationRepository, getVerifiedUserId } from "./supabase-auth.server";

describe("getVerifiedUserId", () => {
  it("uses auth.getUser so the server verifies the access token", async () => {
    const getUser = vi.fn(async () => ({
      data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      error: null,
    }));

    await expect(getVerifiedUserId({ auth: { getUser } })).resolves.toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("fails closed without copying provider errors", async () => {
    const getUser = vi.fn(async () => ({
      data: { user: null },
      error: new Error("SENSITIVE_PROVIDER_BODY"),
    }));

    await expect(getVerifiedUserId({ auth: { getUser } })).resolves.toBeNull();
  });
});

describe("createSupabaseAuthorizationRepository", () => {
  it("maps a validated staff profile and does not read auth user_metadata", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        organization_id: "00000000-0000-4000-8000-000000000010",
        role: "CARE_WORKER",
      },
      error: null,
    }));
    const chain = {
      eq: vi.fn(() => chain),
      maybeSingle,
    };
    const select = vi.fn(() => chain);
    const from = vi.fn(() => ({ select }));
    const repository = createSupabaseAuthorizationRepository({ from });

    await expect(
      repository.findProfileByUserId("00000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000010",
      role: "CARE_WORKER",
    });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith("id, organization_id, role");
  });

  it("checks assignments with organization, profile, and subject together", async () => {
    const maybeSingle = vi.fn(async () => ({ data: { subject_id: "subject-1" }, error: null }));
    const filters: Array<[string, string]> = [];
    const chain = {
      eq(column: string, value: string) {
        filters.push([column, value]);
        return chain;
      },
      maybeSingle,
    };
    const client = {
      from: vi.fn(() => ({ select: vi.fn(() => chain) })),
    };
    const repository = createSupabaseAuthorizationRepository(client);

    await expect(
      repository.isSubjectAssignedToProfile({
        organizationId: "org-1",
        profileId: "profile-1",
        subjectId: "subject-1",
      }),
    ).resolves.toBe(true);
    expect(filters).toEqual([
      ["organization_id", "org-1"],
      ["profile_id", "profile-1"],
      ["subject_id", "subject-1"],
    ]);
  });
});
