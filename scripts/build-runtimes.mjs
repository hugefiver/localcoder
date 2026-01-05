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

function cargoBuild(crateDir) {
  // Prefer the new target name; fallback to wasm32-wasi.
  const targets = ["wasm32-wasip1", "wasm32-wasi"];
  for (const target of targets) {
    try {
      exec("cargo", ["build", "--release", "--target", target], { cwd: crateDir });
      return target;
    } catch (e) {
      // try next
    }
  }
  throw new Error(
    "Failed to build runtimes. Ensure Rust toolchain is installed and wasm32-wasip1 (or wasm32-wasi) target is available.",
  );
}

function main() {
  const rustpythonDir = path.join(root, "runtimes", "rustpython-runner");
  const haskellStubDir = path.join(root, "runtimes", "haskell-runner-stub");

  console.log("Building RustPython runtime...");
  const rustTarget = cargoBuild(rustpythonDir);
  const rustWasm = findWasmArtifact(rustpythonDir, rustTarget);
  copyFile(rustWasm, path.join(root, "public", "rustpython", "runner.wasm"));

  console.log("Building Haskell stub runtime...");
  const hsTarget = cargoBuild(haskellStubDir);
  const hsWasm = findWasmArtifact(haskellStubDir, hsTarget);
  copyFile(hsWasm, path.join(root, "public", "haskell", "runner.wasm"));

  console.log("Runtime build complete:");
  console.log("  ✓ public/rustpython/runner.wasm");
  console.log("  ✓ public/haskell/runner.wasm");
}

main();
