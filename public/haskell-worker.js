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

importScripts('./wasi-utils.js');

let runtimeBytes = null;
let isReady = false;

// Built-in WASI stub so Haskell runtime exists by default.
// It prints a single JSON line:
//   {"logs":"Haskell runtime stub (replace runner.wasm)","result":null}\n
const EMBEDDED_WASI_STUB_WASM = new Uint8Array([
  // wasm header
  0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,
  // Type section
  0x01,0x10,0x03,
  0x60,0x04,0x7f,0x7f,0x7f,0x7f,0x01,0x7f,
  0x60,0x01,0x7f,0x00,
  0x60,0x00,0x00,
  // Import section
  0x02,0x46,0x02,
  0x16,
  0x77,0x61,0x73,0x69,0x5f,0x73,0x6e,0x61,0x70,0x73,0x68,0x6f,0x74,0x5f,0x70,0x72,0x65,0x76,0x69,0x65,0x77,0x31,
  0x08,0x66,0x64,0x5f,0x77,0x72,0x69,0x74,0x65,
  0x00,0x00,
  0x16,
  0x77,0x61,0x73,0x69,0x5f,0x73,0x6e,0x61,0x70,0x73,0x68,0x6f,0x74,0x5f,0x70,0x72,0x65,0x76,0x69,0x65,0x77,0x31,
  0x09,0x70,0x72,0x6f,0x63,0x5f,0x65,0x78,0x69,0x74,
  0x00,0x01,
  // Function section
  0x03,0x02,0x01,0x02,
  // Memory section
  0x05,0x03,0x01,0x00,0x01,
  // Export section
  0x07,0x15,0x02,
  0x06,0x6d,0x65,0x6d,0x6f,0x72,0x79,0x02,0x00,
  0x06,0x5f,0x73,0x74,0x61,0x72,0x74,0x00,0x02,
  // Start section
  0x08,0x01,0x02,
  // Code section
  0x0a,0x22,0x01,
  0x20,0x00,
  0x41,0x08,
  0x41,0x80,0x08,
  0x36,0x02,0x00,
  0x41,0x0c,
  0x41,0x44,
  0x36,0x02,0x00,
  0x41,0x01,
  0x41,0x08,
  0x41,0x01,
  0x41,0x00,
  0x10,0x00,
  0x1a,
  0x41,0x00,
  0x10,0x01,
  0x0b,
  // Data section
  0x0b,0x4b,0x01,
  0x00,
  0x41,0x80,0x08,0x0b,
  0x44,
  // {"logs":"Haskell runtime stub (replace runner.wasm)","result":null}\n
  0x7b,0x22,0x6c,0x6f,0x67,0x73,0x22,0x3a,0x22,
  0x48,0x61,0x73,0x6b,0x65,0x6c,0x6c,0x20,0x72,0x75,0x6e,0x74,0x69,0x6d,0x65,0x20,0x73,0x74,0x75,0x62,0x20,0x28,0x72,0x65,0x70,0x6c,0x61,0x63,0x65,0x20,0x72,0x75,0x6e,0x6e,0x65,0x72,0x2e,0x77,0x61,0x73,0x6d,0x29,
  0x22,0x2c,0x22,0x72,0x65,0x73,0x75,0x6c,0x74,0x22,0x3a,0x6e,0x75,0x6c,0x6c,0x7d,0x0a,
]);

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
      const { stdout, stderr } = await runWasiModule(wasmBytes, stdin, { runtimeName: 'Haskell' });

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
        const { stdout, stderr } = await runWasiModule(wasmBytes, stdin, { runtimeName: 'Haskell' });

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
