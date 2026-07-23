/** A positive, integer width and height in pixels. */
export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

/** Independent ceilings applied before a canvas allocation. */
export interface CanvasLimits {
  /** Maximum width or height of the output canvas. */
  readonly maxEdge: number;
  /** Maximum number of pixels in the output canvas. */
  readonly maxPixels: number;
  /** Maximum bytes in one output pixel buffer. */
  readonly maxRgbaBytes: number;
  /** Maximum bytes across decoded sources and live output-sized buffers. */
  readonly maxWorkingSetBytes: number;
}

export interface CanvasRequest extends Dimensions {
  /** Multiplier applied to width and height. Defaults to 1. */
  readonly scale?: number;
  /** Decoded images that remain live while the canvas is produced. */
  readonly sources?: readonly Dimensions[];
  /** Bytes per output/source pixel. Defaults to 4 (RGBA). */
  readonly bytesPerPixel?: number;
  /** Number of simultaneous output-sized buffers. Defaults to 2. */
  readonly outputCopies?: number;
}

export type RejectionReason =
  | "invalid-request"
  | "invalid-limits"
  | "edge"
  | "pixels"
  | "output-bytes"
  | "source-bytes"
  | "working-set";

export interface CanvasMetrics {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly outputBytes: number;
  readonly sourceBytes: number;
  readonly workingSetBytes: number;
}

export type PreflightResult =
  | { readonly ok: true; readonly metrics: CanvasMetrics }
  | {
      readonly ok: false;
      readonly reason: RejectionReason;
      /** Available when all arithmetic needed to compute it was safe. */
      readonly metrics: CanvasMetrics | null;
    };

const DEFAULT_BYTES_PER_PIXEL = 4;
const DEFAULT_OUTPUT_COPIES = 2;
const MIB = 1024 * 1024;

/**
 * Conservative example policy for memory-constrained or unknown environments.
 * It is a starting point, not a browser capability claim; calibrate it for your
 * supported devices and media pipeline.
 */
export const CONSERVATIVE_LIMITS: Readonly<CanvasLimits> = Object.freeze({
  maxEdge: 4096,
  maxPixels: 16_000_000,
  maxRgbaBytes: 64 * MIB,
  maxWorkingSetBytes: 128 * MIB,
});

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeProduct(left: number, right: number): number | null {
  const product = left * right;
  return Number.isSafeInteger(product) && product >= 0 ? product : null;
}

function safeSum(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum) && sum >= 0 ? sum : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validDimensions(value: unknown): value is Dimensions {
  return (
    isRecord(value) &&
    isPositiveSafeInteger(value.width as number) &&
    isPositiveSafeInteger(value.height as number)
  );
}

function validLimits(limits: unknown): limits is CanvasLimits {
  return (
    isRecord(limits) &&
    isPositiveSafeInteger(limits.maxEdge as number) &&
    isPositiveSafeInteger(limits.maxPixels as number) &&
    isPositiveSafeInteger(limits.maxRgbaBytes as number) &&
    isPositiveSafeInteger(limits.maxWorkingSetBytes as number)
  );
}

/**
 * Evaluate canvas dimensions and an estimated media working set without touching
 * the DOM. Call this before creating a canvas, assigning its dimensions, drawing,
 * decoding another image, or starting an encoder.
 *
 * The default working-set model tracks the output canvas plus one output-sized
 * encoder copy. Pass `outputCopies` when your pipeline keeps a different number
 * of output-sized RGBA buffers alive.
 */
export function preflightCanvas(request: CanvasRequest, limits: CanvasLimits): PreflightResult {
  if (!validLimits(limits)) return { ok: false, reason: "invalid-limits", metrics: null };
  if (!isRecord(request)) return { ok: false, reason: "invalid-request", metrics: null };

  const scale = request.scale ?? 1;
  const bytesPerPixel = request.bytesPerPixel ?? DEFAULT_BYTES_PER_PIXEL;
  const outputCopies = request.outputCopies ?? DEFAULT_OUTPUT_COPIES;
  const sourceInput: unknown = request.sources ?? [];

  if (
    !validDimensions(request) ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !isPositiveSafeInteger(bytesPerPixel) ||
    !isPositiveSafeInteger(outputCopies) ||
    !Array.isArray(sourceInput) ||
    sourceInput.some((source: unknown) => !validDimensions(source))
  ) {
    return { ok: false, reason: "invalid-request", metrics: null };
  }
  const sources = sourceInput as readonly Dimensions[];

  const scaledWidth = request.width * scale;
  const scaledHeight = request.height * scale;
  if (!Number.isFinite(scaledWidth) || !Number.isFinite(scaledHeight)) {
    return { ok: false, reason: "invalid-request", metrics: null };
  }

  const width = Math.round(scaledWidth);
  const height = Math.round(scaledHeight);
  if (!isPositiveSafeInteger(width) || !isPositiveSafeInteger(height)) {
    return { ok: false, reason: "invalid-request", metrics: null };
  }

  const pixels = safeProduct(width, height);
  const outputBytes = pixels === null ? null : safeProduct(pixels, bytesPerPixel);
  if (pixels === null || outputBytes === null) {
    return { ok: false, reason: "invalid-request", metrics: null };
  }

  let sourceBytes = 0;
  for (const source of sources) {
    const sourcePixels = safeProduct(source.width, source.height);
    const bytes = sourcePixels === null ? null : safeProduct(sourcePixels, bytesPerPixel);
    const total = bytes === null ? null : safeSum(sourceBytes, bytes);
    if (total === null) return { ok: false, reason: "invalid-request", metrics: null };
    sourceBytes = total;
  }

  const allOutputBytes = safeProduct(outputBytes, outputCopies);
  const workingSetBytes = allOutputBytes === null ? null : safeSum(sourceBytes, allOutputBytes);
  if (workingSetBytes === null) {
    return { ok: false, reason: "invalid-request", metrics: null };
  }

  const metrics: CanvasMetrics = {
    width,
    height,
    pixels,
    outputBytes,
    sourceBytes,
    workingSetBytes,
  };

  if (width > limits.maxEdge || height > limits.maxEdge) {
    return { ok: false, reason: "edge", metrics };
  }
  if (pixels > limits.maxPixels) return { ok: false, reason: "pixels", metrics };
  if (outputBytes > limits.maxRgbaBytes) {
    return { ok: false, reason: "output-bytes", metrics };
  }
  if (sourceBytes > limits.maxWorkingSetBytes) {
    return { ok: false, reason: "source-bytes", metrics };
  }
  if (workingSetBytes > limits.maxWorkingSetBytes) {
    return { ok: false, reason: "working-set", metrics };
  }
  return { ok: true, metrics };
}

/**
 * Return the largest candidate scale that passes preflight, or `null`. Invalid
 * candidates are treated as unsafe. The input array is never mutated.
 */
export function largestSafeScale(
  request: Omit<CanvasRequest, "scale">,
  candidateScales: readonly number[],
  limits: CanvasLimits,
): number | null {
  let largest: number | null = null;
  for (const scale of candidateScales) {
    const result = preflightCanvas({ ...request, scale }, limits);
    if (result.ok && (largest === null || scale > largest)) largest = scale;
  }
  return largest;
}
