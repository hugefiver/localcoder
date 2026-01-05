# LocalCoder

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/hugefiver/LocalCoder/deploy-gh-pages.yml?branch=master)](https://github.com/hugefiver/LocalCoder/actions/workflows/deploy-gh-pages.yml)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-deployed-blue)](https://hugefiver.github.io/LocalCoder/)

A browser-based code execution platform that mimics LeetCode's interface, allowing users to browse coding problems, write solutions in multiple languages, and test their code entirely in the browser.

## Features

- **Multiple Language Support**: JavaScript, TypeScript, Python (via Pyodide), Racket, and Haskell (via WASM/WASI runtime)
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

### （可选）启用 Haskell（WASM）

Haskell 的执行由 `public/haskell-worker.js` 驱动，它会加载一个 **WASI 兼容** 的 WebAssembly 模块：

- 将 `runner.wasm` 放到：`public/haskell/runner.wasm`

> 默认已内置一个**轻量 stub runtime**（用于保证 Haskell “可用且可运行”，并输出提示信息）。
> 如果你想真正执行/编译 Haskell 源码，请用你自己的 `runner.wasm` 覆盖它。

#### Haskell runtime 协议（非常重要）

Worker 会通过 stdin 传入一段 JSON：

- 自由执行模式：`{ "mode": "executor", "code": "..." }`
- 题目测试模式：`{ "mode": "test", "code": "...", "input": <any> }`

Runtime 需要把结果以 **一段 JSON** 打到 stdout：

`{ "logs": "...", "result": <any> }`

如果 stdout 不是 JSON，平台会把它当作纯日志输出。

#### 推荐实现方式（示例思路）

你可以把 `runner.wasm` 做成一个小的 WASI 程序：

- 从 stdin 读取 JSON
- 根据 `mode` 选择：执行/测试
- 把 `{logs,result}` 写回 stdout

这样前端 Worker 不需要懂 Haskell 语法/类型/编译细节，只负责传入 code 和 input。

### （可选）启用 RustPython（WASM）

RustPython 是另一个 Python 运行时（非 Pyodide），通过 WASI WebAssembly 运行。

- Runtime 文件：`public/rustpython/runner.wasm`
- Worker：`public/rustpython-worker.js`

本仓库在 **发布（GitHub Pages）** 时会自动编译 WASI runtimes（RustPython + Haskell stub）。
本地如果你也想编译：

- `pnpm run build:runtimes`

> 需要本机安装 Rust，并具备 `wasm32-wasip1`（或 `wasm32-wasi`）target。

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
│   ├── racket-worker.js   # Racket execution worker
│   ├── haskell-worker.js  # Haskell execution worker (WASM/WASI)
│   └── haskell/           # Place runner.wasm here
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
