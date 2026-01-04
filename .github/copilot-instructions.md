# LocalCoder - Copilot Instructions

## Architecture Overview

Browser-based LeetCode-style coding platform with **pure frontend execution** - all code runs in Web Workers with no backend. Multi-language support via isolated worker runtimes.

### Key Components

- **Workers (`public/*-worker.js`)**: Language execution sandboxes (JavaScript/TypeScript share `js-worker.js`, Python uses `python-worker.js` with Pyodide)
- **Worker Manager (`src/lib/runtime/worker-manager.ts`)**: Singleton worker lifecycle, request routing, timeout handling, state synchronization via `useSyncExternalStore`
- **Problem System (`src/lib/problems.ts`)**: Auto-loads from `src/problems/*.md` using Vite's `import.meta.glob` with gray-matter frontmatter parsing
- **Storage Pattern**: Per-problem, per-language code persistence via `useLocalStorageState` with keys like `problem-${id}-language` and `problem-${id}-code-${lang}`
- **UI Layout**: React Router SPA with resizable panels (problem description | code editor | test results) using `react-resizable-panels`

## Critical Setup Requirements

**Pyodide must be copied to `public/pyodide/` before Python execution works:**

```bash
pnpm install  # triggers postinstall hook
pnpm run setup  # or run manually
```

The `scripts/setup-pyodide.js` copies entire `node_modules/pyodide/` to `public/` (not from CDN). Workers load from relative path via `importScripts('./pyodide/pyodide.js')`.

## Development Workflow

```bash
pnpm dev        # Vite dev server
pnpm build      # TypeScript + Vite build (note: tsc -b --noCheck skips type checking)
pnpm lint       # ESLint
pnpm preview    # Preview production build
```

**GitHub Pages deployment**: Auto-deploys on push to `master` via `.github/workflows/deploy-gh-pages.yml`. Build sets `VITE_BASE=/<repo>/` for correct asset paths. SPA routing handled by copying `dist/index.html` → `dist/404.html`.

## Code Patterns

### Adding Problems

Create `src/problems/NNN-slug.md` with frontmatter:

```yaml
---
id: 7
title: Problem Name
difficulty: Easy|Medium|Hard
description: Short summary for list view
testCases:
  - input: {"param": value}
    expected: result
templates:
  javascript: |
    function solution(input) { /* ... */ }
  python: |
    def solution(input):
        # Your code here
---
Markdown body rendered as problem description
```

### Worker Communication Pattern

Workers use request/response pattern with unique IDs. Example from `worker-manager.ts`:

```typescript
await executeWorkerRequest<ExecutionResult>(
  language,
  { code, testCases, executorMode },
  { timeoutMs: 30000 }
);
```

Workers post back `{ success, results, requestId }`. Python worker initialization takes 10-15s first run (Pyodide loading).

### State Management

- **No Redux/Zustand**: Hooks + React Router + localStorage only
- **Cross-tab sync**: `useLocalStorageState` listens to `storage` events
- **Worker states**: Global singleton in `worker-manager.ts`, exposed via `getAllRuntimeStates()` for React consumption

## Project Conventions

- **Path alias**: `@/` maps to `src/` (see `tsconfig.json` and `vite.config.ts`)
- **UI components**: Shadcn/ui with Radix primitives (config in `components.json`), "new-york" style
- **Styling**: Tailwind CSS v4 with `@tailwindcss/vite` plugin, custom theme in `theme.json`
- **Icons**: Lucide React (configured in `components.json`)
- **Package manager**: pnpm 10.0.0 (specified in `packageManager` field)

## Integration Points

- **CodeMirror 6**: Custom theme in `CodeEditor.tsx` with language-specific extensions (JavaScript uses `@codemirror/lang-javascript`, Python uses `@codemirror/lang-python`)
- **Pyodide**: WebAssembly CPython, loaded from local `public/pyodide/` NOT CDN. Base URL calculated dynamically in worker: `self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/') + 'pyodide/'`
- **Vite build config**: Special rollup options to preserve worker filenames and output Pyodide assets to correct paths (see `vite.config.ts` `assetFileNames` logic)

## Testing & Execution

Test cases run in workers with timeout protection. Two modes:

1. **Problem mode** (`executorMode: false`): Runs user function against test cases, compares actual vs expected
2. **Executor mode** (`executorMode: true`): Free-form code execution, returns logs + final result (used in `/executor` page)

All languages wrap user code in try-catch and capture `console.log` output.

## Important Constraints

- **Pure frontend**: No server-side execution, no API calls to external code runners
- **Worker persistence**: Workers stay alive across executions for performance (especially Pyodide's 10-15s init)
- **TypeScript quirks**: Build uses `tsc -b --noCheck` - type errors don't fail build
- **GitHub Pages**: SPA routing requires 404.html fallback, base path set via env var
