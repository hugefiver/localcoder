# Haskell GHC `-e` Browser Runtime Implementation Plan

> **For agentic workers:** Use the subagent-driven-development skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LocalCoder's non-starting, full-libdir Haskell path with a locally bound, identity-locked GHC `-e` browser runtime backed by a proven dynamic-eval profile, streaming immutable snapshots, fresh per-operation state, and a current Chromium receipt.

**Architecture:** Progress through fail-closed Gates A–E. First prove the exact current GHC module can start with only local JSFFI glue, then build and browser-toggle a recached four-package dynamic profile, productionize the local dyld/`ghc -e` ABI, stream that profile into an immutable `SharedLibdirSnapshot`, and only then replace the product metadata/catalog/identity/receipt path. Every gate has a blocked branch that preserves `LOADABLE_UNVERIFIED` or `UNAVAILABLE`, records evidence, skips dependent work, and goes directly to cleanup; no gate may fall back to the 2.9 GB libdir, remote code, eager tar materialization, GHCi, or static `ghc -o`.

**Tech Stack:** PowerShell 7, Node.js, pnpm 12, TypeScript 5.9 strict mode, Vite 7, Web Workers, WebAssembly/WASI Preview 1, `@bjorn3/browser_wasi_shim` 0.4.2, `ReadableStream`, `DecompressionStream`, deterministic tar/gzip generation, Git LFS assets, Node test runner, Chromium CDP, LocalCoder optional-v1 verification.

**Spec:** `docs/superpowers/specs/2026-09-01-haskell-ghc-e-browser-runtime-design.md`

**Global Constraints:**
- 生产调用固定为 `ghc -ignore-dot-ghci -v0 -B /ghc -hide-all-packages -package base -e main /work/Main.hs`；只有真实 GHC 证明要求时才能作最小参数调整，且每个新增 package 都必须更新 profile 合同并重跑全部证明门。
- 本阶段不包含 GHCi UI、Template Haskell、用户代码的 C 或 JS FFI、任意 Hackage 或 Cabal、网络、文件、进程或线程能力、静态 `program.wasm` 输出、wasm-ld 或 clang 集成、任意 package 集、MLE verdict、安全沙箱、权威设备计时、Racket 或 RustPython 改造，以及 UI 重构。
- 完整 2.9 GB libdir 不是发布目标；若真实 `ghc -e` 需要完整 33 包或达到 916,339,975 B 静态估算，立即停止，不把它当 fallback。
- profile 只能从版本锁定 GHC、显式 allowlist、展开后的安全 symlink、匹配的 `wasm32-wasi-ghc-pkg recache`、逐文件 hash/bytes 与许可证清单生成；匹配工具链缺失或版本不符时 Gate B 为 `BLOCKED`，禁止手写、拷贝或伪造 `package.cache`。
- JSFFI、prelude、post-link、dyld 和 local shim 必须本地、同源、版本锁定并进入 identity；remote URL、`esm.sh`、未声明动态 import、运行时拼接的未绑定代码和吞错 stub 全部禁止。
- Worker generation 只共享每个 profile 文件的精确定长 `ArrayBuffer` 与不可变 descriptor；不得共享 shim `File`/Inode/Directory、`Map`、FD、WASI、stdio、cwd、env 或 WebAssembly instance。
- profile 必须通过 streaming gzip/tar 构造 snapshot；不得调用 profile 的 eager `Response(...).arrayBuffer()`，不得保留完整 tar `ArrayBuffer`，不得提供 eager/raw-full-libdir fallback，也不得产生第二份 Θ(`S_trim`) payload。
- metadata 生产 schema 只允许统一 `ghc-e`；删除 `ghc-compile` 和 `ghci` 表面，不生成 `program.wasm`，judge 每个 case 独立执行 `ghc -e`，expected/comparison/verdict 仍只归主线程 OJ。
- Snapshot 状态固定为 `EMPTY → LOADING → READY`；partial snapshot 不可发布。hash/path/truncation/gzip/OOM/JSFFI/dyld 是 fatal infrastructure failure；compile/runtime failure 可保留健康 generation；timeout/cancel/未知 shim fault 终止 Worker，下一次显式操作使用 fresh Worker，且不自动 replay。
- Chromium 是最低浏览器证明面；Firefox/WebKit 仅是后续 productization gate，不能写成已验证。
- `LOADABLE_UNVERIFIED`、`UNAVAILABLE` 和 verifier exit `2` 都不是通过；只有当前 manifest/asset/build identity 匹配的 optional-v1 browser receipt 才能启用。
- 只在 `C:\Users\hugefiver\source\LocalCoder` 内改项目文件。本 follow-up 不下载或安装任何软件；后续 Gate B 已获用户明确授权，可从版本锁定的 GHC 官方来源把与 Gate A `9.15.20260202` 匹配的 `ghc-pkg` 隔离下载/安装到明确路径并以绝对路径调用，但不得替换现有 GHC、修改全局 `PATH`，也不得借此安装或升级 Node 包、浏览器或驱动。若需要 MSYS、Hadrian、额外平台工具链或其他依赖，必须停止并再次取得授权。
- 只使用 PowerShell 语法；不得使用 Bash `export`、`VAR=value command`、`&&`、`/dev/null`、`source` 或前台长驻 server/browser。
- 不执行 `git add`、`git commit`、`git push`、`git tag`、`git restore`、`git reset`、`git stash` 或其他 Git 写；每个任务以测试和只读 diff review 结束，不以 commit 结束。
- 当前工作树是输入而不是噪声：不得假定 clean，不得覆盖或回退 bounded 尝试；所有现有 `.gz.bin`、tar `./` 安全修复、测试、文档、generated Worker/manifest、资产和 QA evidence 必须被吸收、修正或在最终 ledger 中明确删除。
- `.debug-journal.md` 是临时 artifact；无论成功还是证据化停止，必须在最终 closeout 前按 journal 清理。正式 gate/QA evidence 可以保留。
- 不并行运行两个 `pnpm test`；每次测试独占 `.test-dist`，focused 与 full suite 也必须串行。
- 验证命令优先使用项目标准 `pnpm` 命令。只有 pnpm wrapper 在有限 timeout 内挂起时，才可终止其 run-owned 进程并使用本计划列出的等价 direct Node 命令；evidence 必须同时记录原命令、timeout/exit、direct command 和“仅绕过 wrapper”的差异。
- 所有 server/browser 启动必须使用 detached Node launcher，分别重定向 stdout/stderr，立即返回并记录 PID；readiness、自动化、日志读取和 cleanup 必须是独立的有限 timeout 调用。不得把 `Start-Process` 当成已证明的 detached 启动。

---

## Approval Question: Product Memory and Cold-Start Budget

The spec requires a minimum-supported-device memory budget and cold-start budget before product enablement, but does not supply values. Do not invent device RAM, available-memory, or latency numbers.

- Gates A–D may run as research under these existing fail-closed limits: candidate profile `payloadBytes < 916_339_975`, selected package count `< 33`, no full `2_888_833_482` B payload/archive fallback, allocation ledger `retainedPayloadBytes === profileManifest.payloadBytes`, `copiedPayloadBytes === 0`, and real Chromium memory evidence that does not show a second Θ(`S_trim`) plateau relative to a same-asset streaming-discard baseline. Inconclusive memory evidence is a gate failure, not a pass.
- Concurrency is fixed to the existing Runtime Supervisor contract: one active operation per runtime, FIFO queue, no judge-case parallelism, no automatic replay.
- Before Task 8 may request or retain a `VERIFIED` receipt, the user/product owner must approve exact positive values for `minimumSupportedDevice.availableMemoryBytes` and `coldStartupBudgetMs`. Record them in `artifacts/qa/haskell-runtime/product-budget.json` with schema `{ "schemaVersion": 1, "minimumSupportedDevice": { "label": string, "availableMemoryBytes": integer }, "coldStartupBudgetMs": integer, "concurrency": "single-active-operation-per-runtime" }`.
- Gate D/E must stop if snapshot loading, an operation, Chromium working set, or Chromium private memory exceeds 70% of the approved available-memory value, or if cold initialization exceeds the approved cold-start value. Without the approval artifact, Task 8 records `BLOCKED_PRODUCT_BUDGET`, leaves Haskell disabled, and jumps to Task 9.

## Current Dirty-Tree Migration Ledger

Record `git status --short` before the first edit and compare it at every review boundary. The implementation must preserve unrelated user work and settle these known Haskell paths without restore/reset/stash:

| Current path/state | Required disposition |
|---|---|
| `.gitattributes`, `.gitignore` modified | Keep the HTTP-stable `.gz.bin` intent. The authorized follow-up already added the exact `ghc.wasm.gz.bin` LFS rule; after Gate B replace the full-libdir LFS/ignore rules with `dynamic-e-profile.tar.gz.bin`. All other Task 7 dependencies and stop routing remain unchanged. |
| `public/haskell/ghc.wasm.gz` and `public/haskell/libdir.tar.gz` deleted | Preserve the legacy `.gz` deletion; never reintroduce these names. |
| `public/haskell/ghc.wasm.gz.bin` untracked | Retain only as the exact GHC asset after Gate A hash/import proof; its matching LFS rule was completed early in the authorized follow-up, without `git lfs track`, staging, or another Git write. |
| `public/haskell/libdir.tar.gz.bin` untracked | Keep as diagnostic input through Gate B only; after Gate B success remove it from delivery/catalog/LFS and replace it with the trimmed profile. On a blocked branch, do not claim migration complete. |
| `src/workers/haskell/assets.ts` eager gzip-bin migration | Keep `.gz.bin` naming for GHC, replace eager profile loading/raw fallback with streaming exact-descriptor loading, and stop swallowing candidate errors. |
| `src/workers/haskell/tar-filesystem.ts` plus tar `./` fix | Port its path/traversal/GNU-long-name regressions into `streaming-tar.ts`; delete the eager parser only after streaming and operation-filesystem suites are GREEN. |
| `runtimes/haskell-ghc/runner.meta.json`, catalog, identity, manifest tests | Replace `ghc-e/ghc-compile/ghci` schema with unified `ghc-e`, remove GHCi conditional assets, bind the new profile/binding assets, and regenerate outputs from owners. |
| `public/haskell-worker.js`, `public/haskell/runner.meta.json`, `public/runtime-manifest.json` modified | Treat as generated; never hand-edit. Regenerate only after source, asset, and identity tests pass. |
| Existing focused tests/docs modified | Preserve valid `.gz.bin` and tar-prefix regressions, rewrite assumptions that retain full libdir, raw-full fallback, `ghc-compile`, or GHCi. |
| `artifacts/qa/haskell-runtime/haskell-runtime-qa.json` and screenshot | Archive under `artifacts/qa/haskell-runtime/archive/bounded-2026-09-01/` after new acceptance evidence exists, and mark it superseded; do not leave competing current claims. |
| `artifacts/qa/haskell-runtime/streaming-decompression-probe.json` | Retain as historical full-archive baseline under `artifacts/qa/haskell-runtime/baselines/2026-09-01-full-libdir-streaming.json`; it is diagnostic, not production proof. |
| `.debug-journal.md` | Delete in Task 9 after success or evidence-backed stop and after all run-owned temp processes/profiles/scripts are gone. |

## Final File Map

### New source and contract files

- `runtimes/haskell-ghc/ghc-wasm-contract.json` — Gate A's exact source-WASM hash, bytes, imports, custom sections, required exports, and observed numeric version.
- `runtimes/haskell-ghc/dynamic-e-profile.json` — explicit package/file allowlist, exclusion rules, command contract, and stop limits.
- `scripts/lib/haskell-ghc-wasm-contract.mjs` — deterministic WASM import/custom-section inventory and contract validator.
- `scripts/lib/haskell-ghc-dynamic-profile.mjs` — matching-toolchain preflight, package closure, symlink dereference, recache, deterministic tar/gzip, manifest/license, and budget enforcement.
- `tests/scripts/haskell-ghc-wasm-contract.test.mjs` — exact current GHC inventory regressions.
- `tests/scripts/haskell-ghc-dynamic-profile.test.mjs` — fail-closed profile/toolchain/recache/reproducibility regressions.
- `src/workers/haskell/incremental-sha256.ts` — bounded streaming SHA-256 used without retaining the compressed profile.
- `src/workers/haskell/jsffi-runtime.ts` — version-bound local JSFFI factory and local dyld binding contract.
- `src/workers/haskell/streaming-tar.ts` — incremental safe tar parser with no complete tar buffer.
- `src/workers/haskell/shared-libdir-snapshot.ts` — `EMPTY → LOADING → READY` snapshot owner and allocation ledger.
- `src/workers/haskell/operation-filesystem.ts` — fresh shim nodes/maps/root/work construction over shared exact buffers.
- `tests/workers/haskell-jsffi-runtime.test.ts` — import inventory, no-remote, local dyld, command, and structured failure coverage.
- `tests/workers/haskell-shared-libdir-snapshot.test.ts` — streaming, hash, state, exact-buffer, mutation, and no-copy coverage.
- `docs/qa/2026-09-01-haskell-ghc-e-runtime-results.md` — final success or blocked result tied to exact identity.

### Generated assets after successful Gates A–D

- `public/haskell/dynamic-e-profile.tar.gz.bin` — only deployable libdir profile archive; Git LFS tracked.
- `public/haskell/dynamic-e-profile.manifest.json` — per-file/path/hash/bytes/package/toolchain/license/profile contract.
- `public/haskell/ghc-wasm-contract.json` — staged Gate A contract.
- `public/haskell/ghc-jsffi-imports.mjs` — build-time generated, identity-bound JSFFI import factory; no runtime code generation.
- `public/haskell/dyld-browser-local.mjs` — build-time generated local-only dyld module with the remote browser branch removed and exact source hash binding.
- `public/haskell/runner.meta.json`, `public/haskell-worker.js`, `public/runtime-manifest.json` — generated from owners after all earlier gates pass.
- `artifacts/runtime-verification/haskell-ghc-wasi.json` — only retained on a successful, budget-approved, current optional-v1 Chromium run.

## Dependency Order and Stop Routing

All tasks are sequential; no implementation wave may run in parallel.

1. Task 1 / Gate A static inventory and compiler startup.
2. Task 2 / Gate B matching-toolchain dynamic profile and real toggles.
3. Task 3 / Gate C production local JSFFI/dyld and unified `ghc -e`.
4. Task 4 / Gate D streaming hash/gzip/tar.
5. Task 5 / Gate D immutable snapshot and fresh operation state.
6. Task 6 / Gate D integrated lifecycle and real-browser memory proof.
7. Task 7 / Gate E packaging, identity, metadata, LFS, CI, and stale-asset migration. Only the GHC-gzip LFS rule was completed early by the authorized follow-up; every other Task 7 dependency and stop route is unchanged.
8. Task 8 / Gate E product, optional-v1 receipt, and real Chromium acceptance; requires the approval artifact above.
9. Task 9 / full regression, evidence closeout, debug cleanup, identity-bound final review; always runs after success or any blocked gate.

If Tasks 1–8 fail a gate, finish that task's evidence and temp cleanup, mark all later dependent tasks `BLOCKED BY GATE <letter>`, and jump directly to Task 9. Never continue “to see what else works.”

## Shared Real-Browser Launch and Cleanup Protocol

Every Gate A/C/D/E browser run uses this protocol. The shell call that launches a process must only launch, persist/print its PID, and return; give every subsequent shell/tool call a finite timeout.

1. Verify the approved temp parent and create a unique run root:

```powershell
$tempParent = "C:\Users\HUGEFI~1\AppData\Local\Temp\opencode"
if (-not (Test-Path -LiteralPath $tempParent -PathType Container)) { throw "Approved temp parent is missing" }
$qaRoot = Join-Path $tempParent ("localcoder-haskell-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $qaRoot | Out-Null
New-Item -ItemType Directory -Path (Join-Path $qaRoot "logs") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $qaRoot "profile") | Out-Null
```

2. Create a short Node launcher at `$qaRoot\launch-detached.mjs`. It reads one JSON spec, opens separate logs, uses `spawn({ detached: true, stdio: ["ignore", stdoutFd, stderrFd], windowsHide: true })`, writes `{ pid, command, args, cwd, startedAt }` atomically to the requested PID record, calls `child.unref()`, closes parent FDs, prints the PID, and exits. Do not use `Start-Process`.

```js
import { closeSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const stdoutFd = openSync(spec.stdoutPath, "a");
const stderrFd = openSync(spec.stderrPath, "a");
const child = spawn(spec.command, spec.args, {
  cwd: spec.cwd,
  detached: true,
  windowsHide: true,
  stdio: ["ignore", stdoutFd, stderrFd],
});
const temp = `${spec.pidPath}.${process.pid}.tmp`;
writeFileSync(temp, JSON.stringify({ pid: child.pid, command: spec.command, args: spec.args, cwd: spec.cwd, startedAt: new Date().toISOString() }));
renameSync(temp, spec.pidPath);
child.unref();
closeSync(stdoutFd);
closeSync(stderrFd);
console.log(child.pid);
```

3. Use direct Node only for detached Vite ownership: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --strictPort`. Record that this is exactly `pnpm run preview -- --host 127.0.0.1 --port 5173 --strictPort` without the pnpm wrapper. The preview origin must remain `http://127.0.0.1:5173`, matching the verifier's emitted harness URL and receipt server's allowed origin; do not rewrite the URL or loosen CORS. Launch the verifier separately as `node scripts/verify-optional-runtime.mjs haskell-ghc-wasi --browser --port 4181` only in Task 8.
4. Before launch, prove ports 5173, 4181, and 9222 are unowned. If occupied, stop rather than kill an unknown process. Discover an already-installed browser from the current automation environment or existing paths; if none exists, record an environment blocker and do not install one. Launch Chromium with loopback CDP, the run-owned profile, `--no-first-run`, `--no-default-browser-check`, `--disable-background-networking`, `--disable-component-update`, `--disable-default-apps`, `--disable-extensions`, and `--disable-sync`.
5. In separate calls, verify the recorded PID/command line, then readiness with bounded `Invoke-WebRequest` calls to the preview URL and `http://127.0.0.1:9222/json/version`. Read logs separately. A launch timeout or occupied shell is failure and requires ownership inspection/cleanup.
6. Automation must capture console, page errors, failed requests, all request URLs/origins, Worker messages, handshake identity, timing, process-tree working/private bytes, and the gate assertions. Remote runtime request count must be exactly `0`.
7. Cleanup verifies each recorded PID's command line before terminating only that process tree. Then validate `GetFullPath($qaRoot)` is an immediate child of the approved temp parent before recursive deletion. Confirm the three run-owned ports are free. Never delete a parent, workspace, home, or an unverified path.

### Task 1: Gate A — Lock the Current GHC Contract and Prove Compiler Startup

**Files:**
- Create: `scripts/lib/haskell-ghc-wasm-contract.mjs`
- Create: `tests/scripts/haskell-ghc-wasm-contract.test.mjs`
- Create after browser PASS: `runtimes/haskell-ghc/ghc-wasm-contract.json`
- Create formal evidence: `artifacts/qa/haskell-runtime/gate-a-compiler-startup.json`
- Temporarily create then delete in this task: `scripts/probes/haskell-ghc-startup.mjs`
- Inspect only: `runtimes/haskell-ghc/dist/ghc.wasm`
- Inspect only: `public/haskell/libdir.tar.gz.bin`

**Interfaces:**
- Consumes: source GHC WASM at 146,482,240 B with SHA-256 `a4d584aec1585cdc8a4d716faa82f5750c875c930fe882fcb0e8115c79c19e4f`; locked prelude/post-link/dyld bytes extracted by a Node streaming scan; local WASI shim; current dirty-tree ledger.
- Produces: `inspectGhcWasm(bytes: Uint8Array): GhcWasmInventory`, `assertGhcWasmContract(inventory, contract): void`, exact `ghc-wasm-contract.json`, and Chromium proof that `ghc --numeric-version` exits `0` without dyld use or remote traffic.

**Recommended executor:** `deep`

- [ ] **Step 1: Record the dirty baseline without demanding a clean tree**

Run read-only commands and save their output in Gate A evidence through the probe script, not by altering tracked files:

```powershell
git status --short
git diff --stat
git diff --check
(Get-FileHash -Algorithm SHA256 -LiteralPath "runtimes/haskell-ghc/dist/ghc.wasm").Hash
(Get-Item -LiteralPath "runtimes/haskell-ghc/dist/ghc.wasm").Length
```

Expected: HEAD remains `d92e980`; the known dirty paths match the migration ledger; `git diff --check` exits `0`; hash and bytes match the `Consumes` contract. Any unrelated new path is protected and excluded from implementation edits.

- [ ] **Step 2: Write the RED inventory contract test**

The test must assert this exact stable surface, sorted by module then name:

```js
const expectedJsffiImports = [
  "ZC0ZCghcizm9zi15zminplaceZCGHCiziObjLinkZC",
  "ZC1ZCghcizm9zi15zminplaceZCGHCiziObjLinkZC",
  "ZC2ZCghcizm9zi15zminplaceZCGHCiziObjLinkZC",
  "ZC3ZCghcizm9zi15zminplaceZCGHCiziObjLinkZC",
  "ZC17ZCghczminternalZCGHCziInternalziWasmziPrimziImportsZC",
  "ZC18ZCghczminternalZCGHCziInternalziWasmziPrimziImportsZC",
  "ZC0ZCghczminternalZCGHCziInternalziWasmziPrimziTypesZC",
  "ZC1ZCghczminternalZCGHCziInternalziWasmziPrimziTypesZC",
  "ZC2ZCghczminternalZCGHCziInternalziWasmziPrimziTypesZC",
  "ZC3ZCghczminternalZCGHCziInternalziWasmziPrimziTypesZC",
  "ZC4ZCghczminternalZCGHCziInternalziWasmziPrimziTypesZC",
  "ZC0ZCghczminternalZCGHCziInternalziWasmziPrimziConcziInternalZC",
  "freeJSVal",
  "getJSVal",
  "newJSVal",
  "scheduleWork",
].sort();
const expectedCustomSections = ["ghc_wasm_jsffi", "name", "producers", "target_features"];
```

Also assert only modules `ghc_wasm_jsffi` and `wasi_snapshot_preview1` exist; all 26 observed WASI function names are recorded; the 12 custom-section records include exact binder/body text; required exports include `memory`, `_start`, `rts_schedulerLoop`, promise resolvers, and `rts_freeStablePtr`; unknown import kind/module/name fails loudly.

- [ ] **Step 3: Run RED**

```powershell
pnpm test -- tests/scripts/haskell-ghc-wasm-contract.test.mjs
```

Expected: FAIL because `scripts/lib/haskell-ghc-wasm-contract.mjs` and the durable contract do not exist. If the pnpm wrapper times out, record it and run only after cleanup: `node scripts/run-tests.mjs tests/scripts/haskell-ghc-wasm-contract.test.mjs`.

- [ ] **Step 4: Implement deterministic inventory parsing**

Implement without instantiating the module or evaluating custom-section bodies:

```js
export function inspectGhcWasm(bytes) {
  const module = new WebAssembly.Module(bytes);
  return Object.freeze({
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    imports: Object.freeze(WebAssembly.Module.imports(module).map(freezeImport).sort(compareImport)),
    exports: Object.freeze(WebAssembly.Module.exports(module).map(freezeExport).sort(compareExport)),
    customSections: Object.freeze(parseCustomSectionInventory(bytes, module)),
    jsffiRecords: Object.freeze(parseJsffiRecords(module)),
  });
}

export function assertGhcWasmContract(inventory, contract) {
  assert.deepEqual(inventory, contract.inventory);
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(contract.ghcNumericVersion)) {
    throw new Error("GHC numeric version is not locked");
  }
}
```

Use strict NUL-terminated UTF-8 parsing equivalent to the locked `post-link.mjs`; reject malformed triples, missing NUL terminators, duplicate records, an import without a custom record except the four prelude-owned names, and a record not selected by the actual module imports.

- [ ] **Step 5: Run the static contract GREEN**

```powershell
pnpm test -- tests/scripts/haskell-ghc-wasm-contract.test.mjs
```

Expected: PASS with exact bytes/hash/import/custom-section assertions. Do not create the durable JSON contract until the browser reports the numeric version.

- [ ] **Step 6: Build the throwaway progressive startup probe**

`scripts/probes/haskell-ghc-startup.mjs` must:

1. Stream-scan the diagnostic gzip tar on Node and retain only explicitly requested startup files; Chromium never fetches the full archive. Start with `/ghc/settings` and `/work`; if GHC requests another file, record its exact normalized path and restart with that one addition. Traversal, symlink, unsupported type, or an unbounded request set fails the gate.
2. Generate JSFFI functions from the locked 12 binder/body records plus local `JSValManager`, `newJSVal`, `getJSVal`, `freeJSVal`, and `scheduleWork`. Bind ObjLink to a fail-loud object whose four methods throw `gate-a-dyld-use`; never return a fake success value.
3. Instantiate with exactly `wasi_snapshot_preview1` and `ghc_wasm_jsffi`; an unsupported import is `UNSUPPORTED_IMPORT`, not a stub.
4. Run exactly `ghc --numeric-version` with the minimal `/ghc` preopen. PASS requires exit `0`, one numeric-version stdout line, no ObjLink/dyld method call, and no access to profile/package dynamic libraries.
5. Hash the probe source, GHC bytes, retained startup fixture files, prelude/post-link source, generated glue, WASI shim, and browser Network log into evidence.

The probe code is throwaway. On PASS, only its observed contract and formal JSON survive; Task 2 regenerates production assets through the profile builder, and Task 3 implements reviewed production TypeScript. Do not copy the probe wholesale into `src/`.

- [ ] **Step 7: Run Gate A in real Chromium**

Use the shared detached protocol. Open only the local probe URL. Evidence must assert:

```json
{
  "status": "PASS",
  "command": ["ghc", "--numeric-version"],
  "exitCode": 0,
  "stdoutIsNumericVersion": true,
  "dyldCalls": [],
  "unsupportedImports": [],
  "remoteRuntimeRequests": [],
  "fullLibdirRequestedByBrowser": false
}
```

The evidence also records Chromium version, PID/profile cleanup, source hash, build inputs, all local request URLs, process working/private-memory samples, and the exact numeric version. Any missing field, browser crash, remote request, dyld call, swallowed error, or nonnumeric stdout is Gate A failure.

- [ ] **Step 8: Materialize the durable contract or stop**

On PASS, write `runtimes/haskell-ghc/ghc-wasm-contract.json` with the exact inventory from Step 4 and numeric version from Step 7, rerun the static test against that file, delete `scripts/probes/haskell-ghc-startup.mjs`, and verify its path is absent.

On failure, retain `gate-a-compiler-startup.json`, delete the throwaway probe and run-owned temp tree, mark Tasks 2–8 blocked, and jump to Task 9. In both branches run `git diff --check` and inspect only the intended diff.

### Task 2: Gate B — Build and Toggle the Dynamic-Eval Profile

**Files:**
- Create: `runtimes/haskell-ghc/dynamic-e-profile.json`
- Create: `scripts/lib/haskell-ghc-dynamic-profile.mjs`
- Create: `tests/scripts/haskell-ghc-dynamic-profile.test.mjs`
- Create on PASS: `public/haskell/dynamic-e-profile.tar.gz.bin`
- Create on PASS: `public/haskell/dynamic-e-profile.manifest.json`
- Create on PASS: `public/haskell/ghc-jsffi-imports.mjs`
- Create on PASS: `public/haskell/dyld-browser-local.mjs`
- Create formal evidence: `artifacts/qa/haskell-runtime/gate-b-dynamic-profile.json`
- Temporarily create then delete: `scripts/probes/haskell-ghc-profile-toggle.mjs`
- Modify only after successful Gate B output exists: `runtimes/haskell-ghc/build.mjs`

**Interfaces:**
- Consumes: Gate A `ghc-wasm-contract.json`; full libdir as diagnostic build input only; a locally available official `wasm32-wasi-ghc-pkg` executable, resolved by command name or an explicitly provided absolute path, whose parsed version exactly equals Gate A; initial packages `base`, `ghc-internal`, `ghc-prim`, `rts`; local Chromium.
- Produces: `checkHaskellProfileToolchain(options): ToolchainIdentity`, `buildDynamicEvalProfile(options): Promise<DynamicEvalProfileBuild>`, deterministic profile archive/manifest/static JSFFI/local dyld modules, and four real-browser toggle receipts.

**Recommended executor:** `deep`

- [ ] **Step 1: Execute the real toolchain preflight before editing profile source**

```powershell
$ghcPkgTarget = if ([string]::IsNullOrWhiteSpace($env:LOCALCODER_MATCHING_GHC_PKG)) {
  "wasm32-wasi-ghc-pkg"
} else {
  $env:LOCALCODER_MATCHING_GHC_PKG
}
$ghcPkg = Get-Command $ghcPkgTarget -ErrorAction SilentlyContinue
if ($null -eq $ghcPkg) {
  throw "Gate B preflight cannot continue: matching wasm32-wasi-ghc-pkg was not found; follow the authorized acquisition-or-block route below"
}
$ghcPkgOutput = @(& $ghcPkg.Source --version 2>&1 | ForEach-Object { $_.ToString() })
$ghcPkgExitCode = $LASTEXITCODE
if ($ghcPkgExitCode -ne 0) {
  throw "Gate B blocked: ghc-pkg version probe failed with exit $ghcPkgExitCode"
}
if ($ghcPkgOutput.Count -ne 1) {
  throw "Gate B blocked: ghc-pkg --version must emit exactly one line"
}
$ghcPkgVersionMatch = [regex]::Match(
  $ghcPkgOutput[0],
  '\AGHC package manager version (\d+\.\d+(?:\.\d+)?)\z'
)
if (-not $ghcPkgVersionMatch.Success) {
  throw "Gate B blocked: ghc-pkg --version output is not canonical"
}
$ghcPkgVersion = $ghcPkgVersionMatch.Groups[1].Value
$gateAVersion = (Get-Content -LiteralPath "runtimes/haskell-ghc/ghc-wasm-contract.json" -Raw | ConvertFrom-Json).ghcNumericVersion
if (-not [string]::Equals($ghcPkgVersion, $gateAVersion, [StringComparison]::Ordinal)) {
  throw "Gate B blocked: ghc-pkg version mismatch; expected $gateAVersion, got $ghcPkgVersion"
}
```

The official locked GHC source exposes `--version` (not `--numeric-version`) and formats it as `GHC package manager version <cProjectVersion>`: [`utils/ghc-pkg/Main.hs` at `ddf1434ff9bb08cfef3c93f23de6b83ec698aa27`](https://raw.githubusercontent.com/ghc/ghc/ddf1434ff9bb08cfef3c93f23de6b83ec698aa27/utils/ghc-pkg/Main.hs). Treat native output as `string[]`: require exit `0`, exactly one output line, and the anchored regex above; do not call `Trim()` or otherwise erase an extra-line/banner failure. Extract the numeric capture and compare it byte-for-byte (ordinal) with Gate A `ghcNumericVersion`. Also hash the tool executable and record its resolved path. `ghc --numeric-version` in Gate A remains unchanged.

The earlier missing-tool blocker is historical evidence produced before this correction. At this revision, the ordinary local `ghc-pkg 9.14.1` is present but is not the matching cross tool and must be rejected. If no matching command or approved absolute path is available, the executor may use the already granted authorization to acquire only the matching tool from the locked official GHC source into an isolated path, without replacing GHC or changing global `PATH`, then rerun this preflight. If doing so requires MSYS, Hadrian, another platform toolchain, or any additional dependency, stop for fresh authorization. If the matching tool remains unavailable, create the formal blocker, do not create/copy `package.cache`, mark Tasks 3–8 blocked, and jump to Task 9.

- [ ] **Step 2: Write RED profile-builder tests with an injected fake process runner only for unit isolation**

Add exact tests:

- `"the Haskell profile builder blocks before output when matching ghc-pkg is absent or mismatched"`
- `"the Haskell profile builder selects only base ghc-internal ghc-prim and rts dynamic closure"`
- `"the Haskell profile builder dereferences safe symlinks and rejects escaping or cyclic links"`
- `"the Haskell profile builder invokes matching ghc-pkg recache and rejects copied or stale package.cache"`
- `"the Haskell profile manifest records sorted paths hashes bytes packages toolchain and licenses reproducibly"`
- `"the Haskell profile budget rejects 33 packages 916339975 bytes and full-libdir fallback"`
- `"the local dyld transform removes the esm.sh browser branch and binds the exact upstream source hash"`

The test double may prove command construction, but the production Gate B evidence must come from the real executable in Step 1.

- [ ] **Step 3: Run RED**

```powershell
pnpm test -- tests/scripts/haskell-ghc-dynamic-profile.test.mjs
```

Expected: FAIL because the profile contract and builder do not exist. Direct fallback, only after a recorded wrapper timeout, is `node scripts/run-tests.mjs tests/scripts/haskell-ghc-dynamic-profile.test.mjs`.

- [ ] **Step 4: Define the explicit profile contract**

`dynamic-e-profile.json` must encode this initial contract without path wildcards that can pull another package:

```json
{
  "schemaVersion": 1,
  "packages": ["base", "ghc-internal", "ghc-prim", "rts"],
  "includeKinds": ["package-conf", "dyn-hi", "non-profiling-shared-library", "settings", "prelude", "post-link", "dyld", "license"],
  "excludeSuffixes": [".a", "_p.a", ".p_hi", ".p_dyn_hi", "_p.so"],
  "symlinkPolicy": "dereference-within-libdir",
  "packageCachePolicy": "matching-ghc-pkg-recache-only",
  "executionMode": "ghc-e",
  "requiredPackages": ["base"],
  "profilePayloadStopBytes": 916339975,
  "packageCountStop": 33
}
```

Resolve `.dyn_hi`, non-profiling `.so`, package `.conf`, and transitive package IDs from the package DB records for exactly these packages; do not glob the whole libdir. Include `settings`, locked `prelude.mjs`, `post-link.mjs`, `dyld.mjs`, upstream license files, and the generated cache.

- [ ] **Step 5: Implement a deterministic, fail-closed profile build**

Expose these exact production seams:

```js
export function checkHaskellProfileToolchain({ command, expectedVersion, run, hashFile }) {}
export async function buildDynamicEvalProfile({
  sourceLibdir,
  ghcContract,
  profileContract,
  ghcPkg,
  outputDirectory,
  run,
}) {}
```

The builder must stage into a unique temp directory beside the intended output, resolve and validate every source path beneath the source libdir, dereference each symlink to copied bytes while recording `{ path, sourceKind: "symlink", linkTarget, resolvedSource, sha256, bytes }`, write only selected package confs, and run:

```text
wasm32-wasi-ghc-pkg recache --package-db <staged-/ghc/package.conf.d>
```

Then rerun the matching tool with `check` against that package DB. Require a newly created cache whose mtime and hash differ from any source cache; never copy source `package.cache`. Sort tar entries bytewise by normalized POSIX path, set deterministic modes/uid/gid/mtime, gzip deterministically, and atomically publish only after all hashes, bytes, licenses, and limits validate.

Generate `ghc-jsffi-imports.mjs` at build time from Gate A's exact custom records and locked prelude semantics. Generate `dyld-browser-local.mjs` from the exact locked `dyld.mjs` only if its upstream hash and the single remote browser branch match the contract; replace that branch with an explicit local shim injection API. Assert generated text contains no `http:`, `https:`, `esm.sh`, or unbound dynamic import. Include source and generated hashes in the manifest.

- [ ] **Step 6: Run unit GREEN and reproducibility proof**

```powershell
pnpm test -- tests/scripts/haskell-ghc-dynamic-profile.test.mjs tests/scripts/haskell-ghc-wasm-contract.test.mjs
```

Expected: all selected tests pass. Build twice into two OS-temp directories with the real matching toolchain; profile archive, manifest content, JSFFI module, and local dyld module hashes must be identical. A fake runner result is not acceptable for this step.

- [ ] **Step 7: Perform four real Chromium profile toggles**

The temporary toggle probe uses the Gate A local binding and the generated local-only dyld module. It loads only the candidate profile and runs these named toggles sequentially in fresh Workers:

1. `minimal-main`: `main = putStr "ok"` proves source parse/typecheck/eval.
2. `base-resolution`: imports a non-Prelude `base` module and proves `-hide-all-packages -package base` resolves only the declared package.
3. `dynamic-load`: proves local `.so` search/load/symbol resolution and records every path/symbol through the local dyld service.
4. `judge-wrapper`: runs `solution :: String -> String; solution = id` with nested Unicode JSON stdin and returns the same canonical JSON.

For each profile group, disable that group in a fresh generated candidate and prove the expected named toggle fails with the exact missing path/package/dyld trace; restore it and prove GREEN. Any file discovered outside the allowlist must be recorded as a profile diff and causes a fresh full Gate B run. Any fifth package requires explicit contract update and rerunning all four toggles; reaching 33 packages or 916,339,975 B stops.

Evidence requires local request count, remote request count `0`, profile manifest/archive hashes, package list, payload/compressed bytes, generated module hashes, toolchain path/version/hash, recache command/exit, toggle result/identity, and browser cleanup.

- [ ] **Step 8: Publish Gate B outputs or stop**

On PASS, atomically copy the reproducible outputs to the four `public/haskell/` paths listed above, update `runtimes/haskell-ghc/build.mjs` to call the builder only when explicitly rebuilding Haskell inputs, and delete the toggle probe. Do not yet update catalog/LFS/manifest or claim product availability; Task 7 owns that migration.

On failure, remove candidate public outputs created by this task only, retain the formal Gate B report, keep the full `.bin` diagnostic asset untouched, delete the probe/temp tree, mark Tasks 3–8 blocked, and jump to Task 9.

### Task 3: Gate C — Productionize Local JSFFI/Dyld and Unified `ghc -e`

**Files:**
- Create: `src/workers/haskell/jsffi-runtime.ts`
- Create: `tests/workers/haskell-jsffi-runtime.test.ts`
- Modify: `src/workers/haskell/wasi-execution.ts:9-83`
- Modify: `src/workers/haskell/ghc-host.ts:43-211`
- Modify: `src/workers/haskell/host-failures.ts:23-99`
- Modify: `src/workers/haskell/assets.ts:1-195`
- Modify: `src/workers/haskell.worker.ts:1-55`
- Modify: `tests/workers/haskell-bridge.test.ts`
- Create formal evidence: `artifacts/qa/haskell-runtime/gate-c-ghc-e.json`

**Interfaces:**
- Consumes: Gate B profile/manifest/static JSFFI/local dyld assets; `HaskellWasiShim`; `wrapHaskellJudgeSource`; exact GHC command contract.
- Produces: `loadHaskellJsffiRuntime(options): Promise<HaskellJsffiRuntime>`, `HaskellJsffiRuntime.createOperationBindings(options): HaskellOperationBindings`, `runHaskellWasi(options)` with WASI+JSFFI imports, and a single `ghc-e` execute/judge host ABI.

**Recommended executor:** `complex`

- [ ] **Step 1: Write RED JSFFI/dyld/command/error tests**

Add exact tests:

- `"Haskell JSFFI rejects an import inventory that differs from the identity-bound contract"`
- `"Haskell JSFFI creates a fresh JSVal manager and exports knot for every operation"`
- `"Haskell dyld resolves only declared in-memory libraries and rejects remote or undeclared paths"`
- `"Haskell dyld surfaces find search lookup and load failures as fatal infrastructure details"`
- `"the Haskell compiler command is unified ghc-e with hide-all-packages and base"`
- `"the Haskell host maps pre-entry failure to compile and post-entry failure to runtime"`
- `"the Haskell judge executes every Unicode JSON case through ghc-e without program.wasm"`
- `"Haskell metadata rejects ghc-compile ghci ghciWasm and remote binding assets"`

Core command assertion:

```ts
assert.deepEqual(command, [
  "ghc", "-ignore-dot-ghci", "-v0", "-B", "/ghc",
  "-hide-all-packages", "-package", "base",
  "-e", "main", "/work/Main.hs",
]);
assert.equal(filesystem.work.contents.has("program.wasm"), false);
```

- [ ] **Step 2: Run RED**

```powershell
pnpm test -- tests/workers/haskell-jsffi-runtime.test.ts tests/workers/haskell-bridge.test.ts
```

Expected: FAIL because production JSFFI/dyld bindings do not exist, current imports contain WASI only, command lacks package hiding, and judge still uses `ghc-compile -o`.

- [ ] **Step 3: Narrow metadata to exact descriptors and one execution mode**

Replace the mode union with literal `"ghc-e"`. Parse strict plain records for these descriptors: GHC compressed/raw candidates, profile archive, profile manifest, staged GHC contract, generated JSFFI module, generated local dyld module, and WASI shim. Every descriptor is `{ url: string, sha256: 64-lowercase-hex, bytes: positive-safe-integer }`; URLs must be manifest-declared, same-origin, beneath the Worker base, and contain no traversal. Remove `ghciWasm`, `executorMode`, `testMode`, GHCi helpers, and full-libdir/raw-tar fallback.

- [ ] **Step 4: Implement version-bound local operation bindings**

Use these interfaces:

```ts
export interface HaskellJsffiRuntime {
  createOperationBindings(options: {
    readonly module: WebAssembly.Module;
    readonly root: HaskellWasiDirectory;
    readonly libraries: HaskellLocalLibraryIndex;
    readonly onEvalStage: (stage: "compiling" | "executing") => void;
  }): HaskellOperationBindings;
}

export interface HaskellOperationBindings {
  readonly imports: WebAssembly.ModuleImports;
  bindExports(exports: WebAssembly.Exports): void;
  dispose(): void;
}
```

Load only the two exact generated same-origin modules. Validate response URL, bytes, SHA-256, GHC contract hash, generated source hash, and export shape before use. `createOperationBindings` creates a fresh mutable exports knot, JSVal manager, finalization registry, scheduler closure, and local dyld session. Unsupported import, version drift, remote URL, undeclared library, module exception, or binding disposal fault becomes a fatal infrastructure failure with stage/details; no catch may convert it to success.

Do not import official `dyld.mjs` directly in a browser: its browser top-level branch imports `https://esm.sh/gh/haskell-wasm/browser_wasi_shim`. Only the Gate B local transform may execute.

- [ ] **Step 5: Instantiate every invocation with WASI and JSFFI**

Change `runHaskellWasi` to accept `createJsffiBindings`, construct a fresh WASI, get operation-local JSFFI imports, instantiate with:

```ts
const instance = await WebAssembly.instantiate(module, {
  wasi_snapshot_preview1: wasi.wasiImport,
  ghc_wasm_jsffi: bindings.imports,
});
bindings.bindExports(instance.exports);
```

Always dispose bindings in `finally`. Never retain instance, WASI, exports knot, JSVal map, FDs, stdout/stderr decoders, or dyld session across cases.

- [ ] **Step 6: Replace compile/output-WASM branching with one `ghc -e` path**

Delete `mode`, `program.wasm`, `.ghc` output assumptions, the second WASI program execution, and `haskell-compile-output-missing`. Both Executor and judge call the fixed command. Each judge case wraps source with `wrapHaskellJudgeSource`, passes canonical Unicode JSON on stdin, receives actual JSON text, and lets the main thread own comparison/verdict.

Use local dyld lifecycle to mark `executing` only when the eval module entrypoint is resolved. Nonzero before that marker maps to `compileFailure("haskell-compile-error", ...)`; nonzero or trap after it maps to `runtimeFailure("haskell-runtime-error", ...)`. Gate C must prove the marker against real compile/runtime samples; if reliable classification cannot be demonstrated, stop rather than use stderr heuristics.

- [ ] **Step 7: Run focused GREEN**

```powershell
pnpm test -- tests/workers/haskell-jsffi-runtime.test.ts tests/workers/haskell-bridge.test.ts tests/runtime/haskell-adapter.test.ts
```

Expected: all selected tests pass; no `ghc-compile`, `ghci`, `program.wasm`, remote URL, or Worker-side verdict remains in Haskell source/tests.

- [ ] **Step 8: Prove Gate C in real Chromium**

Using Gate B assets in a local gate harness, run fresh Workers for:

- minimal `main = putStr "ok"`;
- Unicode output and nested Unicode JSON judge identity;
- syntax/type error with structured compile failure;
- `main = error "gate-c-runtime"` with structured runtime failure;
- an undeclared library and a deliberately unsupported import fixture with loud infrastructure failure.

Evidence must contain the exact command, stage transitions, stdout/stderr bounds, actual JSON, local library paths/symbols, Worker identity, and `remoteRuntimeRequests: []`. Any request outside the local origin, direct execution of official remote dyld branch, error misclassification, or `program.wasm` creation fails Gate C. On failure, mark Tasks 4–8 blocked and jump to Task 9.

### Task 4: Gate D1 — Stream and Verify the Profile Without a Tar Buffer

**Files:**
- Create: `src/workers/haskell/incremental-sha256.ts`
- Create: `src/workers/haskell/streaming-tar.ts`
- Create: `tests/workers/haskell-shared-libdir-snapshot.test.ts`
- Modify: `src/workers/haskell/assets.ts`
- Modify: `tests/workers/haskell-filesystem.test.ts`

**Interfaces:**
- Consumes: exact profile archive descriptor, profile manifest, `Response.body`, `DecompressionStream("gzip")`, tar safety regressions including leading `./`.
- Produces: `IncrementalSha256`, `streamHaskellProfileTar(options): Promise<StreamingTarSummary>`, strict `HaskellStreamingTarEntry` events, compressed/archive/file hash receipts, and bounded chunk telemetry.

**Recommended executor:** `complex`

- [ ] **Step 1: Write RED streaming/hash/tar tests**

Add exact tests:

- `"incremental SHA-256 matches standard vectors across arbitrary chunk boundaries"`
- `"streaming Haskell tar accepts files directories GNU long names and one producer ./ prefix"`
- `"streaming Haskell tar rejects traversal duplicate paths links devices bad sizes and trailing data"`
- `"streaming Haskell tar rejects truncated gzip header file payload padding and terminator"`
- `"the Haskell profile loader never calls Response.arrayBuffer and exposes bounded chunk telemetry"`
- `"the Haskell profile loader rejects compressed hash bytes and manifest mismatches before READY"`

Use a `Response` double whose `arrayBuffer()` throws `eager-profile-read-forbidden`; GREEN must consume only `body.getReader()`.

- [ ] **Step 2: Run RED**

```powershell
pnpm test -- tests/workers/haskell-shared-libdir-snapshot.test.ts tests/workers/haskell-filesystem.test.ts
```

Expected: FAIL because streaming modules do not exist and the current loader uses eager `arrayBuffer()` plus raw fallback.

- [ ] **Step 3: Implement bounded incremental SHA-256**

Expose:

```ts
export class IncrementalSha256 {
  update(chunk: Uint8Array): void;
  digestHex(): string;
  get inputBytes(): number;
}
```

Retain only the 64-byte SHA block buffer and hash state. Reject update/digest after finalization and byte counts beyond `Number.MAX_SAFE_INTEGER`. Verify empty, `abc`, one-million-`a`, and split-boundary vectors against Node `createHash` in tests.

- [ ] **Step 4: Implement the streaming gzip/tar state machine**

Use a fixed maximum normalized input chunk of 1,048,576 B, a 512 B tar-header buffer, and one exact `ArrayBuffer(entry.size)` for the current retained file. Feed compressed chunks through both `IncrementalSha256` and `DecompressionStream`; never tee into a collected archive. Parse header/data/padding/terminator states incrementally and emit directories/files to a sink only after each file length/hash validates.

Port the existing safe-path behavior exactly: ignore archive root `./`, strip only one leading `./`, reject absolute/backslash/NUL/empty/interior `.`/`..`, reject duplicate normalized paths, accept GNU long-name records only when followed by one file/directory, and reject links because Gate B must dereference them.

- [ ] **Step 5: Change asset loading to open a one-shot stream**

`loadHaskellAssets` may eagerly load/compile the bounded GHC WASM and small binding/manifest assets, but profile loading must expose `openProfileStream(): Promise<Response>` and must not start a second request or raw fallback after a body/hash/gzip/tar error. A non-OK/redirect/descriptor mismatch is one structured infrastructure failure with the candidate URL and stage.

- [ ] **Step 6: Run GREEN and static no-eager search**

```powershell
pnpm test -- tests/workers/haskell-shared-libdir-snapshot.test.ts tests/workers/haskell-filesystem.test.ts tests/workers/haskell-bridge.test.ts
rg "libdirTar|parseHaskellLibdirTar|Response\(stream\)\.arrayBuffer|profile.*arrayBuffer" src/workers/haskell tests/workers
```

Expected: selected tests pass; search finds no production profile eager path. GHC WASM decompression may still produce its bounded module `ArrayBuffer`; the profile may not.

### Task 5: Gate D2 — Publish an Immutable Snapshot and Fresh Operation Graphs

**Files:**
- Create: `src/workers/haskell/shared-libdir-snapshot.ts`
- Create: `src/workers/haskell/operation-filesystem.ts`
- Modify: `src/workers/haskell/wasi-execution.ts`
- Modify: `src/workers/haskell/ghc-host.ts`
- Modify: `tests/workers/haskell-shared-libdir-snapshot.test.ts`
- Modify: `tests/workers/haskell-filesystem.test.ts`
- Delete after GREEN migration: `src/workers/haskell/tar-filesystem.ts`

**Interfaces:**
- Consumes: `streamHaskellProfileTar`, validated profile manifest, `HaskellWasiShim.File` accepting `ArrayBuffer`, metadata `/ghc` and `/work`.
- Produces: `SharedLibdirSnapshotLoader.load(): Promise<SharedLibdirSnapshot>`, `instantiateOperationFilesystem(options): HaskellOperationFilesystem`, allocation ledger, and fresh operation identity receipts.

**Recommended executor:** `complex`

- [ ] **Step 1: Extend RED tests for state, identity, and mutation isolation**

Assert:

```ts
assert.equal(loader.state, "EMPTY");
const loading = loader.load();
assert.equal(loader.state, "LOADING");
const snapshot = await loading;
assert.equal(loader.state, "READY");
assert.equal(snapshot.retainedPayloadBytes, manifest.payloadBytes);
assert.equal(snapshot.copiedPayloadBytes, 0);

const first = instantiateOperationFilesystem({ snapshot, shim, source: sourceA, input: inputA, metadata });
const second = instantiateOperationFilesystem({ snapshot, shim, source: sourceB, input: inputB, metadata });
assert.notEqual(first.root, second.root);
assert.notEqual(first.work, second.work);
assert.notEqual(first.libdirFiles.get("base.dyn_hi"), second.libdirFiles.get("base.dyn_hi"));
assert.equal(first.fileConstructorInputs.get("base.dyn_hi"), snapshot.file("base.dyn_hi").buffer);
assert.equal(second.fileConstructorInputs.get("base.dyn_hi"), snapshot.file("base.dyn_hi").buffer);
```

Add a mutation matrix for `fd_allocate`, `fd_filestat_set_size`, `fd_write`, `fd_pwrite`, directory `contents.set/delete/clear`, `path_create_directory`, `path_link`, `path_unlink`, `path_unlink_file`, `path_remove_directory`, and work-file changes. After each mutation attempt, snapshot hash/bytes and a newly created second operation must remain unchanged.

- [ ] **Step 2: Run RED**

```powershell
pnpm test -- tests/workers/haskell-shared-libdir-snapshot.test.ts tests/workers/haskell-filesystem.test.ts
```

Expected: FAIL because current files use copied `Uint8Array` entries and `entry.data.slice()`.

- [ ] **Step 3: Implement hidden mutable loading state and immutable READY surface**

Use exact public shapes:

```ts
export type SharedLibdirSnapshotState = "EMPTY" | "LOADING" | "READY";

export interface SharedLibdirFileDescriptor {
  readonly kind: "file";
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly buffer: ArrayBuffer;
}

export interface SharedLibdirSnapshot {
  readonly state: "READY";
  readonly profileSha256: string;
  readonly payloadBytes: number;
  readonly retainedPayloadBytes: number;
  readonly copiedPayloadBytes: 0;
  file(path: string): SharedLibdirFileDescriptor | undefined;
  entries(): readonly SharedLibdirFileDescriptor[];
}
```

Keep builder maps private. Freeze descriptors and the sorted entry array; expose lookup methods, not a shared `Map`. A failed load clears private partial buffers, returns to `EMPTY`, and throws fatal infrastructure failure. A successful load publishes once as `READY` and shares only exact file buffers.

- [ ] **Step 4: Construct operation files with ArrayBuffer views**

Update shim typing to `new (data: ArrayBuffer | SharedArrayBuffer | Uint8Array | readonly number[], options?)`. For every profile file call exactly `new shim.File(descriptor.buffer, { readonly: true })`; passing `new Uint8Array(buffer)`, `.slice()`, spread, or copied arrays is forbidden. Create new Directory/File/Inode objects and new Maps for every call. `/work/Main.hs`, stdin, compiler outputs, and temporary files are operation-local.

The shim's readonly API is not a security boundary. The mutation matrix proves that even APIs which replace an operation node's data/map cannot change snapshot buffers or another operation.

- [ ] **Step 5: Make WASI and WebAssembly state fresh too**

Each `runHaskellWasi` call constructs new stdin File, stdout/stderr FDs, PreopenDirectory, WASI, JSFFI bindings, dyld session, exports knot, and `WebAssembly.Instance`. Cache only `WebAssembly.Module`, `SharedLibdirSnapshot`, immutable metadata/contracts, and loaded static module factories at generation scope.

- [ ] **Step 6: Migrate and delete the eager parser**

Move all valid path/GNU-long-name/truncation regression coverage to streaming tests. Delete `tar-filesystem.ts` only when no source/test import remains and focused suites are GREEN. Do not delete the bounded `./` regression.

- [ ] **Step 7: Run GREEN and allocation assertions**

```powershell
pnpm test -- tests/workers/haskell-shared-libdir-snapshot.test.ts tests/workers/haskell-filesystem.test.ts tests/workers/haskell-jsffi-runtime.test.ts tests/workers/haskell-bridge.test.ts
rg "entry\.data\.slice|new Uint8Array\(descriptor\.buffer\)|parseHaskellLibdirTar|libdirEntries" src/workers/haskell tests/workers
```

Expected: tests pass; forbidden-copy/eager symbols are absent; constructor-spy assertions prove exact shared buffers with different node identities.

### Task 6: Gate D3 — Integrate Snapshot Lifecycle and Prove Memory/Recovery in Chromium

**Files:**
- Modify: `src/workers/haskell/ghc-host.ts`
- Modify: `src/workers/haskell/assets.ts`
- Modify: `src/workers/haskell/wasi-execution.ts`
- Modify: `src/workers/haskell.worker.ts`
- Modify: `src/workers/haskell/host-failures.ts`
- Modify: `tests/workers/haskell-bridge.test.ts`
- Modify: `tests/runtime/supervisor.test.ts`
- Modify: `tests/runtime/optional-verification.test.ts`
- Create formal evidence: `artifacts/qa/haskell-runtime/gate-d-streaming-snapshot.json`

**Interfaces:**
- Consumes: Task 4 streaming parser/hash, Task 5 snapshot/operation constructor, Gate C host, existing `RuntimeSupervisor` terminal-generation semantics.
- Produces: generation-level READY cache, structured fatal/nonfatal lifecycle, allocation telemetry, and real Chromium no-second-payload/fresh-worker evidence.

**Recommended executor:** `deep`

- [ ] **Step 1: Write RED lifecycle tests**

Add exact tests:

- `"Haskell initialization publishes READY only after every profile file hash validates"`
- `"Haskell gzip path hash OOM JSFFI and dyld failures discard partial snapshot and kill the generation"`
- `"Haskell compile and runtime failures preserve a healthy READY generation"`
- `"Haskell timeout cancel and unknown shim faults terminate without replay and reinitialize a fresh Worker"`
- `"Haskell judge cases share snapshot buffers but not nodes WASI JSFFI dyld or instances"`
- `"a pre-handshake Haskell failure does not fabricate build identity"`
- `"a post-handshake Haskell failure retains the exact generation identity"`

Use identity counters/spies for Worker generations and operation objects; assert queued operations settle once and are not replayed.

- [ ] **Step 2: Run RED**

```powershell
pnpm test -- tests/workers/haskell-bridge.test.ts tests/runtime/supervisor.test.ts tests/runtime/optional-verification.test.ts
```

Expected: new Haskell lifecycle assertions fail before integration; existing non-Haskell Supervisor assertions remain GREEN.

- [ ] **Step 3: Integrate generation and operation ownership**

`prepareRuntime` loads metadata/contracts/static modules, compiles GHC, and awaits one snapshot load before handshake success. Keep the resolved READY snapshot for that Worker generation only. Compile/runtime/JSON/output-limit operation failures remain nonfatal if snapshot/JSFFI/dyld health is intact. Hash/path/gzip/OOM/binding faults throw fatal infrastructure codes with stage/details; unknown shim exceptions are fatal.

`dispose()` clears generation references. Supervisor timeout/cancel/Worker error remains the authority that terminates the Worker and rejects active/queued calls without replay; a later explicit invocation starts a fresh handshake and snapshot load.

- [ ] **Step 4: Run lifecycle GREEN**

```powershell
pnpm test -- tests/workers/haskell-bridge.test.ts tests/workers/haskell-shared-libdir-snapshot.test.ts tests/runtime/supervisor.test.ts tests/runtime/optional-verification.test.ts
```

Expected: all selected suites pass, including existing JavaScript/Python lifecycle regressions.

- [ ] **Step 5: Run the real Chromium Gate D memory protocol**

Use fresh browser profiles and Workers for three sequential cases against the same trimmed asset:

1. `streaming-discard-baseline`: hash/decompress/parse but retain no file payload; record compressed bytes, output bytes, chunks, elapsed, and process-tree peaks.
2. `snapshot-ready`: build READY snapshot; require `retainedPayloadBytes === S_trim`, `allocatedPayloadBytes === S_trim`, `copiedPayloadBytes === 0`, no full tar buffer, max normalized chunk ≤ 1,048,576, and per-file buffer/hash equality.
3. `two-fresh-operations`: run two independent operations sequentially; require node/Map/FD/WASI/JSFFI/dyld/instance identities differ while every readonly file constructor received the same descriptor buffer; mutation probes leave snapshot hashes unchanged.

Compare real process working/private-memory curves with the discard baseline and allocation ledger. PASS requires no second payload-sized plateau attributable to tar retention, entry slices, File copies, or the second operation. If OS measurements are noisy enough that one-vs-two payload retention cannot be distinguished, mark Gate D inconclusive/failed; do not infer support from the developer machine.

- [ ] **Step 6: Prove timeout/cancel/fault recovery in Chromium**

Run a nonterminating Haskell operation to timeout, then a separate cancel case, then inject an unknown local shim fault. For each: active and queued calls settle once, Worker terminates, current operation is not replayed, and the next explicit valid operation starts a different Worker generation, completes handshake, reloads READY, and succeeds. Record both build identities; build ID may remain equal for identical bytes, but generation/PID/handshake events must be new.

On any Gate D failure, retain evidence, keep product metadata/catalog unchanged and unverified, mark Tasks 7–8 blocked, and jump to Task 9.

### Task 7: Gate E1 — Replace Packaging, Metadata, Identity, LFS, and CI Contracts

**Files:**
- Modify: `runtimes/haskell-ghc/runner.meta.json`
- Modify: `runtimes/haskell-ghc/build.mjs`
- Modify: `scripts/build-runtimes.mjs:94-190`
- Modify: `scripts/lib/runtime-catalog.mjs:6-72`
- Modify: `scripts/lib/worker-build-identity.mjs:170-262`
- Modify: `scripts/build-worker-assets.mjs:32-113`
- Modify: `scripts/generate-runtime-manifest.mjs:29-69`
- Modify: `scripts/check-runtime-assets.mjs`
- Modify: `tests/integration/build-worker-assets.test.ts`
- Modify: `tests/scripts/runtime-manifest-generation.test.mjs`
- Modify: `tests/runtime/generated-manifest.test.ts`
- Modify: `.gitattributes`
- Modify: `.gitignore`
- Modify: `.github/workflows/build-executors.yml`
- Modify: `.github/workflows/deploy-gh-pages.yml`
- Generate: `public/haskell/runner.meta.json`
- Generate: `public/haskell-worker.js`
- Generate: `public/runtime-manifest.json`
- Delete after profile staging succeeds: `public/haskell/libdir.tar.gz.bin`
- Preserve deletion: `public/haskell/libdir.tar.gz`

**Interfaces:**
- Consumes: passed Gates A–D and their exact assets; runtime catalog/identity/manifest generators; Git LFS checkout in CI.
- Produces: unified metadata, exact catalog groups, Haskell identity covering all compiler/profile/binding/toolchain inputs, fixed LFS delivery assets, and truthful `LOADABLE_UNVERIFIED` before receipt.

**Recommended executor:** `complex`

- [ ] **Step 1: Write RED metadata/catalog/identity/migration tests**

Add exact assertions:

- source and public metadata have literal `executionMode: "ghc-e"`, the fixed command array, strict asset descriptors, profile contract, and no `executorMode`, `testMode`, `ghc-compile`, `ghci`, `ghciWasm`, or `libdirTar`;
- catalog requires worker, GHC, profile archive, profile manifest, GHC contract, JSFFI module, local dyld module, WASI shim, and metadata; it contains no full-libdir/raw-tar or GHCi conditional group;
- manifest includes every present GHC compressed/raw candidate but exactly one profile archive path and all binding/contract assets;
- mutating GHC WASM, profile archive, profile manifest, GHC contract, JSFFI, local dyld, WASI shim, metadata, Worker import closure, esbuild/WASI toolchain, or manifest-recorded GHC toolchain identity changes only `haskellBuildId`;
- removing/staling any required profile license/hash/byte record makes optional Haskell `broken` or unavailable and never verified;
- legacy `.gz`, full `libdir.tar.gz.bin`, GHCi, and `ghc-compile` names are absent from generated Haskell output.

- [ ] **Step 2: Run RED**

```powershell
pnpm test -- tests/integration/build-worker-assets.test.ts tests/scripts/runtime-manifest-generation.test.mjs tests/runtime/generated-manifest.test.ts tests/workers/haskell-bridge.test.ts
```

Expected: FAIL because catalog/identity/schema still reflect full libdir and GHCi/compile compatibility.

- [ ] **Step 3: Implement the exact generated metadata contract**

`runner.meta.json` must contain protocol `ghc-wasi-v1`, literal `executionMode: "ghc-e"`, `/ghc`, `/work`, the fixed command array, Gate A numeric version/hash, profile package list, and `{ url, sha256, bytes }` descriptors for every runtime asset. `build-runtimes.mjs` recomputes descriptors from outputs and rejects source metadata drift; it does not discover a broader package set.

Remove `buildHaskellGhciRunner` naming/GHCi branches and replace it with a Haskell GHC-e staging function. The ordinary app/CI build consumes already fixed public LFS assets; it never invokes external GHC or `ghc-pkg`. Only explicit `RUNTIME_TARGETS=haskell` external-runtime rebuild invokes the Gate B builder, and missing tools fail closed.

- [ ] **Step 4: Replace catalog and manifest ownership**

Use exact Haskell groups:

```js
file("haskell-worker.js"),
oneOf("haskell/ghc.wasm.gz.bin", "haskell/ghc.wasm"),
file("haskell/dynamic-e-profile.tar.gz.bin"),
file("haskell/dynamic-e-profile.manifest.json"),
file("haskell/ghc-wasm-contract.json"),
file("haskell/ghc-jsffi-imports.mjs"),
file("haskell/dyld-browser-local.mjs"),
file("haskell/wasi-shim.js"),
file("haskell/runner.meta.json"),
```

Delete `conditionalOneOf` and `hasHaskellGhciSelection` if no other runtime uses them. The generated manifest remains packaging truth, not source configuration.

- [ ] **Step 5: Bind the complete identity**

`haskellRuntimeIdentityRecords(root)` must include every present GHC candidate, profile archive, profile manifest, staged GHC contract, generated JSFFI, generated local dyld, WASI shim, and metadata. The profile manifest bytes bind source GHC numeric version/hash, `ghc-pkg` version/executable hash, package allowlist, recache result, per-file hashes/bytes, licenses, and generated-module source hashes. Existing Worker build-plan, resolved import closure, esbuild package/platform binary, and WASI shim package records remain in `analyzeWorkerBuildIds`.

- [ ] **Step 6: Migrate LFS and old assets in fail-safe order**

Only after new profile files pass hash/byte/license checks:

1. Preserve the already completed `/public/haskell/ghc.wasm.gz.bin` rule and add the `.gitattributes` rule for `/public/haskell/dynamic-e-profile.tar.gz.bin`.
2. Remove the old `/public/haskell/libdir.tar.gz` and `/public/haskell/libdir.tar.gz.bin` rules.
3. Update `.gitignore` reinclusions to the GHC/profile `.bin` assets; keep diagnostic `runtimes/haskell-ghc/dist/libdir.tar` ignored.
4. Delete exact public full-libdir assets; do not delete the diagnostic source archive or any parent directory.
5. Verify attributes read-only with `git check-attr filter -- public/haskell/ghc.wasm.gz.bin public/haskell/dynamic-e-profile.tar.gz.bin` and inspect LFS pointers/assets with existing `git lfs` commands. Do not run `git lfs track`, `git add`, or any Git write.

- [ ] **Step 7: Make CI consume fixed assets without building a toolchain**

Keep `actions/checkout` with `lfs: true`. Add/retain public/dist runtime checks that validate profile metadata/hash/bytes/licenses and identity. Do not add GHC setup, downloads, `ghc-pkg`, external archive builds, or full-libdir artifacts to either workflow.

- [ ] **Step 8: Verify source fixtures, regenerate from owners, then verify generated outputs**

Run source/isolated-fixture suites first. Do not run the real-public-tree `generated-manifest` suite while the manifest still names the removed full-libdir asset. Generate Worker and manifest from their owners before testing those current outputs; do not skip or weaken missing-asset assertions.

```powershell
pnpm test -- tests/integration/build-worker-assets.test.ts tests/scripts/runtime-manifest-generation.test.mjs tests/workers/haskell-bridge.test.ts
pnpm run build:worker
pnpm run runtime:manifest
pnpm test -- tests/runtime/generated-manifest.test.ts
pnpm run runtime:check
node scripts/verify-optional-runtime.mjs haskell-ghc-wasi
```

Expected: focused tests and generation/check commands exit `0`; verifier exits `2` with exact `LOADABLE_UNVERIFIED` because no current browser receipt is yet accepted. Generated Haskell assets contain no legacy/full-libdir/GHCi/compile path. Direct equivalents after a recorded wrapper failure are `node scripts/build-worker-assets.mjs`, `node scripts/generate-runtime-manifest.mjs`, and `node scripts/check-runtime-assets.mjs public`.

- [ ] **Step 9: Reject stale receipts and inspect generated ownership**

Delete or archive any preexisting `artifacts/runtime-verification/haskell-ghc-wasi.json` whose manifest/build/asset digest is stale; never edit a receipt to match. Confirm `public/haskell-worker.js`, public metadata, and manifest were generated by commands, not hand-patched. If Haskell is `BROKEN` rather than disabled/unverified, Gate E fails and Task 8 is blocked.

### Task 8: Gate E2 — Obtain Budget-Approved Product and Browser Evidence

**Files:**
- Modify if contract assertions require it: `src/runtime/adapters/haskell.ts`
- Modify: `src/runtime/contracts/runtime-contract-cases.ts`
- Modify: `src/harness/runtime-contract-harness.ts`
- Modify: `scripts/verify-optional-runtime.mjs`
- Modify: `tests/runtime/haskell-adapter.test.ts`
- Modify: `tests/runtime/optional-verification.test.ts`
- Modify: `tests/oj/engine.test.ts`
- Modify: `README.md`
- Modify: `runtimes/haskell-ghc/README.md`
- Modify: `public/haskell/README.md`
- Modify: `docs/operations/runtime-assets.md`
- Create: `docs/qa/2026-09-01-haskell-ghc-e-runtime-results.md`
- Create on approved PASS: `artifacts/runtime-verification/haskell-ghc-wasi.json`
- Create: `artifacts/qa/haskell-runtime/2026-09-01-ghc-e-browser-acceptance.json`
- Move superseded evidence: `artifacts/qa/haskell-runtime/archive/bounded-2026-09-01/`
- Move baseline evidence: `artifacts/qa/haskell-runtime/baselines/2026-09-01-full-libdir-streaming.json`

**Interfaces:**
- Consumes: passed Gates A–D; Task 7 current manifest/build identity; approved `product-budget.json`; `OptionalRuntimeVerifier.verify`; Executor execute-only flow; main-thread OJ; runtime details verification UI.
- Produces: current optional-v1 receipt, product Executor/judge/recovery/network/memory evidence, truthful docs, or a budget-blocked disabled result.

**Recommended executor:** `frontend`

- [ ] **Step 1: Enforce the product-budget approval gate**

Validate `product-budget.json` against the schema in the Approval Question. Both numeric values must be positive safe integers and `concurrency` exact. If absent/invalid/unapproved, write acceptance status `BLOCKED_PRODUCT_BUDGET`, do not launch the receipt verifier, keep Haskell disabled, mark the remaining Task 8 steps blocked, and jump to Task 9.

- [ ] **Step 2: Write RED product/verification assertions**

Add exact tests that Haskell optional-v1 performs assets → identity handshake → `main` smoke → Unicode JSON judge actual values; adapter requests contain indexes/input only and never expected/verdict; Executor calls `execute` only; OJ retains expected/comparison/verdict; timeout/cancel release the Worker and a later verification/operation gets a fresh generation; stale receipts fail identity/digest validation.

- [ ] **Step 3: Run RED, implement only missing integration, then GREEN**

```powershell
pnpm test -- tests/runtime/haskell-adapter.test.ts tests/runtime/optional-verification.test.ts tests/oj/engine.test.ts tests/runtime/supervisor.test.ts
```

Expected RED only for new Haskell identity/receipt/recovery details. Preserve existing adapter/OJ boundaries; do not add Haskell ABI branches to problem definitions. After minimal harness/verifier changes, rerun the same command and require PASS.

- [ ] **Step 4: Run the standard pre-browser delivery commands sequentially**

```powershell
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run runtime:manifest
pnpm run runtime:check
pnpm run build
pnpm run smoke
node scripts/report-runtime-capabilities.mjs
```

Expected: each command exits `0`, lint has zero warnings, full tests have no failures, build/smoke pass, and the pre-receipt report is truthfully `LOADABLE_UNVERIFIED`. Never overlap test invocations. Direct wrapper-failure equivalents are listed in Task 9 and must be evidence-labeled.

- [ ] **Step 5: Launch preview, verifier, and Chromium as three detached owners**

Use the shared protocol with fixed free ports. The verifier command is `node scripts/verify-optional-runtime.mjs haskell-ghc-wasi --browser --port 4181`; read its `HARNESS_URL` from its log after readiness. Open that exact URL through loopback CDP in the throwaway Chromium profile.

- [ ] **Step 6: Prove optional-v1 and the product surfaces**

In one current app-services session:

1. Run optional verification and require ordered checks `assets`, `handshake`, `smoke`, `judge-contract`, current runtime/build identity, and receipt POST success.
2. In Runtime Details, verify Haskell and require the selector changes from disabled to enabled only after the current verification completes.
3. In Executor, run `main = putStr "你好 🌍"`; require exact Unicode stdout and no OJ verdict/submission.
4. In a Problem Workspace, run/submit a valid `solution :: String -> String; solution = id`; require actual values from Worker and AC/WA ownership in main-thread OJ.
5. Run a compile failure and `main = error "product-runtime"`; require distinct structured failure kinds/details and retained handshake identity.
6. Run `main = main` to timeout, then repeat with explicit cancel. After each, require Worker termination, no replay, and a later explicit valid source succeeds after a fresh handshake.
7. Exercise at least two judge cases and preserve fresh node/WASI/instance evidence from Gate D.

- [ ] **Step 7: Enforce network, identity, memory, and timing acceptance**

Require all runtime code/assets from the preview origin; remote runtime URL count is `0`; no `esm.sh` request or direct official dyld browser import appears. Receipt manifest SHA, every asset SHA, Worker build ID, Gate A GHC contract, Gate B profile identity, and browser handshake must be current and mutually consistent.

Measure cold initialization and peak snapshot/operation/process-tree working/private bytes. Each memory value must be ≤ 70% of approved available memory and cold initialization ≤ approved milliseconds. Exceeding either is a STOP result: reject/remove the candidate receipt, record evidence, and leave runtime unverified.

- [ ] **Step 8: Archive stale failure evidence and write truthful docs**

Only after new evidence is complete, move the old bounded failure JSON/screenshot to the archive directory and move the streaming probe to the baselines path. The new QA doc explicitly supersedes the old failure while preserving its diagnostic history.

Update docs to say production and judge are unified `ghc -e`, only the proven profile packages exist, complete libdir is diagnostic only, no GHCi/static output/wasm-ld/remote runtime exists, readonly/Worker is not a security sandbox, timing/memory is not authoritative beyond the approved product gate, and Firefox/WebKit remain unverified future productization gates.

- [ ] **Step 9: Close browser owners and validate the receipt**

Verify exact command lines, terminate only run-owned process trees, remove the run-owned profile/log tree, and confirm ports free. Then run:

```powershell
node scripts/verify-optional-runtime.mjs haskell-ghc-wasi
node scripts/report-runtime-capabilities.mjs
```

Expected on success: current receipt validates and capability report says `verified`. If the non-browser verifier intentionally reports only packaged state in this CLI mode, the report and receipt validator must still independently show the exact current verified receipt; record the command semantics rather than rewriting them. Any stale/partial/mismatched receipt is failure.

### Task 9: Full Regression, Evidence Closeout, Debug Cleanup, and Final Review

**Files:**
- Modify: `docs/qa/2026-09-01-haskell-ghc-e-runtime-results.md`
- Delete after evidence-backed closeout: `.debug-journal.md`
- Inspect: all current dirty paths and generated/evidence outputs
- Generate/refresh: `artifacts/qa/working-tree-identity.json`
- Do not create: any Git commit, tag, push, stage, stash, reset, or restore operation

**Interfaces:**
- Consumes: either successful Task 8 evidence or the first formal blocked-gate report; dirty-tree migration ledger; complete current plan/spec; all command outputs.
- Produces: one exact-tree success/blocked result, clean run-owned temp state, no debug journal, final identity, and review receipt request status.

**Recommended executor:** `complex`

- [ ] **Step 1: Classify the final branch honestly**

Success branch requires Gates A–E PASS, approved budgets, current receipt, Chromium product evidence, and no stale claims. Blocked branch names the first failed gate, exact command/assertion, evidence path, runtime state (`LOADABLE_UNVERIFIED` or `UNAVAILABLE`), skipped tasks, and smallest authorized next prerequisite. `BROKEN`, exit `2`, or missing evidence must not be called PASS.

- [ ] **Step 2: Run focused Haskell and lifecycle suites sequentially**

```powershell
pnpm test -- tests/scripts/haskell-ghc-wasm-contract.test.mjs tests/scripts/haskell-ghc-dynamic-profile.test.mjs tests/workers/haskell-jsffi-runtime.test.ts tests/workers/haskell-shared-libdir-snapshot.test.ts tests/workers/haskell-filesystem.test.ts tests/workers/haskell-bridge.test.ts tests/runtime/haskell-adapter.test.ts tests/runtime/optional-verification.test.ts tests/runtime/supervisor.test.ts tests/integration/build-worker-assets.test.ts tests/scripts/runtime-manifest-generation.test.mjs
```

Expected on the success branch: all selected tests pass. On an early blocked branch, run only tests whose source prerequisites were actually completed and list later suites as blocked, not passed.

- [ ] **Step 3: Run the full project matrix one command at a time**

```powershell
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run runtime:manifest
pnpm run runtime:check
pnpm run runtime:report
pnpm run build
pnpm run smoke
```

Expected: typecheck/build/smoke exit `0`, lint has zero warnings, all tests pass, and manifest/check/report match the branch's truthful optional state. Final identity is intentionally deferred until after cleanup and QA documentation in Step 7. New full test count must be greater than the pre-plan 295 and have zero failures; do not hard-code a fabricated final count.

If and only if a pnpm wrapper times out and its process ownership is cleaned up, use these exact direct equivalents, sequentially, and record the difference:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --max-warnings=0
node scripts/run-tests.mjs
node scripts/generate-runtime-manifest.mjs
node scripts/check-runtime-assets.mjs public
node scripts/report-runtime-capabilities.mjs
node scripts/build-app.mjs
node scripts/smoke-check.mjs
```

Do not run the pnpm and direct test commands concurrently or rerun GREEN commands without changed inputs.

- [ ] **Step 4: Audit asset ownership, LFS, identity, and receipts**

Success branch assertions:

- no delivered `libdir.tar`, `libdir.tar.gz`, `libdir.tar.gz.bin`, `ghci*`, or old `.gz` Haskell asset;
- GHC `.gz.bin` and trimmed profile `.tar.gz.bin` have `filter=lfs`, are non-pointer checked-out bytes, and match manifest/metadata/identity/receipt hashes;
- profile manifest has matching recache toolchain, packages, per-file hashes/bytes, symlink expansion, licenses, and payload total;
- generated Worker build identity changes for every required input named in Task 7 and matches browser handshake;
- only the new current receipt is treated as current; archived failure evidence is clearly historical.

Blocked branch assertions: no fake profile/cache/receipt exists; full diagnostic archive has not become a delivery fallback; runtime remains disabled; evidence names the blocker.

- [ ] **Step 5: Clean debug and run-owned temporary artifacts**

Read `.debug-journal.md` one final time, verify every listed run-owned OS-temp script/profile/log/process is gone, and retain only formal QA evidence. Then delete the exact file `.debug-journal.md`. Do not recursively clean the repository, `artifacts/qa/haskell-runtime/`, workspace, user profile, or temp parent.

Confirm all run-owned ports are free and no detached process command line points at the run root. A cleanup uncertainty blocks final review.

- [ ] **Step 6: Reconcile the dirty-tree ledger without Git writes**

```powershell
git status --short
git diff --check
git diff --stat
git diff -- .gitattributes .gitignore runtimes/haskell-ghc scripts src/workers/haskell src/runtime tests README.md docs public/runtime-manifest.json
```

Expected: every initial dirty path has an explicit final disposition from the ledger; no unrelated user path changed or disappeared; generated diffs correspond to their owners; `.debug-journal.md` is absent; `git diff --check` exits `0`. Do not “clean up” with restore/reset/stash.

- [ ] **Step 7: Write the exact-tree QA result**

The QA doc records: HEAD `d92e980`, dirty baseline, gate outcomes, commands/exits/test counts, pnpm/direct differences, GHC/profile/toolchain hashes, browser/runtime/build identity, budget values or approval blocker, memory/timing/network evidence, receipt state, stale-evidence migration, cleanup receipt, unsupported Firefox/WebKit status, and residual risks. It must not claim sandboxing, secret tests, MLE, authoritative device timing, or support on an untested browser/device.

After all cleanup and QA document edits are complete, run `pnpm run identity` (or `node scripts/working-tree-identity.mjs` only under the recorded wrapper-failure rule) to refresh `artifacts/qa/working-tree-identity.json`. No identity-included file may change between this command and final review. Record the final digest or review receipts only under excluded `artifacts/`, not by appending them to this plan or the QA doc. Any subsequent included-file edit requires recomputing identity before review.

- [ ] **Step 8: Request identity-bound final implementation review without committing**

Provide the reviewer the approved spec, this complete plan, QA result, `artifacts/qa/working-tree-identity.json`, current capability report, gate evidence, receipt if present, and final diff. A timeout, partial review, stale identity, or conditional blocker is not acceptance. Any fix invalidates the prior identity/review and requires only the affected checks plus one final identity/review pass.

Do not commit. End with the implementation outcome, evidence paths, current runtime state, residual blocker/risk, and the exact statement that Git writes were not performed.

## Plan Execution Acceptance

- A failed proof gate produces a complete, cleaned, identity-bound blocked result and leaves Haskell disabled; that is an honest plan outcome, not feature success.
- Feature success requires all five gates, approved product budgets, zero remote runtime requests, unified `ghc -e`, current optional-v1 receipt, real Executor/OJ/recovery evidence, no second Θ(`S_trim`) payload, full regressions, debug cleanup, and final exact-identity review.
- Firefox and WebKit remain explicit future productization gates after this plan; they are never inferred from Chromium.
- No task performs or requests an automatic commit.

Planner receipt status: **current revision pending re-review**. The earlier receipt predates this follow-up and is stale because the plan changed. This planner role does not dispatch `plan-critic`; current-revision review and implementation execution are orchestrator-owned.
