// RustPython runtime worker (WASM + minimal WASI)
//
// Loads public/rustpython/runner.wasm produced by `pnpm run build:runtimes`.
// Protocol: stdin JSON {mode, code, input?} -> stdout JSON {logs, result, error?}

let runtimeBytes = null;
let isReady = false;

class WasiExit extends Error {
  constructor(code) {
    super(`WASI exit: ${code}`);
    this.name = 'WasiExit';
    this.code = code;
  }
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

function getBaseURL() {
  return self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/');
}

async function loadRuntimeWasm() {
  if (runtimeBytes) return runtimeBytes;

  const baseURL = getBaseURL();
  const wasmUrl = baseURL + 'rustpython/runner.wasm';
  const res = await fetch(wasmUrl);
  if (!res.ok) {
    throw new Error(
      `RustPython runtime not found (${res.status}). Expected: ${wasmUrl}. ` +
        `Run: pnpm run build:runtimes`,
    );
  }
  runtimeBytes = await res.arrayBuffer();
  return runtimeBytes;
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

async function runWasiModule(wasmBytes, stdinText) {
  const wasi = makeWasi({ args: ['runner.wasm'], env: {}, stdinText });

  const mod = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(mod, wasi.imports);

  const memory = instance.exports.memory;
  if (!memory) throw new Error('WASM module has no exported memory');
  wasi.setMemory(memory);

  const start = instance.exports._start || instance.exports.main;
  if (typeof start !== 'function') throw new Error('WASM module does not export _start/main');

  try {
    start();
  } catch (err) {
    if (!(err instanceof WasiExit)) throw err;
    if (err.code !== 0) {
      const stderr = wasi.getStderrText();
      const extra = stderr ? `\n${stderr}` : '';
      throw new Error(`RustPython runtime exited with code ${err.code}.${extra}`);
    }
  }

  return { stdout: wasi.getStdoutText(), stderr: wasi.getStderrText() };
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
      self.postMessage({ success: false, error: error?.message ?? String(error), stack: error?.stack, requestId });
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
      const { stdout, stderr } = await runWasiModule(wasmBytes, JSON.stringify(payload));

      const parsed = tryParseJson(stdout.trim());
      const logs = parsed.ok ? String(parsed.value.logs ?? '') : stdout + (stderr ? `\n${stderr}` : '');
      const result = parsed.ok ? (parsed.value.result ?? null) : null;
      const error = parsed.ok ? (parsed.value.error ?? null) : null;

      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      if (error) {
        self.postMessage({ success: false, error: String(error), stack: stderr || '', requestId });
        return;
      }

      self.postMessage({ success: true, logs, result, executionTime, requestId });
      return;
    }

    const results = [];
    for (const testCase of testCases) {
      try {
        const payload = { mode: 'test', code, input: testCase.input };
        const { stdout, stderr } = await runWasiModule(wasmBytes, JSON.stringify(payload));
        const parsed = tryParseJson(stdout.trim());
        if (!parsed.ok) {
          throw new Error(`Runtime did not return JSON. stdout: ${stdout}${stderr ? `\nstderr: ${stderr}` : ''}`);
        }
        if (parsed.value.error) {
          throw new Error(String(parsed.value.error));
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
        results.push({ input: testCase.input, expected: testCase.expected, actual: null, passed: false, error: error?.message ?? String(error) });
      }
    }

    const endTime = performance.now();
    const executionTime = Math.round(endTime - startTime);
    self.postMessage({ success: true, results, executionTime, requestId });
  } catch (error) {
    self.postMessage({ success: false, error: error?.message ?? String(error), stack: error?.stack, requestId });
  }
};
