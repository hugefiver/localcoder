# LocalCoder - Copilot Instructions

## Architecture Overview

Browser-based LeetCode-style coding platform with **pure frontend execution** - all code runs in Web Workers with no backend. Multi-language support via isolated worker runtimes.

### Key Components

- **Workers (`public/*-worker.js`)**: Language execution sandboxes (JavaScript/TypeScript share `js-worker.js`, Python uses `python-worker.js` with Pyodide)
- **Worker Manager (`src/lib/runtime/worker-manager.ts`)**: Singleton worker lifecycle, request routing, timeout handling, state synchronization via `useSyncExternalStore`
- **Problem System (`src/lib/problems.ts`)**: Auto-loads from `src/problems/*.md` using Vite's `import.meta.glob` with gray-matter frontmatter parsing
- **Storage Pattern**: Per-problem, per-language code persistence via `useLocalStorageState` with keys like `problem-${id}-language` and `problem-${id}-code-${lang}`, includes cross-tab sync via storage events
- **UI Layout**: React Router SPA with resizable panels (problem description | code editor | test results) using `react-resizable-panels`
- **Routing**: Uses `react-router-dom` with routes: `/` (home), `/problems` (list), `/problems/:id` (editor), `/executor` (free-form code execution)

## Critical Setup Requirements

**Pyodide must be copied to `public/pyodide/` before Python execution works:**

```bash
pnpm install  # triggers postinstall hook
pnpm run setup  # or run manually
```

The `scripts/setup-pyodide.js` copies entire `node_modules/pyodide/` to `public/` (not from CDN). Workers load from relative path via `importScripts('./pyodide/pyodide.js')`.

## Development Workflow

```bash
pnpm dev        # Vite dev server (port 5173)
pnpm build      # TypeScript + Vite build (note: tsc -b --noCheck skips type checking)
pnpm lint       # ESLint
pnpm preview    # Preview production build
```

**GitHub Pages deployment**: Auto-deploys on push to `master` via `.github/workflows/deploy-gh-pages.yml`. Build sets `GITHUB_PAGES=true` env var and uses relative base path `./` for assets. SPA routing handled by copying `dist/index.html` → `dist/404.html` via custom Vite plugin `ghPagesSpaFallback()`.

## Code Patterns

### Adding Problems

Create `src/problems/NNN-slug.md` with frontmatter:

```yaml
---
id: 7
title: Problem Name
difficulty: Easy|Medium|Hard
description: Short summary for list view
examples:
  - input: "nums = [2,7,11,15], target = 9"
    output: "[0,1]"
    explanation: "Optional explanation"
constraints:
  - "2 <= nums.length <= 10^4"
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

Workers use request/response with unique IDs. Example from `worker-manager.ts`:

```typescript
await executeWorkerRequest<ExecutionResult>(
  language,
  { code, testCases, executorMode },
  { timeoutMs: 30000 }
);
```

Workers post back `{ success, results, requestId }`. Python worker initialization takes 10-15s first run (Pyodide loading). Workers send `{ type: 'ready', requestId }` after initialization.

### State Management

- **No Redux/Zustand**: Hooks + React Router + localStorage only
- **Cross-tab sync**: `useLocalStorageState` listens to `storage` events, automatically syncs state across browser tabs/windows
- **Worker states**: Global singleton in `worker-manager.ts`, exposed via `getAllRuntimeStates()` for React consumption with `useSyncExternalStore`
- **Runtime states**: `idle` → `loading` → `ready` | `error`, tracked per-language

## Project Conventions

- **Path alias**: `@/` maps to `src/` (see `tsconfig.json` and `vite.config.ts`)
- **UI components**: Shadcn/ui with Radix primitives (config in `components.json`), "new-york" style
- **Styling**: Tailwind CSS v4 with `@tailwindcss/vite` plugin, custom theme in `theme.json`
- **Icons**: Lucide React (configured in `components.json`)
- **Package manager**: pnpm 10.0.0 (specified in `packageManager` field)
- **No type checking in build**: `tsc -b --noCheck` means TypeScript errors don't fail builds

## Integration Points

- **CodeMirror 6**: Custom theme in `CodeEditor.tsx` with language-specific extensions (JavaScript uses `@codemirror/lang-javascript`, Python uses `@codemirror/lang-python`)
- **Pyodide**: WebAssembly CPython, loaded from local `public/pyodide/` NOT CDN. Base URL calculated dynamically in worker: `self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/') + 'pyodide/'`
- **Vite build config**: Special rollup options to preserve worker filenames and output Pyodide assets to correct paths (see `vite.config.ts` `assetFileNames` logic)
- **Theme system**: Uses `next-themes` for dark/light mode toggle with system preference detection

## Testing & Execution

Test cases run in workers with timeout protection (default 5s per test, 30s overall). Two modes:

1. **Problem mode** (`executorMode: false`): Runs user function against test cases, compares actual vs expected with deep equality
2. **Executor mode** (`executorMode: true`): Free-form code execution, returns logs + final result (used in `/executor` page)

All languages wrap user code in try-catch and capture `console.log` output via function interception.

## Important Constraints

- **Pure frontend**: No server-side execution, no API calls to external code runners
- **Worker persistence**: Workers stay alive across executions for performance (especially Pyodide's 10-15s init)
- **TypeScript quirks**: Build uses `tsc -b --noCheck` - type errors don't fail build, ensure types are correct manually
- **GitHub Pages**: SPA routing requires 404.html fallback, base path set to `./` (relative) via `GITHUB_PAGES` env var
- **Asset handling**: Vite configured to copy `public/` directory contents (including Pyodide), workers and Pyodide assets get special path handling in build output

## File Structure Conventions

- **Workers** live in `public/` (not `src/`) to avoid being processed by build tools
- **Problems** must follow naming pattern `NNN-slug.md` where NNN is a number (used for ID extraction if not in frontmatter)
- **Components**: React functional components with hooks, no class components
- **Hooks**: Custom hooks prefixed with `use-` in `src/hooks/`
- **Pages**: Top-level route components in `src/pages/` suffixed with `Page.tsx`
