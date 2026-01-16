// Haskell runtime worker (WASM + minimal WASI)
//
// This worker expects a WASI-compatible WebAssembly module at:
//   public/haskell/runner.wasm
//
// Protocol
// --------
// We feed the WASM module a single JSON document on stdin:
//   { "mode": "executor"|"test", "code": string, "input"?: any }
//
// And expect a single JSON document on stdout:
//   { "logs"?: string, "result"?: any }
//
// If stdout is not valid JSON, we treat it as logs.

importScripts('./worker-utils.js');

let runtimeBytes = null;
let isReady = false;

// Built-in WASI stub so Haskell runtime exists by default.
// This minimal module simply exits successfully without output.
const EMBEDDED_WASI_STUB_WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,8,2,96,1,127,0,96,0,0,2,36,1,22,119,97,115,105,95,115,110,97,112,115,104,111,116,95,112,114,101,118,105,101,119,49,9,112,114,111,99,95,101,120,105,116,0,0,3,2,1,1,5,3,1,0,1,7,19,2,6,109,101,109,111,114,121,2,0,6,95,115,116,97,114,116,0,1,10,8,1,6,0,65,0,16,0,11,
]);

class WasiExit extends Error {
  constructor(code) {
    super(`WASI exit: ${code}`);
    this.name = 'WasiExit';
    this.code = code;
  }
}

function getBaseURL() {
  // Worker URL is something like .../haskell-worker.js
  // We want the directory it lives in.
  return self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/');
}

async function loadRuntimeWasm() {
  if (runtimeBytes) return runtimeBytes;

  const baseURL = getBaseURL();
  const wasmUrl = baseURL + 'haskell/runner.wasm';

  try {
    const res = await fetch(wasmUrl);
    if (res.ok) {
      runtimeBytes = await res.arrayBuffer();
      return runtimeBytes;
    }
    // If not found, fall back to embedded stub.
    runtimeBytes = EMBEDDED_WASI_STUB_WASM.buffer;
    return runtimeBytes;
  } catch {
    // Offline or fetch blocked -> embedded stub.
    runtimeBytes = EMBEDDED_WASI_STUB_WASM.buffer;
    return runtimeBytes;
  }
}

function textEncode(s) {
  return new TextEncoder().encode(s);
}

function textDecode(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

// Minimal WASI preview1 implementation sufficient for simple stdin/stdout programs.
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

  function refreshViewsIfNeeded() {
    // Memory can grow; refresh views if buffer changed.
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
    // little-endian u64
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
    // Writes an array of pointers followed by nul-terminated strings.
    // Returns total bytes written to string buffer.
    let offset = 0;
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      const bytes = textEncode(s);
      writeU32(ptrsPtr + i * 4, bufPtr + offset);
      u8.set(bytes, bufPtr + offset);
      u8[bufPtr + offset + bytes.length] = 0;
      offset += bytes.length + 1;
    }
    return offset;
  }

  const WASI_ESUCCESS = 0;
  const WASI_EBADF = 8;
  const WASI_ENOSYS = 52;

  const wasiImport = {
    // args
    args_sizes_get(argcPtr, argvBufSizePtr) {
      refreshViewsIfNeeded();
      const strings = args;
      let bufSize = 0;
      for (const s of strings) bufSize += textEncode(s).length + 1;
      writeU32(argcPtr, strings.length);
      writeU32(argvBufSizePtr, bufSize);
      return WASI_ESUCCESS;
    },
    args_get(argvPtr, argvBufPtr) {
      refreshViewsIfNeeded();
      writeBuffers(argvPtr, argvBufPtr, args);
      return WASI_ESUCCESS;
    },

    // environ
    environ_sizes_get(envcPtr, envBufSizePtr) {
      refreshViewsIfNeeded();
      let bufSize = 0;
      for (const s of envPairs) bufSize += textEncode(s).length + 1;
      writeU32(envcPtr, envPairs.length);
      writeU32(envBufSizePtr, bufSize);
      return WASI_ESUCCESS;
    },
    environ_get(envPtr, envBufPtr) {
      refreshViewsIfNeeded();
      writeBuffers(envPtr, envBufPtr, envPairs);
      return WASI_ESUCCESS;
    },

    // stdio
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      refreshViewsIfNeeded();
      const iovs = readIovs(iovsPtr, iovsLen);
      let written = 0;
      const chunks = fd === 2 ? stderrChunks : stdoutChunks;

      for (const { bufPtr, bufLen } of iovs) {
        const slice = u8.slice(bufPtr, bufPtr + bufLen);
        chunks.push(slice);
        written += bufLen;
      }

      writeU32(nwrittenPtr, written);
      return WASI_ESUCCESS;
    },

    fd_read(fd, iovsPtr, iovsLen, nreadPtr) {
      refreshViewsIfNeeded();
      if (fd !== 0) {
        writeU32(nreadPtr, 0);
        return WASI_EBADF;
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
      return WASI_ESUCCESS;
    },

    fd_close(_fd) {
      return WASI_ESUCCESS;
    },

    // time/random
    random_get(bufPtr, bufLen) {
      refreshViewsIfNeeded();
      const out = u8.subarray(bufPtr, bufPtr + bufLen);
      crypto.getRandomValues(out);
      return WASI_ESUCCESS;
    },

    clock_time_get(_clockId, _precision, timePtr) {
      refreshViewsIfNeeded();
      // nanoseconds since epoch
      const ns = BigInt(Date.now()) * 1000000n;
      writeU64(timePtr, ns);
      return WASI_ESUCCESS;
    },

    sched_yield() {
      return WASI_ESUCCESS;
    },

    proc_exit(code) {
      throw new WasiExit(code >>> 0);
    },

    // Many runtimes probe these; provide benign stubs.
    fd_fdstat_get(_fd, _statPtr) {
      refreshViewsIfNeeded();
      // Not implemented; return ENOSYS so the runtime can fallback.
      return WASI_ENOSYS;
    },

    fd_seek(_fd, _offsetLo, _offsetHi, _whence, _newOffsetPtr) {
      return WASI_ENOSYS;
    },

    path_open() {
      return WASI_ENOSYS;
    },

    fd_prestat_get() {
      return WASI_ENOSYS;
    },

    fd_prestat_dir_name() {
      return WASI_ENOSYS;
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

async function runWasiModule(wasmBytes, stdinText) {
  const wasi = makeWasi({ args: ['runner.wasm'], env: {}, stdinText });

  const mod = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(mod, wasi.imports);

  const memory = instance.exports.memory;
  if (!memory) throw new Error('WASM module has no exported memory');
  wasi.setMemory(memory);

  // Start function naming varies.
  const start = instance.exports._start || instance.exports.__wasi_unstable_reactor_start || instance.exports.main;
  if (typeof start !== 'function') {
    throw new Error('WASM module does not export _start/main');
  }

  try {
    start();
  } catch (err) {
    if (!(err instanceof WasiExit)) throw err;
    // exit code 0 -> normal
    if (err.code !== 0) {
      const stderr = wasi.getStderrText();
      const extra = stderr ? `\n${stderr}` : '';
      throw new Error(`Haskell runtime exited with code ${err.code}.${extra}`);
    }
  }

  return {
    stdout: wasi.getStdoutText(),
    stderr: wasi.getStderrText(),
  };
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

self.onmessage = async (e) => {
  const { type, requestId, code, testCases, executorMode } = e.data;

  if (type === 'preload') {
    try {
      await loadRuntimeWasm();
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
    const wasmBytes = await loadRuntimeWasm();
    if (!isReady) {
      isReady = true;
      self.postMessage({ type: 'ready' });
    }

    if (executorMode) {
      const payload = { mode: 'executor', code };
      const stdin = JSON.stringify(payload);
      const { stdout, stderr } = await runWasiModule(wasmBytes, stdin);

      const parsed = tryParseJson(stdout.trim());
      const logs = parsed.ok ? String(parsed.value.logs ?? '') : stdout + (stderr ? `\n${stderr}` : '');
      const result = parsed.ok ? (parsed.value.result ?? null) : null;

      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      self.postMessage({
        success: true,
        logs,
        result,
        executionTime,
        requestId,
      });
      return;
    }

    const results = [];
    for (const testCase of testCases) {
      try {
        const payload = { mode: 'test', code, input: testCase.input };
        const stdin = JSON.stringify(payload);
        const { stdout, stderr } = await runWasiModule(wasmBytes, stdin);

        const parsed = tryParseJson(stdout.trim());
        if (!parsed.ok) {
          throw new Error(`Runtime did not return JSON. stdout: ${stdout}${stderr ? `\nstderr: ${stderr}` : ''}`);
        }

        const actual = parsed.value.result;
        const expected = testCase.expected;
        const passed = stableStringify(actual) === stableStringify(expected);

        results.push({
          input: testCase.input,
          expected,
          actual,
          passed,
          logs: String(parsed.value.logs ?? ''),
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
