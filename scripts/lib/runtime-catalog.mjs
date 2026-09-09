const MAX_SOURCE_BYTES = 262_144;
const MAX_CASE_COUNT = 100;
const MAX_OUTPUT_BYTES = 65_536;
const JAVASCRIPT_WORKER_ASSET = "js-worker.js";

function file(url) {
  return Object.freeze({ type: "file", urls: Object.freeze([url]) });
}

function oneOf(...urls) {
  return Object.freeze({ type: "one-of", urls: Object.freeze(urls) });
}

function conditionalOneOf(condition, ...urls) {
  return Object.freeze({ type: "one-of", condition, urls: Object.freeze(urls) });
}

function runtime(runtimeId, languageId, required, workerUrl, assetGroups, reuse, options = {}) {
  return Object.freeze({
    runtimeId,
    languageId,
    required,
    runtimeVersion: "artifact-derived",
    worker: Object.freeze({ url: workerUrl, type: options.workerType ?? "classic" }),
    assetGroups: Object.freeze(assetGroups),
    reuse,
    ...(options.unavailableReason === undefined ? {} : { unavailableReason: options.unavailableReason }),
    capabilityIntent: Object.freeze({ execute: true, judge: true }),
    timeouts: Object.freeze({
      initializeMs: options.initializeMs ?? 10_000,
      executeMs: options.executeMs ?? 30_000,
    }),
    limits: Object.freeze({
      sourceBytes: MAX_SOURCE_BYTES,
      caseCount: MAX_CASE_COUNT,
      outputBytes: MAX_OUTPUT_BYTES,
    }),
  });
}

export const runtimeCatalog = Object.freeze([
  runtime("javascript-worker", "javascript", true, JAVASCRIPT_WORKER_ASSET, [
    file(JAVASCRIPT_WORKER_ASSET),
  ], "per-submission"),
  runtime("typescript-official", "typescript", true, JAVASCRIPT_WORKER_ASSET, [
    file(JAVASCRIPT_WORKER_ASSET),
    file("typescript/typescript.js"),
  ], "per-submission"),
  runtime("python-pyodide", "python", true, "python-worker.js", [
    file("python-worker.js"),
    file("pyodide/pyodide.js"),
    file("pyodide/pyodide.asm.js"),
    file("pyodide/pyodide.asm.wasm"),
    file("pyodide/python_stdlib.zip"),
    file("pyodide/pyodide-lock.json"),
  ], "session", { initializeMs: 90_000 }),
  runtime("python-rustpython", "python", false, "rustpython-worker.js", [
    file("rustpython-worker.js"),
    oneOf("rustpython/runner.wasm.gz.bin", "rustpython/runner.wasm"),
  ], "session", { initializeMs: 90_000 }),
  runtime("racket-wasm", "racket", false, "racket-worker.js", [
    file("racket-worker.js"),
    file("racket/racket.js"),
    oneOf("racket/racket.wasm.gz", "racket/racket.wasm"),
  ], "session", { initializeMs: 90_000 }),
  runtime("haskell-ghc-wasi", "haskell", false, "haskell-worker.js", [
    file("haskell-worker.js"),
    oneOf("haskell/ghc.wasm.gz.bin", "haskell/ghc.wasm"),
    oneOf("haskell/libdir.tar.gz.bin", "haskell/libdir.tar"),
    file("haskell/wasi-shim.js"),
    file("haskell/runner.meta.json"),
    conditionalOneOf("haskell-ghci", "haskell/ghci.wasm.gz.bin", "haskell/ghci.wasm"),
  ], "session", {
    workerType: "module",
    initializeMs: 120_000,
    executeMs: 120_000,
    unavailableReason: "Haskell runtime is temporarily unavailable: browser ghc -e evaluation is blocked by incompatible compiler runtime ways.",
  }),
]);
