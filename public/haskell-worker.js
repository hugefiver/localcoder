// Haskell runtime worker (GHC/GHCi WASM + full WASI shim)
//
// This worker runs entirely in the browser with a WASI shim and virtual FS.
// It expects:
//   - public/haskell/ghc.wasm
//   - public/haskell/ghci.wasm (optional)
//   - public/haskell/libdir.tar (uncompressed)
//   - public/haskell/wasi-shim.js
// It supports:
// - ghci: stdin is GHCi commands
// - ghc-e: ghc -e expression evaluation
// - ghc-compile: compile to wasm then run

import {
  WASI,
  WASIProcExit,
  File,
  OpenFile,
  Directory,
  PreopenDirectory,
  ConsoleStdout,
} from './haskell/wasi-shim.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const defaultConfig = {
  protocol: 'ghc-e',
  executorMode: 'ghc-e',
  testMode: 'ghc-compile',
  ghcWasm: 'haskell/ghc.wasm.gz',
  ghciWasm: 'haskell/ghci.wasm.gz',
  libdirTar: 'haskell/libdir.tar.gz',
  libdirPath: '/ghc',
  workDir: '/work',
  ghcArgs: ['-ignore-dot-ghci', '-v0'],
  ghciArgs: ['-ignore-dot-ghci', '-v0'],
  executorExpr: 'main',
};

let runtimeConfig = null;
let ghcWasmBytes = null;
let ghciWasmBytes = null;
let libdirRoot = null;
let isReady = false;

function getBaseURL() {
  return self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/');
}

async function loadRuntimeConfig() {
  if (runtimeConfig) return runtimeConfig;
  const baseURL = getBaseURL();
  const metaUrl = baseURL + 'haskell/runner.meta.json';
  try {
    const res = await fetch(metaUrl);
    if (res.ok) {
      const data = await res.json();
      runtimeConfig = { ...defaultConfig, ...data };
      return runtimeConfig;
    }
  } catch {
    // ignore
  }
  runtimeConfig = { ...defaultConfig };
  return runtimeConfig;
}

async function maybeDecompressGzip(buffer) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not available; cannot load .gz assets');
  }
  const stream = new Response(buffer).body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

async function fetchArrayBuffer(path) {
  const baseURL = getBaseURL();
  const url = baseURL + path;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load Haskell runtime asset: ${url}`);
  }
  const buffer = await res.arrayBuffer();
  if (path.endsWith('.gz')) {
    return await maybeDecompressGzip(buffer);
  }
  return buffer;
}

async function fetchWithFallback(paths) {
  let lastError = null;
  for (const path of paths) {
    if (!path) continue;
    try {
      return await fetchArrayBuffer(path);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Failed to load asset');
}

async function loadGhcWasm(config) {
  if (ghcWasmBytes) return ghcWasmBytes;
  const candidates = config.ghcWasm?.endsWith('.gz')
    ? [config.ghcWasm]
    : [config.ghcWasm?.replace(/\.wasm$/, '.wasm.gz'), config.ghcWasm];
  ghcWasmBytes = await fetchWithFallback(candidates);
  return ghcWasmBytes;
}

async function loadGhciWasm(config) {
  if (ghciWasmBytes) return ghciWasmBytes;
  const candidates = config.ghciWasm?.endsWith('.gz')
    ? [config.ghciWasm]
    : [config.ghciWasm?.replace(/\.wasm$/, '.wasm.gz'), config.ghciWasm];
  ghciWasmBytes = await fetchWithFallback(candidates);
  return ghciWasmBytes;
}

function parseOctal(text) {
  const trimmed = text.replace(/\0.*$/, '').trim();
  if (!trimmed) return 0;
  return parseInt(trimmed, 8);
}

function readString(u8, start, length) {
  let end = start + length;
  while (end > start && u8[end - 1] === 0) end--;
  return new TextDecoder().decode(u8.slice(start, end));
}

function ensureDir(root, parts) {
  let dir = root;
  for (const part of parts) {
    const existing = dir.contents.get(part);
    if (existing instanceof Directory) {
      dir = existing;
      continue;
    }
    const next = new Directory(new Map());
    dir.contents.set(part, next);
    dir = next;
  }
  return dir;
}

function addFile(root, path, data) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  const dir = ensureDir(root, parts);
  dir.contents.set(name, new File(data, { readonly: true }));
}

function addDirectory(root, path) {
  const parts = path.split('/').filter(Boolean);
  ensureDir(root, parts);
}

function untarToDirectory(u8, targetRoot) {
  let offset = 0;
  let longName = null;
  while (offset + 512 <= u8.length) {
    const header = u8.slice(offset, offset + 512);
    const isEmpty = header.every((b) => b === 0);
    if (isEmpty) break;

    let name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;

    const typeFlag = String.fromCharCode(header[156] || 48);
    const size = parseOctal(readString(header, 124, 12));

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (typeFlag === 'L') {
      const nameBytes = u8.slice(dataStart, dataEnd);
      longName = new TextDecoder().decode(nameBytes).replace(/\0.*$/, '').trim();
    } else {
      const entryName = longName ?? name;
      longName = null;
      if (entryName) {
        if (typeFlag === '5') {
          addDirectory(targetRoot, entryName);
        } else {
          const data = u8.slice(dataStart, dataEnd);
          addFile(targetRoot, entryName, data);
        }
      }
    }

    const total = 512 + Math.ceil(size / 512) * 512;
    offset += total;
  }
}

function mountDirectory(root, absPath, dir) {
  const parts = absPath.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  const parent = ensureDir(root, parts);
  parent.contents.set(name, dir);
}

async function loadLibdir(config) {
  if (libdirRoot) return libdirRoot;
  const candidates = config.libdirTar?.endsWith('.gz')
    ? [config.libdirTar]
    : [config.libdirTar?.replace(/\.tar$/, '.tar.gz'), config.libdirTar];
  const tarBytes = await fetchWithFallback(candidates);
  const tarU8 = new Uint8Array(tarBytes);
  const root = new Directory(new Map());
  untarToDirectory(tarU8, root);
  libdirRoot = root;
  return libdirRoot;
}

function buildFileTree(config, libdirDir, workDir) {
  const root = new Directory(new Map());
  mountDirectory(root, config.libdirPath, libdirDir);
  mountDirectory(root, config.workDir, workDir);
  return root;
}

function assertWasiShim(config) {
  if (config.wasiShim && config.wasiShim !== 'bjorn3') {
    throw new Error(
      `Unsupported WASI shim: ${config.wasiShim}. This runtime uses WASI Preview1; only 'bjorn3' is supported.`,
    );
  }
}

function concatChunks(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function makeWasi({ args, env, stdinText, rootDir }) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdinBytes = textEncoder.encode(stdinText ?? '');
  const fds = [
    new OpenFile(new File(stdinBytes)),
    new ConsoleStdout((buf) => stdoutChunks.push(new Uint8Array(buf))),
    new ConsoleStdout((buf) => stderrChunks.push(new Uint8Array(buf))),
    new PreopenDirectory('/', rootDir.contents),
  ];

  const envPairs = Object.entries(env ?? {}).map(([k, v]) => `${k}=${v}`);
  const wasi = new WASI(args, envPairs, fds);
  return { wasi, stdoutChunks, stderrChunks };
}

async function runWasiProgram(wasmBytes, { args, env, stdinText, rootDir, runtimeName }) {
  const { wasi, stdoutChunks, stderrChunks } = makeWasi({ args, env, stdinText, rootDir });
  const instance = await WebAssembly.instantiate(wasmBytes, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });

  let exitCode = 0;
  try {
    exitCode = wasi.start(instance);
  } catch (err) {
    if (err instanceof WASIProcExit) {
      exitCode = err.code;
    } else {
      throw err;
    }
  }

  if (exitCode !== 0) {
    const stderrText = textDecoder.decode(concatChunks(stderrChunks));
    const extra = stderrText ? `\n${stderrText}` : '';
    throw new Error(`${runtimeName} exited with code ${exitCode}.${extra}`);
  }

  const stdoutText = textDecoder.decode(concatChunks(stdoutChunks));
  const stderrText = textDecoder.decode(concatChunks(stderrChunks));
  return {
    stdout: stdoutText,
    stderr: stderrText,
  };
}

function escapeHaskellString(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function buildGhciStdin({ code, input, executorMode }) {
  const jsonInput = JSON.stringify(input ?? null)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  const codeBlock = `:{\n${code}\n:}`;
  if (executorMode) {
    return `${codeBlock}\n:quit\n`;
  }

  return [
    codeBlock,
    `let __inputJson = \"${jsonInput}\"`,
    `let __result = solution __inputJson`,
    `putStrLn __result`,
    `:quit`,
    '',
  ].join('\n');
}

function wrapCompileSource(code) {
  return `${code}\n\nmain :: IO ()\nmain = do\n  input <- getContents\n  let result = solution input\n  putStrLn result\n`;
}

async function runGhci({ config, code, input, executorMode }) {
  const ghciWasm = await loadGhciWasm(config);
  const libdir = await loadLibdir(config);
  const workDir = new Directory(new Map());
  const rootDir = buildFileTree(config, libdir, workDir);

  const args = ['ghci', ...(config.ghciArgs || [])];
  const stdin = buildGhciStdin({ code, input, executorMode });

  return runWasiProgram(ghciWasm, {
    args,
    env: {
      PWD: config.workDir,
      GHC_PACKAGE_PATH: `${config.libdirPath}/package.conf.d`,
    },
    stdinText: stdin,
    rootDir,
    runtimeName: 'GHCi',
  });
}

async function runGhcEval({ config, code, input, executorMode }) {
  const ghcWasm = await loadGhcWasm(config);
  const libdir = await loadLibdir(config);
  const workDir = new Directory(new Map());
  const rootDir = buildFileTree(config, libdir, workDir);

  const sourcePath = `${config.workDir}/Main.hs`;
  workDir.contents.set('Main.hs', new File(textEncoder.encode(code)));

  const expr = executorMode
    ? config.executorExpr || 'main'
    : `putStrLn (solution \"${escapeHaskellString(JSON.stringify(input ?? null))}\")`;

  const args = [
    'ghc',
    ...(config.ghcArgs || []),
    '-B',
    config.libdirPath,
    '-e',
    expr,
    sourcePath,
  ];

  return runWasiProgram(ghcWasm, {
    args,
    env: {
      PWD: config.workDir,
      GHC_PACKAGE_PATH: `${config.libdirPath}/package.conf.d`,
    },
    stdinText: '',
    rootDir,
    runtimeName: 'GHC',
  });
}

async function runGhcCompile({ config, code, input, executorMode }) {
  const ghcWasm = await loadGhcWasm(config);
  const libdir = await loadLibdir(config);
  const workDir = new Directory(new Map());
  const rootDir = buildFileTree(config, libdir, workDir);

  const source = executorMode ? code : wrapCompileSource(code);
  workDir.contents.set('Main.hs', new File(textEncoder.encode(source)));

  const outputPath = `${config.workDir}/app.wasm`;
  const args = [
    'ghc',
    ...(config.ghcArgs || []),
    '-B',
    config.libdirPath,
    '-outputdir',
    `${config.workDir}/.ghc`,
    '-o',
    outputPath,
    `${config.workDir}/Main.hs`,
  ];

  await runWasiProgram(ghcWasm, {
    args,
    env: {
      PWD: config.workDir,
      GHC_PACKAGE_PATH: `${config.libdirPath}/package.conf.d`,
    },
    stdinText: '',
    rootDir,
    runtimeName: 'GHC',
  });

  const output = workDir.contents.get('app.wasm');
  if (!(output instanceof File)) {
    throw new Error('Compile output missing: /work/app.wasm');
  }

  const wasmBytes = output.data.buffer.slice(
    output.data.byteOffset,
    output.data.byteOffset + output.data.byteLength,
  );

  return runWasiProgram(wasmBytes, {
    args: ['app.wasm'],
    env: { PWD: config.workDir },
    stdinText: executorMode ? '' : JSON.stringify(input ?? null),
    rootDir,
    runtimeName: 'Program',
  });
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function parseJsonFromOutput(text) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, value: null };
  const lines = trimmed.split(/\r?\n/);
  return tryParseJson(lines[lines.length - 1]);
}

function stableStringify(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v)
        .sort()
        .reduce((acc, key) => {
          acc[key] = v[key];
          return acc;
        }, {});
    }
    return v;
  });
}

self.onmessage = async (e) => {
  const { type, requestId, code, testCases, executorMode } = e.data;

  if (type === 'preload') {
    try {
      const config = await loadRuntimeConfig();
      assertWasiShim(config);
      await loadLibdir(config);
      const needsGhci =
        config.protocol === 'ghci' ||
        config.executorMode === 'ghci' ||
        config.testMode === 'ghci';
      await Promise.all([
        loadGhcWasm(config),
        needsGhci && config.ghciWasm ? loadGhciWasm(config) : Promise.resolve(),
      ]);
      isReady = true;
      self.postMessage({ type: 'ready', requestId });
    } catch (error) {
      self.postMessage({
        success: false,
        error: error?.message ?? String(error),
        stack: error?.stack,
        requestId,
      });
    }
    return;
  }

  const startTime = performance.now();

  try {
    const config = await loadRuntimeConfig();
    assertWasiShim(config);
    if (!isReady) {
      isReady = true;
      self.postMessage({ type: 'ready' });
    }

    const executorStrategy = config.executorMode || config.protocol || 'ghc-e';
    const testStrategy = config.testMode || config.protocol || 'ghc-compile';

    const runExecutor = async () => {
      if (executorStrategy === 'ghci') return runGhci({ config, code, executorMode: true });
      if (executorStrategy === 'ghc-compile') return runGhcCompile({ config, code, executorMode: true });
      return runGhcEval({ config, code, executorMode: true });
    };

    const runTest = async (input) => {
      if (testStrategy === 'ghci') return runGhci({ config, code, input, executorMode: false });
      if (testStrategy === 'ghc-e') return runGhcEval({ config, code, input, executorMode: false });
      return runGhcCompile({ config, code, input, executorMode: false });
    };

    if (executorMode) {
      const { stdout, stderr } = await runExecutor();
      const parsed = parseJsonFromOutput(stdout);
      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      self.postMessage({
        success: true,
        logs: parsed.ok ? String(parsed.value.logs ?? stdout) : stdout + (stderr ? `\n${stderr}` : ''),
        result: parsed.ok ? (parsed.value.result ?? null) : null,
        executionTime,
        requestId,
      });
      return;
    }

    const results = [];
    for (const testCase of testCases) {
      try {
        const { stdout, stderr } = await runTest(testCase.input);
        const parsed = parseJsonFromOutput(stdout);
        const actual = parsed.ok ? parsed.value : stdout.trim();
        const expected = testCase.expected;
        const passed = parsed.ok
          ? stableStringify(actual) === stableStringify(expected)
          : String(actual) === String(expected);

        results.push({
          input: testCase.input,
          expected,
          actual,
          passed,
          logs: stderr || '',
        });
      } catch (error) {
        results.push({
          input: testCase.input,
          expected: testCase.expected,
          actual: null,
          passed: false,
          error: error?.message ?? String(error),
        });
      }
    }

    const endTime = performance.now();
    const executionTime = Math.round(endTime - startTime);

    self.postMessage({
      success: true,
      results,
      executionTime,
      requestId,
    });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error?.message ?? String(error),
      stack: error?.stack,
      requestId,
    });
  }
};
