// Racket runtime worker (official interpreter via Emscripten)
//
// This worker expects an Emscripten build under:
//   public/racket/racket.js
//   public/racket/racket.wasm
//
// Protocol:
// - For executor mode, we run the code and return logs (result = null).
// - For test mode, we wrap code to call (solution input) and print JSON.

let isReady = false;
let modulePromise = null;

async function loadRacketModule() {
  if (modulePromise) return modulePromise;

  modulePromise = new Promise((resolve, reject) => {
    const moduleConfig = {
      noInitialRun: true,
      print: () => {},
      printErr: () => {},
      onRuntimeInitialized() {
        resolve(self.Module);
      },
    };

    self.Module = moduleConfig;

    try {
      importScripts('./racket/racket.js');

      if (typeof self.Module === 'function') {
        const factory = self.Module;
        factory(moduleConfig)
          .then((instance) => resolve(instance))
          .catch(reject);
      }
    } catch (err) {
      reject(err);
    }
  });

  return modulePromise;
}

async function runRacketProgram(module, program) {
  if (!module.FS || typeof module.callMain !== 'function') {
    throw new Error('Racket runtime missing FS/callMain (check Emscripten build flags)');
  }

  const outputs = [];
  const errors = [];
  module.print = (text) => outputs.push(String(text));
  module.printErr = (text) => errors.push(String(text));

  const programPath = `/tmp/run-${Date.now()}-${Math.floor(Math.random() * 1e9)}.rkt`;
  module.FS.writeFile(programPath, program);

  try {
    module.callMain([programPath]);
  } finally {
    try {
      module.FS.unlink(programPath);
    } catch {
      // ignore
    }
  }

  return {
    stdout: outputs.join('\n'),
    stderr: errors.join('\n'),
  };
}

function buildExecutorProgram(code) {
  return `#lang racket
(require json)

(define __log-port (open-output-string))
(define __result
  (with-handlers ([exn:fail? (lambda (e) e)])
    (parameterize ([current-output-port __log-port]
                   [current-error-port __log-port])
      ${code}
      (void))))

(define __logs (get-output-string __log-port))
(define __payload
  (hash 'logs __logs
        'result (if (exn:fail? __result) null __result)
        'error (and (exn:fail? __result) (exn-message __result))))
(displayln (jsexpr->string __payload))
`;
}

function buildTestProgram(code, inputExpr) {
  return `#lang racket
(require json)

(define __log-port (open-output-string))
(define __payload
  (with-handlers ([exn:fail?
                   (lambda (e)
                     (hash 'logs (get-output-string __log-port)
                           'result null
                           'error (exn-message e)))])
    (parameterize ([current-output-port __log-port]
                   [current-error-port __log-port])
      ${code}
      (define __result (solution ${inputExpr}))
      (hash 'logs (get-output-string __log-port)
            'result __result))))

(displayln (jsexpr->string __payload))
`;
}

self.onmessage = async (e) => {
  const { type, requestId, code, testCases, executorMode } = e.data;

  if (type === 'preload') {
    try {
      await loadRacketModule();
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
    const module = await loadRacketModule();
    if (!isReady) {
      isReady = true;
      self.postMessage({ type: 'ready' });
    }

    if (executorMode) {
      const program = buildExecutorProgram(code);
      const { stdout, stderr } = await runRacketProgram(module, program);
      const parsed = tryParseJson(stdout.trim());

      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      if (parsed.ok) {
        self.postMessage({
          success: parsed.value.error ? false : true,
          logs: String(parsed.value.logs ?? '') + (stderr ? `\n${stderr}` : ''),
          result: parsed.value.result ?? null,
          error: parsed.value.error ?? undefined,
          executionTime,
          requestId,
        });
      } else {
        self.postMessage({
          success: true,
          logs: stdout + (stderr ? `\n${stderr}` : ''),
          result: null,
          executionTime,
          requestId,
        });
      }
      return;
    }

    const results = [];
    for (const testCase of testCases) {
      try {
        const inputExpr = jsToRacketExpr(testCase.input);
        const program = buildTestProgram(code, inputExpr);
        const { stdout, stderr } = await runRacketProgram(module, program);

        const parsed = tryParseJson(stdout.trim());
        if (!parsed.ok) {
          throw new Error(`Runtime did not return JSON. stdout: ${stdout}${stderr ? `\nstderr: ${stderr}` : ''}`);
        }

        if (parsed.value.error) {
          throw new Error(parsed.value.error);
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

function jsToRacketExpr(value) {
  if (value === null || value === undefined) return "'()";
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number is not supported');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '#t' : '#f';
  if (typeof value === 'string') return `"${escapeRacketString(value)}"`;
  if (Array.isArray(value)) {
    return `(list ${value.map(jsToRacketExpr).join(' ')})`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const parts = [];
    for (const [k, v] of entries) {
      if (!isValidSymbolName(k)) {
        parts.push(`"${escapeRacketString(k)}"`, jsToRacketExpr(v));
      } else {
        parts.push(`'${k}`, jsToRacketExpr(v));
      }
    }
    return `(hash ${parts.join(' ')})`;
  }
  throw new Error(`Unsupported input type: ${typeof value}`);
}

function isValidSymbolName(name) {
  return /^[A-Za-z_+\-*/?<>=!$%&^~][A-Za-z0-9_+\-*/?<>=!$%&^~]*$/.test(name);
}

function escapeRacketString(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}
