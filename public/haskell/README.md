# Haskell GHC WASI runtime

This directory retains assets prepared for `public/haskell-worker.js` to run a
**GHC WASI** compiler through the local WASI shim. Browser `ghc -e` evaluation
is blocked by incompatible compiler runtime ways, and restoration is paused.
The generated manifest therefore reports this runtime as `UNAVAILABLE`; these
files do not establish delivered execution or judging support. The prepared
path does not support GHCi.

## Packaged asset contract

- `ghc.wasm.gz.bin` is the preferred compiler asset; `ghc.wasm` is its raw
  fallback.
- `libdir.tar.gz.bin` is the preferred GHC libdir archive. Its `.gz.bin`
  suffix preserves ordinary gzip bytes over HTTP so the Worker explicitly
  decompresses them with `DecompressionStream`.
- `runner.meta.json` is staged from `runtimes/haskell-ghc/runner.meta.json`.
- `wasi-shim.js` is the generated local WASI shim.

The runtime uses the fixed packages already present in the packaged GHC libdir:
`ghc`, `ghc-boot`, `base`, `array`, `bytestring`, `directory`, `process`,
`filepath`, `containers`, `transformers`, and `unix`. It does not fetch or
resolve extra packages in the browser.

The manifest preserves these real asset paths and byte counts for operational
accounting while setting `packaged` and both capabilities to `false`. Asset
presence cannot override the explicit unavailable reason or begin verification.
