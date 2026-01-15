// Generic WASM/WASI runtime worker.
//
// Supports:
// - language: "wasm" -> run a plain WebAssembly module export (no WASI).
// - language: "wasi" -> run a WASI module with stdin/stdout JSON contract.

let isReady = false;
const runtimeCache = new Map();

class WasiExit extends Error {
  constructor(code) {
    super(`WASI exit: ${code}`);
    this.name = 'WasiExit';
    this.code = code;
  }
}

// Stable JSON stringification for deterministic equality checks.
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

function getBaseURL() {
  return self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/');
}

function resolveURL(maybePath) {
  if (!maybePath) return null;
  if (/^[a-z]+:\/\//i.test(maybePath) || maybePath.startsWith('data:')) {
    return maybePath;
  }
  return new URL(maybePath, getBaseURL()).toString();
}

function base64ToBytes(base64) {
  const normalized = base64.trim();
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadBytes({ cacheKey, moduleBase64, modulePath }) {
  if (runtimeCache.has(cacheKey)) return runtimeCache.get(cacheKey);

  let bytes;
  if (moduleBase64) {
    bytes = base64ToBytes(moduleBase64).buffer;
  } else if (modulePath) {
    const url = resolveURL(modulePath);
    if (!url) throw new Error('Missing module path');
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`WASM module not found (${res.status}). Expected: ${url}`);
    }
    bytes = await res.arrayBuffer();
  } else {
    throw new Error('Missing module path or base64 payload');
  }

  runtimeCache.set(cacheKey, bytes);
  return bytes;
}

function makeCacheKey({ moduleBase64, modulePath }) {
  if (moduleBase64) {
    return `base64:${moduleBase64.length}:${moduleBase64.slice(0, 64)}`;
  }
  return `path:${modulePath ?? ''}`;
}

function textEncode(s) {
  return new TextEncoder().encode(s);
}

function textDecode(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function concatChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function makeWasi({ args = [], env = {}, stdinText = '' }) {
  const envPairs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  const stdinBytes = textEncode(stdinText);
  let stdinOffset = 0;

  const stdoutChunks = [];
  const stderrChunks = [];

  let memory = null;
  let view = null;
  let u8 = null;

  function setMemory(mem) {
    memory = mem;
    view = new DataView(memory.buffer);
    u8 = new Uint8Array(memory.buffer);
  }

  function refresh() {
    if (!memory) return;
    if (view.buffer !== memory.buffer) {
      view = new DataView(memory.buffer);
      u8 = new Uint8Array(memory.buffer);
    }
  }

  function writeU32(ptr, value) {
    view.setUint32(ptr, value >>> 0, true);
  }

  function writeU64(ptr, valueBigInt) {
    const lo = Number(valueBigInt & 0xffffffffn);
    const hi = Number((valueBigInt >> 32n) & 0xffffffffn);
    view.setUint32(ptr, lo >>> 0, true);
    view.setUint32(ptr + 4, hi >>> 0, true);
  }

  function readU32(ptr) {
    return view.getUint32(ptr, true);
  }

  function readIovs(iovsPtr, iovsLen) {
    const iovs = [];
    for (let i = 0; i < iovsLen; i++) {
      const base = iovsPtr + i * 8;
      const bufPtr = readU32(base);
      const bufLen = readU32(base + 4);
      iovs.push({ bufPtr, bufLen });
    }
    return iovs;
  }

  function writeBuffers(ptrsPtr, bufPtr, strings) {
    let offset = 0;
    for (let i = 0; i < strings.length; i++) {
      const bytes = textEncode(strings[i]);
      writeU32(ptrsPtr + i * 4, bufPtr + offset);
      u8.set(bytes, bufPtr + offset);
      u8[bufPtr + offset + bytes.length] = 0;
      offset += bytes.length + 1;
    }
    return offset;
  }

  const ESUCCESS = 0;
  const EBADF = 8;
  const ENOSYS = 52;

  const wasiImport = {
    args_sizes_get(argcPtr, argvBufSizePtr) {
      refresh();
      let bufSize = 0;
      for (const s of args) bufSize += textEncode(s).length + 1;
      writeU32(argcPtr, args.length);
      writeU32(argvBufSizePtr, bufSize);
      return ESUCCESS;
    },
    args_get(argvPtr, argvBufPtr) {
      refresh();
      writeBuffers(argvPtr, argvBufPtr, args);
      return ESUCCESS;
    },
    environ_sizes_get(envcPtr, envBufSizePtr) {
      refresh();
      let bufSize = 0;
      for (const s of envPairs) bufSize += textEncode(s).length + 1;
      writeU32(envcPtr, envPairs.length);
      writeU32(envBufSizePtr, bufSize);
      return ESUCCESS;
    },
    environ_get(envPtr, envBufPtr) {
      refresh();
      writeBuffers(envPtr, envBufPtr, envPairs);
      return ESUCCESS;
    },
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      refresh();
      const iovs = readIovs(iovsPtr, iovsLen);
      let written = 0;
      const chunks = fd === 2 ? stderrChunks : stdoutChunks;
      for (const { bufPtr, bufLen } of iovs) {
        const slice = u8.slice(bufPtr, bufPtr + bufLen);
        chunks.push(slice);
        written += bufLen;
      }
      writeU32(nwrittenPtr, written);
      return ESUCCESS;
    },
    fd_read(fd, iovsPtr, iovsLen, nreadPtr) {
      refresh();
      if (fd !== 0) {
        writeU32(nreadPtr, 0);
        return EBADF;
      }
      const iovs = readIovs(iovsPtr, iovsLen);
      let total = 0;
      for (const { bufPtr, bufLen } of iovs) {
        if (stdinOffset >= stdinBytes.length) break;
        const remaining = stdinBytes.length - stdinOffset;
        const toCopy = Math.min(bufLen, remaining);
        u8.set(stdinBytes.subarray(stdinOffset, stdinOffset + toCopy), bufPtr);
        stdinOffset += toCopy;
        total += toCopy;
        if (toCopy < bufLen) break;
      }
      writeU32(nreadPtr, total);
      return ESUCCESS;
    },
    fd_close(_fd) {
      return ESUCCESS;
    },
    random_get(bufPtr, bufLen) {
      refresh();
      const out = u8.subarray(bufPtr, bufPtr + bufLen);
      crypto.getRandomValues(out);
      return ESUCCESS;
    },
    clock_time_get(_clockId, _precision, timePtr) {
      refresh();
      const ns = BigInt(Date.now()) * 1000000n;
      writeU64(timePtr, ns);
      return ESUCCESS;
    },
    sched_yield() {
      return ESUCCESS;
    },
    proc_exit(code) {
      throw new WasiExit(code >>> 0);
    },
    fd_fdstat_get() {
      return ENOSYS;
    },
    fd_seek() {
      return ENOSYS;
    },
    path_open() {
      return ENOSYS;
    },
    fd_prestat_get() {
      return ENOSYS;
    },
    fd_prestat_dir_name() {
      return ENOSYS;
    },
  };

  return {
    imports: { wasi_snapshot_preview1: wasiImport },
    setMemory,
    getStdoutText() {
      const all = stdoutChunks.length ? concatChunks(stdoutChunks) : new Uint8Array();
      return textDecode(all);
    },
    getStderrText() {
      const all = stderrChunks.length ? concatChunks(stderrChunks) : new Uint8Array();
      return textDecode(all);
    },
  };
}

async function runWasiModule(wasmBytes, stdinText, args, env) {
  const wasi = makeWasi({ args, env, stdinText });

  const mod = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(mod, wasi.imports);

  const memory = instance.exports.memory;
  if (!memory) throw new Error('WASM module has no exported memory');
  wasi.setMemory(memory);

  const start =
    instance.exports._start || instance.exports.__wasi_unstable_reactor_start || instance.exports.main;
  if (typeof start !== 'function') throw new Error('WASM module does not export _start/main');

  try {
    start();
  } catch (err) {
    if (!(err instanceof WasiExit)) throw err;
    if (err.code !== 0) {
      const stderr = wasi.getStderrText();
      const extra = stderr ? `\n${stderr}` : '';
      throw new Error(`WASI runtime exited with code ${err.code}.${extra}`);
    }
  }

  return { stdout: wasi.getStdoutText(), stderr: wasi.getStderrText() };
}

async function runPlainWasmModule(wasmBytes, entryName, args) {
  const logs = [];
  let memory = null;

  const importObject = {
    env: {
      log(ptr, len) {
        if (!memory) return;
        const slice = new Uint8Array(memory.buffer, ptr, len);
        logs.push(textDecode(slice));
      },
    },
  };

  const mod = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(mod, importObject);
  if (instance.exports.memory instanceof WebAssembly.Memory) {
    memory = instance.exports.memory;
  }

  const entry =
    (entryName && instance.exports[entryName]) ||
    instance.exports.run ||
    instance.exports.main ||
    instance.exports._start;

  if (typeof entry !== 'function') {
    throw new Error('WASM module missing entry export');
  }

  const result = entry(...args);
  return { result, logs };
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function parseJsonConfig(raw, label) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    throw new Error(`${label} config is empty. Provide JSON with module/runtime details.`);
  }
  return JSON.parse(trimmed);
}

function normalizeWasmArgs(input) {
  if (input === undefined || input === null) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr.map((value) => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`WASM input must be a finite number, got: ${value}`);
      }
      return value;
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    throw new Error('WASM input must be number/boolean or an array of them');
  });
}

function normalizeWasmResult(value) {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function buildWasiStdin(config, executorMode, input) {
  if (config.stdin !== undefined && config.stdin !== null) {
    if (typeof config.stdin === 'string') {
      if (!executorMode && config.stdin.includes('{{input}}')) {
        return config.stdin.replace('{{input}}', JSON.stringify(input ?? null));
      }
      return config.stdin;
    }
    return JSON.stringify(config.stdin);
  }

  if (typeof config.code === 'string') {
    const payload = executorMode
      ? { mode: 'executor', code: config.code }
      : { mode: 'test', code: config.code, input };
    return JSON.stringify(payload);
  }

  if (!executorMode && input !== undefined) {
    return JSON.stringify(input);
  }

  return '';
}

async function handleWasiExecution({ code, testCases, executorMode }) {
  const config = parseJsonConfig(code, 'WASI');
  const runtime = config.runtime || config.module;
  const runtimeBase64 = config.runtimeBase64 || config.moduleBase64;

  const cacheKey = makeCacheKey({ moduleBase64: runtimeBase64, modulePath: runtime });
  const wasmBytes = await loadBytes({
    cacheKey,
    moduleBase64: runtimeBase64,
    modulePath: runtime,
  });

  const args = Array.isArray(config.args) ? config.args.map(String) : ['runner.wasm'];
  const env = config.env && typeof config.env === 'object' ? config.env : {};

  if (executorMode) {
    const stdin = buildWasiStdin(config, true, null);
    const { stdout, stderr } = await runWasiModule(wasmBytes, stdin, args, env);
    return { stdout, stderr };
  }

  const results = [];
  for (const testCase of testCases) {
    try {
      const stdin = buildWasiStdin(config, false, testCase.input);
      const { stdout, stderr } = await runWasiModule(wasmBytes, stdin, args, env);
      const parsed = tryParseJson(stdout.trim());
      if (parsed.ok && parsed.value?.error) {
        throw new Error(String(parsed.value.error));
      }
      const actual = parsed.ok ? parsed.value?.result : stdout;
      const logs = parsed.ok ? String(parsed.value?.logs ?? '') : stdout + (stderr ? `\n${stderr}` : '');
      const passed = stableStringify(actual) === stableStringify(testCase.expected);
      results.push({ input: testCase.input, expected: testCase.expected, actual, passed, logs });
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
  return { results };
}

async function handleWasmExecution({ code, testCases, executorMode }) {
  const config = parseJsonConfig(code, 'WASM');
  const modulePath = config.module || config.runtime;
  const moduleBase64 = config.moduleBase64 || config.runtimeBase64;
  const entry = typeof config.entry === 'string' ? config.entry : null;

  const cacheKey = makeCacheKey({ moduleBase64, modulePath });
  const wasmBytes = await loadBytes({
    cacheKey,
    moduleBase64,
    modulePath,
  });

  if (executorMode) {
    const executorArgs = normalizeWasmArgs(config.args ?? config.input);
    const { result, logs } = await runPlainWasmModule(wasmBytes, entry, executorArgs);
    return { result: normalizeWasmResult(result), logs: logs.join('\n') };
  }

  const results = [];
  for (const testCase of testCases) {
    try {
      const args = normalizeWasmArgs(testCase.input);
      const { result, logs } = await runPlainWasmModule(wasmBytes, entry, args);
      const actual = normalizeWasmResult(result);
      const passed = stableStringify(actual) === stableStringify(testCase.expected);
      results.push({
        input: testCase.input,
        expected: testCase.expected,
        actual,
        passed,
        logs: logs.join('\n'),
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
  return { results };
}

self.onmessage = async (e) => {
  const { type, requestId, code, testCases = [], executorMode, language } = e.data;

  if (type === 'preload') {
    if (!isReady) isReady = true;
    self.postMessage({ type: 'ready', requestId });
    return;
  }

  const startTime = performance.now();

  try {
    if (!isReady) {
      isReady = true;
      self.postMessage({ type: 'ready' });
    }

    if (language === 'wasi') {
      const result = await handleWasiExecution({ code, testCases, executorMode });
      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      if (executorMode) {
        const stdout = result.stdout ?? '';
        const stderr = result.stderr ?? '';
        const parsed = tryParseJson(stdout.trim());
        const logs = parsed.ok ? String(parsed.value?.logs ?? '') : stdout + (stderr ? `\n${stderr}` : '');
        const outputResult = parsed.ok ? parsed.value?.result ?? null : null;
        const error = parsed.ok ? parsed.value?.error ?? null : null;

        if (error) {
          self.postMessage({ success: false, error: String(error), stack: stderr || '', requestId });
          return;
        }

        self.postMessage({
          success: true,
          logs,
          result: outputResult,
          executionTime,
          requestId,
        });
        return;
      }

      self.postMessage({
        success: true,
        results: result.results,
        executionTime,
        requestId,
      });
      return;
    }

    if (language === 'wasm') {
      const result = await handleWasmExecution({ code, testCases, executorMode });
      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      if (executorMode) {
        self.postMessage({
          success: true,
          logs: result.logs || '',
          result: result.result ?? null,
          executionTime,
          requestId,
        });
        return;
      }

      self.postMessage({
        success: true,
        results: result.results,
        executionTime,
        requestId,
      });
      return;
    }

    throw new Error(`Unsupported language: ${language}`);
  } catch (error) {
    self.postMessage({
      success: false,
      error: error?.message ?? String(error),
      stack: error?.stack,
      requestId,
    });
  }
};
