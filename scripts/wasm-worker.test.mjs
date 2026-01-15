import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const crypto = globalThis.crypto ?? webcrypto;
const atob = globalThis.atob ?? ((data) => Buffer.from(data, "base64").toString("binary"));

// Simple WASM module exporting add(a, b) -> a + b.
const WASM_ADD_BASE64 = "AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=";

// Minimal WASI module that immediately exits with code 0.
const WASI_STUB_BASE64 =
  "AGFzbQEAAAABCAJgAX8AYAAAAiQBFndhc2lfc25hcHNob3RfcHJldmlldzEJcHJvY19leGl0AAADAgEBBQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAEKCAEGAEEAEAAL";

function loadWorker() {
  const workerPath = path.join(root, "public", "wasm-worker.js");
  const code = fs.readFileSync(workerPath, "utf8");

  const messages = [];

  const sandbox = {
    self: {
      postMessage: (m) => messages.push(m),
      location: { origin: "http://localhost", pathname: "/wasm-worker.js" },
    },
    performance: {
      now: () => 0,
    },
    crypto,
    fetch: async (url) => {
      throw new Error(`Unexpected fetch in tests: ${url}`);
    },
    TextEncoder,
    TextDecoder,
    WebAssembly,
    atob,
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "wasm-worker.js" });

  assert.equal(typeof sandbox.self.onmessage, "function", "worker should register self.onmessage");

  return { sandbox, messages };
}

async function runWorkerOnce({ sandbox, messages }, data) {
  messages.length = 0;
  await sandbox.self.onmessage({ data });
  assert.ok(messages.length > 0, "worker should post at least one message");
  return messages[messages.length - 1];
}

async function testWasmExecutorMode() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasm-exec",
    language: "wasm",
    executorMode: true,
    code: JSON.stringify({
      moduleBase64: WASM_ADD_BASE64,
      entry: "add",
      args: [2, 3],
    }),
  });

  assert.equal(res.success, true);
  assert.equal(res.result, 5);
}

async function testWasmTestMode() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasm-test",
    language: "wasm",
    executorMode: false,
    code: JSON.stringify({
      moduleBase64: WASM_ADD_BASE64,
      entry: "add",
    }),
    testCases: [{ input: [4, 6], expected: 10 }],
  });

  assert.equal(res.success, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].passed, true);
}

async function testWasiExecutorMode() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasi-exec",
    language: "wasi",
    executorMode: true,
    code: JSON.stringify({
      runtimeBase64: WASI_STUB_BASE64,
      code: "print(\"hello\")",
    }),
  });

  assert.equal(res.success, true);
  assert.ok(typeof res.logs === "string");
}

async function testWasiTestMode() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "wasi-test",
    language: "wasi",
    executorMode: false,
    code: JSON.stringify({
      runtimeBase64: WASI_STUB_BASE64,
      code: "print(\"hello\")",
    }),
    testCases: [{ input: { value: 1 }, expected: "" }],
  });

  assert.equal(res.success, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].passed, true);
  assert.ok(typeof res.results[0].logs === "string");
}

async function main() {
  await testWasmExecutorMode();
  await testWasmTestMode();
  await testWasiExecutorMode();
  await testWasiTestMode();
  console.log("WASM/WASI worker tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
