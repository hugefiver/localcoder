var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);

// src/domain/json-value.ts
var MAX_ISSUES = 8;
var IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function addIssue(issues, code, path, message) {
  if (issues.length < MAX_ISSUES) issues.push({ code, path, message });
}
function propertyPath(path, key) {
  return IDENTIFIER_KEY.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}
function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isArrayIndex(key, length) {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}
function enqueueArray(value, path, tasks, ancestors, issues) {
  const ownKeys = Reflect.ownKeys(value);
  const keys = Object.keys(value);
  const hasOnlyIndexes = ownKeys.every((key) => key === "length" || typeof key === "string" && isArrayIndex(key, value.length));
  if (!hasOnlyIndexes || keys.length !== value.length) {
    addIssue(issues, "unsupported-type", path, "JSON arrays must be dense enumerable values");
    return;
  }
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor === void 0 || !("value" in descriptor);
  })) {
    addIssue(issues, "unsupported-type", path, "JSON array entries must be data values");
    return;
  }
  ancestors.add(value);
  tasks.push({ kind: "leave", value });
  for (let index = value.length - 1; index >= 0; index -= 1) {
    tasks.push({ kind: "visit", value: value[index], path: `${path}[${index}]` });
  }
}
function enqueueObject(value, path, tasks, ancestors, issues) {
  const ownKeys = Reflect.ownKeys(value);
  const keys = Object.keys(value);
  if (ownKeys.length !== keys.length) {
    addIssue(issues, "unsupported-type", path, "JSON objects require enumerable string properties");
    return;
  }
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor === void 0 || !("value" in descriptor);
  })) {
    addIssue(issues, "unsupported-type", path, "JSON object properties must be data values");
    return;
  }
  ancestors.add(value);
  tasks.push({ kind: "leave", value });
  for (const key of [...keys].reverse()) {
    tasks.push({ kind: "visit", value: value[key], path: propertyPath(path, key) });
  }
}
function visitValue(value, path, tasks, ancestors, issues) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) addIssue(issues, "non-finite-number", path, "JSON numbers must be finite");
    return;
  }
  if (typeof value !== "object") {
    addIssue(issues, "unsupported-type", path, `Unsupported JSON value type: ${typeof value}`);
    return;
  }
  if (ancestors.has(value)) {
    addIssue(issues, "cyclic-value", path, "JSON values cannot contain cycles");
    return;
  }
  if (Array.isArray(value)) {
    enqueueArray(value, path, tasks, ancestors, issues);
    return;
  }
  if (!isPlainObject(value)) {
    addIssue(issues, "unsupported-type", path, "JSON objects must use a plain object prototype");
    return;
  }
  enqueueObject(value, path, tasks, ancestors, issues);
}
function validateTree(value) {
  const ancestors = /* @__PURE__ */ new WeakSet();
  const issues = [];
  const tasks = [{ kind: "visit", value, path: "$" }];
  while (tasks.length > 0 && issues.length < MAX_ISSUES) {
    const task = tasks.pop();
    if (task === void 0) break;
    if (task.kind === "leave") ancestors.delete(task.value);
    else visitValue(task.value, task.path, tasks, ancestors, issues);
  }
  return issues;
}
function jsonByteLength(value) {
  const chunks = [];
  const tasks = [{ kind: "value", value }];
  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === void 0) break;
    if (task.kind === "text") {
      chunks.push(task.value);
    } else if (task.value === null) {
      chunks.push("null");
    } else if (typeof task.value === "string") {
      chunks.push(JSON.stringify(task.value));
    } else if (typeof task.value === "number" || typeof task.value === "boolean") {
      chunks.push(String(task.value));
    } else if (Array.isArray(task.value)) {
      tasks.push({ kind: "text", value: "]" });
      for (let index = task.value.length - 1; index >= 0; index -= 1) {
        tasks.push({ kind: "value", value: task.value[index] });
        if (index > 0) tasks.push({ kind: "text", value: "," });
      }
      tasks.push({ kind: "text", value: "[" });
    } else {
      const keys = Object.keys(task.value);
      tasks.push({ kind: "text", value: "}" });
      for (const key of [...keys].reverse()) {
        tasks.push({ kind: "value", value: task.value[key] });
        tasks.push({ kind: "text", value: ":" });
        tasks.push({ kind: "text", value: JSON.stringify(key) });
        if (key !== keys[0]) tasks.push({ kind: "text", value: "," });
      }
      tasks.push({ kind: "text", value: "{" });
    }
  }
  return new TextEncoder().encode(chunks.join("")).byteLength;
}
function validateJsonValue(value, limits) {
  const issues = validateTree(value);
  if (issues.length > 0) return { ok: false, issues };
  const canonical = value;
  const bytes = jsonByteLength(canonical);
  if (limits?.maxBytes !== void 0 && bytes > limits.maxBytes) {
    return {
      ok: false,
      issues: [{
        code: "byte-limit",
        path: "$",
        message: `JSON value is ${bytes} UTF-8 bytes, exceeding limit of ${limits.maxBytes} bytes`
      }]
    };
  }
  return { ok: true, value: canonical, bytes };
}
function assertJsonValue(value, label, limits) {
  const validation = validateJsonValue(value, limits);
  if (validation.ok) return validation.value;
  const diagnostic = validation.issues.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`).join("; ");
  throw new TypeError(`${label}: invalid canonical JSON value: ${diagnostic}`);
}

// src/domain/language.ts
var RUNTIME_IDS = [
  "javascript-worker",
  "typescript-official",
  "python-pyodide",
  "python-rustpython",
  "racket-wasm",
  "haskell-ghc-wasi"
];

// src/runtime/protocol.ts
var MAX_SOURCE_BYTES = 262144;
var MAX_CASE_COUNT = 100;
var MAX_OUTPUT_BYTES = 65536;
var textEncoder = new TextEncoder();
var MAX_REQUEST_ID_BYTES = 256;
var MAX_CASE_VALUE_BYTES = 65536;
function protocolError(path, message) {
  throw new TypeError(`Worker protocol at ${path}: ${message}`);
}
function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}
function propertyValue(record, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === void 0) protocolError(path, "is missing a required field");
  if (!("value" in descriptor)) protocolError(path, "must be a data property");
  return descriptor.value;
}
function assertExactFields(record, allowed, required, path) {
  const allowedFields = new Set(allowed);
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key !== "string" || !allowedFields.has(key))) {
    protocolError(path, "contains an unknown field");
  }
  for (const key of required) {
    if (!hasOwn(record, key)) protocolError(`${path}.${key}`, "is missing a required field");
  }
  for (const key of ownKeys) {
    if (typeof key !== "string") continue;
    propertyValue(record, key, `${path}.${key}`);
  }
}
function assertString(value, path, maxBytes, nonBlank = false) {
  if (typeof value !== "string") protocolError(path, "must be a string");
  const byteLength = textEncoder.encode(value).byteLength;
  if (byteLength > maxBytes) protocolError(path, `must not exceed ${maxBytes} UTF-8 bytes`);
  if (nonBlank && value.trim().length === 0) protocolError(path, "must be non-blank");
  return value;
}
function assertNonNegativeInteger(value, path, maximum) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    protocolError(path, `must be a non-negative integer no greater than ${maximum}`);
  }
  return value;
}
function parseEnvelope(record, path) {
  const protocolVersion = propertyValue(record, "protocolVersion", `${path}.protocolVersion`);
  if (protocolVersion !== 1) {
    if (typeof protocolVersion === "number" && Number.isSafeInteger(protocolVersion)) {
      protocolError(`${path}.protocolVersion`, `unsupported protocolVersion ${protocolVersion}`);
    }
    protocolError(`${path}.protocolVersion`, "unsupported protocolVersion");
  }
  const requestId = assertString(
    propertyValue(record, "requestId", `${path}.requestId`),
    `${path}.requestId`,
    MAX_REQUEST_ID_BYTES,
    true
  );
  const runtimeIdValue = propertyValue(record, "runtimeId", `${path}.runtimeId`);
  if (typeof runtimeIdValue !== "string" || !RUNTIME_IDS.includes(runtimeIdValue)) {
    protocolError(`${path}.runtimeId`, "must be a known runtimeId");
  }
  return { protocolVersion: 1, requestId, runtimeId: runtimeIdValue };
}
function parseJsonValue(value, path) {
  const validation = validateJsonValue(value, { maxBytes: MAX_CASE_VALUE_BYTES });
  if (!validation.ok) protocolError(path, "must be a canonical JSON value within 65536 UTF-8 bytes");
  return validation.value;
}
function parseJudgeCaseRequest(value, path) {
  if (!isPlainRecord(value)) protocolError(path, "must be an object");
  assertExactFields(value, ["index", "input"], ["index", "input"], path);
  return {
    index: assertNonNegativeInteger(propertyValue(value, "index", `${path}.index`), `${path}.index`, Number.MAX_SAFE_INTEGER),
    input: parseJsonValue(propertyValue(value, "input", `${path}.input`), `${path}.input`)
  };
}
function parseJudgeCases(value, path) {
  if (!Array.isArray(value) || value.length > MAX_CASE_COUNT) {
    protocolError(path, `must be an array with at most ${MAX_CASE_COUNT} cases`);
  }
  const indexes = /* @__PURE__ */ new Set();
  const cases = value.map((item, index) => {
    const parsed = parseJudgeCaseRequest(item, `${path}[${index}]`);
    if (indexes.has(parsed.index)) protocolError(`${path}[${index}].index`, "must be unique");
    indexes.add(parsed.index);
    return parsed;
  });
  return cases;
}
function parseWorkerRequest(input) {
  if (!isPlainRecord(input)) protocolError("$", "must be an object");
  const type = propertyValue(input, "type", "$.type");
  if (type === "initialize") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type"], ["protocolVersion", "requestId", "runtimeId", "type"], "$");
    return { ...parseEnvelope(input, "$"), type };
  }
  if (type === "execute") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type", "source"], ["protocolVersion", "requestId", "runtimeId", "type", "source"], "$");
    return {
      ...parseEnvelope(input, "$"),
      type,
      source: assertString(propertyValue(input, "source", "$.source"), "$.source", MAX_SOURCE_BYTES)
    };
  }
  if (type === "judge") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type", "source", "cases"], ["protocolVersion", "requestId", "runtimeId", "type", "source", "cases"], "$");
    return {
      ...parseEnvelope(input, "$"),
      type,
      source: assertString(propertyValue(input, "source", "$.source"), "$.source", MAX_SOURCE_BYTES),
      cases: parseJudgeCases(propertyValue(input, "cases", "$.cases"), "$.cases")
    };
  }
  if (type === "dispose") {
    assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type"], ["protocolVersion", "requestId", "runtimeId", "type"], "$");
    return { ...parseEnvelope(input, "$"), type };
  }
  protocolError("$.type", "unknown request type");
}

// src/workers/haskell/assets.ts
var GHC_WASM = ["haskell/ghc.wasm.gz.bin", "haskell/ghc.wasm"];
var GHCi_WASM = ["haskell/ghci.wasm.gz.bin", "haskell/ghci.wasm"];
var LIBDIR_TAR = ["haskell/libdir.tar.gz.bin", "haskell/libdir.tar"];
var metadataFields = [
  "protocol",
  "executorMode",
  "testMode",
  "ghcWasm",
  "ghciWasm",
  "libdirTar",
  "libdirPath",
  "workDir",
  "wasiShim"
];
function createHaskellAssetLoader(scope) {
  let loading;
  return () => {
    if (loading === void 0) loading = loadHaskellAssets(scope).catch((error) => {
      loading = void 0;
      throw error;
    });
    return loading;
  };
}
async function loadHaskellAssets(scope) {
  const metadata = parseHaskellRunnerMetadata(parseMetadataText(await fetchText(scope, "haskell/runner.meta.json")));
  const [ghcWasm, libdirTar, ghciWasm] = await Promise.all([
    fetchCompressedOrRaw(scope, metadata.ghcWasm, GHC_WASM),
    fetchCompressedOrRaw(scope, metadata.libdirTar, LIBDIR_TAR),
    requiresGhci(metadata) ? fetchCompressedOrRaw(scope, metadata.ghciWasm, GHCi_WASM) : Promise.resolve(void 0)
  ]);
  return {
    metadata,
    ghcWasm,
    libdirTar,
    ...ghciWasm === void 0 ? {} : { ghciWasm },
    wasiShimUrl: assetUrl(scope, metadata.wasiShim).href
  };
}
function parseHaskellRunnerMetadata(value) {
  if (!isPlainRecord2(value)) throw new TypeError("Haskell runner metadata must be a plain object");
  const keys = Object.keys(value);
  if (keys.some((key) => !metadataFields.includes(key))) {
    throw new TypeError("Haskell runner metadata contains an unknown field");
  }
  for (const key of ["protocol", "executorMode", "testMode", "ghcWasm", "libdirTar", "libdirPath", "workDir", "wasiShim"]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new TypeError(`Haskell runner metadata is missing ${key}`);
  }
  if (value.protocol !== "ghc-wasi-v1") throw new TypeError("Haskell runner metadata has an unsupported protocol");
  const executorMode = executionMode(value.executorMode, "executorMode");
  const testMode = executionMode(value.testMode, "testMode");
  const ghciSelected = executorMode === "ghci" || testMode === "ghci";
  const ghciWasm = value.ghciWasm;
  if (ghciSelected && !isAsset(ghciWasm, GHCi_WASM)) {
    throw new TypeError("Haskell runner metadata requires ghciWasm when GHCi is selected");
  }
  if (!ghciSelected && ghciWasm !== void 0) {
    throw new TypeError("Haskell runner metadata must not declare ghciWasm when GHCi is not selected");
  }
  return {
    protocol: "ghc-wasi-v1",
    executorMode,
    testMode,
    ghcWasm: asset(value.ghcWasm, GHC_WASM, "ghcWasm"),
    ...ghciSelected ? { ghciWasm } : {},
    libdirTar: asset(value.libdirTar, LIBDIR_TAR, "libdirTar"),
    libdirPath: mountPath(value.libdirPath, "libdirPath"),
    workDir: mountPath(value.workDir, "workDir"),
    wasiShim: wasiShim(value.wasiShim)
  };
}
function requiresGhci(metadata) {
  return metadata.executorMode === "ghci" || metadata.testMode === "ghci";
}
function parseMetadataText(text2) {
  try {
    return JSON.parse(text2);
  } catch {
    throw new TypeError("Haskell runner metadata is not valid JSON");
  }
}
async function fetchText(scope, relativePath) {
  const response = await fetchResponse(scope, relativePath);
  return response.text();
}
async function fetchCompressedOrRaw(scope, configured, allowed) {
  const candidates = configured.endsWith(".gz.bin") ? [configured, allowed[1]] : [allowed[0], configured];
  for (const candidate of candidates) {
    try {
      const bytes = await (await fetchResponse(scope, candidate)).arrayBuffer();
      return candidate.endsWith(".gz.bin") ? await decompressGzip(bytes) : bytes;
    } catch {
    }
  }
  throw new TypeError(`Haskell runtime asset could not be loaded: ${configured}`);
}
async function fetchResponse(scope, relativePath) {
  const requested = assetUrl(scope, relativePath);
  const response = await scope.fetch(requested);
  if (!response.ok) throw new TypeError(`Haskell runtime asset request failed with ${response.status}`);
  if (response.url.length > 0 && new URL(response.url).origin !== requested.origin) {
    throw new TypeError("Haskell runtime asset redirect left the local origin");
  }
  return response;
}
function assetUrl(scope, relativePath) {
  if (!/^[A-Za-z0-9._/-]+$/.test(relativePath) || !relativePath.startsWith("haskell/") || relativePath.includes("..")) {
    throw new TypeError("Haskell runtime metadata has an unsafe asset path");
  }
  const base = new URL("./", scope.location.href);
  const url = new URL(relativePath, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new TypeError("Haskell runtime asset must be same-origin and local");
  }
  return url;
}
async function decompressGzip(bytes) {
  if (typeof DecompressionStream !== "function") throw new TypeError("DecompressionStream is unavailable");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
function executionMode(value, field) {
  if (value === "ghc-e" || value === "ghc-compile" || value === "ghci") return value;
  throw new TypeError(`Haskell runner metadata ${field} is unsupported`);
}
function asset(value, allowed, field) {
  if (!isAsset(value, allowed)) throw new TypeError(`Haskell runner metadata ${field} is inconsistent`);
  return value;
}
function isAsset(value, allowed) {
  return typeof value === "string" && allowed.includes(value);
}
function mountPath(value, field) {
  if (typeof value !== "string" || !/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(value)) {
    throw new TypeError(`Haskell runner metadata ${field} must be an absolute safe path`);
  }
  return value;
}
function wasiShim(value) {
  if (value !== "haskell/wasi-shim.js") throw new TypeError("Haskell runner metadata wasiShim is inconsistent");
  return value;
}
function isPlainRecord2(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// src/workers/shared/output-buffer.ts
var encoder = new TextEncoder();
var _remaining;
var OutputBudget = class {
  constructor(limitBytes = MAX_OUTPUT_BYTES) {
    __privateAdd(this, _remaining);
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) {
      throw new RangeError("Output limit must be a non-negative safe integer");
    }
    __privateSet(this, _remaining, limitBytes);
  }
  append(text2) {
    let bytes = 0;
    let retained = "";
    for (const codePoint of text2) {
      const codePointBytes = encoder.encode(codePoint).byteLength;
      if (bytes + codePointBytes > __privateGet(this, _remaining)) {
        __privateSet(this, _remaining, __privateGet(this, _remaining) - bytes);
        return { text: retained, truncated: true };
      }
      retained += codePoint;
      bytes += codePointBytes;
    }
    __privateSet(this, _remaining, __privateGet(this, _remaining) - bytes);
    return { text: retained, truncated: false };
  }
};
_remaining = new WeakMap();
var _budget, _stdout, _stderr, _stdoutTruncated, _stderrTruncated;
var OutputBuffer = class {
  constructor(budget = MAX_OUTPUT_BYTES) {
    __privateAdd(this, _budget);
    __privateAdd(this, _stdout, "");
    __privateAdd(this, _stderr, "");
    __privateAdd(this, _stdoutTruncated, false);
    __privateAdd(this, _stderrTruncated, false);
    __privateSet(this, _budget, typeof budget === "number" ? new OutputBudget(budget) : budget);
  }
  append(stream, text2) {
    const result = __privateGet(this, _budget).append(text2);
    if (stream === "stdout") {
      __privateSet(this, _stdout, __privateGet(this, _stdout) + result.text);
      __privateGet(this, _stdoutTruncated) || __privateSet(this, _stdoutTruncated, result.truncated);
      return;
    }
    __privateSet(this, _stderr, __privateGet(this, _stderr) + result.text);
    __privateGet(this, _stderrTruncated) || __privateSet(this, _stderrTruncated, result.truncated);
  }
  stdout() {
    return bounded(__privateGet(this, _stdout), __privateGet(this, _stdoutTruncated));
  }
  stderr() {
    return bounded(__privateGet(this, _stderr), __privateGet(this, _stderrTruncated));
  }
};
_budget = new WeakMap();
_stdout = new WeakMap();
_stderr = new WeakMap();
_stdoutTruncated = new WeakMap();
_stderrTruncated = new WeakMap();
function bounded(text2, truncated) {
  return { text: text2, bytes: encoder.encode(text2).byteLength, truncated };
}

// src/workers/shared/runtime-errors.ts
var encoder2 = new TextEncoder();
var MAX_DETAILS_BYTES = 8192;
var RuntimeFailureError = class extends Error {
  constructor(failure2) {
    super(failure2.message);
    this.failure = failure2;
    this.name = "RuntimeFailureError";
  }
};
function compileFailure(code, message, details) {
  return failure("compile", code, message, false, details);
}
function runtimeFailure(code, message, details) {
  return failure("runtime", code, message, false, details);
}
function endpointFailure(error) {
  if (error instanceof RuntimeFailureError) return error.failure;
  return failure("infrastructure", "runtime-endpoint-failure", "Runtime endpoint operation failed", true, errorDetails(error));
}
function failure(kind, code, message, fatal, details) {
  return {
    kind,
    code,
    message,
    fatal,
    ...details === void 0 || details.length === 0 ? {} : { details: truncateUtf8(details, MAX_DETAILS_BYTES) }
  };
}
function errorDetails(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return void 0;
}
function truncateUtf8(text2, limit) {
  let bytes = 0;
  let result = "";
  for (const codePoint of text2) {
    const codePointBytes = encoder2.encode(codePoint).byteLength;
    if (bytes + codePointBytes > limit) break;
    result += codePoint;
    bytes += codePointBytes;
  }
  return result;
}

// src/workers/haskell/host-failures.ts
var HaskellOperationError = class extends RuntimeFailureError {
  constructor(failure2, stdout, stderr) {
    super(failure2);
    this.stdout = stdout;
    this.stderr = stderr;
  }
};
function resultFromWasi(outputBytes, compiler, judgeOutput, program) {
  const output = new OutputBuffer(outputBytes);
  output.append("stdout", compiler.stdout);
  output.append("stderr", compiler.stderr);
  if (program !== void 0) {
    output.append("stdout", program.stdout);
    output.append("stderr", program.stderr);
  }
  const stdout = output.stdout();
  const stderr = output.stderr();
  return { stdout, stderr, judgeOutput, truncated: compiler.truncated || program?.truncated === true || stdout.truncated || stderr.truncated };
}
function wasiFailure(kind, code, message, result, outputBytes) {
  const output = new OutputBuffer(outputBytes);
  output.append("stdout", result.stdout);
  output.append("stderr", result.stderr);
  const details = [result.stderr, result.stdout].filter((text2) => text2.length > 0).join("\n");
  const failure2 = kind === "compile" ? compileFailure(code, message, details) : runtimeFailure(code, message, details);
  return new HaskellOperationError(failure2, output.stdout(), output.stderr());
}
function jsonBridgeFailure(error, stdout, stderr) {
  const details = error instanceof Error ? error.message : void 0;
  return new HaskellOperationError(
    runtimeFailure("json-bridge-error", "Haskell bridge could not produce canonical JSON", details),
    stdout,
    stderr
  );
}
function outputLimitFailure(stdout, stderr) {
  return new HaskellOperationError(
    runtimeFailure("json-bridge-error", "Haskell output exceeded the allowed size"),
    stdout,
    stderr
  );
}
function sourceConflictFailure(error) {
  const details = error instanceof Error ? error.message : void 0;
  return new HaskellOperationError(
    compileFailure("haskell-source-conflict", "Haskell judge source is unsupported", details),
    emptyBoundedText(),
    emptyBoundedText()
  );
}
function operationError(error) {
  if (error instanceof HaskellOperationError) return error;
  if (error instanceof RuntimeFailureError) return new HaskellOperationError(error.failure, emptyBoundedText(), emptyBoundedText());
  const details = error instanceof Error ? error.message : typeof error === "string" ? error : void 0;
  return new HaskellOperationError(runtimeFailure("haskell-runtime-error", "Haskell execution failed", details), emptyBoundedText(), emptyBoundedText());
}
function infrastructureError(code, message) {
  return new RuntimeFailureError({ kind: "infrastructure", code, message, fatal: true });
}
function retainTruncation(output, source) {
  return { ...output, truncated: output.truncated || source.truncated };
}
function emptyBoundedText() {
  return { text: "", bytes: 0, truncated: false };
}

// src/workers/haskell/json-string-bridge.ts
function encodeHaskellJsonInput(value) {
  return JSON.stringify(assertJsonValue(value, "Haskell bridge input"));
}
function decodeHaskellJsonOutput(text2) {
  let value;
  try {
    value = JSON.parse(text2);
  } catch {
    throw new TypeError("Haskell bridge did not return strict canonical JSON");
  }
  try {
    return assertJsonValue(value, "Haskell bridge output");
  } catch {
    throw new TypeError("Haskell bridge did not return strict canonical JSON");
  }
}
function wrapHaskellJudgeSource(source) {
  if (hasTopLevelMain(source)) {
    throw new TypeError("Haskell judge sources defining main are unsupported");
  }
  if (/^\s*module\s+/m.test(source)) {
    throw new TypeError("Haskell judge sources declaring a module are unsupported");
  }
  return `${source}

main :: IO ()
main = do
  __lc_input <- getContents
  putStr (solution __lc_input)
`;
}
function hasTopLevelMain(source) {
  return /^main\s*(?:::\s*|=)/m.test(source);
}

// src/workers/haskell/tar-filesystem.ts
var BLOCK_BYTES = 512;
var decoder = new TextDecoder();
function parseHaskellLibdirTar(bytes) {
  if (bytes.byteLength % BLOCK_BYTES !== 0) throw new TypeError("Haskell libdir tar is truncated or not block aligned");
  const entries = [];
  let offset = 0;
  let longName;
  while (offset < bytes.byteLength) {
    const header = bytes.subarray(offset, offset + BLOCK_BYTES);
    if (isZeroBlock(header)) {
      if (!remainingZero(bytes, offset)) throw new TypeError("Haskell libdir tar has data after its terminator");
      break;
    }
    const size = parseTarSize(header);
    const dataStart = offset + BLOCK_BYTES;
    const dataEnd = dataStart + size;
    const nextOffset = dataStart + paddedSize(size);
    if (dataEnd > bytes.byteLength || nextOffset > bytes.byteLength) throw new TypeError("Haskell libdir tar is truncated");
    const type = String.fromCharCode(header[156] === 0 ? 48 : header[156] ?? 0);
    const name = longName ?? tarPath(header);
    const data = bytes.slice(dataStart, dataEnd);
    if (type === "L") {
      if (longName !== void 0) throw new TypeError("Haskell libdir tar has consecutive GNU long names");
      longName = parseLongName(data);
    } else {
      if (name.length === 0) throw new TypeError("Haskell libdir tar entry has no path");
      const entryPath = safePath(name);
      if (type === "0") {
        if (entryPath === void 0) throw new TypeError("Haskell libdir tar has an unsafe path");
        entries.push({ kind: "file", path: entryPath, data });
      } else if (type === "5") {
        if (entryPath !== void 0) entries.push({ kind: "directory", path: entryPath });
      } else throw new TypeError(`Haskell libdir tar has unsupported entry type ${JSON.stringify(type)}`);
      longName = void 0;
    }
    offset = nextOffset;
  }
  if (longName !== void 0) throw new TypeError("Haskell libdir tar GNU long name has no following entry");
  return entries;
}
function createHaskellOperationFilesystem(shim, entries, options) {
  const libdir = new shim.Directory(/* @__PURE__ */ new Map());
  for (const entry of entries) addEntry(shim, libdir, entry);
  const work = new shim.Directory(/* @__PURE__ */ new Map());
  const root = new shim.Directory(/* @__PURE__ */ new Map());
  mount(shim, root, absoluteParts(options.libdirPath), libdir);
  mount(shim, root, absoluteParts(options.workDir), work);
  return { root, work };
}
function addEntry(shim, root, entry) {
  const parts = entry.path.split("/");
  const name = parts.pop();
  if (name === void 0) throw new TypeError("Haskell libdir tar entry has no name");
  const parent = ensureDirectories(shim, root, parts);
  if (entry.kind === "directory") {
    const existing = parent.contents.get(name);
    if (existing === void 0) parent.contents.set(name, new shim.Directory(/* @__PURE__ */ new Map()));
    else if (!isDirectory(existing)) throw new TypeError(`Haskell libdir tar path conflicts with a file: ${entry.path}`);
    return;
  }
  if (parent.contents.has(name)) throw new TypeError(`Haskell libdir tar contains duplicate path: ${entry.path}`);
  parent.contents.set(name, new shim.File(entry.data.slice(), { readonly: true }));
}
function ensureDirectories(shim, root, parts) {
  let directory = root;
  for (const part of parts) {
    const entry = directory.contents.get(part);
    if (entry === void 0) {
      const created = new shim.Directory(/* @__PURE__ */ new Map());
      directory.contents.set(part, created);
      directory = created;
    } else if (isDirectory(entry)) {
      directory = entry;
    } else {
      throw new TypeError(`Haskell libdir tar path conflicts with a file: ${part}`);
    }
  }
  return directory;
}
function mount(shim, root, parts, directory) {
  const name = parts[parts.length - 1];
  if (name === void 0) throw new TypeError("Haskell filesystem mount path must not be root");
  const parent = ensureDirectories(shim, root, parts.slice(0, -1));
  if (parent.contents.has(name)) throw new TypeError(`Haskell filesystem mount collides at /${parts.join("/")}`);
  parent.contents.set(name, directory);
}
function isDirectory(value) {
  return "contents" in value;
}
function absoluteParts(path) {
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(path)) {
    throw new TypeError("Haskell filesystem mount path must be an absolute safe path");
  }
  return path.slice(1).split("/");
}
function isZeroBlock(block) {
  return block.every((byte) => byte === 0);
}
function remainingZero(bytes, offset) {
  return bytes.subarray(offset).every((byte) => byte === 0);
}
function parseTarSize(header) {
  const raw = text(header, 124, 12).trim();
  if (raw.length === 0) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new TypeError("Haskell libdir tar has an invalid size");
  const size = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("Haskell libdir tar has an unsafe size");
  return size;
}
function tarPath(header) {
  const name = text(header, 0, 100);
  const prefix = text(header, 345, 155);
  return prefix.length === 0 ? name : `${prefix}/${name}`;
}
function parseLongName(bytes) {
  const value = decoder.decode(bytes).replace(/\0.*$/s, "").replace(/\n$/, "");
  const path = safePath(value);
  if (path === void 0) throw new TypeError("Haskell libdir tar has an unsafe path");
  return path;
}
function safePath(path) {
  if (path.length === 0 || path.includes("\\") || path.startsWith("/") || path.includes("\0")) {
    throw new TypeError("Haskell libdir tar has an unsafe path");
  }
  if (path === "./") return void 0;
  const parts = path.replace(/\/$/, "").split("/");
  if (parts[0] === ".") parts.shift();
  if (parts.length === 0) throw new TypeError("Haskell libdir tar has an unsafe path");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new TypeError("Haskell libdir tar has an unsafe path");
  }
  return parts.join("/");
}
function paddedSize(size) {
  return Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
}
function text(bytes, offset, length) {
  const field = bytes.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end));
}

// src/workers/haskell/wasi-execution.ts
async function runHaskellWasi(options) {
  const output = new OutputBuffer(options.outputBytes);
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  const append = (stream, decoder2) => (bytes) => {
    output.append(stream, decoder2.decode(bytes, { stream: true }));
  };
  const wasi = new options.shim.WASI(
    options.args,
    [
      `PWD=${options.metadata.workDir}`,
      `GHC_PACKAGE_PATH=${options.metadata.libdirPath}/package.conf.d`
    ],
    [
      new options.shim.OpenFile(new options.shim.File(new TextEncoder().encode(options.stdin))),
      new options.shim.ConsoleStdout(append("stdout", stdoutDecoder)),
      new options.shim.ConsoleStdout(append("stderr", stderrDecoder)),
      new options.shim.PreopenDirectory("/", options.root.contents)
    ]
  );
  const module = options.wasm instanceof WebAssembly.Module ? options.wasm : await WebAssembly.compile(options.wasm);
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
  let exitCode;
  try {
    exitCode = wasi.start(instance);
  } catch (error) {
    if (hasExitCode(error)) exitCode = error.code;
    else throw error;
  }
  output.append("stdout", stdoutDecoder.decode());
  output.append("stderr", stderrDecoder.decode());
  const stdout = output.stdout();
  const stderr = output.stderr();
  return { stdout: stdout.text, stderr: stderr.text, exitCode, truncated: stdout.truncated || stderr.truncated };
}
function assertHaskellWasiShim(shim) {
  if (typeof shim.WASI !== "function" || typeof shim.File !== "function" || typeof shim.Directory !== "function" || typeof shim.OpenFile !== "function" || typeof shim.ConsoleStdout !== "function" || typeof shim.PreopenDirectory !== "function") {
    throw new TypeError("Local Haskell WASI shim has an incompatible API");
  }
}
function hasExitCode(value) {
  return value !== null && typeof value === "object" && typeof value.code === "number";
}

// src/workers/haskell/ghc-host.ts
var HASKELL_RUNTIME_VERSION = "ghc-wasi-v1";
function createHaskellHost(options) {
  const outputBytes = options.outputBytes ?? MAX_OUTPUT_BYTES;
  const buildId = options.buildId ?? injectedBuildId();
  let prepared;
  const runtime = () => {
    if (prepared === void 0) prepared = prepareRuntime(options);
    return prepared;
  };
  const invoke = async (source, input, judge) => {
    try {
      return await runHaskell(await runtime(), source, input, judge, outputBytes);
    } catch (error) {
      throw operationError(error);
    }
  };
  return {
    initialize: async () => {
      try {
        await runtime();
      } catch {
        throw infrastructureError("haskell-initialization-failed", "Local Haskell runtime could not initialize");
      }
      return { runtimeVersion: HASKELL_RUNTIME_VERSION, buildId, capabilities: { execute: true, judge: true } };
    },
    execute: async (source) => {
      const result = await invoke(source, void 0, false);
      return { stdout: result.stdout, stderr: result.stderr, value: null };
    },
    judge: async (source, cases) => {
      const budget = new OutputBudget(outputBytes);
      const results = [];
      for (const testCase of cases) results.push(await judgeCase(invoke, source, testCase, budget));
      return { cases: results };
    },
    dispose: async () => {
      prepared = void 0;
    }
  };
}
async function prepareRuntime(options) {
  const assets = await options.loadAssets();
  if (assets.metadata.executorMode === "ghci" || assets.metadata.testMode === "ghci") {
    throw new TypeError("Haskell metadata selects unsupported GHCi mode");
  }
  const shim = await options.loadWasiShim(assets.wasiShimUrl);
  assertHaskellWasiShim(shim);
  return {
    metadata: assets.metadata,
    shim,
    ghcModule: await WebAssembly.compile(assets.ghcWasm),
    libdirEntries: parseHaskellLibdirTar(new Uint8Array(assets.libdirTar))
  };
}
async function runHaskell(runtime, source, input, judge, outputBytes) {
  const sourceText = judgeSource(source, judge);
  const mode = judge ? runtime.metadata.testMode : runtime.metadata.executorMode;
  if (mode === "ghci") throw new TypeError("Haskell metadata selects unsupported GHCi mode");
  const filesystem = createHaskellOperationFilesystem(runtime.shim, runtime.libdirEntries, runtime.metadata);
  filesystem.work.contents.set("Main.hs", new runtime.shim.File(new TextEncoder().encode(sourceText)));
  filesystem.work.contents.set(".ghc", new runtime.shim.Directory(/* @__PURE__ */ new Map()));
  const compiler = await runCompiler(runtime, filesystem.root, input ?? "", mode, outputBytes);
  if (compiler.exitCode !== 0) {
    throw wasiFailure("compile", "haskell-compile-error", "Haskell source could not be compiled", compiler, outputBytes);
  }
  if (mode === "ghc-e") return resultFromWasi(outputBytes, compiler, compiler.stdout);
  const program = filesystem.work.contents.get("program.wasm");
  if (!isFile(program)) {
    throw wasiFailure("compile", "haskell-compile-output-missing", "Haskell compiler did not produce a WASI program", compiler, outputBytes);
  }
  const executed = await runHaskellWasi({
    shim: runtime.shim,
    wasm: program.data,
    args: ["program.wasm"],
    stdin: input ?? "",
    root: filesystem.root,
    metadata: runtime.metadata,
    outputBytes
  });
  if (executed.exitCode !== 0) {
    throw wasiFailure("runtime", "haskell-runtime-error", "Haskell program exited unsuccessfully", executed, outputBytes);
  }
  return resultFromWasi(outputBytes, compiler, executed.stdout, executed);
}
async function runCompiler(runtime, root, stdin, mode, outputBytes) {
  const args = mode === "ghc-e" ? ["ghc", "-ignore-dot-ghci", "-v0", "-B", runtime.metadata.libdirPath, "-e", "main", `${runtime.metadata.workDir}/Main.hs`] : [
    "ghc",
    "-ignore-dot-ghci",
    "-v0",
    "-B",
    runtime.metadata.libdirPath,
    "-outputdir",
    `${runtime.metadata.workDir}/.ghc`,
    "-o",
    `${runtime.metadata.workDir}/program.wasm`,
    `${runtime.metadata.workDir}/Main.hs`
  ];
  return runHaskellWasi({ shim: runtime.shim, wasm: runtime.ghcModule, args, stdin, root, metadata: runtime.metadata, outputBytes });
}
async function judgeCase(invoke, source, testCase, budget) {
  const output = new OutputBuffer(budget);
  try {
    const result = await invoke(source, encodeHaskellJsonInput(testCase.input), true);
    if (result.truncated) throw outputLimitFailure(result.stdout, result.stderr);
    let actual;
    try {
      actual = decodeHaskellJsonOutput(result.judgeOutput);
    } catch (error) {
      throw jsonBridgeFailure(error, result.stdout, result.stderr);
    }
    output.append("stdout", result.stdout.text);
    output.append("stderr", result.stderr.text);
    return { index: testCase.index, ok: true, actual, stdout: output.stdout(), stderr: output.stderr() };
  } catch (error) {
    const failure2 = operationError(error);
    output.append("stdout", failure2.stdout.text);
    output.append("stderr", failure2.stderr.text);
    return {
      index: testCase.index,
      ok: false,
      failure: failure2.failure,
      stdout: retainTruncation(output.stdout(), failure2.stdout),
      stderr: retainTruncation(output.stderr(), failure2.stderr)
    };
  }
}
function judgeSource(source, judge) {
  if (!judge) return source;
  try {
    return wrapHaskellJudgeSource(source);
  } catch (error) {
    throw sourceConflictFailure(error);
  }
}
function isFile(value) {
  return value !== void 0 && "data" in value;
}
function injectedBuildId() {
  return true ? "cb5ee067f9482da3" : "development";
}

// src/workers/shared/endpoint.ts
function createWorkerEndpoint(options) {
  return async (event) => {
    let request;
    try {
      request = parseWorkerRequest(event.data);
    } catch {
      return;
    }
    if (request.runtimeId !== options.runtimeId) {
      options.post({
        ...envelope(request),
        type: "failure",
        error: {
          kind: "protocol",
          code: "runtime-mismatch",
          message: "Worker received a request for another runtime",
          fatal: true
        }
      });
      return;
    }
    try {
      switch (request.type) {
        case "initialize":
          options.post({ ...envelope(request), type: "status", phase: "initializing", message: "Initializing runtime" });
          options.post({
            ...envelope(request),
            type: "complete",
            operation: "initialize",
            payload: await options.runtime.initialize()
          });
          return;
        case "execute":
          options.post({ ...envelope(request), type: "status", phase: "executing", message: "Executing runtime" });
          options.post({
            ...envelope(request),
            type: "complete",
            operation: "execute",
            payload: await options.runtime.execute(request.source)
          });
          return;
        case "judge":
          options.post({ ...envelope(request), type: "status", phase: "executing", message: "Executing runtime" });
          options.post({
            ...envelope(request),
            type: "complete",
            operation: "judge",
            payload: await options.runtime.judge(request.source, request.cases)
          });
          return;
        case "dispose":
          await options.runtime.dispose();
          options.post({ ...envelope(request), type: "complete", operation: "dispose", payload: { disposed: true } });
          return;
      }
    } catch (error) {
      options.post({ ...envelope(request), type: "failure", error: endpointFailure(error) });
    }
  };
}
function envelope(request) {
  return {
    protocolVersion: request.protocolVersion,
    requestId: request.requestId,
    runtimeId: request.runtimeId
  };
}

// src/workers/haskell.worker.ts
function createLocalHaskellWasiShimLoader(scope) {
  return async (url) => {
    const target = new URL(url);
    const base = new URL("./", scope.location.href);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
      throw new TypeError("Haskell WASI shim must be same-origin and local");
    }
    return import(
      /* @vite-ignore */
      target.href
    );
  };
}
function installHaskellWorker(scope) {
  const endpoint = createWorkerEndpoint({
    runtimeId: "haskell-ghc-wasi",
    runtime: createHaskellHost({
      loadAssets: createHaskellAssetLoader(scope),
      loadWasiShim: createLocalHaskellWasiShimLoader(scope),
      outputBytes: MAX_OUTPUT_BYTES,
      buildId: injectedBuildId2()
    }),
    post: (message) => scope.postMessage(message)
  });
  scope.addEventListener("message", (event) => {
    void endpoint(event);
  });
}
function injectedBuildId2() {
  return true ? "cb5ee067f9482da3" : "development";
}
var workerScope = globalThis;
if (isHaskellWorkerScope(workerScope)) installHaskellWorker(workerScope);
function isHaskellWorkerScope(scope) {
  const location = Reflect.get(scope, "location");
  return typeof Reflect.get(scope, "addEventListener") === "function" && typeof Reflect.get(scope, "postMessage") === "function" && typeof Reflect.get(scope, "fetch") === "function" && location !== null && typeof location === "object" && typeof Reflect.get(location, "href") === "string";
}
export {
  createLocalHaskellWasiShimLoader,
  installHaskellWorker
};
