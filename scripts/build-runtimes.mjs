import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { buildSync } from "esbuild";

const root = path.resolve(new URL("..", import.meta.url).pathname);

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

async function gzipFile(src, dest) {
  ensureDir(path.dirname(dest));
  await pipeline(fs.createReadStream(src), createGzip({ level: 9 }), fs.createWriteStream(dest));
}

async function gzipIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  await gzipFile(src, dest);
  return true;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function findWasmArtifact(crateDir, target) {
  const candidate = path.join(crateDir, "target", target, "release", `${path.basename(crateDir)}.wasm`);
  if (fs.existsSync(candidate)) return candidate;

  // crate name != folder name: try reading Cargo.toml name quickly.
  const cargoToml = fs.readFileSync(path.join(crateDir, "Cargo.toml"), "utf8");
  const m = cargoToml.match(/^name\s*=\s*"([^"]+)"/m);
  if (m) {
    const byName = path.join(crateDir, "target", target, "release", `${m[1].replace(/-/g, "_")}.wasm`);
    if (fs.existsSync(byName)) return byName;
  }

  // fallback: scan release dir
  const relDir = path.join(crateDir, "target", target, "release");
  if (fs.existsSync(relDir)) {
    const files = fs.readdirSync(relDir).filter((f) => f.endsWith(".wasm"));
    if (files.length === 1) return path.join(relDir, files[0]);
  }

  throw new Error(`Cannot find wasm artifact under ${crateDir}/target/${target}/release`);
}

function cargoBuild(crateDir, { throwOnFail = true } = {}) {
  // Prefer the new target name; fallback to wasm32-wasi.
  const targets = ["wasm32-wasip1", "wasm32-wasi"];
  for (const target of targets) {
    try {
      exec("cargo", ["build", "--release", "--target", target], { cwd: crateDir });
      return target;
    } catch {
      // try next
    }
  }
  if (throwOnFail) {
    throw new Error(
      "Failed to build runtime. Ensure Rust toolchain is installed and wasm32-wasip1 (or wasm32-wasi) target is available.",
    );
  }
  return null;
}

function buildHaskellGhciRunner(haskellDir) {
  const buildScript = path.join(haskellDir, "build.mjs");
  if (fs.existsSync(buildScript)) {
    exec("node", [buildScript], { cwd: haskellDir });
  }

  const distDir = path.join(haskellDir, "dist");
  const ghcWasm = path.join(distDir, "ghc.wasm");
  const ghciWasm = path.join(distDir, "ghci.wasm");
  const libdirTar = path.join(distDir, "libdir.tar");
  const metaPath = path.join(haskellDir, "runner.meta.json");

  return {
    ghcWasm: fs.existsSync(ghcWasm) ? ghcWasm : null,
    ghciWasm: fs.existsSync(ghciWasm) ? ghciWasm : null,
    libdirTar: fs.existsSync(libdirTar) ? libdirTar : null,
    metaPath: fs.existsSync(metaPath) ? metaPath : null,
  };
}

function buildWasiShim(outPath) {
  ensureDir(path.dirname(outPath));
  buildSync({
    entryPoints: ["@bjorn3/browser_wasi_shim"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    outfile: outPath,
  });
}

function buildRacketRuntime(racketDir) {
  const distDir = path.join(racketDir, "dist");
  const jsPath = path.join(distDir, "racket.js");
  const wasmPath = path.join(distDir, "racket.wasm");
  if (fs.existsSync(jsPath) && fs.existsSync(wasmPath)) {
    return { jsPath, wasmPath };
  }

  const buildScript = path.join(racketDir, "build.mjs");
  if (fs.existsSync(buildScript)) {
    exec("node", [buildScript], { cwd: racketDir });
  }
  if (!fs.existsSync(jsPath) || !fs.existsSync(wasmPath)) {
    throw new Error("Cannot find Racket runtime artifacts (dist/racket.js, dist/racket.wasm)");
  }

  return { jsPath, wasmPath };
}

async function main() {
  const rustpythonDir = path.join(root, "runtimes", "rustpython-runner");
  const haskellGhciDir = path.join(root, "runtimes", "haskell-ghc");
  const racketDir = path.join(root, "runtimes", "racket-runtime");

  let rustpythonBuilt = false;
  let haskellBuilt = false;
  let racketBuilt = false;

  console.log("Building Haskell runtime (GHC/GHCi WASM)...");
  try {
    const hsArtifacts = buildHaskellGhciRunner(haskellGhciDir);
    const publicHaskellDir = path.join(root, "public", "haskell");
    if (hsArtifacts.ghcWasm) {
      copyFile(hsArtifacts.ghcWasm, path.join(publicHaskellDir, "ghc.wasm"));
    }
    if (hsArtifacts.ghciWasm) {
      copyFile(hsArtifacts.ghciWasm, path.join(publicHaskellDir, "ghci.wasm"));
    }
    if (hsArtifacts.libdirTar) {
      copyFile(hsArtifacts.libdirTar, path.join(publicHaskellDir, "libdir.tar"));
    } else if (hsArtifacts.ghcWasm || hsArtifacts.ghciWasm) {
      throw new Error("Missing libdir.tar in runtimes/haskell-ghc/dist (required for GHC/GHCi)");
    }
    if (hsArtifacts.metaPath) {
      const meta = JSON.parse(fs.readFileSync(hsArtifacts.metaPath, "utf8"));
      const metaOut = { ...meta };
      const ghcGz = path.join(publicHaskellDir, "ghc.wasm.gz");
      const ghciGz = path.join(publicHaskellDir, "ghci.wasm.gz");
      const libdirGz = path.join(publicHaskellDir, "libdir.tar.gz");

      if (await gzipIfExists(path.join(publicHaskellDir, "ghc.wasm"), ghcGz)) {
        metaOut.ghcWasm = "haskell/ghc.wasm.gz";
      }
      if (await gzipIfExists(path.join(publicHaskellDir, "ghci.wasm"), ghciGz)) {
        metaOut.ghciWasm = "haskell/ghci.wasm.gz";
      }
      if (await gzipIfExists(path.join(publicHaskellDir, "libdir.tar"), libdirGz)) {
        metaOut.libdirTar = "haskell/libdir.tar.gz";
      }

      fs.writeFileSync(
        path.join(publicHaskellDir, "runner.meta.json"),
        JSON.stringify(metaOut, null, 2),
      );
    }
    haskellBuilt = Boolean(hsArtifacts.ghcWasm || hsArtifacts.ghciWasm);
    if (haskellBuilt) {
      const wasiShimPath = path.join(root, "public", "haskell", "wasi-shim.js");
      buildWasiShim(wasiShimPath);
      if (hsArtifacts.ghcWasm) console.log("  ✓ public/haskell/ghc.wasm(.gz)");
      if (hsArtifacts.ghciWasm) console.log("  ✓ public/haskell/ghci.wasm(.gz)");
      if (hsArtifacts.libdirTar) console.log("  ✓ public/haskell/libdir.tar(.gz)");
      console.log("  ✓ public/haskell/wasi-shim.js");
    }
  } catch (err) {
    const strict = process.env.HASKELL_WASM_STRICT === "1";
    console.error("  ✗ Failed to build GHC/GHCi runtime:", err.message);
    if (strict) throw err;
    console.log("  ℹ Haskell runtime missing; worker will fail until artifacts are available.");
  }

  // Build Racket runtime (official interpreter via Emscripten)
  console.log("Building Racket runtime...");
  try {
    const { jsPath, wasmPath } = buildRacketRuntime(racketDir);
    copyFile(jsPath, path.join(root, "public", "racket", "racket.js"));
    copyFile(wasmPath, path.join(root, "public", "racket", "racket.wasm"));
    await gzipIfExists(
      path.join(root, "public", "racket", "racket.wasm"),
      path.join(root, "public", "racket", "racket.wasm.gz"),
    );
    racketBuilt = true;
    console.log("  ✓ public/racket/racket.js");
    console.log("  ✓ public/racket/racket.wasm(.gz)");
  } catch (err) {
    const strict = process.env.RACKET_WASM_STRICT === "1";
    console.error("  ✗ Failed to build Racket runtime:", err.message);
    if (strict) throw err;
    console.log("  ℹ Racket runtime missing; worker will fail until artifacts are available.");
  }

  // Build RustPython runtime (complex, may fail on some platforms)
  console.log("Building RustPython runtime...");
  console.log("  ℹ Note: RustPython WASI compilation is experimental and may fail.");
  try {
    const rustTarget = cargoBuild(rustpythonDir, { throwOnFail: false });
    if (rustTarget) {
      const rustWasm = findWasmArtifact(rustpythonDir, rustTarget);
      copyFile(rustWasm, path.join(root, "public", "rustpython", "runner.wasm"));
      await gzipIfExists(
        path.join(root, "public", "rustpython", "runner.wasm"),
        path.join(root, "public", "rustpython", "runner.wasm.gz"),
      );
      rustpythonBuilt = true;
      console.log("  ✓ public/rustpython/runner.wasm(.gz)");
    } else {
      throw new Error("cargo build failed for all targets");
    }
  } catch (err) {
    console.error("  ✗ Failed to build RustPython:", err.message);
    console.log("  ℹ RustPython WASI support requires a compatible version of rustpython-vm.");
    console.log("  ℹ The 'rustpython' language will show an error until the runtime is available.");
  }

  const manifest = {
    haskell: {
      source: "official",
      format: "wasi",
      shim: "bjorn3",
      available: haskellBuilt,
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
      available: rustpythonBuilt,
      assets: {
        wasm: "rustpython/runner.wasm(.gz)",
      },
    },
    racket: {
      source: "custom",
      format: "emscripten",
      available: racketBuilt,
      assets: {
        js: "racket/racket.js",
        wasm: "racket/racket.wasm",
      },
    },
    python: {
      source: "official",
      format: "pyodide",
      available: fs.existsSync(path.join(root, "public", "pyodide")),
      assets: {
        base: "pyodide/",
      },
    },
  };

  const pyodideAvailable = fs.existsSync(path.join(root, "public", "pyodide"));

  ensureDir(path.join(root, "public"));
  fs.writeFileSync(path.join(root, "public", "runtime-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log("\nRuntime build summary:");
  console.log(`  Python (Pyodide): ${pyodideAvailable ? "✓ available" : "✗ not available"}`);
  console.log(`  Haskell runtime: ${haskellBuilt ? "✓ built" : "✗ not built"}`);
  console.log(`  Racket runtime:  ${racketBuilt ? "✓ built" : "✗ not built"}`);
  console.log(`  RustPython:   ${rustpythonBuilt ? "✓ built" : "✗ not built"}`);

  if (!pyodideAvailable && !haskellBuilt && !rustpythonBuilt && !racketBuilt) {
    console.error("\nNo runtimes were built. Check the errors above.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
