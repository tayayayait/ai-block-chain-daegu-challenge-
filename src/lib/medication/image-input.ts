const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE_PX = 2048;
const CAMERA_DENIAL_STORAGE_KEY = "onjung.medication.camera-denied-until";

export const CAMERA_DENIAL_TTL_MS = 24 * 60 * 60 * 1_000;

export type MedicationImageErrorCode =
  | "IMAGE_EMPTY"
  | "IMAGE_TYPE_UNSUPPORTED"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_DECODE_FAILED"
  | "IMAGE_DIMENSIONS_INVALID"
  | "IMAGE_PROCESSING_FAILED"
  | "IMAGE_OUTPUT_INVALID";

export class MedicationImageError extends Error {
  constructor(readonly code: MedicationImageErrorCode) {
    super(code);
    this.name = "MedicationImageError";
  }
}

export interface ValidMedicationImage {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface ProcessedMedicationImage {
  readonly blob: Blob;
  readonly mimeType: "image/jpeg";
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

export interface DecodedMedicationImage {
  readonly width: number;
  readonly height: number;
  draw(context: CanvasRenderingContext2D, width: number, height: number): void;
  close(): void;
}

export interface ImageEncodeRequest {
  readonly width: number;
  readonly height: number;
  readonly mimeType: "image/jpeg";
  readonly quality: number;
  readonly render: (context: CanvasRenderingContext2D) => void;
}

export type MedicationImageDependencies = Readonly<{
  decode(file: File): Promise<DecodedMedicationImage>;
  encode(request: ImageEncodeRequest): Promise<Blob>;
}>;

type StoragePort = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
}>;

export function validateMedicationImageFile(file: File): ValidMedicationImage {
  if (!file.type.toLowerCase().startsWith("image/")) {
    throw new MedicationImageError("IMAGE_TYPE_UNSUPPORTED");
  }
  if (file.size <= 0) throw new MedicationImageError("IMAGE_EMPTY");
  if (file.size > MAX_IMAGE_BYTES) throw new MedicationImageError("IMAGE_TOO_LARGE");

  return {
    name: file.name,
    mimeType: file.type.toLowerCase(),
    size: file.size,
  };
}

function scaledDimensions(width: number, height: number): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height)
  ) {
    throw new MedicationImageError("IMAGE_DIMENSIONS_INVALID");
  }

  const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decodeWithImageElement(file: File): Promise<DecodedMedicationImage> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.style.imageOrientation = "from-image";
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = objectUrl;
    });
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new MedicationImageError("IMAGE_DECODE_FAILED");
  }

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
    close: () => URL.revokeObjectURL(objectUrl),
  };
}

async function defaultDecode(file: File): Promise<DecodedMedicationImage> {
  if (typeof createImageBitmap !== "function") return decodeWithImageElement(file);

  let bitmap: ImageBitmap;
  try {
    // Modern browsers apply EXIF orientation before exposing bitmap dimensions.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new MedicationImageError("IMAGE_DECODE_FAILED");
  }
  return {
    width: bitmap.width,
    height: bitmap.height,
    draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
    close: () => bitmap.close(),
  };
}

async function defaultEncode(request: ImageEncodeRequest): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = request.width;
  canvas.height = request.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new MedicationImageError("IMAGE_PROCESSING_FAILED");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, request.width, request.height);
  request.render(context);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new MedicationImageError("IMAGE_PROCESSING_FAILED")),
      request.mimeType,
      request.quality,
    );
  });
}

export async function preprocessMedicationImage(
  file: File,
  dependencies: MedicationImageDependencies = { decode: defaultDecode, encode: defaultEncode },
): Promise<ProcessedMedicationImage> {
  validateMedicationImageFile(file);

  let decoded: DecodedMedicationImage;
  try {
    decoded = await dependencies.decode(file);
  } catch (error) {
    if (error instanceof MedicationImageError) throw error;
    throw new MedicationImageError("IMAGE_DECODE_FAILED");
  }

  try {
    const dimensions = scaledDimensions(decoded.width, decoded.height);
    for (const quality of [0.86, 0.72, 0.58] as const) {
      let blob: Blob;
      try {
        blob = await dependencies.encode({
          ...dimensions,
          mimeType: "image/jpeg",
          quality,
          render: (context) => decoded.draw(context, dimensions.width, dimensions.height),
        });
      } catch (error) {
        if (error instanceof MedicationImageError) throw error;
        throw new MedicationImageError("IMAGE_PROCESSING_FAILED");
      }

      if (blob.type !== "image/jpeg" || blob.size <= 0) {
        throw new MedicationImageError("IMAGE_OUTPUT_INVALID");
      }
      if (blob.size <= MAX_IMAGE_BYTES) {
        return {
          blob,
          mimeType: "image/jpeg",
          size: blob.size,
          ...dimensions,
        };
      }
    }

    throw new MedicationImageError("IMAGE_TOO_LARGE");
  } finally {
    decoded.close();
  }
}

export function cameraPromptAllowed(storage: StoragePort, now = Date.now()): boolean {
  try {
    const deniedUntil = Number(storage.getItem(CAMERA_DENIAL_STORAGE_KEY));
    return !Number.isFinite(deniedUntil) || deniedUntil <= now;
  } catch {
    return true;
  }
}

export function rememberCameraDenial(storage: StoragePort, deniedAt = Date.now()): void {
  try {
    storage.setItem(CAMERA_DENIAL_STORAGE_KEY, String(deniedAt + CAMERA_DENIAL_TTL_MS));
  } catch {
    // Album selection and manual input remain available when storage is blocked.
  }
}
