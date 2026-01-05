# LocalCoder

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/hugefiver/LocalCoder/deploy-gh-pages.yml?branch=master)](https://github.com/hugefiver/LocalCoder/actions/workflows/deploy-gh-pages.yml)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-deployed-blue)](https://hugefiver.github.io/LocalCoder/)

A browser-based code execution platform that mimics LeetCode's interface, allowing users to browse coding problems, write solutions in multiple languages, and test their code entirely in the browser.

## Features

- **Multiple Language Support**: JavaScript, TypeScript, Python (via Pyodide), and Racket
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
│   └── racket-worker.js  # Racket execution worker
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
