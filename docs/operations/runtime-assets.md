# Runtime Assets and Verification

## Source of truth

`scripts/generate-runtime-manifest.mjs` derives `public/runtime-manifest.json` from the runtime catalog and packaged files. It records concrete asset URLs and byte sizes. Hand-authored availability flags are not sufficient.

Required runtime IDs are `javascript-worker`, `typescript-official`, and `python-pyodide`. Their assets must be present, non-empty, and match the generated manifest. A required asset or byte mismatch fails closed and blocks build or deployment readiness.

Optional runtime IDs are `python-rustpython`, `racket-wasm`, and `haskell-ghc-wasi`. They are disabled unless the catalog permits packaging, current artifacts are complete, and a successful verification session establishes support. `python-rustpython` is currently `LOADABLE_UNVERIFIED`; `haskell-ghc-wasi` is explicitly `UNAVAILABLE`. Both are disabled states, not verification passes.

## Capability states

| State | Meaning | Product effect |
|---|---|---|
| `VERIFIED` | Current assets have a matching receipt for every required browser check. | Runtime may be enabled. |
| `LOADABLE_UNVERIFIED` | Assets are packaged, but a current complete receipt is absent. | Runtime remains disabled. |
| `UNAVAILABLE` | A required optional asset group is absent, or the catalog explicitly disables the runtime. | Runtime remains disabled with the exact reason. |
| `BROKEN` | Declared or packaged assets are missing, empty, inconsistent, or a required verification check failed. | Stop acceptance and repair the owning path. |

Adding missing files can move an asset-gated optional runtime from `UNAVAILABLE` to `LOADABLE_UNVERIFIED`. It cannot override an explicit catalog reason, does not create `VERIFIED` status, and does not prove execution, judging, or product support.

## Current asset reality

The following optional asset group remains missing. This is a truthful disabled
product state, not a passing execution result.

| Runtime ID | Missing group |
|---|---|
| `racket-wasm` | `racket/racket.js` and one of `racket/racket.wasm.gz` or `racket/racket.wasm` |

RustPython packages `rustpython/runner.wasm.gz.bin` and `rustpython/runner.wasm`. The `.gz.bin` name contains ordinary gzip bytes but prevents HTTP servers from assigning `Content-Encoding: gzip` and transparently decoding the response before the Worker can hash and explicitly decompress it. The raw file remains the host fallback. Release copies are tracked through Git LFS, and unresolved pointer text is a broken asset rather than a packaged runtime. Both variants are declared and hashed while present; a new complete browser receipt is still required before RustPython can become `VERIFIED`.

Haskell retains the GHC WASI compiler as `haskell/ghc.wasm.gz.bin` with
`haskell/ghc.wasm` as the raw fallback, plus
`haskell/libdir.tar.gz.bin`. The Worker explicitly decompresses the `.gz.bin`
assets; the suffix avoids HTTP content-encoding interference. The prepared modes
are `ghc-e` and `ghc-compile`; GHCi is not supported. Its fixed libdir package
set is `ghc`, `ghc-boot`, `base`, `array`, `bytestring`, `directory`, `process`,
`filepath`, `containers`, `transformers`, and `unix`. Browser `ghc -e`
evaluation is blocked by incompatible compiler runtime ways, and restoration is
paused. The catalog therefore keeps `haskell-ghc-wasi` explicitly `UNAVAILABLE`
with execute and judge capabilities disabled, even while the manifest preserves
the real retained asset list for operational accounting.

## Worker identity v2

Generated identities identify a particular built Worker and its applicable runtime assets. They are structured hashes of the canonical effective `esbuild` plan (entry point, logical output, bundle settings, define contract, and resolved paths), the complete metafile-resolved import closure, the installed `esbuild` metadata, library code, and platform binary actually used to build the Worker, plus the WASI shim distribution for runtimes that use it. Each runtime also includes its own asset group: TypeScript compiler assets, Pyodide assets, or the optional runtime assets. A missing optional group contributes a stable sentinel.

When an optional `one-of` group has multiple present loadable variants (for example gzip and raw), every present variant is declared in catalog order by the manifest, hashed by the Worker identity, and required in the verification receipt. A group remains packaged when at least one variant is present.

The generated Worker bundle and `runtime-manifest.json` are deliberately outside the identity input set. Including either would self-hash a generated output. The direct build dependencies in `pnpm-lock.yaml` must match the installed builder inputs. A tool, library, platform-binary, Worker-source, or applicable asset change therefore changes the corresponding identity, while an unrelated runtime asset does not. Two builds that use different actual builders can produce different identities even when their source checkout matches.

Current identities are generated from the installed pnpm-locked toolchain and packaged runtime bytes. Read them from `public/runtime-manifest.json` and record the observed browser handshake. An identity is a build correlation value, not authentication or a cryptographic assurance claim.

## Receipt and verification order

A browser receipt counts only when its `runtimeId`, protocol version, named checks, and asset SHA-256 digest match the current manifest and files. For an optional runtime, an opaque bounded Supervisor verification session is the authority for this transition. The required order is:

1. Generate the manifest and check asset integrity.
2. Start the loopback receipt server for the selected optional runtime.
3. Complete the versioned Worker handshake in the browser.
4. Run the executor smoke and judge actual-value contract.
5. For RustPython, run six-problem corpus parity against Pyodide as well.
6. Validate and store the current receipt, then allow the Registry to expose `VERIFIED` and `ready`.

RustPython parity requires matching actual values or compatible error classification for the correct Python fixture and every public and judge input in the six-problem corpus. A mismatch is `BROKEN`, not a reason to fall back silently to Pyodide while claiming RustPython support.

## Commands and exit codes

Use pnpm 12 and the committed lockfile.

```powershell
pnpm install --frozen-lockfile
pnpm run runtime:manifest
pnpm run runtime:check
pnpm run build
pnpm run smoke
node scripts/report-runtime-capabilities.mjs
node scripts/verify-optional-runtime.mjs <runtimeId>
node scripts/verify-optional-runtime.mjs <runtimeId> --browser --port 4180
```

`verify-optional-runtime.mjs` exits `0` only for `VERIFIED`, after a current browser receipt. It exits `2` for `UNAVAILABLE` and `LOADABLE_UNVERIFIED`. Exit `2` is a disabled-state report, not a passed runtime test. It exits `1` for `BROKEN`, including an absent manifest entry, bad assets, failed receipt, or verifier error.

`pnpm run build` is the cross-platform delivery sequence: it stages the TypeScript compiler assets, stages Pyodide, builds Worker assets, generates the manifest, reports capabilities, typechecks, runs zero-warning lint, runs tests, builds the static site, checks runtime assets in `dist`, and runs smoke checks. The manifest must follow Worker and asset construction so it describes the files actually delivered. `node scripts/report-runtime-capabilities.mjs` reports required and optional classifications for the current artifacts.

GitHub Pages deployment uses `pnpm install --frozen-lockfile`, the strict quality commands, the Pages build, and the capability report. Required failure blocks delivery. CI does not install Rust, Racket, Haskell, or any other external runtime toolchain. A packaged optional remains disabled in the UI and controller, is rejected by the OJ Engine, and cannot be started through the Supervisor until its verification session succeeds. The same gate remains in force during verification, so ordinary execution cannot create a Worker around it. A verified optional keeps that verification state through a Worker failure and may recover using a fresh Worker. `UNAVAILABLE` and `LOADABLE_UNVERIFIED` are valid disabled product states, but neither is a passing optional-runtime test. `BROKEN` fails the workflow.

*Author's note: Written for release and CI operators, so packaged files, browser receipts, and actual runtime support cannot be confused.*
