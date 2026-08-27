import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createDefaultMedicationApiCacheRepository } from "@/integrations/mfds/cache.server";
import {
  createDefaultDurClient,
  DUR_OPERATIONS,
  type DurClient,
  type DurItemResult,
} from "@/integrations/mfds/dur.server";
import {
  createDefaultEasyDrugClient,
  type EasyDrugClient,
  type EasyDrugItem,
} from "@/integrations/mfds/easy-drug.server";
import type { MedicationMatchMethod, PillIdentificationItem } from "@/integrations/mfds/matching";
import {
  createDefaultPillIdentificationClient,
  type PillIdentificationClient,
} from "@/integrations/mfds/pill-identification.server";
import { resolvePillIdentificationCandidate } from "@/integrations/mfds/resolver.server";
import { classifyMedication } from "@/lib/medication/classify";
import type { MedicationExtraction } from "@/lib/medication/extraction/schema";
import { resolveMedicationConfidence } from "@/lib/medication/confidence";

import { MedicationCandidateSchema, type MedicationCandidate } from "./schema";
import type {
  MedicationCandidateEnrichmentResult,
  MedicationCandidateResolverPort,
  SelectedMedicationCandidateEnricherPort,
} from "./service";

type CandidateResolverDependencies = Readonly<{
  pillClient: PillIdentificationClient;
  easyDrugClient: EasyDrugClient;
  durClient: DurClient;
  candidateIdFactory?: () => string;
  nowMs?: () => number;
  resolutionDeadlineMs?: number;
  maxPillLookups?: number;
  maxEnrichedCandidates?: number;
}>;

type SelectedCandidateEnricherDependencies = Readonly<{
  pillClient: PillIdentificationClient;
  easyDrugClient: EasyDrugClient;
  durClient: DurClient;
  nowMs?: () => number;
  resolutionDeadlineMs?: number;
}>;

type ExtractionItem = MedicationExtraction["items"][number];
type MfdsEvidence = NonNullable<MedicationCandidate["mfds"]>;

const MAX_MATCHES_PER_ITEM = 10;
const MAX_CANDIDATES = 30;
const DEFAULT_MAX_PILL_LOOKUPS = 5;
const DEFAULT_MAX_ENRICHED_CANDIDATES = 3;
const DEFAULT_RESOLUTION_DEADLINE_MS = 12_000;

class MedicationResolutionBudgetExceeded extends Error {
  constructor() {
    super("MEDICATION_RESOLUTION_BUDGET_EXCEEDED");
    this.name = "MedicationResolutionBudgetExceeded";
  }
}

async function beforeDeadline<T>(input: {
  operation: () => Promise<T>;
  deadlineAt: number;
  nowMs: () => number;
}): Promise<T> {
  const remainingMs = input.deadlineAt - input.nowMs();
  if (remainingMs <= 0) throw new MedicationResolutionBudgetExceeded();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new MedicationResolutionBudgetExceeded()), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sourceForConfidence(confidence: number): "AI_AUTO" | "AI_CONFIRMED" {
  return resolveMedicationConfidence(confidence).disposition === "AUTO"
    ? "AI_AUTO"
    : "AI_CONFIRMED";
}

function fallbackProductName(item: ExtractionItem): string {
  return (item.productName ?? item.rawText).normalize("NFKC").trim().slice(0, 200);
}

function unavailableDurEvidence(): NonNullable<MfdsEvidence["dur"]> {
  return Object.fromEntries(
    DUR_OPERATIONS.map((operation) => [
      operation,
      { status: "UNAVAILABLE" as const, totalCount: null, items: [] },
    ]),
  ) as unknown as NonNullable<MfdsEvidence["dur"]>;
}

function toDurEvidence(result: DurItemResult): NonNullable<MfdsEvidence["dur"]> {
  return Object.fromEntries(
    DUR_OPERATIONS.map((operation) => {
      const operationResult = result.operations[operation];
      return [
        operation,
        {
          status: operationResult.status,
          totalCount: operationResult.page?.totalCount ?? null,
          items: operationResult.page?.items.slice(0, 10) ?? [],
        },
      ];
    }),
  ) as NonNullable<MfdsEvidence["dur"]>;
}

function easyDrugEvidence(item: EasyDrugItem): NonNullable<MfdsEvidence["easyDrug"]> {
  return {
    itemSeq: item.itemSeq,
    itemName: item.itemName,
    manufacturerName: item.manufacturerName,
    efficacy: item.efficacy,
    usage: item.usage,
    warning: item.warning,
    caution: item.caution,
    interaction: item.interaction,
    sideEffects: item.sideEffects,
    storage: item.storage,
    openDate: item.openDate,
    updateDate: item.updateDate,
    productImageUrl: item.productImageUrl,
  };
}

type IdentifiedEnrichment = Readonly<{
  ingredientName: string | null;
  easyDrug: MfdsEvidence["easyDrug"];
  easyDrugStatus: MfdsEvidence["sourceStatus"]["easyDrug"];
  dur: NonNullable<MfdsEvidence["dur"]>;
  durStatus: MfdsEvidence["sourceStatus"]["dur"];
}>;

async function enrichmentForItem(
  easyDrugClient: EasyDrugClient,
  durClient: DurClient,
  itemSeq: string,
): Promise<IdentifiedEnrichment> {
  const [easyDrugResult, durResult] = await Promise.allSettled([
    easyDrugClient.search({ itemSeq, numOfRows: 1 }),
    durClient.getAllForItem(itemSeq),
  ]);

  let easyDrug: MfdsEvidence["easyDrug"] = null;
  let easyDrugStatus: MfdsEvidence["sourceStatus"]["easyDrug"] = "UNAVAILABLE";
  if (easyDrugResult.status === "fulfilled") {
    const matching = easyDrugResult.value.items.find((item) => item.itemSeq === itemSeq);
    easyDrug = matching ? easyDrugEvidence(matching) : null;
    easyDrugStatus = matching ? "AVAILABLE" : "PARTIAL";
    if (easyDrugResult.value.totalCount > easyDrugResult.value.items.length) {
      easyDrugStatus = "PARTIAL";
    }
  }

  const durStatus = durResult.status === "fulfilled" ? durResult.value.status : "UNAVAILABLE";
  const dur =
    durResult.status === "fulfilled" ? toDurEvidence(durResult.value) : unavailableDurEvidence();
  const ingredientName =
    dur.PRODUCT.items.find((item) => item.itemSeq === itemSeq)?.ingredientName ?? null;

  return { ingredientName, easyDrug, easyDrugStatus, dur, durStatus };
}

function unidentifiedEvidence(pillIdentification: "PARTIAL" | "UNAVAILABLE"): MfdsEvidence {
  return {
    matchMethod: null,
    productImageUrl: null,
    sourceStatus: {
      pillIdentification,
      easyDrug: "UNAVAILABLE",
      dur: "UNAVAILABLE",
    },
    easyDrug: null,
    dur: null,
  };
}

function deferredIdentifiedEvidence(
  item: PillIdentificationItem,
  method: MedicationMatchMethod,
): MfdsEvidence {
  return {
    matchMethod: method,
    productImageUrl: item.productImageUrl,
    sourceStatus: {
      pillIdentification: "AVAILABLE",
      easyDrug: "PARTIAL",
      dur: "PARTIAL",
    },
    easyDrug: null,
    dur: null,
  };
}

function classifiedCandidate(input: {
  candidateId: string;
  item: ExtractionItem;
  mfds: PillIdentificationItem | null;
  ingredientName: string | null;
  evidence: MfdsEvidence;
  requiresSelection?: boolean;
}): MedicationCandidate {
  const classification = classifyMedication({
    ingredientNames: input.ingredientName ? [input.ingredientName] : [],
    ...((input.mfds?.itemName ?? input.item.productName)
      ? { productName: input.mfds?.itemName ?? input.item.productName! }
      : {}),
  });
  const match = classification.matches[0];
  const confidencePolicy = resolveMedicationConfidence(input.item.confidence);

  return MedicationCandidateSchema.parse({
    candidateId: input.candidateId,
    productName: input.mfds?.itemName ?? fallbackProductName(input.item),
    itemSeq: input.mfds?.itemSeq ?? null,
    manufacturerName: input.mfds?.manufacturerName ?? null,
    ingredientName: input.ingredientName,
    heatClass: match?.heatClass ?? null,
    riskTier: match?.tier ?? "NONE",
    confidence: input.item.confidence,
    source: input.requiresSelection ? "AI_CONFIRMED" : sourceForConfidence(input.item.confidence),
    evidenceSource: input.mfds ? "GEMINI_MFDS" : "GEMINI_ONLY",
    selected: input.requiresSelection ? false : confidencePolicy.selectedByDefault,
    mfds: input.evidence,
  });
}

function candidateKey(candidate: MedicationCandidate): string {
  return candidate.itemSeq ?? candidate.productName.normalize("NFKC").trim().toLowerCase();
}

function reviewedCandidate(input: {
  candidate: MedicationCandidate;
  productName: string;
  itemSeq: string;
  ingredientName: string;
  mfds: PillIdentificationItem | null;
  evidence: MfdsEvidence;
}): MedicationCandidate {
  const productName = input.mfds?.itemName ?? input.productName.normalize("NFKC").trim();
  const ingredientName = input.ingredientName.normalize("NFKC").trim() || null;
  const classification = classifyMedication({
    productName,
    ingredientNames: ingredientName ? [ingredientName] : [],
  });
  const match = classification.matches[0];
  return MedicationCandidateSchema.parse({
    ...input.candidate,
    productName,
    itemSeq: input.mfds?.itemSeq ?? (input.itemSeq.trim() || null),
    manufacturerName: input.mfds?.manufacturerName ?? input.candidate.manufacturerName,
    ingredientName,
    heatClass: match?.heatClass ?? null,
    riskTier: match?.tier ?? "NONE",
    mfds: input.evidence,
  });
}

function providerFailureCandidate(input: {
  candidate: MedicationCandidate;
  productName: string;
  itemSeq: string;
  ingredientName: string;
  pillStatus: "PARTIAL" | "UNAVAILABLE";
}): MedicationCandidate {
  return reviewedCandidate({
    ...input,
    mfds: null,
    evidence: unidentifiedEvidence(input.pillStatus),
  });
}

export function createSelectedMedicationCandidateEnricher(
  dependencies: SelectedCandidateEnricherDependencies,
): SelectedMedicationCandidateEnricherPort {
  const nowMs = dependencies.nowMs ?? Date.now;
  const resolutionDeadlineMs = z
    .number()
    .int()
    .positive()
    .max(30_000)
    .parse(dependencies.resolutionDeadlineMs ?? DEFAULT_RESOLUTION_DEADLINE_MS);

  return {
    async enrich(input): Promise<MedicationCandidateEnrichmentResult> {
      const candidate = MedicationCandidateSchema.parse(input.candidate);
      const productName = z.string().trim().min(1).max(200).parse(input.productName);
      const itemSeq = z
        .union([z.literal(""), z.string().regex(/^\d{1,20}$/u)])
        .parse(input.itemSeq);
      const ingredientName = z.string().trim().max(500).parse(input.ingredientName);
      const deadlineAt = nowMs() + resolutionDeadlineMs;

      let match;
      try {
        match = await beforeDeadline({
          operation: () =>
            resolvePillIdentificationCandidate(
              dependencies.pillClient,
              itemSeq ? { itemSeq } : { productName },
            ),
          deadlineAt,
          nowMs,
        });
      } catch {
        return {
          outcome: "SOURCE_UNAVAILABLE",
          candidate: providerFailureCandidate({
            candidate,
            productName,
            itemSeq,
            ingredientName,
            pillStatus: "UNAVAILABLE",
          }),
        };
      }

      if (match.status === "NONE") {
        return {
          outcome: "MATCH_NOT_FOUND",
          candidate: providerFailureCandidate({
            candidate,
            productName,
            itemSeq,
            ingredientName,
            pillStatus: "PARTIAL",
          }),
        };
      }
      if (match.status === "AMBIGUOUS") {
        return {
          outcome: "SELECTION_REQUIRED",
          candidate: providerFailureCandidate({
            candidate,
            productName,
            itemSeq,
            ingredientName,
            pillStatus: "PARTIAL",
          }),
        };
      }

      const mfds = match.candidates[0];
      let enrichment: IdentifiedEnrichment;
      try {
        enrichment = await beforeDeadline({
          operation: () =>
            enrichmentForItem(dependencies.easyDrugClient, dependencies.durClient, mfds.itemSeq),
          deadlineAt,
          nowMs,
        });
      } catch {
        return {
          outcome: "SOURCE_UNAVAILABLE",
          candidate: reviewedCandidate({
            candidate,
            productName,
            itemSeq,
            ingredientName,
            mfds,
            evidence: deferredIdentifiedEvidence(mfds, match.method),
          }),
        };
      }

      return {
        outcome: "ENRICHED",
        candidate: reviewedCandidate({
          candidate,
          productName,
          itemSeq,
          ingredientName: enrichment.ingredientName ?? ingredientName,
          mfds,
          evidence: {
            matchMethod: match.method,
            productImageUrl: mfds.productImageUrl ?? enrichment.easyDrug?.productImageUrl ?? null,
            sourceStatus: {
              pillIdentification: "AVAILABLE",
              easyDrug: enrichment.easyDrugStatus,
              dur: enrichment.durStatus,
            },
            easyDrug: enrichment.easyDrug,
            dur: enrichment.dur,
          },
        }),
      };
    },
  };
}

export function createMedicationCandidateResolver(
  dependencies: CandidateResolverDependencies,
): MedicationCandidateResolverPort {
  const candidateIdFactory = dependencies.candidateIdFactory ?? randomUUID;
  const nowMs = dependencies.nowMs ?? Date.now;
  const resolutionDeadlineMs = z
    .number()
    .int()
    .positive()
    .max(30_000)
    .parse(dependencies.resolutionDeadlineMs ?? DEFAULT_RESOLUTION_DEADLINE_MS);
  const maxPillLookups = z
    .number()
    .int()
    .min(1)
    .max(30)
    .parse(dependencies.maxPillLookups ?? DEFAULT_MAX_PILL_LOOKUPS);
  const maxEnrichedCandidates = z
    .number()
    .int()
    .min(1)
    .max(30)
    .parse(dependencies.maxEnrichedCandidates ?? DEFAULT_MAX_ENRICHED_CANDIDATES);

  return {
    async resolve(extraction: MedicationExtraction): Promise<readonly MedicationCandidate[]> {
      const resolved: MedicationCandidate[] = [];
      const enrichmentByItemSeq = new Map<string, Promise<IdentifiedEnrichment>>();
      const deadlineAt = nowMs() + resolutionDeadlineMs;
      let pillLookupCount = 0;
      let enrichedCandidateCount = 0;
      for (const item of extraction.items) {
        if (resolved.length >= MAX_CANDIDATES) break;
        const lookup = {
          ...(item.productName ? { productName: item.productName } : {}),
          ...(item.imprint ? { imprint: item.imprint } : {}),
          ...(item.shape ? { shape: item.shape } : {}),
          ...(item.color ? { color: item.color } : {}),
        };
        const hasLookup = Boolean(item.productName || (item.imprint && item.shape && item.color));
        const hasPillLookupBudget =
          hasLookup && pillLookupCount < maxPillLookups && nowMs() < deadlineAt;
        if (!hasPillLookupBudget) {
          resolved.push(
            classifiedCandidate({
              candidateId: candidateIdFactory(),
              item,
              mfds: null,
              ingredientName: null,
              evidence: unidentifiedEvidence(hasLookup ? "PARTIAL" : "UNAVAILABLE"),
            }),
          );
          continue;
        }

        let match;
        try {
          pillLookupCount += 1;
          match = await beforeDeadline({
            operation: () => resolvePillIdentificationCandidate(dependencies.pillClient, lookup),
            deadlineAt,
            nowMs,
          });
        } catch {
          resolved.push(
            classifiedCandidate({
              candidateId: candidateIdFactory(),
              item,
              mfds: null,
              ingredientName: null,
              evidence: unidentifiedEvidence("UNAVAILABLE"),
            }),
          );
          continue;
        }

        if (match.status === "NONE") {
          resolved.push(
            classifiedCandidate({
              candidateId: candidateIdFactory(),
              item,
              mfds: null,
              ingredientName: null,
              evidence: unidentifiedEvidence(hasLookup ? "PARTIAL" : "UNAVAILABLE"),
            }),
          );
          continue;
        }

        for (const mfds of match.candidates.slice(0, MAX_MATCHES_PER_ITEM)) {
          if (resolved.length >= MAX_CANDIDATES) break;
          const matchMethod = match.method as MedicationMatchMethod;
          if (match.requiresSelection) {
            resolved.push(
              classifiedCandidate({
                candidateId: candidateIdFactory(),
                item,
                mfds,
                ingredientName: null,
                requiresSelection: true,
                evidence: deferredIdentifiedEvidence(mfds, matchMethod),
              }),
            );
            continue;
          }

          let enrichmentPromise = enrichmentByItemSeq.get(mfds.itemSeq);
          if (!enrichmentPromise) {
            if (enrichedCandidateCount >= maxEnrichedCandidates || nowMs() >= deadlineAt) {
              resolved.push(
                classifiedCandidate({
                  candidateId: candidateIdFactory(),
                  item,
                  mfds,
                  ingredientName: null,
                  evidence: deferredIdentifiedEvidence(mfds, matchMethod),
                }),
              );
              continue;
            }
            enrichedCandidateCount += 1;
            enrichmentPromise = beforeDeadline({
              operation: () =>
                enrichmentForItem(
                  dependencies.easyDrugClient,
                  dependencies.durClient,
                  mfds.itemSeq,
                ),
              deadlineAt,
              nowMs,
            });
            enrichmentByItemSeq.set(mfds.itemSeq, enrichmentPromise);
          }
          let enrichment: IdentifiedEnrichment;
          try {
            enrichment = await enrichmentPromise;
          } catch {
            resolved.push(
              classifiedCandidate({
                candidateId: candidateIdFactory(),
                item,
                mfds,
                ingredientName: null,
                evidence: deferredIdentifiedEvidence(mfds, matchMethod),
              }),
            );
            continue;
          }
          resolved.push(
            classifiedCandidate({
              candidateId: candidateIdFactory(),
              item,
              mfds,
              ingredientName: enrichment.ingredientName,
              requiresSelection: match.requiresSelection,
              evidence: {
                matchMethod,
                productImageUrl:
                  mfds.productImageUrl ?? enrichment.easyDrug?.productImageUrl ?? null,
                sourceStatus: {
                  pillIdentification: "AVAILABLE",
                  easyDrug: enrichment.easyDrugStatus,
                  dur: enrichment.durStatus,
                },
                easyDrug: enrichment.easyDrug,
                dur: enrichment.dur,
              },
            }),
          );
        }
      }

      const unique = new Map<string, MedicationCandidate>();
      for (const candidate of resolved) {
        const key = candidateKey(candidate);
        const existing = unique.get(key);
        if (!existing || (candidate.confidence ?? 0) > (existing.confidence ?? 0)) {
          unique.set(key, candidate);
        }
      }
      return [...unique.values()].slice(0, 30);
    },
  };
}

export function createDefaultMedicationCandidateResolver(): MedicationCandidateResolverPort {
  const cache = createDefaultMedicationApiCacheRepository();
  return createMedicationCandidateResolver({
    pillClient: createDefaultPillIdentificationClient(cache),
    easyDrugClient: createDefaultEasyDrugClient(cache),
    durClient: createDefaultDurClient(cache),
  });
}

export function createDefaultSelectedMedicationCandidateEnricher(): SelectedMedicationCandidateEnricherPort {
  const cache = createDefaultMedicationApiCacheRepository();
  return createSelectedMedicationCandidateEnricher({
    pillClient: createDefaultPillIdentificationClient(cache),
    easyDrugClient: createDefaultEasyDrugClient(cache),
    durClient: createDefaultDurClient(cache),
  });
}
