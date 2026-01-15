# RustPython runtime (WASI)

This directory contains the RustPython WASI runtime used by `public/rustpython-worker.js`.

## Required file

- `runner.wasm`

This file is produced by `pnpm run build:runtimes` (alias: `pnpm run package:runtimes`).

## Protocol

stdin JSON:
- executor: `{ "mode": "executor", "code": "..." }`
- test: `{ "mode": "test", "code": "...", "input": <any> }`

stdout JSON:
`{ "logs": "...", "result": <any>, "error"?: string }`
