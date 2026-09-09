import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeHaskellJsonOutput,
  encodeHaskellJsonInput,
  wrapHaskellJudgeSource,
} from "../../src/workers/haskell/json-string-bridge.js";
import { loadHaskellAssets, parseHaskellRunnerMetadata } from "../../src/workers/haskell/assets.js";
import { createHaskellHost, type HaskellWasiShim } from "../../src/workers/haskell/ghc-host.js";

test("the Haskell JSON-string bridge preserves canonical Unicode JSON without interpolation", () => {
  const value = { greeting: "こんにちは😀", quote: "\\\"\n", nested: [true, { café: null }] };
  const encoded = encodeHaskellJsonInput(value);

  assert.deepEqual(JSON.parse(encoded), value);
  assert.deepEqual(decodeHaskellJsonOutput(encoded), value);
  assert.throws(() => decodeHaskellJsonOutput('{"broken":'), /strict canonical JSON/i);
  assert.throws(() => encodeHaskellJsonInput(Number.NaN as never), /canonical JSON/i);
});

test("the Haskell judge wrapper has one explicit main and emits only solution JSON", () => {
  const source = "solution :: String -> String\nsolution = id";
  const program = wrapHaskellJudgeSource(source);

  assert.match(program, /main :: IO \(\)/);
  assert.match(program, /getContents/);
  assert.match(program, /putStr/);
  assert.match(program, /solution __lc_input/);
  assert.doesNotMatch(program, /expected|passed|verdict|comparer/i);
  assert.throws(
    () => wrapHaskellJudgeSource("main :: IO ()\nmain = pure ()\nsolution = id"),
    /main.*unsupported/i,
  );
});

test("Haskell metadata rejects inconsistent GHCi declarations and keeps the selected GHC modes explicit", () => {
  const metadata = {
    protocol: "ghc-wasi-v1",
    executorMode: "ghc-e",
    testMode: "ghc-compile",
    ghcWasm: "haskell/ghc.wasm.gz.bin",
    libdirTar: "haskell/libdir.tar.gz.bin",
    libdirPath: "/ghc",
    workDir: "/work",
    wasiShim: "haskell/wasi-shim.js",
  };
  assert.deepEqual(parseHaskellRunnerMetadata(metadata), metadata);
  assert.throws(
    () => parseHaskellRunnerMetadata({ ...metadata, testMode: "ghci" }),
    /requires ghciWasm/i,
  );
  assert.throws(
    () => parseHaskellRunnerMetadata({ ...metadata, ghciWasm: "haskell/ghci.wasm.gz.bin" }),
    /must not declare ghciWasm/i,
  );
});

test("the Haskell asset loader explicitly decompresses HTTP-stable gzip-bin assets and skips unused GHCi", async () => {
  const requested: string[] = [];
  const ghcWasm = minimalWasmBuffer();
  const libdirTar = new Uint8Array(1024).buffer;
  const metadata = JSON.stringify({
    protocol: "ghc-wasi-v1",
    executorMode: "ghc-e",
    testMode: "ghc-compile",
    ghcWasm: "haskell/ghc.wasm.gz.bin",
    libdirTar: "haskell/libdir.tar.gz.bin",
    libdirPath: "/ghc",
    workDir: "/work",
    wasiShim: "haskell/wasi-shim.js",
  });
  const assets = await loadHaskellAssets({
    location: { href: "https://local.test/app/haskell-worker.js" },
    fetch: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requested.push(url.href);
      if (url.pathname.endsWith("runner.meta.json")) return new Response(metadata);
      if (url.pathname.endsWith("ghc.wasm.gz.bin")) return new Response(await gzip(ghcWasm));
      if (url.pathname.endsWith("libdir.tar.gz.bin")) return new Response(await gzip(libdirTar));
      return new Response(null, { status: 404 });
    },
  });

  assert.deepEqual(new Uint8Array(assets.ghcWasm), new Uint8Array(ghcWasm));
  assert.deepEqual(new Uint8Array(assets.libdirTar), new Uint8Array(libdirTar));
  assert.equal(assets.wasiShimUrl, "https://local.test/app/haskell/wasi-shim.js");
  assert.deepEqual(requested.map((url) => new URL(url).pathname), [
    "/app/haskell/runner.meta.json",
    "/app/haskell/ghc.wasm.gz.bin",
    "/app/haskell/libdir.tar.gz.bin",
  ]);
});

test("the Haskell asset loader falls back from gzip-bin to raw assets", async () => {
  const requested: string[] = [];
  const metadata = JSON.stringify({
    protocol: "ghc-wasi-v1",
    executorMode: "ghc-e",
    testMode: "ghc-compile",
    ghcWasm: "haskell/ghc.wasm.gz.bin",
    libdirTar: "haskell/libdir.tar.gz.bin",
    libdirPath: "/ghc",
    workDir: "/work",
    wasiShim: "haskell/wasi-shim.js",
  });
  const assets = await loadHaskellAssets({
    location: { href: "https://local.test/app/haskell-worker.js" },
    fetch: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requested.push(url.href);
      if (url.pathname.endsWith("runner.meta.json")) return new Response(metadata);
      if (url.pathname.endsWith(".gz.bin")) return new Response(null, { status: 404 });
      if (url.pathname.endsWith("ghc.wasm")) return new Response(minimalWasmBuffer());
      if (url.pathname.endsWith("libdir.tar")) return new Response(new Uint8Array(1024));
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(assets.ghcWasm.byteLength, 8);
  assert.equal(assets.libdirTar.byteLength, 1024);
  assert.equal(assets.wasiShimUrl, "https://local.test/app/haskell/wasi-shim.js");
  assert.deepEqual(requested.map((url) => new URL(url).pathname), [
    "/app/haskell/runner.meta.json",
    "/app/haskell/ghc.wasm.gz.bin",
    "/app/haskell/libdir.tar.gz.bin",
    "/app/haskell/ghc.wasm",
    "/app/haskell/libdir.tar",
  ]);
});

test("the Haskell host maps malformed JSON output to a bounded nonfatal JSON bridge failure", async () => {
  FakeWasi.roots.length = 0;
  FakeWasi.plans = [{}, { stdout: "{broken" }];
  const host = createFakeHost();
  await host.initialize();

  const judged = await host.judge("solution :: String -> String\nsolution = id", [{ index: 0, input: null }]);
  const result = judged.cases[0];

  assert.ok(result !== undefined && !result.ok);
  if (result === undefined || result.ok) return;
  assert.equal(result.failure.kind, "runtime");
  assert.equal(result.failure.code, "json-bridge-error");
  assert.equal(result.failure.fatal, false);
  assert.ok(new TextEncoder().encode(result.failure.details ?? "").byteLength <= 8_192);
  assert.doesNotMatch(JSON.stringify(result), /expected|passed|verdict|comparer/i);
});

test("the Haskell host reports compiler nonzero exits as bounded nonfatal compile failures", async () => {
  FakeWasi.roots.length = 0;
  FakeWasi.plans = [{ exitCode: 1, stderr: "雪".repeat(5_000), writeProgram: false }];
  const host = createFakeHost();
  await host.initialize();

  const judged = await host.judge("solution :: String -> String\nsolution = id", [{ index: 1, input: null }]);
  const result = judged.cases[0];

  assert.ok(result !== undefined && !result.ok);
  if (result === undefined || result.ok) return;
  assert.deepEqual(
    { kind: result.failure.kind, code: result.failure.code, fatal: result.failure.fatal },
    { kind: "compile", code: "haskell-compile-error", fatal: false },
  );
  assert.ok(new TextEncoder().encode(result.failure.details ?? "").byteLength <= 8_192);
});

test("the Haskell host reports compiled program nonzero exits as nonfatal runtime failures", async () => {
  FakeWasi.roots.length = 0;
  FakeWasi.plans = [{}, { exitCode: 2, stderr: "program failed" }];
  const host = createFakeHost();
  await host.initialize();

  const judged = await host.judge("solution :: String -> String\nsolution = id", [{ index: 2, input: null }]);
  const result = judged.cases[0];

  assert.ok(result !== undefined && !result.ok);
  if (result === undefined || result.ok) return;
  assert.deepEqual(
    { kind: result.failure.kind, code: result.failure.code, fatal: result.failure.fatal },
    { kind: "runtime", code: "haskell-runtime-error", fatal: false },
  );
});

test("the Haskell host shares one Unicode-safe output budget across judge cases", async () => {
  FakeWasi.roots.length = 0;
  FakeWasi.plans = [{ stdout: "😀😀😀" }];
  const host = createFakeHost(8);
  await host.initialize();

  const judged = await host.judge("solution :: String -> String\nsolution = id", [
    { index: 3, input: null },
    { index: 4, input: null },
  ]);
  const first = judged.cases[0];
  const second = judged.cases[1];

  assert.ok(first !== undefined && !first.ok);
  if (first === undefined || first.ok) return;
  assert.equal(first.failure.code, "json-bridge-error");
  assert.deepEqual(first.stdout, bounded("😀😀", true));
  assert.ok(second !== undefined && second.ok);
  if (second === undefined || !second.ok) return;
  assert.equal(second.actual, null);
  assert.deepEqual(second.stdout, bounded("", true));
});

test("the Haskell host creates a fresh work tree for each string-JSON judge case", async () => {
  FakeWasi.roots.length = 0;
  FakeWasi.plans = [];
  const host = createFakeHost();

  assert.deepEqual(await host.initialize(), {
    runtimeVersion: "ghc-wasi-v1",
    buildId: "haskell-build",
    capabilities: { execute: true, judge: true },
  });
  const judged = await host.judge("solution :: String -> String\nsolution = id", [
    { index: 7, input: { greeting: "雪", nested: [true, null] } },
    { index: 9, input: null },
  ]);

  assert.deepEqual(judged.cases.map((item) => item.ok ? item.actual : item.failure.code), [
    { greeting: "雪", nested: [true, null] },
    null,
  ]);
  assert.equal(new Set(FakeWasi.roots).size, 2);
  assert.ok(FakeWasi.roots.every((root) => root.contents.get("work") instanceof FakeDirectory));
  assert.doesNotMatch(JSON.stringify(judged), /expected|passed|verdict|comparer/i);
});

function createFakeHost(outputBytes?: number) {
  return createHaskellHost({
    loadAssets: async () => ({
      metadata: parseHaskellRunnerMetadata({
        protocol: "ghc-wasi-v1",
        executorMode: "ghc-e",
        testMode: "ghc-compile",
        ghcWasm: "haskell/ghc.wasm.gz.bin",
        libdirTar: "haskell/libdir.tar.gz.bin",
        libdirPath: "/ghc",
        workDir: "/work",
        wasiShim: "haskell/wasi-shim.js",
      }),
      ghcWasm: minimalWasmBuffer(),
      libdirTar: new Uint8Array(1024).buffer,
      wasiShimUrl: "https://local.test/haskell/wasi-shim.js",
    }),
    loadWasiShim: async () => fakeShim,
    buildId: "haskell-build",
    ...(outputBytes === undefined ? {} : { outputBytes }),
  });
}

class FakeFile {
  constructor(readonly data: Uint8Array, readonly options?: { readonly?: boolean }) {}
}

class FakeDirectory {
  constructor(readonly contents: Map<string, FakeFile | FakeDirectory>) {}
}

class FakeOpenFile {
  constructor(readonly file: FakeFile) {}
}

class FakeConsoleStdout {
  constructor(readonly write: (bytes: Uint8Array) => void) {}
}

class FakePreopenDirectory {
  constructor(readonly name: string, readonly contents: Map<string, FakeFile | FakeDirectory>) {}
}

class FakeWasi {
  static readonly roots: FakeDirectory[] = [];
  static plans: FakeWasiPlan[] = [];

  readonly wasiImport = {};

  constructor(
    private readonly args: string[],
    _env: string[],
    private readonly fds: unknown[],
  ) {}

  start(): number {
    const preopen = this.fds.find((fd): fd is FakePreopenDirectory => fd instanceof FakePreopenDirectory);
    if (preopen === undefined) throw new Error("missing preopen directory");
    const root = new FakeDirectory(preopen.contents);
    const plan = FakeWasi.plans.shift() ?? {};
    const stdout = this.fds.find((fd): fd is FakeConsoleStdout => fd instanceof FakeConsoleStdout);
    const stderr = this.fds.find((fd): fd is FakeConsoleStdout => fd instanceof FakeConsoleStdout && fd !== stdout);
    if (plan.stdout !== undefined && stdout !== undefined) stdout.write(new TextEncoder().encode(plan.stdout));
    if (plan.stderr !== undefined && stderr !== undefined) stderr.write(new TextEncoder().encode(plan.stderr));
    if (this.args.includes("-o")) {
      FakeWasi.roots.push(root);
      const work = root.contents.get("work");
      if (!(work instanceof FakeDirectory)) throw new Error("missing work directory");
      if (plan.writeProgram !== false) work.contents.set("program.wasm", new FakeFile(new Uint8Array(minimalWasmBuffer())));
      return plan.exitCode ?? 0;
    }
    const stdin = this.fds.find((fd): fd is FakeOpenFile => fd instanceof FakeOpenFile);
    if (stdout === undefined || stdin === undefined) throw new Error("missing standard stream");
    if (plan.stdout === undefined) stdout.write(new TextEncoder().encode(new TextDecoder().decode(stdin.file.data)));
    return plan.exitCode ?? 0;
  }
}

interface FakeWasiPlan {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly writeProgram?: boolean;
}

const fakeShim = {
  WASI: FakeWasi,
  File: FakeFile,
  Directory: FakeDirectory,
  OpenFile: FakeOpenFile,
  ConsoleStdout: FakeConsoleStdout,
  PreopenDirectory: FakePreopenDirectory,
} as unknown as HaskellWasiShim;

function minimalWasmBuffer(): ArrayBuffer {
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer as ArrayBuffer;
}

async function gzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function bounded(text: string, truncated: boolean) {
  return { text, bytes: new TextEncoder().encode(text).byteLength, truncated };
}
