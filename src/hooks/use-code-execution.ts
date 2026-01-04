import { useState, useCallback } from 'react';
import { executeWorkerRequest } from '@/lib/runtime/worker-manager';

export type Language = 'javascript' | 'typescript' | 'python' | 'racket';

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

  const executeCode = useCallback(async (
    code: string,
    language: Language,
    testCases: TestCase[],
    options?: { executorMode?: boolean },
  ) => {
    setIsRunning(true);
    setResult(null);

    try {
      const data = await executeWorkerRequest<ExecutionResult>(
        language,
        {
          code,
          testCases,
          executorMode: options?.executorMode === true,
        },
        { timeoutMs: 30000 },
      );

      setResult(data);
      setIsRunning(false);
      return data;
    } catch (err: any) {
      const errorResult: ExecutionResult = {
        success: false,
        error: err?.message ?? String(err),
      };
      setResult(errorResult);
      setIsRunning(false);
      return errorResult;
    }
  }, []);

  // We keep workers alive for performance (especially Pyodide).
  const cleanup = useCallback(() => {}, []);

  return { executeCode, isRunning, result, cleanup };
}
