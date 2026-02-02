import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function loadWorker() {
  const workerPath = path.join(root, "public", "racket-worker.js");
  const code = fs.readFileSync(workerPath, "utf8");

  const messages = [];

  const sandbox = {
    // Minimal worker-like environment
    self: {
      postMessage: (m) => messages.push(m),
    },
    performance: {
      now: () => 0,
    },
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "racket-worker.js" });

  assert.equal(
    typeof sandbox.self.onmessage,
    "function",
    "worker should register self.onmessage",
  );

  return { sandbox, messages };
}

async function runWorkerOnce({ sandbox, messages }, data) {
  messages.length = 0;
  await sandbox.self.onmessage({ data });
  assert.ok(messages.length > 0, "worker should post at least one message");
  return messages[messages.length - 1];
}

async function testExecutorModeBasic() {
  const ctx = loadWorker();
  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "t1",
    executorMode: true,
    code: `#lang racket\n(displayln "hi")\n(+ 1 2)`,
  });

  if (!res.success) {
    console.error("executor mode failed:", res);
  }

  assert.equal(res.success, true);
  assert.ok(typeof res.logs === "string");
  assert.ok(res.logs.includes("hi"));
  assert.equal(res.result, "3");
}

async function testProblemModeTwoSumTemplateStyle() {
  const ctx = loadWorker();

  const code = `#lang racket\n\n(define (solution input)\n  (let ([nums (hash-ref input 'nums)]\n        [target (hash-ref input 'target)])\n    (cond\n      [(= (+ (first nums) (second nums)) target) (list 0 1)]\n      [else (list 0 0)])))\n\n(define (second lst) (first (rest lst)))`;

  const res = await runWorkerOnce(ctx, {
    type: "execute",
    requestId: "t2",
    executorMode: false,
    code,
    testCases: [
      { input: { nums: [2, 7], target: 9 }, expected: [0, 1] },
      { input: { nums: [3, 3], target: 6 }, expected: [0, 1] },
    ],
  });

  assert.equal(res.success, true);
  assert.equal(res.results.length, 2);
  assert.equal(res.results[0].passed, true);
  assert.equal(res.results[1].passed, true);
}

async function main() {
  const workerPath = path.join(root, "public", "racket", "racket.js");
  const shouldRun = process.env.RACKET_WASM_TESTS === "1";

  if (!shouldRun) {
    console.log(
      "Skipping Racket worker tests (set RACKET_WASM_TESTS=1 to run in a browser-like environment)",
    );
    return;
  }

  if (!fs.existsSync(workerPath)) {
    throw new Error(
      "Racket runtime missing at public/racket/racket.js. Run: pnpm run build:runtimes",
    );
  }
  await testExecutorModeBasic();
  await testProblemModeTwoSumTemplateStyle();
  console.log("Racket worker tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
