# Haskell (GHC/GHCi) WASM Runtime

This runtime expects official **GHC/GHCi WebAssembly** binaries built with the GHC WASM backend.
It also needs the **GHC libdir** contents to be available in the browser (packaged as a tar).

## Required artifacts

Place the following in `runtimes/haskell-ghc/dist/`:

- `ghc.wasm`
- `ghci.wasm` (optional but recommended)
- `libdir.tar` (uncompressed tar of GHC libdir)

`build:runtimes` will also generate:

- `ghc.wasm.gz`
- `ghci.wasm.gz`
- `libdir.tar.gz`

Alternatively, set environment variables:

```
GHC_WASM=/absolute/path/to/ghc.wasm
GHCI_WASM=/absolute/path/to/ghci.wasm
GHC_LIBDIR_TAR=/absolute/path/to/libdir.tar
GHC_WASM_SRC=/absolute/path/to/ghc-src
GHC_LIBDIR=/absolute/path/to/ghc/libdir
WASM_GHC_EXE=/absolute/path/to/wasm32-wasi-ghc
```

## Build ghc.wasm / libdir.tar (recommended)

Install the GHC wasm backend via **ghc-wasm-meta** so `wasm32-wasi-ghc` is available.
Then set your GHC source root and run the helper script:

```
GHC_WASM_SRC=/absolute/path/to/ghc
pnpm run build:ghc-wasm
```

**Version note**: the GHC source version must match `wasm32-wasi-ghc --numeric-version`.
To bypass the check, set `GHC_WASM_SKIP_VERSION_CHECK=1`.

This will generate:

- `runtimes/haskell-ghc/dist/ghc.wasm`
- `runtimes/haskell-ghc/dist/libdir.tar`

Then run:

```
pnpm run build:runtimes
```

Then run:

```
pnpm run build:runtimes
```

This copies the wasm binaries and libdir tar into `public/haskell/` and writes
`public/haskell/runner.meta.json`.

## Protocols

`runner.meta.json` controls execution strategy:

- `executorMode`: `ghc-e` (default)
- `testMode`: `ghc-compile` (default)

Both run **entirely in the browser** using a WASI shim and a virtual filesystem.

### ghc -e

Uses `ghc -e` to evaluate expressions after loading the user's code file.
For executor mode, users should define `main` or set `executorExpr` in `runner.meta.json`.

### ghc compile-run

Compiles the user's code to a wasm program, then runs it with stdin.
For problem mode, the worker expects:

```
solution :: String -> String
```

Where the input is a JSON string, and the return value is a **JSON string**.

## Notes

- `libdir.tar` must be an **uncompressed tar** containing the libdir root.
- The worker prefers `.gz` assets when available.
- You can override paths via `runner.meta.json` (`libdirPath`, `workDir`).
