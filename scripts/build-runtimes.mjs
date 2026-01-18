import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

function main() {
  const rustpythonDir = path.join(root, "runtimes", "rustpython-runner");
  const haskellStubDir = path.join(root, "runtimes", "haskell-runner-stub");

  let rustpythonBuilt = false;
  let haskellBuilt = false;

  // Build Haskell stub runtime first (simpler, more likely to succeed)
  console.log("Building Haskell stub runtime...");
  try {
    const hsTarget = cargoBuild(haskellStubDir);
    const hsWasm = findWasmArtifact(haskellStubDir, hsTarget);
    copyFile(hsWasm, path.join(root, "public", "haskell", "runner.wasm"));
    haskellBuilt = true;
    console.log("  ✓ public/haskell/runner.wasm");
  } catch (err) {
    console.error("  ✗ Failed to build Haskell stub:", err.message);
    console.log("  ℹ The embedded WASI stub in haskell-worker.js will be used instead.");
  }

  // Build RustPython runtime (complex, may fail on some platforms)
  console.log("Building RustPython runtime...");
  console.log("  ℹ Note: RustPython WASI compilation is experimental and may fail.");
  try {
    const rustTarget = cargoBuild(rustpythonDir, { throwOnFail: false });
    if (rustTarget) {
      const rustWasm = findWasmArtifact(rustpythonDir, rustTarget);
      copyFile(rustWasm, path.join(root, "public", "rustpython", "runner.wasm"));
      rustpythonBuilt = true;
      console.log("  ✓ public/rustpython/runner.wasm");
    } else {
      throw new Error("cargo build failed for all targets");
    }
  } catch (err) {
    console.error("  ✗ Failed to build RustPython:", err.message);
    console.log("  ℹ RustPython WASI support requires a compatible version of rustpython-vm.");
    console.log("  ℹ The 'rustpython' language will show an error until the runtime is available.");
  }

  console.log("\nRuntime build summary:");
  console.log(`  Haskell stub: ${haskellBuilt ? "✓ built" : "✗ not built (using embedded stub)"}`);
  console.log(`  RustPython:   ${rustpythonBuilt ? "✓ built" : "✗ not built"}`);

  if (!haskellBuilt && !rustpythonBuilt) {
    console.error("\nNo runtimes were built. Check the errors above.");
    process.exit(1);
  }
}

main();
