import { describe, expect, it, vi } from "vitest";

import { EasClientError, type EasAttestationClient } from "./eas.server";
import type {
  AttestationFinalizeCommand,
  AttestationFinalizeResult,
  AttestationRepository,
  ClaimedAttestationJob,
} from "./repository.server";
import { runAttestationWorker } from "./worker.server";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";
const TARGET_ID = "123e4567-e89b-42d3-a456-426614174001";
const LEASE_UNTIL = "2026-08-24T00:04:00.000Z";
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174003";
const UID = `0x${"a".repeat(64)}` as const;

const claimedJob = (attemptCount = 1): ClaimedAttestationJob => ({
  jobId: JOB_ID,
  targetKind: "CARE_EVENT",
  targetId: TARGET_ID,
  idempotencyKey: `care-event:${TARGET_ID}`,
  attemptCount,
  leaseUntil: LEASE_UNTIL,
  claimToken: CLAIM_TOKEN,
  submissionStartedAt: null,
  submission: null,
});

const target = {
  schemaKind: "CARE_EVENT" as const,
  value: {
    subjectHash: `0x${"1".repeat(64)}` as const,
    eventType: 2 as const,
    riskLevel: 3 as const,
    hriScore: 72,
    occurredAt: 1_787_529_600n,
    payloadHash: `0x${"2".repeat(64)}` as const,
  },
  existingAttestationUid: null,
};

const verified = {
  attestationUid: UID,
  transactionHash: `0x${"b".repeat(64)}` as const,
  chainId: 84532 as const,
  schemaUid: `0x${"c".repeat(64)}` as const,
  issuer: `0x${"d".repeat(40)}` as const,
  verifiedAt: "2026-08-24T00:00:03.000Z",
};
const submission = {
  transactionHash: verified.transactionHash,
  chainId: verified.chainId,
  schemaUid: verified.schemaUid,
  issuer: verified.issuer,
};

const setup = (options?: {
  job?: ClaimedAttestationJob;
  eas?: EasAttestationClient;
  finalizeResult?: AttestationFinalizeResult;
  finalizeThrows?: boolean;
}) => {
  const finalizations: AttestationFinalizeCommand[] = [];
  const repository: AttestationRepository = {
    claim: async () => [options?.job ?? claimedJob()],
    loadTarget: async () => target,
    beginSubmission: async () => "APPLIED",
    recordSubmission: async () => "APPLIED",
    finalize: async (command) => {
      finalizations.push(command);
      if (options?.finalizeThrows) throw new Error("database secret");
      return (
        options?.finalizeResult ?? {
          disposition: "APPLIED",
          state: command.outcome.kind,
        }
      );
    },
  };
  const eas: EasAttestationClient = options?.eas ?? {
    submit: async () => submission,
    confirm: async () => verified,
    attest: async () => verified,
  };
  return { repository, eas, finalizations };
};

const run = (repository: AttestationRepository, eas: EasAttestationClient) =>
  runAttestationWorker({
    repository,
    eas,
    now: () => new Date("2026-08-24T00:00:00.000Z"),
    limit: 10,
  });

describe("durable Base Sepolia attestation worker", () => {
  it("records the transaction hash durably before it starts receipt confirmation", async () => {
    const order: string[] = [];
    const finalizations: AttestationFinalizeCommand[] = [];
    const repository = {
      claim: async () => [claimedJob()],
      loadTarget: async () => target,
      beginSubmission: async () => {
        order.push("begin");
        return "APPLIED" as const;
      },
      recordSubmission: async () => {
        order.push("record");
        return "APPLIED" as const;
      },
      finalize: async (command: AttestationFinalizeCommand) => {
        order.push("finalize");
        finalizations.push(command);
        return { disposition: "APPLIED" as const, state: command.outcome.kind };
      },
    } satisfies AttestationRepository;
    const eas = {
      submit: async () => {
        order.push("submit");
        return submission;
      },
      confirm: async () => {
        order.push("confirm");
        return verified;
      },
      attest: async () => {
        order.push("legacy-attest");
        return verified;
      },
    } satisfies EasAttestationClient;

    await run(repository, eas);

    expect(order).toEqual(["begin", "submit", "record", "confirm", "finalize"]);
    expect(finalizations[0]?.outcome).toEqual({ kind: "VERIFIED", ...verified });
  });

  it("rechecks a durably stored transaction without submitting a second attestation", async () => {
    const job = {
      ...claimedJob(2),
      submissionStartedAt: "2026-08-24T00:00:01.000Z",
      submission,
    };
    const beginSubmission = vi.fn(async () => "APPLIED" as const);
    const recordSubmission = vi.fn(async () => "APPLIED" as const);
    const submit = vi.fn(async () => submission);
    const confirm = vi.fn(async () => verified);
    const context = setup({
      job,
      eas: {
        submit,
        confirm,
        attest: async () => verified,
      } as EasAttestationClient,
    });
    context.repository.beginSubmission = beginSubmission;
    context.repository.recordSubmission = recordSubmission;

    await run(context.repository, context.eas);

    expect(beginSubmission).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(recordSubmission).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(submission);
    expect(context.finalizations[0]?.outcome.kind).toBe("VERIFIED");
  });

  it("stops a stale lease owner without calling EAS or finalizing another worker's job", async () => {
    const submit = vi.fn();
    const confirm = vi.fn();
    const context = setup({
      eas: { submit, confirm, attest: vi.fn() } as unknown as EasAttestationClient,
    });
    context.repository.loadTarget = async () => {
      throw new (await import("./repository.server")).AttestationRepositoryError("LEASE_LOST");
    };

    const result = await run(context.repository, context.eas);

    expect(submit).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(context.finalizations).toEqual([]);
    expect(result).toMatchObject({ kind: "COMPLETED", leaseLost: 1 });
  });

  it("claims, loads, attests, and finalizes verified receipt metadata", async () => {
    const context = setup();

    await expect(run(context.repository, context.eas)).resolves.toEqual({
      kind: "COMPLETED",
      claimed: 1,
      verified: 1,
      retryScheduled: 0,
      failed: 0,
      leaseLost: 0,
      finalizeFailed: 0,
    });
    expect(context.finalizations).toEqual([
      {
        jobId: JOB_ID,
        claimToken: CLAIM_TOKEN,
        expectedLeaseUntil: LEASE_UNTIL,
        outcome: { kind: "VERIFIED", ...verified },
      },
    ]);
  });

  it.each([
    [1, "2026-08-24T00:00:02.000Z"],
    [2, "2026-08-24T00:00:08.000Z"],
    [3, "2026-08-24T00:00:32.000Z"],
  ])("uses exact retry delay for claimed attempt %i", async (attemptCount, nextAttemptAt) => {
    const eas: EasAttestationClient = {
      submit: async () => {
        throw new EasClientError("SUBMISSION_TEMPORARY", true);
      },
      confirm: async () => verified,
      attest: async () => verified,
    };
    const context = setup({ job: claimedJob(attemptCount), eas });

    const result = await run(context.repository, context.eas);

    expect(context.finalizations[0]?.outcome).toEqual({
      kind: "RETRY_WAIT",
      errorCode: "SUBMISSION_TEMPORARY",
      nextAttemptAt,
    });
    expect(result).toMatchObject({ kind: "COMPLETED", retryScheduled: 1 });
  });

  it("fails after the three scheduled retries instead of creating another transaction", async () => {
    const eas: EasAttestationClient = {
      submit: async () => {
        throw new EasClientError("SUBMISSION_TEMPORARY", true);
      },
      confirm: async () => verified,
      attest: async () => verified,
    };
    const context = setup({ job: claimedJob(4), eas });

    await run(context.repository, context.eas);

    expect(context.finalizations[0]?.outcome).toEqual({
      kind: "FAILED",
      errorCode: "RETRY_EXHAUSTED",
    });
  });

  it("retries receipt confirmation safely after the transaction hash is durable", async () => {
    const eas: EasAttestationClient = {
      submit: async () => submission,
      confirm: async () => {
        throw new EasClientError("CONFIRMATION_UNCERTAIN", false);
      },
      attest: async () => verified,
    };
    const context = setup({ eas });

    await run(context.repository, context.eas);

    expect(context.finalizations[0]?.outcome).toEqual({
      kind: "RETRY_WAIT",
      errorCode: "CONFIRMATION_UNCERTAIN",
      nextAttemptAt: "2026-08-24T00:00:02.000Z",
    });
  });

  it("prevents an already-UID job from reaching the EAS client", async () => {
    const submit = vi.fn<EasAttestationClient["submit"]>();
    const context = setup({
      eas: { submit, confirm: async () => verified, attest: async () => verified },
    });
    context.repository.loadTarget = async () => {
      throw new (await import("./repository.server")).AttestationRepositoryError(
        "ALREADY_ATTESTED",
      );
    };

    await run(context.repository, context.eas);

    expect(submit).not.toHaveBeenCalled();
    expect(context.finalizations[0]?.outcome).toEqual({
      kind: "FAILED",
      errorCode: "ALREADY_ATTESTED",
    });
  });

  it("keeps a previously saved source event independent when EAS fails", async () => {
    const sourceEvent = Object.freeze({ id: TARGET_ID, saved: true });
    const context = setup({
      eas: {
        submit: async () => submission,
        confirm: async () => {
          throw new EasClientError("TRANSACTION_REVERTED", false);
        },
        attest: async () => verified,
      },
    });

    const result = await run(context.repository, context.eas);

    expect(sourceEvent).toEqual({ id: TARGET_ID, saved: true });
    expect(context.finalizations[0]?.outcome).toEqual({
      kind: "FAILED",
      errorCode: "TRANSACTION_REVERTED",
    });
    expect(result).toMatchObject({ kind: "COMPLETED", failed: 1 });
  });

  it("contains finalize failure and returns a non-sensitive result instead of rolling back work", async () => {
    const context = setup({ finalizeThrows: true });

    const result = await run(context.repository, context.eas);

    expect(result).toMatchObject({
      kind: "COMPLETED",
      claimed: 1,
      verified: 0,
      finalizeFailed: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|private|wallet/i);
  });

  it("returns a stable temporary result when the durable claim is unavailable", async () => {
    const repository: AttestationRepository = {
      claim: async () => {
        throw new Error("database token=secret");
      },
      loadTarget: async () => target,
      beginSubmission: async () => "APPLIED",
      recordSubmission: async () => "APPLIED",
      finalize: async () => ({ disposition: "APPLIED", state: "FAILED" }),
    };

    await expect(
      run(repository, {
        submit: async () => submission,
        confirm: async () => verified,
        attest: async () => verified,
      }),
    ).resolves.toEqual({
      kind: "TEMPORARY_FAILURE",
      code: "OUTBOX_UNAVAILABLE",
    });
  });
});
