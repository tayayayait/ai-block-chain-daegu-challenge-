import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const UuidSchema = z.string().uuid();
const BootstrapInputSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(128),
    organizationName: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(80),
  })
  .strict();

const REMEMBERED_ORGANIZATION_KEY = "onjung_bootstrap_organization_id";

export type AdminBootstrapUser = Readonly<{
  id: string;
  appMetadata: Readonly<Record<string, unknown>>;
}>;

export type AdminBootstrapRepository = Readonly<{
  findAuthUserByEmail(email: string): Promise<AdminBootstrapUser | null>;
  createAuthUser(input: { email: string; password: string }): Promise<AdminBootstrapUser>;
  findProfileByUserId(userId: string): Promise<Readonly<{
    organizationId: string;
    role: "ADMIN" | "CARE_WORKER";
  }> | null>;
  ensureOrganization(input: { organizationId: string; name: string }): Promise<void>;
  rememberBootstrapOrganization(input: {
    userId: string;
    organizationId: string;
    existingAppMetadata: Readonly<Record<string, unknown>>;
  }): Promise<void>;
  createAdminProfile(input: {
    userId: string;
    organizationId: string;
    displayName: string;
  }): Promise<void>;
}>;

export type AdminBootstrapResult = Readonly<{
  status: "CREATED" | "RESUMED" | "EXISTING";
  userId: string;
  organizationId: string;
}>;

function rememberedOrganizationId(metadata: Readonly<Record<string, unknown>>): string | null {
  const parsed = UuidSchema.safeParse(metadata[REMEMBERED_ORGANIZATION_KEY]);
  return parsed.success ? parsed.data : null;
}

export async function bootstrapFirstAdmin(
  rawInput: z.input<typeof BootstrapInputSchema>,
  repository: AdminBootstrapRepository,
): Promise<AdminBootstrapResult> {
  const input = BootstrapInputSchema.parse(rawInput);
  let user = await repository.findAuthUserByEmail(input.email);
  const createdUser = user === null;

  if (!user) {
    user = await repository.createAuthUser({ email: input.email, password: input.password });
  }
  const userId = UuidSchema.parse(user.id);
  const existingProfile = await repository.findProfileByUserId(userId);
  if (existingProfile) {
    if (existingProfile.role !== "ADMIN") {
      throw new Error("BOOTSTRAP_EXISTING_USER_NOT_ADMIN");
    }
    return {
      status: "EXISTING",
      userId,
      organizationId: UuidSchema.parse(existingProfile.organizationId),
    };
  }

  if (!createdUser && user.appMetadata["onjung_bootstrap"] !== true) {
    throw new Error("BOOTSTRAP_EXISTING_AUTH_USER_UNTRUSTED");
  }

  const rememberedOrganization = rememberedOrganizationId(user.appMetadata);
  const organizationId = rememberedOrganization ?? userId;
  if (!rememberedOrganization) {
    await repository.rememberBootstrapOrganization({
      userId,
      organizationId,
      existingAppMetadata: user.appMetadata,
    });
  }
  await repository.ensureOrganization({
    organizationId,
    name: input.organizationName,
  });

  await repository.createAdminProfile({
    userId,
    organizationId,
    displayName: input.displayName,
  });

  return {
    status: createdUser ? "CREATED" : "RESUMED",
    userId,
    organizationId,
  };
}

function bootstrapFailure(): Error {
  return new Error("ADMIN_BOOTSTRAP_SUPABASE_OPERATION_FAILED");
}

export function createSupabaseAdminBootstrapRepository(
  client: SupabaseClient,
): AdminBootstrapRepository {
  return {
    async findAuthUserByEmail(email) {
      for (let page = 1; page <= 100; page += 1) {
        const result = await client.auth.admin.listUsers({ page, perPage: 100 });
        if (result.error) throw bootstrapFailure();
        const matching = result.data.users.find(
          (user) => user.email?.trim().toLowerCase() === email,
        );
        if (matching) {
          return {
            id: UuidSchema.parse(matching.id),
            appMetadata: matching.app_metadata ?? {},
          };
        }
        if (result.data.users.length < 100) return null;
      }
      throw bootstrapFailure();
    },

    async createAuthUser(input) {
      const result = await client.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        app_metadata: { onjung_bootstrap: true },
      });
      if (result.error || !result.data.user) throw bootstrapFailure();
      return {
        id: UuidSchema.parse(result.data.user.id),
        appMetadata: result.data.user.app_metadata ?? {},
      };
    },

    async findProfileByUserId(userId) {
      const result = await client
        .from("profiles")
        .select("organization_id,role")
        .eq("id", UuidSchema.parse(userId))
        .maybeSingle();
      if (result.error) throw bootstrapFailure();
      const parsed = z
        .object({ organization_id: UuidSchema, role: z.enum(["ADMIN", "CARE_WORKER"]) })
        .strict()
        .nullable()
        .safeParse(result.data);
      if (!parsed.success) throw bootstrapFailure();
      return parsed.data
        ? { organizationId: parsed.data.organization_id, role: parsed.data.role }
        : null;
    },

    async ensureOrganization(input) {
      const result = await client.from("organizations").upsert(
        {
          id: UuidSchema.parse(input.organizationId),
          name: input.name,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (result.error) throw bootstrapFailure();
    },

    async rememberBootstrapOrganization(input) {
      const result = await client.auth.admin.updateUserById(UuidSchema.parse(input.userId), {
        app_metadata: {
          ...input.existingAppMetadata,
          onjung_bootstrap: true,
          [REMEMBERED_ORGANIZATION_KEY]: UuidSchema.parse(input.organizationId),
        },
      });
      if (result.error) throw bootstrapFailure();
    },

    async createAdminProfile(input) {
      const result = await client.from("profiles").insert({
        id: UuidSchema.parse(input.userId),
        organization_id: UuidSchema.parse(input.organizationId),
        role: "ADMIN",
        display_name: input.displayName,
      });
      if (result.error) throw bootstrapFailure();
    },
  };
}
