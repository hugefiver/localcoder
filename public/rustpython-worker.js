// RustPython runtime worker (WASM + minimal WASI)
//
// Loads public/rustpython/runner.wasm produced by `pnpm run build:runtimes`.
// Protocol: stdin JSON {mode, code, input?} -> stdout JSON {logs, result, error?}

importScripts('./wasi-utils.js');

let runtimeBytes = null;
let isReady = false;

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
      const { stdout, stderr } = await runWasiModule(wasmBytes, JSON.stringify(payload), { runtimeName: 'RustPython' });

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
        const { stdout, stderr } = await runWasiModule(wasmBytes, JSON.stringify(payload), { runtimeName: 'RustPython' });
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
