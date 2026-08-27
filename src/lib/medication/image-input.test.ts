import { describe, expect, it, vi } from "vitest";

import {
  CAMERA_DENIAL_TTL_MS,
  MedicationImageError,
  cameraPromptAllowed,
  preprocessMedicationImage,
  rememberCameraDenial,
  validateMedicationImageFile,
} from "./image-input";

function imageFile(type = "image/jpeg", size = 128): File {
  return new File([new Uint8Array(size)], "medicine.jpg", { type });
}

describe("medication image validation", () => {
  it("accepts images up to 10 MiB and rejects other MIME types or oversized files", () => {
    expect(validateMedicationImageFile(imageFile())).toEqual({
      name: "medicine.jpg",
      mimeType: "image/jpeg",
      size: 128,
    });
    expect(() => validateMedicationImageFile(imageFile("application/pdf"))).toThrowError(
      new MedicationImageError("IMAGE_TYPE_UNSUPPORTED"),
    );
    expect(() =>
      validateMedicationImageFile(imageFile("image/png", 10 * 1024 * 1024 + 1)),
    ).toThrowError(new MedicationImageError("IMAGE_TOO_LARGE"));
  });

  it("honors EXIF-oriented decoder dimensions and limits the long edge to 2048px", async () => {
    const close = vi.fn();
    const draw = vi.fn();
    const encode = vi.fn(
      async ({ render }: { render: (context: CanvasRenderingContext2D) => void }) => {
        render({} as CanvasRenderingContext2D);
        return new Blob([new Uint8Array(512)], { type: "image/jpeg" });
      },
    );

    const result = await preprocessMedicationImage(imageFile(), {
      decode: vi.fn(async () => ({ width: 4000, height: 2000, draw, close })),
      encode,
    });

    expect(result).toMatchObject({
      mimeType: "image/jpeg",
      width: 2048,
      height: 1024,
      size: 512,
    });
    expect(draw).toHaveBeenCalledWith(expect.anything(), 2048, 1024);
    expect(encode).toHaveBeenCalledWith(
      expect.objectContaining({ width: 2048, height: 1024, mimeType: "image/jpeg" }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("retries compression and rejects an invalid final blob contract", async () => {
    const tooLarge = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/jpeg" });
    const valid = new Blob([new Uint8Array(1024)], { type: "image/jpeg" });
    const encode = vi.fn().mockResolvedValueOnce(tooLarge).mockResolvedValueOnce(valid);
    const decode = vi.fn(async () => ({
      width: 1024,
      height: 768,
      draw: vi.fn(),
      close: vi.fn(),
    }));

    await expect(preprocessMedicationImage(imageFile(), { decode, encode })).resolves.toMatchObject(
      {
        size: 1024,
      },
    );
    expect(encode).toHaveBeenCalledTimes(2);

    await expect(
      preprocessMedicationImage(imageFile(), {
        decode,
        encode: vi.fn(async () => new Blob(["not an image"], { type: "text/plain" })),
      }),
    ).rejects.toEqual(new MedicationImageError("IMAGE_OUTPUT_INVALID"));
  });
});

describe("camera permission denial policy", () => {
  it("suppresses camera reprompt for 24 hours while album and manual input remain available", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const deniedAt = Date.parse("2026-08-23T12:00:00+09:00");

    rememberCameraDenial(storage, deniedAt);
    expect(cameraPromptAllowed(storage, deniedAt + CAMERA_DENIAL_TTL_MS - 1)).toBe(false);
    expect(cameraPromptAllowed(storage, deniedAt + CAMERA_DENIAL_TTL_MS)).toBe(true);
  });

  it("fails open when browser storage is unavailable or corrupt", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const corrupt = { getItem: () => "not-a-timestamp", setItem: vi.fn() };

    expect(cameraPromptAllowed(blocked, 1)).toBe(true);
    expect(cameraPromptAllowed(corrupt, 1)).toBe(true);
    expect(() => rememberCameraDenial(blocked, 1)).not.toThrow();
  });
});
