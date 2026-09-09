import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildManifest, writeRuntimeManifest } from "../../scripts/generate-runtime-manifest.mjs";
import { checkRuntimeAssets } from "../../scripts/check-runtime-assets.mjs";
import { runtimeCatalog } from "../../scripts/lib/runtime-catalog.mjs";
import { assertRequiredPyodideAssets } from "../../scripts/setup-pyodide.js";

const HASKELL_UNAVAILABLE_REASON = "Haskell runtime is temporarily unavailable: browser ghc -e evaluation is blocked by incompatible compiler runtime ways.";

function writeAsset(root, url, bytes) {
  const filePath = path.join(root, "public", url);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(bytes, "x"));
}

function createRequiredFixture(root) {
  const packagePath = path.join(root, "node_modules", "typescript", "package.json");
  fs.mkdirSync(path.dirname(packagePath), { recursive: true });
  fs.writeFileSync(packagePath, JSON.stringify({ version: "5.9.3-fixture" }));
  writeAsset(root, "js-worker.js", 23);
  writeAsset(root, "typescript/typescript.js", 31);
  writeAsset(root, "python-worker.js", 29);
  writeAsset(root, "pyodide/pyodide.js", 37);
  writeAsset(root, "pyodide/pyodide.asm.js", 39);
  writeAsset(root, "pyodide/pyodide.asm.wasm", 41);
  writeAsset(root, "pyodide/python_stdlib.zip", 43);
  writeAsset(root, "pyodide/pyodide-lock.json", 45);
}

function byId(manifest, runtimeId) {
  const entry = manifest.runtimes.find((runtime) => runtime.runtimeId === runtimeId);
  assert.ok(entry, `missing ${runtimeId}`);
  return entry;
}

test("buildManifest derives availability and byte counts from disposable artifacts", async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-runtime-manifest-"));
  try {
    createRequiredFixture(fixtureRoot);

    const manifest = await buildManifest({ root: fixtureRoot });
    assert.equal(byId(manifest, "javascript-worker").packaged, true);
    assert.equal(byId(manifest, "javascript-worker").assets[0].bytes, 23);
    assert.equal(byId(manifest, "typescript-official").runtimeVersion, "5.9.3-fixture");
    assert.deepEqual(byId(manifest, "python-pyodide").assets, [
      { url: "python-worker.js", bytes: 29 },
      { url: "pyodide/pyodide.js", bytes: 37 },
      { url: "pyodide/pyodide.asm.js", bytes: 39 },
      { url: "pyodide/pyodide.asm.wasm", bytes: 41 },
      { url: "pyodide/python_stdlib.zip", bytes: 43 },
      { url: "pyodide/pyodide-lock.json", bytes: 45 },
    ]);
    for (const runtimeId of ["javascript-worker", "typescript-official", "python-pyodide"]) {
      const required = byId(manifest, runtimeId);
      assert.equal(required.packaged, true);
      assert.deepEqual(required.capabilities, { execute: true, judge: true });
    }
    assert.equal(byId(manifest, "python-rustpython").packaged, false);
    assert.match(byId(manifest, "python-rustpython").unavailableReason, /runner\.wasm/);
    const haskell = byId(manifest, "haskell-ghc-wasi");
    assert.equal(haskell.packaged, false);
    assert.equal(haskell.unavailableReason, HASKELL_UNAVAILABLE_REASON);
    assert.deepEqual(haskell.capabilities, { execute: false, judge: false });

    const haskellDefinition = runtimeCatalog.find(({ runtimeId }) => runtimeId === "haskell-ghc-wasi");
    assert.ok(haskellDefinition);
    assert.ok(Object.isFrozen(haskellDefinition));
    assert.equal(haskellDefinition.unavailableReason, HASKELL_UNAVAILABLE_REASON);

    const report = checkRuntimeAssets({ root: fixtureRoot, manifest, target: "public" });
    assert.equal(report.ready, true);
    assert.equal(byId({ runtimes: report.optional }, "racket-wasm").status, "unavailable");

    const { outputPath } = await writeRuntimeManifest({ root: fixtureRoot });
    assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")), manifest);
    assert.deepEqual(
      fs.readdirSync(path.dirname(outputPath)).filter((name) => name.startsWith(".runtime-manifest-")),
      [],
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("buildManifest declares every present optional fallback variant and readiness checks each byte count", async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-runtime-manifest-"));
  try {
    createRequiredFixture(fixtureRoot);
    writeAsset(fixtureRoot, "racket-worker.js", 47);
    writeAsset(fixtureRoot, "racket/racket.js", 53);
    writeAsset(fixtureRoot, "racket/racket.wasm.gz", 59);
    writeAsset(fixtureRoot, "racket/racket.wasm", 61);
    writeAsset(fixtureRoot, "rustpython-worker.js", 67);
    writeAsset(fixtureRoot, "rustpython/runner.wasm.gz.bin", 71);
    writeAsset(fixtureRoot, "rustpython/runner.wasm", 73);
    writeAsset(fixtureRoot, "haskell-worker.js", 79);
    writeAsset(fixtureRoot, "haskell/ghc.wasm.gz.bin", 83);
    writeAsset(fixtureRoot, "haskell/ghc.wasm", 89);
    writeAsset(fixtureRoot, "haskell/libdir.tar.gz.bin", 97);
    writeAsset(fixtureRoot, "haskell/libdir.tar", 101);
    writeAsset(fixtureRoot, "haskell/wasi-shim.js", 103);
    writeAsset(fixtureRoot, "haskell/ghci.wasm.gz.bin", 107);
    writeAsset(fixtureRoot, "haskell/ghci.wasm", 109);
    const metadata = {
      protocol: "ghc-wasi-v1",
      executorMode: "ghci",
      testMode: "ghc-compile",
      ghcWasm: "haskell/ghc.wasm.gz.bin",
      ghciWasm: "haskell/ghci.wasm.gz.bin",
      libdirTar: "haskell/libdir.tar.gz.bin",
      libdirPath: "/ghc",
      workDir: "/work",
      wasiShim: "haskell/wasi-shim.js",
    };
    writeAsset(fixtureRoot, "haskell/runner.meta.json", Buffer.byteLength(JSON.stringify(metadata)));
    fs.writeFileSync(path.join(fixtureRoot, "public", "haskell", "runner.meta.json"), JSON.stringify(metadata));

    const manifest = await buildManifest({ root: fixtureRoot });
    assert.deepEqual(byId(manifest, "racket-wasm").assets, [
      { url: "racket-worker.js", bytes: 47 },
      { url: "racket/racket.js", bytes: 53 },
      { url: "racket/racket.wasm.gz", bytes: 59 },
      { url: "racket/racket.wasm", bytes: 61 },
    ]);
    assert.deepEqual(byId(manifest, "python-rustpython").assets, [
      { url: "rustpython-worker.js", bytes: 67 },
      { url: "rustpython/runner.wasm.gz.bin", bytes: 71 },
      { url: "rustpython/runner.wasm", bytes: 73 },
    ]);
    const haskell = byId(manifest, "haskell-ghc-wasi");
    assert.deepEqual(haskell.assets, [
      { url: "haskell-worker.js", bytes: 79 },
      { url: "haskell/ghc.wasm.gz.bin", bytes: 83 },
      { url: "haskell/ghc.wasm", bytes: 89 },
      { url: "haskell/libdir.tar.gz.bin", bytes: 97 },
      { url: "haskell/libdir.tar", bytes: 101 },
      { url: "haskell/wasi-shim.js", bytes: 103 },
      { url: "haskell/runner.meta.json", bytes: Buffer.byteLength(JSON.stringify(metadata)) },
      { url: "haskell/ghci.wasm.gz.bin", bytes: 107 },
      { url: "haskell/ghci.wasm", bytes: 109 },
    ]);
    assert.equal(haskell.packaged, false);
    assert.equal(haskell.unavailableReason, HASKELL_UNAVAILABLE_REASON);
    assert.deepEqual(haskell.capabilities, { execute: false, judge: false });

    fs.writeFileSync(path.join(fixtureRoot, "public", "racket", "racket.wasm"), Buffer.alloc(62, "x"));
    const report = checkRuntimeAssets({ root: fixtureRoot, manifest, target: "public" });
    assert.equal(byId({ runtimes: report.optional }, "racket-wasm").status, "broken");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("checkRuntimeAssets reports a required mismatch as broken", async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-runtime-manifest-"));
  try {
    createRequiredFixture(fixtureRoot);
    const manifest = await buildManifest({ root: fixtureRoot });
    fs.rmSync(path.join(fixtureRoot, "public", "typescript", "typescript.js"));

    const report = checkRuntimeAssets({ root: fixtureRoot, manifest, target: "public" });
    assert.equal(report.ready, false);
    assert.equal(byId({ runtimes: report.required }, "typescript-official").status, "broken");
    assert.equal(report.requiredFailures[0]?.runtimeId, "typescript-official");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("required Pyodide assets fail setup validation and runtime readiness when absent", async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-runtime-manifest-"));
  try {
    createRequiredFixture(fixtureRoot);
    const pyodideDirectory = path.join(fixtureRoot, "public", "pyodide");
    fs.rmSync(path.join(pyodideDirectory, "pyodide.asm.wasm"));

    assert.throws(() => assertRequiredPyodideAssets(pyodideDirectory), /Missing required Pyodide asset/);
    const manifest = await buildManifest({ root: fixtureRoot });
    const report = checkRuntimeAssets({ root: fixtureRoot, manifest, target: "public" });
    assert.equal(report.ready, false);
    assert.equal(byId({ runtimes: report.required }, "python-pyodide").status, "broken");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("checkRuntimeAssets reports a declared optional artifact mismatch as broken", async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-runtime-manifest-"));
  try {
    createRequiredFixture(fixtureRoot);
    writeAsset(fixtureRoot, "racket-worker.js", 47);
    writeAsset(fixtureRoot, "racket/racket.js", 53);
    writeAsset(fixtureRoot, "racket/racket.wasm", 59);
    const manifest = await buildManifest({ root: fixtureRoot });
    fs.rmSync(path.join(fixtureRoot, "public", "racket", "racket.wasm"));

    const report = checkRuntimeAssets({ root: fixtureRoot, manifest, target: "public" });
    assert.equal(report.ready, true);
    assert.equal(byId({ runtimes: report.optional }, "racket-wasm").status, "broken");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("checkRuntimeAssets rejects an unresolved Git LFS pointer as a broken optional asset", async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "localcoder-runtime-manifest-"));
  try {
    createRequiredFixture(fixtureRoot);
    writeAsset(fixtureRoot, "rustpython-worker.js", 67);
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${"0".repeat(64)}\nsize 9471382\n`;
    const runnerPath = path.join(fixtureRoot, "public", "rustpython", "runner.wasm.gz.bin");
    fs.mkdirSync(path.dirname(runnerPath), { recursive: true });
    fs.writeFileSync(runnerPath, pointer);

    const manifest = await buildManifest({ root: fixtureRoot });
    assert.equal(byId(manifest, "python-rustpython").packaged, true);

    const report = checkRuntimeAssets({ root: fixtureRoot, manifest, target: "public" });
    const rustPython = byId({ runtimes: report.optional }, "python-rustpython");
    assert.equal(rustPython.status, "broken");
    assert.match(rustPython.reason, /unresolved Git LFS pointer/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
