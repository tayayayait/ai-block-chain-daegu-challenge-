import "@tanstack/react-start/server-only";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type MedicationUploadErrorCode =
  | "IMAGE_MISSING"
  | "IMAGE_EMPTY"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_TYPE_UNSUPPORTED"
  | "IMAGE_SIGNATURE_INVALID";

export class MedicationUploadError extends Error {
  constructor(readonly code: MedicationUploadErrorCode) {
    super(code);
    this.name = "MedicationUploadError";
  }
}

export type ValidatedMedicationUpload = Readonly<{
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}>;

function hasPrefix(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function hasAsciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

export async function validateMedicationUpload(file: File): Promise<ValidatedMedicationUpload> {
  if (!(file instanceof File)) throw new MedicationUploadError("IMAGE_MISSING");
  if (file.size <= 0) throw new MedicationUploadError("IMAGE_EMPTY");
  if (file.size > MAX_UPLOAD_BYTES) throw new MedicationUploadError("IMAGE_TOO_LARGE");

  const mimeType = file.type.toLowerCase();
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
    throw new MedicationUploadError("IMAGE_TYPE_UNSUPPORTED");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const valid =
    (mimeType === "image/jpeg" && hasPrefix(bytes, [0xff, 0xd8, 0xff])) ||
    (mimeType === "image/png" &&
      hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === "image/webp" && hasAsciiAt(bytes, 0, "RIFF") && hasAsciiAt(bytes, 8, "WEBP"));
  if (!valid) throw new MedicationUploadError("IMAGE_SIGNATURE_INVALID");

  return {
    bytes,
    mimeType,
    extension: mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp",
  };
}
