import "@tanstack/react-start/server-only";

import type { MedicationRequestResult } from "@/lib/medication/scan/request.server";
import type {
  MedicationConfirmationReceipt,
  MedicationImageScanResult,
} from "@/lib/medication/scan/service";

export type MedicationRouteOperations = Readonly<{
  capture(input: {
    subjectId: string;
    retrySessionId?: string;
    image: File;
  }): Promise<MedicationRequestResult<MedicationImageScanResult>>;
  manual(input: unknown): Promise<MedicationRequestResult<unknown>>;
  enrich(input: unknown): Promise<MedicationRequestResult<unknown>>;
  confirm(input: unknown): Promise<MedicationRequestResult<MedicationConfirmationReceipt>>;
}>;

const productionOperations: MedicationRouteOperations = {
  async capture(input) {
    const { captureMedicationForRequest } = await import("@/lib/medication/scan/request.server");
    return captureMedicationForRequest(input);
  },
  async manual(input) {
    const { manualMedicationForRequest } = await import("@/lib/medication/scan/request.server");
    return manualMedicationForRequest(input);
  },
  async enrich(input) {
    const { enrichMedicationCandidateForRequest } =
      await import("@/lib/medication/scan/request.server");
    return enrichMedicationCandidateForRequest(input);
  },
  async confirm(input) {
    const { confirmMedicationForRequest } = await import("@/lib/medication/scan/request.server");
    return confirmMedicationForRequest(input);
  },
};

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function publicOperationResponse(result: MedicationRequestResult<unknown>): Response {
  if (result.kind === "success") return privateJson({ ok: true, data: result.data }, 200);
  if (result.kind === "redirect") {
    return privateJson({ ok: false, code: "AUTH_REQUIRED", href: result.href }, 401);
  }
  const status =
    result.error.code === "INVALID_REQUEST"
      ? 400
      : result.error.code === "NOT_FOUND"
        ? 404
        : result.error.code === "REVIEW_CHANGED"
          ? 409
          : 500;
  return privateJson({ ok: false, code: result.error.code }, status);
}

function textField(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

/** Raw multipart boundary: values are parsed, authorized again server-side, and never echoed. */
export async function handleMedicationPostRequest(
  request: Request,
  operations: MedicationRouteOperations = productionOperations,
): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return privateJson({ ok: false, code: "INVALID_REQUEST" }, 400);
  }

  const operation = textField(form, "operation");
  if (operation === "capture") {
    const subjectId = textField(form, "subjectId");
    const retrySessionId = textField(form, "scanSessionId");
    const image = form.get("image");
    if (!subjectId || !(image instanceof File)) {
      return privateJson({ ok: false, code: "INVALID_REQUEST" }, 400);
    }
    return publicOperationResponse(
      await operations.capture({
        subjectId,
        ...(retrySessionId ? { retrySessionId } : {}),
        image,
      }),
    );
  }

  if (operation === "manual") {
    const subjectId = textField(form, "subjectId");
    const productName = textField(form, "productName");
    const itemSeq = textField(form, "itemSeq");
    const ingredientName = textField(form, "ingredientName");
    if (subjectId === null || productName === null || itemSeq === null || ingredientName === null) {
      return privateJson({ ok: false, code: "INVALID_REQUEST" }, 400);
    }
    return publicOperationResponse(
      await operations.manual({ subjectId, productName, itemSeq, ingredientName }),
    );
  }

  if (operation === "confirm") {
    const payload = textField(form, "payload");
    if (!payload || payload.length > 100_000) {
      return privateJson({ ok: false, code: "INVALID_REQUEST" }, 400);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return privateJson({ ok: false, code: "INVALID_REQUEST" }, 400);
    }
    return publicOperationResponse(await operations.confirm(parsed));
  }

  if (operation === "enrich") {
    const subjectId = textField(form, "subjectId");
    const scanSessionId = textField(form, "scanSessionId");
    const candidateId = textField(form, "candidateId");
    const productName = textField(form, "productName");
    const itemSeq = textField(form, "itemSeq");
    const ingredientName = textField(form, "ingredientName");
    if (
      subjectId === null ||
      scanSessionId === null ||
      candidateId === null ||
      productName === null ||
      itemSeq === null ||
      ingredientName === null
    ) {
      return privateJson({ ok: false, code: "INVALID_REQUEST" }, 400);
    }
    return publicOperationResponse(
      await operations.enrich({
        subjectId,
        scanSessionId,
        candidateId,
        productName,
        itemSeq,
        ingredientName,
      }),
    );
  }

  return privateJson({ ok: false, code: "INVALID_REQUEST" }, 400);
}
