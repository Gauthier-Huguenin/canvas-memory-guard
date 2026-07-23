import { describe, expect, it } from "vitest";
import {
  CONSERVATIVE_LIMITS,
  largestSafeScale,
  preflightCanvas,
  type CanvasLimits,
} from "./index.js";

const generous: CanvasLimits = {
  maxEdge: 100_000,
  maxPixels: 1_000_000_000,
  maxRgbaBytes: 8_000_000_000,
  maxWorkingSetBytes: 8_000_000_000,
};

function limits(overrides: Partial<CanvasLimits>): CanvasLimits {
  return { ...generous, ...overrides };
}

describe("preflightCanvas", () => {
  it("computes scaled output and the default two-copy working set", () => {
    const result = preflightCanvas(
      { width: 800, height: 600, scale: 2, sources: [{ width: 400, height: 300 }] },
      generous,
    );
    expect(result).toEqual({
      ok: true,
      metrics: {
        width: 1600,
        height: 1200,
        pixels: 1_920_000,
        outputBytes: 7_680_000,
        sourceBytes: 480_000,
        workingSetBytes: 15_840_000,
      },
    });
  });

  it("defaults scale to one, RGBA to four bytes, and output copies to two", () => {
    const result = preflightCanvas({ width: 10, height: 20 }, generous);
    expect(result.ok && result.metrics).toMatchObject({
      width: 10,
      height: 20,
      outputBytes: 800,
      workingSetBytes: 1600,
    });
  });

  it("supports explicit pixel size and output-copy counts", () => {
    const result = preflightCanvas(
      { width: 10, height: 20, bytesPerPixel: 8, outputCopies: 3 },
      generous,
    );
    expect(result.ok && result.metrics.outputBytes).toBe(1600);
    expect(result.ok && result.metrics.workingSetBytes).toBe(4800);
  });

  it("rounds scaled edges with Math.round semantics", () => {
    const result = preflightCanvas({ width: 3, height: 5, scale: 1.5 }, generous);
    expect(result.ok && result.metrics).toMatchObject({ width: 5, height: 8, pixels: 40 });
  });

  it.each([
    ["zero width", { width: 0, height: 1 }],
    ["negative height", { width: 1, height: -1 }],
    ["fractional width", { width: 1.2, height: 1 }],
    ["NaN", { width: Number.NaN, height: 1 }],
    ["infinity", { width: 1, height: Number.POSITIVE_INFINITY }],
    ["unsafe integer", { width: Number.MAX_SAFE_INTEGER + 1, height: 1 }],
  ])("rejects %s", (_name, request) => {
    expect(preflightCanvas(request, generous)).toEqual({
      ok: false,
      reason: "invalid-request",
      metrics: null,
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects scale %s", (scale) => {
    expect(preflightCanvas({ width: 1, height: 1, scale }, generous)).toMatchObject({
      ok: false,
      reason: "invalid-request",
    });
  });

  it("rejects a scale that overflows a derived edge", () => {
    expect(
      preflightCanvas({ width: Number.MAX_SAFE_INTEGER, height: 1, scale: 2 }, generous),
    ).toMatchObject({ ok: false, reason: "invalid-request" });
  });

  it("rejects invalid source dimensions before multiplying", () => {
    expect(
      preflightCanvas({ width: 1, height: 1, sources: [{ width: 0, height: 2 }] }, generous),
    ).toMatchObject({ ok: false, reason: "invalid-request", metrics: null });
  });

  it("rejects invalid limits instead of silently disabling a ceiling", () => {
    expect(
      preflightCanvas({ width: 1, height: 1 }, { ...generous, maxEdge: Number.NaN }),
    ).toEqual({ ok: false, reason: "invalid-limits", metrics: null });
  });

  it("fails closed for malformed untyped JavaScript calls", () => {
    expect(preflightCanvas(null as unknown as Parameters<typeof preflightCanvas>[0], generous)).toEqual({
      ok: false,
      reason: "invalid-request",
      metrics: null,
    });
    expect(preflightCanvas({ width: 1, height: 1 }, null as unknown as CanvasLimits)).toEqual({
      ok: false,
      reason: "invalid-limits",
      metrics: null,
    });
    expect(
      preflightCanvas(
        { width: 1, height: 1, sources: {} as unknown as readonly [] },
        generous,
      ),
    ).toEqual({ ok: false, reason: "invalid-request", metrics: null });
  });

  it("rejects cumulative source-byte overflow", () => {
    const huge = { width: Number.MAX_SAFE_INTEGER, height: 1 };
    expect(
      preflightCanvas(
        { width: 1, height: 1, bytesPerPixel: 1, outputCopies: 1, sources: [huge, huge] },
        {
          maxEdge: Number.MAX_SAFE_INTEGER,
          maxPixels: Number.MAX_SAFE_INTEGER,
          maxRgbaBytes: Number.MAX_SAFE_INTEGER,
          maxWorkingSetBytes: Number.MAX_SAFE_INTEGER,
        },
      ),
    ).toEqual({ ok: false, reason: "invalid-request", metrics: null });
  });

  it("accepts the edge boundary and rejects one pixel over", () => {
    const cap = limits({ maxEdge: 4096 });
    expect(preflightCanvas({ width: 4096, height: 1 }, cap).ok).toBe(true);
    expect(preflightCanvas({ width: 4097, height: 1 }, cap)).toMatchObject({
      ok: false,
      reason: "edge",
    });
  });

  it("accepts the pixel boundary and rejects one pixel over", () => {
    const cap = limits({ maxPixels: 100 });
    expect(preflightCanvas({ width: 10, height: 10 }, cap).ok).toBe(true);
    expect(preflightCanvas({ width: 101, height: 1 }, cap)).toMatchObject({
      ok: false,
      reason: "pixels",
    });
  });

  it("enforces the output byte cap independently", () => {
    const cap = limits({ maxRgbaBytes: 400 });
    expect(preflightCanvas({ width: 10, height: 10 }, cap).ok).toBe(true);
    expect(preflightCanvas({ width: 101, height: 1 }, cap)).toMatchObject({
      ok: false,
      reason: "output-bytes",
    });
  });

  it("reports sources that exhaust the working-set budget by themselves", () => {
    const cap = limits({ maxWorkingSetBytes: 400 });
    expect(
      preflightCanvas({ width: 1, height: 1, sources: [{ width: 11, height: 10 }] }, cap),
    ).toMatchObject({ ok: false, reason: "source-bytes" });
  });

  it("accepts an exact working-set boundary and rejects the next pixel", () => {
    const cap = limits({ maxWorkingSetBytes: 800 });
    expect(preflightCanvas({ width: 10, height: 10 }, cap).ok).toBe(true);
    expect(preflightCanvas({ width: 101, height: 1 }, cap)).toMatchObject({
      ok: false,
      reason: "working-set",
    });
  });

  it("checks edge before other exceeded output ceilings", () => {
    const cap: CanvasLimits = {
      maxEdge: 1,
      maxPixels: 1,
      maxRgbaBytes: 1,
      maxWorkingSetBytes: 1,
    };
    expect(preflightCanvas({ width: 2, height: 2 }, cap)).toMatchObject({
      ok: false,
      reason: "edge",
    });
  });

  it("keeps common conservative exports usable", () => {
    expect(preflightCanvas({ width: 1600, height: 1000, scale: 2 }, CONSERVATIVE_LIMITS).ok).toBe(
      true,
    );
  });
});

describe("largestSafeScale", () => {
  it("returns the numerically largest passing candidate without mutating input", () => {
    const candidates = [1, 4, 2] as const;
    const cap = limits({ maxEdge: 2500 });
    expect(largestSafeScale({ width: 1000, height: 500 }, candidates, cap)).toBe(2);
    expect(candidates).toEqual([1, 4, 2]);
  });

  it("returns null when none fit", () => {
    expect(largestSafeScale({ width: 100, height: 100 }, [1, 2], limits({ maxEdge: 10 }))).toBeNull();
  });

  it("treats invalid candidates as unsafe", () => {
    expect(largestSafeScale({ width: 10, height: 10 }, [Number.NaN, -1, 1], generous)).toBe(1);
  });
});
