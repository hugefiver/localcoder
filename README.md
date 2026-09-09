# LocalCoder

LocalCoder is a static, single-user browser application for local algorithm practice. It is an OJ-style learning tool, not a contest service. There are no accounts, backend, rankings, cloud sync, application APIs, remote code runners, or secret test infrastructure.

## Runtime support

The runtime manifest is generated from packaged assets. It is the source of truth for whether a runtime can be selected.

| Language | Runtime ID | Product state |
|---|---|---|
| JavaScript | `javascript-worker` | Required |
| TypeScript | `typescript-official` | Required, using the packaged official TypeScript compiler |
| Python | `python-pyodide` | Required, using packaged Pyodide |
| Python | `python-rustpython` | Optional, `LOADABLE_UNVERIFIED` pending a current browser receipt |
| Racket | `racket-wasm` | Optional and currently unavailable |
| Haskell | `haskell-ghc-wasi` | Optional and currently unavailable |

Runtime identities are generated from the current executable build inputs. Read the current values from `public/runtime-manifest.json` and `docs/qa/2026-08-24-localcoder-rebuild-results.md`; they are evidence for one build, not permanent runtime versions.

An optional runtime remains disabled until it has its assets, a matching current browser receipt, a protocol handshake, smoke execution, and judge-contract verification. RustPython must also match Pyodide on the six-problem corpus. Its packaged `rustpython/runner.wasm.gz.bin` contains gzip bytes under a `.bin` suffix so HTTP servers do not transparently decode it; the Worker explicitly decompresses it and retains `rustpython/runner.wasm` as the raw fallback. It remains `LOADABLE_UNVERIFIED` until a new receipt completes its verification contract. Racket lacks `racket/racket.js` and `racket/racket.wasm.gz` or `racket/racket.wasm`. Haskell restoration is paused: its retained technical assets do not make the runtime packaged or executable, and the generated manifest reports `UNAVAILABLE` because browser `ghc -e` evaluation is blocked by incompatible compiler runtime ways.

## Install and local commands

Use pnpm 12 and the committed `pnpm-lock.yaml`:

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run runtime:manifest
pnpm run runtime:check
pnpm run build
pnpm run smoke
node scripts/report-runtime-capabilities.mjs
```

For local development, run `pnpm run dev`. `pnpm run build` prepares required assets, builds Workers, generates the manifest, runs strict checks, builds the application, then performs readiness and smoke checks. Do not read an unavailable optional runtime as a passing runtime test.

To inspect one optional runtime, run:

```powershell
node scripts/verify-optional-runtime.mjs <runtimeId>
```

Exit `0` means `VERIFIED` and requires a current browser receipt. Exit `2` means `UNAVAILABLE` or `LOADABLE_UNVERIFIED`, so it is not a pass. Exit `1` means `BROKEN`.

## Local data and judging

LocalCoder stores user-created data in IndexedDB database `localcoder`. Its six stores are `drafts`, `customCases`, `submissions`, `progress`, `settings`, and `meta`. The legacy `localStorage` keys are read only by the idempotent migration, which retains them for one application schema version. They are not the current persistence architecture.

If IndexedDB is unavailable or its quota is exceeded, the app keeps session-only data in memory and displays the persistent status `未保存`. It never silently presents that data as saved. Submission history is capped at 200 records, with oldest-record removal in the same transaction as an overflowing insert.

**Run** executes public and custom cases only. It does not save a submission or change progress. **Submit** includes judge cases. A judged Submit with a protocol-validated handshake identity writes its submission record and increments attempt progress atomically for applicable AC, WA, CE, RE, TLE, and internal-error outcomes. Cancelled, unavailable, and pre-invocation failures with no identity do not write a submission. AC also records accepted or solved metadata; later non-AC results preserve previously accepted metadata. Persisted submissions record the language, runtime, and runtime/build identity.

The main thread owns expected values, comparison, and verdicts. Workers return actual values or structured failures. Judge cases are concealed in normal UI details, but any case shipped to a browser can be inspected and is not secret.

## Trust boundary

Workers provide local execution isolation and a termination boundary for a blocked task. They are not a secure sandbox, and hostile code must not be considered contained. A timeout creates a local TLE result after the Worker is terminated. Timing is device-local reference data, not an authoritative benchmark. Browser memory cannot be authoritatively measured or limited per runtime, so LocalCoder does not issue MLE verdicts.

After the application and selected runtime assets have loaded, an active browser session can execute without an application API. This does not promise offline cold-start support.

## GitHub Pages

Pages builds use relative asset paths (`./`), HashRouter routes, and a `404.html` fallback. The deployed application remains static. A missing required runtime blocks the build or deployment readiness path. CI uses `pnpm install --frozen-lockfile` and does not install Rust, Racket, Haskell, or other external runtime toolchains.

For the full runtime model, asset operation rules, and Task 23 browser acceptance matrix, read:

- [`docs/architecture/runtime-kernel.md`](docs/architecture/runtime-kernel.md)
- [`docs/operations/runtime-assets.md`](docs/operations/runtime-assets.md)
- [`docs/qa/localcoder-browser-acceptance.md`](docs/qa/localcoder-browser-acceptance.md)

## License

MIT License. See [LICENSE](LICENSE).

*Author's note: Written for a developer setting up or validating LocalCoder, with the expectation that they run the listed pnpm checks and treat runtime states literally.*
