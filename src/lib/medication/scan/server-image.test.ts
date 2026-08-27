import { describe, expect, it } from "vitest";

import { MedicationUploadError, validateMedicationUpload } from "./server-image.server";

function upload(bytes: number[], type = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], "never-trust-this-name.jpg", { type });
}

describe("server-side medication image validation", () => {
  it("accepts a JPEG by MIME and magic bytes without returning its filename", async () => {
    const result = await validateMedicationUpload(upload([0xff, 0xd8, 0xff, 0xdb, 0x01]));

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.extension).toBe("jpg");
    expect(result.bytes).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x01]));
    expect(result).not.toHaveProperty("name");
  });

  it("rejects MIME spoofing and empty uploads with controlled codes", async () => {
    await expect(validateMedicationUpload(upload([1, 2, 3, 4]))).rejects.toMatchObject({
      code: "IMAGE_SIGNATURE_INVALID",
    });
    await expect(validateMedicationUpload(upload([]))).rejects.toBeInstanceOf(
      MedicationUploadError,
    );
  });
});
