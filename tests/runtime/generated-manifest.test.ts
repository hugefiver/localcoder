import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { toRuntimeOption } from "../../src/features/runtimes/runtime-view-model.js";
import { parseRuntimeManifest } from "../../src/runtime/manifest.js";
import { RuntimeRegistry, isRuntimeExecutionEligible } from "../../src/runtime/registry.js";
import { RuntimeSupervisor } from "../../src/runtime/supervisor.js";
import { FakeWorkerFactory } from "../helpers/fake-worker.js";

const emittedOrProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = path.basename(emittedOrProjectRoot) === ".test-dist"
  ? path.resolve(emittedOrProjectRoot, "..")
  : emittedOrProjectRoot;
const expectedRuntimeIds = [
  "javascript-worker",
  "typescript-official",
  "python-pyodide",
  "python-rustpython",
  "racket-wasm",
  "haskell-ghc-wasi",
];

test("the generated public manifest satisfies the runtime contract and matches artifacts", () => {
  const raw = JSON.parse(readFileSync(path.join(root, "public", "runtime-manifest.json"), "utf8"));
  const manifest = parseRuntimeManifest(raw);

  assert.deepEqual(
    manifest.runtimes.map((runtime) => runtime.runtimeId).sort(),
    expectedRuntimeIds.slice().sort(),
  );

  for (const runtime of manifest.runtimes) {
    for (const asset of runtime.assets) {
      const assetPath = path.join(root, "public", ...asset.url.split("/"));
      assert.equal(statSync(assetPath).size, asset.bytes, `${runtime.runtimeId}: ${asset.url}`);
    }
  }
});

test("the generated Haskell runtime is explicitly unavailable and cannot begin verification", () => {
  const raw = JSON.parse(readFileSync(path.join(root, "public", "runtime-manifest.json"), "utf8"));
  const manifest = parseRuntimeManifest(raw);
  const registry = RuntimeRegistry.fromManifest(manifest);
  const haskell = registry.get("haskell-ghc-wasi");
  const workerFactory = new FakeWorkerFactory();
  const supervisor = new RuntimeSupervisor({ registry, workerFactory: workerFactory.create });

  assert.equal(haskell.packaged, false);
  assert.deepEqual(haskell.capabilities, { execute: false, judge: false });
  assert.deepEqual(haskell.state, {
    kind: "not-packaged",
    reason: "Haskell runtime is temporarily unavailable: browser ghc -e evaluation is blocked by incompatible compiler runtime ways.",
  });
  assert.equal(isRuntimeExecutionEligible(haskell), false);
  assert.deepEqual(registry.forLanguage("haskell", "execute"), []);
  assert.deepEqual(toRuntimeOption(haskell, "execute"), {
    value: "haskell-ghc-wasi",
    label: "Haskell",
    statusLabel: "不可用",
    disabled: true,
    reason: "Haskell runtime is temporarily unavailable: browser ghc -e evaluation is blocked by incompatible compiler runtime ways.",
  });
  assert.throws(() => supervisor.beginOptionalVerification("haskell-ghc-wasi"), /cannot begin optional verification/);
  assert.equal(workerFactory.workers.length, 0);
});
