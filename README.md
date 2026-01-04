# LocalCoder

A browser-based code execution platform that mimics LeetCode's interface, allowing users to browse coding problems, write solutions in multiple languages, and test their code entirely in the browser.

## Features

- **Multiple Language Support**: JavaScript, TypeScript, Python (via Pyodide), and Racket
- **Syntax Highlighting & Autocomplete**: Professional code editing experience with CodeMirror
- **Resizable Panels**: LeetCode-style layout with problem description, code editor, and test results
- **Test Cases**: Default and custom test cases with instant feedback
- **Code Persistence**: Automatically saves your code per problem and language
- **Pure Frontend**: All code execution happens in browser workers - no backend required

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
│   └── racket-worker.js  # Racket execution worker (placeholder)
├── scripts/
│   └── setup-pyodide.js  # Setup script to copy Pyodide files
├── src/
│   ├── components/       # React components
│   ├── hooks/           # Custom React hooks
│   ├── problems/         # Markdown 题库（每个 .md 一个试题）
│   └── App.tsx          # Main application component
```

## License

MIT
