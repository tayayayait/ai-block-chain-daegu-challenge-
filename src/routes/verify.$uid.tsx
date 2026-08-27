import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { VerificationView } from "@/components/attestation/VerificationView";
import { PaperShell } from "@/components/onjung/Shells";
import type { PublicAttestationVerification } from "@/lib/attestation/verification.server";

const VerificationRequestSchema = z
  .object({
    uid: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/iu)
      .transform((value) => value.toLowerCase()),
  })
  .strict();

const loadVerification = createServerFn({ method: "GET" })
  .validator((input: unknown) => VerificationRequestSchema.parse(input))
  .handler(async ({ data }): Promise<PublicAttestationVerification> => {
    const [{ setResponseHeader }, verification, environment] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/lib/attestation/verification.server"),
      import("@/lib/env.server"),
    ]);
    setResponseHeader("cache-control", "public, max-age=15, stale-while-revalidate=30");

    try {
      const env = environment.getServerEnv();
      const policy = {
        careSchemaUid: env.EAS_CARE_SCHEMA_UID ?? "",
        shelterSchemaUid: env.EAS_SHELTER_SCHEMA_UID ?? "",
        expectedIssuer: env.EAS_EXPECTED_ISSUER ?? "",
      };
      const port = env.BASE_SEPOLIA_RPC_URL
        ? verification.createBaseSepoliaEasLookupPort(env.BASE_SEPOLIA_RPC_URL)
        : { lookup: async () => Promise.reject(new Error("EAS lookup is not configured")) };
      return verification.verifyEasAttestation(data.uid, policy, port);
    } catch {
      return verification.verifyEasAttestation(
        data.uid,
        { careSchemaUid: "", shelterSchemaUid: "", expectedIssuer: "" },
        { lookup: async () => Promise.reject(new Error("EAS lookup is unavailable")) },
      );
    }
  });

export const Route = createFileRoute("/verify/$uid")({
  loader: async ({ params }): Promise<PublicAttestationVerification> => {
    try {
      return await loadVerification({ data: { uid: params.uid } });
    } catch {
      return { status: "NOT_FOUND" };
    }
  },
  head: () => ({
    meta: [
      { title: "온체인 증명 검증 — 온중 溫證" },
      {
        name: "description",
        content: "Base Sepolia 테스트넷의 온중 EAS 증명 발급·폐기 상태를 공개 검증합니다.",
      },
    ],
  }),
  component: VerificationRoute,
});

function VerificationRoute() {
  const result = Route.useLoaderData();
  return (
    <PaperShell back="/" backLabel="홈" defaultSeniorMode>
      <VerificationView result={result} />
    </PaperShell>
  );
}
