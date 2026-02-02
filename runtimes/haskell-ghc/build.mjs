import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
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

function exec(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...(opts.env ?? {}) },
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${res.status})`);
  }
}

function findFileRecursive(rootDir, filename, maxDepth = 8) {
  if (!rootDir || !fs.existsSync(rootDir) || maxDepth < 0) return null;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name === filename) {
      return path.join(rootDir, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const found = findFileRecursive(
      path.join(rootDir, entry.name),
      filename,
      maxDepth - 1,
    );
    if (found) return found;
  }
  return null;
}

function resolveLibdirFromGhc(exePath) {
  const res = spawnSync(exePath, ["--print-libdir"], {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (res.status !== 0 || !res.stdout) return null;
  const out = res.stdout.trim();
  return out.length > 0 ? out : null;
}

ensureDir(distDir);

const ghcEnv = process.env.GHC_WASM;
const ghciEnv = process.env.GHCI_WASM;
const libdirEnv = process.env.GHC_LIBDIR_TAR;
const ghcSrcEnv = process.env.GHC_WASM_SRC;
const ghcLibdirEnv = process.env.GHC_LIBDIR;
const wasmGhcExe = process.env.WASM_GHC_EXE ?? "wasm32-wasi-ghc";

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

if (ghcSrcEnv && fs.existsSync(ghcSrcEnv)) {
  const ghcFromSrc = findFileRecursive(ghcSrcEnv, "ghc.wasm");
  const ghciFromSrc = findFileRecursive(ghcSrcEnv, "ghci.wasm");
  if (copyIfExists(ghcFromSrc, path.join(distDir, "ghc.wasm"))) {
    found = true;
  }
  if (copyIfExists(ghciFromSrc, path.join(distDir, "ghci.wasm"))) {
    found = true;
  }
}

const libdirTarPath = path.join(distDir, "libdir.tar");
if (!fs.existsSync(libdirTarPath)) {
  const libdirPath = ghcLibdirEnv ?? resolveLibdirFromGhc(wasmGhcExe);
  if (libdirPath && fs.existsSync(libdirPath)) {
    try {
      exec("tar", ["-cf", libdirTarPath, "-C", libdirPath, "."]);
    } catch (err) {
      console.warn("Warning: failed to create libdir.tar:", err.message);
    }
  }
}

const libdirCandidates = [libdirEnv, path.join(distDir, "libdir.tar")].filter(
  Boolean,
);

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
