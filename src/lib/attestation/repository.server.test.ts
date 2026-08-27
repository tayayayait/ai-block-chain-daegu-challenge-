import { describe, expect, it } from "vitest";

import {
  AttestationRepositoryError,
  createSupabaseAttestationRepository,
  type AttestationDatabaseClient,
  type AttestationQuery,
} from "./repository.server";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";
const TARGET_ID = "123e4567-e89b-42d3-a456-426614174001";
const SUBJECT_ID = "123e4567-e89b-42d3-a456-426614174002";
const LEASE_UNTIL = "2026-08-24T00:04:00.000Z";
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174003";
const UID = `0x${"a".repeat(64)}` as `0x${string}`;
const TRANSACTION_HASH = `0x${"b".repeat(64)}` as `0x${string}`;
const SCHEMA_UID = `0x${"c".repeat(64)}` as `0x${string}`;
const ISSUER = `0x${"d".repeat(40)}` as `0x${string}`;

const claimRow = {
  job_id: JOB_ID,
  target_kind: "CARE_EVENT",
  target_id: TARGET_ID,
  idempotency_key: `care-event:${TARGET_ID}`,
  attempt_count: 1,
  lease_until: LEASE_UNTIL,
  claim_token: CLAIM_TOKEN,
  submission_started_at: null,
  transaction_hash: null,
  chain_id: null,
  schema_uid: null,
  issuer: null,
};

interface FixtureMap {
  readonly [key: string]: { readonly data: unknown; readonly error: unknown | null };
}

const createClient = (
  fixtures: FixtureMap,
  calls: Array<Readonly<Record<string, unknown>>> = [],
): AttestationDatabaseClient => {
  const query = (table: string): AttestationQuery => {
    const filters: Array<readonly [string, unknown]> = [];
    const state: AttestationQuery = {
      select(columns) {
        calls.push({ kind: "select", table, columns });
        return state;
      },
      eq(column, value) {
        filters.push([column, value]);
        return state;
      },
      lte(column, value) {
        filters.push([`${column}<=`, value]);
        return state;
      },
      order(column, options) {
        calls.push({ kind: "order", table, column, options });
        return state;
      },
      limit(value) {
        calls.push({ kind: "limit", table, value });
        return state;
      },
      async maybeSingle() {
        calls.push({ kind: "maybeSingle", table, filters });
        return fixtures[table] ?? { data: null, error: { code: "MISSING_FIXTURE" } };
      },
    };
    return state;
  };

  return {
    from: query,
    rpc: async (name, parameters) => {
      calls.push({ kind: "rpc", name, parameters });
      return fixtures[name] ?? { data: null, error: { code: "MISSING_FIXTURE" } };
    },
  };
};

const processingJob = {
  id: JOB_ID,
  state: "PROCESSING",
  attestation_uid: null,
  claim_token: CLAIM_TOKEN,
  lease_until: LEASE_UNTIL,
};

describe("Supabase EAS job repository", () => {
  it("claims only a bounded strict lease DTO through the durable RPC", async () => {
    const calls: Array<Readonly<Record<string, unknown>>> = [];
    const repository = createSupabaseAttestationRepository({
      client: createClient({ claim_attestation_jobs: { data: [claimRow], error: null } }, calls),
      subjectHashSecret: "s".repeat(32),
    });

    await expect(
      repository.claim({
        now: "2026-08-24T00:00:00.000Z",
        leaseUntil: LEASE_UNTIL,
        limit: 20,
      }),
    ).resolves.toEqual([
      {
        jobId: JOB_ID,
        targetKind: "CARE_EVENT",
        targetId: TARGET_ID,
        idempotencyKey: `care-event:${TARGET_ID}`,
        attemptCount: 1,
        leaseUntil: LEASE_UNTIL,
        claimToken: CLAIM_TOKEN,
        submissionStartedAt: null,
        submission: null,
      },
    ]);
    expect(calls[0]).toEqual({
      kind: "rpc",
      name: "claim_attestation_jobs",
      parameters: {
        p_now: "2026-08-24T00:00:00.000Z",
        p_lease_until: LEASE_UNTIL,
        p_limit: 20,
      },
    });
  });

  it("loads a CareEvent with an exact allowlist and never selects its raw JSON payload", async () => {
    const calls: Array<Readonly<Record<string, unknown>>> = [];
    const repository = createSupabaseAttestationRepository({
      client: createClient(
        {
          attestation_jobs: { data: processingJob, error: null },
          care_events: {
            data: {
              id: TARGET_ID,
              event_type: "ALERT_SENT",
              risk_level: "L3",
              hri: 72,
              occurred_at: "2026-08-24T00:00:00.000Z",
              subject_hash: "1".repeat(64),
              payload_hash: "2".repeat(64),
              attestation_uid: null,
            },
            error: null,
          },
        },
        calls,
      ),
      subjectHashSecret: "s".repeat(32),
    });

    await expect(
      repository.loadTarget({ ...claimRowToDto(), targetKind: "CARE_EVENT" }),
    ).resolves.toEqual({
      schemaKind: "CARE_EVENT",
      value: {
        subjectHash: `0x${"1".repeat(64)}`,
        eventType: 2,
        riskLevel: 3,
        hriScore: 72,
        occurredAt: 1_787_529_600n,
        payloadHash: `0x${"2".repeat(64)}`,
      },
      existingAttestationUid: null,
    });
    const selections = calls.filter((call) => call["kind"] === "select");
    expect(JSON.stringify(selections)).not.toMatch(/\bpayload\b|subject_id|name|phone|address/i);
  });

  it("loads a strict ShelterStatus and refuses an omitted crowd level instead of coercing it", async () => {
    const baseFixtures = {
      attestation_jobs: { data: processingJob, error: null },
      shelter_reports: {
        data: {
          id: TARGET_ID,
          shelter_id: "DG-0001",
          is_open: true,
          crowd_level: 1,
          observed_at: "2026-08-24T00:00:00.000Z",
          reporter_hash: "3".repeat(64),
          attestation_uid: null,
        },
        error: null,
      },
    } as const;
    const repository = createSupabaseAttestationRepository({
      client: createClient(baseFixtures),
      subjectHashSecret: "s".repeat(32),
    });

    await expect(
      repository.loadTarget({ ...claimRowToDto(), targetKind: "SHELTER_REPORT" }),
    ).resolves.toEqual({
      schemaKind: "SHELTER_STATUS",
      value: {
        shelterId: "DG-0001",
        isOpen: true,
        crowdLevel: 1,
        observedAt: 1_787_529_600n,
        reporterHash: `0x${"3".repeat(64)}`,
      },
      existingAttestationUid: null,
    });

    const missingCrowd = createSupabaseAttestationRepository({
      client: createClient({
        ...baseFixtures,
        shelter_reports: {
          data: { ...baseFixtures.shelter_reports.data, crowd_level: null },
          error: null,
        },
      }),
      subjectHashSecret: "s".repeat(32),
    });
    await expect(
      missingCrowd.loadTarget({ ...claimRowToDto(), targetKind: "SHELTER_REPORT" }),
    ).rejects.toMatchObject({ code: "INVALID_TARGET" });
  });

  it("derives a private CareEvent for a check-in using HMAC and a PII-free payload hash", async () => {
    const repository = createSupabaseAttestationRepository({
      client: createClient({
        attestation_jobs: { data: processingJob, error: null },
        shelter_checkins: {
          data: {
            id: TARGET_ID,
            subject_id: SUBJECT_ID,
            shelter_id: "DG-0002",
            checked_in_at: "2026-08-24T00:00:00.000Z",
            attestation_uid: null,
          },
          error: null,
        },
        risk_snapshots: {
          data: {
            subject_id: SUBJECT_ID,
            level: "L2",
            hri: 44,
            computed_at: "2026-08-23T23:59:00.000Z",
          },
          error: null,
        },
      }),
      subjectHashSecret: "s".repeat(32),
    });

    const target = await repository.loadTarget({
      ...claimRowToDto(),
      targetKind: "SHELTER_CHECKIN",
    });

    expect(target).toMatchObject({
      schemaKind: "CARE_EVENT",
      value: { eventType: 1, riskLevel: 2, hriScore: 44, occurredAt: 1_787_529_600n },
      existingAttestationUid: null,
    });
    expect(Object.values(target.value).map(String).join("|")).not.toContain(SUBJECT_ID);
    expect(target.value).toMatchObject({
      subjectHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      payloadHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("prohibits a chain write when either the job target or source already owns a UID", async () => {
    const repository = createSupabaseAttestationRepository({
      client: createClient({
        attestation_jobs: {
          data: { ...processingJob, attestation_uid: UID },
          error: null,
        },
      }),
      subjectHashSecret: "s".repeat(32),
    });

    await expect(repository.loadTarget(claimRowToDto())).rejects.toMatchObject({
      code: "ALREADY_ATTESTED",
      message: "ALREADY_ATTESTED",
    });
  });

  it("rejects a stale worker claim token before loading the source target", async () => {
    const calls: Array<Readonly<Record<string, unknown>>> = [];
    const repository = createSupabaseAttestationRepository({
      client: createClient(
        {
          attestation_jobs: {
            data: {
              ...processingJob,
              claim_token: "123e4567-e89b-42d3-a456-426614174099",
            },
            error: null,
          },
        },
        calls,
      ),
      subjectHashSecret: "s".repeat(32),
    });

    await expect(repository.loadTarget(claimRowToDto())).rejects.toMatchObject({
      code: "LEASE_LOST",
      message: "LEASE_LOST",
    });
    expect(calls.some((call) => call["table"] === "care_events")).toBe(false);
  });

  it("begins submission under the claim token and durably records its hash before confirmation", async () => {
    const calls: Array<Readonly<Record<string, unknown>>> = [];
    const repository = createSupabaseAttestationRepository({
      client: createClient(
        {
          begin_attestation_submission: { data: "APPLIED", error: null },
          record_attestation_submission: { data: "APPLIED", error: null },
        },
        calls,
      ),
      subjectHashSecret: "s".repeat(32),
    });

    await expect(
      repository.beginSubmission({
        jobId: JOB_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: LEASE_UNTIL,
        startedAt: "2026-08-24T00:00:01.000Z",
      }),
    ).resolves.toBe("APPLIED");
    await expect(
      repository.recordSubmission({
        jobId: JOB_ID,
        claimToken: CLAIM_TOKEN,
        submission: {
          transactionHash: TRANSACTION_HASH,
          chainId: 84532,
          schemaUid: SCHEMA_UID,
          issuer: ISSUER,
        },
        submittedAt: "2026-08-24T00:00:02.000Z",
      }),
    ).resolves.toBe("APPLIED");

    expect(calls).toContainEqual({
      kind: "rpc",
      name: "begin_attestation_submission",
      parameters: {
        p_job_id: JOB_ID,
        p_claim_token: CLAIM_TOKEN,
        p_expected_lease_until: LEASE_UNTIL,
        p_started_at: "2026-08-24T00:00:01.000Z",
      },
    });
    expect(calls).toContainEqual({
      kind: "rpc",
      name: "record_attestation_submission",
      parameters: {
        p_job_id: JOB_ID,
        p_claim_token: CLAIM_TOKEN,
        p_transaction_hash: `0x${"b".repeat(64)}`,
        p_chain_id: 84532,
        p_schema_uid: `0x${"c".repeat(64)}`,
        p_issuer: `0x${"d".repeat(40)}`,
        p_submitted_at: "2026-08-24T00:00:02.000Z",
      },
    });
  });

  it("rejects a mismatched target row even if the database response shape is otherwise valid", async () => {
    const repository = createSupabaseAttestationRepository({
      client: createClient({
        attestation_jobs: { data: processingJob, error: null },
        care_events: {
          data: {
            id: SUBJECT_ID,
            event_type: "VISIT",
            risk_level: "L0",
            hri: 0,
            occurred_at: "2026-08-24T00:00:00.000Z",
            subject_hash: "1".repeat(64),
            payload_hash: "2".repeat(64),
            attestation_uid: null,
          },
          error: null,
        },
      }),
      subjectHashSecret: "s".repeat(32),
    });

    await expect(repository.loadTarget(claimRowToDto())).rejects.toMatchObject({
      code: "INVALID_TARGET",
    });
  });

  it("finalizes verified metadata or exact retry state with lease compare-and-set", async () => {
    const calls: Array<Readonly<Record<string, unknown>>> = [];
    const repository = createSupabaseAttestationRepository({
      client: createClient(
        {
          finalize_attestation_job: {
            data: [{ disposition: "APPLIED", state: "VERIFIED" }],
            error: null,
          },
        },
        calls,
      ),
      subjectHashSecret: "s".repeat(32),
    });

    await expect(
      repository.finalize({
        jobId: JOB_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: LEASE_UNTIL,
        outcome: {
          kind: "VERIFIED",
          attestationUid: UID,
          transactionHash: TRANSACTION_HASH,
          chainId: 84532,
          schemaUid: SCHEMA_UID,
          issuer: ISSUER,
          verifiedAt: "2026-08-24T00:00:03.000Z",
        },
      }),
    ).resolves.toEqual({ disposition: "APPLIED", state: "VERIFIED" });

    expect(calls[0]).toMatchObject({
      kind: "rpc",
      name: "finalize_attestation_job",
      parameters: {
        p_job_id: JOB_ID,
        p_claim_token: CLAIM_TOKEN,
        p_expected_lease_until: LEASE_UNTIL,
        p_outcome: {
          kind: "VERIFIED",
          attestation_uid: UID,
          transaction_hash: `0x${"b".repeat(64)}`,
          chain_id: 84532,
          schema_uid: `0x${"c".repeat(64)}`,
          issuer: `0x${"d".repeat(40)}`,
          verified_at: "2026-08-24T00:00:03.000Z",
        },
      },
    });
  });

  it("maps database payloads and errors to stable non-sensitive failures", async () => {
    const repository = createSupabaseAttestationRepository({
      client: createClient({
        claim_attestation_jobs: {
          data: [{ ...claimRow, private_name: "sensitive" }],
          error: null,
        },
      }),
      subjectHashSecret: "s".repeat(32),
    });

    const error = await repository
      .claim({ now: "2026-08-24T00:00:00.000Z", leaseUntil: LEASE_UNTIL, limit: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AttestationRepositoryError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE", message: "INVALID_RESPONSE" });
    expect(JSON.stringify(error)).not.toContain("sensitive");
  });
});

function claimRowToDto() {
  return {
    jobId: JOB_ID,
    targetKind: "CARE_EVENT" as const,
    targetId: TARGET_ID,
    idempotencyKey: `care-event:${TARGET_ID}`,
    attemptCount: 1,
    leaseUntil: LEASE_UNTIL,
    claimToken: CLAIM_TOKEN,
    submissionStartedAt: null,
    submission: null,
  };
}
