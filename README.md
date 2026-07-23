# canvas-memory-guard

[![CI](https://github.com/Gauthier-Huguenin/canvas-memory-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/Gauthier-Huguenin/canvas-memory-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Dependency-free, DOM-free preflight checks for browser canvas dimensions and
estimated media memory.

A `try/catch` around `canvas.width`, `drawImage()`, or `toBlob()` is not a memory
safety boundary. The browser can freeze or terminate the renderer before
JavaScript receives an exception. This package lets an application reject unsafe
work **before the first large canvas allocation**.

## Features

- validates dimensions, scales, limits, and arithmetic overflow;
- caps output edges, pixels, and RGBA bytes independently;
- includes retained decoded images in the memory estimate;
- accounts for multiple simultaneous output-sized buffers;
- returns structured rejection reasons and the largest safe candidate scale;
- works during SSR and in browsers because the core has no DOM access;
- zero runtime dependencies.

## Install

The package is not published to npm yet. Install the tagged source from GitHub:

```sh
npm install github:Gauthier-Huguenin/canvas-memory-guard#v0.1.1
```

Once an npm release is available, the command will be `npm install canvas-memory-guard`.

## Usage

```ts
import {
  CONSERVATIVE_LIMITS,
  largestSafeScale,
  preflightCanvas,
} from "canvas-memory-guard";

const request = {
  width: 1600,
  height: 1000,
  scale: 2,
  // Decoded images still retained while rendering:
  sources: [
    { width: 2560, height: 1440 },
    { width: 1920, height: 1080 },
  ],
};

const check = preflightCanvas(request, CONSERVATIVE_LIMITS);

if (!check.ok) {
  console.warn("Canvas rejected before allocation:", check.reason, check.metrics);
} else {
  const canvas = document.createElement("canvas");
  canvas.width = check.metrics.width;
  canvas.height = check.metrics.height;
  // draw and encode only after preflight succeeds
}

const fallback = largestSafeScale(
  { width: 1600, height: 1000, sources: request.sources },
  [1, 2, 4],
  CONSERVATIVE_LIMITS,
);
```

## Memory model

By default, the estimated tracked working set is:

```text
sourceBytes     = sum(source.width × source.height × 4)
outputBytes     = output.width × output.height × 4
workingSetBytes = sourceBytes + outputBytes × 2
```

The two output copies represent the canvas backing store and one encoder-sized
copy. Set `outputCopies` and `bytesPerPixel` if your pipeline has a different
model.

Every limit is independent:

```ts
const limits = {
  maxEdge: 4096,
  maxPixels: 16_000_000,
  maxRgbaBytes: 64 * 1024 * 1024,
  maxWorkingSetBytes: 128 * 1024 * 1024,
};
```

`CONSERVATIVE_LIMITS` contains those values as an example policy for unknown or
memory-constrained environments. They are deliberately not presented as
universal browser limits. Measure supported devices, account for your complete
pipeline, and leave headroom for the browser, JavaScript heap, GPU/compositor,
and compressed buffers.

## Rejection reasons

| Reason | Meaning |
| --- | --- |
| `invalid-request` | Invalid dimensions/options or unsafe arithmetic |
| `invalid-limits` | A configured ceiling is invalid |
| `edge` | Output width or height exceeds `maxEdge` |
| `pixels` | Output area exceeds `maxPixels` |
| `output-bytes` | One output pixel buffer exceeds `maxRgbaBytes` |
| `source-bytes` | Retained decoded sources alone exceed the working-set budget |
| `working-set` | Sources plus output-sized buffers exceed the budget |

## What this does not do

- It cannot guarantee that an accepted allocation will succeed. Browser memory
  behavior is platform- and workload-dependent.
- It does not protect image decoding. Validate compressed byte size and parse
  trustworthy dimensions before passing untrusted media to `createImageBitmap`
  or an `<img>` element.
- It does not allocate, draw, encode, detect devices, or choose product policy.
- It only estimates memory represented by the dimensions and copy count you give
  it; untracked GPU or codec allocations remain your responsibility.

## Development

Requires Node.js 20 or newer.

```sh
npm ci
npm run check
npm pack --dry-run
```

## License

[MIT](LICENSE) © 2026 Gauthier Huguenin
