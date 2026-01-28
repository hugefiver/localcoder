// Shared WASI utility functions for workers
//
// This module provides a minimal WASI preview1 implementation sufficient for
// simple stdin/stdout programs. Used by rustpython-worker.js and haskell-worker.js.

/**
 * Error class for WASI process exit
 */
class WasiExit extends Error {
  constructor(code) {
    super(`WASI exit: ${code}`);
    this.name = 'WasiExit';
    this.code = code;
  }
}

/**
 * Stable JSON stringify with sorted object keys for consistent comparison
 */
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

/**
 * Get the base URL for the worker's location
 */
function getBaseURL() {
  return self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/');
}

/**
 * Encode a string to UTF-8 bytes
 */
function textEncode(s) {
  return new TextEncoder().encode(s);
}

/**
 * Decode UTF-8 bytes to a string
 */
function textDecode(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Concatenate multiple Uint8Array chunks into a single Uint8Array
 */
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

/**
 * Create a minimal WASI preview1 implementation
 * 
 * @param {Object} options
 * @param {string[]} options.args - Command line arguments
 * @param {Object} options.env - Environment variables
 * @param {string} options.stdinText - Text to provide on stdin
 * @returns {Object} WASI implementation with imports, setMemory, getStdoutText, getStderrText
 */
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

/**
 * Run a WASI module with the given stdin text
 * 
 * @param {ArrayBuffer} wasmBytes - The WebAssembly module bytes
 * @param {string} stdinText - Text to provide on stdin
 * @param {Object} options - Additional options
 * @param {string} options.runtimeName - Name of the runtime for error messages
 * @param {string[]} options.args - Command line arguments for the WASI program
 * @param {Object} options.env - Environment variables for the WASI program
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function runWasiModule(wasmBytes, stdinText, options = {}) {
  const runtimeName = options.runtimeName || 'WASI';
  const args = Array.isArray(options.args) ? options.args : ['runner.wasm'];
  const env = options.env && typeof options.env === 'object' ? options.env : {};
  const wasi = makeWasi({ args, env, stdinText });

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
      throw new Error(`${runtimeName} runtime exited with code ${err.code}.${extra}`);
    }
  }

  return {
    stdout: wasi.getStdoutText(),
    stderr: wasi.getStderrText(),
  };
}

/**
 * Try to parse JSON, returning success status and parsed value
 */
function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

// Export utilities for use by workers via importScripts
// Note: In worker context, these become global when imported via importScripts
if (typeof self !== 'undefined') {
  self.WasiExit = WasiExit;
  self.stableStringify = stableStringify;
  self.getBaseURL = getBaseURL;
  self.textEncode = textEncode;
  self.textDecode = textDecode;
  self.concatChunks = concatChunks;
  self.makeWasi = makeWasi;
  self.runWasiModule = runWasiModule;
  self.tryParseJson = tryParseJson;
}
