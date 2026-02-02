# LocalCoder

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/hugefiver/LocalCoder/deploy-gh-pages.yml?branch=master)](https://github.com/hugefiver/LocalCoder/actions/workflows/deploy-gh-pages.yml)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-deployed-blue)](https://hugefiver.github.io/LocalCoder/)

A browser-based code execution platform that mimics LeetCode's interface, allowing users to browse coding problems, write solutions in multiple languages, and test their code entirely in the browser.

## Features

- **Multiple Language Support**: JavaScript, TypeScript, Python (via Pyodide), Racket (official interpreter WASM), and Haskell (GHC/GHCi WASM)
- **Syntax Highlighting & Autocomplete**: Professional code editing experience with CodeMirror
- **Resizable Panels**: LeetCode-style layout with problem description, code editor, and test results
- **Test Cases**: Default and custom test cases with instant feedback
- **Code Persistence**: Automatically saves your code per problem and language
- **Pure Frontend**: All code execution happens in browser workers - no backend required
- **Theme**: Light/Dark mode toggle (top-right)

## 安装

After installing dependencies, run the setup script to copy Pyodide files to the public directory:

```bash
pnpm install
pnpm run setup
```

`pnpm run setup` 会把 Pyodide 从 `node_modules` 复制到 `public/pyodide/`，供 Python Worker 加载。
该步骤也会在安装依赖后通过 `postinstall` 自动执行。

### （可选）启用 Haskell（GHC/GHCi WASM）

Haskell 的执行由 `public/haskell-worker.js` 驱动，它会加载 **GHC/GHCi WASM** 运行时：

- 元信息：`public/haskell/runner.meta.json`

推荐产物（由 `build:runtimes` 从 `runtimes/haskell-ghc/dist` 复制）：

- `public/haskell/ghc.wasm`
- `public/haskell/ghci.wasm`
- `public/haskell/libdir.tar`（uncompressed tar）
- `public/haskell/wasi-shim.js`

可通过环境变量指定路径：

```
GHC_WASM=/abs/path/to/ghc.wasm
GHCI_WASM=/abs/path/to/ghci.wasm
GHC_LIBDIR_TAR=/abs/path/to/libdir.tar
```

#### 生成 ghc.wasm / libdir.tar（推荐）

使用 ghc-wasm-meta 安装 `wasm32-wasi-ghc` 后，可通过脚本生成运行时产物：

- 设置 GHC 源码路径：`GHC_WASM_SRC=/abs/path/to/ghc`
- 可选：`WASM_GHC_EXE=/abs/path/to/wasm32-wasi-ghc`
- 可选：`GHC_WASM_META_HOME=~/.ghc-wasm`

运行：

- `pnpm run build:ghc-wasm`
- `pnpm run build:runtimes`

**注意版本匹配**：`GHC_WASM_SRC` 的源码版本需与 `wasm32-wasi-ghc --numeric-version` 一致，否则会编译失败。
如确需跳过检查，可设置 `GHC_WASM_SKIP_VERSION_CHECK=1`。

**压缩建议**：

- `build:runtimes` 会生成 `*.wasm.gz` 与 `libdir.tar.gz`
- Worker 会优先加载 `.gz`，若不支持再回退到未压缩版本

本仓库提供了 `runtimes/haskell-ghc/` 目录，用于分发 GHC/GHCi wasm 产物与 libdir。

#### GHCi 模式协议（重要）

当 `runner.meta.json` 指定 `protocol: "ghci"` 时：

- Worker 会通过 stdin 发送 **GHCi 命令**
- 测试模式下，默认假设 `solution :: String -> a`，输入为 **JSON 字符串**
- stdout 被当作日志；若输出可解析为 JSON，会尝试作为结果

GHC/GHCi 运行时为必需产物，缺失会导致 Haskell 运行失败。

#### GHC 模式（ghc -e / compile-run）

`runner.meta.json` 可以设置：

- `executorMode: "ghc-e"`
- `testMode: "ghc-compile"`

`ghc-compile` 会在浏览器内编译生成 wasm 再运行；需要 `libdir.tar` 支持。

### （可选）启用 RustPython（WASM）

RustPython 是另一个 Python 运行时（非 Pyodide），通过 WASI WebAssembly 运行。

- Runtime 文件：`public/rustpython/runner.wasm`
- Worker：`public/rustpython-worker.js`

`build:runtimes` 会生成 `runner.wasm.gz`（优先加载）。

### （可选）启用 Racket（官方解释器 WASM）

Racket 运行时通过 **Emscripten** 编译官方解释器生成：

- 产物：`public/racket/racket.js` + `public/racket/racket.wasm`
- 构建脚本：`runtimes/racket-runtime/build.mjs`

`build:runtimes` 会生成 `racket.wasm.gz`，worker 会优先加载 `.gz`。

运行：

```
pnpm run build:runtimes
```

如需严格要求 Racket 产物，设置：`RACKET_WASM_STRICT=1`。

本仓库在 **发布（GitHub Pages）** 时会自动编译 WASI runtimes（RustPython + Haskell）。
本地如果你也想编译：

- `pnpm run build:runtimes`

> 需要本机安装 Rust，并具备 `wasm32-wasip1`（或 `wasm32-wasi`）target。
> Haskell 需要 GHC WASM backend（`wasm32-wasi-ghc`）。
> Racket 需要 Emscripten SDK（`emcc`, `emmake`）。

### Runtime Manifest

`build:runtimes` 会输出 `public/runtime-manifest.json`，统一描述各运行时来源与格式（官方/自建、WASI/非 WASI）。

### WASI Shim 选项（对比）

- **@bjorn3/browser_wasi_shim**：WASI Preview1，GHC/GHCi wasm 官方推荐，支持 FS/preopen/poll_oneoff。
- **@bytecodealliance/preview2-shim（JCO）**：WASI Preview2（组件模型），**不兼容**当前的 `wasm32-wasi` 运行时。

若未来将运行时 **组件化（component model）**，可以考虑引入 preview2-shim；当前项目默认使用 bjorn3。

## Development

```bash
pnpm run dev
```

## 模式配置（只开启一种模式）

通过 Vite 环境变量 `VITE_APP_MODE` 可以只开启「自由执行」或「题库」其中一种模式，并让首页直接进入该模式。

- `VITE_APP_MODE=all`（默认）：首页展示入口卡片（自由执行/题库）
- `VITE_APP_MODE=executor`：`/` 直接进入自由执行（并隐藏题库入口）
- `VITE_APP_MODE=problems`：`/` 直接进入题库列表（并隐藏自由执行入口）

例如（仅示例，具体写法按你的运行方式配置 env）：

- `VITE_APP_MODE=executor`

## Deploy (GitHub Pages)

This repo includes a GitHub Actions workflow that:

- Automatically deploys when pushing to `master`
- Supports manual deployment from any branch/tag/SHA via `workflow_dispatch`

Notes:

- For SPA routing on GitHub Pages, `dist/404.html` is generated from `dist/index.html`.
- The Vite `base` is set to `/<repo>/` during Pages builds.

## How It Works

- **Workers**: Each language runs in a dedicated Web Worker for sandboxed execution
- **Pyodide**: Python support via WebAssembly-based CPython interpreter (loaded locally, not from CDN)
- **CodeMirror**: Provides syntax highlighting, autocomplete, and a professional editing experience
- **题库**：从 `src/problems/*.md` 自动加载，每个 Markdown 文件对应一个试题
- **持久化**：使用浏览器 `localStorage` 保存每个语言/试题下的代码与自定义用例

## Project Structure

```text
├── public/
│   ├── pyodide/          # Pyodide files (copied from node_modules)
│   ├── js-worker.js      # JavaScript/TypeScript execution worker
│   ├── python-worker.js  # Python execution worker
│   ├── racket-worker.js   # Racket execution worker (official WASM)
│   ├── haskell-worker.js  # Haskell execution worker (GHC/GHCi WASM)
│   ├── racket/            # Racket runtime artifacts
│   └── haskell/           # ghc/ghci wasm + libdir tar
├── scripts/
│   └── setup-pyodide.js  # Setup script to copy Pyodide files
├── src/
│   ├── components/       # React components
│   ├── hooks/           # Custom React hooks
│   ├── problems/         # Markdown 题库（每个 .md 一个试题）
│   └── App.tsx          # Main application component
```

## License

MIT License. See `LICENSE`.
