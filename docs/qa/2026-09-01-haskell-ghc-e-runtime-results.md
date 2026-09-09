# Haskell GHC-e Runtime Task 9 Results

## Dependency-baseline refresh — 2026-09-10

**Current validation is GREEN for the user-paused `UNAVAILABLE` state.** The
parent fast-forwarded the baseline from
`d92e9803a97b9210e973fbc322db678df2a285ac` to
`feb34917715b93e602096f34b3c2a9c76902251f` and completed the approved frozen
install. The five baseline dependency updates are:

- `@codemirror/lang-javascript` 6.2.5
- `@codemirror/lint` 6.9.5
- `react-day-picker` 9.14.0
- `@tailwindcss/postcss` 4.2.2
- `typescript-eslint` 8.57.1

The first `pnpm run build` RED exited 2 during its typecheck stage at
`src/components/CodeEditor.tsx:24:30`. `javascriptLanguage` is an `LRLanguage`
using `@lezer/common` 1.5.1, while the `LanguageSupport` constructor resolves a
`Language` using `@lezer/common` 1.5.0. `pnpm why @lezer/common` confirmed both
versions in that installed graph. The build had not reached the full suite,
Vite build, `dist` check, or smoke.

The minimal correction changed only `pnpm-lock.yaml`: six compatible snapshot
references (`@codemirror/autocomplete`, `@codemirror/commands`,
`@codemirror/lang-python`, `@codemirror/language`, `@lezer/highlight`, and
`@lezer/python`) were unified from `@lezer/common` 1.5.0 to the already present
1.5.1 package; the old 1.5.0 package and snapshot records were removed. The
accepted ranges were independently checked as `^1.0.0`, `^1.1.0`, `^1.2.1`,
`^1.5.0`, `^1.3.0`, and `^1.2.0`. No `CodeEditor.tsx`, package range, or other
dependency was changed. The corrected lockfile is 231,745 bytes with SHA-256
`0630a2747be7e4c75924f9b7b12872f4c035c4ceb0c654ed6d0536589c1f44bf`.

An offline frozen install then failed only because pnpm lacked supply-chain
metadata for `@typescript-eslint/visitor-keys`; this is retained as an
environment/input result, not described as a lock-integrity failure. The parent
reused the existing install authorization for a networked
`pnpm install --frozen-lockfile`, which completed with 540 entries, 6 reused,
and 0 downloaded. Parent-owned follow-up evidence reported typecheck exit 0 and
`pnpm why @lezer/common` resolving only 1.5.1. This refresh did not repeat those
two standalone commands because the normal build reruns typecheck and the graph
had already been proven.

The corrected current commands are:

| Command | Exit | Current result at `feb3491` |
|---|---:|---|
| `pnpm run build` | 0 | Normal pipeline passed typecheck, zero-warning lint, 313/313 tests with 0 failed/cancelled/skipped/todo, Vite build (6,608 modules), `dist` check, and smoke. Only the known Node `DEP0205` and third-party `gray-matter` eval warnings were emitted. |
| `pnpm run runtime:manifest` | 0 | Regenerated `public/runtime-manifest.json`. |
| `pnpm run runtime:report` | 0 | `ready: true`; JavaScript, TypeScript, and Pyodide Python packaged; Haskell unavailable; no blockers, broken runtimes, or verified optional IDs. |
| `node scripts/verify-optional-runtime.mjs haskell-ghc-wasi` | 2 | Expected disabled-state `UNAVAILABLE` with the explicit pause reason; neither a test pass nor `VERIFIED`. |

The generated Worker and staged TypeScript hashes were recorded before and
after the GREEN build and did not change. Worker build IDs also remained
`42e9aeb39931eeee` (JavaScript), `9f4fade77f53b374` (Pyodide),
`6ae70ad61480f510` (Racket), `d257db92774c4cfc` (RustPython), and
`cb5ee067f9482da3` (Haskell). No additional generated path became dirty.
Dependency changes produced new ordinary `dist` chunk hashes and slightly
different editor bundle sizes, but `dist` is generated/excluded output and no
public Worker identity changed.

A headed Chromium 147 session driven through installed Playwright 1.59.0 loaded
the new production `/executor` build from a unique throwaway OS-temp profile.
Haskell was visibly unavailable with the exact reason, its disabled option did
not change the JavaScript selection, and JavaScript remained enabled. The
capture made 18 requests, including zero Haskell/GHC/libdir requests, with no
console or page errors. Current evidence is:

- [`haskell-unavailable-browser.json`](../../artifacts/qa/haskell-runtime/haskell-unavailable-browser.json)
- [`haskell-unavailable.png`](../../artifacts/qa/haskell-runtime/haskell-unavailable.png)

The browser JSON is 3,296 bytes with SHA-256
`987a5e10518a76808edb65e76a7558a5fffd6e6bb356a5120e13bf4a88a4f1e2`;
the screenshot is 85,364 bytes with SHA-256
`e6c96c348807b3c35146a914f228f91eed91cc2170be8e471cf4e5ce6581ffc8`.

Gate A/B remain historical compiler/asset evidence and were not rerun.

## Historical paused `UNAVAILABLE` acceptance — 2026-09-10 (`d92e980`)

The user paused Haskell restoration after the blocked Gate B investigation.
`haskell-ghc-wasi` is now explicitly `UNAVAILABLE`: the generated manifest sets
`packaged`, execute, and judge to `false` with the stable reason that browser
`ghc -e` evaluation is blocked by incompatible compiler runtime ways. Real
retained assets remain listed in the manifest; their presence cannot enable the
runtime or begin optional verification. This user-paused `UNAVAILABLE` state is
not a `PACKAGED` state, optional-runtime verification pass, or Haskell runtime
success. It supersedes only the current product classification; the historical
Gate A/B evidence and failed Gate B history remain unchanged.

The paused-state acceptance completed against its `d92e980` generated output:

| Command/check | Exit | Historical result |
|---|---:|---|
| `pnpm test` | 0 | 313/313 passed; 0 failed, cancelled, skipped, or todo. The older 312/312 result below remains historical. |
| `pnpm run build` | 0 | The normal production pipeline regenerated owned outputs, passed typecheck and lint, reran 313/313 tests, transformed 6,608 Vite modules, checked `dist`, and completed its smoke step. Only the known Node `DEP0205` and third-party `gray-matter` eval warnings were emitted. |
| `pnpm run runtime:check` | 0 | Required JavaScript, TypeScript, and Pyodide Python remained `PACKAGED`; Haskell was `UNAVAILABLE` with the explicit pause reason. |
| `pnpm run runtime:report` | 0 | `ready: true`, no blockers or broken runtimes, all three required runtimes packaged, Haskell unavailable, and no verified optional runtime IDs. |
| `pnpm run smoke` | 0 | `ok: true`; all three required runtimes remained packaged and Haskell remained unavailable. |
| `node scripts/verify-optional-runtime.mjs haskell-ghc-wasi` | 2 | Expected disabled-state result: exact status `UNAVAILABLE` and the explicit pause reason. Exit 2 is neither a failed test nor `VERIFIED`. |

A headed installed Chromium 147 session driven through installed Playwright
1.59.0 loaded the production `/executor` route using dedicated ports 47431 and
47432 and an empty throwaway OS-temp profile. The UI showed Haskell as
`不可用`, exposed the exact reason, kept its option disabled when a DOM click
was attempted, and retained JavaScript as an enabled selection. The capture made
18 requests and requested zero Haskell files, including zero GHC/libdir assets;
there were no console or page errors. This was disabled-state UI evidence only,
not Haskell execution or verification evidence. Its summary remains in
`task9-closeout.json`; the formal browser JSON and screenshot paths now contain
the current `feb3491` refresh. The prior screenshot SHA-256 was
`2b1fc9aa763c8420c56d6e0831bc87a36722c14d5816f8b487a55255d895c698`.

The generated manifest at that acceptance was 5,745 bytes with SHA-256
`d5ac3b234aed445e609c3b93bef97f2f1e3e91267528e2507beb96e8ce7f9d8f`.

## Historical Gate B verdict

**Task 9 regression/QA/cleanup is complete, but the Haskell runtime delivery is
still blocked at Gate B.** Gate A passed only its bounded compiler-startup
probe. The later user-authorized, isolated official-source build successfully
produced a real matching `wasm32-wasi-ghc-pkg 9.15.20260202`; the historical
missing-tool blocker is therefore superseded. Gate B then built the candidate
profile reproducibly and proved that the exact static GHC stalls in
`ghc -e` before package-database or dyld activity.

Tasks 3–8 remain skipped under the Gate B stop rule. No candidate was published
to `public/`, no build hook was connected, no product budget or receipt was
created, and no disable/restore GREEN was claimed. At that historical closeout,
`haskell-ghc-wasi` was `LOADABLE_UNVERIFIED`, disabled, and without a current
browser receipt; the closeout update above supersedes only that current-state
classification.

The machine-readable closeout is
[`task9-closeout.json`](../../artifacts/qa/haskell-runtime/task9-closeout.json).
The current Gate B record is
[`gate-b-dynamic-profile.json`](../../artifacts/qa/haskell-runtime/gate-b-dynamic-profile.json),
with 22 hash-bound files under `gate-b-evidence/`. The complete matching-tool
source-build summary is
[`ghc-pkg-source-build.json`](../../artifacts/qa/haskell-runtime/ghc-pkg-source-build.json).

## What changed since the historical closeout

The original 2026-09-09 Task 9 closeout truthfully stopped because no matching
`wasm32-wasi-ghc-pkg` was installed. It recorded 75/75 focused and 303/303 full
tests. A bounded follow-up then corrected the strict tool probe to use
`ghc-pkg --version`, added the missing GHC gzip LFS rule, and left the runtime
disabled. Those facts remain history; they are not rewritten as if the matching
tool had existed during that run.

The user later authorized the official-source/MSYS/Hadrian dependency route in
an isolated root. That work produced the native executable at
`C:\Users\hugefiver\AppData\Local\Temp\opencode\localcoder-ghc-pkg-build-20260909-iso\matched\stage0\bin\wasm32-wasi-ghc-pkg.exe`.
Its current `--version` output is exactly one line,
`GHC package manager version 9.15.20260202`, and its SHA-256 is
`958e0ef2ff1621ca1f0896eec9258408a0730b7ca7a269c22858b10abea955ae`.
The retained source-build evidence binds the locked official GHC/Cabal sources,
signed MSYS inputs, Hadrian build, generated settings/target, executable DLL
closure, commands, failures, and final checks. This establishes the matching
tool; it is not a browser Gate B receipt.

Task 2 subsequently added these durable source inputs and tests:

- `runtimes/haskell-ghc/dynamic-e-profile.json`
- `scripts/lib/haskell-ghc-dynamic-profile.mjs`
- `scripts/lib/haskell-ghc-profile-bindings.mjs`
- `tests/scripts/haskell-ghc-dynamic-profile.test.mjs`

The final Task 2 focused pair was 17/17: eight existing wasm-contract tests plus
nine new profile tests. Adding those nine tests explains the historical Task 9
count changes: focused was 84 rather than 75, and the full suite was 312 rather
than 303. The paused-state generated-manifest regression later added one test,
so the current full acceptance count is 313; 84/312 remain historical receipts.

## Gate B build and execution findings

The accepted reproducibility pair ran the real matching tool twice and produced
the same four outputs both times. Corrections and safety reruns brought the
total to eight real builds; the final browser-tested output hashes remained
stable. The profile contains four packages (`base`, `ghc-internal`, `ghc-prim`,
and `rts`), 538 files, 50,884,682 payload bytes, and a 9,712,096-byte gzip
archive with SHA-256
`1cc1ff1e3e36c7889b3dc85f31701843d18f68d3f2e254f080496cf3da52949b`.

Real `recache` and `check` both exited 0. `check` emitted real warnings for
excluded library/include paths and absent Haddock interface/HTML paths; this is
not described as a warning-free check. No source cache was copied or fabricated.

Two execution-specific rulings were necessary and are recorded in QA evidence,
not back-edited into the already reviewed plan/spec:

1. The correct CLI form is `-B/ghc`, not `-B /ghc`. The same-commit
   `utils/ghc/Main.hs` treats `-B` as an attached prefix. The real separate form
   failed with `Missing file: ./settings`; the attached form progressed.
2. The profile must include `targets/default.target`. The next real RED was
   `Missing file: /ghc/targets/default.target`; adding the locked target let
   `--info` and `--show-packages` exit 0. This is within the spec's allowance
   for minimal adjustments required by the real GHC.

`--info` and `--show-packages` prove that settings, target, and package-cache
reads work in fresh browser Workers. They do not prove evaluation. All four
named `ghc -e` scenarios timed out, as did explicit `-dynamic` and bare
`-e 1+1`; the longest bounded attempt was 180 seconds. No dyld path or symbol
was observed. Retained CPU-profile and source evidence place the loop in
official `GHC.Driver.Session.makeDynFlagsConsistent`: this wasm target supports
only shared RTS loading, while the exact compiler reports `GHC Dynamic=NO` and
the internal-interpreter host-way reconciliation repeatedly toggles the way.
Replacing the Gate A compiler, using an external interpreter, or falsifying
target semantics was outside the approved route.

The final browser capture recorded 36 local and 0 remote requests and did not
request the full libdir archive. This is evidence for that capture only, not a
general offline or cross-browser acceptance claim. There was no full-browser
fallback. Because no scenario reached a GREEN evaluation baseline, dependency
disable/restore was not executed.

## Historical Task 9 commands

All commands ran one at a time with finite tool timeouts. No pnpm wrapper timed
out, so the direct-Node fallback was not used. Focused tests intentionally omit
the `--` separator because pnpm 12 passes it as a literal path to this
repository's harness.

| Command | Exit | Historical result |
|---|---:|---|
| `pnpm test tests/scripts/haskell-ghc-wasm-contract.test.mjs tests/scripts/haskell-ghc-dynamic-profile.test.mjs tests/workers/haskell-filesystem.test.ts tests/workers/haskell-bridge.test.ts tests/runtime/haskell-adapter.test.ts tests/runtime/optional-verification.test.ts tests/runtime/supervisor.test.ts tests/integration/build-worker-assets.test.ts tests/scripts/runtime-manifest-generation.test.mjs` | 0 | 84/84 passed; 0 failed, cancelled, skipped, or todo. |
| `pnpm test` | 0 | 312/312 passed; 0 failed, cancelled, skipped, or todo. |
| `pnpm run typecheck` | 0 | PASS. This independently reconfirms the same current source inputs checked at Task 2. |
| `pnpm run lint` | 0 | PASS with zero ESLint warnings. |
| `pnpm run runtime:manifest` | 0 | Regenerated `public/runtime-manifest.json` through its owner. |
| `pnpm run runtime:check` | 0 | Haskell is `PACKAGED`; this means bytes are present, not verified or selectable. |
| `pnpm run runtime:report` | 0 | Haskell is `loadable-unverified`, reason `No verification receipt`; verified optional IDs are empty. |
| `pnpm run build` | 0 | Full production build passed and transformed 6,608 Vite modules. It emitted the known Node `DEP0205` deprecation and third-party `gray-matter` eval warnings. |
| `pnpm run smoke` | 0 | PASS; Haskell remained `loadable-unverified`. |
| Matching `ghc-pkg --version` plus executable SHA-256 | 0 | Exact version/hash reconfirmed from the retained isolated tool. |
| Recompute all hashes listed for `gate-b-evidence/` | 0 | 22 files checked; zero byte/hash mismatches. |
| `git check-attr filter diff merge text -- public/haskell/ghc.wasm.gz.bin public/haskell/libdir.tar.gz.bin` | 0 | Both paths report `filter=lfs`, `diff=lfs`, `merge=lfs`, `text=unset`. |
| `git diff --check` | 0 | PASS. CRLF conversion notices from read-only Git inspection remain notices, not diff-check failures. |

`pnpm run identity` was deliberately not run. This report is neither final
review nor final working-tree identity; both remain parent-owned after QA files
stop changing.

## Historical evidence hashes and generated state

| Evidence | Bytes | SHA-256 |
|---|---:|---|
| `gate-a-compiler-startup.json` | 101,510 | `9c2ad9a50dc3da7f049e42a8bfa2465c3feb30e5e74d585b5bd7445403fd23da` |
| `gate-a-ci-test-input.json` | 6,464 | `96de5ea738b656dd0aef73c791e57518d8300c5e318d2b349578416c4d4c5b81` |
| `gate-b-followup.json` | 4,941 | `59233ed6774816251144ca93ca6a04402d087641c3ce1df7a695c8b6220ff5cd` |
| `ghc-pkg-source-build.json` | 19,260 | `07c707bdad0061ef9ef22d2db9e35d2dcf5bdf8ba5af35a58e8478ac9a0dd9cf` |
| `gate-b-dynamic-profile.json` | 56,104 | `4be372bdd6854b4feab098f73db83f6489302e4d608b722f90f52f070d2f1c82` |
| `haskell-runtime-qa.json` | 22,599 | `e385cb8dd72035112ab6c08444ed3aa825fcc779e649887e2f34cff408b4ca38` |
| `haskell-runtime.png` | 14,405 | `f8b05bed5a84af981d13b0f2c1620fa7d7c253b0dbf3da3d96f5ead798047ea2` |
| `streaming-decompression-probe.json` | 51,726 | `d2aa78545f892446f5bb56dde703ddaf94fe445c8c5a112ce9062a4c2ca1f0db` |

At the historical Task 9 closeout, the generated Haskell Worker was 44,053 bytes, SHA-256
`b83e90af070ba252eaeefbb53284d3fcb75e704f78683012133bef87bfd0bcfe`,
with embedded build ID `cb5ee067f9482da3`. The manifest remains 5,592 bytes,
SHA-256 `01d31262702198c55baa7af5cc99b39a148e43aa97fa178afd0ddf2a671db399`.
Neither value is promoted to a verified-runtime identity without the product
handshake and receipt.

## Assets, publication boundary, and remaining risk

- `public/haskell/ghc.wasm.gz.bin` is 21,088,671 bytes, SHA-256
  `97a96af65aeb2439989a7b0be11c2795e5862b3588b11c6ad3020537ecbd1681`.
  Its decompressed GHC is 146,482,240 bytes, SHA-256
  `a4d584aec1585cdc8a4d716faa82f5750c875c930fe882fcb0e8115c79c19e4f`.
- `public/haskell/libdir.tar.gz.bin` is still the 643,211,474-byte full
  diagnostic archive, SHA-256
  `fd46feea31a5982025a6ecbb81858a5ff861aff561b4e7153d35707055125fa2`.
  It is not a fallback and does not make the migration published or complete.
- The two `.gz.bin` assets have the required LFS attributes. The prior missing
  GHC-gzip rule is fixed and is not listed as a current risk.
- The four profile candidate outputs were never copied into `public/`; the
  normal build hook was not modified because Gate B did not pass.
- No dynamic loading, `ghc -e` output, judge output, product recovery, or
  optional-runtime receipt was validated. A packaged exit 0 is not a verified
  runtime result.
- The memory/cold-start budget remains unapproved. Task 8 was not reached.

## Cleanup receipt

The corrected dependency-baseline refresh used the unique run-owned root
`C:\Users\HUGEFI~1\AppData\Local\Temp\opencode\localcoder-haskell-refresh-feb3491-48632`.
It started only preview PID 23564 and Chromium root PID 41200 on ports 48631 and
48632. Both command lines were rechecked before termination; only that preview
and Chromium process tree were terminated. Both PIDs and listeners are absent,
and the complete run root (profile, probe, and logs) was removed.
`.debug-journal.md`, `SESSION-HANDOFF.md`, and `.test-dist` remain absent.

The paused-state acceptance started only its dedicated preview PID 32980 and
Chromium root PID 1956 on ports 47431 and 47432. Their command lines were
rechecked immediately before termination; only the preview process and the
Chromium process tree were terminated. Both PIDs are absent and both ports have
zero listeners. The throwaway profile, temporary Playwright probe, and four
run-owned logs were deleted. `.debug-journal.md`, `SESSION-HANDOFF.md`, and
`.test-dist` are absent. The formal screenshot and compact JSON receipt are the
only new browser artifacts retained.

The historical Task 9 run started no browser or server. Its independent inspection found no
listeners on ports 5173, 4181, or 9222. The historical server/browser PIDs were
not present; no PID was killed, avoiding any PID-reuse risk. The exact Task 2
browser/profile temp root and the four earlier Gate A/diagnostic roots were
absent. `scripts/probes/haskell-ghc-profile-toggle.mjs`, `.debug-journal.md`,
and `SESSION-HANDOFF.md` were absent and were not recreated. The
`scripts/probes/` parent directory exists but is empty and is not a Git dirty
path.

The first read-only exact-target audit command had a PowerShell parser error at
a pipeline after `foreach`; the corrected audit exited normally and returned
all exact targets as absent. No cleanup result relies on the failed expression.

The matching-tool root
`C:\Users\hugefiver\AppData\Local\Temp\opencode\localcoder-ghc-pkg-build-20260909-iso`
is intentionally retained. Its executable is present and no running executable
is owned by that root. Its retained `evidence-index.json` was reconfirmed at
330,809 bytes with SHA-256
`d3013d95c4d109249e871509556579085efaa43fb1d70ebc4928b5d7f529724a`.
It remains the only authorized matching tool plus its dependency/source/
provenance closure. It is intentional retained Gate B/tool evidence, not browser
QA garbage, and this paused-state acceptance did not modify or delete it. The
parent/runtime maintainer owns later removal, after the tool and source evidence
are no longer needed and with authority to remove only that exact root.

## Dirty-tree reconciliation

The working tree was a user-supplied dirty migration input and was not restored,
reset, stashed, staged, or committed. The historical Gate A baseline recorded
20 tracked dirty paths. The current complete ledger has 70 paths: 23 modified,
2 deleted, and 45 untracked. Relative to the prior 64-path closeout ledger, the
four additional tracked changes are `README.md`, `pnpm-lock.yaml`,
`scripts/generate-runtime-manifest.mjs`, and
`tests/runtime/generated-manifest.test.ts`; the two additional untracked paths
are the paused-state browser JSON and screenshot. The untracked set still
includes all retained QA artifacts (including the 22 Gate B evidence files),
plan/spec/report, both `.gz.bin` assets, Gate A contract files, the four Task 2
profile source/test files, and their tests. The exact per-path ledger is in
`task9-closeout.json`; no unexpected path was found.

The two legacy `.gz` deletions and the `.gz.bin` replacements remain migration
inputs. `artifacts/qa/working-tree-identity.json` also remains a pre-existing
dirty input and must not be represented as current identity. Generated
`public/haskell-worker.js`, `public/haskell/runner.meta.json`, and
`public/runtime-manifest.json` were regenerated only through existing owners.
The Task 2 profile outputs remain evidence-only because Gate B failed.

## Historical evidence limits

Gate A proves only startup and the exact GHC source identity. The initial
`haskell-runtime-qa.json`, screenshot, and streaming-decompression probe record
the earlier full-archive failure and diagnostics; they do not prove a product
loader, fallback, memory budget, MLE, secure sandbox, secret tests, or supported
device class. Gate B's `--info`/`--show-packages` success proves configuration
reads, not evaluation. Firefox and WebKit were not tested. Final identity and
implementation review are intentionally outside this Task 9 closeout.

This refresh subagent performed no delegation, software installation, Git
write, restore, reset, or stash. The parent-owned approved frozen install and
fast-forward are baseline inputs, not actions repeated by this refresh.
