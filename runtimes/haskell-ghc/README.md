# Haskell GHC WASI runtime input

This directory retains the prepared input for the browser's **GHC WASI** runtime. Supply an
official GHC WASM-backend compiler and its uncompressed GHC libdir tar in
`dist/`:

- `ghc.wasm`
- `libdir.tar`

`pnpm run build:runtimes` stages raw fallbacks plus HTTP-stable compressed
assets under `public/haskell/` as `ghc.wasm.gz.bin` and
`libdir.tar.gz.bin`. The compressed filenames contain ordinary gzip bytes; the
Worker explicitly decompresses them, while the raw compiler asset remains the
fallback.

`runner.meta.json` selects `ghc-e` for executor mode and `ghc-compile` for
judge mode. This prepared path does **not** support GHCi; do not select `ghci`
or add a GHCi artifact for this milestone. The metadata schema retains its
conditional GHCi field only for compatibility with existing validation.

The runtime has a fixed package set from its packaged GHC libdir: `ghc`,
`ghc-boot`, `base`, `array`, `bytestring`, `directory`, `process`, `filepath`,
`containers`, `transformers`, and `unix`. It does not install, download, or
resolve packages in the browser.

`build:runtimes` stages `public/haskell/runner.meta.json` from this source
metadata and rebuilds the Worker and runtime manifest. The normal app build
consumes already staged assets; external GHC tooling is not installed by this
repository or CI. Browser `ghc -e` evaluation is blocked by incompatible
compiler runtime ways, and restoration is paused. The catalog therefore reports
Haskell as `UNAVAILABLE`; the retained files are technical preparation, not a
delivered or verifiable runtime.
