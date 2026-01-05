import { useState, useCallback, useRef } from 'react';
import { executeWorkerRequest } from '@/lib/runtime/worker-manager';

// NOTE: When adding a new language, also update:
// - src/lib/runtime/worker-manager.ts (workerFilenameMap + runtime snapshot)
// - src/hooks/use-worker-loader.ts (display names)
// - src/lib/problems.ts (languageInfo)
// - UI language dropdowns (EditorView / ExecutorView)
// - public/*-worker.js

export type Language = 'javascript' | 'typescript' | 'python' | 'racket' | 'haskell' | 'rustpython';

interface TestCase {
  input: any;
  expected: any;
}

interface TestResult {
  input: any;
  expected: any;
  actual: any;
  passed: boolean;
  error?: string;
  logs?: string;
}

interface ExecutionResult {
  success: boolean;
  results?: TestResult[];
  executionTime?: number;
  error?: string;
  stack?: string;
  logs?: string;
  result?: any;
}

export function useCodeExecution() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const executeCode = useCallback(async (
    code: string,
    language: Language,
    testCases: TestCase[],
    options?: { executorMode?: boolean },
  ) => {
    setIsRunning(true);
    setResult(null);

    // Abort any previous run (defensive; UI should prevent concurrent runs).
    try {
      abortRef.current?.abort();
    } catch {
      // ignore
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await executeWorkerRequest<ExecutionResult>(
        language,
        {
          code,
          testCases,
          executorMode: options?.executorMode === true,
        },
        { timeoutMs: 30000, signal: controller.signal, terminateOnAbort: true },
      );

      setResult(data);
      setIsRunning(false);
      return data;
    } catch (err: any) {
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (typeof err === 'object' && err != null && err.name === 'AbortError');

      const errorResult: ExecutionResult = {
        success: false,
        error: isAbort ? 'Execution cancelled' : (err?.message ?? String(err)),
      };
      setResult(errorResult);
      setIsRunning(false);
      return errorResult;
    } finally {
      // Clear controller only if it's still ours.
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    try {
      abortRef.current?.abort();
    } catch {
      // ignore
    }
  }, []);

  // We keep workers alive for performance (especially Pyodide).
  const cleanup = useCallback(() => {}, []);

  return { executeCode, cancel, isRunning, result, cleanup };
}
