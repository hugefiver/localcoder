import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function existsAny(relPaths) {
  return relPaths.some((relPath) => exists(relPath));
}

const hasGhc = existsAny([
  "public/haskell/ghc.wasm",
  "public/haskell/ghc.wasm.gz",
]);
const hasGhci = existsAny([
  "public/haskell/ghci.wasm",
  "public/haskell/ghci.wasm.gz",
]);
const hasLibdir = existsAny([
  "public/haskell/libdir.tar",
  "public/haskell/libdir.tar.gz",
]);
const haskellAvailable = (hasGhc || hasGhci) && hasLibdir;

const racketAvailable =
  exists("public/racket/racket.js") &&
  existsAny(["public/racket/racket.wasm", "public/racket/racket.wasm.gz"]);

const rustpythonAvailable = existsAny([
  "public/rustpython/runner.wasm",
  "public/rustpython/runner.wasm.gz",
]);

const pythonAvailable =
  exists("public/pyodide/pyodide.js") || exists("public/pyodide");

const manifest = {
  haskell: {
    source: "official",
    format: "wasi",
    shim: "bjorn3",
    available: haskellAvailable,
    assets: {
      ghc: "haskell/ghc.wasm(.gz)",
      ghci: "haskell/ghci.wasm(.gz)",
      libdir: "haskell/libdir.tar(.gz)",
      wasiShim: "haskell/wasi-shim.js",
      meta: "haskell/runner.meta.json",
    },
  },
  rustpython: {
    source: "custom",
    format: "wasi",
    shim: "minimal",
    available: rustpythonAvailable,
    assets: {
      wasm: "rustpython/runner.wasm(.gz)",
    },
  },
  racket: {
    source: "custom",
    format: "emscripten",
    available: racketAvailable,
    assets: {
      js: "racket/racket.js",
      wasm: "racket/racket.wasm",
    },
  },
  python: {
    source: "official",
    format: "pyodide",
    available: pythonAvailable,
    assets: {
      base: "pyodide/",
    },
  },
};

fs.mkdirSync(path.join(root, "public"), { recursive: true });
fs.writeFileSync(
  path.join(root, "public", "runtime-manifest.json"),
  JSON.stringify(manifest, null, 2),
);

console.log("Generated public/runtime-manifest.json");
console.log(`  Haskell: ${haskellAvailable ? "✓ available" : "✗ missing"}`);
console.log(`  Racket: ${racketAvailable ? "✓ available" : "✗ missing"}`);
console.log(
  `  RustPython: ${rustpythonAvailable ? "✓ available" : "✗ missing"}`,
);
console.log(
  `  Python (Pyodide): ${pythonAvailable ? "✓ available" : "✗ missing"}`,
);
