import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname);
const distDir = path.join(root, "dist");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyIfExists(src, dest) {
  if (!src || !fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

ensureDir(distDir);

const ghcEnv = process.env.GHC_WASM;
const ghciEnv = process.env.GHCI_WASM;
const libdirEnv = process.env.GHC_LIBDIR_TAR;

const candidates = [
  ghcEnv,
  ghciEnv,
  path.join(distDir, "ghc.wasm"),
  path.join(distDir, "ghci.wasm"),
].filter(Boolean);

let found = false;
for (const candidate of candidates) {
  if (copyIfExists(candidate, path.join(distDir, path.basename(candidate)))) {
    found = true;
  }
}

const libdirCandidates = [
  libdirEnv,
  path.join(distDir, "libdir.tar"),
].filter(Boolean);

for (const candidate of libdirCandidates) {
  copyIfExists(candidate, path.join(distDir, path.basename(candidate)));
}

if (!found) {
  const strict = process.env.HASKELL_WASM_STRICT === "1";
  const msg =
    "Missing GHC/GHCi WASM artifact. Place ghc.wasm/ghci.wasm into runtimes/haskell-ghc/dist, or set GHC_WASM/GHCI_WASM.";
  if (strict) {
    throw new Error(msg);
  } else {
    console.warn("Warning:", msg);
    process.exit(0);
  }
}
