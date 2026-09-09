import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

interface WorkerBuildResult {
  readonly buildId: string;
  readonly outputPath: string;
  readonly pythonBuildId: string;
  readonly pythonOutputPath: string;
  readonly racketBuildId: string;
  readonly racketOutputPath: string;
  readonly rustPythonBuildId: string;
  readonly rustPythonOutputPath: string;
  readonly haskellBuildId: string;
  readonly haskellOutputPath: string;
}

interface WorkerIds {
  readonly buildId: string;
  readonly pythonBuildId: string;
  readonly racketBuildId: string;
  readonly rustPythonBuildId: string;
  readonly haskellBuildId: string;
}

interface WorkerBuildPlan {
  readonly identityKey: keyof WorkerIds;
  readonly entryPoint: string;
  readonly logicalOutput: string;
  readonly bundle: boolean;
  readonly format: string;
  readonly platform: string;
  readonly target: string;
  readonly legalComments: string;
  readonly nodePaths: readonly string[];
}

interface WorkerBuilder {
  buildWorkerAssets(options: { root: string; plans?: readonly WorkerBuildPlan[] }): Promise<WorkerBuildResult>;
  workerBuildPlans(options: { root: string }): readonly WorkerBuildPlan[];
  workerBuildIds(options: { root: string; plans?: readonly WorkerBuildPlan[] }): Promise<WorkerIds>;
}

interface WorkerIdentityModule {
  esbuildIdentityRecords(toolchainRoot: string): readonly {
    readonly tag: string;
    readonly name: string;
    readonly bytes: Buffer;
  }[];
  haskellRuntimeIdentityRecords(root: string): readonly {
    readonly tag: string;
    readonly name: string;
    readonly bytes: Buffer;
  }[];
}

const emittedOrProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = path.basename(emittedOrProjectRoot) === ".test-dist"
  ? path.resolve(emittedOrProjectRoot, "..")
  : emittedOrProjectRoot;
const javascriptWorkerSources = [
  "src/domain/json-value.ts",
  "src/domain/language.ts",
  "src/runtime/protocol.ts",
  "src/workers/javascript.worker.ts",
  "src/workers/javascript/evaluator.ts",
  "src/workers/javascript/typescript-compiler.ts",
  "src/workers/shared/endpoint.ts",
  "src/workers/shared/output-buffer.ts",
  "src/workers/shared/runtime-errors.ts",
];
const pythonWorkerSources = [
  "src/domain/json-value.ts",
  "src/domain/language.ts",
  "src/runtime/protocol.ts",
  "src/workers/pyodide.worker.ts",
  "src/workers/python/pyodide-host.ts",
  "src/workers/python/python-bridge.ts",
  "src/workers/shared/endpoint.ts",
  "src/workers/shared/output-buffer.ts",
  "src/workers/shared/runtime-errors.ts",
];
const racketWorkerSources = [
  "src/domain/json-value.ts",
  "src/domain/language.ts",
  "src/runtime/protocol.ts",
  "src/workers/racket.worker.ts",
  "src/workers/racket/captured-streams.ts",
  "src/workers/racket/emscripten-host.ts",
  "src/workers/racket/json-bridge.ts",
  "src/workers/shared/endpoint.ts",
  "src/workers/shared/output-buffer.ts",
  "src/workers/shared/runtime-errors.ts",
];
const rustPythonWorkerSources = [
  "src/domain/json-value.ts",
  "src/domain/language.ts",
  "src/runtime/protocol.ts",
  "src/workers/rustpython.worker.ts",
  "src/workers/rustpython/host.ts",
  "src/workers/rustpython/payload.ts",
  "src/workers/wasi/io.ts",
  "src/workers/wasi/runner.ts",
  "src/workers/shared/endpoint.ts",
  "src/workers/shared/output-buffer.ts",
  "src/workers/shared/runtime-errors.ts",
];
const haskellWorkerSources = [
  "src/domain/json-value.ts",
  "src/domain/language.ts",
  "src/runtime/protocol.ts",
  "src/workers/haskell.worker.ts",
  "src/workers/haskell/assets.ts",
  "src/workers/haskell/ghc-host.ts",
  "src/workers/haskell/host-failures.ts",
  "src/workers/haskell/json-string-bridge.ts",
  "src/workers/haskell/tar-filesystem.ts",
  "src/workers/haskell/wasi-execution.ts",
  "src/workers/shared/endpoint.ts",
  "src/workers/shared/output-buffer.ts",
  "src/workers/shared/runtime-errors.ts",
];
const pyodideAssets = [
  "pyodide.js",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

function currentEsbuildPlatformPackage(): string {
  return `node_modules/@esbuild/${process.platform}-${process.arch}`;
}

function currentEsbuildPlatformBinary(): string {
  return process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
}

function nestedEsbuildPlatformPackage(rootPath: string): string {
  return path.join(
    rootPath,
    "node_modules",
    "esbuild",
    "node_modules",
    currentEsbuildPlatformPackage().slice("node_modules/".length),
  );
}

function packageRootFromResolved(resolvedPath: string, packageName: string): string {
  let current = path.dirname(resolvedPath);
  while (current !== path.dirname(current)) {
    const packageJsonPath = path.join(current, "package.json");
    try {
      const metadata = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
      if (metadata.name === packageName) return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    current = path.dirname(current);
  }
  throw new Error(`Cannot locate resolved package root for ${packageName}`);
}

function resolvedPackageRoot(rootPath: string, packageName: string): string {
  const requireFromRoot = createRequire(path.join(rootPath, "package.json"));
  return packageRootFromResolved(requireFromRoot.resolve(packageName), packageName);
}

function resolvedEsbuildPlatformPackage(rootPath: string): string {
  const esbuildRoot = resolvedPackageRoot(rootPath, "esbuild");
  const packageName = `@esbuild/${process.platform}-${process.arch}`;
  const requireFromEsbuild = createRequire(path.join(esbuildRoot, "package.json"));
  return packageRootFromResolved(
    requireFromEsbuild.resolve(`${packageName}/${currentEsbuildPlatformBinary()}`),
    packageName,
  );
}

function copyFixtureToolchain(fixture: string): void {
  cpSync(resolvedPackageRoot(root, "esbuild"), path.join(fixture, "node_modules", "esbuild"), { recursive: true });
  const platformSource = resolvedEsbuildPlatformPackage(root);
  const nestedPlatformPackage = nestedEsbuildPlatformPackage(fixture);
  cpSync(platformSource, nestedPlatformPackage, { recursive: true });
  cpSync(platformSource, path.join(fixture, currentEsbuildPlatformPackage()), { recursive: true });
  cpSync(
    resolvedPackageRoot(root, "@bjorn3/browser_wasi_shim"),
    path.join(fixture, "node_modules", "@bjorn3", "browser_wasi_shim"),
    { recursive: true },
  );
}

function writeAsset(rootPath: string, relativePath: string, contents: string): void {
  const destination = path.join(rootPath, "public", relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function createFixture(): string {
  const fixture = mkdtempSync(path.join(tmpdir(), "localcoder-worker-assets-"));
  writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ type: "module", devDependencies: { esbuild: "0.25.4", typescript: "5.9.3" } }),
  );
  for (const relativePath of new Set([...javascriptWorkerSources, ...pythonWorkerSources, ...racketWorkerSources, ...rustPythonWorkerSources, ...haskellWorkerSources])) {
    const destination = path.join(fixture, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(root, relativePath), destination);
  }
  copyFixtureToolchain(fixture);
  writeAsset(fixture, "typescript/typescript.js", "typescript compiler fixture");
  for (const asset of pyodideAssets) writeAsset(fixture, `pyodide/${asset}`, `pyodide ${asset}`);
  writeAsset(fixture, "racket/racket.js", "racket javascript fixture");
  writeAsset(fixture, "racket/racket.wasm.gz", "racket wasm gzip fixture");
  writeAsset(fixture, "racket/racket.wasm", "racket wasm raw fixture");
  writeAsset(fixture, "rustpython/runner.wasm.gz.bin", "rustpython wasm gzip-bin fixture");
  writeAsset(fixture, "rustpython/runner.wasm", "rustpython wasm raw fixture");
  writeAsset(fixture, "haskell/runner.meta.json", JSON.stringify({
    protocol: "ghc-wasi-v1",
    executorMode: "ghc-e",
    testMode: "ghc-compile",
    ghcWasm: "haskell/ghc.wasm.gz.bin",
    libdirTar: "haskell/libdir.tar.gz.bin",
    libdirPath: "/ghc",
    workDir: "/work",
    wasiShim: "haskell/wasi-shim.js",
  }));
  writeAsset(fixture, "haskell/wasi-shim.js", "haskell wasi shim fixture");
  writeAsset(fixture, "haskell/ghc.wasm.gz.bin", "ghc wasm gzip-bin fixture");
  writeAsset(fixture, "haskell/ghc.wasm", "ghc wasm raw fixture");
  writeAsset(fixture, "haskell/libdir.tar.gz.bin", "libdir gzip-bin fixture");
  writeAsset(fixture, "haskell/libdir.tar", "libdir raw fixture");
  return fixture;
}

async function removeFixture(fixture: string): Promise<void> {
  const requireFromFixture = createRequire(path.join(fixture, "package.json"));
  const esbuild = requireFromFixture("esbuild") as { stop?: () => Promise<void> };
  await esbuild.stop?.();
  rmSync(fixture, { recursive: true, force: true });
}

function assertOnlyChanged(previous: WorkerIds, next: WorkerIds, changed: keyof WorkerIds): void {
  for (const key of Object.keys(previous) as (keyof WorkerIds)[]) {
    if (key === changed) assert.notEqual(next[key], previous[key], `${key} should change`);
    else assert.equal(next[key], previous[key], `${key} should not change`);
  }
}

function assertAllChanged(previous: WorkerIds, next: WorkerIds): void {
  for (const key of Object.keys(previous) as (keyof WorkerIds)[]) assert.notEqual(next[key], previous[key], `${key} should change`);
}

function withJavaScriptPlan(
  plans: readonly WorkerBuildPlan[],
  patch: Partial<WorkerBuildPlan>,
): WorkerBuildPlan[] {
  return plans.map((plan) => plan.identityKey === "buildId" ? { ...plan, ...patch } : plan);
}

test("worker identity binds canonical build plans and resolved esbuild import closures", async () => {
  const fixture = createFixture();
  try {
    const builder = await import(pathToFileURL(path.join(root, "scripts", "build-worker-assets.mjs")).href) as WorkerBuilder;
    const plans = builder.workerBuildPlans({ root: fixture });
    const first = await builder.workerBuildIds({ root: fixture, plans });

    for (const patch of [
      { entryPoint: "src/workers/pyodide.worker.ts" },
      { format: "cjs" },
      { target: "es2019" },
      { platform: "neutral" },
      { legalComments: "inline" },
      { logicalOutput: "public/js-worker-identity-config.js" },
      { nodePaths: ["node_modules", "identity-unused-node-path"] },
    ]) {
      assertOnlyChanged(first, await builder.workerBuildIds({ root: fixture, plans: withJavaScriptPlan(plans, patch) }), "buildId");
    }

    const finalPlan = withJavaScriptPlan(plans, { target: "es2019" });
    const finalPlanIds = await builder.workerBuildIds({ root: fixture, plans: finalPlan });
    assert.equal((await builder.buildWorkerAssets({ root: fixture, plans: finalPlan })).buildId, finalPlanIds.buildId);

    const transitiveSource = path.join(fixture, "src", "workers", "javascript", "identity-transitive-fixture.ts");
    writeFileSync(transitiveSource, "export const identityTransitiveFixture = 'first';\n");
    appendFileSync(path.join(fixture, "src", "workers", "javascript.worker.ts"), "\nimport \"./javascript/identity-transitive-fixture.js\";\n");
    const withTransitiveSource = await builder.workerBuildIds({ root: fixture, plans });
    assertOnlyChanged(first, withTransitiveSource, "buildId");
    appendFileSync(transitiveSource, "export const identityTransitiveMutation = 'second';\n");
    assertOnlyChanged(withTransitiveSource, await builder.workerBuildIds({ root: fixture, plans }), "buildId");
  } finally {
    await removeFixture(fixture);
  }
});

test("worker identity resolves the platform binary from the effective esbuild package", async () => {
  const fixture = createFixture();
  try {
    const identity = await import(
      pathToFileURL(path.join(root, "scripts", "lib", "worker-build-identity.mjs")).href
    ) as WorkerIdentityModule;
    const platformPackage = nestedEsbuildPlatformPackage(fixture);
    const platformBinary = path.join(platformPackage, currentEsbuildPlatformBinary());
    const topLevelPlatformBinary = path.join(
      fixture,
      currentEsbuildPlatformPackage(),
      currentEsbuildPlatformBinary(),
    );
    const baseline = identity.esbuildIdentityRecords(fixture);
    assert.ok(baseline.some((record) => record.name.includes("node_modules/esbuild/node_modules/@esbuild/")));

    const originalPlatformBinary = readFileSync(platformBinary);
    appendFileSync(platformBinary, "\nactual nested platform binary mutation");
    assert.notDeepEqual(identity.esbuildIdentityRecords(fixture), baseline);
    writeFileSync(platformBinary, originalPlatformBinary);

    const originalTopLevelPlatformBinary = readFileSync(topLevelPlatformBinary);
    appendFileSync(topLevelPlatformBinary, "\nunrelated hoisted platform binary mutation");
    assert.deepEqual(identity.esbuildIdentityRecords(fixture), baseline);
    writeFileSync(topLevelPlatformBinary, originalTopLevelPlatformBinary);

    rmSync(platformBinary);
    assert.throws(
      () => identity.esbuildIdentityRecords(fixture),
      /Required worker identity input (package cannot be resolved|is missing or empty)/,
    );
    writeFileSync(platformBinary, originalPlatformBinary);

    rmSync(platformPackage, { recursive: true, force: true });
    assert.throws(
      () => identity.esbuildIdentityRecords(fixture),
      /Required worker identity input package (cannot be resolved|metadata is missing)/,
    );
  } finally {
    await removeFixture(fixture);
  }
});

test("Haskell worker identity uses gzip-bin candidates and excludes legacy gzip names", async () => {
  const fixture = createFixture();
  try {
    const identity = await import(
      pathToFileURL(path.join(root, "scripts", "lib", "worker-build-identity.mjs")).href,
    ) as WorkerIdentityModule;
    const names = identity.haskellRuntimeIdentityRecords(fixture).map((record) => record.name);

    assert.ok(names.includes("public/haskell/ghc.wasm.gz.bin"));
    assert.ok(names.includes("public/haskell/libdir.tar.gz.bin"));
    assert.equal(names.some((name) => name.endsWith(".wasm.gz") || name.endsWith(".tar.gz")), false);
  } finally {
    await removeFixture(fixture);
  }
});

test("worker identity binds exact build inputs without emitted-output self hashing", async () => {
  const fixture = createFixture();
  try {
    const builder = await import(pathToFileURL(path.join(root, "scripts", "build-worker-assets.mjs")).href) as WorkerBuilder;
    const identityModule = readFileSync(path.join(root, "scripts", "lib", "worker-build-identity.mjs"), "utf8");
    assert.doesNotMatch(identityModule, /localeCompare/);
    const first = await builder.buildWorkerAssets({ root: fixture });
    const firstIds = await builder.workerBuildIds({ root: fixture });

    for (const id of Object.values(firstIds)) assert.match(id, /^[0-9a-f]{16}$/);
    assert.equal(first.buildId, firstIds.buildId);
    assert.equal(first.pythonBuildId, firstIds.pythonBuildId);
    assert.equal(first.racketBuildId, firstIds.racketBuildId);
    assert.equal(first.rustPythonBuildId, firstIds.rustPythonBuildId);
    assert.equal(first.haskellBuildId, firstIds.haskellBuildId);
    assert.match(readFileSync(first.outputPath, "utf8"), new RegExp(first.buildId));
    assert.match(readFileSync(first.pythonOutputPath, "utf8"), new RegExp(first.pythonBuildId));
    assert.match(readFileSync(first.racketOutputPath, "utf8"), new RegExp(first.racketBuildId));
    assert.match(readFileSync(first.rustPythonOutputPath, "utf8"), new RegExp(first.rustPythonBuildId));
    assert.match(readFileSync(first.haskellOutputPath, "utf8"), new RegExp(first.haskellBuildId));

    appendFileSync(first.outputPath, "\nmutated emitted output");
    assert.deepEqual(await builder.workerBuildIds({ root: fixture }), firstIds);

    const packageJsonPath = path.join(fixture, "package.json");
    const originalPackageJson = readFileSync(packageJsonPath);
    writeFileSync(packageJsonPath, JSON.stringify({ type: "module", devDependencies: { esbuild: "^99.0.0", typescript: "^99.0.0" } }));
    assert.deepEqual(await builder.workerBuildIds({ root: fixture }), firstIds);
    writeFileSync(packageJsonPath, originalPackageJson);

    const typescriptAsset = path.join(fixture, "public", "typescript", "typescript.js");
    rmSync(typescriptAsset);
    await assert.rejects(builder.workerBuildIds({ root: fixture }), /typescript\/typescript\.js/);
    writeFileSync(typescriptAsset, "typescript compiler fixture");

    const pyodideAsset = path.join(fixture, "public", "pyodide", "pyodide.js");
    writeFileSync(pyodideAsset, "");
    await assert.rejects(builder.workerBuildIds({ root: fixture }), /pyodide\/pyodide\.js/);
    writeFileSync(pyodideAsset, "pyodide pyodide.js");

    const esbuildPackagePath = path.join(fixture, "node_modules", "esbuild", "package.json");
    const originalEsbuildPackage = readFileSync(esbuildPackagePath);
    appendFileSync(esbuildPackagePath, "\n");
    assertAllChanged(firstIds, await builder.workerBuildIds({ root: fixture }));
    writeFileSync(esbuildPackagePath, originalEsbuildPackage);

    const esbuildLibraryPath = path.join(fixture, "node_modules", "esbuild", "lib", "main.js");
    const originalEsbuildLibrary = readFileSync(esbuildLibraryPath);
    writeFileSync(esbuildLibraryPath, "");
    await assert.rejects(builder.workerBuildIds({ root: fixture }), /node_modules\/esbuild\/lib\/main\.js/);
    writeFileSync(esbuildLibraryPath, originalEsbuildLibrary);
    appendFileSync(esbuildLibraryPath, "\n// exact builder mutation");
    assertAllChanged(firstIds, await builder.workerBuildIds({ root: fixture }));
    writeFileSync(esbuildLibraryPath, originalEsbuildLibrary);

    appendFileSync(typescriptAsset, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "buildId");
    writeFileSync(typescriptAsset, "typescript compiler fixture");

    for (const asset of pyodideAssets) {
      const assetPath = path.join(fixture, "public", "pyodide", asset);
      const original = readFileSync(assetPath);
      appendFileSync(assetPath, "\nmutation");
      assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "pythonBuildId");
      writeFileSync(assetPath, original);
    }

    const racketJavaScript = path.join(fixture, "public", "racket", "racket.js");
    appendFileSync(racketJavaScript, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "racketBuildId");
    writeFileSync(racketJavaScript, "racket javascript fixture");

    const racketWasm = path.join(fixture, "public", "racket", "racket.wasm.gz");
    appendFileSync(racketWasm, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "racketBuildId");
    writeFileSync(racketWasm, "racket wasm gzip fixture");

    const racketWasmRaw = path.join(fixture, "public", "racket", "racket.wasm");
    appendFileSync(racketWasmRaw, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "racketBuildId");
    writeFileSync(racketWasmRaw, "racket wasm raw fixture");
    rmSync(racketWasm);
    rmSync(racketWasmRaw);
    const racketMissing = await builder.workerBuildIds({ root: fixture });
    assert.deepEqual(await builder.workerBuildIds({ root: fixture }), racketMissing);
    writeFileSync(racketWasmRaw, "racket wasm added fixture");
    const racketRawOnly = await builder.workerBuildIds({ root: fixture });
    assertOnlyChanged(racketMissing, racketRawOnly, "racketBuildId");
    writeFileSync(racketWasm, "racket wasm gzip fixture");
    assertOnlyChanged(racketRawOnly, await builder.workerBuildIds({ root: fixture }), "racketBuildId");
    writeFileSync(racketWasmRaw, "racket wasm raw fixture");

    const rustPythonWasm = path.join(fixture, "public", "rustpython", "runner.wasm.gz.bin");
    appendFileSync(rustPythonWasm, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "rustPythonBuildId");
    writeFileSync(rustPythonWasm, "rustpython wasm gzip-bin fixture");
    const rustPythonWasmRaw = path.join(fixture, "public", "rustpython", "runner.wasm");
    appendFileSync(rustPythonWasmRaw, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "rustPythonBuildId");
    writeFileSync(rustPythonWasmRaw, "rustpython wasm raw fixture");

    const haskellGhc = path.join(fixture, "public", "haskell", "ghc.wasm.gz.bin");
    appendFileSync(haskellGhc, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "haskellBuildId");
    writeFileSync(haskellGhc, "ghc wasm gzip-bin fixture");
    const haskellGhcRaw = path.join(fixture, "public", "haskell", "ghc.wasm");
    appendFileSync(haskellGhcRaw, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "haskellBuildId");
    writeFileSync(haskellGhcRaw, "ghc wasm raw fixture");

    const haskellLibdir = path.join(fixture, "public", "haskell", "libdir.tar.gz.bin");
    appendFileSync(haskellLibdir, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "haskellBuildId");
    writeFileSync(haskellLibdir, "libdir gzip-bin fixture");
    const haskellLibdirRaw = path.join(fixture, "public", "haskell", "libdir.tar");
    appendFileSync(haskellLibdirRaw, "\nmutation");
    assertOnlyChanged(firstIds, await builder.workerBuildIds({ root: fixture }), "haskellBuildId");
    writeFileSync(haskellLibdirRaw, "libdir raw fixture");

    const haskellMetadata = path.join(fixture, "public", "haskell", "runner.meta.json");
    writeFileSync(haskellMetadata, JSON.stringify({
      protocol: "ghc-wasi-v1",
      executorMode: "ghci",
      testMode: "ghc-compile",
      ghcWasm: "haskell/ghc.wasm.gz.bin",
      ghciWasm: "haskell/ghci.wasm.gz.bin",
      libdirTar: "haskell/libdir.tar.gz.bin",
      libdirPath: "/ghc",
      workDir: "/work",
      wasiShim: "haskell/wasi-shim.js",
    }));
    writeAsset(fixture, "haskell/ghci.wasm.gz.bin", "ghci wasm gzip-bin fixture");
    const ghciSelected = await builder.workerBuildIds({ root: fixture });
    assertOnlyChanged(firstIds, ghciSelected, "haskellBuildId");
    appendFileSync(path.join(fixture, "public", "haskell", "ghci.wasm.gz.bin"), "\nmutation");
    assertOnlyChanged(ghciSelected, await builder.workerBuildIds({ root: fixture }), "haskellBuildId");
    writeAsset(fixture, "haskell/ghci.wasm.gz.bin", "ghci wasm gzip-bin fixture");
    writeAsset(fixture, "haskell/ghci.wasm", "ghci wasm raw fixture");
    const ghciBoth = await builder.workerBuildIds({ root: fixture });
    assertOnlyChanged(ghciSelected, ghciBoth, "haskellBuildId");
    appendFileSync(path.join(fixture, "public", "haskell", "ghci.wasm"), "\nmutation");
    assertOnlyChanged(ghciBoth, await builder.workerBuildIds({ root: fixture }), "haskellBuildId");

    const wasiShim = path.join(fixture, "node_modules", "@bjorn3", "browser_wasi_shim", "dist", "index.js");
    const beforeWasiMutation = await builder.workerBuildIds({ root: fixture });
    appendFileSync(wasiShim, "\n// exact shim mutation");
    const afterWasiMutation = await builder.workerBuildIds({ root: fixture });
    assert.notEqual(afterWasiMutation.rustPythonBuildId, beforeWasiMutation.rustPythonBuildId);
    assert.notEqual(afterWasiMutation.haskellBuildId, beforeWasiMutation.haskellBuildId);
    assert.equal(afterWasiMutation.buildId, beforeWasiMutation.buildId);
    assert.equal(afterWasiMutation.pythonBuildId, beforeWasiMutation.pythonBuildId);
    assert.equal(afterWasiMutation.racketBuildId, beforeWasiMutation.racketBuildId);

    appendFileSync(path.join(fixture, "src", "workers", "javascript", "evaluator.ts"), "\n");
    const changedJavaScriptSource = await builder.workerBuildIds({ root: fixture });
    assertOnlyChanged(afterWasiMutation, changedJavaScriptSource, "buildId");
    appendFileSync(path.join(fixture, "src", "workers", "python", "python-bridge.ts"), "\n");
    const changedPythonSource = await builder.workerBuildIds({ root: fixture });
    assertOnlyChanged(changedJavaScriptSource, changedPythonSource, "pythonBuildId");
    appendFileSync(path.join(fixture, "src", "workers", "racket", "json-bridge.ts"), "\n");
    const changedRacketSource = await builder.workerBuildIds({ root: fixture });
    assertOnlyChanged(changedPythonSource, changedRacketSource, "racketBuildId");
    appendFileSync(path.join(fixture, "src", "workers", "rustpython", "payload.ts"), "\n");
    const changedRustPythonSource = await builder.workerBuildIds({ root: fixture });
    assertOnlyChanged(changedRacketSource, changedRustPythonSource, "rustPythonBuildId");
    appendFileSync(path.join(fixture, "src", "workers", "haskell", "host-failures.ts"), "\n");
    assertOnlyChanged(changedRustPythonSource, await builder.workerBuildIds({ root: fixture }), "haskellBuildId");
  } finally {
    await removeFixture(fixture);
  }
});
